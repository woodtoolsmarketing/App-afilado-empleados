import * as Battery from 'expo-battery'
import * as Location from 'expo-location'
import * as TaskManager from 'expo-task-manager'

import { cacheLocal, supabase } from '../nucleo/supabase'

/**
 * Seguimiento de la ubicación durante el recorrido.
 *
 * El admin ve el pin del vendedor moverse en vivo, como en una app de reparto.
 * Se apaga solo al finalizar el recorrido: fuera de la jornada no se rastrea a
 * nadie.
 *
 * Dos destinos por cada punto:
 *  · `posiciones_actuales` → una sola fila por vendedor, con UPSERT. Es la que
 *    está publicada en Realtime y la que alimenta el mapa del panel.
 *  · `posiciones` → histórico append-only para reproducir el recorrido después.
 *
 * Si no hay señal, los puntos se encolan en disco y se reintentan. El histórico
 * no puede depender de que la red esté disponible en el momento exacto.
 */

export const TAREA_UBICACION = 'woodtools-seguimiento-recorrido'
const CLAVE_CONTEXTO = 'woodtools.contexto_seguimiento'
const CLAVE_COLA = 'woodtools.cola_posiciones'

/** Tope de la cola: si se pasa, se descartan los puntos más viejos. */
const MAX_EN_COLA = 500

interface ContextoSeguimiento {
  vendedorId: string
  rolVisitaId: string
}

interface PuntoEncolado {
  rol_visita_id: string
  vendedor_id: string
  lat: number
  lng: number
  precision_m: number | null
  velocidad_mps: number | null
  rumbo: number | null
  bateria_pct: number | null
  registrado_en: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Permisos
// ─────────────────────────────────────────────────────────────────────────────

export type ResultadoPermiso =
  | { concedido: true; segundoPlano: boolean }
  | { concedido: false; motivo: string }

/**
 * Pide los permisos en dos pasos, como exige Android: primero mientras se usa
 * la app, y sólo después el permiso de segundo plano. Pedirlos juntos hace que
 * el sistema rechace el segundo sin siquiera mostrarlo.
 */
export async function pedirPermisosUbicacion(): Promise<ResultadoPermiso> {
  const primerPlano = await Location.requestForegroundPermissionsAsync()
  if (!primerPlano.granted) {
    return {
      concedido: false,
      motivo:
        'Sin permiso de ubicación no podemos armar el recorrido ni avisar a la oficina dónde estás.',
    }
  }

  const segundoPlano = await Location.requestBackgroundPermissionsAsync()

  return { concedido: true, segundoPlano: segundoPlano.granted }
}

// ─────────────────────────────────────────────────────────────────────────────
// Arranque y parada
// ─────────────────────────────────────────────────────────────────────────────

export async function ubicacionActual(): Promise<{ lat: number; lng: number; precision: number | null }> {
  const pos = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.High,
  })
  return {
    lat: pos.coords.latitude,
    lng: pos.coords.longitude,
    precision: pos.coords.accuracy ?? null,
  }
}

export async function iniciarSeguimiento(contexto: ContextoSeguimiento): Promise<void> {
  await cacheLocal.setItem(CLAVE_CONTEXTO, JSON.stringify(contexto))

  const yaCorriendo = await Location.hasStartedLocationUpdatesAsync(TAREA_UBICACION)
  if (yaCorriendo) return

  const { intervaloSeg, distanciaMin } = await parametros()

  await Location.startLocationUpdatesAsync(TAREA_UBICACION, {
    accuracy: Location.Accuracy.Balanced,
    timeInterval: intervaloSeg * 1000,
    distanceInterval: distanciaMin,
    // Sin esto, Android mata el seguimiento apenas se apaga la pantalla.
    foregroundService: {
      notificationTitle: 'WoodTools · recorrido en curso',
      notificationBody: 'La oficina puede ver tu ubicación mientras dure el recorrido.',
      notificationColor: '#B30F0F',
      killServiceOnDestroy: false,
    },
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    activityType: Location.ActivityType.AutomotiveNavigation,
  })
}

export async function detenerSeguimiento(vendedorId?: string): Promise<void> {
  const corriendo = await Location.hasStartedLocationUpdatesAsync(TAREA_UBICACION).catch(() => false)
  if (corriendo) await Location.stopLocationUpdatesAsync(TAREA_UBICACION)

  await cacheLocal.removeItem(CLAVE_CONTEXTO)
  await vaciarCola()

  if (vendedorId) {
    await supabase
      .from('posiciones_actuales')
      .update({ en_recorrido: false, actualizado_en: new Date().toISOString() })
      .eq('vendedor_id', vendedorId)
      .then(undefined, () => undefined)
  }
}

export async function seguimientoActivo(): Promise<boolean> {
  return Location.hasStartedLocationUpdatesAsync(TAREA_UBICACION).catch(() => false)
}

// ─────────────────────────────────────────────────────────────────────────────
// La tarea en segundo plano
// ─────────────────────────────────────────────────────────────────────────────

TaskManager.defineTask(TAREA_UBICACION, async ({ data, error }) => {
  if (error) {
    console.warn('[seguimiento] error de la tarea', error)
    return
  }

  const { locations } = (data ?? {}) as { locations?: Location.LocationObject[] }
  const ultima = locations?.at(-1)
  if (!ultima) return

  const crudo = await cacheLocal.getItem(CLAVE_CONTEXTO)
  if (!crudo) return
  const contexto = JSON.parse(crudo) as ContextoSeguimiento

  let bateria: number | null = null
  try {
    bateria = Math.round((await Battery.getBatteryLevelAsync()) * 100)
  } catch {
    // La batería es un dato de conveniencia; si falla, no importa.
  }

  const punto: PuntoEncolado = {
    rol_visita_id: contexto.rolVisitaId,
    vendedor_id: contexto.vendedorId,
    lat: ultima.coords.latitude,
    lng: ultima.coords.longitude,
    precision_m: ultima.coords.accuracy ?? null,
    velocidad_mps: ultima.coords.speed ?? null,
    rumbo: ultima.coords.heading ?? null,
    bateria_pct: bateria,
    registrado_en: new Date(ultima.timestamp).toISOString(),
  }

  await publicarPunto(punto)
})

async function publicarPunto(punto: PuntoEncolado): Promise<void> {
  // El pin en vivo primero: es lo que le importa al admin en este segundo.
  const { error: errActual } = await supabase.from('posiciones_actuales').upsert(
    {
      vendedor_id: punto.vendedor_id,
      rol_visita_id: punto.rol_visita_id,
      lat: punto.lat,
      lng: punto.lng,
      precision_m: punto.precision_m,
      velocidad_mps: punto.velocidad_mps,
      rumbo: punto.rumbo,
      bateria_pct: punto.bateria_pct,
      en_recorrido: true,
      actualizado_en: punto.registrado_en,
    },
    { onConflict: 'vendedor_id' },
  )

  const { error: errHistorico } = await supabase.from('posiciones').insert(punto)

  if (errActual || errHistorico) {
    await encolar(punto)
    return
  }

  // Con la red de vuelta, se drena lo que quedó pendiente.
  await drenarCola()
}

async function encolar(punto: PuntoEncolado): Promise<void> {
  const crudo = await cacheLocal.getItem(CLAVE_COLA)
  const cola: PuntoEncolado[] = crudo ? JSON.parse(crudo) : []
  cola.push(punto)
  await cacheLocal.setItem(CLAVE_COLA, JSON.stringify(cola.slice(-MAX_EN_COLA)))
}

async function drenarCola(): Promise<void> {
  const crudo = await cacheLocal.getItem(CLAVE_COLA)
  if (!crudo) return

  const cola: PuntoEncolado[] = JSON.parse(crudo)
  if (cola.length === 0) return

  const { error } = await supabase.from('posiciones').insert(cola)
  if (!error) await cacheLocal.removeItem(CLAVE_COLA)
}

async function vaciarCola(): Promise<void> {
  await drenarCola()
  await cacheLocal.removeItem(CLAVE_COLA)
}

async function parametros(): Promise<{ intervaloSeg: number; distanciaMin: number }> {
  try {
    const { data } = await supabase
      .from('configuracion')
      .select('clave, valor')
      .in('clave', ['tracking_intervalo_seg', 'tracking_distancia_min_m'])

    const mapa = new Map((data ?? []).map((f: { clave: string; valor: unknown }) => [f.clave, Number(f.valor)]))
    return {
      intervaloSeg: mapa.get('tracking_intervalo_seg') ?? 20,
      distanciaMin: mapa.get('tracking_distancia_min_m') ?? 30,
    }
  } catch {
    return { intervaloSeg: 20, distanciaMin: 30 }
  }
}
