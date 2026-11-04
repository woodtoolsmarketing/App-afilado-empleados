import {
  caracteristicasDeArticulo,
  espaciado,
  ETIQUETA_HERRAMIENTA,
  FAMILIA_PRODUCTO,
  HERRAMIENTAS_POR_SERVICIO,
  nivelDeStock,
  radios,
  type CaracteristicasArticulo,
  type Herramienta,
} from '@woodtools/compartido'
import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native'

import { Aviso, Cargando } from '../componentes/Estado'
import { Campo } from '../componentes/Formulario'
import { Encabezado } from '../componentes/Encabezado'
import { BarraPanel, Pantalla, Panel } from '../componentes/Pantalla'
import {
  buscarArticulos,
  FAMILIA_COMPLETA,
  LISTA_SUELTA,
  type ArticuloCatalogo,
} from '../servicios/notasPedido'
import { hojaDeTema, usarTema } from '../nucleo/tema'
import type { PropsPantalla } from '../navegacion/tipos'

/**
 * STOCK DISPONIBLE — el vendedor mira si una herramienta hay en stock, sin
 * armar una nota ni ver precios.
 *
 * Es el MISMO semáforo del buscador de la venta (verde con de sobra, amarillo
 * con pocas, rojo si está agotado) y la MISMA lógica de carga —precarga la
 * familia entera y filtra en el teléfono; sin familia consulta el servidor por
 * texto— pero de sólo lectura: nada de precios y la fila no se toca. La cantidad
 * exacta se muestra SÓLO cuando quedan pocas (amarillo): en verde alcanza con
 * saber que hay, sin dar el número.
 *
 * El stock que la oficina no trackea (sin fila cargada) sale como "—": en la
 * venta eso iría verde (se ofrece igual), pero acá, donde la pregunta es
 * "¿cuánto hay?", decir "no hay dato" es más honesto que pintarlo de verde.
 */
const HERRAMIENTAS: Herramienta[] = HERRAMIENTAS_POR_SERVICIO.venta

export function PantallaStockDisponible({ navigation }: PropsPantalla<'StockDisponible'>) {
  const { colores } = usarTema()
  const estilos = usarEstilos()

  /** La herramienta elegida en los chips; `null` = todas (busca por texto). */
  const [herramienta, setHerramienta] = useState<Herramienta | null>(null)
  const [consulta, setConsulta] = useState('')
  /** La familia entera, bajada UNA vez; `null` mientras no llegó. */
  const [baseFamilia, setBaseFamilia] = useState<ArticuloCatalogo[] | null>(null)
  /** Resultados del servidor cuando se busca en TODO el catálogo (sin familia). */
  const [resultados, setResultados] = useState<ArticuloCatalogo[]>([])
  /**
   * El texto para el que `resultados` es la respuesta DEFINITIVA del servidor;
   * `null` mientras hay una búsqueda pendiente o en vuelo. Es lo que evita que el
   * cartel de "no hay nada" aparezca entre que se teclea y que la búsqueda
   * realmente responde para ESE texto.
   */
  const [consultaResuelta, setConsultaResuelta] = useState<string | null>(null)
  const [buscando, setBuscando] = useState(false)
  const [fallo, setFallo] = useState<string | null>(null)
  const [reintento, setReintento] = useState(0)
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null)

  const familia = herramienta ? FAMILIA_PRODUCTO[herramienta] : null
  const texto = consulta.trim()
  // Sin familia hacen falta dos letras: si no, la consulta es el catálogo entero.
  const hayTextoSuelto = texto.length >= 2

  // ── Precarga de la familia entera (una sola consulta; el resto filtra local) ──
  useEffect(() => {
    if (familia === null) {
      setBaseFamilia(null)
      setBuscando(false)
      return
    }
    let cancelado = false
    setBaseFamilia(null)
    setBuscando(true)
    setFallo(null)
    buscarArticulos('', familia, FAMILIA_COMPLETA)
      .then((todos) => {
        if (!cancelado) setBaseFamilia(todos)
      })
      .catch((e) => {
        if (!cancelado) {
          setBaseFamilia([])
          setFallo((e as Error).message)
        }
      })
      .finally(() => {
        if (!cancelado) setBuscando(false)
      })
    return () => {
      cancelado = true
    }
  }, [familia, reintento])

  // ── Búsqueda en TODO el catálogo (sin familia): consulta el servidor ─────────
  useEffect(() => {
    if (familia !== null) {
      setResultados([])
      setConsultaResuelta(null)
      return
    }
    if (temporizador.current) clearTimeout(temporizador.current)
    if (!hayTextoSuelto) {
      setResultados([])
      setFallo(null)
      // Apagar el spinner también acá: si venía un fetch en vuelo, su cleanup ya
      // lo canceló y el `finally` (que mira `!cancelado`) no lo va a apagar. Sin
      // esto, achicar el texto a menos de dos letras deja el spinner girando solo.
      setBuscando(false)
      setConsultaResuelta(null)
      return
    }
    // Se marca "buscando" YA, al programar el debounce (no recién dentro del
    // setTimeout), y se invalida la respuesta anterior (consultaResuelta = null):
    // así durante esos 300 ms se ve el spinner y `sinResultados` no pinta el
    // cartel de "no hay nada" antes de que la búsqueda responda para ESTE texto.
    let cancelado = false
    setBuscando(true)
    setFallo(null)
    setConsultaResuelta(null)
    temporizador.current = setTimeout(async () => {
      try {
        const encontrados = await buscarArticulos(texto, null)
        if (cancelado) return
        setResultados(encontrados)
        setConsultaResuelta(texto)
      } catch (e) {
        if (cancelado) return
        setResultados([])
        setFallo((e as Error).message)
      } finally {
        if (!cancelado) setBuscando(false)
      }
    }, 300)
    return () => {
      cancelado = true
      if (temporizador.current) clearTimeout(temporizador.current)
    }
  }, [texto, familia, hayTextoSuelto, reintento])

  const lista = familia !== null ? filtrarFamilia(baseFamilia ?? [], texto) : resultados
  const prefijo = prefijoComun(lista.map((a) => a.codigo))
  const sinResultados =
    !buscando &&
    !fallo &&
    lista.length === 0 &&
    (familia !== null ? baseFamilia !== null : hayTextoSuelto && consultaResuelta === texto)
  const pedirBusqueda = familia === null && !hayTextoSuelto

  return (
    <Pantalla>
      <Encabezado />
      <Panel desplazable={false}>
        <BarraPanel alVolver={() => navigation.goBack()} titulo="STOCK DISPONIBLE" />

        <View style={estilos.controles}>
          <Campo
            etiqueta="BUSCAR POR CÓDIGO O NOMBRE"
            value={consulta}
            onChangeText={setConsulta}
            placeholder={familia ? 'Achicá la lista — ej. 250 o LU3F' : 'Código o nombre — ej. sierra, LG2B'}
            autoCapitalize="characters"
            accesorio={buscando ? <ActivityIndicator size="small" color={colores.rojo} /> : undefined}
          />

          {/* Filtro por herramienta: TODAS + una por familia de producto. */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={estilos.chips}
            keyboardShouldPersistTaps="handled"
          >
            <Chip texto="TODAS" activo={herramienta === null} alTocar={() => setHerramienta(null)} />
            {HERRAMIENTAS.map((h) => (
              <Chip
                key={h}
                texto={ETIQUETA_HERRAMIENTA[h]}
                activo={herramienta === h}
                alTocar={() => setHerramienta(h)}
              />
            ))}
          </ScrollView>
        </View>

        <ScrollView
          style={estilos.listaScroll}
          contentContainerStyle={estilos.listaContenido}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {lista.length > 0 ? (
            <View style={estilos.lista}>
              {lista.map((a) => (
                <FilaStock key={`${a.codigo}|${a.descripcion}`} articulo={a} prefijo={prefijo} />
              ))}
            </View>
          ) : null}

          {/* Mientras carga (precarga de una familia o búsqueda en vuelo) y todavía
              no hay nada que mostrar, el feedback va ACÁ, en el cuerpo, que es donde
              mira el vendedor —sobre todo cuando el gesto fue tocar un chip de abajo
              y el spinner chico del campo de arriba le queda fuera de la vista. */}
          {buscando && lista.length === 0 ? <Cargando texto="Buscando…" /> : null}

          {familia === null && resultados.length >= LISTA_SUELTA ? (
            <Text style={estilos.nota}>
              {`Hay más de ${LISTA_SUELTA} que coinciden y se muestran los primeros. Escribí un poco más, o elegí una herramienta arriba.`}
            </Text>
          ) : null}

          {pedirBusqueda ? (
            <Aviso tono="info">
              Elegí una herramienta arriba para ver todo su stock, o buscá por código o nombre.
            </Aviso>
          ) : null}

          {fallo && !buscando ? (
            <>
              <Aviso tono="atencion" titulo="No pudimos consultar el stock">
                {fallo}
                {'\n\n'}Revisá la señal y tocá Reintentar.
              </Aviso>
              <Pressable
                onPress={() => setReintento((n) => n + 1)}
                accessibilityRole="button"
                style={({ pressed }) => [estilos.salida, pressed && estilos.tocada]}
              >
                <Text style={estilos.salidaTexto}>↻ REINTENTAR</Text>
              </Pressable>
            </>
          ) : null}

          {sinResultados ? (
            <Aviso tono="atencion">
              No hay ninguna herramienta con eso. Probá con menos letras, o con parte del nombre en vez del código.
            </Aviso>
          ) : null}
        </ScrollView>
      </Panel>
    </Pantalla>
  )
}

/** Un chip del filtro de herramientas. */
function Chip({ texto, activo, alTocar }: { texto: string; activo: boolean; alTocar: () => void }) {
  const estilos = usarEstilos()
  return (
    <Pressable
      onPress={alTocar}
      accessibilityRole="button"
      accessibilityState={{ selected: activo }}
      hitSlop={{ top: 8, bottom: 8 }}
      style={({ pressed }) => [estilos.chip, activo && estilos.chipActivo, pressed && estilos.tocada]}
    >
      <Text style={[estilos.chipTexto, activo && estilos.chipTextoActivo]}>{texto}</Text>
    </Pressable>
  )
}

/**
 * Una fila de la lista: código corto + medida a la izquierda, el estado de
 * stock (cantidad y color) a la derecha. Sin precio, y no se toca.
 */
function FilaStock({ articulo, prefijo }: { articulo: ArticuloCatalogo; prefijo: string }) {
  const estilos = usarEstilos()
  const c: CaracteristicasArticulo = caracteristicasDeArticulo(articulo.descripcion, articulo.medida)
  const compacto = resumenCompacto(c)
  const codigoCorto =
    prefijo && articulo.codigo.startsWith(prefijo) ? articulo.codigo.slice(prefijo.length) : articulo.codigo

  // Mismo semáforo de la venta (`nivelDeStock`), pero la cantidad EXACTA se
  // muestra sólo cuando quedan pocas (amarillo); en verde alcanza con saber que
  // hay, sin el número. Lo no trackeado (stock null) no tiene nivel: sale como
  // "—" gris —ni verde ni dato inventado—. El color sale del tema, no de un hex
  // fijo, para que el modo oscuro use su propia paleta igual que la venta.
  const nivel = articulo.stock == null ? 'neutro' : nivelDeStock(articulo.stock)
  const agotado = nivel === 'agotado'
  const estiloColor =
    nivel === 'agotado'
      ? estilos.textoAgotado
      : nivel === 'bajo'
        ? estilos.textoBajo
        : nivel === 'ok'
          ? estilos.textoOk
          : estilos.textoNeutro
  const textoStock =
    articulo.stock == null
      ? '—'
      : agotado
        ? 'SIN STOCK'
        : nivel === 'bajo'
          ? `Quedan ${articulo.stock}`
          : 'Hay'

  return (
    <View style={[estilos.fila, agotado && estilos.filaAgotada]}>
      <View style={estilos.filaCabecera}>
        {/* El código se tiñe sólo cuando hay que avisar (poco / agotado); con
            stock normal o sin dato conserva su color. El badge siempre lleva el
            color del nivel. */}
        <Text style={[estilos.codigo, (nivel === 'bajo' || agotado) && estiloColor]} numberOfLines={1}>
          {codigoCorto}
          {compacto ? <Text style={estilos.medida}>{`  ${compacto}`}</Text> : null}
        </Text>
        <Text style={[estilos.badge, estiloColor]}>{textoStock}</Text>
      </View>
      <Text style={estilos.descripcion} numberOfLines={1}>
        {articulo.descripcion}
      </Text>
    </View>
  )
}

/** "Ø250 Z80" — la medida en corto. */
function resumenCompacto(c: CaracteristicasArticulo): string {
  return [
    c.diametro_exterior ? `Ø${c.diametro_exterior}` : null,
    c.dientes ? `Z${c.dientes}` : null,
    c.ancho_corte ? `${c.ancho_corte}mm` : null,
  ]
    .filter(Boolean)
    .join(' ')
}

/** Filtra la familia ya bajada por el texto tecleado, en el teléfono. */
function filtrarFamilia(base: ArticuloCatalogo[], texto: string): ArticuloCatalogo[] {
  const t = texto.trim().toLowerCase()
  if (!t) return base
  const coincide = base.filter(
    (a) => a.codigo.toLowerCase().includes(t) || (a.descripcion ?? '').toLowerCase().includes(t),
  )
  return coincide.sort(
    (a, b) => (a.codigo.toLowerCase() === t ? 0 : 1) - (b.codigo.toLowerCase() === t ? 0 : 1),
  )
}

/** El prefijo de familia común ("LU3F ") para mostrar el código corto. */
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
  controles: {
    paddingHorizontal: espaciado.base,
    paddingTop: espaciado.sm,
    paddingBottom: espaciado.sm,
    gap: espaciado.sm,
    backgroundColor: t.colores.panelClaro,
    borderBottomWidth: 2,
    borderBottomColor: t.colores.borde,
  },
  chips: { gap: espaciado.xs, paddingVertical: 2 },
  chip: {
    // 44 de alto + hitSlop en el Pressable para acercarse al piso táctil propio
    // del sistema de diseño (TOQUE_MINIMO = 56), sin agrandar visualmente la pastilla.
    minHeight: 44,
    paddingHorizontal: espaciado.md,
    borderRadius: radios.pastilla,
    borderWidth: 1.5,
    borderColor: t.colores.panelOscuro,
    backgroundColor: t.colores.campoBlanco,
    justifyContent: 'center',
  },
  chipActivo: {
    borderColor: t.colores.verdeOscuro,
    backgroundColor: t.colores.verdeOscuro,
  },
  chipTexto: {
    fontFamily: t.tipografia.familia.subtitulo,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.tinta,
    letterSpacing: 0.3,
  },
  chipTextoActivo: { color: t.colores.blanco },
  tocada: { opacity: 0.7 },

  // Sin fondo propio: el área de la lista muestra el gris del panel, y la lista
  // (campoBlanco) flota encima. Con el rojo de la marca (`fondo`) quedaría un
  // rectángulo rojo adentro del panel.
  listaScroll: { flex: 1 },
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
    minHeight: 58,
    justifyContent: 'center',
    gap: 2,
  },
  filaAgotada: {
    opacity: 0.6,
    backgroundColor: 'rgba(224,27,36,0.08)',
  },
  filaCabecera: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: espaciado.sm },
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
  badge: {
    fontFamily: t.tipografia.familia.fuerte,
    fontSize: t.tipografia.tamano.sm,
  },
  // Los colores del semáforo salen del tema, no de un hex: el modo oscuro aclara
  // estos mismos tonos para que se lean sobre el panel negro (igual que la venta).
  textoOk: { color: t.colores.verdeOscuro },
  textoBajo: { color: t.colores.ambarOscuro },
  textoAgotado: { color: t.colores.rojoAccion },
  textoNeutro: { color: t.colores.tintaTenue },
  descripcion: {
    fontFamily: t.tipografia.familia.cuerpo,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.tintaSuave,
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
}))
