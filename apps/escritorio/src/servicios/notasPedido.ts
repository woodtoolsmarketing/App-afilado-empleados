import {
  agruparParaNotas,
  aNumero,
  comoCadena,
  comoTexto,
  descripcionGeneralDeLaNota,
  CONDICIONES_CON_DETALLE,
  aplicarSinCargo,
  ENCABEZADO_VACIO,
  esObservacionDelSistema,
  FAMILIA_CATALOGO,
  filaDeItem,
  itemDeFila,
  reconocerHerramienta,
  MEDIDA_PARA_CODIGO,
  sinAvisosDeAgujero,
  sinLineaDeServicio,
  ZONAS,
  type BorradorNota,
  type ClienteBuscado,
  type CondicionVenta,
  type CuchillaMaterial,
  type CuchillaTipo,
  type CuchillaTrabajo,
  type EstadoNotaPedido,
  type FormularioItemNota,
  type FormularioNotaEncabezado,
  type Herramienta,
  type ManoMecha,
  type MaterialMecha,
  type SucursalCliente,
  type TipoMecha,
  type TipoNotaPedido,
  type TipoServicio,
} from '@woodtools/compartido'

import { supabase, tokenDeSesion } from '../nucleo/supabase'

/**
 * Notas de pedido — lado del panel de escritorio.
 *
 * Es el PORT del servicio del móvil (`apps/movil/src/servicios/notasPedido.ts`):
 * mismo RPC, mismo mapeo (que vive en @woodtools/compartido para no divergir),
 * cambiando sólo el cliente de Supabase. Lo que acá hace falta es la parte que
 * alimenta el editor de notas del panel: catálogo, códigos, precios, cliente y
 * el guardado por `modificar_nota_pedido` (admin-only, pasa por encima del
 * papel). El alta de notas, las listas y la impresión siguen en el móvil.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Cotización
// ─────────────────────────────────────────────────────────────────────────────

export interface Cotizacion {
  fecha: string
  compra: number | null
  venta: number
  desde_cache: boolean
  aproximada?: boolean
}

export async function obtenerCotizacion(fecha?: string): Promise<Cotizacion> {
  const { data, error } = await supabase.functions.invoke('cotizacion-dolar', {
    body: fecha ? { fecha } : {},
    headers: { Authorization: `Bearer ${await tokenDeSesion()}` },
  })
  if (error) throw new Error('No pudimos obtener la cotización del dólar. Revisá la conexión.')
  return data as Cotizacion
}

// ─────────────────────────────────────────────────────────────────────────────
// Catálogo
// ─────────────────────────────────────────────────────────────────────────────

export interface ArticuloCatalogo {
  codigo: string
  descripcion: string
  medida: string | null
  precio: number
  moneda: 'ARS' | 'USD' | null
  precio_pesos: number | null
  familia: string | null
  sin_precio: boolean
  diametro_exterior: number | null
  ancho_corte: number | null
  diametro_interior: number | null
  dientes: number | null
}

export interface CodigoComputo {
  codigo: string
  descripcion: string
  precio: number
  moneda: 'ARS' | 'USD' | null
  precio_pesos: number | null
  rango_min: number | null
  rango_max: number | null
  amplitud: number
  /** La lista trae el código pero todavía no el importe: lo pone el vendedor. */
  a_cotizar?: boolean
}

/** Un modelo de mecha del catálogo (ver el móvil para el detalle). */
export interface ModeloMecha {
  codigo: string
  descripcion: string
  medida: string
  precio: number
  moneda: 'ARS' | 'USD' | null
  precio_pesos: number | null
  a_cotizar: boolean
  mano: ManoMecha | null
  cantidad_dientes: number | null
}

export async function mechasDelTipo(tipo: TipoMecha): Promise<ModeloMecha[]> {
  const { data, error } = await supabase.rpc('mechas_del_tipo', { p_tipo: tipo })
  if (error) throw error
  return aplicarSinCargo((data ?? []) as ModeloMecha[])
}

/** Uno de los seis códigos de afilado de cuchilla, ya clasificado. */
export interface CodigoCuchilla {
  codigo: string
  descripcion: string
  precio: number
  moneda: 'ARS' | 'USD' | null
  precio_pesos: number | null
  a_cotizar: boolean
  tipo: CuchillaTipo
  material: CuchillaMaterial
  trabajo: CuchillaTrabajo
}

/** Uno de los cuatro códigos de mecanizado del agujero, ya clasificado. */
export interface CodigoMecanizado {
  codigo: string
  descripcion: string
  precio: number
  moneda: 'ARS' | 'USD' | null
  precio_pesos: number | null
  a_cotizar: boolean
  herramienta: 'sierra' | 'fresa'
  operacion: 'buje' | 'agrandado'
}

/** Uno de los nueve códigos de afilado de mecha, ya clasificado. */
export interface CodigoAfiladoMecha {
  codigo: string
  descripcion: string
  precio: number
  moneda: 'ARS' | 'USD' | null
  precio_pesos: number | null
  a_cotizar: boolean
  material: MaterialMecha
  tipos: TipoMecha[] | null
  dientes: number | null
}

export async function codigosAfiladoMecha(): Promise<CodigoAfiladoMecha[]> {
  const { data, error } = await supabase.rpc('codigos_afilado_mecha')
  if (error) throw error
  return aplicarSinCargo((data ?? []) as CodigoAfiladoMecha[])
}

export async function codigosAfiladoCuchilla(): Promise<CodigoCuchilla[]> {
  const { data, error } = await supabase.rpc('codigos_afilado_cuchilla')
  if (error) throw error
  return aplicarSinCargo((data ?? []) as CodigoCuchilla[])
}

export async function codigosMecanizado(): Promise<CodigoMecanizado[]> {
  const { data, error } = await supabase.rpc('codigos_mecanizado')
  if (error) throw error
  return aplicarSinCargo((data ?? []) as CodigoMecanizado[])
}

export const LISTA_POR_FAMILIA = 40
export const LISTA_SUELTA = 20
export const FAMILIA_COMPLETA = 1000

/** Artículos del catálogo que coinciden con el texto (ver el móvil). */
export async function buscarArticulos(
  texto: string,
  familia?: string | null,
  limite?: number,
): Promise<ArticuloCatalogo[]> {
  const { data, error } = await supabase.rpc('buscar_articulos', {
    p_texto: texto,
    p_limite: limite ?? (familia ? LISTA_POR_FAMILIA : LISTA_SUELTA),
    p_familia: familia ?? null,
  })
  if (error) throw error
  return aplicarSinCargo((data ?? []) as ArticuloCatalogo[])
}

/** Códigos de cómputo cuyo rango cubre la medida, del más ajustado al más amplio. */
export async function buscarCodigoComputo(params: {
  herramienta: Herramienta
  medida: number
  dimension?: string
  servicio?: TipoServicio
}): Promise<CodigoComputo[]> {
  const { data, error } = await supabase.rpc('buscar_codigo_computo', {
    p_familia: FAMILIA_CATALOGO[params.herramienta],
    p_medida: params.medida,
    p_dimension: params.dimension ?? 'ancho_corte',
    p_servicio: params.servicio ?? null,
    p_herramienta: params.herramienta,
  })
  if (error) throw error
  return aplicarSinCargo((data ?? []) as CodigoComputo[])
}

/** Todos los rangos que el catálogo tiene cargados para esa herramienta. */
export async function medidasDisponibles(
  herramienta: Herramienta,
  servicio?: TipoServicio,
): Promise<CodigoComputo[]> {
  const conRango = await codigosDeLaHerramienta(herramienta, servicio, true)
  if (conRango.length > 0) return conRango
  return codigosDeLaHerramienta(herramienta, servicio, false)
}

/** Los códigos de esa herramienta y servicio que NO se cotizan por medida. */
export async function codigosSinRango(
  herramienta: Herramienta,
  servicio?: TipoServicio,
): Promise<CodigoComputo[]> {
  return codigosDeLaHerramienta(herramienta, servicio, false)
}

async function codigosDeLaHerramienta(
  herramienta: Herramienta,
  servicio: TipoServicio | undefined,
  conRango: boolean,
): Promise<CodigoComputo[]> {
  let consulta = supabase
    .from('vista_catalogo_vigente')
    .select(
      'codigo, descripcion, precio, moneda, precio_a_confirmar, rango_min, rango_max, rango_dimension, servicio_sugerido, herramienta_sugerida',
    )
    .or(
      `herramienta_sugerida.eq.${herramienta},` +
        `and(familia.eq.${FAMILIA_CATALOGO[herramienta]},herramienta_sugerida.is.null)`,
    )

  consulta = conRango
    ? consulta.not('rango_min', 'is', null).order('rango_min', { ascending: true })
    : consulta
        .is('rango_min', null)
        .order('servicio_sugerido', { ascending: true, nullsFirst: false })
        .order('herramienta_sugerida', { ascending: true, nullsFirst: false })
        .order('codigo', { ascending: true })
        .limit(60)

  if (servicio) {
    consulta = consulta.or(`servicio_sugerido.is.null,servicio_sugerido.eq.${servicio}`)
  }

  const { data, error } = await consulta
  if (error) throw error

  return aplicarSinCargo(
    (data ?? []).map((c) => {
      const fila = c as Record<string, any>
      const enPesos = fila.moneda !== 'USD' && fila.precio !== null && fila.precio !== undefined
      return {
        ...fila,
        precio_pesos: enPesos ? Number(fila.precio) : null,
        amplitud: 0,
        a_cotizar: fila.precio_a_confirmar === true,
      }
    }) as CodigoComputo[],
  )
}

/** Reconoce en la lista de precios la herramienta que trajo el cliente. */
export async function agujeroDeFabrica(item: FormularioItemNota): Promise<string | null> {
  const diametro = item.diametro_exterior.trim()
  if (!item.herramienta || !diametro) return null

  const candidatos = await buscarArticulos(`D=${diametro.replace(',', '.')}`)
  const coincidencia = reconocerHerramienta(candidatos, {
    diametro_exterior: diametro,
    ancho_corte: item.ancho_corte,
    dientes: item.cantidad_dientes,
  })
  return coincidencia?.caracteristicas.diametro_interior ?? null
}

/** Qué vendedor tiene a cargo esa zona (null si no está asignada o es de varios). */
export async function vendedorDeZona(codigo: string): Promise<string | null> {
  const limpio = codigo.trim()
  if (!limpio) return null

  const { data, error } = await supabase.rpc('vendedor_de_zona', { codigo: limpio })
  if (error) return null
  return typeof data === 'string' && data.trim() ? data.trim() : null
}

// ─────────────────────────────────────────────────────────────────────────────
// Medidas en cascada
// ─────────────────────────────────────────────────────────────────────────────

export interface OpcionMedida {
  valor: number | string
  cantidad: number
}

export interface ArticuloConMedidas {
  codigo: string
  descripcion?: string
  marca?: string
  subrubro_nombre?: string
  notas?: string
  precio?: number
  moneda?: 'ARS' | 'USD'
  a_cotizar?: boolean
  [medida: string]: unknown
}

export interface CascadaMedidas {
  total: number
  opciones: Record<string, OpcionMedida[]>
  articulos: ArticuloConMedidas[]
}

const CASCADA_VACIA: CascadaMedidas = { total: 0, opciones: {}, articulos: [] }

/** Qué medidas siguen siendo posibles, dado lo que ya se eligió (ver el móvil). */
export async function medidasEnCascada(
  herramienta: Herramienta,
  filtros: Record<string, string | number>,
  limite = 20,
): Promise<CascadaMedidas> {
  const limpios: Record<string, string | number> = {}
  for (const [k, v] of Object.entries(filtros)) {
    const texto = String(v ?? '').trim().replace(',', '.')
    if (texto) limpios[k] = texto
  }

  const { data, error } = await supabase.rpc('medidas_en_cascada', {
    p_herramienta: herramienta,
    p_filtros: limpios,
    p_limite: limite,
  })
  if (error) return CASCADA_VACIA
  return (data as CascadaMedidas | null) ?? CASCADA_VACIA
}

// ─────────────────────────────────────────────────────────────────────────────
// Tendencia del cliente
// ─────────────────────────────────────────────────────────────────────────────

export interface TendenciaCliente {
  tipo_nota: TipoNotaPedido | null
  tipo_nota_veces: number
  condicion_venta: CondicionVenta | null
  condicion_detalle: string | null
  condicion_veces: number
  notas_miradas: number
}

export async function tendenciaCliente(clienteId: string): Promise<TendenciaCliente | null> {
  const { data, error } = await supabase.rpc('tendencia_cliente', { p_cliente_id: clienteId })
  if (error) return null

  const fila = (Array.isArray(data) ? data[0] : data) as TendenciaCliente | undefined
  if (!fila || !fila.notas_miradas) return null
  return fila
}

/** Resuelve el código de cómputo a partir de la medida que corresponde a cada herramienta. */
export async function resolverCodigoDeItem(
  item: FormularioItemNota,
  servicio: TipoServicio = item.servicio,
): Promise<CodigoComputo[] | null> {
  if (!item.herramienta) return null

  const campo = MEDIDA_PARA_CODIGO[item.herramienta]
  if (!campo) return null

  const bruto = (item as unknown as Record<string, string>)[campo] ?? ''
  const medida = aNumero(bruto)
  if (!medida) return null

  const dimension = item.herramienta === 'mecha' ? 'diametro' : 'ancho_corte'

  const porMedida = await buscarCodigoComputo({
    herramienta: item.herramienta,
    medida,
    dimension,
    servicio,
  })
  if (porMedida.length > 0 || servicio !== 'rectificado') return porMedida

  // El rectificado no se cotiza por medida: hay un solo código y no tiene rango.
  return medidasDisponibles(item.herramienta, servicio)
}

// ─────────────────────────────────────────────────────────────────────────────
// Precios acordados con el cliente
// ─────────────────────────────────────────────────────────────────────────────

export interface PrecioEspecial {
  codigo: string
  precio: number
  moneda: string
}

export async function preciosEspecialesDe(
  clienteId: string | null,
  codigos: string[],
): Promise<PrecioEspecial[]> {
  if (!clienteId || codigos.length === 0) return []

  const { data, error } = await supabase.rpc('precios_especiales_de', {
    p_cliente_id: clienteId,
    p_codigos: codigos,
  })
  if (error) throw error
  return (data ?? []) as PrecioEspecial[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Traer una nota y modificarla (admin-only, pasa por encima del papel)
// ─────────────────────────────────────────────────────────────────────────────

/** Nota completa con sus renglones, para abrirla en el editor. */
export async function obtenerNota(id: string) {
  const { data, error } = await supabase
    .from('notas_pedido')
    .select(
      '*, items:notas_pedido_items(*), vendedor:perfiles!notas_pedido_vendedor_id_fkey(nombre_completo, codigo_vendedor)',
    )
    .eq('id', id)
    .single()

  if (error) throw error
  return data
}

/**
 * Trae una nota y la devuelve como estaba en el formulario.
 *
 * PORT EXACTO del móvil: usa `obtenerNota` + `itemDeFila` (de compartido) y los
 * mismos helpers de descripción/observaciones/zona. Lo único que no vuelve son
 * las tres respuestas del afilado de cuchillas —su único efecto es elegir el
 * código, y el código sí vuelve—; el renglón queda completo y cotizado igual.
 */
export async function notaParaCorregir(id: string): Promise<BorradorNota> {
  const nota = (await obtenerNota(id)) as Record<string, any>

  const zonaCodigo = comoCadena(nota.zona)
  const zona = ZONAS.find((z) => z.codigo === zonaCodigo)

  const todas: string[] = Array.isArray(nota.observaciones) ? nota.observaciones : []

  const filas: Array<Record<string, unknown>> = Array.isArray(nota.items) ? nota.items : []
  const items = filas
    .slice()
    .sort((a, b) => Number(a.orden ?? 0) - Number(b.orden ?? 0))
    .map(itemDeFila)

  return {
    notaId: id,
    numero: nota.numero ?? null,
    estado: nota.estado as EstadoNotaPedido,
    encabezado: {
      ...ENCABEZADO_VACIO,
      cliente_id: nota.cliente_id ?? null,
      cliente_codigo: comoCadena(nota.cliente_codigo),
      cliente_nombre: comoCadena(nota.cliente_nombre),
      cliente_cuit: comoCadena(nota.cliente_cuit),
      direccion_id: nota.direccion_id ?? null,
      vendedor: comoCadena(nota.vendedor?.nombre_completo),
      vendedor_numero: comoCadena(nota.vendedor_numero),
      zona: zonaCodigo,
      zona_id: zona?.id ?? '',
      datos_cliente: comoCadena(nota.datos_cliente),
      datos_cliente_origen: nota.datos_cliente_origen === 'voz' ? 'voz' : 'texto',
      // Sin lo que le pega la app al guardar —la línea del servicio y los avisos
      // de agujero—: si volvieran al campo como texto del vendedor, al guardar
      // se agregarían de nuevo y cada corrección dejaría una línea más.
      descripcion_herramienta: sinLineaDeServicio(
        sinAvisosDeAgujero(nota.descripcion_herramienta),
      ),
      descripcion_herramienta_origen:
        nota.descripcion_herramienta_origen === 'voz' ? 'voz' : 'texto',
      cliente_nuevo: false,
      cliente_provisorio: nota.estado === 'pendiente_cliente' && !!nota.cliente_id,
    },
    servicios: Array.isArray(nota.servicios) ? (nota.servicios as TipoServicio[]) : [],
    tipoNota: (nota.tipo_nota as TipoNotaPedido | null) ?? null,
    fechaEntrega: nota.fecha_entrega ?? null,
    condicionVenta: (nota.condicion_venta as CondicionVenta | null) ?? null,
    condicionDetalle: comoCadena(nota.condicion_venta_detalle),
    observaciones: todas.filter((o) => !esObservacionDelSistema(o)),
    observacionesDelSistema: todas.filter(esObservacionDelSistema),
    items,
    tipoCambio: comoTexto(nota.tipo_cambio),
    cotizacionFecha: nota.cotizacion_fecha ?? null,
  }
}

export interface DatosModificacionNota {
  notaId: string
  encabezado: FormularioNotaEncabezado
  servicios: TipoServicio[]
  tipoNota: TipoNotaPedido
  fechaEntrega: string
  items: FormularioItemNota[]
  tipoCambio: number
  cotizacionFecha: string | null
  observaciones?: string[]
  /** Las que escribió el servidor, para devolverlas tal cual. */
  observacionesDelSistema?: string[]
  condicionVenta: CondicionVenta
  condicionVentaDetalle?: string
}

/**
 * Guarda la modificación de una nota desde el panel (admin-only).
 *
 * Espejo de `corregirNotaPedido` del móvil —misma lógica de agrupado y mismo
 * `filaDeItem`— pero llama a `modificar_nota_pedido`, que pasa por encima del
 * papel (acepta cualquier estado, incluso impresa) y no toca el ciclo de vida.
 *
 * Una nota es un comprobante y un comprobante no se parte al medio: si lo
 * cargado cruza grupos de facturación, se rechaza con un mensaje claro en vez
 * de guardar la mitad (igual que en el móvil).
 */
export async function modificarNotaPedido(datos: DatosModificacionNota): Promise<void> {
  const grupos = agruparParaNotas(datos.items, datos.tipoCambio)
  if (grupos.length === 0) throw new Error('La nota necesita al menos un renglón')
  if (grupos.length > 1) {
    throw new Error(
      'Lo que quedó cargado tendría que salir en dos notas distintas (el afilado y la venta no van en el mismo comprobante). Sacá de esta nota lo que no corresponda y cargalo aparte.',
    )
  }

  const g = grupos[0]
  const enc = datos.encabezado

  const descripcionGeneral = descripcionGeneralDeLaNota(
    enc.descripcion_herramienta,
    datos.items,
  )

  const observaciones = [
    ...(datos.observaciones ?? []).filter((o) => o.trim()),
    ...(datos.observacionesDelSistema ?? []),
  ]

  const { error } = await supabase.rpc('modificar_nota_pedido', {
    p_nota_id: datos.notaId,
    p_nota: {
      cliente_id: enc.cliente_id,
      cliente_codigo: enc.cliente_codigo || null,
      cliente_nombre: enc.cliente_nombre,
      cliente_cuit: enc.cliente_cuit || null,
      direccion_id: enc.direccion_id,
      zona: enc.zona || null,
      datos_cliente: enc.datos_cliente || null,
      datos_cliente_origen: enc.datos_cliente_origen,
      descripcion_herramienta: descripcionGeneral || null,
      descripcion_herramienta_origen: enc.descripcion_herramienta_origen,
      vendedor_numero: enc.vendedor_numero.trim() || null,
      servicios: g.servicios,
      tipo_nota: datos.tipoNota,
      fecha_entrega: datos.fechaEntrega,
      tipo_cambio: g.llevaTipoDeCambio || g.tieneDolares ? datos.tipoCambio : null,
      cotizacion_fecha: g.llevaTipoDeCambio || g.tieneDolares ? datos.cotizacionFecha : null,
      total: g.total || null,
      observaciones,
      condicion_venta: datos.condicionVenta,
      condicion_venta_detalle: CONDICIONES_CON_DETALLE.includes(datos.condicionVenta)
        ? (datos.condicionVentaDetalle ?? '').trim()
        : null,
    },
    p_items: g.items.map((i, orden) => filaDeItem(i, orden + 1)),
  })

  if (error) throw error
}

// ─────────────────────────────────────────────────────────────────────────────
// Cliente
// ─────────────────────────────────────────────────────────────────────────────

/** Cuántos clientes devuelve una búsqueda (ver el móvil). */
export const LIMITE_CLIENTES = 25

/**
 * Busca clientes por código, razón social o CUIT (RPC `buscar_clientes`).
 *
 * Misma función de Postgres que usa el móvil y el diálogo de asignar cliente:
 * encuentra sin acentos y con las palabras en cualquier orden. Para el editor
 * alcanza con la consulta directa; no se cachea como en el móvil porque acá no
 * se repite tecla por tecla parado en un taller sin señal.
 */
export async function buscarClientes(
  texto: string,
  limite = LIMITE_CLIENTES,
): Promise<ClienteBuscado[]> {
  const { data, error } = await supabase.rpc('buscar_clientes', {
    p_texto: texto,
    p_limite: limite,
  })
  if (error) throw error
  return (data ?? []) as ClienteBuscado[]
}

/**
 * Las direcciones de un cliente, para elegir a qué sucursal va el pedido.
 *
 * El selector de sucursal del editor sólo aparece cuando hay dos o más. Port del
 * móvil (`apps/movil/src/servicios/clientes.ts`): la RLS de `direcciones` deja
 * ver las de cualquier cliente activo, así que alcanza con la consulta directa.
 */
export async function direccionesDeCliente(clienteId: string): Promise<SucursalCliente[]> {
  const { data, error } = await supabase
    .from('direcciones')
    .select(
      'id, etiqueta, direccion_formateada, codigo_postal, lat, lng, localidad, provincia, principal',
    )
    .eq('cliente_id', clienteId)
    .order('principal', { ascending: false })
    .order('creado_en', { ascending: true })

  if (error) throw error
  return (data ?? []) as SucursalCliente[]
}
