import Constants from 'expo-constants'

import type { EventoTelemetria } from '@woodtools/compartido'

import { cacheLocal, supabase } from '../nucleo/supabase'
import { usarSesion } from '../nucleo/sesion'

/**
 * Telemetría de tiempos de uso (app móvil).
 *
 * Cronometra cuánto tiempo pasa el vendedor en cada opción (pantalla) y, dentro
 * de la nota de pedido, en cada sub-paso. La MEDICIÓN corre para todos; quién ve
 * el reporte lo decide el flag del panel (ver `perfiles.ve_reporte_tiempos`).
 *
 * El molde es la cola offline de `posiciones` (ubicacion.ts): un array JSON en
 * AsyncStorage con tope, que se drena en lote cuando hay señal, por la RPC
 * `registrar_eventos_telemetria` (todo-o-nada, con clamp de duración server-side).
 *
 * Es best-effort y 100% JS ya linkeado (supabase + AsyncStorage + expo-constants):
 * nunca tira un error a la UI y no suma módulos nativos, así que no rompe el OTA ni
 * el bundle de los teléfonos de la flota. NO toca ubicación ni el seguimiento.
 */

const CLAVE_COLA = 'woodtools.cola_telemetria'
/** Tope de la cola: si se pasa, se descartan los eventos más viejos. */
const MAX_EN_COLA = 2000
/** Cuando la cola llega a esto, se intenta drenar sin esperar al background. */
const UMBRAL_FLUSH = 25
/** Tramos más cortos que esto se descartan: son transiciones, no uso real. */
const MINIMO_MS = 300
/** Tope de duración de un tramo (24h), igual que el CHECK de la tabla. */
const MAX_DURACION_MS = 86400000

const VERSION_APP: string | null = Constants.expoConfig?.version ?? null

/** Un tramo abierto. `perfilId` se captura al ABRIR, para que el tiempo quede
 *  atribuido a quien estaba en sesión cuando empezó (no a quien entre después). */
interface Tramo {
  seccion: string | null
  paso: string | null
  inicio: number | null
  perfilId: string | null
}

/** En disco cada evento lleva un id propio y de quién es, para drenar sin perder ni
 *  mezclar cuentas. Ni `_id` ni `_perfil_id` se mandan al servidor. */
interface EventoEncolado extends EventoTelemetria {
  _id: string
  _perfil_id: string
}

// Dos trackers independientes: el de PANTALLA lo mueve la navegación; el de PASO
// lo mueve la nota de pedido (sus sub-pasos). Son slots separados para que medir
// un sub-paso no cierre el tramo de la pantalla entera (se solapan a propósito: el
// reporte agrupa por (seccion, paso), así conviven el total y el desglose).
const tramoPantalla: Tramo = { seccion: null, paso: null, inicio: null, perfilId: null }
const tramoPaso: Tramo = { seccion: null, paso: null, inicio: null, perfilId: null }

let enviando = false
let contador = 0

function ahora(): number {
  return Date.now()
}

function nuevoId(): string {
  contador = (contador + 1) % 1_000_000
  return `${ahora()}-${contador}`
}

// Candado de la cola: serializa los read-modify-write de `encolar` y `flush` sobre
// la misma clave de AsyncStorage, para que el drenado no pise un evento encolado
// mientras esperaba la red (lost update). La llamada de red del flush queda FUERA
// del candado: no bloquea al que encola.
let cadenaCola: Promise<unknown> = Promise.resolve()
function enCola<T>(fn: () => Promise<T>): Promise<T> {
  const r = cadenaCola.then(() => fn())
  cadenaCola = r.then(
    () => undefined,
    () => undefined,
  )
  return r
}

async function leerCola(): Promise<EventoEncolado[]> {
  try {
    const crudo = await cacheLocal.getItem(CLAVE_COLA)
    return crudo ? (JSON.parse(crudo) as EventoEncolado[]) : []
  } catch {
    return []
  }
}

async function escribirCola(cola: EventoEncolado[]): Promise<void> {
  try {
    if (cola.length === 0) await cacheLocal.removeItem(CLAVE_COLA)
    else await cacheLocal.setItem(CLAVE_COLA, JSON.stringify(cola.slice(-MAX_EN_COLA)))
  } catch {
    // Sin AsyncStorage: la telemetría se pierde, no rompe nada.
  }
}

/** Cierra un tramo abierto y lo encola (si duró lo suficiente). Mantiene seccion/paso. */
function cerrar(tramo: Tramo): void {
  const { seccion, paso, inicio, perfilId } = tramo
  tramo.inicio = null
  if (inicio == null || !seccion || !perfilId) return
  const duracion = ahora() - inicio
  if (duracion < MINIMO_MS) return
  void encolar(seccion, paso, duracion, perfilId)
}

/** Abre un tramo en un tracker (cerrando el anterior primero), capturando el perfil. */
function abrir(tramo: Tramo, seccion: string, paso: string | null): void {
  cerrar(tramo)
  tramo.seccion = seccion
  tramo.paso = paso
  tramo.inicio = ahora()
  tramo.perfilId = usarSesion.getState().perfil?.id ?? null
}

/**
 * Marca la pantalla actual (la llama la navegación en cada cambio de ruta).
 * `null` cierra el tramo de pantalla sin abrir otro (p.ej. pre-ingreso).
 */
export function marcarPantalla(seccion: string | null): void {
  if (!seccion) {
    cerrar(tramoPantalla)
    tramoPantalla.seccion = null
    return
  }
  if (tramoPantalla.seccion === seccion && tramoPantalla.inicio != null) return
  abrir(tramoPantalla, seccion, null)
}

/**
 * Marca el sub-paso actual dentro de una pantalla (la llama la nota de pedido).
 * `paso` null cierra el sub-paso en curso sin abrir otro.
 */
export function marcarPaso(seccion: string, paso: string | null): void {
  if (!paso) {
    cerrar(tramoPaso)
    tramoPaso.seccion = null
    tramoPaso.paso = null
    return
  }
  abrir(tramoPaso, seccion, paso)
}

/** Cierra y olvida el tracker de sub-paso (al salir de la pantalla con pasos). */
export function limpiarPaso(): void {
  cerrar(tramoPaso)
  tramoPaso.seccion = null
  tramoPaso.paso = null
}

/** Pausa los dos trackers (al ir a segundo plano o al trabarse el candado). */
export function pausarTelemetria(): void {
  cerrar(tramoPantalla)
  cerrar(tramoPaso)
}

/** Reanuda los trackers que tenían una sección abierta (al volver al frente). */
export function reanudarTelemetria(): void {
  if (tramoPantalla.seccion && tramoPantalla.inicio == null) tramoPantalla.inicio = ahora()
  if (tramoPaso.seccion && tramoPaso.paso && tramoPaso.inicio == null) tramoPaso.inicio = ahora()
}

async function encolar(
  seccion: string,
  paso: string | null,
  duracion_ms: number,
  perfilId: string,
): Promise<void> {
  try {
    const dur = Math.min(Math.max(Math.round(duracion_ms), 0), MAX_DURACION_MS)
    const evento: EventoEncolado = {
      _id: nuevoId(),
      _perfil_id: perfilId,
      plataforma: 'app',
      seccion,
      paso: paso ?? null,
      inicio: new Date(ahora() - dur).toISOString(),
      duracion_ms: dur,
      version_app: VERSION_APP,
    }
    let largo = 0
    await enCola(async () => {
      const cola = await leerCola()
      cola.push(evento)
      largo = cola.length
      await escribirCola(cola)
    })
    if (largo >= UMBRAL_FLUSH) void flushTelemetria()
  } catch {
    // La telemetría nunca debe romper el camino del vendedor.
  }
}

/**
 * Vacía la cola a la base por RPC. Sólo manda los eventos de la cuenta ACTIVA (el
 * resto queda para cuando esa cuenta vuelva, o lo descarta el tope). Tras el envío
 * re-lee la cola y quita SÓLO los `_id` enviados, para no pisar lo que se encoló
 * mientras esperaba la red.
 */
export async function flushTelemetria(): Promise<void> {
  if (enviando) return
  enviando = true
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession()
    const uid = session?.user?.id
    if (!uid) return // sin sesión no se puede mandar nada; se reintenta después

    const aEnviar = await enCola(async () => (await leerCola()).filter((e) => e._perfil_id === uid))
    if (aEnviar.length === 0) return

    const ids = new Set(aEnviar.map((e) => e._id))
    const eventos = aEnviar.map(({ _id, _perfil_id, ...e }) => e)
    const { error } = await supabase.rpc('registrar_eventos_telemetria', { p_eventos: eventos })
    if (error) return // transitorio (red/sesión): se conserva la cola y se reintenta

    await enCola(async () => {
      const cola = await leerCola()
      await escribirCola(cola.filter((e) => !ids.has(e._id)))
    })
  } catch {
    // Best-effort: si algo falla, la cola queda para el próximo intento.
  } finally {
    enviando = false
  }
}
