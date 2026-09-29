import 'react-native-url-polyfill/auto'

import AsyncStorage from '@react-native-async-storage/async-storage'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import Constants from 'expo-constants'
import * as SecureStore from 'expo-secure-store'

/**
 * Cliente de Supabase.
 *
 * El token de sesión va al almacén seguro del sistema (Keystore en Android), no
 * a AsyncStorage: si alguien saca el teléfono del bolsillo, el refresh token no
 * queda leíble en texto plano.
 *
 * SecureStore tiene un límite de 2 KB por entrada y la sesión de Supabase suele
 * superarlo, así que se parte en trozos.
 */

const TAMANO_TROZO = 1800

const almacenSeguro = {
  async getItem(clave: string): Promise<string | null> {
    const cantidad = await SecureStore.getItemAsync(`${clave}__n`)
    if (cantidad === null) {
      // Compatibilidad con sesiones guardadas antes de partir en trozos.
      return SecureStore.getItemAsync(clave)
    }
    const trozos: string[] = []
    for (let i = 0; i < Number(cantidad); i += 1) {
      const trozo = await SecureStore.getItemAsync(`${clave}__${i}`)
      if (trozo === null) return null
      trozos.push(trozo)
    }
    return trozos.join('')
  },

  async setItem(clave: string, valor: string): Promise<void> {
    await this.removeItem(clave)
    const trozos = valor.match(new RegExp(`.{1,${TAMANO_TROZO}}`, 'g')) ?? []
    await SecureStore.setItemAsync(`${clave}__n`, String(trozos.length))
    await Promise.all(
      trozos.map((trozo, i) => SecureStore.setItemAsync(`${clave}__${i}`, trozo)),
    )
  },

  async removeItem(clave: string): Promise<void> {
    const cantidad = await SecureStore.getItemAsync(`${clave}__n`)
    if (cantidad !== null) {
      await Promise.all(
        Array.from({ length: Number(cantidad) }, (_, i) =>
          SecureStore.deleteItemAsync(`${clave}__${i}`),
        ),
      )
      await SecureStore.deleteItemAsync(`${clave}__n`)
    }
    await SecureStore.deleteItemAsync(clave).catch(() => undefined)
  },
}

const extra = Constants.expoConfig?.extra ?? {}

export const SUPABASE_URL: string = extra.supabaseUrl ?? ''
export const SUPABASE_ANON_KEY: string = extra.supabaseAnonKey ?? ''

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  // Falla temprano y con un mensaje claro, en vez de un 401 incomprensible.
  console.error(
    '[WoodTools] Faltan SUPABASE_URL o SUPABASE_ANON_KEY. Revisá docs/CONFIGURACION.md',
  )
}

export const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: almacenSeguro,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
  global: {
    headers: { 'x-aplicacion': 'woodtools-movil' },
  },
  realtime: {
    params: { eventsPerSecond: 2 },
  },
})

/**
 * El token de sesión para mandar EXPLÍCITO al invocar una Edge Function.
 *
 * `functions.invoke` depende de que la capa de auth le haya sincronizado el token
 * al cliente. Si venció y el refresh no llegó a tiempo (datos móviles flojos), la
 * request salía sin `Authorization` —aunque el vendedor estuviera logueado— y la
 * función contestaba "Falta el token de sesión". `getSession` refresca el token si
 * hace falta; pasándolo a mano en el header, sale siempre.
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

/** Caché liviana de datos no sensibles (por ejemplo, la ruta del día offline). */
export const cacheLocal = AsyncStorage
