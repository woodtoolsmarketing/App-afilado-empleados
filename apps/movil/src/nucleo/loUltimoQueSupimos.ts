import { cacheLocal } from './supabase'

/**
 * Lo último que la app supo del servidor, para cuando no hay señal.
 *
 * ─── Por qué existe ──────────────────────────────────────────────────────────
 *
 * La app abría preguntándole todo al servidor y, si no podía preguntar, se
 * cerraba. Dos caminos, los dos fallando cerrado:
 *
 *  · `refrescarPerfil` consulta `perfiles`; si la consulta falla manda a la
 *    pantalla de ingreso con "No pudimos verificar tu cuenta".
 *  · `registrarYVerificarDispositivo` consulta `dispositivos`; si falla, el
 *    teléfono queda como NO autorizado y la app tampoco deja pasar.
 *
 * O sea que un vendedor sin señal no podía entrar a la app. Ni para mirar lo
 * que ya tenía cargado, ni para nada. Y es justo cuando más la necesita: en un
 * galpón, adentro de un depósito, en la ruta.
 *
 * No es lo mismo "el servidor dijo que no" que "no pude preguntarle". Lo
 * primero tiene que cerrar la puerta; lo segundo tiene que dejar pasar con lo
 * último que se supo.
 *
 * ─── Por qué caduca ──────────────────────────────────────────────────────────
 *
 * Porque esto es, exactamente, dejar entrar sin verificar. Con una cuenta dada
 * de baja o un teléfono desautorizado, el que tenga el aparato en la mano sigue
 * adentro mientras no haya señal. Una semana es holgado para el peor día de
 * trabajo real —nadie pasa siete días sin una barra de señal— y corto para que
 * a alguien le sirva de agujero: apagar los datos deja de ser una forma de
 * conservar un acceso que la oficina ya sacó.
 */

const CLAVE_PERFIL = 'ultimo_perfil'
const CLAVE_DISPOSITIVO = 'ultimo_dispositivo_autorizado'

/** Siete días. Ver el comentario de arriba: no es un número cómodo, es un tope. */
const VENCE_A_LOS_MS = 7 * 24 * 60 * 60 * 1000

interface Recordado<T> {
  valor: T
  en: number
}

async function guardar<T>(clave: string, valor: T): Promise<void> {
  const paquete: Recordado<T> = { valor, en: Date.now() }
  await cacheLocal.setItem(clave, JSON.stringify(paquete)).catch(() => undefined)
}

async function leer<T>(clave: string): Promise<T | null> {
  try {
    const crudo = await cacheLocal.getItem(clave)
    if (!crudo) return null

    const paquete = JSON.parse(crudo) as Recordado<T>
    if (!paquete || typeof paquete.en !== 'number') return null
    if (Date.now() - paquete.en > VENCE_A_LOS_MS) return null

    return paquete.valor
  } catch {
    // Un dato guardado que no se puede leer se trata como si no estuviera: es
    // preferible pedir señal a entrar con algo que no se entiende.
    return null
  }
}

export async function recordarPerfil(perfil: unknown): Promise<void> {
  await guardar(CLAVE_PERFIL, perfil)
}

export async function perfilRecordado<T>(): Promise<T | null> {
  return leer<T>(CLAVE_PERFIL)
}

export async function recordarDispositivoAutorizado(autorizado: boolean): Promise<void> {
  await guardar(CLAVE_DISPOSITIVO, autorizado)
}

export async function dispositivoRecordado(): Promise<boolean | null> {
  return leer<boolean>(CLAVE_DISPOSITIVO)
}

/** Al cerrar sesión no queda nada: el próximo que entre arranca de cero. */
export async function olvidarLoRecordado(): Promise<void> {
  await cacheLocal.removeItem(CLAVE_PERFIL).catch(() => undefined)
  await cacheLocal.removeItem(CLAVE_DISPOSITIVO).catch(() => undefined)
}

/**
 * ¿El error fue porque no hay señal, o porque el servidor contestó que no?
 *
 * Importa mucho: lo primero se perdona con lo recordado, lo segundo no. Un
 * error de red en React Native llega como `TypeError: Network request failed`;
 * PostgREST además usa códigos que empiezan con dígito para lo suyo, así que un
 * error sin código y con pinta de red es de red.
 */
export function pareceFaltaDeSenal(error: unknown): boolean {
  if (!error) return false
  const e = error as { message?: string; code?: string; name?: string }
  if (e.code) return false
  const texto = `${e.name ?? ''} ${e.message ?? ''}`.toLowerCase()
  return (
    texto.includes('network') ||
    texto.includes('failed to fetch') ||
    texto.includes('timeout') ||
    texto.includes('abort')
  )
}
