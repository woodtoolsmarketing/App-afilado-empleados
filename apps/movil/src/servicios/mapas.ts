import type { Direccion, ParadaCompleta } from '@woodtools/compartido'
import * as Linking from 'expo-linking'
import { Platform } from 'react-native'

import { supabase } from '../nucleo/supabase'

/**
 * Google Maps.
 *
 * ── Sobre el límite de destinos (la pregunta que quedó abierta) ──────────────
 *
 * Hay que separar dos cosas que suelen confundirse:
 *
 *  1. CALCULAR el recorrido: Routes API acepta hasta 25 paradas intermedias
 *     más el origen y el destino (27 puntos). 13 destinos entran de sobra, y
 *     hasta 25 también. Eso lo resuelve la Edge Function `optimizar-ruta`.
 *
 *  2. ABRIR la app de Google Maps para que maneje: acá sí hay un techo bajo.
 *     La URL universal de Maps admite "up to three waypoints on mobile
 *     browsers, and a maximum of nine waypoints supported otherwise", con un
 *     tope de 2.048 caracteres. No hay forma de meterle 13 paradas.
 *
 * La solución es navegar TRAMO A TRAMO: se lanza la navegación al próximo
 * destino nada más. Cuando el vendedor llega y completa el parte, se lanza la
 * navegación al siguiente. Además de ser lo único que funciona con más de 9
 * paradas, es lo correcto para este flujo: la ruta se recalcula con el tránsito
 * real de ese momento, y si aparece un destino de prioridad alta se intercala
 * sin tener que rearmar nada.
 *
 * El recorrido completo igual se ve dentro de la app, dibujado sobre el mapa
 * con la polilínea que devuelve Routes API — ahí no hay límite de puntos.
 */

/**
 * Invoca una Edge Function y deja pasar el motivo real del error.
 *
 * `functions.invoke` devuelve un `FunctionsHttpError` cuyo mensaje es siempre
 * el mismo: "Edge Function returned a non-2xx status code". El motivo viaja en
 * el cuerpo de la respuesta —`{ error: "..." }`, que es lo que arma
 * `manejarError`— y supabase-js lo deja ahí adentro, en `error.context`.
 *
 * Sin esto, una función mal configurada en el servidor se le aparece al
 * vendedor como "no pudimos buscar la dirección" y nadie se entera nunca de
 * que lo que falta es cargar una clave. Pasó exactamente eso con
 * `GOOGLE_MAPS_SERVER_KEY`.
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
      // No era JSON. Nos quedamos con el error original.
    }
  }

  throw motivo ? new Error(motivo) : error
}

export interface SugerenciaDireccion {
  place_id: string
  texto: string
  principal: string
  secundario: string
}

/** Autocompletado de direcciones mientras el vendedor escribe. */
export async function sugerirDirecciones(
  texto: string,
  sesion: string,
): Promise<SugerenciaDireccion[]> {
  const data = await invocar<{ sugerencias?: SugerenciaDireccion[] }>('geocodificar', {
    operacion: 'sugerir',
    texto,
    sesion,
  })
  return data?.sugerencias ?? []
}

export type DireccionResuelta = Omit<Direccion, 'id' | 'cliente_id' | 'etiqueta' | 'principal' | 'observaciones'>

/** Datos completos de una sugerencia: coordenadas y código postal. */
export async function detallarDireccion(
  placeId: string,
  sesion: string,
): Promise<DireccionResuelta> {
  const data = await invocar<{ direccion?: DireccionResuelta }>('geocodificar', {
    operacion: 'detallar',
    place_id: placeId,
    sesion,
  })
  if (!data?.direccion?.lat) {
    throw new Error('Google no devolvió las coordenadas de esa dirección. Probá con otra.')
  }
  return data.direccion
}

export interface ResultadoOptimizacion {
  orden: string[]
  optimizado: boolean
  distancia_total_m?: number
  duracion_total_seg?: number
  polilinea?: string | null
  mensaje?: string
}

/**
 * Reordena las paradas pendientes por tiempo real de manejo, respetando las
 * prioridades. Si Google falla, la base ya tiene el orden por cercanía
 * calculado con PostGIS, así que el recorrido sigue siendo usable.
 */
export async function optimizarRecorrido(
  rolVisitaId: string,
  origen?: { lat: number; lng: number },
): Promise<ResultadoOptimizacion> {
  return invocar<ResultadoOptimizacion>('optimizar-ruta', {
    rol_visita_id: rolVisitaId,
    origen,
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Lanzar la navegación
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Abre Google Maps en modo navegación turn-by-turn hacia una única parada.
 *
 * `google.navigation:` entra directo a la navegación por voz, sin la pantalla
 * intermedia de previsualización. Es un intent exclusivo de Android; en
 * cualquier otra plataforma se cae a la URL universal.
 */
export async function navegarHacia(destino: { lat: number; lng: number }): Promise<void> {
  const candidatos =
    Platform.OS === 'android'
      ? [
          `google.navigation:q=${destino.lat},${destino.lng}&mode=d`,
          `geo:${destino.lat},${destino.lng}?q=${destino.lat},${destino.lng}`,
        ]
      : []

  candidatos.push(
    `https://www.google.com/maps/dir/?api=1&destination=${destino.lat},${destino.lng}&travelmode=driving&dir_action=navigate`,
  )

  for (const url of candidatos) {
    if (await Linking.canOpenURL(url)) {
      await Linking.openURL(url)
      return
    }
  }

  throw new Error('No encontramos Google Maps instalado en el teléfono.')
}

/**
 * Vista previa del recorrido en la app de Google Maps.
 *
 * Sólo se usa para ver el trazado general: por el límite de la URL universal
 * se mandan como máximo las primeras paradas. La navegación real siempre va
 * tramo a tramo con `navegarHacia`.
 */
export const MAX_PARADAS_EN_URL = 9

export async function previsualizarRecorrido(
  origen: { lat: number; lng: number },
  paradas: ParadaCompleta[],
): Promise<{ abierto: boolean; incluidas: number; total: number }> {
  const conCoordenadas = paradas.filter((p) => p.direccion)
  if (conCoordenadas.length === 0) return { abierto: false, incluidas: 0, total: 0 }

  const incluidas = conCoordenadas.slice(0, MAX_PARADAS_EN_URL + 1)
  const destino = incluidas.at(-1)!.direccion
  const intermedias = incluidas.slice(0, -1)

  const url = new URL('https://www.google.com/maps/dir/')
  url.searchParams.set('api', '1')
  url.searchParams.set('origin', `${origen.lat},${origen.lng}`)
  url.searchParams.set('destination', `${destino.lat},${destino.lng}`)
  url.searchParams.set('travelmode', 'driving')
  if (intermedias.length > 0) {
    url.searchParams.set(
      'waypoints',
      intermedias.map((p) => `${p.direccion.lat},${p.direccion.lng}`).join('|'),
    )
  }

  await Linking.openURL(url.toString())
  return { abierto: true, incluidas: incluidas.length, total: conCoordenadas.length }
}

// ─────────────────────────────────────────────────────────────────────────────
// Polilínea
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Decodifica la polilínea codificada de Google al formato que espera
 * `react-native-maps`. Es el algoritmo estándar de Encoded Polyline Algorithm
 * Format; se implementa acá para no sumar una dependencia por 30 líneas.
 */
export function decodificarPolilinea(
  codificada: string,
): Array<{ latitude: number; longitude: number }> {
  const puntos: Array<{ latitude: number; longitude: number }> = []
  let indice = 0
  let lat = 0
  let lng = 0

  while (indice < codificada.length) {
    let resultado = 0
    let desplazamiento = 0
    let byte: number

    do {
      byte = codificada.charCodeAt(indice++) - 63
      resultado |= (byte & 0x1f) << desplazamiento
      desplazamiento += 5
    } while (byte >= 0x20)
    lat += resultado & 1 ? ~(resultado >> 1) : resultado >> 1

    resultado = 0
    desplazamiento = 0
    do {
      byte = codificada.charCodeAt(indice++) - 63
      resultado |= (byte & 0x1f) << desplazamiento
      desplazamiento += 5
    } while (byte >= 0x20)
    lng += resultado & 1 ? ~(resultado >> 1) : resultado >> 1

    puntos.push({ latitude: lat / 1e5, longitude: lng / 1e5 })
  }

  return puntos
}
