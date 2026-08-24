import * as Battery from 'expo-battery'
import * as Location from 'expo-location'
import * as TaskManager from 'expo-task-manager'

import { distanciaEnMetros } from '@woodtools/compartido'

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

/**
 * Sólo el permiso de "mientras usás la app".
 *
 * Para leer dónde está parado el vendedor ahora mismo alcanza con éste. Pedirle
 * además el de segundo plano —que es el que Android muestra con la advertencia
 * de que la app puede seguirlo con la pantalla apagada— para completar un campo
 * de dirección sería pedir mucho más de lo que hace falta, y es la clase de
 * cartel que hace que alguien apriete "Rechazar" y no vuelva a intentarlo.
 *
 * El de segundo plano se sigue pidiendo aparte, cuando arranca el recorrido,
 * que es cuando de verdad se necesita.
 */
export async function permisoDeUbicacionPuntual(): Promise<boolean> {
  const { granted } = await Location.requestForegroundPermissionsAsync()
  return granted
}

// ─────────────────────────────────────────────────────────────────────────────
// Arranque y parada
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cuánto se espera un punto nuevo antes de conformarse con el último conocido.
 *
 * `getCurrentPositionAsync` no trae timeout propio: adentro de un galpón, en un
 * subsuelo o con el GPS frío puede no resolver NUNCA. Y un `await` que no
 * resuelve no lo salva un try/catch — deja la mutación colgada, el botón
 * girando y al vendedor sin saber si guardó o no.
 *
 * Doce segundos es lo que tarda un teléfono con cielo a la vista en dar un
 * punto bueno. Pasado eso, el último punto conocido dice más que nada.
 */
const ESPERA_MAXIMA_MS = 12_000

/** Cuán viejo puede ser el último punto conocido y todavía servir. */
const ANTIGUEDAD_ACEPTABLE_MS = 5 * 60_000

export async function ubicacionActual(): Promise<{ lat: number; lng: number; precision: number | null }> {
  // Se queda pidiendo `High`: el desvío de la visita se mide contra esto, y
  // cien metros de error alcanzan para marcar como "lejos" a alguien que está
  // parado en la puerta. El que afloja es el reloj, no la precisión.
  const pos = await Promise.race([
    Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
    new Promise<Location.LocationObject | null>((resolver) => {
      setTimeout(() => {
        // El pedido de arriba sigue vivo: si contesta antes que esto, gana él.
        Location.getLastKnownPositionAsync({ maxAge: ANTIGUEDAD_ACEPTABLE_MS })
          .then(resolver)
          .catch(() => resolver(null))
      }, ESPERA_MAXIMA_MS)
    }),
  ])

  // Fallar acá es aceptable y está previsto: quien registra una visita lo hace
  // dentro de un try/catch y la guarda sin coordenadas. Lo que no se podía
  // seguir haciendo era colgarse en silencio.
  if (!pos) {
    throw new Error('No pudimos leer tu ubicación. Probá a cielo abierto o reintentá en un momento.')
  }

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
  // Si falla no se reintenta y no se mira el error: el punto siguiente lo pisa,
  // porque es un upsert de una sola fila por vendedor.
  await supabase.from('posiciones_actuales').upsert(
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

  // Se encola sólo si falló EL HISTÓRICO. Antes alcanzaba con que fallara
  // cualquiera de las dos, y cuando la que fallaba era el pin en vivo el punto
  // ya estaba guardado: al drenar la cola se insertaba una segunda vez y la
  // traza del recorrido quedaba con puntos repetidos. Que se pierda un pin en
  // vivo no cuesta nada — el siguiente punto lo pisa, es un upsert.
  if (errHistorico) {
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

/** Devuelve si la cola llegó al servidor. Sólo borra cuando llegó. */
async function drenarCola(): Promise<boolean> {
  const crudo = await cacheLocal.getItem(CLAVE_COLA)
  if (!crudo) return true

  const cola: PuntoEncolado[] = JSON.parse(crudo)
  if (cola.length === 0) return true

  const { error } = await supabase.from('posiciones').insert(cola)
  if (error) return false

  await cacheLocal.removeItem(CLAVE_COLA)
  return true
}

/**
 * Cierra el seguimiento intentando subir lo que quedó pendiente.
 *
 * Antes borraba la cola SIEMPRE, incluso cuando el envío acababa de fallar.
 * `drenarCola` era cuidadoso a propósito —sólo limpiaba si Postgres había
 * aceptado— y esta función tiraba abajo ese cuidado dos líneas después: el
 * recorrido de una tarde entera sin señal se perdía justo al terminar el día,
 * que es cuando el vendedor toca "finalizar".
 *
 * Ahora lo que no se pudo subir se queda en el teléfono. Se drena solo en el
 * próximo punto que se publique, o al arrancar el recorrido siguiente.
 */
async function vaciarCola(): Promise<void> {
  await drenarCola()
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

/**
 * A partir de cuántos metros se considera que el vendedor llegó al destino.
 *
 * Sale de la base y no de una constante para que la oficina lo pueda mover sin
 * recompilar nada. Es el mismo valor con el que el servidor decide si una nota
 * de pedido se hizo en el lugar: si cada lado usara el suyo, la app podría
 * decirle "llegaste" a alguien de quien el panel dice que no estuvo ahí.
 */
export async function radioDeLlegadaM(): Promise<number> {
  try {
    const { data } = await supabase
      .from('configuracion')
      .select('valor')
      .eq('clave', 'llegada_radio_m')
      .maybeSingle()
    const n = Number((data as { valor: unknown } | null)?.valor)
    return Number.isFinite(n) && n > 0 ? n : 150
  } catch {
    return 150
  }
}

/**
 * Qué prioridad le toca a un destino que se agrega en el momento.
 *
 * ── Por qué ya no la elige el vendedor ──────────────────────────────────────
 *
 * Antes había que elegir entre ALTA, MEDIA y BAJA en un desplegable, y ALTA
 * prometía "se visita a continuación, sin importar la distancia". Eso convertía
 * una decisión de logística —¿conviene desviarse?— en una de urgencia, y las
 * dos no son la misma: un envío urgentísimo del otro lado del conurbano no
 * conviene meterlo al medio del recorrido, y uno que queda a tres cuadras
 * conviene aunque no corra apuro.
 *
 * Ahora la decide la distancia. Si el vendedor está cerca, el destino se clava
 * adelante y se desvía. Si no, entra a la ruta y la optimización de Google lo
 * ubica donde menos cuesta.
 *
 * ── El radio ────────────────────────────────────────────────────────────────
 *
 * Diez veces el radio de llegada: si "llegué" son 150 metros, "me queda de
 * paso" es un kilómetro y medio. No es un número exacto porque no hay uno
 * exacto — es el orden de magnitud de "estoy por acá".
 *
 * Sin señal devuelve `baja`: no saber dónde está el vendedor no es razón para
 * mandarlo a cruzar la ciudad.
 */
export async function prioridadPorCercania(lat: number, lng: number): Promise<'alta' | 'baja'> {
  try {
    const [donde, radio] = await Promise.all([ubicacionActual(), radioDeLlegadaM()])
    const metros = distanciaEnMetros(donde, { lat, lng })
    return metros <= radio * 10 ? 'alta' : 'baja'
  } catch {
    return 'baja'
  }
}
