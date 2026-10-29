import { supabase } from '../nucleo/supabase'
import { type ItemStock } from './stockExcel'

/**
 * Stock de productos del catálogo.
 *
 * El stock vive en una tabla aparte (`stock_articulos`), con clave `codigo`,
 * porque el catálogo se recarga por listas de precios y una columna de stock se
 * perdería en cada actualización. La vista `vista_stock` cruza el catálogo
 * vigente VENDIBLE (es_servicio=false: sin servicios de afilado/reparación/
 * rectificado/etc.) con su stock. Se edita sólo por la RPC `fijar_stock`
 * (admin/administración).
 */

export interface ArticuloStock {
  codigo: string
  descripcion: string
  medida: string | null
  familia: string | null
  precio: number
  moneda: 'ARS' | 'USD' | null
  precio_a_confirmar: boolean
  stock: number
}

/** numeric/entero de Postgres puede venir como string; se normaliza a número. */
function aNum(v: number | string | null | undefined): number {
  const x = typeof v === 'string' ? Number(v) : (v ?? 0)
  return Number.isFinite(x) ? x : 0
}

function normalizar(fila: Record<string, unknown>): ArticuloStock {
  return {
    ...(fila as unknown as ArticuloStock),
    precio: aNum(fila.precio as number | string | null),
    stock: aNum(fila.stock as number | string | null),
  }
}

/**
 * Busca productos por texto (código, descripción o medida). Con el texto vacío
 * trae los primeros por código, para que la página no arranque en blanco. El
 * tope evita traer los ~1.300 productos de una: quien busca refina con el texto.
 */
export async function buscarStock(texto: string, limite = 100): Promise<ArticuloStock[]> {
  let q = supabase
    .from('vista_stock')
    .select('codigo, descripcion, medida, familia, precio, moneda, precio_a_confirmar, stock')
    .order('codigo')
    .limit(limite)

  const t = texto.trim()
  if (t) {
    // En `.or()` la coma separa condiciones y los paréntesis agrupan: se limpian
    // del texto (junto con el comodín %) para que no rompan el filtro.
    const esc = t.replace(/[%,()]/g, ' ')
    q = q.or(`codigo.ilike.%${esc}%,descripcion.ilike.%${esc}%,medida.ilike.%${esc}%`)
  }

  const { data, error } = await q
  if (error) throw error
  return (data ?? []).map(normalizar)
}

/**
 * Fija el stock de un producto (RPC `fijar_stock`, sólo Administración) y
 * devuelve el código y la cantidad guardados —el RPC ya retorna la fila—, para
 * que la página parchee esa fila en la cache sin refetchear toda la vista.
 */
export async function fijarStock(
  codigo: string,
  cantidad: number,
): Promise<{ codigo: string; cantidad: number }> {
  const { data, error } = await supabase.rpc('fijar_stock', {
    p_codigo: codigo,
    p_cantidad: cantidad,
  })
  if (error) throw error
  const fila = data as { codigo?: string; cantidad?: number | string } | null
  return { codigo: fila?.codigo ?? codigo, cantidad: aNum(fila?.cantidad ?? cantidad) }
}

/** El reporte que devuelve `fijar_stock_masivo` (igual en previa y al aplicar). */
export interface ReporteCargaStock {
  dry_run: boolean
  cero_faltantes: boolean
  /** Códigos distintos recibidos del Excel. */
  recibidos: number
  /** Productos vendibles a los que se les carga (o cargó) el stock. */
  productos: number
  /** Códigos que son servicios (afilado/reparación/etc.): se ignoran. */
  servicios: number
  /** Códigos del Excel que no están en el catálogo de precios: se ignoran. */
  no_catalogo: number
  /** Productos con stock que quedan (o quedaron) en 0 por no venir en el Excel. */
  puestos_en_cero: number
  /** Lista (hasta 100) de los códigos que no están en el catálogo, para revisar. */
  faltan_en_catalogo: string[]
}

/**
 * Carga masiva de stock desde el Excel del Gestión (RPC `fijar_stock_masivo`).
 * Con `dryRun` devuelve la PREVIA (clasifica y cuenta, sin escribir). Con
 * `ceroFaltantes` pone en 0 los productos vendibles que no vinieron en el Excel.
 */
export async function fijarStockMasivo(
  items: ItemStock[],
  opts: { ceroFaltantes?: boolean; dryRun?: boolean } = {},
): Promise<ReporteCargaStock> {
  const { data, error } = await supabase.rpc('fijar_stock_masivo', {
    p_items: items,
    p_cero_faltantes: opts.ceroFaltantes ?? false,
    p_dry_run: opts.dryRun ?? false,
  })
  if (error) throw error
  return data as ReporteCargaStock
}

/** Un aviso de stock bajo/agotado (lo genera el trigger al cruzar el umbral). */
export interface AlertaStock {
  id: string
  codigo: string
  nombre: string
  cantidad: number
  tipo: 'bajo' | 'agotado'
  creado_en: string
}

/** Las alertas de stock sin ver (las nuevas), de la más reciente a la más vieja. */
export async function alertasStockNuevas(): Promise<AlertaStock[]> {
  const { data, error } = await supabase
    .from('alertas_stock')
    .select('id, codigo, nombre, cantidad, tipo, creado_en')
    .is('visto_en', null)
    .order('creado_en', { ascending: false })
  if (error) throw error
  return (data ?? []) as AlertaStock[]
}

/** Marca como vistas todas las alertas de stock nuevas (RPC, sólo oficina). */
export async function marcarAlertasStockVistas(): Promise<number> {
  const { data, error } = await supabase.rpc('marcar_alertas_stock_vistas')
  if (error) throw error
  return Number(data ?? 0)
}
