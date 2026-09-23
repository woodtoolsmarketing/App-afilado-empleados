import {
  caracteristicasDeArticulo,
  descripcionSugerida,
  esDescripcionSugerida,
  espaciado,
  ETIQUETA_HERRAMIENTA,
  FAMILIA_PRODUCTO,
  formatearMoneda,
  formatearPesos,
  radios,
  resumenCaracteristicas,
  type CaracteristicasArticulo,
  type FormularioItemNota,
} from '@woodtools/compartido'
import { useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Campo, MensajeError } from '../../componentes/Formulario'
import { Aviso, Pastilla } from '../../componentes/Estado'
import {
  buscarArticulos,
  LISTA_POR_FAMILIA,
  LISTA_SUELTA,
  type ArticuloCatalogo,
} from '../../servicios/notasPedido'
import { hojaDeTema, usarTema } from '../../nucleo/tema'

/**
 * Buscador del catálogo de precios para cotizar una venta.
 *
 * El vendedor tipea el código o parte de la descripción y elige de la lista.
 * Al elegir se completa el renglón entero: código, descripción, precio, moneda
 * y las características que la lista trae escritas adentro de la descripción
 * —diámetro, ancho de corte y cantidad de dientes—, que son justamente las que
 * después hay que copiar a la columna técnica de la nota.
 *
 * ── Por qué la búsqueda vive en una ventana (modal) ──────────────────────────
 *
 * En el renglón, el buscador quedaba abajo de una pila de campos y, al tocarlo,
 * el teclado le tapaba los resultados: había que tipear a ciegas. En la ventana
 * el buscador y los filtros quedan arriba y la lista ocupa el resto, arriba del
 * teclado. Y de paso caben los filtros por Ø y dientes y la lista compacta con
 * el código y la medida, que es lo que el vendedor mira para elegir.
 *
 * **La lista arranca filtrada por lo que se eligió en QUÉ SE VENDE.** Elegir
 * "MECHA" y tener que tipear igual para que aparecieran las mechas era pedirle
 * al vendedor que supiera de memoria cómo las nombra la lista de precios.
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
  const { colores } = usarTema()
  const estilos = usarEstilos()
  const [abierto, setAbierto] = useState(false)

  // Las características se leen del texto de la lista, no de la descripción
  // corta: "SC nueva" no tiene adentro ningún D=, ningún Z=.
  const elegido = item.codigo_herramienta
    ? caracteristicasDeArticulo(item.descripcion_catalogo || item.descripcion, null)
    : null

  return (
    <View style={estilos.bloque}>
      {/* El botón que abre la ventana de búsqueda. Muestra qué se está por
          buscar o, si ya hay algo elegido, invita a cambiarlo. */}
      <Pressable
        onPress={() => setAbierto(true)}
        accessibilityRole="button"
        accessibilityLabel={item.codigo_herramienta ? 'Cambiar el artículo' : 'Buscar el artículo'}
        style={({ pressed }) => [
          estilos.abrir,
          !!error && estilos.abrirConError,
          pressed && estilos.tocada,
        ]}
      >
        <Text style={estilos.abrirTexto}>
          {item.codigo_herramienta ? '🔎  CAMBIAR EL ARTÍCULO' : '🔎  BUSCAR EL ARTÍCULO EN LA LISTA'}
        </Text>
      </Pressable>
      <MensajeError>{error}</MensajeError>

      {/* Lo que quedó cargado, para poder revisarlo sin volver a abrir la lista. */}
      {item.codigo_herramienta ? (
        <View style={estilos.elegido}>
          <View style={estilos.elegidoFila}>
            <Pastilla texto={item.codigo_herramienta} color={colores.verdeOscuro} />
            {item.moneda === 'USD' ? <Pastilla texto="LISTA EN US$" color={colores.azul} /> : null}
          </View>
          <Text style={estilos.elegidoDesc}>{item.descripcion_catalogo || item.descripcion}</Text>
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

      <Modal
        visible={abierto}
        animationType="slide"
        onRequestClose={() => setAbierto(false)}
        statusBarTranslucent
      >
        <VentanaBusqueda
          item={item}
          tipoCambio={tipoCambio}
          alElegir={(cambios) => {
            alElegir(cambios)
            setAbierto(false)
          }}
          alCerrar={() => setAbierto(false)}
        />
      </Modal>
    </View>
  )
}

/**
 * El contenido de la ventana: buscador + filtros arriba (fijos) y la lista de
 * resultados abajo (desplazable, arriba del teclado).
 */
function VentanaBusqueda({
  item,
  alElegir,
  alCerrar,
  tipoCambio,
}: {
  item: FormularioItemNota
  alElegir: (cambios: Partial<FormularioItemNota>) => void
  alCerrar: () => void
  tipoCambio: number
}) {
  const { colores } = usarTema()
  const estilos = usarEstilos()
  const insets = useSafeAreaInsets()

  const [consulta, setConsulta] = useState('')
  const [resultados, setResultados] = useState<ArticuloCatalogo[]>([])
  const [buscando, setBuscando] = useState(false)
  const [sinResultados, setSinResultados] = useState(false)
  const [fallo, setFallo] = useState<string | null>(null)
  /**
   * La salida de emergencia del filtro. Hay cosas que se venden y están
   * archivadas en otra familia: una muela de diamante, un bidón de resinol.
   * Sin manera de salir del filtro serían imposibles de cargar.
   */
  const [todaLaLista, setTodaLaLista] = useState(false)
  /** Filtros por característica: se aplican sobre lo que ya se trajo. */
  const [filtroDiametro, setFiltroDiametro] = useState('')
  const [filtroAncho, setFiltroAncho] = useState('')
  const [filtroDientes, setFiltroDientes] = useState('')
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null)

  const familia = todaLaLista || !item.herramienta ? null : FAMILIA_PRODUCTO[item.herramienta]
  const tope = familia ? LISTA_POR_FAMILIA : LISTA_SUELTA
  const texto = consulta.trim()
  // Con familia alcanza cualquier texto, que es filtrar una lista corta. Sin
  // familia hacen falta dos letras, porque si no la consulta es el catálogo entero.
  const hayTexto = familia ? texto.length > 0 : texto.length >= 2
  // Con familia puesta se listan solas al abrir; sin familia, sólo al escribir.
  const listarTodo = familia !== null
  const hayQueBuscar = hayTexto || listarTodo

  useEffect(() => {
    if (temporizador.current) clearTimeout(temporizador.current)
    if (!hayQueBuscar) {
      setResultados([])
      setSinResultados(false)
      setFallo(null)
      return
    }
    // La respuesta vieja no pinta: la lista sin texto sale a los 0 ms y queda en
    // vuelo mientras el vendedor tipea. Misma bandera que el resto de la carpeta.
    let cancelado = false

    temporizador.current = setTimeout(async () => {
      setBuscando(true)
      setSinResultados(false)
      setFallo(null)
      try {
        const encontrados = await buscarArticulos(texto, familia)
        if (cancelado) return
        setResultados(encontrados)
        setSinResultados(encontrados.length === 0)
      } catch (e) {
        // "Ese código no existe" y "no pude consultar la lista" son cosas distintas.
        if (cancelado) return
        setResultados([])
        setFallo((e as Error).message)
      } finally {
        if (!cancelado) setBuscando(false)
      }
    }, texto ? 300 : 0)

    return () => {
      cancelado = true
      if (temporizador.current) clearTimeout(temporizador.current)
    }
  }, [texto, familia, hayQueBuscar])

  /**
   * Carga el artículo en el renglón. Las características van a los mismos campos
   * que usa el afilado, así que salen impresas en la columna técnica sin que
   * nadie las vuelva a tipear. Se escriben TODAS, también las que este artículo
   * no trae, para no dejar puestas las medidas del anterior.
   */
  function elegir(a: ArticuloCatalogo) {
    const c = caracteristicasDeArticulo(a.descripcion, a.medida)
    alElegir({
      codigo_herramienta: a.codigo,
      ...(esDescripcionSugerida(item.descripcion)
        ? { descripcion: descripcionSugerida(item.herramienta, item.servicio) }
        : {}),
      descripcion_catalogo: a.descripcion,
      precio: String(a.precio),
      moneda: a.moneda === 'USD' ? 'USD' : 'ARS',
      diametro_exterior: c.diametro_exterior ?? '',
      diametro_interior_catalogo: c.diametro_interior ?? '',
      ancho_corte: c.ancho_corte ?? '',
      cantidad_dientes: c.dientes ?? '',
      largo: c.largo ?? '',
      ancho: c.ancho ?? '',
      espesor: c.espesor ?? '',
    })
  }

  // ── Filtros por característica sobre lo ya traído ──────────────────────────
  // El vendedor achica una familia larga por Ø exterior, ancho de corte o
  // cantidad de dientes en vez de leer código por código.
  const caractDe = (a: ArticuloCatalogo) => caracteristicasDeArticulo(a.descripcion, a.medida)
  // Se compara como NÚMERO, no como texto: así "3,2" y "3.20" son lo mismo, y
  // sobre todo "30" no matchea "300" —el texto libre sí lo hacía, y por eso el
  // vendedor no podía achicar por medida—.
  const aNum = (s: string | null | undefined): number | null => {
    if (!s) return null
    const n = Number(String(s).replace(',', '.').replace(/[^\d.]/g, ''))
    return Number.isFinite(n) ? n : null
  }
  // Dientes: `Z=30+4` son 30 dientes más 4 limpiadores. El vendedor cuenta 30,
  // pero el total es 34. Matchea cualquiera de los dos: la columna estructurada
  // guarda el total, y el texto crudo tiene los componentes.
  const dientesCoincide = (a: ArticuloCatalogo, filtro: number): boolean => {
    if (a.dientes === filtro) return true
    const m = /[Zz]\s*=?\s*(\d+(?:\s*\+\s*\d+)*)/.exec(`${a.descripcion ?? ''} ${a.medida ?? ''}`)
    if (!m) return false
    const partes = m[1].split('+').map((p) => Number(p.trim())).filter((n) => Number.isFinite(n))
    return partes.includes(filtro) || partes.reduce((x, y) => x + y, 0) === filtro
  }
  const fDiam = aNum(filtroDiametro)
  const fAncho = aNum(filtroAncho)
  const fDientes = aNum(filtroDientes)
  const visibles = resultados.filter((a) => {
    if (fDiam === null && fAncho === null && fDientes === null) return true
    // Se prefiere la medida ESTRUCTURADA del catálogo (numérica, confiable); si
    // el producto no la trae, se cae al parseo de la descripción.
    const c = caractDe(a)
    const diam = a.diametro_exterior ?? aNum(c.diametro_exterior)
    const ancho = a.ancho_corte ?? aNum(c.ancho_corte)
    if (fDiam !== null && diam !== fDiam) return false
    if (fAncho !== null && ancho !== fAncho) return false
    if (fDientes !== null && !dientesCoincide(a, fDientes)) return false
    return true
  })

  // El prefijo de familia común ("LU3F ") se saca del código para mostrarlo
  // corto: "LU3F 0200" queda "0200". Sólo si todos lo comparten.
  const prefijo = prefijoComun(visibles.map((a) => a.codigo))

  const loQueSeLista = item.herramienta
    ? ETIQUETA_HERRAMIENTA[item.herramienta].toLowerCase()
    : 'la lista'

  const hayFiltroCaract = fDiam !== null || fAncho !== null || fDientes !== null

  // En Android la ventana ya se achica sola cuando sube el teclado —adjustResize,
  // el modo por defecto de Expo— así que la lista, que ocupa el resto con flex:1,
  // queda siempre arriba del teclado sin ayuda de nadie. Un KeyboardAvoidingView
  // encima duplicaba ese ajuste y, al bajar el teclado, dejaba la lista en blanco
  // hasta volver a tipear. Por eso NO lleva: el sistema solo hace lo correcto.
  return (
    <View style={[estilos.ventana, { paddingTop: insets.top }]}>
      <View style={estilos.cabecera}>
        <Text style={estilos.titulo} numberOfLines={1}>
          {item.herramienta ? ETIQUETA_HERRAMIENTA[item.herramienta].toUpperCase() : 'LISTA DE PRECIOS'}
        </Text>
        <Pressable
          onPress={alCerrar}
          accessibilityRole="button"
          accessibilityLabel="Cerrar"
          hitSlop={10}
          style={({ pressed }) => [estilos.cerrar, pressed && estilos.tocada]}
        >
          <Text style={estilos.cerrarTexto}>✕</Text>
        </Pressable>
      </View>

      <View style={estilos.controles}>
        <Campo
          etiqueta={familia ? 'BUSCAR ENTRE LO QUE SE VENDE' : 'BUSCAR EN LA LISTA DE PRECIOS'}
          value={consulta}
          onChangeText={setConsulta}
          placeholder={familia ? 'Achicá la lista — ej. LU3F o 300' : 'Código o descripción — ej. LG2B'}
          autoCapitalize="characters"
          autoFocus
          accesorio={buscando ? <ActivityIndicator size="small" color={colores.rojo} /> : undefined}
        />

        {/* Otros filtros: por Ø exterior, ancho de corte y cantidad de dientes.
            El ancho es la medida que más distingue a una sierra —dos sierras del
            mismo Ø se diferencian por el ancho—, así que sin él no se podía
            achicar de verdad. */}
        <View style={estilos.filtros}>
          <View style={estilos.filtroTercio}>
            <Campo
              etiqueta="Ø EXT."
              value={filtroDiametro}
              onChangeText={setFiltroDiametro}
              placeholder="250"
              keyboardType="decimal-pad"
            />
          </View>
          <View style={estilos.filtroTercio}>
            <Campo
              etiqueta="ANCHO"
              value={filtroAncho}
              onChangeText={setFiltroAncho}
              placeholder="3,2"
              keyboardType="decimal-pad"
            />
          </View>
          <View style={estilos.filtroTercio}>
            <Campo
              etiqueta="DIENTES"
              value={filtroDientes}
              onChangeText={setFiltroDientes}
              placeholder="80"
              keyboardType="number-pad"
            />
          </View>
        </View>
      </View>

      <ScrollView
        style={estilos.listaScroll}
        contentContainerStyle={estilos.listaContenido}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {visibles.length > 0 ? (
          <View style={estilos.lista}>
            {visibles.map((a) => (
              <FilaMedida
                key={`${a.codigo}|${a.descripcion}`}
                articulo={a}
                prefijo={prefijo}
                tipoCambio={tipoCambio}
                alTocar={() => elegir(a)}
              />
            ))}
          </View>
        ) : null}

        {/* Con filtros de característica el corte que importa es el de lo visible. */}
        {!hayFiltroCaract && resultados.length >= tope ? (
          <Text style={estilos.nota}>
            {texto
              ? `Hay más de ${tope} que coinciden y se muestran los primeros. Escribí un poco más, o usá los filtros de arriba.`
              : `Se muestran los primeros ${tope}. Escribí parte del código o usá los filtros de arriba para achicar.`}
          </Text>
        ) : null}

        {hayFiltroCaract && resultados.length > 0 && visibles.length === 0 ? (
          <Aviso tono="atencion">
            {`Ninguno de los ${resultados.length} que se cargaron coincide con esos filtros. Probá con otra medida, o borrá los filtros.`}
          </Aviso>
        ) : null}

        {fallo && !buscando ? (
          <Aviso tono="atencion" titulo="No pudimos consultar la lista de precios">
            {fallo}
            {'\n\n'}Revisá la señal y escribí de nuevo. Sin la lista no se puede cargar el código: si
            estás sin señal, anotá el pedido en la observación y cargá la nota cuando vuelvas a tener.
          </Aviso>
        ) : null}

        {sinResultados ? (
          <Aviso tono="atencion">
            {familia
              ? `No hay ninguna ${loQueSeLista} con eso. Probá con menos letras, o mirá toda la lista con el botón de abajo: hay cosas que se venden y están en otro rubro.`
              : 'No hay ningún artículo con eso. Probá con menos letras, o con parte de la descripción en vez del código.'}
          </Aviso>
        ) : null}

        {/* La salida del filtro, siempre visible cuando el filtro está puesto. */}
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
      </ScrollView>
    </View>
  )
}

/**
 * Una fila compacta de la lista: el código corto (sin el prefijo de familia) y
 * la medida en una línea —"0200: Ø250 Z80"—, con el precio a la derecha.
 */
function FilaMedida({
  articulo,
  prefijo,
  tipoCambio,
  alTocar,
}: {
  articulo: ArticuloCatalogo
  prefijo: string
  tipoCambio: number
  alTocar: () => void
}) {
  const estilos = usarEstilos()
  const c: CaracteristicasArticulo = caracteristicasDeArticulo(articulo.descripcion, articulo.medida)
  const compacto = resumenCompacto(c)
  const moneda = articulo.moneda === 'USD' ? 'USD' : 'ARS'
  const codigoCorto =
    prefijo && articulo.codigo.startsWith(prefijo) ? articulo.codigo.slice(prefijo.length) : articulo.codigo

  return (
    <Pressable
      onPress={alTocar}
      accessibilityRole="button"
      accessibilityLabel={`${articulo.codigo}, ${articulo.descripcion}`}
      style={({ pressed }) => [estilos.fila, pressed && estilos.tocada]}
    >
      <View style={estilos.filaCabecera}>
        <Text style={estilos.codigo}>
          {codigoCorto}
          {compacto ? <Text style={estilos.medida}>{`  ${compacto}`}</Text> : null}
        </Text>
        <Text style={estilos.precio}>
          {articulo.sin_precio ? 'a confirmar' : formatearMoneda(Number(articulo.precio), moneda)}
        </Text>
      </View>
      <Text style={estilos.descripcion} numberOfLines={1}>
        {articulo.descripcion}
      </Text>
      {moneda === 'USD' && articulo.precio_pesos ? (
        <Text style={estilos.enPesos}>{`≈ ${formatearPesos(Number(articulo.precio_pesos))}`}</Text>
      ) : moneda === 'USD' && tipoCambio > 0 ? (
        <Text style={estilos.enPesos}>{`≈ ${formatearPesos(Number(articulo.precio) * tipoCambio)}`}</Text>
      ) : null}
    </Pressable>
  )
}

/** "Ø250 Z80" — la medida en corto, para la fila de la ventana. */
function resumenCompacto(c: CaracteristicasArticulo): string {
  return [
    c.diametro_exterior ? `Ø${c.diametro_exterior}` : null,
    c.dientes ? `Z${c.dientes}` : null,
    c.ancho_corte ? `${c.ancho_corte}mm` : null,
  ]
    .filter(Boolean)
    .join(' ')
}

/**
 * El prefijo de familia común, hasta el último espacio: de `["LU3F 0100",
 * "LU3F 0200"]` sale `"LU3F "`. Sirve para mostrar el código corto. Devuelve ""
 * si no todos comparten un prefijo terminado en espacio.
 */
function prefijoComun(codigos: string[]): string {
  if (codigos.length < 2) return ''
  let comun = codigos[0]
  for (const c of codigos.slice(1)) {
    let i = 0
    while (i < comun.length && i < c.length && comun[i] === c[i]) i++
    comun = comun.slice(0, i)
    if (!comun) return ''
  }
  const corte = comun.lastIndexOf(' ')
  return corte > 0 ? comun.slice(0, corte + 1) : ''
}

const usarEstilos = hojaDeTema((t) => ({
  bloque: { gap: espaciado.xs },

  abrir: {
    minHeight: 56,
    borderWidth: 2,
    borderColor: t.colores.borde,
    borderRadius: radios.sm,
    backgroundColor: t.colores.campo,
    paddingHorizontal: espaciado.base,
    justifyContent: 'center',
    alignItems: 'center',
  },
  abrirConError: { borderColor: t.colores.rojoAccion, borderWidth: 3 },
  abrirTexto: {
    fontFamily: t.tipografia.familia.subtitulo,
    fontSize: t.tipografia.tamano.sm,
    color: t.colores.tinta,
  },
  tocada: { opacity: 0.7 },

  // ── Ventana ────────────────────────────────────────────────────────────────
  ventana: { flex: 1, backgroundColor: t.colores.fondo },
  cabecera: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: espaciado.base,
    paddingVertical: espaciado.sm,
    gap: espaciado.sm,
  },
  titulo: {
    flex: 1,
    fontFamily: t.tipografia.familia.titulo,
    fontSize: t.tipografia.tamano.lg,
    color: t.colores.blanco,
    letterSpacing: 0.6,
  },
  cerrar: {
    width: 44,
    height: 44,
    borderRadius: radios.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.colores.panelClaro,
  },
  cerrarTexto: {
    fontFamily: t.tipografia.familia.titulo,
    fontSize: t.tipografia.tamano.lg,
    color: t.colores.tinta,
  },
  controles: {
    paddingHorizontal: espaciado.base,
    paddingBottom: espaciado.sm,
    gap: espaciado.xs,
    backgroundColor: t.colores.panelClaro,
    borderBottomWidth: 2,
    borderBottomColor: t.colores.borde,
  },
  filtros: { flexDirection: 'row', gap: espaciado.sm },
  filtroTercio: { flex: 1 },

  listaScroll: { flex: 1, backgroundColor: t.colores.fondo },
  listaContenido: { padding: espaciado.base, gap: espaciado.sm },

  lista: {
    borderWidth: 2,
    borderColor: t.colores.borde,
    borderRadius: radios.sm,
    backgroundColor: t.colores.campoBlanco,
    overflow: 'hidden',
  },
  fila: {
    paddingHorizontal: espaciado.md,
    paddingVertical: espaciado.sm,
    borderBottomWidth: 1,
    borderBottomColor: t.colores.panelOscuro,
    minHeight: 60,
    justifyContent: 'center',
    gap: 2,
  },
  filaCabecera: { flexDirection: 'row', justifyContent: 'space-between', gap: espaciado.sm },
  codigo: {
    fontFamily: t.tipografia.familia.subtitulo,
    fontSize: t.tipografia.tamano.base,
    color: t.colores.tinta,
    flexShrink: 1,
  },
  medida: {
    fontFamily: t.tipografia.familia.cuerpo,
    fontSize: t.tipografia.tamano.sm,
    color: t.colores.tintaSuave,
  },
  precio: {
    fontFamily: t.tipografia.familia.fuerte,
    fontSize: t.tipografia.tamano.sm,
    color: t.colores.verdeOscuro,
  },
  descripcion: {
    fontFamily: t.tipografia.familia.cuerpo,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.tintaSuave,
  },
  enPesos: {
    fontFamily: t.tipografia.familia.liviana,
    fontSize: t.tipografia.tamano.micro,
    color: t.colores.tintaTenue,
  },

  nota: {
    fontFamily: t.tipografia.familia.liviana,
    fontSize: t.tipografia.tamano.micro,
    color: t.colores.tintaSuave,
  },
  salida: {
    alignSelf: 'flex-start',
    paddingVertical: espaciado.xs,
    minHeight: 44,
    justifyContent: 'center',
  },
  salidaTexto: {
    fontFamily: t.tipografia.familia.subtitulo,
    fontSize: t.tipografia.tamano.micro,
    color: t.colores.rojo,
    textDecorationLine: 'underline',
  },

  elegido: {
    borderWidth: 2,
    borderColor: t.colores.verdeOscuro,
    borderRadius: radios.sm,
    backgroundColor: t.colores.campoBlanco,
    padding: espaciado.md,
    gap: 2,
  },
  elegidoFila: { flexDirection: 'row', gap: espaciado.xs, flexWrap: 'wrap' },
  elegidoDesc: {
    fontFamily: t.tipografia.familia.fuerte,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.tinta,
  },
  elegidoCaract: {
    fontFamily: t.tipografia.familia.liviana,
    fontSize: t.tipografia.tamano.micro,
    color: t.colores.tintaSuave,
  },
}))
