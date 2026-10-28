import { supabase } from '../nucleo/supabase'

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
