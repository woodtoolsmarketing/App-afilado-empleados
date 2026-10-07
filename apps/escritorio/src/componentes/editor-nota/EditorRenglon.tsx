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
  cabezalAfiladoComoCuchilla,
  camposDelItem,
  esMecanizado,
  codigoMecanizado,
  operacionMecanizado,
  totalMecanizado,
  describirRango,
  descripcionSugerida,
  SIERRA_MARCAS,
  dientesAAfilar,
  esDescripcionSugerida,
  ETIQUETA_HERRAMIENTA,
  herramientaEnLaDescripcion,
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
  SINGULAR_HERRAMIENTA,
  soloNumeros,
  codigoAfiladoMecha,
  DIENTES_MECHA_INTEGRAL,
  materialFijoDeLaMecha,
  medidasDelTipoDePieza,
  pideDientesLaMecha,
  tipoDePieza,
  tiposDePiezaElegibles,
  totalAfiladoMecha,
  totalDeListaDelRenglon,
  unaPieza,
  type CampoItem,
  type CuchillaMaterial,
  type CuchillaTipo,
  type CuchillaTrabajo,
  type FormularioItemNota,
  type Herramienta,
  type ManoMecha,
  type MaterialMecha,
  type SierraClase,
  type TipoMecha,
  type TipoServicio,
} from '@woodtools/compartido'
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'

import {
  agujeroDeFabrica,
  codigosAfiladoCuchilla,
  codigosAfiladoMecha,
  codigosMecanizado,
  mechasDelTipo,
  codigosSinRango,
  medidasDisponibles,
  medidasEnCascada,
  preciosEspecialesDe,
  resolverCodigoDeItem,
  type ArticuloConMedidas,
  type CascadaMedidas,
  type CodigoAfiladoMecha,
  type CodigoCuchilla,
  type CodigoComputo,
  type CodigoMecanizado,
  type ModeloMecha,
} from '../../servicios/notasPedido'
import {
  Aviso,
  Campo,
  CampoConOpciones,
  Casilla,
  Desplegable,
  MensajeError,
  Pastilla,
  SelectorMarca,
} from './Controles'
import { CampoDescuento } from './CampoDescuento'

/**
 * Un renglón de servicio de la nota (port de `GenerarNota/Renglon.tsx`).
 *
 * Qué campos se dibujan lo decide `CAMPOS_POR_HERRAMIENTA`, la misma tabla que
 * usa el validador. El código de cómputo y el precio se buscan solos apenas hay
 * medida: es la lógica que hace que los precios salgan idénticos al celular, y
 * por eso está portada casi literal —sólo cambia el render RN→web—.
 */

const ETIQUETAS: Record<CampoItem, string> = {
  sierra_clase: '¿SIERRA O INCISOR?',
  sierra_marca: 'MARCA (OPCIONAL)',
  cantidad: 'CANTIDAD',
  diametro_exterior: 'Ø EXTERIOR (mm)',
  diametro_interior: 'Ø INTERIOR (mm, opc.)',
  diametro_interior_destino: 'Ø INTERIOR A HACER (mm)',
  diametro: 'Ø (mm)',
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

/** Herramientas cuyo catálogo no tiene un solo código con rango de medida. */
const SIN_RANGOS = new Set<Herramienta>(['mecha', 'cuchilla', 'incisor'])

/** Sólo las fresas y los cabezales llevan "¿en qué máquina la usa?". */
function llevaMaquina(h: Herramienta | '' | null): h is Herramienta {
  return h === 'fresa' || h === 'cabezal'
}

/**
 * Reglas fijas por ancho de corte que empujan al frente el afilado común cuando
 * el catálogo, por ordenar por rango más ajustado, pondría primero un diente
 * CÓNCAVO (otro trabajo, más caro):
 *
 *   · 3,1 y 3,2 mm → 8001, no el 8002 (cóncavo 3–4, más ajustado).
 *   · 4,4 y 4,5 mm → 8005, no el 8006 (cóncavo 4.5–5.5, a 4,5 ordena primero).
 *
 * No lo elige el vendedor: la confirmación obligatoria lo hace mirarlo. Sumar
 * un ancho es una línea más en la tabla. (Port de `Renglon.tsx` del móvil, que
 * es la fuente de la regla —tienen que seguir coincidiendo.)
 */
const CODIGO_SIERRA_POR_ANCHO: { anchos: Set<number>; codigo: string }[] = [
  { anchos: new Set([3.1, 3.2]), codigo: '8001' },
  { anchos: new Set([4.4, 4.5]), codigo: '8005' },
]
function promoverCodigoSierra(
  item: FormularioItemNota,
  encontrados: CodigoComputo[],
): CodigoComputo[] {
  if (item.herramienta !== 'sierra') return encontrados
  const ancho = aNumero(item.ancho_corte)
  const regla = CODIGO_SIERRA_POR_ANCHO.find((r) => r.anchos.has(ancho))
  if (!regla) return encontrados
  const i = encontrados.findIndex((c) => c.codigo === regla.codigo)
  if (i <= 0) return encontrados
  return [encontrados[i], ...encontrados.slice(0, i), ...encontrados.slice(i + 1)]
}

const MEDIDAS = new Set<CampoItem>([
  'diametro_exterior', 'diametro', 'ancho_corte', 'largo', 'ancho',
  'largo_util', 'espesor', 'paso', 'diametro_interior_destino',
])

const CAMPOS_CASCADA: CampoItem[] = [
  'diametro_exterior', 'diametro', 'ancho_corte', 'diametro_interior',
  'cantidad_dientes', 'largo', 'ancho', 'espesor', 'paso', 'largo_util',
]

const CASCADA_VACIA: CascadaMedidas = { total: 0, opciones: {}, articulos: [] }

function etiquetaDientes(servicio: TipoServicio): string {
  if (servicio === 'reparacion') return 'DIENTES A REPARAR'
  if (servicio === 'rectificado') return 'DIENTES A RECTIFICAR'
  if (servicio === 'hermanado') return 'DIENTES A HERMANAR'
  if (servicio === 'mecanizado') return 'CANTIDAD DE DIENTES'
  return 'DIENTES A AFILAR'
}

function etiquetaSiNo(campo: CampoItem, servicio: TipoServicio): string {
  if (campo === 'dientes_rotos') {
    return servicio === 'reparacion' ? '¿TIENE DIENTES DESAFILADOS?' : '¿TIENE DIENTES ROTOS?'
  }
  return ETIQUETAS[campo]
}

export function EditorRenglon({
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
  const [precioAcordado, setPrecioAcordado] = useState<{ codigo: string; precio: number } | null>(
    null,
  )

  // ── Precio acordado con el cliente ──────────────────────────────────────────
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
  const [cascada, setCascada] = useState<CascadaMedidas>(CASCADA_VACIA)
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** El último código que propusimos solos: distingue "lo puso el buscador" de "lo eligió el vendedor". */
  const propuesto = useRef<string | null>(null)

  const herramientas = HERRAMIENTAS_POR_SERVICIO[item.servicio]
  const comoCuchilla = cabezalAfiladoComoCuchilla(item)
  const esCabezalAfilado = item.herramienta === 'cabezal' && item.servicio === 'afilado'
  const esMec = esMecanizado(item)
  const campos = camposDelItem(item)
  const sinRangos = comoCuchilla || esMec || SIN_RANGOS.has(item.herramienta as Herramienta)

  function alTildarDeCuchillas(v: boolean) {
    propuesto.current = null
    if (v) {
      alCambiar({
        cabezal_de_cuchillas: true,
        cantidad_dientes: '',
        precio_por_diente: '',
        ancho_corte: '',
        diametro_exterior: '',
        diametro_interior: '',
        diametro_interior_catalogo: '',
        dientes_rotos: false,
        dientes_rotos_cantidad: '',
        reparar_dientes: null,
        codigo_reparacion: '',
        precio_reparacion_por_diente: '',
        rascadores: '',
        codigo_rascador: '',
        precio_rascador_unitario: '',
        codigos_computo: [],
        precio_total: '',
      })
    } else {
      alCambiar({
        cabezal_de_cuchillas: false,
        largo: '',
        ancho: '',
        espesor: '',
        cuchilla_tipo: null,
        cuchilla_material: null,
        cuchilla_trabajo: null,
        codigos_computo: [],
        precio_total: '',
      })
    }
  }

  const codigoDesactualizado =
    codigos.length > 0 &&
    item.codigos_computo.length > 0 &&
    !item.codigos_computo.some((c) => codigos.some((x) => x.codigo === c))

  // ── Con una sola herramienta posible, se elige sola ─────────────────────────
  useEffect(() => {
    if (herramientas.length === 1 && item.herramienta !== herramientas[0]) {
      alCambiar({ herramienta: herramientas[0] })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.servicio])

  // ── La descripción se completa sola ─────────────────────────────────────────
  useEffect(() => {
    if (!item.herramienta) return
    const sugerida = descripcionSugerida(
      item.herramienta,
      item.servicio,
      item.sierra_clase,
      item.sierra_marca,
    )
    if (item.descripcion !== sugerida && esDescripcionSugerida(item.descripcion)) {
      alCambiar({ descripcion: sugerida })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.herramienta, item.servicio, item.sierra_clase, item.sierra_marca])

  // ── La máquina se propone sola ──────────────────────────────────────────────
  useEffect(() => {
    if (!item.herramienta) return
    if (!llevaMaquina(item.herramienta)) {
      if (item.maquina) alCambiar({ maquina: '' })
      return
    }
    if (item.maquina.trim()) return
    const sugerida = MAQUINA_SUGERIDA[item.herramienta]
    if (sugerida) alCambiar({ maquina: sugerida })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.herramienta])

  // ── Medidas en cascada ──────────────────────────────────────────────────────
  const filtrosCascada: Record<string, string> = {}
  for (const campo of CAMPOS_CASCADA) {
    const v = ((item as unknown as Record<string, string>)[campo] ?? '').trim()
    if (v) filtrosCascada[campo] = v
  }
  const hayMedidaCargada = Object.keys(filtrosCascada).length > 0
  if (item.mano) filtrosCascada.mano = item.mano === 'derecha' ? 'derecha' : 'izquierda'
  if (item.tipo_pieza && item.herramienta !== 'fresa') filtrosCascada.geometria = item.tipo_pieza

  const herramientaCatalogo = item.herramienta
    ? (herramientaEnLaDescripcion(item.herramienta, item.sierra_clase) ?? item.herramienta)
    : null
  const claveCascada = `${herramientaCatalogo ?? ''}|${JSON.stringify(filtrosCascada)}`

  useEffect(() => {
    if (!herramientaCatalogo) {
      setCascada(CASCADA_VACIA)
      return
    }
    let vigente = true
    const t = setTimeout(() => {
      medidasEnCascada(herramientaCatalogo, filtrosCascada)
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

  const agujerosPosibles = cascada.opciones.diametro_interior ?? []

  // ── El agujero de fábrica, sacado de la cascada ─────────────────────────────
  useEffect(() => {
    if (!campos.includes('diametro_interior')) return
    if (agujerosPosibles.length !== 1) return
    const deCatalogo = String(agujerosPosibles[0].valor).replace('.', ',')
    if (deCatalogo !== item.diametro_interior_catalogo) {
      alCambiar({ diametro_interior_catalogo: deCatalogo })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agujerosPosibles.length, agujerosPosibles[0]?.valor, item.diametro_interior_catalogo])

  // ── Búsqueda automática del código de cómputo ───────────────────────────────
  const medidaClave = [item.ancho_corte, item.ancho, item.diametro].join('|')

  useEffect(() => {
    if (temporizador.current) clearTimeout(temporizador.current)
    if (!item.herramienta) return
    if (esMec) return

    let vigente = true
    temporizador.current = setTimeout(async () => {
      setBuscando(true)
      setSinCodigo(false)
      try {
        const hallados = await resolverCodigoDeItem(item)
        if (!vigente) return
        if (hallados === null) {
          setCodigos([])
          return
        }
        // Reglas fijas por ancho de corte: 8001 en 3,1/3,2; 8005 en 4,4/4,5.
        const encontrados = promoverCodigoSierra(item, hallados)
        setCodigos(encontrados)
        if (encontrados.length === 0) {
          setSinCodigo(true)
          return
        }
        const elegidos = item.codigos_computo
        const intocado =
          elegidos.length === 0 ||
          (elegidos.length === 1 && elegidos[0] === propuesto.current)
        if (!intocado) return

        const mejor = encontrados[0]
        propuesto.current = mejor.codigo

        const acordadoDeEsteCodigo =
          precioAcordado && precioAcordado.codigo === mejor.codigo ? precioAcordado.precio : null

        const porDiente = campos.includes('precio_por_diente')
        const unidadesCodigo = Math.max(1, aNumero(item.cantidad) || 1)
        const campoPrecio: Partial<FormularioItemNota> = mejor.a_cotizar
          ? porDiente
            ? { precio_por_diente: '' }
            : { precio_total: '' }
          : porDiente
            ? acordadoDeEsteCodigo !== null
              ? { precio_por_diente: String(acordadoDeEsteCodigo) }
              : mejor.precio_pesos !== null
                ? { precio_por_diente: String(mejor.precio_pesos) }
                : {}
            : mejor.precio_pesos !== null
              ? {
                  precio_total: String(
                    Math.round(Number(mejor.precio_pesos) * unidadesCodigo * 100) / 100,
                  ).replace('.', ','),
                  moneda: 'ARS' as const,
                }
              : {}

        alCambiar({
          codigos_computo: [mejor.codigo],
          ...campoPrecio,
          sin_cargo: esSinCargo(mejor.descripcion),
        })
      } catch {
        if (vigente) setCodigos([])
      } finally {
        if (vigente) setBuscando(false)
      }
    }, 250)

    return () => {
      vigente = false
      if (temporizador.current) clearTimeout(temporizador.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.servicio, medidaClave, item.herramienta, item.dientes_rotos, item.reparar_dientes, precioAcordado])

  // ── Precio total ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!campos.includes('precio_por_diente') || !campos.includes('cantidad_dientes')) return
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

  // ── El código de cómputo del afilado de los rascadores ──────────────────────
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

    void codigosSinRango(item.herramienta, 'afilado')
      .then((todos) => {
        if (cancelado) return
        const rascadores = todos.filter((c) => /AFILADO.*RASCADOR/i.test(c.descripcion))
        const mejor = rascadores.find((c) => /30\s*mm/i.test(c.descripcion)) ?? rascadores[0]
        if (!mejor) {
          setSinCodigoRascador(true)
          return
        }
        if (mejor.codigo === item.codigo_rascador) return
        alCambiar({
          codigo_rascador: mejor.codigo,
          precio_rascador_unitario: mejor.precio_pesos !== null ? String(mejor.precio_pesos) : '',
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

  // ── El código de cómputo de la reparación de los dientes rotos ──────────────
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

  // ── El agujero de fábrica (por diámetro exterior) ───────────────────────────
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

  // ── "¿Qué medidas hay?" ─────────────────────────────────────────────────────
  const [medidas, setMedidas] = useState<CodigoComputo[] | null>(null)
  const [verMedidas, setVerMedidas] = useState(false)

  useEffect(() => {
    if (!verMedidas || !item.herramienta || medidas) return
    void medidasDisponibles(comoCuchilla ? 'cuchilla' : item.herramienta, item.servicio)
      .then(setMedidas)
      .catch(() => setMedidas([]))
  }, [verMedidas, item.herramienta, item.servicio, medidas, comoCuchilla])

  useEffect(() => {
    setMedidas(null)
    setVerMedidas(false)
  }, [item.herramienta, item.servicio, comoCuchilla])

  function aplicarMedidaSugerida(m: CodigoComputo): void {
    if (!item.herramienta) return
    setVerMedidas(false)

    if (m.rango_min === null) {
      propuesto.current = m.codigo
      const porDiente = campos.includes('precio_por_diente')
      const unidades = Math.max(1, aNumero(item.cantidad) || 1)
      const importe = m.precio_pesos !== null ? Number(m.precio_pesos) : null

      const total =
        importe === null
          ? 0
          : item.herramienta === 'cuchilla' || comoCuchilla
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

  function aplicarArticulo(articulo: ArticuloConMedidas) {
    const cambios: Record<string, string> = {}
    for (const campo of CAMPOS_CASCADA) {
      const v = articulo[campo]
      if (v === null || v === undefined) continue
      if (campo === 'diametro_interior') {
        cambios.diametro_interior_catalogo = String(v).replace('.', ',')
        continue
      }
      cambios[campo] = String(v).replace('.', ',')
    }
    if (typeof articulo.mano === 'string') cambios.mano = articulo.mano
    alCambiar(cambios as Partial<FormularioItemNota>)
  }

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

  function rotulo(campo: CampoItem): string {
    if (campo === 'largo' && item.servicio === 'rebaje') return 'LARGO DE HOY (mm)'
    if (campo === 'cantidad') {
      return comoCuchilla ? `CANTIDAD DE ${SINGULAR_HERRAMIENTA.cuchilla}` : 'CANTIDAD'
    }
    return ETIQUETAS[campo]
  }

  function campoNumerico(campo: CampoItem, etiqueta: string): ReactNode {
    const valor = (item as unknown as Record<string, string>)[campo] ?? ''
    const esPrecio = campo === 'precio_por_diente' || campo === 'precio_total'
    const esMedida = MEDIDAS.has(campo)

    const esTotalCalculado =
      campo === 'precio_total' &&
      campos.includes('precio_por_diente') &&
      campos.includes('cantidad_dientes')

    const delTipo =
      item.herramienta === 'cuchilla' || comoCuchilla ? medidasDeLaCuchilla(item.cuchilla_tipo) : null
    const estandar =
      delTipo && campo === 'ancho'
        ? delTipo.anchos
        : delTipo && campo === 'espesor'
          ? delTipo.espesores
          : null

    const opciones = estandar
      ? estandar.map((v) => ({ valor: v, cantidad: 0 }))
      : (cascada.opciones[campo] ?? [])

    const escribir = (t: string) =>
      alCambiar({
        [campo]: esMedida ? normalizarMedida(t) : soloNumeros(t),
      } as Partial<FormularioItemNota>)

    if (opciones.length > 0 && !esTotalCalculado) {
      return (
        <CampoConOpciones
          etiqueta={etiqueta}
          obligatorio
          value={valor}
          onChange={escribir}
          opciones={opciones.map((o) => ({ valor: String(o.valor), cantidad: o.cantidad }))}
          alElegir={(v) => alCambiar({ [campo]: v } as Partial<FormularioItemNota>)}
          error={errores[campo]}
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
        etiqueta={etiqueta}
        obligatorio
        value={valor}
        disabled={esTotalCalculado}
        onChange={escribir}
        inputMode="decimal"
        error={errores[campo]}
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

  const selectorHerramienta =
    herramientas.length > 1 ? (
      <Desplegable<Herramienta>
        etiqueta="HERRAMIENTA"
        obligatorio
        marcador="Elegí la herramienta"
        valor={item.herramienta}
        items={herramientas.map((h) => ({ valor: h, etiqueta: ETIQUETA_HERRAMIENTA[h] }))}
        onChange={(h) =>
          alCambiar({
            herramienta: h,
            codigos_computo: [],
            cantidad_dientes: '',
            precio_por_diente: '',
            precio_total: '',
            dientes_rotos: false,
            dientes_rotos_cantidad: '',
            reparar_dientes: null,
            rascadores: '',
            sin_cargo: false,
            cabezal_de_cuchillas: false,
            ...(h !== 'sierra' ? { sierra_marca: null } : {}),
            ...(item.maquina && (!llevaMaquina(h) || !maquinasDeLaHerramienta(h).includes(item.maquina))
              ? { maquina: '' }
              : {}),
          })
        }
        error={errores.herramienta}
      />
    ) : item.herramienta ? (
      <div className="campo">
        <label>HERRAMIENTA A {rotuloServicio(item.servicio)}</label>
        <div style={{ fontWeight: 700, fontSize: 15 }}>{ETIQUETA_HERRAMIENTA[item.herramienta]}</div>
      </div>
    ) : null

  const selectorMaquina = llevaMaquina(item.herramienta) ? (
    <Desplegable<string>
      etiqueta="¿QUÉ MÁQUINA?"
      marcador="Elegí la máquina"
      valor={item.maquina || null}
      items={maquinasDeLaHerramienta(item.herramienta).map((m) => ({ valor: m, etiqueta: m.toUpperCase() }))}
      onChange={(m) => alCambiar({ maquina: m })}
    />
  ) : null

  // ── Armado de los campos de la herramienta (grid; full-width spanean) ───────
  const renderUno = (campo: CampoItem): ReactNode => {
    if (campo === 'tipo_mecha') return null

    if (campo === 'sierra_clase') {
      return (
        <Desplegable<SierraClase>
          etiqueta={ETIQUETAS[campo]}
          obligatorio
          marcador="Elegí cuál de los dos es"
          valor={item.sierra_clase}
          items={(['sierra', 'incisor'] as SierraClase[]).map((c) => ({
            valor: c,
            etiqueta: ETIQUETA_SIERRA_CLASE[c],
            descripcion: QUE_ES_EL_DISCO[c],
          }))}
          onChange={(c) => alCambiar({ sierra_clase: c, diametro_interior_catalogo: '' })}
          error={errores.sierra_clase}
        />
      )
    }

    if (campo === 'sierra_marca') {
      return (
        <SelectorMarca
          etiqueta={ETIQUETAS[campo]}
          valor={item.sierra_marca}
          marcas={SIERRA_MARCAS}
          onChange={(m) => alCambiar({ sierra_marca: m })}
          ayuda="La trae el cliente: dejala vacía si no la sabés."
        />
      )
    }

    if (campo === 'tipo_pieza') {
      const tipos = tiposDePiezaElegibles(item.herramienta)
      if (tipos.length === 0) return null
      const elegido = tipoDePieza(item.herramienta, item.tipo_pieza)
      return (
        <div>
          <Desplegable
            etiqueta={`TIPO DE ${unaPieza(item.herramienta).toUpperCase()}`}
            obligatorio
            marcador="Elegí el tipo"
            valor={item.tipo_pieza}
            items={tipos.map((t) => ({ valor: t.valor, etiqueta: t.etiqueta, descripcion: t.descripcion }))}
            onChange={elegirTipoDePieza}
            error={errores.tipo_pieza}
          />
          {elegido?.notas ? <Aviso>{elegido.notas}</Aviso> : null}
        </div>
      )
    }

    if (campo === 'precio_total' && item.servicio === 'rebaje') {
      return (
        <Aviso titulo="El rebaje va a cotizar">
          El importe lo pone la oficina cuando ve cuánto hay que sacarle. El renglón se guarda sin
          precio y no suma al total de la nota.
        </Aviso>
      )
    }

    if (campo === 'largo_rebajado') {
      if (item.servicio !== 'rebaje') return null
      return campoNumerico(campo, ETIQUETAS[campo])
    }

    if (campo === 'cantidad') {
      return campoNumerico(campo, rotulo(campo))
    }

    if (campo === 'cantidad_dientes') {
      if (esMec) {
        return campoNumerico(campo, etiquetaDientes(item.servicio))
      }
      const porHerramienta = aNumero(item.cantidad_dientes)
      const unidades = aNumero(item.cantidad)
      const totalDientes = porHerramienta * unidades
      const rotos = item.dientes_rotos ? aNumero(item.dientes_rotos_cantidad) : 0
      const aAfilar = dientesAAfilar(item)
      return (
        <div>
          {campoNumerico(campo, etiquetaDientes(item.servicio))}
          {unidades > 1 && totalDientes > 0 ? (
            <p style={cuentaEstilo}>{`${unidades} × ${porHerramienta} = ${totalDientes} dientes en total`}</p>
          ) : null}
          {rotos > 0 && totalDientes > 0 ? (
            <p style={cuentaEstilo}>
              {`${totalDientes} − ${rotos} rotos = ${aAfilar} dientes ${
                item.reparar_dientes === true ? 'a rectificar' : 'a afilar'
              }`}
              {item.reparar_dientes === true
                ? `, y los ${rotos} rotos aparte con el código de reparación`
                : ''}
            </p>
          ) : null}
        </div>
      )
    }

    if (campo === 'descripcion') return null

    if (campo === 'diametro_interior') {
      const agujero = agujeroDelRenglon(item)
      const deFabrica = item.diametro_interior_catalogo.trim()

      const etiqueta = esMec ? 'Ø INTERIOR ACTUAL (mm)' : 'Ø INTERIOR (opc.)'
      const ayuda = esMec
        ? agujerosPosibles.length > 1
          ? `${agujerosPosibles.length} agujeros en la lista. Elegí el que tiene, o cargalo.`
          : 'El agujero que la pieza tiene hoy. Abajo cargás el que hay que hacer.'
        : deFabrica
          ? `De fábrica: ${formatearMedida(deFabrica)}. Dejalo vacío si es ése.`
          : agujerosPosibles.length > 1
            ? `${agujerosPosibles.length} agujeros en la lista. Elegí, o cargá otro.`
            : buscandoAgujero
              ? 'Buscando el agujero de fábrica en la lista de precios…'
              : 'Si lo dejás vacío, la nota sale sin agujero.'

      return (
        <div>
          {agujerosPosibles.length > 0 ? (
            <CampoConOpciones
              etiqueta={etiqueta}
              value={item.diametro_interior}
              onChange={(t) => alCambiar({ diametro_interior: normalizarMedida(t) })}
              opciones={agujerosPosibles.map((o) => ({ valor: String(o.valor), cantidad: o.cantidad }))}
              alElegir={(v) => alCambiar({ diametro_interior: v.replace('.', ',') })}
              error={errores.diametro_interior}
              ayuda={ayuda}
            />
          ) : (
            <Campo
              etiqueta={etiqueta}
              value={item.diametro_interior}
              onChange={(t) => alCambiar({ diametro_interior: normalizarMedida(t) })}
              inputMode="decimal"
              error={errores.diametro_interior}
              ayuda={ayuda}
            />
          )}

          {agujero.ajuste !== 'de_fabrica' ? (
            <Aviso
              tono="atencion"
              titulo={agujero.ajuste === 'agrandado' ? 'Agujero agrandado' : 'Lleva buje reductor'}
            >
              {`${formatearMedida(agujero.medida)} contra ${formatearMedida(deFabrica)} de fábrica. Va escrito en la descripción general de la nota.`}
            </Aviso>
          ) : null}
        </div>
      )
    }

    if (campo === 'mano') return null

    if (campo === 'afilado_reparacion') {
      return (
        <Casilla
          etiqueta={etiquetaSiNo(campo, item.servicio)}
          valor={item.afilado_reparacion}
          onChange={(v) => alCambiar({ afilado_reparacion: v })}
        />
      )
    }

    if (campo === 'dientes_rotos') {
      return (
        <Casilla
          etiqueta={etiquetaSiNo(campo, item.servicio)}
          valor={item.dientes_rotos}
          onChange={(v) =>
            alCambiar(
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
                      ? { servicio: item.servicio_antes_de_rotos, servicio_antes_de_rotos: null }
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
        <div>
          <Campo
            etiqueta={ETIQUETAS[campo]}
            value={item.rascadores}
            onChange={(t) => alCambiar({ rascadores: t.replace(/\D/g, '') })}
            inputMode="numeric"
            error={errores.rascadores}
            ayuda="Dejalo vacío si la sierra no lleva. En la lista van pegados a los dientes: Z=18+4 son 18 dientes y 4 rascadores."
          />
          {buscandoRascador ? <p style={buscandoEstilo}>Buscando el código del rascador…</p> : null}
          {linea ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
              <Pastilla texto={linea.codigo || 'sin código'} color="ambar" />
              <span style={{ fontWeight: 700, fontSize: 13 }}>
                {`${linea.cantidad} × ${formatearPesos(linea.precioUnitario)} = ${formatearPesos(linea.total)}`}
              </span>
            </div>
          ) : null}
          {cuantos > 0 && sinCodigoRascador ? (
            <Aviso tono="atencion" titulo="Sin código de rascador">
              El catálogo no tiene el afilado de rascador cargado. Ponelo a mano o consultá con
              Administración.
            </Aviso>
          ) : null}
        </div>
      )
    }

    if (campo === 'dientes_rotos_cantidad') {
      if (!item.dientes_rotos) return null
      return (
        <Campo
          etiqueta={ETIQUETAS[campo]}
          obligatorio
          value={item.dientes_rotos_cantidad}
          onChange={(t) => alCambiar({ dientes_rotos_cantidad: t.replace(/\D/g, '') })}
          inputMode="numeric"
          error={errores.dientes_rotos_cantidad}
          ayuda="Se descuentan de los dientes a afilar."
        />
      )
    }

    if (campo === 'reparar_dientes') {
      if (!item.dientes_rotos) return null
      const lineaReparacion = lineasDelRenglon(item).find((l) => l.concepto === 'reparacion')
      return (
        <div>
          <Desplegable<'si' | 'no'>
            etiqueta={ETIQUETAS[campo]}
            obligatorio
            marcador="Contestá sí o no"
            valor={item.reparar_dientes === null ? null : item.reparar_dientes ? 'si' : 'no'}
            items={[
              { valor: 'si', etiqueta: 'SÍ, REPARARLOS', descripcion: 'Los rotos se reparan y los sanos se rectifican' },
              { valor: 'no', etiqueta: 'NO', descripcion: 'Sólo se descuentan de los dientes a afilar' },
            ]}
            onChange={(v) =>
              alCambiar(
                v === 'si'
                  ? {
                      reparar_dientes: true,
                      codigos_computo: [],
                      ...(item.servicio === 'afilado'
                        ? { servicio: 'rectificado' as const, servicio_antes_de_rotos: 'afilado' as const }
                        : {}),
                    }
                  : {
                      reparar_dientes: false,
                      codigo_reparacion: '',
                      precio_reparacion_por_diente: '',
                      codigos_computo: [],
                      ...(item.servicio_antes_de_rotos
                        ? { servicio: item.servicio_antes_de_rotos, servicio_antes_de_rotos: null }
                        : {}),
                    },
              )
            }
            error={errores.reparar_dientes}
          />
          {buscandoReparacion ? <p style={buscandoEstilo}>Buscando el código de reparación…</p> : null}
          {lineaReparacion ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
              <Pastilla texto={lineaReparacion.codigo || 'sin código'} color="ambar" />
              <span style={{ fontWeight: 700, fontSize: 13 }}>
                {`${lineaReparacion.cantidad} × ${formatearPesos(lineaReparacion.precioUnitario)} = ${formatearPesos(lineaReparacion.total)}`}
              </span>
            </div>
          ) : null}
          {sinCodigoReparacion ? (
            <Aviso tono="atencion" titulo="Sin código de reparación">
              El catálogo no tiene un código de reparación para esa medida. Cargalo a mano o consultá
              con Administración.
            </Aviso>
          ) : null}
          <MensajeError>{errores.codigo_reparacion}</MensajeError>
        </div>
      )
    }

    if (campo === 'codigos_computo' && item.servicio === 'rebaje') {
      return (
        <Aviso titulo="El rebaje va sin código de cómputo">
          No hay tarifa de rebaje en la lista: se cotiza cada uno. Escribí el importe en PRECIO TOTAL
          y la oficina le pone el código al facturar.
        </Aviso>
      )
    }

    if (campo === 'codigos_computo') {
      if (esMec) {
        return (
          <div>
            <SelectorMecanizado item={item} alCambiar={alCambiar} />
            <MensajeError>{errores.codigos_computo}</MensajeError>
          </div>
        )
      }
      const codigoElegido = item.codigos_computo[0] ?? null
      const codigoConfirmado = codigoElegido !== null && item.codigo_confirmado === codigoElegido
      return (
        <div>
          <label>CÓDIGO DE CÓMPUTO</label>
          {buscando ? <p style={buscandoEstilo}>Buscando el código por la medida…</p> : null}

          {item.codigos_computo.length > 0 ? (
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6 }}>
              {item.codigos_computo.map((c) => (
                <Pastilla key={c} texto={c} color="verde" />
              ))}
            </div>
          ) : null}

          {codigos.length > 0 ? (
            <div
              style={{
                border: '2px solid var(--negro)',
                borderRadius: 'var(--radio)',
                background: 'var(--blanco)',
                overflow: 'hidden',
                marginBottom: 8,
              }}
            >
              {codigos.map((c) => {
                const elegido = item.codigos_computo.includes(c.codigo)
                return (
                  <button
                    key={c.codigo}
                    type="button"
                    onClick={() => alCambiar(alTocarCodigo(item, codigos, c, elegido))}
                    style={{
                      display: 'block',
                      width: '100%',
                      textAlign: 'left',
                      border: 'none',
                      borderBottom: '1px solid var(--panel-oscuro)',
                      borderRadius: 0,
                      background: elegido ? 'rgba(0,200,83,0.12)' : 'none',
                      padding: '8px 12px',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ fontWeight: 700 }}>{c.codigo}</span>
                      <span style={{ fontSize: 12, color: 'var(--tinta-suave)' }}>
                        {describirRango(c.rango_min, c.rango_max)}
                      </span>
                      <span style={{ fontWeight: 700, color: 'var(--verde-oscuro)' }}>
                        {c.a_cotizar
                          ? 'A cotizar'
                          : c.precio_pesos !== null
                            ? formatearPesos(Number(c.precio_pesos))
                            : '—'}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--tinta-suave)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {c.descripcion}
                    </div>
                    {c.moneda === 'USD' ? (
                      <div style={{ fontSize: 11, color: 'var(--tinta-tenue)' }}>
                        {`Lista en US$ ${Number(c.precio).toFixed(2)} · convertido al cambio de hoy`}
                      </div>
                    ) : null}
                  </button>
                )
              })}
            </div>
          ) : null}

          {codigoElegido ? (
            <div
              style={{
                border: `2px solid ${codigoConfirmado ? 'var(--verde-oscuro)' : 'var(--ambar)'}`,
                borderRadius: 'var(--radio)',
                background: 'var(--blanco)',
                padding: '6px 10px',
                marginBottom: 8,
              }}
            >
              <Casilla
                etiqueta={`Confirmo que el código ${codigoElegido} es el correcto`}
                valor={codigoConfirmado}
                onChange={(v) => alCambiar({ codigo_confirmado: v ? codigoElegido : null })}
              />
              {!codigoConfirmado ? (
                <p style={{ fontSize: 12, color: 'var(--tinta-suave)', margin: 0 }}>
                  Revisalo y confirmalo para continuar.
                </p>
              ) : null}
            </div>
          ) : null}

          {codigoDesactualizado ? (
            <Aviso tono="atencion" titulo="La medida cambió">
              El código que está elegido no cubre esta medida. Tocá el que corresponde de la lista
              para actualizar el precio.
            </Aviso>
          ) : null}

          {sinCodigo && !(sinRangos && item.codigos_computo.length > 0) ? (
            sinRangos ? (
              <Aviso tono="atencion" titulo="Esta herramienta no se cotiza por medida">
                {item.herramienta === 'mecha'
                  ? 'El afilado de mechas va por tipo, material y cantidad de filos, no por diámetro. Contestá el material acá arriba y el código sale solo.'
                  : item.herramienta === 'incisor'
                    ? 'El diente del incisor se afila a un precio solo, mida lo que mida: la lista tiene un código y no depende del ancho. Abrí la lista de abajo y elegilo.'
                    : 'La lista de cuchillas es de producto, no de servicio. Abrí la lista de abajo y elegí el código.'}
              </Aviso>
            ) : (
              <Aviso tono="atencion">
                No hay ningún código que cubra esa medida. Mirá abajo qué medidas tiene cargadas el
                catálogo.
              </Aviso>
            )
          ) : null}

          <button type="button" className="chico" style={{ marginBottom: 8 }} onClick={() => setVerMedidas((v) => !v)}>
            {verMedidas ? '▲' : '▼'} {sinRangos ? '¿Qué códigos' : '¿Qué medidas'} hay para{' '}
            {comoCuchilla ? 'CUCHILLAS' : item.herramienta ? ETIQUETA_HERRAMIENTA[item.herramienta] : 'esta herramienta'}?
          </button>

          {verMedidas ? (
            medidas === null ? (
              <p style={buscandoEstilo}>Buscando…</p>
            ) : medidas.length === 0 ? (
              <Aviso tono="atencion">
                Esta herramienta no tiene medidas cargadas en el catálogo: sus precios van por modelo,
                no por rango. Buscá el código por descripción.
              </Aviso>
            ) : (
              <div
                style={{
                  border: '2px solid var(--negro)',
                  borderRadius: 'var(--radio)',
                  background: 'var(--blanco)',
                  overflow: 'hidden',
                  marginBottom: 8,
                }}
              >
                {medidas.map((m) => (
                  <button
                    key={m.codigo}
                    type="button"
                    onClick={() => aplicarMedidaSugerida(m)}
                    style={{
                      display: 'block',
                      width: '100%',
                      textAlign: 'left',
                      border: 'none',
                      borderBottom: '1px solid var(--panel-oscuro)',
                      borderRadius: 0,
                      background: 'none',
                      padding: '8px 12px',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ fontWeight: 700 }}>{m.codigo}</span>
                      <span style={{ fontSize: 12, color: 'var(--tinta-suave)' }}>
                        {m.rango_min === null
                          ? m.precio_pesos !== null
                            ? formatearPesos(Number(m.precio_pesos))
                            : ''
                          : describirRango(m.rango_min, m.rango_max)}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--tinta-suave)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {m.descripcion}
                    </div>
                  </button>
                ))}
              </div>
            )
          ) : null}

          {codigos.length > 1 ? (
            <p style={buscandoEstilo}>
              Uno por herramienta. Si además hay que reparar, contestá ¿TIENE DIENTES ROTOS?; si es
              otra herramienta, usá SUMAR OTRA.
            </p>
          ) : null}

          <MensajeError>{errores.codigos_computo}</MensajeError>
        </div>
      )
    }

    return campoNumerico(campo, rotulo(campo))
  }

  const esFull = (c: CampoItem): boolean =>
    c === 'codigos_computo' ||
    c === 'descripcion' ||
    c === 'tipo_pieza' ||
    c === 'reparar_dientes' ||
    c === 'dientes_rotos' ||
    c === 'afilado_reparacion' ||
    c === 'rascadores' ||
    c === 'diametro_interior' ||
    c === 'cantidad_dientes' ||
    (c === 'precio_total' && item.servicio === 'rebaje')

  // Mismo orden que en el móvil: el DIÁMETRO INTERIOR se dibuja pegado al ANCHO
  // DE CORTE aunque el CÓDIGO caiga entre los dos en la lista de campos.
  const slots = campos
    .map((c) => ({ campo: c, node: renderUno(c), full: esFull(c) }))
    .filter((s) => s.node !== null && s.node !== undefined)
  const iAncho = slots.findIndex((s) => s.campo === 'ancho_corte')
  const iInt = slots.findIndex((s) => s.campo === 'diametro_interior')
  if (iAncho !== -1 && iInt > iAncho + 1) {
    const [interior] = slots.splice(iInt, 1)
    slots.splice(iAncho + 1, 0, interior)
  }

  return (
    <div>
      <div style={rejillaCampos}>
        <div style={{ gridColumn: '1 / -1' }}>{selectorHerramienta}</div>
        {selectorMaquina ? <div style={{ gridColumn: '1 / -1' }}>{selectorMaquina}</div> : null}

        {item.herramienta === 'mecha' ? (
          <div style={{ gridColumn: '1 / -1' }}>
            <Desplegable<TipoMecha>
              etiqueta="TIPO DE MECHA"
              obligatorio
              marcador="Elegí el tipo"
              valor={item.tipo_mecha}
              items={(Object.keys(ETIQUETA_TIPO_MECHA) as TipoMecha[]).map((t) => ({
                valor: t,
                etiqueta: ETIQUETA_TIPO_MECHA[t],
              }))}
              onChange={(t) =>
                alCambiar({
                  tipo_mecha: t,
                  mano: null,
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
          </div>
        ) : null}

        {item.herramienta === 'mecha' && item.tipo_mecha && MECHAS_CON_MANO.includes(item.tipo_mecha) ? (
          <div style={{ gridColumn: '1 / -1' }}>
            <Desplegable<ManoMecha>
              etiqueta="¿ES DERECHA O IZQUIERDA?"
              obligatorio
              marcador="Elegí"
              valor={item.mano}
              items={[
                { valor: 'derecha', etiqueta: 'DERECHA' },
                { valor: 'izquierda', etiqueta: 'IZQUIERDA' },
              ]}
              onChange={(m) => alCambiar({ mano: m })}
              error={errores.mano}
            />
          </div>
        ) : null}

        {item.herramienta === 'mecha' && item.tipo_mecha ? (
          <div style={{ gridColumn: '1 / -1' }}>
            <SelectorAfiladoMecha item={item} alCambiar={alCambiar} />
          </div>
        ) : null}

        {item.herramienta === 'mecha' && item.tipo_mecha ? (
          <div style={{ gridColumn: '1 / -1' }}>
            <SelectorModeloMecha item={item} alCambiar={alCambiar} />
          </div>
        ) : null}

        {esCabezalAfilado ? (
          <div style={{ gridColumn: '1 / -1' }}>
            <Casilla
              etiqueta="¿ES DE CUCHILLAS?"
              valor={item.cabezal_de_cuchillas}
              onChange={alTildarDeCuchillas}
            />
          </div>
        ) : null}

        {(item.herramienta === 'cuchilla' || comoCuchilla) && item.servicio !== 'venta' ? (
          <div style={{ gridColumn: '1 / -1' }}>
            <Desplegable<CuchillaTipo>
              etiqueta="TIPO DE CUCHILLA"
              obligatorio
              marcador="Elegí el tipo"
              valor={item.cuchilla_tipo}
              items={(['plana', 'dorso_ranurado'] as CuchillaTipo[]).map((t) => ({
                valor: t,
                etiqueta: ETIQUETA_CUCHILLA_TIPO[t],
              }))}
              onChange={(t) =>
                alCambiar({
                  cuchilla_tipo: t,
                  ...(t === 'plana' && item.cuchilla_trabajo === 'perfilado'
                    ? { cuchilla_trabajo: 'afilado' as const }
                    : {}),
                })
              }
            />
          </div>
        ) : null}

        {(item.herramienta === 'cuchilla' || comoCuchilla) &&
        item.servicio !== 'venta' &&
        item.servicio !== 'rebaje' ? (
          <div style={{ gridColumn: '1 / -1' }}>
            <SelectorAfiladoCuchilla item={item} alCambiar={alCambiar} />
          </div>
        ) : null}

        {hayMedidaCargada && cascada.total > 0 ? (
          <div
            style={{
              gridColumn: '1 / -1',
              border: '2px solid var(--negro)',
              borderRadius: 'var(--radio)',
              background: 'var(--blanco)',
              padding: 10,
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 13 }}>
              {cascada.total === 1
                ? 'Una sola del catálogo coincide con esas medidas'
                : `${cascada.total} del catálogo coinciden con esas medidas`}
            </div>
            {cascada.total <= 6 ? (
              cascada.articulos.map((a) => (
                <button
                  key={a.codigo}
                  type="button"
                  onClick={() => aplicarArticulo(a)}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    border: 'none',
                    borderTop: '1px solid var(--panel-claro)',
                    borderRadius: 0,
                    background: 'none',
                    padding: '6px 0',
                  }}
                >
                  <span style={{ fontWeight: 700 }}>{a.codigo}</span>{' '}
                  <span style={{ fontSize: 12, color: 'var(--tinta-suave)' }}>
                    {[a.descripcion, a.marca].filter(Boolean).join(' · ')}
                  </span>
                </button>
              ))
            ) : (
              <p style={{ fontSize: 12, color: 'var(--tinta-suave)', margin: 0 }}>
                Completá otra medida y la lista se achica sola.
              </p>
            )}
          </div>
        ) : null}

        {slots.map((s) => (
          <div key={s.campo} style={s.full ? { gridColumn: '1 / -1' } : undefined}>
            <Fragment>{s.node}</Fragment>
          </div>
        ))}
      </div>

      {precioAcordado !== null ? (
        <Aviso tono="info" titulo="Precio acordado con este cliente">
          {`Se está usando ${formatearPesos(precioAcordado.precio)} en vez del precio de lista.`}
        </Aviso>
      ) : null}

      {item.herramienta ? (
        <CampoDescuento item={item} alCambiar={alCambiar} error={errores.descuento} />
      ) : null}
    </div>
  )
}

const rejillaCampos: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: '0 14px',
}

const cuentaEstilo: React.CSSProperties = {
  fontWeight: 700,
  fontSize: 12.5,
  color: 'var(--verde-oscuro)',
  marginTop: -8,
  marginBottom: 10,
}

const buscandoEstilo: React.CSSProperties = {
  fontSize: 12.5,
  color: 'var(--tinta-suave)',
}

/** Qué cambia al elegir un código de cómputo. Uno por renglón, no varios. (Port literal.) */
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
    precio_por_diente: fuente.a_cotizar
      ? ''
      : fuente.precio_pesos !== null
        ? String(fuente.precio_pesos)
        : item.precio_por_diente,
    sin_cargo: esSinCargo(fuente.descripcion),
  }
}

/** La cuenta que da el precio total, escrita. (Port de `Renglon.tsx`.) */
function cuentaDelRenglon(item: FormularioItemNota): string {
  const lineas = lineasDelRenglon(item).filter((l) => l.cantidad > 0)
  const total = totalDeListaDelRenglon(item)
  if (lineas.length === 0) return formatearPesos(total)

  const partes = lineas.map((l) =>
    l.sinCargo ? `${l.cantidad} sin cargo` : `${l.cantidad} × ${formatearPesos(l.precioUnitario)}`,
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

// ─────────────────────────────────────────────────────────────────────────────
// Sub-selectores (afilado de mecha, mecanizado, modelo de mecha, cuchilla)
// ─────────────────────────────────────────────────────────────────────────────

function SelectorAfiladoMecha({
  item,
  alCambiar,
}: {
  item: FormularioItemNota
  alCambiar: (cambios: Partial<FormularioItemNota>) => void
}) {
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

  const materialFijo = materialFijoDeLaMecha(item.tipo_mecha)
  const material = materialFijo ?? item.mecha_material

  useEffect(() => {
    if (materialFijo && item.mecha_material !== materialFijo) {
      alCambiar({ mecha_material: materialFijo })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [materialFijo, item.mecha_material])

  const pideDientes = pideDientesLaMecha(item.tipo_mecha, material)
  const dientes = pideDientes ? aNumero(item.mecha_dientes) || null : null

  const codigo = codigoAfiladoMecha(item.tipo_mecha, material, dientes)
  const elegida = codigo ? opciones.find((o) => o.codigo === codigo) : undefined

  const cotizadoAlMontar = useRef({ codigo: item.codigos_computo[0] ?? '', cantidad: item.cantidad })

  useEffect(() => {
    if (!elegida) return
    const unidades = Math.max(1, aNumero(item.cantidad) || 1)
    const total = elegida.precio_pesos ? totalAfiladoMecha(elegida.precio_pesos, unidades) : 0

    const cambios: Partial<FormularioItemNota> = {}
    if (item.codigos_computo[0] !== elegida.codigo) {
      cambios.codigos_computo = [elegida.codigo]
      cambios.sin_cargo = esSinCargo(elegida.descripcion)
      cambios.moneda = 'ARS'
    }
    const cambioLoQueCotiza =
      elegida.codigo !== cotizadoAlMontar.current.codigo ||
      item.cantidad !== cotizadoAlMontar.current.cantidad
    if (
      total > 0 &&
      (cambioLoQueCotiza || !item.precio_total.trim()) &&
      Math.abs(total - aNumero(item.precio_total)) > 0.005
    ) {
      cambios.precio_total = String(total).replace('.', ',')
    }
    if (Object.keys(cambios).length > 0) alCambiar(cambios)
    cotizadoAlMontar.current = { codigo: elegida.codigo, cantidad: item.cantidad }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elegida?.codigo, elegida?.precio_pesos, item.cantidad])

  if (cargando) return <p style={buscandoEstilo}>Cargando precios de afilado…</p>
  if (fallo || opciones.length === 0) {
    return (
      <Aviso tono="atencion" titulo="No pudimos traer los precios de afilado">
        Revisá la conexión. Podés cargar el código y el precio total a mano.
      </Aviso>
    )
  }

  const unidades = Math.max(1, aNumero(item.cantidad) || 1)

  return (
    <div>
      {materialFijo ? (
        <div className="campo">
          <label>MATERIAL</label>
          <div style={{ fontWeight: 700 }}>{ETIQUETA_MATERIAL_MECHA[materialFijo]}</div>
          <div style={{ fontSize: 12, color: 'var(--tinta-suave)' }}>
            {materialFijo === 'md'
              ? 'Lo dice el tipo: las integrales son todas de widia.'
              : 'Lo dice el tipo: las mechas de barreno son todas HSS.'}
          </div>
        </div>
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
          onChange={(m) => alCambiar({ mecha_material: m, ...(m === 'hss' ? { mecha_dientes: '' } : {}) })}
        />
      )}

      {pideDientes ? (
        <Desplegable<string>
          etiqueta="¿CUÁNTOS FILOS TIENE?"
          obligatorio
          marcador="Elegí la cantidad"
          valor={item.mecha_dientes || null}
          items={DIENTES_MECHA_INTEGRAL.map((z) => ({ valor: String(z), etiqueta: `Z = ${z}` }))}
          onChange={(z) => alCambiar({ mecha_dientes: z })}
        />
      ) : null}

      {elegida ? (
        <div
          style={{
            border: '2px solid var(--negro)',
            borderRadius: 'var(--radio)',
            background: 'var(--blanco)',
            padding: 10,
          }}
        >
          <div style={{ fontWeight: 700 }}>{elegida.codigo}</div>
          <div style={{ fontSize: 12, color: 'var(--tinta-suave)' }}>{elegida.descripcion}</div>
          <div style={{ fontWeight: 700, color: 'var(--verde-oscuro)' }}>
            {elegida.precio_pesos
              ? `${formatearPesos(Number(elegida.precio_pesos))} cada una${
                  unidades > 1
                    ? ` · ${unidades} = ${formatearPesos(totalAfiladoMecha(Number(elegida.precio_pesos), unidades))}`
                    : ''
                }`
              : 'Falta la cotización para pasarlo a pesos'}
          </div>
        </div>
      ) : material && !pideDientes ? (
        <Aviso tono="atencion" titulo="Sin precio de lista para esa mecha">
          La lista de afilado no tiene {ETIQUETA_TIPO_MECHA[item.tipo_mecha!]} en metal duro. Cargá el
          código y el precio total a mano, o consultá con la oficina.
        </Aviso>
      ) : null}
    </div>
  )
}

function SelectorMecanizado({
  item,
  alCambiar,
}: {
  item: FormularioItemNota
  alCambiar: (cambios: Partial<FormularioItemNota>) => void
}) {
  const [opciones, setOpciones] = useState<CodigoMecanizado[]>([])
  const [cargando, setCargando] = useState(true)
  const [fallo, setFallo] = useState(false)

  useEffect(() => {
    let cancelado = false
    codigosMecanizado()
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

  const herramienta =
    item.herramienta === 'sierra' || item.herramienta === 'fresa' ? item.herramienta : null
  const operacion = operacionMecanizado(
    aNumero(item.diametro_interior),
    aNumero(item.diametro_interior_destino),
  )
  const codigo = codigoMecanizado(herramienta, operacion)
  const elegida = codigo ? opciones.find((o) => o.codigo === codigo) : undefined

  const cotizadoAlMontar = useRef({ codigo: item.codigos_computo[0] ?? '', cantidad: item.cantidad })

  useEffect(() => {
    if (!operacion) {
      if (item.codigos_computo.length > 0 || item.precio_total) {
        alCambiar({ codigos_computo: [], precio_total: '' })
      }
      return
    }
    if (!elegida) return
    const unidades = Math.max(1, aNumero(item.cantidad) || 1)
    const total = elegida.precio_pesos ? totalMecanizado(elegida.precio_pesos, unidades) : 0

    const cambios: Partial<FormularioItemNota> = {}
    if (item.codigos_computo[0] !== elegida.codigo) {
      cambios.codigos_computo = [elegida.codigo]
      cambios.sin_cargo = false
      cambios.moneda = 'ARS'
    }
    const cambioLoQueCotiza =
      elegida.codigo !== cotizadoAlMontar.current.codigo ||
      item.cantidad !== cotizadoAlMontar.current.cantidad
    if (
      total > 0 &&
      (cambioLoQueCotiza || !item.precio_total.trim()) &&
      Math.abs(total - aNumero(item.precio_total)) > 0.005
    ) {
      cambios.precio_total = String(total).replace('.', ',')
    }
    if (Object.keys(cambios).length > 0) alCambiar(cambios)
    cotizadoAlMontar.current = { codigo: elegida.codigo, cantidad: item.cantidad }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operacion, elegida?.codigo, elegida?.precio_pesos, item.cantidad])

  if (cargando) return <p style={buscandoEstilo}>Cargando precios del mecanizado…</p>
  if (fallo || opciones.length === 0) {
    return (
      <Aviso tono="atencion" titulo="No pudimos traer los precios del mecanizado">
        Revisá la conexión. Podés cargar el código y el precio total a mano.
      </Aviso>
    )
  }

  const unidades = Math.max(1, aNumero(item.cantidad) || 1)

  if (!operacion) {
    return (
      <Aviso titulo="Falta el agujero a hacer">
        Cargá el Ø interior que la pieza tiene hoy y el que hay que dejarle. De la diferencia sale si
        es un buje (más chico) o un agrandado (más grande), y con eso el código y el precio.
      </Aviso>
    )
  }

  return (
    <div
      style={{
        border: '2px solid var(--negro)',
        borderRadius: 'var(--radio)',
        background: 'var(--blanco)',
        padding: 10,
      }}
    >
      {elegida ? (
        <>
          <div style={{ fontWeight: 700 }}>
            {operacion === 'buje' ? 'ACHICAR (buje reductor)' : 'AGRANDAR'} · de{' '}
            {item.diametro_interior.trim()} mm a {item.diametro_interior_destino.trim()} mm
          </div>
          <div style={{ fontWeight: 700 }}>{elegida.codigo}</div>
          <div style={{ fontSize: 12, color: 'var(--tinta-suave)' }}>{elegida.descripcion}</div>
          <div style={{ fontWeight: 700, color: 'var(--verde-oscuro)' }}>
            {elegida.precio_pesos
              ? `${formatearPesos(Number(elegida.precio_pesos))} cada una${
                  unidades > 1
                    ? ` · ${unidades} = ${formatearPesos(totalMecanizado(Number(elegida.precio_pesos), unidades))}`
                    : ''
                }`
              : 'Falta la cotización para pasarlo a pesos'}
          </div>
        </>
      ) : (
        <Aviso tono="atencion" titulo="Sin precio de lista para ese mecanizado">
          No encontramos el código en el catálogo. Cargá el código y el precio total a mano, o
          consultá con la oficina.
        </Aviso>
      )}
    </div>
  )
}

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

  const elegido = item.codigo_herramienta

  function elegir(m: ModeloMecha) {
    const c = caracteristicasDeArticulo(m.descripcion, m.medida)
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

  if (cargando) return <p style={buscandoEstilo}>Cargando modelos…</p>
  if (fallo) {
    return (
      <Aviso tono="atencion" titulo="No pudimos traer los modelos">
        Revisá la conexión y volvé a elegir el tipo. Si no aparece, cargá el código y el precio a
        mano.
      </Aviso>
    )
  }

  const filtradas = modelos.filter((m) => {
    const c = caracteristicasDeArticulo(m.descripcion, m.medida)
    const coincide = (escrito: string, delModelo: string | undefined) =>
      !escrito.trim() || !delModelo || aNumero(escrito) === aNumero(delModelo)
    return coincide(item.diametro, c.diametro_exterior) && coincide(item.largo_util, c.largo)
  })
  const achicada = filtradas.length > 0 && filtradas.length < modelos.length
  const visibles = achicada ? filtradas : modelos

  if (modelos.length === 0) {
    return (
      <Aviso tono="atencion" titulo="Sin modelos cargados">
        La lista de producto no tiene modelos de ese tipo, así que las medidas van a mano. El precio
        del afilado no depende de esto: sale de las respuestas de arriba.
      </Aviso>
    )
  }

  return (
    <div>
      <label>
        ¿CUÁL ES? ({visibles.length} de {modelos.length})
      </label>
      <p style={{ fontSize: 12, color: 'var(--tinta-suave)', marginTop: 0 }}>
        {achicada
          ? 'Achicada con el diámetro y el largo que cargaste. Borralos para ver todos.'
          : 'Para las medidas y para que el taller sepa qué le llegó. El precio del afilado sale de arriba.'}
      </p>
      <div
        style={{
          border: '2px solid var(--negro)',
          borderRadius: 'var(--radio)',
          background: 'var(--blanco)',
          overflow: 'hidden',
          maxHeight: 280,
          overflowY: 'auto',
        }}
      >
        {visibles.map((m) => {
          const marcado = m.codigo === elegido
          const c = caracteristicasDeArticulo(m.descripcion, m.medida)
          return (
            <button
              key={m.codigo}
              type="button"
              onClick={() => elegir(m)}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                border: 'none',
                borderBottom: '1px solid var(--panel-oscuro)',
                borderRadius: 0,
                background: marcado ? 'rgba(0,200,83,0.12)' : 'none',
                padding: '8px 12px',
              }}
            >
              <div style={{ fontWeight: 700 }}>
                {marcado ? '● ' : '○ '}
                {m.codigo}
              </div>
              <div style={{ fontSize: 12, color: 'var(--tinta-suave)' }}>
                {m.descripcion}
                {m.medida ? ` · ${m.medida}` : ''}
                {c.diametro_exterior ? ` · Ø ${c.diametro_exterior} mm` : ''}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

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

  const cotizadoAlMontar = useRef({
    codigo: item.codigos_computo[0] ?? '',
    cantidad: item.cantidad,
    largo: item.largo,
  })

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
    const cambioLoQueCotiza =
      elegida.codigo !== cotizadoAlMontar.current.codigo ||
      item.cantidad !== cotizadoAlMontar.current.cantidad ||
      item.largo !== cotizadoAlMontar.current.largo
    if (
      total > 0 &&
      (cambioLoQueCotiza || !item.precio_total.trim()) &&
      Math.abs(total - aNumero(item.precio_total)) > 0.005
    ) {
      cambios.precio_total = String(total)
    }
    if (Object.keys(cambios).length > 0) alCambiar(cambios)
    cotizadoAlMontar.current = { codigo: elegida.codigo, cantidad: item.cantidad, largo: item.largo }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elegida?.codigo, elegida?.precio_pesos, item.largo, item.cantidad])

  if (cargando) return <p style={buscandoEstilo}>Cargando precios de afilado…</p>
  if (fallo || opciones.length === 0) {
    return (
      <Aviso tono="atencion" titulo="No pudimos traer los precios de afilado">
        Revisá la conexión. Podés cargar el código y el precio total a mano.
      </Aviso>
    )
  }

  const largo = aNumero(item.largo)
  const tramos = largo > 0 ? largo / TRAMO_CUCHILLA_MM : 0

  return (
    <div>
      <Desplegable<CuchillaMaterial>
        etiqueta="MATERIAL"
        obligatorio
        marcador="Elegí el material"
        valor={item.cuchilla_material}
        items={(['hss', 'md'] as CuchillaMaterial[]).map((m) => ({
          valor: m,
          etiqueta: ETIQUETA_CUCHILLA_MATERIAL[m],
        }))}
        onChange={(m) => alCambiar({ cuchilla_material: m })}
      />

      <Desplegable<CuchillaTrabajo>
        etiqueta="TRABAJO"
        obligatorio
        marcador="Elegí el trabajo"
        valor={item.cuchilla_trabajo}
        items={(['afilado', 'perfilado'] as CuchillaTrabajo[])
          .filter((t) => trabajosPosibles.includes(t))
          .map((t) => ({ valor: t, etiqueta: ETIQUETA_CUCHILLA_TRABAJO[t] }))}
        onChange={(t) => alCambiar({ cuchilla_trabajo: t })}
      />

      {elegida ? (
        <div
          style={{
            border: '2px solid var(--negro)',
            borderRadius: 'var(--radio)',
            background: 'var(--blanco)',
            padding: 10,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ fontWeight: 700 }}>{elegida.codigo}</span>
            <span style={{ fontWeight: 700, color: elegida.a_cotizar ? 'var(--rojo)' : 'var(--verde-oscuro)' }}>
              {elegida.a_cotizar
                ? 'A cotizar'
                : `${formatearPesos(Number(elegida.precio_pesos))} / ${TRAMO_CUCHILLA_MM} mm`}
            </span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--tinta-suave)' }}>{elegida.descripcion}</div>
          <div style={{ fontSize: 11, color: 'var(--tinta-tenue)' }}>
            {largo > 0
              ? `${formatearMedida(item.largo)} son ${tramos.toLocaleString('es-AR', { maximumFractionDigits: 2 })} tramos de ${TRAMO_CUCHILLA_MM} mm.`
              : `Completá el LARGO: el precio se cobra por cada ${TRAMO_CUCHILLA_MM} mm.`}
          </div>
        </div>
      ) : (
        <p style={{ fontSize: 12, color: 'var(--tinta-tenue)' }}>
          Contestá las tres para que salgan el código y el precio.
        </p>
      )}
    </div>
  )
}
