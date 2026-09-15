import * as SecureStore from 'expo-secure-store'

import { describirDispositivo, obtenerInstalacionId } from '../nucleo/dispositivo'
import { supabase } from '../nucleo/supabase'

/**
 * Restablecer la contraseña cuando el vendedor se la olvidó.
 *
 * ─── Por qué esto no vive en `sesion.ts` ─────────────────────────────────────
 *
 * Todo esto pasa ANTES de tener sesión: el vendedor está afuera. `sesion.ts` es
 * la máquina de estados de alguien que ya entró (o está entrando); esto es un
 * trámite aparte que corre en la pantalla de ingreso y no necesita ninguno de
 * esos estados.
 *
 * ─── El circuito, y por qué el token se guarda en el teléfono ────────────────
 *
 * 1. El vendedor toca "Olvidé mi contraseña" y escribe su usuario. La función
 *    `pedir-restablecer-contrasena` crea un pedido y devuelve un `id` y un
 *    `token` de un solo uso.
 * 2. Ese par se guarda en el Keystore del teléfono. Es lo único que después le
 *    permite completar el cambio: aunque un tercero vea en el panel que el
 *    pedido quedó habilitado, sin el token no puede hacer nada.
 * 3. Cuando la oficina habilita, el vendedor elige su clave y
 *    `restablecer-contrasena` la aplica —si el token coincide, no venció, y es
 *    el mismo teléfono—.
 *
 * Se guarda en el Keystore y no en memoria para que sobreviva a que el vendedor
 * cierre la app mientras espera que la oficina lo habilite. Si la perdiera, el
 * único costo es volver a pedirlo.
 */

const CLAVE_PEDIDO = 'woodtools.pedido_reset'

export interface PedidoGuardado {
  id: string
  token: string
  usuario: string
}

/**
 * Invoca una función edge dejando pasar el motivo real del error.
 *
 * `functions.invoke` esconde el mensaje detrás de un "non-2xx status code"
 * genérico; el motivo que arma `manejarError` viaja en el cuerpo, dentro de
 * `error.context`. Sin esto, "la oficina todavía no te habilitó" se le
 * aparecería al vendedor como un error de red cualquiera. Es el mismo helper
 * que usa `servicios/mapas.ts`.
 */
async function invocar<T>(nombre: string, cuerpo: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(nombre, { body: cuerpo })
  if (!error) return data as T

  let motivo: string | null = null
  const respuesta = (error as { context?: Response }).context
  if (respuesta && typeof respuesta.json === 'function') {
    try {
      const cuerpoError = await respuesta.json()
      if (typeof cuerpoError?.error === 'string') motivo = cuerpoError.error
    } catch {
      // No era JSON: nos quedamos con el error original.
    }
  }
  throw new Error(motivo ?? error.message)
}

/** El pedido en curso que este teléfono tiene guardado, si hay alguno. */
export async function pedidoGuardado(): Promise<PedidoGuardado | null> {
  const crudo = await SecureStore.getItemAsync(CLAVE_PEDIDO)
  if (!crudo) return null
  try {
    const p = JSON.parse(crudo) as PedidoGuardado
    return p.id && p.token ? p : null
  } catch {
    return null
  }
}

export async function olvidarPedido(): Promise<void> {
  await SecureStore.deleteItemAsync(CLAVE_PEDIDO)
}

/**
 * Pide el restablecimiento y deja el pedido guardado en el teléfono.
 * Devuelve el usuario tal como lo conoce el servidor, para mostrarlo.
 */
export async function pedirRestablecer(identificador: string): Promise<string> {
  const dispositivo = await describirDispositivo()
  const respuesta = await invocar<{ id: string; token: string; usuario: string | null }>(
    'pedir-restablecer-contrasena',
    {
      identificador,
      origen: 'celular',
      dispositivo_id: dispositivo.instalacion_id,
      dispositivo_desc: [dispositivo.fabricante, dispositivo.modelo].filter(Boolean).join(' '),
    },
  )

  const usuario = respuesta.usuario ?? identificador.trim().toLowerCase()
  const pedido: PedidoGuardado = { id: respuesta.id, token: respuesta.token, usuario }
  await SecureStore.setItemAsync(CLAVE_PEDIDO, JSON.stringify(pedido))
  return usuario
}

/**
 * Completa el cambio con la contraseña nueva. Si la oficina todavía no habilitó,
 * la función tira un error con ese motivo, que la pantalla muestra tal cual.
 * Al terminar bien, se olvida el pedido guardado.
 */
export async function completarRestablecer(nueva: string): Promise<void> {
  const pedido = await pedidoGuardado()
  if (!pedido) throw new Error('No hay ningún pedido en curso en este teléfono. Empezá de nuevo.')

  await invocar('restablecer-contrasena', {
    id: pedido.id,
    token: pedido.token,
    nueva,
    dispositivo_id: await obtenerInstalacionId(),
  })

  await olvidarPedido()
}
