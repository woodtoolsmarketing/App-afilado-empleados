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
import { useEffect, useState } from 'react'
import { ActivityIndicator, FlatList, Pressable, ScrollView, Text, View } from 'react-native'

import { Aviso, Cargando } from '../componentes/Estado'
import { Campo } from '../componentes/Formulario'
import { Encabezado } from '../componentes/Encabezado'
import { BarraPanel, Pantalla, Panel } from '../componentes/Pantalla'
import { buscarArticulos, FAMILIA_COMPLETA, type ArticuloCatalogo } from '../servicios/notasPedido'
import { hojaDeTema, usarTema } from '../nucleo/tema'
import type { PropsPantalla } from '../navegacion/tipos'

/**
 * STOCK DISPONIBLE — el vendedor mira si una herramienta hay en stock, sin
 * armar una nota ni ver precios.
 *
 * Es el MISMO semáforo del buscador de la venta (verde con de sobra, amarillo
 * con pocas, rojo si está agotado), de sólo lectura: nada de precios y la fila
 * no se toca. La cantidad exacta se muestra SÓLO cuando quedan pocas (amarillo):
 * en verde alcanza con saber que hay, sin dar el número.
 *
 * Al entrar (chip TODAS) se precargan TODAS las familias de herramienta juntas
 * y se muestran de una: el vendedor abre la pantalla y ve el stock, sin tener
 * que buscar ni elegir nada. Elegir un chip la acota a esa familia. El buscador
 * filtra en el teléfono sobre lo ya bajado, así que responde al instante. Como
 * el catálogo entero se corta en 1000 y una familia (sierra sin fin) quedaría
 * afuera de ese corte, se baja una consulta POR FAMILIA (cada una entra
 * completa) en vez de una sola "sin familia".
 *
 * El stock que la oficina no trackea (sin fila cargada) sale como "—": en la
 * venta eso iría verde (se ofrece igual), pero acá, donde la pregunta es
 * "¿cuánto hay?", decir "no hay dato" es más honesto que pintarlo de verde.
 *
 * La lista va en un FlatList (no un ScrollView con `.map`): con TODAS son ~1000
 * filas y renderizarlas todas de golpe congelaría el teléfono; el FlatList
 * dibuja sólo las que se ven.
 */
const HERRAMIENTAS: Herramienta[] = HERRAMIENTAS_POR_SERVICIO.venta

export function PantallaStockDisponible({ navigation }: PropsPantalla<'StockDisponible'>) {
  const { colores } = usarTema()
  const estilos = usarEstilos()

  /** La herramienta elegida en los chips; `null` = TODAS. */
  const [herramienta, setHerramienta] = useState<Herramienta | null>(null)
  const [consulta, setConsulta] = useState('')
  /**
   * Lo que se bajó para el chip activo: una familia, o TODAS las familias
   * juntas. `null` mientras no llegó. El buscador filtra sobre esto en el
   * teléfono.
   */
  const [base, setBase] = useState<ArticuloCatalogo[] | null>(null)
  const [cargando, setCargando] = useState(false)
  const [fallo, setFallo] = useState<string | null>(null)
  const [reintento, setReintento] = useState(0)

  const familia = herramienta ? FAMILIA_PRODUCTO[herramienta] : null
  const texto = consulta.trim()

  // ── Precarga (una vez por chip): la familia elegida, o TODAS juntas ──────────
  // Con un chip, su familia. Con TODAS, una consulta POR familia en paralelo y se
  // concatenan: así entra cada familia completa (la "sin familia" se corta en
  // 1000 y dejaría afuera a sierra sin fin). Se baja una vez y el resto filtra
  // local.
  useEffect(() => {
    let cancelado = false
    setBase(null)
    setCargando(true)
    setFallo(null)
    const promesa =
      familia !== null
        ? buscarArticulos('', familia, FAMILIA_COMPLETA)
        : Promise.all(
            HERRAMIENTAS.map((h) => buscarArticulos('', FAMILIA_PRODUCTO[h], FAMILIA_COMPLETA)),
          ).then((porFamilia) => porFamilia.flat())
    promesa
      .then((todos) => {
        if (!cancelado) setBase(todos)
      })
      .catch((e) => {
        if (!cancelado) {
          setBase([])
          setFallo((e as Error).message)
        }
      })
      .finally(() => {
        if (!cancelado) setCargando(false)
      })
    return () => {
      cancelado = true
    }
  }, [familia, reintento])

  const lista = filtrarFamilia(base ?? [], texto)
  const prefijo = prefijoComun(lista.map((a) => a.codigo))
  // Cargó y no hay nada: sólo cuando el filtro de texto no encontró nada (con
  // texto vacío la base nunca es vacía). Mientras `base` es null (bajando) o
  // `cargando`, no se afirma "no hay".
  const sinResultados = !cargando && !fallo && base !== null && lista.length === 0

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
            accesorio={cargando ? <ActivityIndicator size="small" color={colores.rojo} /> : undefined}
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

        {/* La lista en un FlatList (virtualizado): con TODAS son ~1000 filas y un
            ScrollView las dibujaría todas de golpe. La "caja" con borde la envuelve
            y el FlatList scrollea adentro. */}
        <View style={estilos.listaCaja}>
          <FlatList
            data={lista}
            style={estilos.flat}
            keyExtractor={(a) => `${a.codigo}|${a.descripcion}`}
            renderItem={({ item }) => <FilaStock articulo={item} prefijo={prefijo} />}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={lista.length === 0 ? estilos.cuerpoVacio : undefined}
            ListEmptyComponent={
              cargando ? (
                <Cargando texto="Buscando…" />
              ) : fallo ? (
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
              ) : sinResultados ? (
                <Aviso tono="atencion">
                  No hay ninguna herramienta con eso. Probá con menos letras, o con parte del nombre
                  en vez del código.
                </Aviso>
              ) : null
            }
          />
        </View>
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

/** Filtra lo ya bajado por el texto tecleado, en el teléfono. */
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

  // La caja con borde que envuelve la lista: ocupa el alto que queda (flex:1) y
  // el FlatList scrollea adentro. El margen la separa de los controles y del pie.
  // Sin fondo rojo de marca: la lista (campoBlanco) flota sobre el gris del panel.
  listaCaja: {
    flex: 1,
    margin: espaciado.base,
    borderWidth: 2,
    borderColor: t.colores.borde,
    borderRadius: radios.sm,
    backgroundColor: t.colores.campoBlanco,
    overflow: 'hidden',
  },
  // Cuando la lista está vacía (cargando / sin resultados / error), el contenido
  // del FlatList necesita su propio padding, que las filas ya traen.
  // El FlatList tiene que llenar la caja (flex:1) para tener altura acotada y
  // poder scrollear; sin esto se recorta al contenido.
  flat: { flex: 1 },
  cuerpoVacio: { padding: espaciado.base, gap: espaciado.sm },

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
