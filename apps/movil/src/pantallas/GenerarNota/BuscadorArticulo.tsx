import {
  caracteristicasDeArticulo,
  colores,
  descripcionSugerida,
  esDescripcionSugerida,
  espaciado,
  ETIQUETA_HERRAMIENTA,
  FAMILIA_PRODUCTO,
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
import {
  buscarArticulos,
  LISTA_POR_FAMILIA,
  LISTA_SUELTA,
  type ArticuloCatalogo,
} from '../../servicios/notasPedido'

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
 *
 * **La lista arranca filtrada por lo que se eligió en QUÉ SE VENDE.** Elegir
 * "MECHA" y tener que tipear igual para que aparecieran las mechas era pedirle
 * al vendedor que supiera de memoria cómo las nombra la lista de precios: hay
 * mechas que se llaman "BROCA", "AVELL." o "Punta Plegado" y no aparecen
 * buscando "mecha". Con la familia puesta se muestran solas y el texto sirve
 * para achicar, no para encontrar.
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
  /**
   * La salida de emergencia del filtro.
   *
   * Hay cosas que se venden y están archivadas en otra familia: una muela de
   * diamante, un bidón de resinol, el pote de soldadura. Filtrar sin manera de
   * salir las volvería imposibles de cargar en una nota, y el vendedor no
   * tendría forma de saber por qué el código que tiene en la mano "no existe".
   */
  const [todaLaLista, setTodaLaLista] = useState(false)
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null)

  const familia = todaLaLista || !item.herramienta ? null : FAMILIA_PRODUCTO[item.herramienta]
  const tope = familia ? LISTA_POR_FAMILIA : LISTA_SUELTA
  const texto = consulta.trim()
  // Con familia se busca aunque no haya escrito nada: eso es "mostrame las
  // mechas". Sin familia hace falta el texto, porque si no la consulta es el
  // catálogo entero.
  const hayQueBuscar = familia !== null || texto.length >= 2

  // Al cambiar la herramienta el filtro vuelve a estar puesto: la salida de
  // emergencia era para el renglón anterior, no una preferencia.
  useEffect(() => {
    setTodaLaLista(false)
  }, [item.herramienta])

  useEffect(() => {
    if (temporizador.current) clearTimeout(temporizador.current)
    if (!hayQueBuscar) {
      setResultados([])
      setSinResultados(false)
      setFallo(null)
      return
    }
    /**
     * La respuesta vieja no pinta.
     *
     * `clearTimeout` no alcanza: una vez que el temporizador disparó, la
     * consulta ya salió y va a volver igual. Y acá hay dos que se pisan de
     * verdad, porque la lista sin texto sale a los 0 ms y queda en vuelo
     * mientras el vendedor tipea.
     *
     * Lo peor no es el orden entre dos búsquedas: es tocar "BUSCAR EN TODA LA
     * LISTA" mientras la de la familia está viajando. La pantalla se vacía
     * —sin familia hacen falta dos letras— y un segundo después se repuebla
     * con las sierras, abajo de un rótulo que dice "toda la lista de precios".
     * El vendedor concluye que la muela no está en el catálogo.
     *
     * Es la misma bandera que usan los otros efectos de esta carpeta.
     */
    let cancelado = false

    temporizador.current = setTimeout(async () => {
      setBuscando(true)
      // Se limpian ANTES de preguntar. Si no, un error dejaba en pantalla el
      // "sin resultados" de la búsqueda anterior, que dice justo lo que no es.
      setSinResultados(false)
      setFallo(null)
      try {
        const encontrados = await buscarArticulos(texto, familia)
        if (cancelado) return
        setResultados(encontrados)
        setSinResultados(encontrados.length === 0)
      } catch (e) {
        // "Ese código no existe" y "no pude consultar la lista" son cosas
        // distintas. Sin señal el buscador se quedaba mudo y el renglón no se
        // podía completar de ninguna forma: el código sólo se carga eligiendo
        // de esta lista.
        if (cancelado) return
        setResultados([])
        setFallo((e as Error).message)
      } finally {
        if (!cancelado) setBuscando(false)
      }
      // Sin texto no hay nada que esperar: es la lista de entrada, y media
      // pantalla en blanco por 300 ms parece que no funcionó.
    }, texto ? 300 : 0)

    return () => {
      cancelado = true
      if (temporizador.current) clearTimeout(temporizador.current)
    }
  }, [texto, familia, hayQueBuscar])

  /**
   * Carga el artículo en el renglón.
   *
   * Las características van a los mismos campos que usa el afilado, así que
   * salen impresas en la columna técnica sin que nadie las vuelva a tipear.
   *
   * Se escriben TODAS, también las que este artículo no trae. En la venta
   * estos campos no se tipean —salen sólo de acá—, así que dejarlas puestas
   * cuando el artículo nuevo no las tiene significa imprimir las medidas del
   * anterior: elegir una sierra de Z=72 y después cambiarla por una sin Z
   * dejaba la nota diciendo 72 dientes sobre una pieza que no los tiene.
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
      diametro_exterior: c.diametro_exterior ?? '',
      // El agujero de fábrica va a su propio campo: el que se carga a mano es
      // el de la pieza que trae el cliente, y la diferencia entre los dos es
      // lo que decide si hubo agrandado o buje reductor.
      diametro_interior_catalogo: c.diametro_interior ?? '',
      ancho_corte: c.ancho_corte ?? '',
      // Los dientes de una sierra que se VENDE. No se cobran por diente —eso
      // lo atajan `computoDeRenglon` y `computoDeFila`, que ponen cero en la
      // venta— pero sí van a la columna Z-Paso del talonario: es lo que la
      // fábrica lee para saber qué pieza salió.
      cantidad_dientes: c.dientes ?? '',
      largo: c.largo ?? '',
      ancho: c.ancho ?? '',
      espesor: c.espesor ?? '',
    })
  }

  // Las características se leen del texto de la lista, no de la descripción
  // corta: "SC nueva" no tiene adentro ningún D=, ningún Z=.
  const elegido = item.codigo_herramienta
    ? caracteristicasDeArticulo(item.descripcion_catalogo || item.descripcion, null)
    : null

  // "las mechas", "las sierras": el nombre de lo que se está listando, para
  // poder decirlo en los carteles sin repetir el desplegable de arriba.
  const loQueSeLista = item.herramienta
    ? ETIQUETA_HERRAMIENTA[item.herramienta].toLowerCase()
    : 'la lista'

  return (
    <View style={estilos.bloque}>
      <Campo
        etiqueta={familia ? 'BUSCAR ENTRE LO QUE SE VENDE' : 'BUSCAR EN LA LISTA DE PRECIOS'}
        obligatorio
        value={consulta}
        onChangeText={setConsulta}
        placeholder={
          familia ? `Achicá la lista — ej. 300 o bisagra` : 'Código o descripción — ej. LG2B'
        }
        autoCapitalize="characters"
        error={error}
        accesorio={buscando ? <ActivityIndicator size="small" color={colores.rojo} /> : undefined}
        ayuda={
          familia && !texto
            ? `Abajo está lo que hay de ${loQueSeLista}. Al elegir se completan solos el precio y las características.`
            : 'Al elegir se completan solos el precio y las características.'
        }
      />

      {resultados.length > 0 ? (
        <View style={estilos.lista}>
          {resultados.map((a) => (
            <FilaArticulo key={`${a.codigo}|${a.descripcion}`} articulo={a} alTocar={() => elegir(a)} />
          ))}
        </View>
      ) : null}

      {/* La lista quedó cortada. Se dice, en vez de mostrar el tope y hacer
          creer que ésos son todos los que hay.

          El corte NO es sólo el de la lista sin escribir nada: el límite se
          aplica igual cuando hay texto —"HSS" da 105 cuchillas y se ven 40— y
          el aviso estaba condicionado a que el texto estuviera vacío, así que
          justo ahí no aparecía. Sin familia el tope es otro, y también corta:
          "300" da 57 en toda la lista. */}
      {resultados.length >= tope ? (
        <Text style={estilos.nota}>
          {texto
            ? `Hay más de ${tope} que coinciden y se muestran las primeras. Escribí un poco más para achicar la lista.`
            : `Se muestran las primeras ${tope}. Escribí parte del código o de la descripción para achicar la lista.`}
        </Text>
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
          {familia
            ? `No hay ninguna ${loQueSeLista} con eso. Probá con menos letras, o mirá toda la lista acá abajo: hay cosas que se venden y están archivadas en otro rubro.`
            : 'No hay ningún artículo con eso. Probá con menos letras, o con parte de la descripción en vez del código.'}
        </Aviso>
      ) : null}

      {/* La salida del filtro. Va siempre visible cuando el filtro está puesto
          y no sólo cuando la búsqueda falla: el vendedor puede saber de entrada
          que lo que busca está en otro rubro y no tiene por qué averiguarlo
          escribiendo hasta que no aparezca nada. */}
      {item.herramienta ? (
        <Pressable
          onPress={() => setTodaLaLista((v) => !v)}
          accessibilityRole="button"
          accessibilityState={{ selected: todaLaLista }}
          style={({ pressed }) => [estilos.salida, pressed && estilos.tocada]}
        >
          <Text style={estilos.salidaTexto}>
            {todaLaLista
              ? `◂ VOLVER A ${ETIQUETA_HERRAMIENTA[item.herramienta].toUpperCase()}`
              : 'BUSCAR EN TODA LA LISTA DE PRECIOS'}
          </Text>
        </Pressable>
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

  nota: {
    fontFamily: tipografia.familia.liviana,
    fontSize: tipografia.tamano.micro,
    color: colores.tintaSuave,
  },
  salida: {
    alignSelf: 'flex-start',
    paddingVertical: espaciado.xs,
    // Alto de dedo: se toca parado en un taller, no con el mouse.
    minHeight: 44,
    justifyContent: 'center',
  },
  salidaTexto: {
    fontFamily: tipografia.familia.subtitulo,
    fontSize: tipografia.tamano.micro,
    color: colores.rojo,
    textDecorationLine: 'underline',
  },

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
