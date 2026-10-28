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
 * AsyncStorage con tope, que se drena en lote cuando hay señal. Acá se simplifica
 * porque la ingesta es por RPC (`registrar_eventos_telemetria`), todo-o-nada.
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

const VERSION_APP: string | null = Constants.expoConfig?.version ?? null

/** Un tramo abierto: una pantalla o un sub-paso que el usuario está mirando ahora. */
interface Tramo {
  seccion: string | null
  paso: string | null
  inicio: number | null
}

/** En disco cada evento lleva de quién es, para no atribuirlo a otra cuenta al drenar. */
interface EventoEncolado extends EventoTelemetria {
  _perfil_id: string
}

// Dos trackers independientes: el de PANTALLA lo mueve la navegación; el de PASO
// lo mueve la nota de pedido (sus sub-pasos). Son slots separados para que medir
// un sub-paso no cierre el tramo de la pantalla entera (se solapan a propósito: el
// reporte agrupa por (seccion, paso), así conviven el total y el desglose).
const tramoPantalla: Tramo = { seccion: null, paso: null, inicio: null }
const tramoPaso: Tramo = { seccion: null, paso: null, inicio: null }

let enviando = false

function ahora(): number {
  return Date.now()
}

/** Cierra un tramo abierto y lo encola (si duró lo suficiente). Mantiene seccion/paso. */
function cerrar(tramo: Tramo): void {
  if (tramo.inicio == null || !tramo.seccion) {
    tramo.inicio = null
    return
  }
  const duracion = ahora() - tramo.inicio
  tramo.inicio = null
  if (duracion < MINIMO_MS) return
  void encolar(tramo.seccion, tramo.paso, duracion)
}

/** Abre un tramo en un tracker (cerrando el anterior primero). */
function abrir(tramo: Tramo, seccion: string, paso: string | null): void {
  cerrar(tramo)
  tramo.seccion = seccion
  tramo.paso = paso
  tramo.inicio = ahora()
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

async function encolar(seccion: string, paso: string | null, duracion_ms: number): Promise<void> {
  try {
    const perfilId = usarSesion.getState().perfil?.id
    if (!perfilId) return
    const evento: EventoEncolado = {
      _perfil_id: perfilId,
      plataforma: 'app',
      seccion,
      paso: paso ?? null,
      inicio: new Date(ahora() - duracion_ms).toISOString(),
      duracion_ms,
      version_app: VERSION_APP,
    }
    const crudo = await cacheLocal.getItem(CLAVE_COLA)
    const cola: EventoEncolado[] = crudo ? JSON.parse(crudo) : []
    cola.push(evento)
    await cacheLocal.setItem(CLAVE_COLA, JSON.stringify(cola.slice(-MAX_EN_COLA)))
    if (cola.length >= UMBRAL_FLUSH) void flushTelemetria()
  } catch {
    // La telemetría nunca debe romper el camino del vendedor.
  }
}

/**
 * Vacía la cola a la base por RPC. Sólo manda los eventos de la cuenta ACTIVA
 * (el resto se descarta: pertenecen a una cuenta de la que ya se salió y la RPC
 * forzaría `perfil_id = auth.uid()`, atribuyéndolos a quien no corresponde).
 */
export async function flushTelemetria(): Promise<void> {
  if (enviando) return
  enviando = true
  try {
    const crudo = await cacheLocal.getItem(CLAVE_COLA)
    if (!crudo) return
    const cola: EventoEncolado[] = JSON.parse(crudo)
    if (cola.length === 0) {
      await cacheLocal.removeItem(CLAVE_COLA)
      return
    }

    const {
      data: { session },
    } = await supabase.auth.getSession()
    const uid = session?.user?.id
    if (!uid) return // sin sesión no se puede mandar nada; se reintenta después

    const propios = cola.filter((e) => e._perfil_id === uid)
    if (propios.length === 0) {
      // Todo lo que quedó es de otra cuenta: se descarta para no envenenar la cola.
      await cacheLocal.removeItem(CLAVE_COLA)
      return
    }

    const eventos = propios.map(({ _perfil_id, ...e }) => e)
    const { error } = await supabase.rpc('registrar_eventos_telemetria', { p_eventos: eventos })
    if (error) return // transitorio (red/sesión): se conserva la cola y se reintenta

    // Subió lo propio: se quita de la cola, dejando intacto lo de otras cuentas
    // (que se limpiará cuando esa cuenta vuelva a entrar, o por el tope).
    const resto = cola.filter((e) => e._perfil_id !== uid)
    if (resto.length === 0) await cacheLocal.removeItem(CLAVE_COLA)
    else await cacheLocal.setItem(CLAVE_COLA, JSON.stringify(resto))
  } catch {
    // Best-effort: si algo falla, la cola queda para el próximo intento.
  } finally {
    enviando = false
  }
}
