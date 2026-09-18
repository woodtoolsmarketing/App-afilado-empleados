import type { Perfil } from '@woodtools/compartido'
import * as SecureStore from 'expo-secure-store'

import { cacheLocal } from './supabase'

/**
 * Varias cuentas en el mismo teléfono, para cambiar de una a otra.
 *
 * ─── Para qué ────────────────────────────────────────────────────────────────
 *
 * Hay vendedores con dos usuarios —uno para Buenos Aires y otro para las giras
 * por el interior— y necesitan pasar de uno al otro sin escribir la contraseña
 * cada vez. Cada usuario es una cuenta de Supabase distinta, con su propio
 * `perfil` y su propia autorización de dispositivo.
 *
 * ─── Qué se guarda, y dónde ──────────────────────────────────────────────────
 *
 * Dos cosas separadas por sensibilidad:
 *  · El REGISTRO (nombre, usuario, foto) va en AsyncStorage: es lo que la
 *    pantalla de cuentas muestra, y no tiene nada secreto.
 *  · El REFRESH TOKEN de cada cuenta va en el Keystore (SecureStore), uno por
 *    cuenta. Es la llave que permite volver a activar una cuenta sin pedir la
 *    contraseña. La cuenta ACTIVA no se guarda acá: su sesión ya vive en el
 *    almacén del cliente de Supabase. Acá se guardan las que están en espera.
 *
 * ─── Por qué el token no vence estando en espera ─────────────────────────────
 *
 * `autoRefreshToken` rota el refresh token, pero sólo el de la sesión activa.
 * Una cuenta en espera no se refresca, así que su token guardado sigue siendo
 * válido hasta que se la vuelve a activar. Por eso, al SALIR de una cuenta se
 * guarda su token del momento (ver `cambiarCuenta` en `sesion.ts`): ese es el
 * último bueno antes de quedar quieta.
 */

const CLAVE_REGISTRO = 'woodtools.cuentas'
const PREFIJO_TOKEN = 'woodtools.cuenta.'

export interface CuentaGuardada {
  perfilId: string
  /** El correo de ingreso, que es con lo que Supabase autentica. */
  email: string
  /** El nombre corto de ingreso ("nsaadinterior"), para mostrar. */
  usuario: string | null
  nombre: string
  codigoVendedor: string | null
  fotoUrl: string | null
}

/**
 * SecureStore sólo admite `[A-Za-z0-9._-]` en la clave; un UUID entra tal cual
 * (tiene guiones, que están permitidos).
 */
function claveToken(perfilId: string): string {
  return `${PREFIJO_TOKEN}${perfilId}`
}

/** Los datos de registro que salen de un perfil recién cargado. */
export function datosDeCuenta(perfil: Perfil): CuentaGuardada {
  return {
    perfilId: perfil.id,
    email: perfil.email,
    usuario: perfil.usuario,
    nombre: perfil.nombre_completo,
    codigoVendedor: perfil.codigo_vendedor,
    fotoUrl: perfil.foto_url,
  }
}

export async function listarCuentas(): Promise<CuentaGuardada[]> {
  try {
    const crudo = await cacheLocal.getItem(CLAVE_REGISTRO)
    if (!crudo) return []
    const lista = JSON.parse(crudo) as CuentaGuardada[]
    return Array.isArray(lista) ? lista.filter((c) => c && c.perfilId) : []
  } catch {
    return []
  }
}

async function guardarRegistro(lista: CuentaGuardada[]): Promise<void> {
  await cacheLocal.setItem(CLAVE_REGISTRO, JSON.stringify(lista)).catch(() => undefined)
}

/**
 * Anota (o actualiza) una cuenta y, si se pasa, su refresh token. La deja
 * adelante en la lista: la última que se usó es la primera que se ofrece.
 */
export async function recordarCuenta(
  cuenta: CuentaGuardada,
  refreshToken?: string | null,
): Promise<void> {
  const lista = await listarCuentas()
  const resto = lista.filter((c) => c.perfilId !== cuenta.perfilId)
  await guardarRegistro([cuenta, ...resto])
  if (refreshToken) {
    await SecureStore.setItemAsync(claveToken(cuenta.perfilId), refreshToken).catch(() => undefined)
  }
}

export async function tokenDeCuenta(perfilId: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(claveToken(perfilId))
  } catch {
    return null
  }
}

/** Saca la cuenta del teléfono: del registro y su token del Keystore. */
export async function olvidarCuenta(perfilId: string): Promise<void> {
  const lista = await listarCuentas()
  await guardarRegistro(lista.filter((c) => c.perfilId !== perfilId))
  await SecureStore.deleteItemAsync(claveToken(perfilId)).catch(() => undefined)
}
