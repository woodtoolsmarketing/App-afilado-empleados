import {
  aNumero,
  FAMILIA_CATALOGO,
  MEDIDA_PARA_CODIGO,
  totalDeRenglones,
  type FormularioItemNota,
  type FormularioNotaEncabezado,
  type Herramienta,
  type TipoNotaPedido,
  type TipoServicio,
} from '@woodtools/compartido'

import { supabase } from '../nucleo/supabase'

/**
 * Notas de pedido.
 *
 * El precio y el código de cómputo se resuelven contra el catálogo importado de
 * las listas del Gestión Comercial. El vendedor no tiene que saberse los
 * códigos ni hacer la cuenta del dólar en la calle.
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
}

export interface CodigoComputo {
  codigo: string
  descripcion: string
  precio: number
  moneda: 'ARS' | 'USD' | null
  precio_pesos: number | null
  rango_min: number
  rango_max: number | null
  amplitud: number
}

export async function buscarArticulos(texto: string): Promise<ArticuloCatalogo[]> {
  const { data, error } = await supabase.rpc('buscar_articulos', { p_texto: texto })
  if (error) throw error
  return (data ?? []) as ArticuloCatalogo[]
}

/**
 * Códigos de cómputo cuyo rango cubre la medida, del más ajustado al más
 * amplio. Los artículos sin precio no aparecen: los completa Administración.
 */
export async function buscarCodigoComputo(params: {
  herramienta: Herramienta
  medida: number
  dimension?: string
}): Promise<CodigoComputo[]> {
  const { data, error } = await supabase.rpc('buscar_codigo_computo', {
    p_familia: FAMILIA_CATALOGO[params.herramienta],
    p_medida: params.medida,
    p_dimension: params.dimension ?? 'ancho_corte',
  })
  if (error) throw error
  return (data ?? []) as CodigoComputo[]
}

/**
 * Resuelve el código de cómputo a partir de la medida que corresponde a cada
 * herramienta (ancho de corte en sierras, ancho en cuchillas, diámetro en
 * mechas). Devuelve null cuando falta la medida, para no buscar en falso.
 */
export async function resolverCodigoDeItem(
  item: FormularioItemNota,
): Promise<CodigoComputo[] | null> {
  if (!item.herramienta) return null

  const campo = MEDIDA_PARA_CODIGO[item.herramienta]
  if (!campo) return null

  const bruto = (item as unknown as Record<string, string>)[campo] ?? ''
  const medida = aNumero(bruto)
  if (!medida) return null

  // En las mechas la medida es el diámetro; en el resto, un ancho.
  const dimension = item.herramienta === 'mecha' ? 'diametro' : 'ancho_corte'
  return buscarCodigoComputo({ herramienta: item.herramienta, medida, dimension })
}

// ─────────────────────────────────────────────────────────────────────────────
// Alta de la nota
// ─────────────────────────────────────────────────────────────────────────────

export interface DatosNuevaNota {
  encabezado: FormularioNotaEncabezado
  servicios: TipoServicio[]
  tipoNota: TipoNotaPedido
  fechaEntrega: string
  items: FormularioItemNota[]
  tipoCambio: number
  cotizacionFecha: string
}

export interface NotaCreada {
  id: string
  numero: number | null
  estado: string
}

/**
 * Crea la nota con todos sus renglones.
 *
 * Si el cliente todavía no existe en el sistema, la nota nace en
 * `pendiente_cliente`: se guarda con el nombre, CUIT, vendedor y zona, pero sin
 * número, hasta que Administración le asigne el código de cliente. El trabajo
 * queda registrado igual — que el alta del cliente esté demorada no puede
 * costarle la venta al vendedor.
 */
export async function crearNotaPedido(datos: DatosNuevaNota): Promise<NotaCreada> {
  const { data: sesion } = await supabase.auth.getSession()
  const vendedorId = sesion.session?.user.id
  if (!vendedorId) throw new Error('No hay sesión')

  const enc = datos.encabezado
  // Sin cliente, o con uno provisorio: la nota no puede recibir numero. Un
  // codigo automatico "P-000123" no es un codigo de cliente.
  const esPendienteCliente = !enc.cliente_id || enc.cliente_provisorio

  const total = totalDeRenglones(datos.items)

  const { data: nota, error } = await supabase
    .from('notas_pedido')
    .insert({
      vendedor_id: vendedorId,
      cliente_id: enc.cliente_id,
      cliente_codigo: enc.cliente_codigo || null,
      cliente_nombre: enc.cliente_nombre,
      cliente_cuit: enc.cliente_cuit || null,
      zona: enc.zona || null,
      datos_cliente: enc.datos_cliente || null,
      datos_cliente_origen: enc.datos_cliente_origen,
      descripcion_herramienta: enc.descripcion_herramienta || null,
      descripcion_herramienta_origen: enc.descripcion_herramienta_origen,
      servicios: datos.servicios,
      tipo_nota: datos.tipoNota,
      estado: esPendienteCliente ? 'pendiente_cliente' : 'pendiente',
      fecha_entrega: datos.fechaEntrega,
      tipo_cambio: datos.tipoCambio,
      cotizacion_fecha: datos.cotizacionFecha,
      total: total || null,
    })
    .select('id, numero, estado')
    .single()

  if (error) throw error

  const items = datos.items.map((i, orden) => ({
    nota_id: nota.id,
    orden: orden + 1,
    servicio: i.servicio,
    herramienta: i.herramienta,
    codigo_herramienta: i.codigo_herramienta || null,
    descripcion: i.descripcion || null,
    cantidad: Math.max(1, Math.round(aNumero(i.cantidad || i.unidades)) || 1),
    cantidad_dientes: aNumero(i.cantidad_dientes) || null,
    precio_unitario: aNumero(i.precio_por_diente || i.precio) || null,
    precio_total: aNumero(i.precio_total || i.precio) || null,
    codigos_computo: i.codigos_computo,
    promocion: i.promocion,
    dientes_rotos: i.dientes_rotos,
    // Las medidas propias de cada herramienta. Se guardan sólo las que tienen
    // valor, para que el detalle no se llene de campos vacíos.
    detalle: Object.fromEntries(
      Object.entries({
        diametro_exterior: i.diametro_exterior,
        diametro: i.diametro,
        ancho_corte: i.ancho_corte,
        largo: i.largo,
        ancho: i.ancho,
        largo_util: i.largo_util,
        espesor: i.espesor,
        paso: i.paso,
        tipo_mecha: i.tipo_mecha,
        mano: i.mano,
        promocion_detalle: i.promocion_detalle,
        afilado_reparacion: i.afilado_reparacion,
      }).filter(([, v]) => v !== '' && v !== null && v !== undefined),
    ),
  }))

  const { error: errItems } = await supabase.from('notas_pedido_items').insert(items)
  if (errItems) {
    // La nota sin renglones no sirve para nada y confundiría en la lista de
    // pendientes: se borra para no dejar basura a medio guardar.
    await supabase.from('notas_pedido').delete().eq('id', nota.id)
    throw errItems
  }

  return nota as NotaCreada
}

// ─────────────────────────────────────────────────────────────────────────────
// Consulta
// ─────────────────────────────────────────────────────────────────────────────

export interface NotaResumen {
  id: string
  numero: number | null
  tipo_nota: TipoNotaPedido | null
  estado: string
  cliente_codigo: string | null
  cliente_nombre: string
  total: number | null
  creado_en: string
  servicios: TipoServicio[]
}

export async function notasPendientes(): Promise<NotaResumen[]> {
  const { data, error } = await supabase
    .from('notas_pedido')
    .select('id, numero, tipo_nota, estado, cliente_codigo, cliente_nombre, total, creado_en, servicios')
    .in('estado', ['pendiente', 'pendiente_cliente'])
    .order('creado_en', { ascending: false })

  if (error) throw error
  return (data ?? []) as NotaResumen[]
}

export interface DiaNotas {
  fecha: string
  cantidad: number
  detalle: Array<{
    nota_id: string
    numero: number | null
    tipo_nota: TipoNotaPedido | null
    estado: string
    cliente_codigo: string | null
    cliente_nombre: string
    hora: string
    total: number | null
    servicios: TipoServicio[]
  }>
}

export async function historialNotas(desde?: string, hasta?: string): Promise<DiaNotas[]> {
  const { data, error } = await supabase.rpc('historial_notas_pedido', {
    p_desde: desde ?? null,
    p_hasta: hasta ?? null,
  })
  if (error) throw error
  return (data ?? []) as DiaNotas[]
}

/** Nota completa con sus renglones, para verla o imprimirla. */
export async function obtenerNota(id: string) {
  const { data, error } = await supabase
    .from('notas_pedido')
    .select('*, items:notas_pedido_items(*), vendedor:perfiles!notas_pedido_vendedor_id_fkey(nombre_completo, codigo_vendedor)')
    .eq('id', id)
    .single()

  if (error) throw error
  return data
}

export async function marcarImpresas(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const { error } = await supabase
    .from('notas_pedido')
    .update({ estado: 'impresa', impresa_en: new Date().toISOString() })
    .in('id', ids)
  if (error) throw error
}
