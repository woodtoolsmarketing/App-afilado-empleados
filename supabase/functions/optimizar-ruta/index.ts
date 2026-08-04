import { createClient } from 'jsr:@supabase/supabase-js@2'

import {
  autenticar,
  claveSecreta,
  cors,
  manejarError,
  responder,
  RespuestaError,
  URL_SUPABASE,
} from '../_compartido/comun.ts'

/**
 * Optimización del recorrido del día con Google Routes API.
 *
 * Por qué Routes API y no Directions API: Directions API pasó a "Legacy" el
 * 1/3/2025 y ya no se puede habilitar en proyectos de Google Cloud nuevos.
 *
 * Límites que condicionan el diseño:
 *  · `intermediates` acepta hasta 25 waypoints intermedios (+ origen + destino).
 *  · `optimizeWaypointOrder: true` exige que ningún intermedio sea `via`, que
 *    `routingPreference` NO sea TRAFFIC_AWARE_OPTIMAL, y que el field mask
 *    incluya `routes.optimizedIntermediateWaypointIndex` — si falta, falla.
 *
 * Cómo se combinan las prioridades con la optimización de Google:
 *  1. Las paradas de prioridad ALTA se sacan de la optimización y se clavan
 *     adelante, en el orden en que se cargaron. Es la regla del negocio: van
 *     primero aunque queden lejos.
 *  2. El resto se manda a Google para que lo ordene por tiempo real de manejo.
 *  3. Después, cada parada MEDIA se corre a la posición `prioridad_media_offset`
 *     (3 por defecto) dentro de ese resto, manteniendo el orden entre sí.
 *  4. Las BAJAS quedan donde las puso Google: puro criterio de cercanía.
 */

const RUTAS_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes'

const FIELD_MASK = [
  'routes.duration',
  'routes.distanceMeters',
  'routes.polyline.encodedPolyline',
  'routes.legs.duration',
  'routes.legs.distanceMeters',
  'routes.optimizedIntermediateWaypointIndex',
].join(',')

/** Tope duro de Google: 25 intermedios + origen + destino. */
const MAX_INTERMEDIOS = 25

interface ParadaPendiente {
  id: string
  orden: number
  prioridad: 'alta' | 'media' | 'baja'
  creado_en: string
  direcciones: { lat: number; lng: number } | null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const admin = createClient(URL_SUPABASE, claveSecreta(), {
      auth: { persistSession: false },
    })

    // Autenticar SIEMPRE primero. Chequear la configuración antes le contaría
    // a cualquiera que tenga la clave publicable qué secretos están cargados.
    const llamador = await autenticar(req, admin as never)

    const clave = Deno.env.get('GOOGLE_MAPS_SERVER_KEY')
    if (!clave) throw new RespuestaError('Falta configurar GOOGLE_MAPS_SERVER_KEY', 500)

    const { rol_visita_id, origen } = await req.json()
    if (!rol_visita_id) throw new RespuestaError('Falta rol_visita_id', 400)

    // ── Autorización: el vendedor sólo optimiza su propia jornada ────────────
    const { data: jornada } = await admin
      .from('roles_visita')
      .select('id, vendedor_id, origen_lat, origen_lng, perfiles(origen_lat, origen_lng)')
      .eq('id', rol_visita_id)
      .maybeSingle()

    if (!jornada) throw new RespuestaError('No existe esa jornada', 404)
    if (jornada.vendedor_id !== llamador.id && llamador.rol === 'vendedor') {
      throw new RespuestaError('Esa jornada no es tuya', 403)
    }

    const perfil = jornada.perfiles as { origen_lat: number | null; origen_lng: number | null } | null
    const puntoOrigen =
      origen?.lat != null && origen?.lng != null
        ? { lat: Number(origen.lat), lng: Number(origen.lng) }
        : jornada.origen_lat != null
          ? { lat: jornada.origen_lat, lng: jornada.origen_lng! }
          : perfil?.origen_lat != null
            ? { lat: perfil.origen_lat, lng: perfil.origen_lng! }
            : null

    if (!puntoOrigen) {
      throw new RespuestaError(
        'No sabemos desde dónde arrancás. Activá la ubicación o cargá un punto de partida en tu perfil.',
        422,
      )
    }

    // ── Paradas todavía sin resolver ─────────────────────────────────────────
    const { data: paradas } = await admin
      .from('paradas')
      .select('id, orden, prioridad, creado_en, direcciones ( lat, lng )')
      .eq('rol_visita_id', rol_visita_id)
      .in('estado', ['pendiente', 'en_camino'])
      .order('orden', { ascending: true })
      .returns<ParadaPendiente[]>()

    const pendientes = (paradas ?? []).filter((p) => p.direcciones)

    if (pendientes.length === 0) {
      return responder({ orden: [], mensaje: 'No quedan destinos pendientes.' })
    }

    // Las ya resueltas conservan su numeración; lo nuevo arranca después.
    const { count: resueltas } = await admin
      .from('paradas')
      .select('id', { count: 'exact', head: true })
      .eq('rol_visita_id', rol_visita_id)
      .not('estado', 'in', '(pendiente,en_camino)')

    const piso = resueltas ?? 0

    // Con una sola parada no hay nada que optimizar.
    if (pendientes.length === 1) {
      await admin.from('paradas').update({ orden: piso + 1 }).eq('id', pendientes[0].id)
      return responder({ orden: [pendientes[0].id], optimizado: false })
    }

    if (pendientes.length > MAX_INTERMEDIOS + 1) {
      throw new RespuestaError(
        `El recorrido tiene ${pendientes.length} destinos y Google optimiza hasta ${MAX_INTERMEDIOS + 1} por vez. Dividí la jornada.`,
        422,
      )
    }

    // ── 1. Las de prioridad alta se clavan adelante ──────────────────────────
    const altas = pendientes.filter((p) => p.prioridad === 'alta')
    const resto = pendientes.filter((p) => p.prioridad !== 'alta')

    let ordenFinal: ParadaPendiente[] = []
    let distanciaTotal = 0
    let duracionTotal = 0
    let polilinea: string | null = null

    if (resto.length === 0) {
      ordenFinal = altas
    } else {
      // El punto de partida de la optimización del resto es la última parada
      // de prioridad alta; si no hay ninguna, la ubicación del vendedor.
      const ultimaAlta = altas.at(-1)
      const desde = ultimaAlta?.direcciones ?? puntoOrigen

      const cuerpo = {
        origin: punto(desde),
        destination: punto(resto.at(-1)!.direcciones!),
        intermediates: resto.slice(0, -1).map((p) => punto(p.direcciones!)),
        travelMode: 'DRIVE',
        // TRAFFIC_AWARE_OPTIMAL es incompatible con optimizeWaypointOrder.
        routingPreference: 'TRAFFIC_AWARE',
        optimizeWaypointOrder: resto.length > 2,
        languageCode: 'es-419',
        regionCode: 'AR',
        units: 'METRIC',
      }

      const respuesta = await fetch(RUTAS_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': clave,
          'X-Goog-FieldMask': FIELD_MASK,
        },
        body: JSON.stringify(cuerpo),
      })

      if (!respuesta.ok) {
        const detalle = await respuesta.text()
        console.error('[optimizar-ruta] Routes API', respuesta.status, detalle)
        throw new RespuestaError(
          'Google no pudo calcular la ruta. El recorrido queda ordenado por cercanía.',
          502,
        )
      }

      const datos = await respuesta.json()
      const ruta = datos.routes?.[0]
      if (!ruta) throw new RespuestaError('Google no devolvió ninguna ruta', 502)

      const indices: number[] = ruta.optimizedIntermediateWaypointIndex ??
        resto.slice(0, -1).map((_, i) => i)

      const intermedios = indices.map((i) => resto[i])
      let restoOrdenado = [...intermedios, resto.at(-1)!]

      // ── 3. Las medias se adelantan al offset configurado ───────────────────
      restoOrdenado = adelantarMedias(restoOrdenado, await offsetMedia(admin))

      ordenFinal = [...altas, ...restoOrdenado]

      distanciaTotal = ruta.distanceMeters ?? 0
      duracionTotal = Number(String(ruta.duration ?? '0s').replace('s', ''))
      polilinea = ruta.polyline?.encodedPolyline ?? null
    }

    // ── Persistencia ─────────────────────────────────────────────────────────
    // Se numera en dos pasadas porque el índice único (rol_visita_id, orden)
    // chocaría a mitad de camino. El rango temporal está por encima de
    // cualquier orden real y respeta el CHECK de orden > 0.
    const ORDEN_TEMPORAL = 1_000_000

    for (let i = 0; i < ordenFinal.length; i += 1) {
      await admin
        .from('paradas')
        .update({ orden: ORDEN_TEMPORAL + i + 1 })
        .eq('id', ordenFinal[i].id)
    }
    for (let i = 0; i < ordenFinal.length; i += 1) {
      await admin.from('paradas').update({ orden: piso + i + 1 }).eq('id', ordenFinal[i].id)
    }

    await admin
      .from('roles_visita')
      .update({
        distancia_total_m: distanciaTotal || null,
        duracion_total_seg: duracionTotal || null,
        polilinea,
        optimizado_en: new Date().toISOString(),
        origen_lat: puntoOrigen.lat,
        origen_lng: puntoOrigen.lng,
      })
      .eq('id', rol_visita_id)

    return responder({
      orden: ordenFinal.map((p) => p.id),
      optimizado: true,
      distancia_total_m: distanciaTotal,
      duracion_total_seg: duracionTotal,
      polilinea,
    })
  } catch (e) {
    return manejarError(e)
  }
})

function punto(p: { lat: number; lng: number }) {
  return { location: { latLng: { latitude: p.lat, longitude: p.lng } } }
}

/**
 * Corre las paradas de prioridad media hacia adelante, a `offset` posiciones
 * del inicio, conservando el orden relativo entre ellas.
 */
function adelantarMedias<T extends { prioridad: string }>(lista: T[], offset: number): T[] {
  const medias = lista.filter((p) => p.prioridad === 'media')
  if (medias.length === 0) return lista

  const bajas = lista.filter((p) => p.prioridad !== 'media')
  const posicion = Math.min(Math.max(offset - 1, 0), bajas.length)

  return [...bajas.slice(0, posicion), ...medias, ...bajas.slice(posicion)]
}

async function offsetMedia(admin: { from: (t: string) => any }): Promise<number> {
  const { data } = await admin
    .from('configuracion')
    .select('valor')
    .eq('clave', 'prioridad_media_offset')
    .maybeSingle()
  return Number(data?.valor ?? 3)
}
