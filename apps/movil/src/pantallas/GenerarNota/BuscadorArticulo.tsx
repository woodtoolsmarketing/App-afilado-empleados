import {
  caracteristicasDeArticulo,
  colores,
  descripcionSugerida,
  esDescripcionSugerida,
  espaciado,
  formatearMoneda,
  formatearPesos,
  radios,
  resumenCaracteristicas,
  tipografia,
  type CaracteristicasArticulo,
  type FormularioItemNota,
} from '@woodtools/compartido'
import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'

import { Campo } from '../../componentes/Formulario'
import { Aviso, Pastilla } from '../../componentes/Estado'
import { buscarArticulos, type ArticuloCatalogo } from '../../servicios/notasPedido'

/**
 * Buscador del catálogo de precios para cotizar una venta.
 *
 * El vendedor tipea el código o parte de la descripción y elige de la lista.
 * Al elegir se completa el renglón entero: código, descripción, precio, moneda
 * y las características que la lista trae escritas adentro de la descripción
 * —diámetro, ancho de corte y cantidad de dientes—, que son justamente las que
 * después hay que copiar a la columna técnica de la nota.
 *
 * Antes el código se escribía a mano y el precio también. Dos lugares donde
 * equivocarse, con la lista abierta al lado.
 */
export function BuscadorArticulo({
  item,
  alElegir,
  tipoCambio,
  error,
}: {
  item: FormularioItemNota
  alElegir: (cambios: Partial<FormularioItemNota>) => void
  /** Para mostrar en pesos lo que la lista tiene en dólares. */
  tipoCambio: number
  error?: string
}) {
  const [consulta, setConsulta] = useState('')
  const [resultados, setResultados] = useState<ArticuloCatalogo[]>([])
  const [buscando, setBuscando] = useState(false)
  const [sinResultados, setSinResultados] = useState(false)
  const [fallo, setFallo] = useState<string | null>(null)
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (temporizador.current) clearTimeout(temporizador.current)
    if (consulta.trim().length < 2) {
      setResultados([])
      setSinResultados(false)
      setFallo(null)
      return
    }
    temporizador.current = setTimeout(async () => {
      setBuscando(true)
      // Se limpian ANTES de preguntar. Si no, un error dejaba en pantalla el
      // "sin resultados" de la búsqueda anterior, que dice justo lo que no es.
      setSinResultados(false)
      setFallo(null)
      try {
        const encontrados = await buscarArticulos(consulta.trim())
        setResultados(encontrados)
        setSinResultados(encontrados.length === 0)
      } catch (e) {
        // "Ese código no existe" y "no pude consultar la lista" son cosas
        // distintas. Sin señal el buscador se quedaba mudo y el renglón no se
        // podía completar de ninguna forma: el código sólo se carga eligiendo
        // de esta lista.
        setResultados([])
        setFallo((e as Error).message)
      } finally {
        setBuscando(false)
      }
    }, 300)

    return () => {
      if (temporizador.current) clearTimeout(temporizador.current)
    }
  }, [consulta])

  /**
   * Carga el artículo en el renglón.
   *
   * Las características van a los mismos campos que usa el afilado, así que
   * salen impresas en la columna técnica sin que nadie las vuelva a tipear.
   */
  function elegir(a: ArticuloCatalogo) {
    const c = caracteristicasDeArticulo(a.descripcion, a.medida)
    setConsulta('')
    setResultados([])
    alElegir({
      codigo_herramienta: a.codigo,
      // La descripción del renglón NO se pisa con el texto de la lista.
      //
      // "SIERRA CIRCULAR WIDIA D=300 d=30 B=3.2 Z=72 DER." es lo que la lista
      // dice, y no entra en la columna del talonario: la desborda y empuja
      // todo lo demás. Lo que va impreso es la descripción corta —"SC nueva"—
      // que ya puso `descripcionSugerida`; el artículo exacto queda
      // identificado por el código, que va en su propia columna.
      //
      // Sólo se completa si el vendedor no escribió nada suyo.
      ...(esDescripcionSugerida(item.descripcion)
        ? { descripcion: descripcionSugerida(item.herramienta, item.servicio) }
        : {}),
      descripcion_catalogo: a.descripcion,
      precio: String(a.precio),
      moneda: a.moneda === 'USD' ? 'USD' : 'ARS',
      ...(c.diametro_exterior ? { diametro_exterior: c.diametro_exterior } : {}),
      // El agujero de fábrica va a su propio campo: el que se carga a mano es
      // el de la pieza que trae el cliente, y la diferencia entre los dos es
      // lo que decide si hubo agrandado o buje reductor.
      ...(c.diametro_interior ? { diametro_interior_catalogo: c.diametro_interior } : {}),
      ...(c.ancho_corte ? { ancho_corte: c.ancho_corte } : {}),
      ...(c.dientes ? { cantidad_dientes: c.dientes } : {}),
      ...(c.largo ? { largo: c.largo } : {}),
      ...(c.ancho ? { ancho: c.ancho } : {}),
      ...(c.espesor ? { espesor: c.espesor } : {}),
    })
  }

  // Las características se leen del texto de la lista, no de la descripción
  // corta: "SC nueva" no tiene adentro ningún D=, ningún Z=.
  const elegido = item.codigo_herramienta
    ? caracteristicasDeArticulo(item.descripcion_catalogo || item.descripcion, null)
    : null

  return (
    <View style={estilos.bloque}>
      <Campo
        etiqueta="BUSCAR EN LA LISTA DE PRECIOS"
        obligatorio
        value={consulta}
        onChangeText={setConsulta}
        placeholder="Código o descripción — ej. LG2B o sierra 300"
        autoCapitalize="characters"
        error={error}
        accesorio={buscando ? <ActivityIndicator size="small" color={colores.rojo} /> : undefined}
        ayuda="Al elegir se completan solos el precio y las características."
      />

      {resultados.length > 0 ? (
        <View style={estilos.lista}>
          {resultados.map((a) => (
            <FilaArticulo key={a.codigo} articulo={a} alTocar={() => elegir(a)} />
          ))}
        </View>
      ) : null}

      {fallo && !buscando ? (
        <Aviso tono="atencion" titulo="No pudimos consultar la lista de precios">
          {fallo}
          {'\n\n'}Revisá la señal y escribí de nuevo. Sin la lista no se puede cargar el código del
          artículo: si estás sin señal, anotá el pedido en la observación y cargá la nota cuando
          vuelvas a tener.
        </Aviso>
      ) : null}

      {sinResultados ? (
        <Aviso tono="atencion">
          No hay ningún artículo con eso. Probá con menos letras, o con parte de la descripción en
          vez del código.
        </Aviso>
      ) : null}

      {/* Lo que quedó cargado, para poder revisarlo sin volver a buscar. */}
      {item.codigo_herramienta ? (
        <View style={estilos.elegido}>
          <View style={estilos.elegidoFila}>
            <Pastilla texto={item.codigo_herramienta} color={colores.verdeOscuro} />
            {item.moneda === 'USD' ? <Pastilla texto="LISTA EN US$" color={colores.azul} /> : null}
          </View>
          <Text style={estilos.elegidoDesc}>
            {item.descripcion_catalogo || item.descripcion}
          </Text>
          {elegido && resumenCaracteristicas(elegido) ? (
            <Text style={estilos.elegidoCaract}>{resumenCaracteristicas(elegido)}</Text>
          ) : null}
          {item.moneda === 'USD' && tipoCambio > 0 ? (
            <Text style={estilos.elegidoCaract}>
              {`Al cambio de hoy: ${formatearPesos(Number(item.precio) * tipoCambio)} por unidad`}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  )
}

function FilaArticulo({
  articulo,
  alTocar,
}: {
  articulo: ArticuloCatalogo
  alTocar: () => void
}) {
  const c: CaracteristicasArticulo = caracteristicasDeArticulo(articulo.descripcion, articulo.medida)
  const resumen = resumenCaracteristicas(c)
  const moneda = articulo.moneda === 'USD' ? 'USD' : 'ARS'

  return (
    <Pressable
      onPress={alTocar}
      accessibilityRole="button"
      accessibilityLabel={`${articulo.codigo}, ${articulo.descripcion}`}
      style={({ pressed }) => [estilos.fila, pressed && estilos.tocada]}
    >
      <View style={estilos.filaCabecera}>
        <Text style={estilos.codigo}>{articulo.codigo}</Text>
        <Text style={estilos.precio}>
          {articulo.sin_precio ? 'a confirmar' : formatearMoneda(Number(articulo.precio), moneda)}
        </Text>
      </View>
      <Text style={estilos.descripcion} numberOfLines={2}>
        {articulo.descripcion}
      </Text>
      {/* Las características son lo que deja reconocer la herramienta que el
          cliente tiene en la mano sin abrir la lista en papel. */}
      {resumen ? <Text style={estilos.caracteristicas}>{resumen}</Text> : null}
      {moneda === 'USD' && articulo.precio_pesos ? (
        <Text style={estilos.enPesos}>{`≈ ${formatearPesos(Number(articulo.precio_pesos))}`}</Text>
      ) : null}
    </Pressable>
  )
}

const estilos = StyleSheet.create({
  bloque: { gap: espaciado.xs },

  lista: {
    borderWidth: 2,
    borderColor: colores.negro,
    borderRadius: radios.sm,
    backgroundColor: colores.campoBlanco,
    overflow: 'hidden',
  },
  fila: {
    paddingHorizontal: espaciado.md,
    paddingVertical: espaciado.sm,
    borderBottomWidth: 1,
    borderBottomColor: colores.panelOscuro,
    minHeight: 64,
    justifyContent: 'center',
    gap: 2,
  },
  tocada: { opacity: 0.7 },
  filaCabecera: { flexDirection: 'row', justifyContent: 'space-between', gap: espaciado.sm },
  codigo: {
    fontFamily: tipografia.familia.subtitulo,
    fontSize: tipografia.tamano.sm,
    color: colores.tinta,
  },
  precio: {
    fontFamily: tipografia.familia.fuerte,
    fontSize: tipografia.tamano.sm,
    color: colores.verdeOscuro,
  },
  descripcion: {
    fontFamily: tipografia.familia.cuerpo,
    fontSize: tipografia.tamano.xs,
    color: colores.tinta,
  },
  caracteristicas: {
    fontFamily: tipografia.familia.liviana,
    fontSize: tipografia.tamano.micro,
    color: colores.tintaSuave,
  },
  enPesos: {
    fontFamily: tipografia.familia.liviana,
    fontSize: tipografia.tamano.micro,
    color: colores.tintaTenue,
  },

  elegido: {
    borderWidth: 2,
    borderColor: colores.verdeOscuro,
    borderRadius: radios.sm,
    backgroundColor: colores.campoBlanco,
    padding: espaciado.md,
    gap: 2,
  },
  elegidoFila: { flexDirection: 'row', gap: espaciado.xs, flexWrap: 'wrap' },
  elegidoDesc: {
    fontFamily: tipografia.familia.fuerte,
    fontSize: tipografia.tamano.xs,
    color: colores.tinta,
  },
  elegidoCaract: {
    fontFamily: tipografia.familia.liviana,
    fontSize: tipografia.tamano.micro,
    color: colores.tintaSuave,
  },
})
