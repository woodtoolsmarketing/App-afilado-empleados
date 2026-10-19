import { supabase } from './supabase'

/**
 * La impresora de la oficina para mandar el trabajo directo por IPP.
 *
 * Es la MISMA fila que leen el teléfono, la cola de impresión, los roles y las
 * cobranzas (`configuracion.impresora_oficina`), así que la IP (y el nombre que
 * eligió el selector del panel) se cargan en un solo lado y valen para todos.
 * Devuelve null cuando no hay ninguna cargada: ahí `imprimirDocumento` del
 * proceso principal cae al diálogo del sistema.
 */
export interface ImpresoraOficina {
  ip: string
  puerto?: number
  ruta?: string
}

export async function obtenerImpresora(): Promise<ImpresoraOficina | null> {
  try {
    const { data, error } = await supabase
      .from('configuracion')
      .select('valor')
      .eq('clave', 'impresora_oficina')
      .maybeSingle()

    // "No hay IP" y "no pude leerla" se ven igual desde afuera; se anota el
    // segundo, pero en los dos casos se devuelve null y la impresión cae al
    // diálogo. No leer la IP no puede frenar el imprimir.
    if (error) console.warn('[impresora] no pudimos leer la impresora de la oficina', error)

    const cfg = data?.valor as { ip?: string; puerto?: number; ruta?: string } | undefined
    if (!cfg?.ip) return null
    return { ip: cfg.ip, puerto: cfg.puerto, ruta: cfg.ruta }
  } catch (e) {
    console.warn('[impresora] falló leer la impresora de la oficina', e)
    return null
  }
}
