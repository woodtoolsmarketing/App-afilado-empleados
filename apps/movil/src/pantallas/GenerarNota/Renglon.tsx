import {
  agujeroDelRenglon,
  aNumero,
  caracteristicasDeArticulo,
  esSinCargo,
  ETIQUETA_CUCHILLA_MATERIAL,
  ETIQUETA_CUCHILLA_TIPO,
  ETIQUETA_SIERRA_CLASE,
  QUE_ES_EL_DISCO,
  ETIQUETA_CUCHILLA_TRABAJO,
  totalAfiladoCuchilla,
  TRAMO_CUCHILLA_MM,
  type CuchillaMaterial,
  type CuchillaTipo,
  type SierraClase,
  type CuchillaTrabajo,
  CAMPOS_POR_HERRAMIENTA,
  describirRango,
  descripcionSugerida,
  dientesAAfilar,
  esDescripcionSugerida,
  espaciado,
  ETIQUETA_HERRAMIENTA,
  ETIQUETA_MATERIAL_MECHA,
  ETIQUETA_TIPO_MECHA,
  formatearMedida,
  formatearPesos,
  medidasDeLaCuchilla,
  HERRAMIENTAS_POR_SERVICIO,
  lineasDelRenglon,
  maquinasDeLaHerramienta,
  MAQUINA_SUGERIDA,
  MECHAS_CON_MANO,
  MEDIDA_PARA_CODIGO,
  normalizarMedida,
  radios,
  SINGULAR_HERRAMIENTA,
  soloNumeros,
  codigoAfiladoMecha,
  DIENTES_MECHA_INTEGRAL,
  materialFijoDeLaMecha,
  medidasDelTipoDePieza,
  pideDientesLaMecha,
  tipoDePieza,
  tiposDePieza,
  totalAfiladoMecha,
  totalDeListaDelRenglon,
  unaPieza,
  type CampoItem,
  type FormularioItemNota,
  type Herramienta,
  type ManoMecha,
  type MaterialMecha,
  type TipoMecha,
  type TipoServicio,
} from '@woodtools/compartido'
import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, Text, View } from 'react-native'

import {
  Campo,
  CampoConOpciones,
  Casilla,
  Desplegable,
  MensajeError,
} from '../../componentes/Formulario'
import { Aviso, Pastilla } from '../../componentes/Estado'
import { preciosEspecialesDe } from '../../servicios/notasPedido'
import { CampoDescuento } from './Descuento'
import {
  agujeroDeFabrica,
  codigosAfiladoCuchilla,
  codigosAfiladoMecha,
  mechasDelTipo,
  codigosSinRango,
  medidasDisponibles,
  medidasEnCascada,
  type ArticuloConMedidas,
  type CascadaMedidas,
  type CodigoAfiladoMecha,
  type CodigoCuchilla,
  resolverCodigoDeItem,
  type CodigoComputo,
  type ModeloMecha,
} from '../../servicios/notasPedido'
import { hojaDeTema, usarTema } from '../../nucleo/tema'

/**
 * Un renglón de la nota.
 *
 * Qué campos se dibujan lo decide `CAMPOS_POR_HERRAMIENTA`, la misma tabla que
 * usa el validador. Así no puede pasar que la pantalla muestre un campo que el
 * validador ignora, ni que exija uno que nunca se mostró.
 *
 * El código de cómputo y el precio se buscan solos apenas hay medida: es la
 * parte que le saca al vendedor tener que acordarse de mil códigos parado en un
 * taller.
 */

/**
 * Los rótulos de los campos.
 *
 * Las medidas llevan la unidad puesta. Todas son milímetros y siempre lo
 * fueron, pero el rótulo no lo decía: el vendedor lo veía recién después de
 * escribir, en la ayudita de abajo que repite "42 mm". Con la unidad en la
 * pregunta se sabe antes de tipear, que es cuando hace falta.
 */
const ETIQUETAS: Record<CampoItem, string> = {
  sierra_clase: '¿SIERRA O INCISOR?',
  cantidad: 'CANTIDAD',
  diametro_exterior: 'DIÁMETRO EXTERIOR (mm)',
  diametro_interior: 'DIÁMETRO INTERIOR (mm, OPCIONAL)',
  diametro: 'DIÁMETRO (mm)',
  ancho_corte: 'ANCHO DE CORTE (mm)',
  largo: 'LARGO (mm)',
  ancho: 'ANCHO (mm)',
  largo_util: 'LARGO ÚTIL (mm)',
  largo_rebajado: '¿A QUÉ LARGO SE REBAJA? (mm)',
  espesor: 'ESPESOR (mm)',
  paso: 'PASO (mm)',
  descripcion: 'DESCRIPCIÓN',
  cantidad_dientes: 'CANTIDAD DE DIENTES A AFILAR',
  tipo_pieza: 'TIPO DE PIEZA',
  tipo_mecha: 'TIPO DE MECHA',
  mano: '¿ES DERECHA O IZQUIERDA?',
  dientes_rotos: '¿TIENE DIENTES ROTOS?',
  dientes_rotos_cantidad: '¿CUÁNTOS DIENTES ROTOS?',
  reparar_dientes: '¿DESEA REPARAR LOS DIENTES?',
  rascadores: '¿CUÁNTOS RASCADORES?',
  afilado_reparacion: '¿AFILADO / REPARACIÓN?',
  codigos_computo: 'CÓDIGO DE CÓMPUTO',
  precio_por_diente: 'PRECIO POR DIENTE',
  precio_total: 'PRECIO TOTAL',
}

/**
 * Junta los campos numéricos cortos consecutivos de a dos, para que entren en
 * una fila. Cada elemento del resultado es o un campo suelto o un par.
 *
 * Se agrupan sólo los cortos y sólo si son consecutivos: así el orden que
 * define `CAMPOS_POR_HERRAMIENTA` se mantiene, y en particular el bloque de
 * códigos sigue cayendo justo después de la medida que lo dispara.
 */
function agruparPares(campos: CampoItem[]): Array<CampoItem | [CampoItem, CampoItem]> {
  const salida: Array<CampoItem | [CampoItem, CampoItem]> = []
  for (let i = 0; i < campos.length; i++) {
    const actual = campos[i]
    const siguiente = campos[i + 1]
    if (CORTOS.has(actual) && siguiente && CORTOS.has(siguiente)) {
      salida.push([actual, siguiente])
      i++
    } else {
      salida.push(actual)
    }
  }
  return salida
}

/** Numéricos de pocos caracteres: entran holgados de a dos por fila. */
const CORTOS = new Set<CampoItem>([
  'cantidad', 'diametro_exterior', 'diametro', 'ancho_corte', 'largo', 'ancho',
  'largo_util', 'espesor', 'paso', 'cantidad_dientes',
])

/**
 * Herramientas cuyo catálogo no tiene un solo código con rango de medida.
 *
 * Medido sobre las listas: mechas 0 de 181, cuchillas 0 de 143. El afilado de
 * mechas se cotiza por tipo y cantidad de filos, y la lista de cuchillas es un
 * catálogo de producto, no de servicio. Buscar por medida ahí no devuelve nada
 * y nunca va a devolver nada.
 */
const SIN_RANGOS = new Set<Herramienta>(['mecha', 'cuchilla'])

/** Los campos que son una medida en milímetros, no una cantidad ni un precio. */
const MEDIDAS = new Set<CampoItem>([
  'diametro_exterior', 'diametro', 'ancho_corte', 'largo', 'ancho',
  'largo_util', 'espesor', 'paso',
])

/**
 * Los campos que participan de la cascada de medidas.
 *
 * Son los mismos nombres que las columnas de `catalogo_medidas`: los dos
 * vocabularios tienen que seguir coincidiendo, porque la base devuelve las
 * opciones indexadas por el nombre del campo del formulario.
 *
 * `cantidad_dientes` entra aunque no sea un milímetro —es justamente la
 * pregunta del ejemplo: elegido el diámetro, cuántos dientes hay— y `cantidad`
 * no, porque es cuántas trajo el cliente y no una característica de la pieza.
 */
const CAMPOS_CASCADA: CampoItem[] = [
  'diametro_exterior', 'diametro', 'ancho_corte', 'diametro_interior',
  'cantidad_dientes', 'largo', 'ancho', 'espesor', 'paso', 'largo_util',
]

const CASCADA_VACIA: CascadaMedidas = { total: 0, opciones: {}, articulos: [] }

/** El rótulo de "cantidad de dientes" cambia según el servicio. */
function etiquetaDientes(servicio: TipoServicio): string {
  if (servicio === 'reparacion') return 'CANTIDAD DE DIENTES A REPARAR'
  if (servicio === 'rectificado') return 'CANTIDAD DE DIENTES A RECTIFICAR'
  if (servicio === 'hermanado') return 'CANTIDAD DE DIENTES A HERMANAR'
  return 'CANTIDAD DE DIENTES A AFILAR'
}

function etiquetaSiNo(campo: CampoItem, servicio: TipoServicio): string {
  if (campo === 'dientes_rotos') {
    return servicio === 'reparacion' ? '¿TIENE DIENTES DESAFILADOS?' : '¿TIENE DIENTES ROTOS?'
  }
  return ETIQUETAS[campo]
}

export function PasoRenglon({
  item,
  alCambiar,
  errores,
  clienteId,
}: {
  item: FormularioItemNota
  alCambiar: (cambios: Partial<FormularioItemNota>) => void
  errores: Record<string, string | undefined>
  /** Para pisar el precio de lista con el acordado con este cliente. */
  clienteId?: string | null
}) {
  const { colores } = usarTema()
  const estilos = usarEstilos()
  /**
   * El precio acordado con el cliente, si tiene uno para este código.
   *
   * Se aplica DESPUÉS de que el código fija el precio de lista, no en su lugar.
   * Así el renglón nunca queda sin precio si la consulta falla: en el peor caso
   * cobra la lista, que es lo que hacía hasta ayer, y no cero.
   *
   * Se vuelve a mirar cada vez que cambia el código o el cliente. Cambiar el
   * cliente en el medio de la carga es normal —se empieza la nota y después se
   * lo elige— y el precio tiene que seguirlo.
   */
  /**
   * El precio acordado, y PARA QUÉ CÓDIGO se acordó.
   *
   * El código no es un adorno: la búsqueda de código vuelve a correr cada vez
   * que cambia una medida y reescribe el precio con el de lista. Si el código
   * que resuelve es el mismo, hay que volver a imponer el acordado, y para
   * saber que es el mismo hace falta tenerlo guardado al lado del importe.
   */
  const [precioAcordado, setPrecioAcordado] = useState<{
    codigo: string
    precio: number
  } | null>(null)

  useEffect(() => {
    const codigos = item.codigos_computo.filter(Boolean)
    if (!clienteId || codigos.length === 0) {
      setPrecioAcordado(null)
      return
    }
    let cancelado = false
    void preciosEspecialesDe(clienteId, codigos)
      .then((acordados) => {
        if (cancelado) return
        const suyo = acordados.find((a) => a.codigo === codigos[0])
        setPrecioAcordado(suyo ? { codigo: suyo.codigo, precio: suyo.precio } : null)
        if (suyo && Math.abs(aNumero(item.precio_por_diente) - suyo.precio) > 0.005) {
          alCambiar({ precio_por_diente: String(suyo.precio) })
        }
      })
      .catch(() => {
        // Sin respuesta se cobra la lista. Callado: el vendedor está en la
        // calle y un cartel de error acá no le da nada que hacer.
        if (!cancelado) setPrecioAcordado(null)
      })
    return () => {
      cancelado = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clienteId, item.codigos_computo.join(',')])
  const [codigos, setCodigos] = useState<CodigoComputo[]>([])
  const [buscando, setBuscando] = useState(false)
  const [sinCodigo, setSinCodigo] = useState(false)
  /** Qué medidas siguen siendo posibles según lo que ya se completó. */
  const [cascada, setCascada] = useState<CascadaMedidas>(CASCADA_VACIA)
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null)
  /**
   * El último código que propusimos solos. Sirve para distinguir "lo puso el
   * buscador" de "lo eligió el vendedor": lo primero se puede pisar cuando
   * cambia la medida, lo segundo no.
   */
  const propuesto = useRef<string | null>(null)

  const herramientas = HERRAMIENTAS_POR_SERVICIO[item.servicio]
  const campos = item.herramienta ? CAMPOS_POR_HERRAMIENTA[item.herramienta] : []

  /**
   * El código elegido ya no está entre los que cubren la medida. Pasa al
   * volver a un renglón cargado y corregirle el ancho: la elección manual no
   * se pisa sola, pero quedarse callados dejaría un precio que no corresponde.
   */
  const codigoDesactualizado =
    codigos.length > 0 &&
    item.codigos_computo.length > 0 &&
    !item.codigos_computo.some((c) => codigos.some((x) => x.codigo === c))

  // Con una sola herramienta posible (hermanado → incisores, rebaje →
  // cuchillas) se elige sola: no hay nada que decidir.
  useEffect(() => {
    if (herramientas.length === 1 && item.herramienta !== herramientas[0]) {
      alCambiar({ herramienta: herramientas[0] })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.servicio])

  // ── La descripción se completa sola ──────────────────────────────────────
  //
  // "S.C." una sierra circular, "SSF" una sierra sin fin, y "nueva" cuando se
  // vende. Es lo que la fábrica lee para saber qué le llegó y se escribe
  // siempre igual; tipearlo a mano en cada renglón terminaba en "sierra",
  // "Sierra" y "SC" para la misma cosa.
  //
  // Sólo se pisa lo que pusimos nosotros: si el vendedor escribió algo suyo,
  // queda.
  useEffect(() => {
    if (!item.herramienta) return
    // `sierra_clase` está en las dependencias porque un incisor se anuncia
    // "Incisor" y no "S.C.": contestar el desplegable rehace la descripción.
    const sugerida = descripcionSugerida(item.herramienta, item.servicio, item.sierra_clase)
    if (item.descripcion !== sugerida && esDescripcionSugerida(item.descripcion)) {
      alCambiar({ descripcion: sugerida })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.herramienta, item.servicio, item.sierra_clase])

  // ── La máquina se propone sola ───────────────────────────────────────────
  //
  // Cada familia de herramienta va casi siempre a la misma máquina, así que se
  // propone ésa y el vendedor la cambia si el cliente la usa en otra. Sólo se
  // completa cuando está vacía: lo que él eligió no se pisa.
  useEffect(() => {
    if (!item.herramienta || item.maquina.trim()) return
    const sugerida = MAQUINA_SUGERIDA[item.herramienta]
    if (sugerida) alCambiar({ maquina: sugerida })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.herramienta])

  // ── Medidas en cascada ───────────────────────────────────────────────────
  //
  // Las medidas de una herramienta no son libres: una sierra de 300 mm existe
  // con 96 o 72 dientes, no con cualquiera. Cada vez que el vendedor completa
  // una, se le pregunta al catálogo qué sigue siendo posible en las otras.
  //
  // Se manda TODO lo que hay escrito, no sólo el último campo: el vendedor
  // completa en el orden que se acuerda, y cualquier combinación tiene que
  // achicar igual.
  const filtrosCascada: Record<string, string> = {}
  for (const campo of CAMPOS_CASCADA) {
    const v = ((item as unknown as Record<string, string>)[campo] ?? '').trim()
    if (v) filtrosCascada[campo] = v
  }
  /**
   * ¿Ya hay al menos una medida cargada?
   *
   * Se mira ANTES de sumar la mano, que no es una medida: una mecha derecha
   * sigue siendo "todas las derechas" y contarla como filtro haría aparecer el
   * cartel con 68 coincidencias sin que el vendedor haya elegido nada.
   */
  const hayMedidaCargada = Object.keys(filtrosCascada).length > 0

  if (item.mano) filtrosCascada.mano = item.mano === 'derecha' ? 'derecha' : 'izquierda'

  /*
    El TIPO DE PIEZA también achica, y va después de `hayMedidaCargada` por lo
    mismo que la mano: no es una medida.

    `catalogo_medidas` guarda el tipo en `geometria` con los mismos valores que
    el desplegable, y `medidas_en_cascada` ya sabía filtrar por ahí — la
    pantalla era la que no se lo mandaba. Sin esto, elegir CABEZAL CEPILLADOR y
    abrir el ancho de corte listaba los 59 cabezales del catálogo en vez de los
    7 que son cepilladores.

    Donde la geometría no está cargada no cambia nada: el filtro no encuentra
    filas y la cascada devuelve lo de siempre. Hoy la tienen 38 de 59 cabezales
    y 1 de 325 fresas, así que en las fresas todavía no se va a notar.
  */
  if (item.tipo_pieza) filtrosCascada.geometria = item.tipo_pieza

  const claveCascada = `${item.herramienta ?? ''}|${JSON.stringify(filtrosCascada)}`

  useEffect(() => {
    if (!item.herramienta) {
      setCascada(CASCADA_VACIA)
      return
    }
    let vigente = true
    const t = setTimeout(() => {
      medidasEnCascada(item.herramienta!, filtrosCascada)
        .then((r) => {
          if (vigente) setCascada(r)
        })
        .catch(() => undefined)
    }, 250)
    return () => {
      vigente = false
      clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claveCascada])

  /**
   * El agujero de fábrica, sacado de la cascada.
   *
   * Ya se buscaba antes leyendo el "d=30" de la descripción de la lista de
   * precios, pero eso sólo acertaba cuando coincidían diámetro, ancho Y
   * dientes: con el diámetro solo no encontraba nada y el aviso "De fábrica"
   * no aparecía nunca. Acá el dato viene separado en su propia columna, así
   * que en cuanto las medidas cargadas dejan un solo agujero posible, ése es.
   *
   * Cuando quedan varios no se pone ninguno, que es lo honesto: el agujero es
   * contra lo que se compara para saber si la pieza fue agrandada o lleva buje,
   * y poner uno a medias haría aparecer un aviso equivocado.
   */
  const agujerosPosibles = cascada.opciones.diametro_interior ?? []

  useEffect(() => {
    if (!campos.includes('diametro_interior')) return
    if (agujerosPosibles.length !== 1) return

    const deCatalogo = String(agujerosPosibles[0].valor).replace('.', ',')
    if (deCatalogo !== item.diametro_interior_catalogo) {
      alCambiar({ diametro_interior_catalogo: deCatalogo })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agujerosPosibles.length, agujerosPosibles[0]?.valor, item.diametro_interior_catalogo])

  // ── Búsqueda automática del código de cómputo ───────────────────────────
  const medidaClave = [item.ancho_corte, item.ancho, item.diametro].join('|')

  useEffect(() => {
    if (temporizador.current) clearTimeout(temporizador.current)
    if (!item.herramienta) return

    temporizador.current = setTimeout(async () => {
      setBuscando(true)
      setSinCodigo(false)
      try {
        const encontrados = await resolverCodigoDeItem(item)
        if (encontrados === null) {
          setCodigos([])
          return
        }
        setCodigos(encontrados)
        if (encontrados.length === 0) {
          setSinCodigo(true)
          return
        }
        // El más ajustado es el primero: se propone ese y el vendedor puede
        // cambiarlo si el trabajo es otro. Sólo se pisa lo que pusimos
        // nosotros — una elección manual se respeta aunque cambie la medida.
        const elegidos = item.codigos_computo
        const intocado =
          elegidos.length === 0 ||
          (elegidos.length === 1 && elegidos[0] === propuesto.current)
        if (!intocado) return

        const mejor = encontrados[0]
        propuesto.current = mejor.codigo

        /**
         * El precio que se escribe: el acordado con este cliente si lo hay,
         * y si no el de lista.
         *
         * Esto NO es una comodidad. Esta búsqueda se vuelve a disparar con
         * cada medida que se corrige, y muchas veces resuelve el mismo código
         * —cambiar el ancho de 2,5 a 2,6 no sale del rango 1,5–3,5—. Cuando
         * eso pasa, `item.codigos_computo` no cambia, así que el efecto que
         * trae el precio acordado NO vuelve a correr: se quedaba el de lista
         * escrito y el cartel verde de abajo seguía diciendo "se está usando
         * $ 190,51" sobre un renglón cotizado a $ 248,85. La nota se emitía
         * con un 30 % de más y nadie lo veía.
         *
         * Se compara el código porque el acordado es de un código, no del
         * cliente: si la medida nueva resuelve OTRO código, el acordado que
         * está en memoria no es suyo y manda la lista.
         */
        const acordadoDeEsteCodigo =
          precioAcordado && precioAcordado.codigo === mejor.codigo ? precioAcordado.precio : null

        alCambiar({
          codigos_computo: [mejor.codigo],
          // Un código a cotizar no trae importe: el campo queda para que lo
          // ponga el vendedor, en vez de heredar el precio de otro código.
          ...(mejor.a_cotizar
            ? { precio_por_diente: '' }
            : acordadoDeEsteCodigo !== null
              ? { precio_por_diente: String(acordadoDeEsteCodigo) }
              : mejor.precio_pesos !== null
                ? { precio_por_diente: String(mejor.precio_pesos) }
                : {}),
          sin_cargo: esSinCargo(mejor.descripcion),
        })
      } catch {
        setCodigos([])
      } finally {
        setBuscando(false)
      }
      // 250 ms y no 400: el código es la respuesta a la medida que se acaba de
      // tipear y ahora se dibuja justo debajo, así que la espera se nota.
    }, 250)

    return () => {
      if (temporizador.current) clearTimeout(temporizador.current)
    }
    // Los dientes rotos y su reparación entran en las dependencias porque
    // cambian QUÉ código corresponde —afilado, REP.PARCIAL o REP.TOTAL— y no
    // sólo su precio. Sin esto, contestar "sí, repararlos" dejaba puesto el
    // código de la reparación parcial.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // `precioAcordado` entra en las dependencias: sin él, el efecto se queda
    // con el valor del render en que se armó y vuelve a escribir la lista.
  }, [medidaClave, item.herramienta, item.dientes_rotos, item.reparar_dientes, precioAcordado])

  // ── Precio total ─────────────────────────────────────────────────────────
  //
  // La cuenta vive en el paquete compartido: dientes × cantidad, menos los
  // rotos, más la reparación si la pidieron. Acá sólo se refleja el resultado.
  useEffect(() => {
    if (!campos.includes('precio_por_diente') || !campos.includes('cantidad_dientes')) return
    // A precio de LISTA. Este campo tambien es entrada en las herramientas que
    // no se cobran por diente: escribirle el total ya descontado haria que la
    // vuelta siguiente lo tomara como precio de lista y descontara otra vez.
    const total = totalDeListaDelRenglon(item)
    const actual = aNumero(item.precio_total)
    if (total > 0 && Math.abs(total - actual) > 0.005) {
      alCambiar({ precio_total: String(total) })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    item.precio_por_diente,
    item.cantidad_dientes,
    item.cantidad,
    item.herramienta,
    item.dientes_rotos,
    item.dientes_rotos_cantidad,
    item.reparar_dientes,
    item.precio_reparacion_por_diente,
    item.rascadores,
    item.precio_rascador_unitario,
  ])

  // ── El código de cómputo del afilado de los rascadores ───────────────────
  //
  // El rascador se afila con su propio código y a su propio precio: $ 319,95 el
  // de 30mm contra $ 248,85 el diente. Se busca solo apenas ponen cuántos hay.
  //
  // Se propone el de 30mm porque es el que llevan casi todas; el de 60mm es de
  // metal duro y va en las que lo tienen. El vendedor corrige el precio si la
  // pieza es de las otras.
  const [buscandoRascador, setBuscandoRascador] = useState(false)
  const [sinCodigoRascador, setSinCodigoRascador] = useState(false)

  useEffect(() => {
    if (aNumero(item.rascadores) <= 0 || !item.herramienta) {
      setSinCodigoRascador(false)
      return
    }
    let cancelado = false
    setBuscandoRascador(true)
    setSinCodigoRascador(false)

    // No se busca por medida: el afilado del rascador no tiene rango, se
    // cotiza por largo. Por eso se piden los SIN rango y no `medidasDisponibles`,
    // que devuelve los que sí lo tienen y nunca llega hasta éste.
    void codigosSinRango(item.herramienta, 'afilado')
      .then((todos) => {
        if (cancelado) return
        /**
         * AFILADO de rascador, no cualquier cosa que diga "rascador".
         *
         * Con el mismo filtro salen también los AGREGADO RASCADOR —6005 y
         * 6006—, que son para PONERLE un rascador a la pieza y valen $ 92.153 y
         * $ 122.998. Si el de 30mm no apareciera y se cayera al primero de la
         * lista, cuatro rascadores se cobrarían $ 368.614 en vez de $ 1.279.
         * Ese error no lo ve nadie hasta que el cliente mira la factura.
         */
        const rascadores = todos.filter((c) => /AFILADO.*RASCADOR/i.test(c.descripcion))
        // El de 30mm primero: es el que llevan casi todas. El otro es de metal
        // duro y va en las que lo tienen.
        const mejor =
          rascadores.find((c) => /30\s*mm/i.test(c.descripcion)) ?? rascadores[0]
        if (!mejor) {
          setSinCodigoRascador(true)
          return
        }
        if (mejor.codigo === item.codigo_rascador) return
        alCambiar({
          codigo_rascador: mejor.codigo,
          precio_rascador_unitario:
            mejor.precio_pesos !== null ? String(mejor.precio_pesos) : '',
        })
      })
      .catch(() => {
        if (!cancelado) setSinCodigoRascador(true)
      })
      .finally(() => {
        if (!cancelado) setBuscandoRascador(false)
      })

    return () => {
      cancelado = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.rascadores, item.herramienta])

  // ── El código de cómputo de la reparación de los dientes rotos ───────────
  //
  // Es OTRO código y OTRO precio que el de la línea principal: mismo ancho de
  // corte, pero servicio "reparación". Se busca solo apenas contestan que sí,
  // para que el vendedor no tenga que salir a buscarlo a mano.
  const [buscandoReparacion, setBuscandoReparacion] = useState(false)
  const [sinCodigoReparacion, setSinCodigoReparacion] = useState(false)

  useEffect(() => {
    if (item.reparar_dientes !== true || !item.dientes_rotos) {
      setSinCodigoReparacion(false)
      return
    }
    let cancelado = false
    setBuscandoReparacion(true)
    setSinCodigoReparacion(false)

    void resolverCodigoDeItem(item, 'reparacion')
      .then((encontrados) => {
        if (cancelado) return
        if (!encontrados || encontrados.length === 0) {
          setSinCodigoReparacion(encontrados !== null)
          return
        }
        const mejor = encontrados[0]
        if (mejor.codigo === item.codigo_reparacion) return
        alCambiar({
          codigo_reparacion: mejor.codigo,
          precio_reparacion_por_diente:
            mejor.precio_pesos !== null ? String(mejor.precio_pesos) : '',
        })
      })
      .catch(() => {
        if (!cancelado) setSinCodigoReparacion(true)
      })
      .finally(() => {
        if (!cancelado) setBuscandoReparacion(false)
      })

    return () => {
      cancelado = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.reparar_dientes, item.dientes_rotos, medidaClave, item.herramienta])

  // ── El agujero de fábrica ────────────────────────────────────────────────
  //
  // La herramienta que trajo el cliente está en la lista de precios: se la
  // reconoce por el diámetro exterior y de ahí sale su agujero de fábrica. Es
  // contra ése que se compara el que carga el vendedor para saber si fue
  // agrandado o lleva buje reductor.
  //
  // Sólo se busca si el renglón pide diámetro interior, y nunca se pisa un
  // valor ya encontrado con uno vacío: perder la referencia mientras se
  // corrige una medida haría desaparecer el aviso.
  const [buscandoAgujero, setBuscandoAgujero] = useState(false)

  useEffect(() => {
    if (!campos.includes('diametro_interior') || !item.diametro_exterior.trim()) return

    let cancelado = false
    const reloj = setTimeout(() => {
      setBuscandoAgujero(true)
      void agujeroDeFabrica(item)
        .then((agujero) => {
          if (cancelado || !agujero) return
          if (agujero !== item.diametro_interior_catalogo) {
            alCambiar({ diametro_interior_catalogo: agujero })
          }
        })
        .catch(() => undefined)
        .finally(() => {
          if (!cancelado) setBuscandoAgujero(false)
        })
    }, 400)

    return () => {
      cancelado = true
      clearTimeout(reloj)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.diametro_exterior, item.ancho_corte, item.cantidad_dientes, item.herramienta])

  // ── "¿Qué medidas hay?" ──────────────────────────────────────────────────
  const [medidas, setMedidas] = useState<CodigoComputo[] | null>(null)
  const [verMedidas, setVerMedidas] = useState(false)

  useEffect(() => {
    if (!verMedidas || !item.herramienta || medidas) return
    void medidasDisponibles(item.herramienta, item.servicio)
      .then(setMedidas)
      .catch(() => setMedidas([]))
  }, [verMedidas, item.herramienta, item.servicio, medidas])

  useEffect(() => {
    setMedidas(null)
    setVerMedidas(false)
  }, [item.herramienta, item.servicio])

  /**
   * Tocar una medida de la lista carga su piso en el campo correspondiente.
   * Es la forma corta de "quiero ése": pone una medida que cae dentro del
   * rango y deja que el buscador haga el resto, en vez de que el vendedor
   * tenga que deducir qué número tipear.
   */
  function aplicarMedidaSugerida(m: CodigoComputo): void {
    if (!item.herramienta) return
    setVerMedidas(false)

    /*
      Sin rango no hay medida que cargar: el código SE ELIGE. Es el caso de
      mechas y cuchillas, donde el precio no depende de una medida.

      El importe va al campo que la herramienta usa de verdad. Iba siempre a
      PRECIO POR DIENTE, y las mechas, las cuchillas y las sierras sin fin no
      tienen ese campo —no se cobran por diente— así que el renglón quedaba con
      el código bien elegido y el precio en cero. En ésas el importe de la lista
      es por unidad y va a PRECIO TOTAL, multiplicado por las que sean.
    */
    if (m.rango_min === null) {
      propuesto.current = m.codigo
      const porDiente = campos.includes('precio_por_diente')
      const unidades = Math.max(1, aNumero(item.cantidad) || 1)
      const importe = m.precio_pesos !== null ? Number(m.precio_pesos) : null

      /*
        La cuchilla se cobra por cada 100 mm, no por unidad.

        Importa desde que los seis códigos de afilado de cuchilla aparecen en
        esta lista: multiplicar el precio de lista por las unidades cobraría
        $ 4.099,60 por cuchilla en vez de por tramo, y una de 640 mm son 6,4
        tramos. Es la misma cuenta que hace `SelectorAfiladoCuchilla`.
      */
      const total =
        importe === null
          ? 0
          : item.herramienta === 'cuchilla'
            ? totalAfiladoCuchilla(importe, aNumero(item.largo), unidades)
            : Math.round(importe * unidades * 100) / 100

      alCambiar({
        codigos_computo: [m.codigo],
        ...(m.a_cotizar
          ? porDiente
            ? { precio_por_diente: '' }
            : { precio_total: '' }
          : importe !== null
            ? porDiente
              ? { precio_por_diente: String(importe).replace('.', ',') }
              : {
                  precio_total: String(total).replace('.', ','),
                  // El servicio se cobra en pesos: `precio_pesos` ya viene
                  // convertido, y dejar la moneda en dólares lo volvería a
                  // convertir en la nota.
                  moneda: 'ARS' as const,
                }
            : {}),
        sin_cargo: esSinCargo(m.descripcion),
      })
      return
    }

    const campo = MEDIDA_PARA_CODIGO[item.herramienta]
    if (!campo) return
    alCambiar({
      [campo]: String(m.rango_min).replace('.', ','),
      codigos_computo: [],
    } as Partial<FormularioItemNota>)
  }

  /**
   * Completa el renglón con las medidas de una herramienta del catálogo.
   *
   * No toca la DESCRIPCIÓN a propósito: ésa es la del cliente —"marca, modelo,
   * estado"— y es lo único que el vendedor tiene que seguir escribiendo junto
   * con la cantidad. Pisarla con el texto de la lista de precios le borraría lo
   * que ya anotó.
   */
  function aplicarArticulo(articulo: ArticuloConMedidas) {
    const cambios: Record<string, string> = {}
    for (const campo of CAMPOS_CASCADA) {
      const v = articulo[campo]
      if (v === null || v === undefined) continue
      /**
       * El agujero del artículo es el DE FÁBRICA, no el que trajo el cliente.
       *
       * Escribirlo en el campo cargado dejaba el renglón diciendo "20" al lado
       * de una ayuda que dice "de fábrica 20, dejalo vacío si es ése". Peor
       * que confuso: el campo existe para avisar cuando la pieza tiene OTRO
       * agujero —agrandado, o con buje— y llenarlo solo con el de fábrica
       * borra esa distinción antes de que el vendedor la mire.
       */
      if (campo === 'diametro_interior') {
        cambios.diametro_interior_catalogo = String(v).replace('.', ',')
        continue
      }
      cambios[campo] = String(v).replace('.', ',')
    }
    if (typeof articulo.mano === 'string') cambios.mano = articulo.mano
    alCambiar(cambios as Partial<FormularioItemNota>)
  }

  /**
   * Elegir el tipo trae las medidas que el catálogo fija para ese tipo.
   *
   * No pisa lo que el vendedor escribió: sólo llena lo que está vacío y lo que
   * había puesto el tipo anterior. Así, corregir "FRESA RECTA" por "FRESA
   * ÁNGULO" cambia el diámetro que trajo el tipo equivocado, pero un ancho de
   * corte medido con el calibre se queda donde está.
   *
   * El diámetro interior va al campo del catálogo y no al de carga, igual que
   * cuando lo trae un artículo: el de carga significa "esta pieza tiene OTRO
   * agujero", y llenarlo con el de fábrica borra justamente esa distinción.
   */
  function elegirTipoDePieza(valor: string) {
    const antes = medidasDelTipoDePieza(item.herramienta, item.tipo_pieza)
    const ahora = medidasDelTipoDePieza(item.herramienta, valor)

    const cambios: Record<string, string> = {}
    for (const [campo, medida] of Object.entries(ahora)) {
      const puesto = (item as unknown as Record<string, string>)[campo] ?? ''
      if (puesto.trim() === '' || puesto === antes[campo]) cambios[campo] = medida
    }

    alCambiar({ ...cambios, tipo_pieza: valor } as Partial<FormularioItemNota>)
  }

  /**
   * El rótulo de un campo, que a veces depende del renglón.
   *
   * Vale para las dos ramas del dibujo —la de a pares y la suelta—. Si el
   * rótulo se resolviera sólo en la suelta, cualquiera que dependa del renglón
   * se perdería en cuanto el campo cayera en un par, que es lo que pasaba con
   * los dos largos del rebaje.
   */
  function rotulo(campo: CampoItem): string {
    // En un rebaje hay dos largos y hay que distinguirlos. Corto, porque en un
    // par entra en un tercio de fila: "LARGO QUE TIENE HOY" se parte en tres
    // renglones.
    if (campo === 'largo' && item.servicio === 'rebaje') return 'LARGO DE HOY (mm)'
    return ETIQUETAS[campo]
  }

  function campoNumerico(campo: CampoItem, etiqueta: string, ancho?: 'tercio' | 'mitad') {
    const valor = (item as unknown as Record<string, string>)[campo] ?? ''
    const esPrecio = campo === 'precio_por_diente' || campo === 'precio_total'
    const esMedida = MEDIDAS.has(campo)

    /**
     * El PRECIO TOTAL de un afilado no se tipea: sale de la cuenta.
     *
     * En las herramientas que se cobran por diente, el efecto de más arriba
     * recalcula el total en cuanto cambia cualquier cosa. El campo igual se
     * dibujaba como uno más, editable: el vendedor podía borrarlo, escribir el
     * importe que había arreglado con el cliente, ver cómo se le corregía solo
     * al toque siguiente y no entender por qué. Lo que escribía se descartaba.
     *
     * Ahora se muestra como resultado. Para mover el precio está PRECIO POR
     * DIENTE, que es el que la cuenta respeta.
     *
     * En mechas, cuchillas y sierras sin fin no se cobra por diente: ahí el
     * total SÍ es lo que el vendedor tipea, y el campo sigue abierto.
     */
    const esTotalCalculado =
      campo === 'precio_total' &&
      campos.includes('precio_por_diente') &&
      campos.includes('cantidad_dientes')

    /**
     * Las medidas que el catálogo tiene para lo que ya se eligió.
     *
     * `cantidad_dientes` entra acá aunque no sea un milímetro: es exactamente
     * el caso del que se trata —elegido el diámetro, los dientes posibles son
     * dos o tres y no cualquiera—.
     */
    /*
      Las medidas de una cuchilla las decide el TIPO, no el catálogo entero.

      La cascada sugiere sobre todas las cuchillas cargadas juntas, así que al
      que estaba cargando una plana —30 ó 35 de ancho— le ofrecía además 40, 50,
      55, 60 y 70, que son las de dorso ranurado, y al revés. El tipo ya está
      contestado más arriba: con eso alcanza para ofrecer sólo las que existen.

      Sigue siendo un campo para escribir, no un desplegable: por el mostrador
      entra alguna que no es de medida estándar, y ahí lo que hace falta es
      poder tipearla, no que la app la rechace.
    */
    const delTipo = item.herramienta === 'cuchilla' ? medidasDeLaCuchilla(item.cuchilla_tipo) : null
    const estandar =
      delTipo && campo === 'ancho'
        ? delTipo.anchos
        : delTipo && campo === 'espesor'
          ? delTipo.espesores
          : null

    const opciones = estandar
      ? estandar.map((v) => ({ valor: v, cantidad: 0 }))
      : (cascada.opciones[campo] ?? [])

    const propsComunes = {
      etiqueta,
      obligatorio: true as const,
      editable: !esTotalCalculado,
      keyboardType: 'decimal-pad' as const,
      error: errores[campo],
      contenedorStyle:
        ancho === 'tercio' ? estilos.tercio : ancho === 'mitad' ? estilos.mitad : undefined,
    }

    const escribir = (t: string) =>
      alCambiar({
        // Las medidas van con coma: el punto se toma como coma, porque el
        // teclado numérico de Android da uno u otro según el teléfono y
        // los dos quieren decir lo mismo.
        [campo]: esMedida ? normalizarMedida(t) : soloNumeros(t),
      } as Partial<FormularioItemNota>)

    if (opciones.length > 0 && !esTotalCalculado) {
      return (
        <CampoConOpciones
          key={campo}
          {...propsComunes}
          valor={valor}
          onChangeText={escribir}
          opciones={opciones.map((o) => ({
            valor: String(o.valor),
            cantidad: o.cantidad,
          }))}
          alElegir={(v) => alCambiar({ [campo]: v } as Partial<FormularioItemNota>)}
          ayuda={
            esMedida && aNumero(valor) > 0
              ? formatearMedida(valor)
              : estandar
                ? `Las de ${ETIQUETA_CUCHILLA_TIPO[item.cuchilla_tipo!].toLowerCase()}`
                : `${opciones.length} en el catálogo`
          }
        />
      )
    }

    return (
      <Campo
        key={campo}
        etiqueta={etiqueta}
        obligatorio
        value={valor}
        editable={!esTotalCalculado}
        onChangeText={escribir}
        keyboardType="decimal-pad"
        error={errores[campo]}
        contenedorStyle={ancho === 'tercio' ? estilos.tercio : ancho === 'mitad' ? estilos.mitad : undefined}
        ayuda={
          esTotalCalculado
            ? `${cuentaDelRenglon(item)} · Para cambiarlo, tocá PRECIO POR DIENTE.`
            : esPrecio && aNumero(valor) > 0
              ? formatearPesos(aNumero(valor))
              : esMedida && aNumero(valor) > 0
                ? formatearMedida(valor)
                : undefined
        }
      />
    )
  }

  return (
    <>
      {/* Herramienta */}
      {herramientas.length > 1 ? (
        <Desplegable<Herramienta>
          etiqueta={`HERRAMIENTA A ${rotuloServicio(item.servicio)}`}
          obligatorio
          marcador="Elegí la herramienta"
          valor={item.herramienta}
          items={herramientas.map((h) => ({ valor: h, etiqueta: ETIQUETA_HERRAMIENTA[h] }))}
          /**
           * Cambiar de herramienta puede dejar la máquina en una que no existe
           * para la nueva —una fresa en una escuadradora—, y el desplegable la
           * mostraría igual porque ya está elegida. Se limpia, y el efecto de
           * más arriba propone la que corresponde.
           */
          alCambiar={(h) =>
            alCambiar({
              herramienta: h,
              codigos_computo: [],
              ...(item.maquina && !maquinasDeLaHerramienta(h).includes(item.maquina)
                ? { maquina: '' }
                : {}),
            })
          }
          error={errores.herramienta}
        />
      ) : item.herramienta ? (
        <View style={estilos.herramientaFija}>
          <Text style={estilos.herramientaFijaRotulo}>
            HERRAMIENTA A {rotuloServicio(item.servicio)}
          </Text>
          <Text style={estilos.herramientaFijaValor}>
            {ETIQUETA_HERRAMIENTA[item.herramienta]}
          </Text>
        </View>
      ) : null}

      {/* En qué máquina trabaja. Va pegado a la herramienta porque es parte de
          identificarla: sale impreso en la descripción general de la nota
          —"AFILADO de sierras circulares para escuadradora"— y es lo que le
          dice al taller de qué pieza se trata cuando dos comparten medidas. */}
      {item.herramienta ? (
        <Desplegable<string>
          etiqueta="¿EN QUÉ MÁQUINA LA USA?"
          marcador="Elegí la máquina"
          valor={item.maquina || null}
          items={maquinasDeLaHerramienta(item.herramienta).map((m) => ({
            valor: m,
            etiqueta: m.toUpperCase(),
          }))}
          alCambiar={(m) => alCambiar({ maquina: m })}
        />
      ) : null}

      {item.herramienta === 'mecha' ? (
        <Desplegable<TipoMecha>
          etiqueta="TIPO DE MECHA"
          obligatorio
          marcador="Elegí el tipo"
          valor={item.tipo_mecha}
          items={(Object.keys(ETIQUETA_TIPO_MECHA) as TipoMecha[]).map((t) => ({
            valor: t,
            etiqueta: ETIQUETA_TIPO_MECHA[t],
          }))}
          alCambiar={(t) =>
            // Cambiar de tipo deja sin sentido el modelo elegido y todo lo que
            // vino con él: se limpia en vez de arrastrar las medidas de una
            // mecha que ya no es la que se está cargando.
            alCambiar({
              tipo_mecha: t,
              mano: null,
              // El material se conserva —una mecha de widia sigue siendo de
              // widia aunque cambie el tipo— pero los filos no: sólo tienen
              // sentido en las integrales, y arrastrar un 3 a una pasante
              // dejaría elegido un código que esa mecha no usa.
              mecha_dientes: '',
              codigos_computo: [],
              codigo_herramienta: '',
              descripcion_catalogo: '',
              precio: '',
              precio_total: '',
              diametro: '',
              largo_util: '',
              sin_cargo: false,
            })
          }
          error={errores.tipo_mecha}
        />
      ) : null}

      {/*
        De qué mano es.

        Va pegada al tipo porque es parte de decir QUÉ pieza es, no algo que
        salga de medirla: el vendedor la tiene en la mano y la contesta de una.
        Estaba al final, después del código de cómputo, y se llegaba ahí con
        todo lo demás ya cargado.

        Sólo en los tipos que vienen de las dos —pasante, ciega, bisagra e
        integral de widia—. Preguntarlo en una barreno no significa nada.

        Si después el vendedor elige el modelo, la mano del modelo pisa a ésta:
        es más específica, y sale del catálogo en vez de la memoria.
      */}
      {item.herramienta === 'mecha' &&
      item.tipo_mecha &&
      MECHAS_CON_MANO.includes(item.tipo_mecha) ? (
        <Desplegable<ManoMecha>
          etiqueta="¿ES DERECHA O IZQUIERDA?"
          obligatorio
          marcador="Elegí"
          valor={item.mano}
          items={[
            { valor: 'derecha', etiqueta: 'DERECHA' },
            { valor: 'izquierda', etiqueta: 'IZQUIERDA' },
          ]}
          alCambiar={(m) => alCambiar({ mano: m })}
          error={errores.mano}
        />
      ) : null}

      {/*
        El afilado de la mecha: de qué material es, y cuántos filos si es integral.
        Va ANTES del modelo porque es lo que decide el precio. El modelo, abajo,
        dice cuál de las mechas es —para las medidas y para el taller— pero no
        cotiza nada.
      */}
      {item.herramienta === 'mecha' && item.tipo_mecha ? (
        <SelectorAfiladoMecha item={item} alCambiar={alCambiar} />
      ) : null}

      {/*
        El modelo de mecha.
        No se cotiza por medida como una sierra: la familia entera del catálogo
        tiene un solo código con rango, así que buscar por diámetro no devolvía
        nunca nada y el vendedor terminaba tipeando el código de memoria. Se
        elige de la lista del tipo y de ahí salen las medidas y la mano.
      */}
      {item.herramienta === 'mecha' && item.tipo_mecha ? (
        <SelectorModeloMecha item={item} alCambiar={alCambiar} />
      ) : null}

      {/*
        El TIPO DE CUCHILLA, que sirve para las dos operaciones.

        Estaba adentro del bloque de afilado, y en un rebaje no se dibujaba
        ninguno de los dos. De él salen las medidas que se sugieren —una plana
        es de 30 ó 35 de ancho, una de dorso ranurado de 40 a 70— y eso hace
        falta igual, se venga a afilar o a rebajar.
      */}
      {item.herramienta === 'cuchilla' && item.servicio !== 'venta' ? (
        <Desplegable<CuchillaTipo>
          etiqueta="TIPO DE CUCHILLA"
          obligatorio
          marcador="Elegí el tipo"
          valor={item.cuchilla_tipo}
          items={(['plana', 'dorso_ranurado'] as CuchillaTipo[]).map((t) => ({
            valor: t,
            etiqueta: ETIQUETA_CUCHILLA_TIPO[t],
          }))}
          alCambiar={(t) =>
            alCambiar({
              cuchilla_tipo: t,
              // Una plana no se perfila: si venía elegido, se cae.
              ...(t === 'plana' && item.cuchilla_trabajo === 'perfilado'
                ? { cuchilla_trabajo: 'afilado' as const }
                : {}),
            })
          }
        />
      ) : null}

      {/*
        El afilado de cuchillas.
        El código no sale de una medida: sale de las respuestas de acá. El largo
        no elige nada, multiplica, porque el precio de la lista es por cada
        100 mm.

        En un REBAJE no se dibuja, y ése es el arreglo: se dibujaba igual y le
        ponía al renglón un código y una tarifa de AFILADO. Así quedaron
        cotizadas dos notas reales. Un rebaje no tiene tarifa —no existe el
        código en ninguna lista— y se cotiza a mano cada vez.
      */}
      {item.herramienta === 'cuchilla' &&
      item.servicio !== 'venta' &&
      item.servicio !== 'rebaje' ? (
        <SelectorAfiladoCuchilla item={item} alCambiar={alCambiar} />
      ) : null}

      {/* ── Cuántas herramientas del catálogo siguen encajando ────────────────
          Es la mitad que faltaba del filtrado: los campos de arriba dicen qué
          medidas son posibles, y esto dice cuántas piezas quedan. Con pocas, se
          elige la exacta y las medidas se completan solas.

          No aparece hasta que hay una medida cargada. Sin filtros el número es
          el catálogo entero —144 sierras— y eso no es información: es un cartel
          que ocupa lugar y dice lo mismo siempre. Recién empieza a servir
          cuando baja. */}
      {hayMedidaCargada && cascada.total > 0 ? (
        <View style={estilos.cascada}>
          <Text style={estilos.cascadaTitulo}>
            {cascada.total === 1
              ? 'Una sola del catálogo coincide con esas medidas'
              : `${cascada.total} del catálogo coinciden con esas medidas`}
          </Text>

          {cascada.total <= 6 ? (
            cascada.articulos.map((a) => (
              <Pressable
                key={a.codigo}
                onPress={() => aplicarArticulo(a)}
                accessibilityRole="button"
                accessibilityLabel={`Usar ${a.codigo}`}
                style={({ pressed }) => [estilos.cascadaFila, pressed && estilos.filaTocada]}
              >
                <Text style={estilos.cascadaCodigo}>{a.codigo}</Text>
                <Text style={estilos.cascadaDescripcion} numberOfLines={2}>
                  {[a.descripcion, a.marca].filter(Boolean).join(' · ')}
                </Text>
              </Pressable>
            ))
          ) : (
            <Text style={estilos.cascadaAyuda}>
              Completá otra medida y la lista se achica sola.
            </Text>
          )}
        </View>
      ) : null}

      {/* Campos propios de la herramienta.
          Los numéricos cortos se agrupan de a dos por fila (ver `agruparPares`):
          una medida son cinco caracteres y ocupaba el ancho entero de la
          pantalla, que es la mitad del scroll que había que hacer. */}
      {agruparPares(campos).map((campo) => {
        if (Array.isArray(campo)) {
          return (
            <View key={campo.join('+')} style={estilos.par}>
              {campo.map((c) => campoNumerico(c, rotulo(c), 'tercio'))}
            </View>
          )
        }
        if (campo === 'tipo_mecha') return null

        /*
          SIERRA o INCISOR, primero de la lista y por eso primero en pantalla.

          El incisor es el disco chico que va delante de la sierra. Se carga
          acá adentro porque comparte la lista de precios y el ancho de corte
          —el código de cómputo es el mismo— pero es otra pieza, va en su
          propio renglón y en la hoja tiene que decir "Incisor".

          Arranca sin contestar a propósito: poner "sierra" por defecto dejaría
          la nota igual que antes, con la diferencia de que ahora afirmaría que
          alguien lo miró.
        */
        if (campo === 'sierra_clase') {
          return (
            <Desplegable<SierraClase>
              key={campo}
              etiqueta={ETIQUETAS[campo]}
              obligatorio
              marcador="Elegí cuál de los dos es"
              valor={item.sierra_clase}
              items={(['sierra', 'incisor'] as SierraClase[]).map((c) => ({
                valor: c,
                etiqueta: ETIQUETA_SIERRA_CLASE[c],
                descripcion: QUE_ES_EL_DISCO[c],
              }))}
              alCambiar={(c) => alCambiar({ sierra_clase: c })}
              error={errores.sierra_clase}
            />
          )
        }

        /*
          El tipo de pieza, primero de la lista y por eso primero en pantalla.
          Contestarlo deja puestas las medidas que el catálogo fija para ese
          tipo, así que los campos de abajo llegan con la mitad hecha.
        */
        if (campo === 'tipo_pieza') {
          const tipos = tiposDePieza(item.herramienta)
          if (tipos.length === 0) return null
          const elegido = tipoDePieza(item.herramienta, item.tipo_pieza)
          return (
            <View key={campo}>
              <Desplegable
                etiqueta={`TIPO DE ${unaPieza(item.herramienta).toUpperCase()}`}
                obligatorio
                marcador="Elegí el tipo"
                valor={item.tipo_pieza}
                items={tipos.map((t) => ({
                  valor: t.valor,
                  etiqueta: t.etiqueta,
                  descripcion: t.descripcion,
                }))}
                alCambiar={elegirTipoDePieza}
                error={errores.tipo_pieza}
              />
              {elegido?.notas ? <Aviso>{elegido.notas}</Aviso> : null}
            </View>
          )
        }

        /*
          El precio del REBAJE no se tipea: va a cotizar.

          No hay tarifa en ninguna lista —por eso el renglón tampoco lleva
          código— y cuánto material hay que sacar lo mira la oficina. Un
          casillero de precio acá obliga al vendedor a poner un número que no
          tiene, y ese número sale impreso.
        */
        if (campo === 'precio_total' && item.servicio === 'rebaje') {
          return (
            <Aviso key={campo} titulo="El rebaje va a cotizar">
              El importe lo pone la oficina cuando ve cuánto hay que sacarle. El
              renglón se guarda sin precio y no suma al total de la nota.
            </Aviso>
          )
        }

        // A qué largo se rebaja: sólo en un rebaje. En el resto de las
        // operaciones el campo no significa nada y no se dibuja.
        if (campo === 'largo_rebajado') {
          if (item.servicio !== 'rebaje') return null
          return campoNumerico(campo, ETIQUETAS[campo], 'mitad')
        }

        if (campo === 'cantidad') {
          return campoNumerico(
            campo,
            `CANTIDAD DE ${item.herramienta ? SINGULAR_HERRAMIENTA[item.herramienta] : 'HERRAMIENTAS'}`,
            'tercio',
          )
        }

        if (campo === 'cantidad_dientes') {
          // Los dientes se cargan POR herramienta. Lo que se computa y se cobra
          // es el total, así que si hay más de una se muestra la cuenta hecha:
          // que el vendedor la vea antes de firmar, no después.
          const porHerramienta = aNumero(item.cantidad_dientes)
          const unidades = aNumero(item.cantidad)
          const totalDientes = porHerramienta * unidades
          const rotos = item.dientes_rotos ? aNumero(item.dientes_rotos_cantidad) : 0
          const aAfilar = dientesAAfilar(item)

          return (
            <View key={campo}>
              {campoNumerico(campo, etiquetaDientes(item.servicio), 'mitad')}
              {unidades > 1 && totalDientes > 0 ? (
                <Text style={estilos.totalDientes}>
                  {`${unidades} × ${porHerramienta} = ${totalDientes} dientes en total`}
                </Text>
              ) : null}
              {/* Los rotos no entran en la línea principal: un diente roto no
                  se afila ni se rectifica. Si además los reparan, van aparte y
                  se dice acá, que es donde el vendedor está mirando la cuenta. */}
              {rotos > 0 && totalDientes > 0 ? (
                <Text style={estilos.totalDientes}>
                  {`${totalDientes} − ${rotos} rotos = ${aAfilar} dientes ${
                    item.reparar_dientes === true ? 'a rectificar' : 'a afilar'
                  }`}
                  {item.reparar_dientes === true
                    ? `, y los ${rotos} rotos aparte con el código de reparación`
                    : ''}
                </Text>
              ) : null}
            </View>
          )
        }

        if (campo === 'descripcion') {
          return (
            <Campo
              key={campo}
              etiqueta="DESCRIPCIÓN"
              obligatorio
              value={item.descripcion}
              onChangeText={(t) => alCambiar({ descripcion: t })}
              placeholder="Marca, modelo, estado…"
              multiline
              numberOfLines={3}
              error={errores.descripcion}
              ayuda="Se completa sola con la herramienta. Agregale lo que haga falta."
            />
          )
        }

        if (campo === 'diametro_interior') {
          // Opcional a propósito: la lista de precios ya trae el agujero de
          // fábrica. Sólo se carga cuando la pieza que trae el cliente tiene
          // otro, que es el dato que le cambia el trabajo al taller.
          const agujero = agujeroDelRenglon(item)
          const deFabrica = item.diametro_interior_catalogo.trim()

          /**
           * Los agujeros que el catálogo tiene para lo que ya se cargó.
           *
           * A 300 mm hay cinco: 25,4 / 30 / 60 / 80 / 130, porque conviven
           * sierras universales, de multiple y de triturador. Elegir uno por el
           * vendedor sería poner en un comprobante un número que nadie miró;
           * ofrecerle esos cinco es una sola tocada en vez de tipear.
           */
          const propsAgujero = {
            etiqueta: 'DIÁMETRO INTERIOR (OPCIONAL)',
            keyboardType: 'decimal-pad' as const,
            contenedorStyle: estilos.mitad,
            placeholder: deFabrica || 'El agujero de la herramienta',
            error: errores.diametro_interior,
            ayuda: deFabrica
              ? `De fábrica: ${formatearMedida(deFabrica)}. Dejalo vacío si es ése.`
              : agujerosPosibles.length > 1
                ? `El catálogo tiene ${agujerosPosibles.length} agujeros para esa medida. Tocá ▼ y elegí, o cargá otra medida para achicar.`
                : buscandoAgujero
                  ? 'Buscando el agujero de fábrica en la lista de precios…'
                  : 'Si lo dejás vacío, la nota sale sin agujero.',
          }

          return (
            <View key={campo}>
              {agujerosPosibles.length > 0 ? (
                <CampoConOpciones
                  {...propsAgujero}
                  valor={item.diametro_interior}
                  onChangeText={(t) => alCambiar({ diametro_interior: normalizarMedida(t) })}
                  opciones={agujerosPosibles.map((o) => ({
                    valor: String(o.valor),
                    cantidad: o.cantidad,
                  }))}
                  alElegir={(v) => alCambiar({ diametro_interior: v.replace('.', ',') })}
                />
              ) : (
                <Campo
                  {...propsAgujero}
                  value={item.diametro_interior}
                  onChangeText={(t) => alCambiar({ diametro_interior: normalizarMedida(t) })}
                />
              )}

              {agujero.ajuste !== 'de_fabrica' ? (
                <Aviso
                  tono="atencion"
                  titulo={
                    agujero.ajuste === 'agrandado'
                      ? 'Agujero agrandado'
                      : 'Lleva buje reductor'
                  }
                >
                  {`${formatearMedida(agujero.medida)} contra ${formatearMedida(deFabrica)} de fábrica. Va escrito en la descripción general de la nota.`}
                </Aviso>
              ) : null}
            </View>
          )
        }

        // La mano se dibuja arriba, pegada al tipo, no acá. Sigue en la lista
        // de campos porque de ahí salen la validación y el resumen del renglón.
        if (campo === 'mano') return null

        if (campo === 'afilado_reparacion') {
          return (
            <Casilla
              key={campo}
              etiqueta={etiquetaSiNo(campo, item.servicio)}
              valor={item.afilado_reparacion}
              alCambiar={(v) => alCambiar({ afilado_reparacion: v })}
            />
          )
        }

        if (campo === 'dientes_rotos') {
          return (
            <Casilla
              key={campo}
              etiqueta={etiquetaSiNo(campo, item.servicio)}
              valor={item.dientes_rotos}
              alCambiar={(v) =>
                alCambiar(
                  /**
                   * Marcar los dientes rotos no cambia la operación: la pieza
                   * se sigue afilando, con menos dientes. Un diente roto no se
                   * afila, así que sale de la cuenta y nada más.
                   *
                   * Lo que sí cambia el trabajo es querer repararlos, y eso se
                   * decide en la pregunta de abajo.
                   *
                   * Destildar borra todo lo que colgaba de los rotos: dejar una
                   * cantidad escondida descontaría dientes que nadie volvió a
                   * mirar.
                   */
                  v
                    ? { dientes_rotos: true }
                    : {
                        dientes_rotos: false,
                        dientes_rotos_cantidad: '',
                        reparar_dientes: null,
                        codigo_reparacion: '',
                        precio_reparacion_por_diente: '',
                        codigos_computo: [],
                        ...(item.servicio_antes_de_rotos
                          ? {
                              servicio: item.servicio_antes_de_rotos,
                              servicio_antes_de_rotos: null,
                            }
                          : {}),
                      },
                )
              }
            />
          )
        }

        if (campo === 'rascadores') {
          const cuantos = aNumero(item.rascadores)
          const linea = lineasDelRenglon(item).find((l) => l.concepto === 'rascador')
          return (
            <View key={campo}>
              <Campo
                etiqueta={ETIQUETAS[campo]}
                value={item.rascadores}
                // Enteros: medio rascador no existe, igual que medio diente.
                onChangeText={(t) => alCambiar({ rascadores: t.replace(/\D/g, '') })}
                keyboardType="number-pad"
                contenedorStyle={estilos.mitad}
                error={errores.rascadores}
                ayuda="Dejalo vacío si la sierra no lleva. En la lista van pegados a los dientes: Z=18+4 son 18 dientes y 4 rascadores."
              />

              {buscandoRascador ? (
                <View style={estilos.buscando}>
                  <ActivityIndicator size="small" color={colores.rojo} />
                  <Text style={estilos.buscandoTexto}>Buscando el código del rascador…</Text>
                </View>
              ) : null}

              {/* Su importe, aparte: el rascador se afila con otro código y a
                  otro precio que el diente, así que es plata que se suma y
                  tiene que poder mirarse antes de firmar. */}
              {linea ? (
                <View style={estilos.lineaRotos}>
                  <Pastilla texto={linea.codigo || 'sin código'} color={colores.ambarOscuro} />
                  <Text style={estilos.lineaRotosTexto}>
                    {`${linea.cantidad} × ${formatearPesos(linea.precioUnitario)} = ${formatearPesos(linea.total)}`}
                  </Text>
                </View>
              ) : null}

              {cuantos > 0 && sinCodigoRascador ? (
                <Aviso tono="atencion" titulo="Sin código de rascador">
                  El catálogo no tiene el afilado de rascador cargado. Ponelo a mano o consultá con
                  Administración.
                </Aviso>
              ) : null}
            </View>
          )
        }

        if (campo === 'dientes_rotos_cantidad') {
          if (!item.dientes_rotos) return null
          return (
            <Campo
              key={campo}
              etiqueta={ETIQUETAS[campo]}
              obligatorio
              value={item.dientes_rotos_cantidad}
              // Sólo números enteros: medio diente roto no existe.
              onChangeText={(t) => alCambiar({ dientes_rotos_cantidad: t.replace(/\D/g, '') })}
              keyboardType="number-pad"
              contenedorStyle={estilos.mitad}
              error={errores.dientes_rotos_cantidad}
              ayuda="Se descuentan de los dientes a afilar."
            />
          )
        }

        if (campo === 'reparar_dientes') {
          if (!item.dientes_rotos) return null

          // La segunda línea, la de los rotos, sale de la misma cuenta que va a
          // salir impresa: mostrar acá otra cosa sería mostrar un número que la
          // nota no tiene.
          const lineaReparacion = lineasDelRenglon(item).find((l) => l.concepto === 'reparacion')

          return (
            <View key={campo} style={estilos.bloqueRotos}>
              {/*
                Sin valor por defecto a propósito: la respuesta cambia el
                precio, así que un "no" silencioso sería cobrarle de menos al
                cliente sin que nadie lo haya decidido.
              */}
              <Desplegable<'si' | 'no'>
                etiqueta={ETIQUETAS[campo]}
                obligatorio
                marcador="Contestá sí o no"
                valor={item.reparar_dientes === null ? null : item.reparar_dientes ? 'si' : 'no'}
                items={[
                  {
                    valor: 'si',
                    etiqueta: 'SÍ, REPARARLOS',
                    descripcion: 'Los rotos se reparan y los sanos se rectifican',
                  },
                  {
                    valor: 'no',
                    etiqueta: 'NO',
                    descripcion: 'Sólo se descuentan de los dientes a afilar',
                  },
                ]}
                /**
                 * La respuesta parte el renglón en dos trabajos, o en ninguno.
                 *
                 * Sin reparar hay un solo trabajo: se AFILAN los dientes sanos y
                 * los rotos quedan afuera de la cuenta.
                 *
                 * Reparándolos hay dos, sobre la misma pieza y con precios
                 * distintos: los rotos se REPARAN, con su código, y los sanos ya
                 * no se afilan sino que se RECTIFICAN. Son dos líneas de la misma
                 * nota, cada una con su código y su cantidad.
                 *
                 * La operación se toca únicamente si la puso la app —eso es lo
                 * que recuerda `servicio_antes_de_rotos`—. Un rectificado que
                 * eligió el vendedor a propósito se respeta: después no hay forma
                 * de distinguirlo, y pisarlo sería decidir por él.
                 */
                alCambiar={(v) =>
                  alCambiar(
                    v === 'si'
                      ? {
                          reparar_dientes: true,
                          codigos_computo: [],
                          ...(item.servicio === 'afilado'
                            ? {
                                servicio: 'rectificado' as const,
                                servicio_antes_de_rotos: 'afilado' as const,
                              }
                            : {}),
                        }
                      : {
                          reparar_dientes: false,
                          codigo_reparacion: '',
                          precio_reparacion_por_diente: '',
                          codigos_computo: [],
                          ...(item.servicio_antes_de_rotos
                            ? {
                                servicio: item.servicio_antes_de_rotos,
                                servicio_antes_de_rotos: null,
                              }
                            : {}),
                        },
                  )
                }
                error={errores.reparar_dientes}
              />

              {buscandoReparacion ? (
                <View style={estilos.buscando}>
                  <ActivityIndicator size="small" color={colores.rojo} />
                  <Text style={estilos.buscandoTexto}>Buscando el código de reparación…</Text>
                </View>
              ) : null}

              {/* El importe de los rotos, con su código: es plata aparte de la
                  del renglón y tiene que poder mirarse antes de firmar. */}
              {lineaReparacion ? (
                <View style={estilos.lineaRotos}>
                  <Pastilla
                    texto={lineaReparacion.codigo || 'sin código'}
                    color={colores.ambarOscuro}
                  />
                  <Text style={estilos.lineaRotosTexto}>
                    {`${lineaReparacion.cantidad} × ${formatearPesos(lineaReparacion.precioUnitario)} = ${formatearPesos(lineaReparacion.total)}`}
                  </Text>
                </View>
              ) : null}

              {sinCodigoReparacion ? (
                <Aviso tono="atencion" titulo="Sin código de reparación">
                  El catálogo no tiene un código de reparación para esa medida. Cargalo a mano o
                  consultá con Administración.
                </Aviso>
              ) : null}

              <MensajeError>{errores.codigo_reparacion}</MensajeError>
            </View>
          )
        }

        /*
          El REBAJE va sin código de cómputo.

          No existe ninguno —no está en la lista de cuchillas ni en la de
          afilado y reparación— y el precio se cotiza a mano. Mostrar el bloque
          era invitar a poner cualquiera con tal de poder guardar, y eso fue lo
          que pasó: hay una nota con el código de un CABEZAL en el renglón de
          rebaje. La oficina le pone el código al facturar.
        */
        if (campo === 'codigos_computo' && item.servicio === 'rebaje') {
          return (
            <Aviso key={campo} titulo="El rebaje va sin código de cómputo">
              No hay tarifa de rebaje en la lista: se cotiza cada uno. Escribí el
              importe en PRECIO TOTAL y la oficina le pone el código al facturar.
            </Aviso>
          )
        }

        if (campo === 'codigos_computo') {
          return (
            <View key={campo} style={estilos.bloqueCodigos}>
              <Text style={estilos.rotulo}>CÓDIGO DE CÓMPUTO</Text>

              {buscando ? (
                <View style={estilos.buscando}>
                  <ActivityIndicator size="small" color={colores.rojo} />
                  <Text style={estilos.buscandoTexto}>Buscando el código por la medida…</Text>
                </View>
              ) : null}

              {item.codigos_computo.length > 0 ? (
                <View style={estilos.elegidos}>
                  {item.codigos_computo.map((c) => (
                    <Pastilla key={c} texto={c} color={colores.verdeOscuro} />
                  ))}
                </View>
              ) : null}

              {codigos.length > 0 ? (
                <View style={estilos.opciones}>
                  {codigos.map((c) => {
                    const elegido = item.codigos_computo.includes(c.codigo)
                    return (
                      <Pressable
                        key={c.codigo}
                        onPress={() => alCambiar(alTocarCodigo(item, codigos, c, elegido))}
                        // Radio y no casilla: elegir uno saca el otro. Con
                        // "checkbox" el lector de pantalla anunciaba que se
                        // podían tildar varios, que es justo lo que ya no pasa.
                        accessibilityRole="radio"
                        accessibilityState={{ checked: elegido, selected: elegido }}
                        style={({ pressed }) => [
                          estilos.opcion,
                          elegido && estilos.opcionElegida,
                          pressed && estilos.tocado,
                        ]}
                      >
                        <View style={estilos.opcionFila}>
                          <Text style={estilos.opcionCodigo}>{c.codigo}</Text>
                          {/* El rango va al lado del código: es lo que explica
                              por qué ése y no otro. */}
                          <Text style={estilos.opcionRango}>
                            {describirRango(c.rango_min, c.rango_max)}
                          </Text>
                          <Text style={estilos.opcionPrecio}>
                            {c.a_cotizar
                              ? 'A cotizar'
                              : c.precio_pesos !== null
                                ? formatearPesos(Number(c.precio_pesos))
                                : '—'}
                          </Text>
                        </View>
                        <Text style={estilos.opcionDesc} numberOfLines={1}>
                          {c.descripcion}
                        </Text>
                        {c.moneda === 'USD' ? (
                          <Text style={estilos.opcionNota}>
                            Lista en US$ {Number(c.precio).toFixed(2)} · convertido al cambio de hoy
                          </Text>
                        ) : null}
                      </Pressable>
                    )
                  })}
                </View>
              ) : null}

              {codigoDesactualizado ? (
                <Aviso tono="atencion" titulo="La medida cambió">
                  El código que está elegido no cubre esta medida. Tocá el que corresponde de la
                  lista para actualizar el precio.
                </Aviso>
              ) : null}

              {/* El cartel dice "no hay código": con uno ya elegido es mentira.
                  Pasa en las mechas y las cuchillas, donde el código no sale de
                  la medida sino de las respuestas de más arriba: se elegía bien
                  y abajo seguía avisando que no se había encontrado nada. */}
              {sinCodigo &&
              !(
                SIN_RANGOS.has(item.herramienta as Herramienta) &&
                item.codigos_computo.length > 0
              ) ? (
                // Mechas y cuchillas no tienen un solo código con rango: no se
                // cotizan por medida. Decirle "probá otra medida" sería mandarlo
                // a buscar algo que no existe.
                SIN_RANGOS.has(item.herramienta as Herramienta) ? (
                  <Aviso tono="atencion" titulo="Esta herramienta no se cotiza por medida">
                    {item.herramienta === 'mecha'
                      ? 'El afilado de mechas va por tipo, material y cantidad de filos, no por diámetro. Contestá el material acá arriba y el código sale solo.'
                      : 'La lista de cuchillas es de producto, no de servicio. Abrí la lista de abajo y elegí el código.'}
                  </Aviso>
                ) : (
                  <Aviso tono="atencion">
                    No hay ningún código que cubra esa medida. Mirá abajo qué medidas tiene cargadas
                    el catálogo.
                  </Aviso>
                )
              ) : null}

              {/* La lista de medidas disponibles: la respuesta a "¿y entonces
                  qué medidas hay?", que antes se contestaba probando números. */}
              <Pressable
                onPress={() => setVerMedidas((v) => !v)}
                accessibilityRole="button"
                accessibilityState={{ expanded: verMedidas }}
                style={estilos.verMedidas}
              >
                <Text style={estilos.verMedidasTexto}>
                  {verMedidas ? '▲' : '▼'}{' '}
                  {SIN_RANGOS.has(item.herramienta as Herramienta) ? '¿Qué códigos' : '¿Qué medidas'}{' '}
                  hay para{' '}
                  {item.herramienta ? ETIQUETA_HERRAMIENTA[item.herramienta] : 'esta herramienta'}?
                </Text>
              </Pressable>

              {verMedidas ? (
                medidas === null ? (
                  <View style={estilos.buscando}>
                    <ActivityIndicator size="small" color={colores.rojo} />
                    <Text style={estilos.buscandoTexto}>Buscando…</Text>
                  </View>
                ) : medidas.length === 0 ? (
                  <Aviso tono="atencion">
                    Esta herramienta no tiene medidas cargadas en el catálogo: sus precios van por
                    modelo, no por rango. Buscá el código por descripción.
                  </Aviso>
                ) : (
                  <View style={estilos.opciones}>
                    {medidas.map((m) => (
                      <Pressable
                        key={m.codigo}
                        onPress={() => aplicarMedidaSugerida(m)}
                        accessibilityRole="button"
                        accessibilityLabel={`Usar ${m.codigo}, ${describirRango(m.rango_min, m.rango_max)}`}
                        style={({ pressed }) => [estilos.opcion, pressed && estilos.tocado]}
                      >
                        <View style={estilos.opcionFila}>
                          <Text style={estilos.opcionCodigo}>{m.codigo}</Text>
                          {/* Sin rango no se muestra "sin rango": lo que sirve
                              ahí es el precio, que es lo que distingue una
                              opción de la otra. */}
                          <Text style={estilos.opcionRango}>
                            {m.rango_min === null
                              ? (m.precio_pesos !== null
                                  ? formatearPesos(Number(m.precio_pesos))
                                  : '')
                              : describirRango(m.rango_min, m.rango_max)}
                          </Text>
                        </View>
                        <Text style={estilos.opcionDesc} numberOfLines={1}>
                          {m.descripcion}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                )
              ) : null}

              {/* Dónde va el trabajo de más, ahora que acá va uno solo. Sin
                  este renglón, el vendedor que necesita dos cosas vuelve a
                  intentar tildando dos códigos y no entiende por qué se le
                  apaga el anterior. */}
              {codigos.length > 1 ? (
                <Text style={estilos.buscandoTexto}>
                  Uno por herramienta. Si además hay que reparar, contestá ¿TIENE DIENTES ROTOS?; si
                  es otra herramienta, usá SUMAR OTRA.
                </Text>
              ) : null}

              <MensajeError>{errores.codigos_computo}</MensajeError>
            </View>
          )
        }

        // El resto son medidas y precios: todos numéricos. Por `rotulo` y no
        // por `ETIQUETAS` a secas, para que las dos ramas del dibujo digan lo
        // mismo caiga el campo suelto o en un par.
        const anchoCampo =
          campo === 'precio_total' || campo === 'precio_por_diente' ? 'mitad' : 'tercio'
        return campoNumerico(campo, rotulo(campo), anchoCampo)
      })}

      {/* El descuento va afuera de `CAMPOS_POR_HERRAMIENTA` y al final de todo.
          Afuera porque no es una medida de la herramienta sino una condición
          del renglón, como el sin cargo: agregarlo a las siete listas sería
          repetirlo siete veces para que aparezca siempre. Y al final porque se
          acuerda sobre un precio que ya está cargado — antes, la cuenta se
          mostraría sobre un renglón todavía vacío. */}
      {/* Que se vea. El precio cambia solo y sin esto el vendedor no sabe por
          qué le dio distinto que al cliente de al lado. */}
      {precioAcordado !== null ? (
        <Aviso tono="info" titulo="Precio acordado con este cliente">
          {`Se está usando ${formatearPesos(precioAcordado.precio)} en vez del precio de lista.`}
        </Aviso>
      ) : null}

      {item.herramienta ? (
        <CampoDescuento item={item} alCambiar={alCambiar} error={errores.descuento} />
      ) : null}
    </>
  )
}

/**
 * Qué cambia al elegir un código de cómputo.
 *
 * ─── Uno por renglón, no varios ──────────────────────────────────────────────
 *
 * Elegir un código **reemplaza** al que estuviera puesto. Antes se sumaban: la
 * app proponía el más ajustado a la medida, el vendedor tocaba otro porque el
 * trabajo era distinto, y quedaban los dos tildados. La cuenta no se duplicaba
 * —el precio sale de `precio_por_diente`, que es uno solo— pero la nota salía
 * impresa con DOS códigos para un mismo trabajo, y en fábrica eso no se puede
 * leer: no dice cuál de los dos hay que hacer.
 *
 * Que sean varios nunca fue una decisión, era el toque que agregaba en vez de
 * cambiar. El trabajo de más tiene su propio lugar y sigue funcionando igual:
 *
 *   · reparar además de afilar  → "¿TIENE DIENTES ROTOS?" trae su propio
 *     código y su propio precio, aparte del afilado;
 *   · otra herramienta          → "SUMAR OTRA" o "AGREGAR OTRAS HERRAMIENTAS",
 *     que abren un renglón nuevo con sus medidas.
 *
 * Tocar el que ya está elegido lo saca y deja el renglón sin código. El precio
 * y el "sin cargo" salen siempre del que quedó, y sin ninguno se limpian: si no
 * se limpiaran, destildar "AFILADO S.C. SIN CARGO" para cobrarlo dejaría el
 * renglón cotizando $ 0,10, que es como estaba antes de todo esto.
 */
function alTocarCodigo(
  item: FormularioItemNota,
  disponibles: CodigoComputo[],
  tocado: CodigoComputo,
  estabaElegido: boolean,
): Partial<FormularioItemNota> {
  const codigos = estabaElegido ? [] : [tocado.codigo]

  const fuente = codigos.length > 0 ? disponibles.find((c) => c.codigo === codigos[0]) : undefined

  if (!fuente) {
    return codigos.length === 0
      ? { codigos_computo: codigos, precio_por_diente: '', sin_cargo: false }
      : { codigos_computo: codigos }
  }

  return {
    codigos_computo: codigos,
    // Un código a cotizar no trae importe: lo pone el vendedor.
    precio_por_diente: fuente.a_cotizar
      ? ''
      : fuente.precio_pesos !== null
        ? String(fuente.precio_pesos)
        : item.precio_por_diente,
    sin_cargo: esSinCargo(fuente.descripcion),
  }
}

/**
 * La cuenta que da el precio total, escrita: `32 × $ 139.656,00 = $ 4.468.992,00`.
 *
 * El total salía solo como un importe, y un importe grande no se puede
 * revisar: hay que aceptarlo o rehacer la cuenta a mano. Con la multiplicación
 * a la vista se ve de dónde sale, y sobre todo se ve **cuántos** se están
 * computando — que es donde se cuela el error caro.
 *
 * Pasó de verdad: un renglón de reparación de fresas quedó en $ 4.468.992
 * porque el precio de reparar UN diente es $ 139.656 y se cargaron cuatro
 * fresas de ocho dientes. La cuenta estaba bien; lo que no se veía era que
 * eran treinta y dos dientes.
 *
 * Cuando el renglón tiene además reparación de dientes rotos son dos líneas
 * con precios distintos, y se muestran las dos sumadas.
 *
 * El total va a precio de LISTA, sin el descuento. `conDescuento` baja el
 * `total` de cada línea pero deja el `precioUnitario` como está —tiene que
 * hacerlo, porque la nota impresa lleva el unitario y el descuento en columnas
 * separadas—, así que restarle acá el descuento a un lado de la igualdad y no
 * al otro escribía una cuenta falsa: con 10 % se leía «240 × $ 192,19 =
 * $ 41.513,04», y esa multiplicación da $ 46.125,60.
 *
 * El descuento se explica solo, en su propio renglón abajo: «$ 46.125,60 −
 * 10 % = $ 41.513,04». Las dos líneas se leen entonces como lo que son, una
 * cuenta y después su descuento.
 */
function cuentaDelRenglon(item: FormularioItemNota): string {
  const lineas = lineasDelRenglon(item).filter((l) => l.cantidad > 0)
  const total = totalDeListaDelRenglon(item)
  if (lineas.length === 0) return formatearPesos(total)

  const partes = lineas.map((l) =>
    l.sinCargo
      ? `${l.cantidad} sin cargo`
      : `${l.cantidad} × ${formatearPesos(l.precioUnitario)}`,
  )
  return `${partes.join(' + ')} = ${formatearPesos(total)}`
}

function rotuloServicio(s: TipoServicio): string {
  switch (s) {
    case 'reparacion':
      return 'REPARAR'
    case 'rectificado':
      return 'RECTIFICAR'
    case 'hermanado':
      return 'HERMANAR'
    case 'rebaje':
      return 'REBAJAR'
    default:
      return 'AFILAR'
  }
}

/**
 * El afilado de la mecha: qué código le toca y cuánto sale.
 *
 * El código no sale de una medida. Ninguno de los nueve de la lista tiene rango
 * de diámetro cargado, así que el buscador por medida no devolvía nunca nada:
 * lo eligen el TIPO —que ya se contestó arriba—, el MATERIAL, y en las
 * integrales la cantidad de filos.
 *
 * El material es el que parte la tabla en dos y es el que la app no preguntaba
 * en ninguna parte: en HSS toda la línea se afila a $ 8.064; en metal duro va
 * de $ 10.528 una pasante a $ 47.480 una integral de cuatro filos.
 *
 * Es el mismo mecanismo del afilado de cuchilla, y está calcado de ahí a
 * propósito: el vendedor ya lo conoce de esa pantalla.
 */
function SelectorAfiladoMecha({
  item,
  alCambiar,
}: {
  item: FormularioItemNota
  alCambiar: (cambios: Partial<FormularioItemNota>) => void
}) {
  const { colores } = usarTema()
  const estilos = usarEstilos()
  const [opciones, setOpciones] = useState<CodigoAfiladoMecha[]>([])
  const [cargando, setCargando] = useState(true)
  const [fallo, setFallo] = useState(false)

  useEffect(() => {
    let cancelado = false
    codigosAfiladoMecha()
      .then((c) => {
        if (!cancelado) setOpciones(c)
      })
      .catch(() => {
        if (!cancelado) setFallo(true)
      })
      .finally(() => {
        if (!cancelado) setCargando(false)
      })
    return () => {
      cancelado = true
    }
  }, [])

  /**
   * Hay tipos donde el material no es una pregunta: ya está contestado.
   *
   * Una integral de widia es de metal duro por definición —el sub-rubro se
   * llama así y ninguna de las veinte dice otra cosa— y las cinco de barreno
   * son HSS. Preguntarlo ahí no sólo era un toque al pedo: dejaba elegir la
   * opción que no existe, y en las integrales eso cotiza $ 8.064 un trabajo de
   * $ 39.764,50.
   */
  const materialFijo = materialFijoDeLaMecha(item.tipo_mecha)
  const material = materialFijo ?? item.mecha_material

  // Se guarda lo que la pantalla está usando, para que la nota diga por qué
  // salió ese código y para que al reabrirla se vea contestado.
  useEffect(() => {
    if (materialFijo && item.mecha_material !== materialFijo) {
      alCambiar({ mecha_material: materialFijo })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [materialFijo, item.mecha_material])

  const pideDientes = pideDientesLaMecha(item.tipo_mecha, material)
  const dientes = pideDientes ? aNumero(item.mecha_dientes) || null : null

  /**
   * Cuál de los nueve corresponde.
   *
   * La cuenta la hace `codigoAfiladoMecha` —compartida, para que el panel de
   * escritorio y el probador lleguen al mismo código— y acá sólo se busca la
   * fila que trae el precio.
   */
  const codigo = codigoAfiladoMecha(item.tipo_mecha, material, dientes)
  const elegida = codigo ? opciones.find((o) => o.codigo === codigo) : undefined

  /**
   * El código y el total salen solos de las respuestas.
   *
   * El precio de la lista es POR MECHA: afilar cuatro pasantes son cuatro veces
   * $ 10.528. No se cobra por filo —los filos sólo eligen el código de las
   * integrales— ni por milímetro, que es lo de las cuchillas.
   */
  useEffect(() => {
    if (!elegida) return
    const unidades = Math.max(1, aNumero(item.cantidad) || 1)
    const total = elegida.precio_pesos
      ? totalAfiladoMecha(elegida.precio_pesos, unidades)
      : 0

    const cambios: Partial<FormularioItemNota> = {}
    if (item.codigos_computo[0] !== elegida.codigo) {
      cambios.codigos_computo = [elegida.codigo]
      cambios.sin_cargo = esSinCargo(elegida.descripcion)
      // El afilado se cobra en pesos siempre. Quedaba en USD de cuando el
      // precio salía del catálogo de producto.
      cambios.moneda = 'ARS'
    }
    if (total > 0 && Math.abs(total - aNumero(item.precio_total)) > 0.005) {
      // Con coma: el campo lo lee y lo edita el vendedor, y todo el formulario
      // tipea a la argentina. Un "39764.5" en pantalla se lee como otro número.
      cambios.precio_total = String(total).replace('.', ',')
    }
    if (Object.keys(cambios).length > 0) alCambiar(cambios)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elegida?.codigo, elegida?.precio_pesos, item.cantidad])

  if (cargando) {
    return (
      <View style={estilos.bloqueCodigos}>
        <ActivityIndicator size="small" color={colores.rojo} />
      </View>
    )
  }

  if (fallo || opciones.length === 0) {
    return (
      <Aviso tono="atencion" titulo="No pudimos traer los precios de afilado">
        Revisá la señal. Podés cargar el código y el precio total a mano.
      </Aviso>
    )
  }

  const unidades = Math.max(1, aNumero(item.cantidad) || 1)

  return (
    <View style={estilos.bloqueCodigos}>
      {materialFijo ? (
        <View style={estilos.afiladoDato}>
          <Text style={estilos.rotulo}>MATERIAL</Text>
          <Text style={estilos.afiladoDatoValor}>{ETIQUETA_MATERIAL_MECHA[materialFijo]}</Text>
          <Text style={estilos.afiladoDescripcion}>
            {materialFijo === 'md'
              ? 'Lo dice el tipo: las integrales son todas de widia.'
              : 'Lo dice el tipo: las mechas de barreno son todas HSS.'}
          </Text>
        </View>
      ) : (
        <Desplegable<MaterialMecha>
          etiqueta="¿DE QUÉ MATERIAL ES?"
          obligatorio
          marcador="Elegí el material"
          valor={item.mecha_material}
          items={(['hss', 'md'] as MaterialMecha[]).map((m) => ({
            valor: m,
            etiqueta: ETIQUETA_MATERIAL_MECHA[m],
          }))}
          alCambiar={(m) =>
            alCambiar({
              mecha_material: m,
              // En HSS no se pregunta por los filos: es un solo precio para
              // toda la línea. Lo que hubiera quedado elegido no aplica más.
              ...(m === 'hss' ? { mecha_dientes: '' } : {}),
            })
          }
        />
      )}

      {/* Los filos, sólo en las integrales de metal duro: es lo único que
          cambia el precio ahí, de $ 34.423 con dos a $ 47.480 con cuatro. */}
      {pideDientes ? (
        <Desplegable<string>
          etiqueta="¿CUÁNTOS FILOS TIENE?"
          obligatorio
          marcador="Elegí la cantidad"
          valor={item.mecha_dientes || null}
          items={DIENTES_MECHA_INTEGRAL.map((z) => ({
            valor: String(z),
            etiqueta: `Z = ${z}`,
          }))}
          alCambiar={(z) => alCambiar({ mecha_dientes: z })}
        />
      ) : null}

      {/*
        Qué código quedó y cuánto sale. Se muestra hecho y no como una lista
        para elegir: las respuestas de arriba ya lo deciden, y ofrecer los nueve
        sería pedir dos veces lo mismo.
      */}
      {elegida ? (
        <View style={estilos.afiladoElegido}>
          <Text style={estilos.afiladoCodigo}>{elegida.codigo}</Text>
          <Text style={estilos.afiladoDescripcion}>{elegida.descripcion}</Text>
          <Text style={estilos.afiladoPrecio}>
            {elegida.precio_pesos
              ? `${formatearPesos(Number(elegida.precio_pesos))} cada una${
                  unidades > 1
                    ? ` · ${unidades} = ${formatearPesos(
                        totalAfiladoMecha(Number(elegida.precio_pesos), unidades),
                      )}`
                    : ''
                }`
              : 'Falta la cotización para pasarlo a pesos'}
          </Text>
        </View>
      ) : material && !pideDientes ? (
        /*
          La lista de afilado no cubre todas las mechas en metal duro: barreno,
          practiwall y plegado no tienen precio de metal duro. Se dice, en vez
          de proponer el código de otra mecha, que es lo que se cobraría mal.
        */
        <Aviso tono="atencion" titulo="Sin precio de lista para esa mecha">
          La lista de afilado no tiene {ETIQUETA_TIPO_MECHA[item.tipo_mecha!]} en metal
          duro. Cargá el código y el precio total a mano, o consultá con la oficina.
        </Aviso>
      ) : null}
    </View>
  )
}

/**
 * Elegir la mecha de la lista del tipo.
 *
 * Es el reemplazo de tipear el código de memoria: se elige el modelo y de ahí
 * salen solos el código de cómputo, el precio y las medidas que la lista trae.
 * Lo único que queda por poner son las unidades.
 */
function SelectorModeloMecha({
  item,
  alCambiar,
}: {
  item: FormularioItemNota
  alCambiar: (cambios: Partial<FormularioItemNota>) => void
}) {
  const { colores } = usarTema()
  const estilos = usarEstilos()
  const [modelos, setModelos] = useState<ModeloMecha[]>([])
  const [cargando, setCargando] = useState(false)
  const [fallo, setFallo] = useState(false)

  useEffect(() => {
    if (!item.tipo_mecha) return
    let cancelado = false
    setCargando(true)
    setFallo(false)
    mechasDelTipo(item.tipo_mecha)
      .then((m) => {
        if (!cancelado) setModelos(m)
      })
      .catch(() => {
        if (!cancelado) {
          setModelos([])
          setFallo(true)
        }
      })
      .finally(() => {
        if (!cancelado) setCargando(false)
      })
    return () => {
      cancelado = true
    }
  }, [item.tipo_mecha])

  /**
   * Este selector NO cotiza. Dice cuál de las mechas es.
   *
   * Escribía el código del producto en `codigos_computo` y el precio de lista
   * en `precio`, y de ahí salía el importe del renglón: afilar una pasante de
   * 4 mm se cobraba $ 31.406,10 —lo que sale comprarla, pasada a pesos— en vez
   * de $ 10.528, que es lo que dice la lista de afilado. Y no era un caso raro:
   * era el único camino, porque ninguna pantalla ofrecía los códigos de
   * afilado. Ahora los elige `SelectorAfiladoMecha`, acá arriba.
   *
   * Lo que sí deja puesto es lo que identifica la pieza —el diámetro, el largo
   * útil, la mano y la descripción del catálogo—, que es lo que necesita el
   * taller para saber qué le llegó y el vendedor para no medir a mano.
   *
   * El código de producto va a `codigo_herramienta`, que es su casillero: en un
   * renglón de servicio no interviene en ninguna cuenta.
   */
  const elegido = item.codigo_herramienta

  function elegir(m: ModeloMecha) {
    const c = caracteristicasDeArticulo(m.descripcion, m.medida)

    /*
      La mano y los filos vienen con el modelo, de su columna en el catálogo.

      La mano se leía de la descripción, y la lista tiene una errata: MCIR0670
      dice "MECHA CIEGA DER." siendo izquierda —lo dice su propio código,
      MC-I-R— así que se guardaba al revés. Y MCARD0840 y MPDL0570 no dicen ni
      DER ni IZQ, con lo cual el campo quedaba vacío y obligatorio sobre un dato
      que la base ya tenía.

      Los filos sólo los traen las integrales, y son los que eligen el precio
      del afilado. Precargarlos ahorra la única pregunta que quedaba: elegido el
      modelo, el renglón ya está cotizado.
    */
    alCambiar({
      codigo_herramienta: m.codigo,
      descripcion_catalogo: `${m.codigo} · ${m.descripcion}${m.medida ? ` · ${m.medida}` : ''}`,
      ...(c.diametro_exterior ? { diametro: c.diametro_exterior } : {}),
      ...(c.largo ? { largo_util: c.largo } : {}),
      ...(m.mano ? { mano: m.mano } : {}),
      ...(pideDientesLaMecha(item.tipo_mecha, item.mecha_material) && m.cantidad_dientes
        ? { mecha_dientes: String(m.cantidad_dientes) }
        : {}),
    })
  }

  if (cargando) {
    return (
      <View style={estilos.bloqueCodigos}>
        <ActivityIndicator size="small" color={colores.rojo} />
      </View>
    )
  }

  if (fallo) {
    return (
      <Aviso tono="atencion" titulo="No pudimos traer los modelos">
        Revisá la señal y volvé a elegir el tipo. Si no aparece, cargá el código y el precio a
        mano.
      </Aviso>
    )
  }

  /*
    La lista se achica con lo que el vendedor ya midio.

    `mechas_del_tipo` filtra por tipo y nada mas, asi que una ciega devuelve 50
    modelos y siguen siendo 50 despues de cargar el diametro y el largo util.
    El vendedor tiene la mecha en la mano y ya la midio: buscar su codigo entre
    cincuenta que no le sirven es trabajo suyo para comodidad nuestra.

    Se compara contra las caracteristicas que la lista trae escritas en la
    descripcion, que son las mismas que `elegir` copia al renglon. Si el filtro
    deja la lista vacia se muestran todos: una medida que no matchea puede ser
    un error de tipeo o una mecha que la lista describe distinto, y esconderlo
    todo seria peor que mostrar de mas.
  */
  const filtradas = modelos.filter((m) => {
    const c = caracteristicasDeArticulo(m.descripcion, m.medida)
    const coincide = (escrito: string, delModelo: string | undefined) =>
      !escrito.trim() || !delModelo || aNumero(escrito) === aNumero(delModelo)
    return (
      coincide(item.diametro, c.diametro_exterior) && coincide(item.largo_util, c.largo)
    )
  })
  const achicada = filtradas.length > 0 && filtradas.length < modelos.length
  const visibles = achicada ? filtradas : modelos

  if (modelos.length === 0) {
    return (
      <Aviso tono="atencion" titulo="Sin modelos cargados">
        La lista de producto no tiene modelos de ese tipo, así que las medidas van a mano. El
        precio del afilado no depende de esto: sale de las respuestas de arriba.
      </Aviso>
    )
  }

  return (
    <View style={estilos.bloqueCodigos}>
      <Text style={estilos.rotulo}>
        ¿CUÁL ES? ({visibles.length} de {modelos.length})
      </Text>
      <Text style={estilos.ayudaModelo}>
        {achicada
          ? 'Achicada con el diámetro y el largo que cargaste. Borralos para ver todos.'
          : 'Para las medidas y para que el taller sepa qué le llegó. El precio del afilado sale de arriba.'}
      </Text>
      {visibles.map((m) => {
        const marcado = m.codigo === elegido
        const c = caracteristicasDeArticulo(m.descripcion, m.medida)
        return (
          <Pressable
            key={m.codigo}
            onPress={() => elegir(m)}
            accessibilityRole="radio"
            accessibilityState={{ selected: marcado }}
            style={({ pressed }) => [
              estilos.opcion,
              marcado && estilos.opcionElegida,
              pressed && estilos.tocado,
            ]}
          >
            <View style={estilos.opcionTexto}>
              <Text style={estilos.opcionCodigo}>
                {marcado ? '● ' : '○ '}
                {m.codigo}
              </Text>
              <Text style={estilos.opcionDesc} numberOfLines={2}>
                {m.descripcion}
                {m.medida ? ` · ${m.medida}` : ''}
                {c.diametro_exterior ? ` · Ø ${c.diametro_exterior} mm` : ''}
              </Text>
            </View>
          </Pressable>
        )
      })}
    </View>
  )
}

/**
 * Elegir qué afilado de cuchilla corresponde.
 *
 * Tres preguntas dan exactamente uno de los seis códigos de la lista, y de ahí
 * sale el precio por cada 100 mm. El total lo pone el largo por las unidades.
 *
 * El perfilado sólo existe en las de dorso ranurado: al elegir "plana" esa
 * opción desaparece en vez de quedar ofreciendo un código que no existe.
 */
function SelectorAfiladoCuchilla({
  item,
  alCambiar,
}: {
  item: FormularioItemNota
  alCambiar: (cambios: Partial<FormularioItemNota>) => void
}) {
  const { colores } = usarTema()
  const estilos = usarEstilos()
  const [opciones, setOpciones] = useState<CodigoCuchilla[]>([])
  const [cargando, setCargando] = useState(true)
  const [fallo, setFallo] = useState(false)

  useEffect(() => {
    let cancelado = false
    codigosAfiladoCuchilla()
      .then((c) => {
        if (!cancelado) setOpciones(c)
      })
      .catch(() => {
        if (!cancelado) setFallo(true)
      })
      .finally(() => {
        if (!cancelado) setCargando(false)
      })
    return () => {
      cancelado = true
    }
  }, [])

  const trabajosPosibles = opciones
    .filter((o) => !item.cuchilla_tipo || o.tipo === item.cuchilla_tipo)
    .map((o) => o.trabajo)

  const elegida =
    item.cuchilla_tipo && item.cuchilla_material && item.cuchilla_trabajo
      ? opciones.find(
          (o) =>
            o.tipo === item.cuchilla_tipo &&
            o.material === item.cuchilla_material &&
            o.trabajo === item.cuchilla_trabajo,
        )
      : undefined

  /**
   * El código y el total salen solos de las tres respuestas y el largo.
   *
   * El precio de lista es por cada 100 mm: una plana HSS de 640 mm son 6,4
   * tramos. Multiplicar por las unidades va después, como en cualquier
   * renglón.
   */
  useEffect(() => {
    if (!elegida) return
    const largo = aNumero(item.largo)
    const unidades = Math.max(1, aNumero(item.cantidad) || 1)
    const total = elegida.precio_pesos
      ? totalAfiladoCuchilla(elegida.precio_pesos, largo, unidades)
      : 0

    const cambios: Partial<FormularioItemNota> = {}
    if (item.codigos_computo[0] !== elegida.codigo) {
      cambios.codigos_computo = [elegida.codigo]
      cambios.descripcion_catalogo = `${elegida.codigo} · ${elegida.descripcion}`
      cambios.sin_cargo = esSinCargo(elegida.descripcion)
    }
    if (total > 0 && Math.abs(total - aNumero(item.precio_total)) > 0.005) {
      cambios.precio_total = String(total)
    }
    if (Object.keys(cambios).length > 0) alCambiar(cambios)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elegida?.codigo, elegida?.precio_pesos, item.largo, item.cantidad])

  if (cargando) {
    return (
      <View style={estilos.bloqueCodigos}>
        <ActivityIndicator size="small" color={colores.rojo} />
      </View>
    )
  }

  if (fallo || opciones.length === 0) {
    return (
      <Aviso tono="atencion" titulo="No pudimos traer los precios de afilado">
        Revisá la señal. Podés cargar el código y el precio total a mano.
      </Aviso>
    )
  }

  const largo = aNumero(item.largo)
  const tramos = largo > 0 ? largo / TRAMO_CUCHILLA_MM : 0

  return (
    <View style={estilos.bloqueCodigos}>
      {/* El tipo se pregunta arriba: sirve también para el rebaje, que no pasa
          por acá. */}
      <Desplegable<CuchillaMaterial>
        etiqueta="MATERIAL"
        obligatorio
        marcador="Elegí el material"
        valor={item.cuchilla_material}
        items={(['hss', 'md'] as CuchillaMaterial[]).map((m) => ({
          valor: m,
          etiqueta: ETIQUETA_CUCHILLA_MATERIAL[m],
        }))}
        alCambiar={(m) => alCambiar({ cuchilla_material: m })}
      />

      <Desplegable<CuchillaTrabajo>
        etiqueta="TRABAJO"
        obligatorio
        marcador="Elegí el trabajo"
        valor={item.cuchilla_trabajo}
        items={(['afilado', 'perfilado'] as CuchillaTrabajo[])
          .filter((t) => trabajosPosibles.includes(t))
          .map((t) => ({ valor: t, etiqueta: ETIQUETA_CUCHILLA_TRABAJO[t] }))}
        alCambiar={(t) => alCambiar({ cuchilla_trabajo: t })}
      />

      {elegida ? (
        <View style={estilos.opcion}>
          <View style={estilos.opcionFila}>
            <Text style={estilos.opcionCodigo}>{elegida.codigo}</Text>
            <Text style={[estilos.opcionPrecio, elegida.a_cotizar && estilos.aCotizar]}>
              {elegida.a_cotizar
                ? 'A cotizar'
                : `${formatearPesos(Number(elegida.precio_pesos))} / ${TRAMO_CUCHILLA_MM} mm`}
            </Text>
          </View>
          <Text style={estilos.opcionDesc}>{elegida.descripcion}</Text>
          {/* La cuenta a la vista: es lo que evita la pregunta de "¿por qué me
              dio ese número?" cuando el largo no es un múltiplo redondo. */}
          <Text style={estilos.opcionNota}>
            {largo > 0
              ? `${formatearMedida(item.largo)} son ${tramos.toLocaleString('es-AR', { maximumFractionDigits: 2 })} tramos de ${TRAMO_CUCHILLA_MM} mm.`
              : `Completá el LARGO: el precio se cobra por cada ${TRAMO_CUCHILLA_MM} mm.`}
          </Text>
        </View>
      ) : (
        <Text style={estilos.opcionNota}>
          Contestá las tres para que salgan el código y el precio.
        </Text>
      )}
    </View>
  )
}

const usarEstilos = hojaDeTema((t) => ({
  cascada: {
    backgroundColor: t.colores.campoBlanco,
    borderWidth: 2,
    borderColor: t.colores.borde,
    borderRadius: radios.sm,
    padding: espaciado.md,
    gap: espaciado.xs,
  },
  cascadaTitulo: {
    fontFamily: t.tipografia.familia.subtitulo,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.tinta,
  },
  cascadaAyuda: {
    fontFamily: t.tipografia.familia.liviana,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.tintaSuave,
  },
  cascadaFila: {
    paddingVertical: espaciado.xs,
    borderTopWidth: 1,
    borderTopColor: t.colores.panelClaro,
  },
  cascadaCodigo: {
    fontFamily: t.tipografia.familia.fuerte,
    fontSize: t.tipografia.tamano.base,
    color: t.colores.tinta,
  },
  cascadaDescripcion: {
    fontFamily: t.tipografia.familia.liviana,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.tintaSuave,
  },
  filaTocada: { opacity: 0.6 },

  // Los campos cortos van de a dos por fila: una medida ocupa cinco caracteres
  // y antes se comía el ancho entero, obligando a scrollear por nada.
  par: { flexDirection: 'row', gap: espaciado.sm },
  tercio: { flex: 1 },
  mitad: { flex: 1 },

  totalDientes: {
    fontFamily: t.tipografia.familia.fuerte,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.verdeOscuro,
    marginTop: -espaciado.xs,
  },

  bloqueRotos: { gap: espaciado.xs },
  lineaRotos: { flexDirection: 'row', alignItems: 'center', gap: espaciado.sm, flexWrap: 'wrap' },
  lineaRotosTexto: {
    fontFamily: t.tipografia.familia.fuerte,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.ambarOscuro,
  },

  verMedidas: { paddingVertical: espaciado.sm },
  verMedidasTexto: {
    fontFamily: t.tipografia.familia.cuerpo,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.rojo,
    textDecorationLine: 'underline',
  },
  opcionRango: {
    flex: 1,
    fontFamily: t.tipografia.familia.liviana,
    fontSize: t.tipografia.tamano.micro,
    color: t.colores.tintaSuave,
    textAlign: 'center',
  },

  herramientaFija: {
    backgroundColor: t.colores.panelClaro,
    borderWidth: 2,
    borderColor: t.colores.borde,
    borderRadius: radios.sm,
    padding: espaciado.md,
    alignItems: 'center',
  },
  herramientaFijaRotulo: {
    fontFamily: t.tipografia.familia.cuerpo,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.tintaSuave,
  },
  herramientaFijaValor: {
    fontFamily: t.tipografia.familia.subtitulo,
    fontSize: t.tipografia.tamano.base,
    color: t.colores.tinta,
  },

  bloqueCodigos: { gap: espaciado.xs },
  rotulo: {
    fontFamily: t.tipografia.familia.cuerpo,
    fontSize: t.tipografia.tamano.base,
    color: t.colores.tinta,
  },
  buscando: { flexDirection: 'row', alignItems: 'center', gap: espaciado.sm },
  buscandoTexto: {
    fontFamily: t.tipografia.familia.liviana,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.tintaSuave,
  },
  elegidos: { flexDirection: 'row', gap: espaciado.xs, flexWrap: 'wrap' },

  opciones: {
    borderWidth: 2,
    borderColor: t.colores.borde,
    borderRadius: radios.sm,
    backgroundColor: t.colores.campoBlanco,
    overflow: 'hidden',
  },
  opcion: {
    paddingHorizontal: espaciado.md,
    paddingVertical: espaciado.sm,
    borderBottomWidth: 1,
    borderBottomColor: t.colores.panelOscuro,
    minHeight: 58,
    justifyContent: 'center',
    gap: 2,
  },
  opcionElegida: { backgroundColor: 'rgba(0,200,83,0.12)' },

  /**
   * El código de afilado que quedó, con su precio.
   *
   * Se dibuja como un resultado y no como una opción para tocar: las respuestas
   * de arriba ya lo eligieron, y un recuadro que se ve pulsable invita a
   * cambiarlo desde un lugar donde no se puede.
   */
  afiladoElegido: {
    borderWidth: 2,
    borderColor: t.colores.borde,
    borderRadius: radios.sm,
    backgroundColor: t.colores.campoBlanco,
    paddingHorizontal: espaciado.md,
    paddingVertical: espaciado.sm,
    gap: 2,
  },
  afiladoCodigo: {
    fontFamily: t.tipografia.familia.subtitulo,
    fontSize: t.tipografia.tamano.sm,
    color: t.colores.tinta,
  },
  afiladoDescripcion: {
    fontFamily: t.tipografia.familia.liviana,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.tintaSuave,
  },
  afiladoPrecio: {
    fontFamily: t.tipografia.familia.fuerte,
    fontSize: t.tipografia.tamano.sm,
    color: t.colores.verdeOscuro,
  },
  /** El material que no se pregunta porque el tipo ya lo contesta. */
  afiladoDato: { gap: 2 },
  afiladoDatoValor: {
    fontFamily: t.tipografia.familia.subtitulo,
    fontSize: t.tipografia.tamano.sm,
    color: t.colores.tinta,
  },
  /** Por qué se elige el modelo, ahora que no es de donde sale el precio. */
  ayudaModelo: {
    fontFamily: t.tipografia.familia.liviana,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.tintaSuave,
  },
  /** El texto del modelo, que comparte fila con el precio de la derecha. */
  opcionTexto: { flex: 1, gap: 2 },
  /** El que todavía no tiene importe: se ve distinto del que sí lo tiene. */
  aCotizar: { color: t.colores.rojo },
  tocado: { opacity: 0.7 },
  opcionFila: { flexDirection: 'row', justifyContent: 'space-between', gap: espaciado.sm },
  opcionCodigo: {
    fontFamily: t.tipografia.familia.subtitulo,
    fontSize: t.tipografia.tamano.sm,
    color: t.colores.tinta,
  },
  opcionPrecio: {
    fontFamily: t.tipografia.familia.fuerte,
    fontSize: t.tipografia.tamano.sm,
    color: t.colores.verdeOscuro,
  },
  opcionDesc: {
    fontFamily: t.tipografia.familia.liviana,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.tintaSuave,
  },
  opcionNota: {
    fontFamily: t.tipografia.familia.liviana,
    fontSize: t.tipografia.tamano.micro,
    color: t.colores.tintaTenue,
  },
}))
