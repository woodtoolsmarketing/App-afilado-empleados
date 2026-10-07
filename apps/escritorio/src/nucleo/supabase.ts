import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Cliente de Supabase del panel de escritorio.
 *
 * Se usa la clave pública (anon). El panel no tiene ni necesita la clave de
 * servicio: los permisos de administrador salen de RLS, evaluando el rol del
 * usuario que inició sesión. Meter una clave de servicio en una app de
 * escritorio equivaldría a repartir acceso total a la base con cada instalador.
 */

const URL = import.meta.env.VITE_SUPABASE_URL as string
const CLAVE = import.meta.env.VITE_SUPABASE_ANON_KEY as string

if (!URL || !CLAVE) {
  console.error('[WoodTools] Faltan VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY. Ver docs/CONFIGURACION.md')
}

export const supabase: SupabaseClient = createClient(URL, CLAVE, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storageKey: 'woodtools-panel',
  },
  global: { headers: { 'x-aplicacion': 'woodtools-escritorio' } },
})

/**
 * El token de sesión para mandar EXPLÍCITO al invocar una Edge Function.
 *
 * `functions.invoke` depende de que la capa de auth le haya sincronizado el
 * token al cliente. Si venció y el refresh no llegó a tiempo, la request salía
 * sin `Authorization` —aunque el usuario estuviera logueado— y la función
 * contestaba "Falta el token de sesión". `getSession` refresca el token si hace
 * falta; pasándolo a mano en el header, sale siempre. (Espejo del móvil.)
 */
export async function tokenDeSesion(): Promise<string> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session?.access_token) {
    throw new Error('Se cortó la sesión. Salí y volvé a entrar para seguir.')
  }
  return session.access_token
}
