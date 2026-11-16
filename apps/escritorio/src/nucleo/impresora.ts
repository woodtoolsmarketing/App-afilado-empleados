import { supabase } from './supabase'

/**
 * Las impresoras del panel.
 *
 * Hay DOS resolvedores a propósito:
 *
 * - `obtenerImpresora()` → la impresora ACTIVA de la oficina
 *   (`configuracion.impresora_oficina`). Es la que usa la COLA —el agente
 *   automático y el "imprimir a mano" de la cola—: la cola es compartida (notas
 *   de todos los vendedores) y tiene que salir siempre por la impresora de la
 *   oficina, no por la de un puesto cualquiera que tenga el panel abierto.
 *
 * - `obtenerImpresoraDeUsuario()` → la impresora PROPIA del usuario, si tiene una
 *   asignada (`perfiles.impresora_ip`, una IP del catálogo
 *   `configuracion.impresoras`); si no, cae a la activa global. La usa sólo lo que
 *   el usuario imprime a pedido desde el panel (hoy: la reimpresión de una nota).
 *   Sirve para un puesto con su propia impresora (ej. Administración y su respaldo
 *   de emergencia): su reimpresión sale por la de él, sin tocar la cola de todos.
 *
 * Los dos devuelven null cuando no hay ninguna que valga: ahí `imprimirDocumento`
 * del proceso principal cae al diálogo del sistema. Leer la impresora no puede
 * frenar el imprimir, así que ante cualquier error se devuelve lo que haya (o null).
 */
export interface ImpresoraOficina {
  ip: string
  puerto?: number
  ruta?: string
}

type EntradaImpresora = { ip?: string; puerto?: number; ruta?: string; nombre?: string }

function comoImpresora(v: unknown): ImpresoraOficina | null {
  const o = v as EntradaImpresora | undefined
  if (!o?.ip) return null
  return { ip: o.ip, puerto: o.puerto, ruta: o.ruta }
}

/**
 * Antes resolvía SÓLO la impresora de la oficina. Por pedido del dueño —el panel
 * de Administración tiene que imprimir TODO (incluida la cola) por su propia
 * impresora (su respaldo de emergencia .230)— ahora delega en
 * `obtenerImpresoraDeUsuario`: la PROPIA del usuario que tiene el panel abierto,
 * con fallback a la de la oficina para el que no tiene una asignada. La cola la
 * imprime el panel que corre el agente (el de Administración), así que esa cola
 * sale por su impresora; un panel sin impresora propia cae en la de la oficina,
 * como antes.
 */
export async function obtenerImpresora(): Promise<ImpresoraOficina | null> {
  return obtenerImpresoraDeUsuario()
}

/** La impresora propia del usuario para lo que imprime a pedido; si no, la global. */
export async function obtenerImpresoraDeUsuario(): Promise<ImpresoraOficina | null> {
  try {
    // La impresora propia del usuario y la config se piden juntas. getSession() es
    // local (no pega a la red), así que no agrega una vuelta de más.
    const { data: sesion } = await supabase.auth.getSession()
    const uid = sesion.session?.user.id ?? null

    const [perfilRes, configRes] = await Promise.all([
      uid
        ? supabase
            .from('perfiles')
            .select('impresora_ip')
            .eq('id', uid)
            .maybeSingle<{ impresora_ip: string | null }>()
        : Promise.resolve({ data: null, error: null }),
      supabase.from('configuracion').select('clave, valor').in('clave', ['impresoras', 'impresora_oficina']),
    ])

    if (configRes.error) console.warn('[impresora] no pudimos leer la impresora', configRes.error)

    const filas = (configRes.data ?? []) as Array<{ clave: string; valor: unknown }>
    const catalogo = filas.find((f) => f.clave === 'impresoras')?.valor
    const activa = filas.find((f) => f.clave === 'impresora_oficina')?.valor

    // Impresora propia del usuario, si tiene una asignada y sigue en el catálogo.
    const ipPropia = perfilRes.data?.impresora_ip ?? null
    if (ipPropia && Array.isArray(catalogo)) {
      const propia = (catalogo as EntradaImpresora[]).find((i) => i && i.ip === ipPropia)
      const r = comoImpresora(propia)
      if (r) return r
    }

    // Si no, la activa global de la oficina (la de siempre).
    return comoImpresora(activa)
  } catch (e) {
    console.warn('[impresora] falló leer la impresora del usuario', e)
    return null
  }
}
