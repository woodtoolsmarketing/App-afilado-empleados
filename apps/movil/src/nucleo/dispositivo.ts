import * as Application from 'expo-application'
import * as Crypto from 'expo-crypto'
import * as Device from 'expo-device'
import * as SecureStore from 'expo-secure-store'

import { supabase } from './supabase'

/**
 * Identidad del teléfono.
 *
 * La app sólo corre en celulares que un administrador habilitó. Para eso hace
 * falta un identificador estable: se genera una vez, se guarda en el Keystore y
 * sobrevive a las actualizaciones de la app (no a una desinstalación, que es
 * justamente lo que queremos: reinstalar exige volver a pedir autorización).
 *
 * Es un GUID propio, no un identificador de hardware. Google lo pide
 * explícitamente: ANDROID_ID e IMEI son identificadores no reseteables y su
 * uso está restringido desde Android 10.
 * https://developer.android.com/identity/user-data-ids
 */

const CLAVE_INSTALACION = 'woodtools.instalacion_id'

let cacheId: string | null = null

export async function obtenerInstalacionId(): Promise<string> {
  if (cacheId) return cacheId

  const guardado = await SecureStore.getItemAsync(CLAVE_INSTALACION)
  if (guardado) {
    cacheId = guardado
    return guardado
  }

  const id = Crypto.randomUUID()
  await SecureStore.setItemAsync(CLAVE_INSTALACION, id)
  cacheId = id
  return id
}

export interface DatosDispositivo {
  instalacion_id: string
  fabricante: string | null
  modelo: string | null
  version_so: string | null
  version_app: string | null
}

export async function describirDispositivo(): Promise<DatosDispositivo> {
  return {
    instalacion_id: await obtenerInstalacionId(),
    fabricante: Device.manufacturer ?? null,
    modelo: Device.modelName ?? null,
    version_so: `Android ${Device.osVersion ?? '?'}`,
    version_app: Application.nativeApplicationVersion ?? null,
  }
}

export interface EstadoAutorizacion {
  autorizado: boolean
  /** true la primera vez que este teléfono se presenta: hay que esperar al admin. */
  recienRegistrado: boolean
}

/**
 * Registra el teléfono contra el perfil que acaba de iniciar sesión y devuelve
 * si está habilitado. Un teléfono nuevo se registra como NO autorizado; hasta
 * que un admin lo apruebe, la app no deja pasar.
 */
export async function registrarYVerificarDispositivo(
  perfilId: string,
): Promise<EstadoAutorizacion> {
  const datos = await describirDispositivo()

  const { data: existente } = await supabase
    .from('dispositivos')
    .select('id, autorizado')
    .eq('perfil_id', perfilId)
    .eq('instalacion_id', datos.instalacion_id)
    .maybeSingle()

  if (existente) {
    await supabase
      .from('dispositivos')
      .update({
        version_app: datos.version_app,
        version_so: datos.version_so,
        ultimo_visto_en: new Date().toISOString(),
      })
      .eq('id', existente.id)

    return { autorizado: existente.autorizado, recienRegistrado: false }
  }

  await supabase.from('dispositivos').insert({
    perfil_id: perfilId,
    ...datos,
    autorizado: false,
    ultimo_visto_en: new Date().toISOString(),
  })

  return { autorizado: false, recienRegistrado: true }
}
