import {
  agujeroDelRenglon,
  aNumero,
  caracteristicasDeArticulo,
  esSinCargo,
  ETIQUETA_CUCHILLA_MATERIAL,
  ETIQUETA_CUCHILLA_TIPO,
  ETIQUETA_CUCHILLA_TRABAJO,
  totalAfiladoCuchilla,
  TRAMO_CUCHILLA_MM,
  type CuchillaMaterial,
  type CuchillaTipo,
  type CuchillaTrabajo,
  CAMPOS_POR_HERRAMIENTA,
  colores,
  describirRango,
  descripcionSugerida,
  dientesAAfilar,
  esDescripcionSugerida,
  espaciado,
  ETIQUETA_HERRAMIENTA,
  ETIQUETA_TIPO_MECHA,
  formatearMedida,
  formatearPesos,
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
  tipografia,
  totalDelRenglon,
  type CampoItem,
  type FormularioItemNota,
  type Herramienta,
  type ManoMecha,
  type TipoMecha,
  type TipoServicio,
} from '@woodtools/compartido'
import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'

import {
  Campo,
  CampoConOpciones,
  Casilla,
  Desplegable,
  MensajeError,
} from '../../componentes/Formulario'
import { Aviso, Pastilla } from '../../componentes/Estado'
import {
  agujeroDeFabrica,
  codigosAfiladoCuchilla,
  mechasDelTipo,
  codigosSinRango,
  medidasDisponibles,
  medidasEnCascada,
  type ArticuloConMedidas,
  type CascadaMedidas,
  type CodigoCuchilla,
  resolverCodigoDeItem,
  type CodigoComputo,
  type ModeloMecha,
} from '../../servicios/notasPedido'

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

const ETIQUETAS: Record<CampoItem, string> = {
  cantidad: 'CANTIDAD',
  diametro_exterior: 'DIÁMETRO EXTERIOR',
  diametro_interior: 'DIÁMETRO INTERIOR (OPCIONAL)',
  diametro: 'DIÁMETRO',
  ancho_corte: 'ANCHO DE CORTE',
  largo: 'LARGO',
  ancho: 'ANCHO',
  largo_util: 'LARGO ÚTIL',
  espesor: 'ESPESOR',
  paso: 'PASO',
  descripcion: 'DESCRIPCIÓN',
  cantidad_dientes: 'CANTIDAD DE DIENTES A AFILAR',
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
}: {
  item: FormularioItemNota
  alCambiar: (cambios: Partial<FormularioItemNota>) => void
  errores: Record<string, string | undefined>
}) {
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
    const sugerida = descripcionSugerida(item.herramienta, item.servicio)
    if (item.descripcion !== sugerida && esDescripcionSugerida(item.descripcion)) {
      alCambiar({ descripcion: sugerida })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.herramienta, item.servicio])

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
        alCambiar({
          codigos_computo: [mejor.codigo],
          // Un código a cotizar no trae importe: el campo queda para que lo
          // ponga el vendedor, en vez de heredar el precio de otro código.
          ...(mejor.a_cotizar
            ? { precio_por_diente: '' }
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
  }, [medidaClave, item.herramienta, item.dientes_rotos, item.reparar_dientes])

  // ── Precio total ─────────────────────────────────────────────────────────
  //
  // La cuenta vive en el paquete compartido: dientes × cantidad, menos los
  // rotos, más la reparación si la pidieron. Acá sólo se refleja el resultado.
  useEffect(() => {
    if (!campos.includes('precio_por_diente') || !campos.includes('cantidad_dientes')) return
    const total = totalDelRenglon(item)
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

    // Sin rango no hay medida que cargar: el código SE ELIGE. Es el caso de
    // mechas y cuchillas, donde el precio no depende de una medida. Antes esta
    // función devolvía sin hacer nada y tocar la opción no producía ningún
    // efecto visible.
    if (m.rango_min === null) {
      propuesto.current = m.codigo
      alCambiar({
        codigos_computo: [m.codigo],
        ...(m.a_cotizar
          ? { precio_por_diente: '' }
          : m.precio_pesos !== null
            ? { precio_por_diente: String(m.precio_pesos) }
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
    const opciones = cascada.opciones[campo] ?? []

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
        El modelo de mecha.
        No se cotiza por medida como una sierra: la familia entera del catálogo
        tiene un solo código con rango, así que buscar por diámetro no devolvía
        nunca nada y el vendedor terminaba tipeando el código de memoria. Se
        elige de la lista del tipo, y de ahí salen solos el código, el precio y
        las medidas. Lo único que queda por poner son las unidades.
      */}
      {item.herramienta === 'mecha' && item.tipo_mecha ? (
        <SelectorModeloMecha item={item} alCambiar={alCambiar} />
      ) : null}

      {/*
        El afilado de cuchillas.
        El código no sale de una medida: sale de tres respuestas. El largo no
        elige nada, multiplica, porque el precio de la lista es por cada 100 mm.
      */}
      {item.herramienta === 'cuchilla' && item.servicio !== 'venta' ? (
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
              {campo.map((c) => campoNumerico(c, ETIQUETAS[c], 'tercio'))}
            </View>
          )
        }
        if (campo === 'tipo_mecha') return null

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

        if (campo === 'mano') {
          // Sólo las mechas que tienen mano: preguntarlo en una barreno no
          // significa nada.
          if (!item.tipo_mecha || !MECHAS_CON_MANO.includes(item.tipo_mecha)) return null
          return (
            <Desplegable<ManoMecha>
              key={campo}
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
          )
        }

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

              {sinCodigo ? (
                // Mechas y cuchillas no tienen un solo código con rango: no se
                // cotizan por medida. Decirle "probá otra medida" sería mandarlo
                // a buscar algo que no existe.
                SIN_RANGOS.has(item.herramienta as Herramienta) ? (
                  <Aviso tono="atencion" titulo="Esta herramienta no se cotiza por medida">
                    {item.herramienta === 'mecha'
                      ? 'El afilado de mechas va por tipo y cantidad de filos, no por diámetro. Abrí la lista de abajo y elegí el código.'
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

        // El resto son medidas y precios: todos numéricos.
        const anchoCampo =
          campo === 'precio_total' || campo === 'precio_por_diente' ? 'mitad' : 'tercio'
        return campoNumerico(campo, ETIQUETAS[campo], anchoCampo)
      })}
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
 */
function cuentaDelRenglon(item: FormularioItemNota): string {
  const lineas = lineasDelRenglon(item).filter((l) => l.cantidad > 0)
  const total = totalDelRenglon(item)
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
 * De qué mano es el modelo.
 *
 * Sale de la descripción y no del código: `MCDL0870` dice "MECHA DERECHA
 * LASER" y `MCIL0570` "MECHA IZQUIERDA LASER", pero la letra de mano cae en
 * distinta posición según la sub-familia. El texto lo dice siempre.
 */
function manoDelModelo(m: ModeloMecha): ManoMecha | null {
  const texto = m.descripcion.toUpperCase()
  if (/\bIZQ/.test(texto)) return 'izquierda'
  if (/\bDER/.test(texto)) return 'derecha'
  return null
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

  const esVenta = item.servicio === 'venta'
  const elegido = esVenta ? item.codigo_herramienta : (item.codigos_computo[0] ?? '')

  /**
   * El total sale del precio del modelo por las unidades.
   *
   * En las mechas no se cobra por diente, así que el PRECIO TOTAL era un campo
   * que el vendedor tenía que tipear. Con el modelo elegido el importe ya se
   * sabe: se recalcula solo cuando cambian las unidades.
   */
  useEffect(() => {
    if (esVenta || !elegido) return
    const unitario = aNumero(item.precio)
    if (unitario <= 0) return
    const unidades = Math.max(1, aNumero(item.cantidad) || 1)
    const total = Math.round(unitario * unidades * 100) / 100
    if (Math.abs(total - aNumero(item.precio_total)) > 0.005) {
      alCambiar({ precio_total: String(total) })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.precio, item.cantidad, elegido, esVenta])

  function elegir(m: ModeloMecha) {
    const c = caracteristicasDeArticulo(m.descripcion, m.medida)
    const mano = manoDelModelo(m)
    // Los precios en dólares no se pasan a pesos acá: eso necesita la
    // cotización, que esta pantalla no tiene. Se guarda el de la lista y la
    // nota lo convierte con el tipo de cambio que ya lleva impreso.
    const unitario = m.precio_pesos !== null ? String(m.precio_pesos) : String(m.precio || '')

    alCambiar({
      ...(esVenta ? { codigo_herramienta: m.codigo } : { codigos_computo: [m.codigo] }),
      descripcion_catalogo: `${m.codigo} · ${m.descripcion}${m.medida ? ` · ${m.medida}` : ''}`,
      precio: m.a_cotizar ? '' : unitario,
      moneda: m.moneda === 'USD' ? 'USD' : 'ARS',
      ...(c.diametro_exterior ? { diametro: c.diametro_exterior } : {}),
      ...(c.largo ? { largo_util: c.largo } : {}),
      ...(mano ? { mano } : {}),
      sin_cargo: esSinCargo(m.descripcion),
      // A cotizar: el importe lo pone el vendedor, así que se limpia lo que
      // hubiera quedado de un modelo anterior en vez de dejar un precio ajeno.
      ...(m.a_cotizar ? { precio_total: '' } : {}),
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

  if (modelos.length === 0) {
    return (
      <Aviso tono="atencion" titulo="Sin modelos cargados">
        La lista de precios no tiene modelos para ese tipo. Cargá el código y el precio a mano.
      </Aviso>
    )
  }

  return (
    <View style={estilos.bloqueCodigos}>
      <Text style={estilos.rotulo}>
        MODELO ({modelos.length} en la lista)
      </Text>
      {modelos.map((m) => {
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
            <Text style={[estilos.opcionPrecio, m.a_cotizar && estilos.aCotizar]}>
              {m.a_cotizar
                ? 'A cotizar'
                : m.precio_pesos !== null
                  ? formatearPesos(Number(m.precio_pesos))
                  : `U$S ${m.precio}`}
            </Text>
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

const estilos = StyleSheet.create({
  cascada: {
    backgroundColor: colores.campoBlanco,
    borderWidth: 2,
    borderColor: colores.negro,
    borderRadius: radios.sm,
    padding: espaciado.md,
    gap: espaciado.xs,
  },
  cascadaTitulo: {
    fontFamily: tipografia.familia.subtitulo,
    fontSize: tipografia.tamano.xs,
    color: colores.tinta,
  },
  cascadaAyuda: {
    fontFamily: tipografia.familia.liviana,
    fontSize: tipografia.tamano.xs,
    color: colores.tintaSuave,
  },
  cascadaFila: {
    paddingVertical: espaciado.xs,
    borderTopWidth: 1,
    borderTopColor: colores.panelClaro,
  },
  cascadaCodigo: {
    fontFamily: tipografia.familia.fuerte,
    fontSize: tipografia.tamano.base,
    color: colores.tinta,
  },
  cascadaDescripcion: {
    fontFamily: tipografia.familia.liviana,
    fontSize: tipografia.tamano.xs,
    color: colores.tintaSuave,
  },
  filaTocada: { opacity: 0.6 },

  // Los campos cortos van de a dos por fila: una medida ocupa cinco caracteres
  // y antes se comía el ancho entero, obligando a scrollear por nada.
  par: { flexDirection: 'row', gap: espaciado.sm },
  tercio: { flex: 1 },
  mitad: { flex: 1 },

  totalDientes: {
    fontFamily: tipografia.familia.fuerte,
    fontSize: tipografia.tamano.xs,
    color: colores.verdeOscuro,
    marginTop: -espaciado.xs,
  },

  bloqueRotos: { gap: espaciado.xs },
  lineaRotos: { flexDirection: 'row', alignItems: 'center', gap: espaciado.sm, flexWrap: 'wrap' },
  lineaRotosTexto: {
    fontFamily: tipografia.familia.fuerte,
    fontSize: tipografia.tamano.xs,
    color: colores.ambarOscuro,
  },

  verMedidas: { paddingVertical: espaciado.sm },
  verMedidasTexto: {
    fontFamily: tipografia.familia.cuerpo,
    fontSize: tipografia.tamano.xs,
    color: colores.rojo,
    textDecorationLine: 'underline',
  },
  opcionRango: {
    flex: 1,
    fontFamily: tipografia.familia.liviana,
    fontSize: tipografia.tamano.micro,
    color: colores.tintaSuave,
    textAlign: 'center',
  },

  herramientaFija: {
    backgroundColor: colores.panelClaro,
    borderWidth: 2,
    borderColor: colores.negro,
    borderRadius: radios.sm,
    padding: espaciado.md,
    alignItems: 'center',
  },
  herramientaFijaRotulo: {
    fontFamily: tipografia.familia.cuerpo,
    fontSize: tipografia.tamano.xs,
    color: colores.tintaSuave,
  },
  herramientaFijaValor: {
    fontFamily: tipografia.familia.subtitulo,
    fontSize: tipografia.tamano.base,
    color: colores.tinta,
  },

  bloqueCodigos: { gap: espaciado.xs },
  rotulo: {
    fontFamily: tipografia.familia.cuerpo,
    fontSize: tipografia.tamano.base,
    color: colores.tinta,
  },
  buscando: { flexDirection: 'row', alignItems: 'center', gap: espaciado.sm },
  buscandoTexto: {
    fontFamily: tipografia.familia.liviana,
    fontSize: tipografia.tamano.xs,
    color: colores.tintaSuave,
  },
  elegidos: { flexDirection: 'row', gap: espaciado.xs, flexWrap: 'wrap' },

  opciones: {
    borderWidth: 2,
    borderColor: colores.negro,
    borderRadius: radios.sm,
    backgroundColor: colores.campoBlanco,
    overflow: 'hidden',
  },
  opcion: {
    paddingHorizontal: espaciado.md,
    paddingVertical: espaciado.sm,
    borderBottomWidth: 1,
    borderBottomColor: colores.panelOscuro,
    minHeight: 58,
    justifyContent: 'center',
    gap: 2,
  },
  opcionElegida: { backgroundColor: 'rgba(0,200,83,0.12)' },
  /** El texto del modelo, que comparte fila con el precio de la derecha. */
  opcionTexto: { flex: 1, gap: 2 },
  /** El que todavía no tiene importe: se ve distinto del que sí lo tiene. */
  aCotizar: { color: colores.rojo },
  tocado: { opacity: 0.7 },
  opcionFila: { flexDirection: 'row', justifyContent: 'space-between', gap: espaciado.sm },
  opcionCodigo: {
    fontFamily: tipografia.familia.subtitulo,
    fontSize: tipografia.tamano.sm,
    color: colores.tinta,
  },
  opcionPrecio: {
    fontFamily: tipografia.familia.fuerte,
    fontSize: tipografia.tamano.sm,
    color: colores.verdeOscuro,
  },
  opcionDesc: {
    fontFamily: tipografia.familia.liviana,
    fontSize: tipografia.tamano.xs,
    color: colores.tintaSuave,
  },
  opcionNota: {
    fontFamily: tipografia.familia.liviana,
    fontSize: tipografia.tamano.micro,
    color: colores.tintaTenue,
  },
})
