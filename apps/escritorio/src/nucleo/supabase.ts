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
