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
 * Búsqueda de direcciones para "AGREGAR NUEVO DESTINO" y para ubicar clientes.
 *
 * Tres operaciones:
 *  · `sugerir`  → autocompletado mientras el vendedor escribe.
 *  · `detallar` → al elegir una sugerencia, devuelve coordenadas y código
 *                 postal, que es lo que completa el campo CP automáticamente.
 *  · `reversa`  → de las coordenadas del GPS a una dirección escrita, para
 *                 "USAR MI UBICACIÓN ACTUAL".
 *
 * La clave de servidor de Google no sale de acá. La del APK (Maps SDK for
 * Android) es distinta y está restringida por package name + huella SHA-1:
 * sirve para dibujar el mapa, no para consultar Places.
 */

const AUTOCOMPLETE_URL = 'https://places.googleapis.com/v1/places:autocomplete'
const DETALLE_URL = 'https://places.googleapis.com/v1/places'
const REVERSA_URL = 'https://maps.googleapis.com/maps/api/geocode/json'

/**
 * Sesga la búsqueda al AMBA, que es donde recorren los vendedores.
 *
 * 50 km es el máximo que acepta Places API para el círculo de sesgo. Estaba en
 * 90 km, y con eso Google rechazaba la llamada ENTERA con un 400
 * ("Radius must be between 0 and 50,000 meters"), no la degradaba: el
 * autocompletado de direcciones no funcionó nunca, desde el día que se escribió.
 *
 * Es un sesgo, no un filtro: los resultados de más lejos siguen apareciendo,
 * sólo que más abajo. Con centro en el Obelisco, 50 km llegan hasta La Plata,
 * Escobar y Cañuelas, que es el radio donde está la mayor parte del padrón.
 */
const SESGO_ARGENTINA = {
  circle: {
    center: { latitude: -34.6037, longitude: -58.3816 },
    radius: 50_000.0,
  },
}

/**
 * El motivo que da Google, dicho tal cual.
 *
 * Antes esto devolvía "No pudimos buscar la dirección" y mandaba el detalle a
 * un log que nadie mira. Con eso, un radio de sesgo inválido —90 km donde
 * Google acepta 50— tuvo el autocompletado roto desde el día cero, y desde la
 * pantalla del vendedor era indistinguible de un problema de conexión.
 *
 * El mensaje de Google es técnico y en inglés, pero es lo único que permite
 * arreglarlo. Va después del texto en castellano, no en lugar de él.
 */
async function errorDeGoogle(operacion: string, respuesta: Response): Promise<RespuestaError> {
  const crudo = await respuesta.text()
  console.error(`[geocodificar] ${operacion}`, respuesta.status, crudo)

  let motivo = ''
  try {
    const cuerpo = JSON.parse(crudo)
    motivo = cuerpo?.error?.message ?? cuerpo?.error_message ?? ''
  } catch {
    // Google no devolvió JSON. Nos quedamos con el estado HTTP.
  }

  return new RespuestaError(
    motivo
      ? `Google rechazó la búsqueda: ${motivo.trim()}`
      : `Google rechazó la búsqueda (HTTP ${respuesta.status})`,
    502,
  )
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const admin = createClient(URL_SUPABASE, claveSecreta(), {
      auth: { persistSession: false },
    })

    // Autenticar SIEMPRE primero. Chequear la configuración antes le contaría
    // a cualquiera que tenga la clave publicable qué secretos están cargados.
    await autenticar(req, admin as never)

    const clave = Deno.env.get('GOOGLE_MAPS_SERVER_KEY')
    if (!clave) throw new RespuestaError('Falta configurar GOOGLE_MAPS_SERVER_KEY', 500)

    const { operacion, texto, place_id, sesion, lat, lng } = await req.json()

    /**
     * "USAR MI UBICACIÓN ACTUAL": del GPS a una dirección escrita.
     *
     * El teléfono da coordenadas; la ficha del cliente necesita una calle y una
     * altura que alguien pueda leer y verificar. Va por la Geocoding API y no
     * por el geocodificador del sistema operativo a propósito: así el texto
     * queda con el mismo formato que las direcciones que entran por el
     * buscador, y las dos se ven igual en el panel y en la planilla.
     *
     * Se devuelve también la precisión, porque acá importa de otra manera que
     * en el buscador: si el vendedor está adentro de un galpón, el GPS puede
     * errarle 50 metros y caer en el vecino.
     */
    if (operacion === 'reversa') {
      if (typeof lat !== 'number' || typeof lng !== 'number') {
        throw new RespuestaError('Faltan las coordenadas', 400)
      }

      const url = new URL(REVERSA_URL)
      url.searchParams.set('latlng', `${lat},${lng}`)
      url.searchParams.set('language', 'es-419')
      url.searchParams.set('key', clave)

      const respuesta = await fetch(url)
      if (!respuesta.ok) {
        throw await errorDeGoogle('reversa', respuesta)
      }

      const datos = await respuesta.json()
      if (datos.status === 'ZERO_RESULTS' || !datos.results?.length) {
        throw new RespuestaError(
          'No encontramos una dirección para donde estás parado. Buscala a mano.',
          404,
        )
      }
      if (datos.status !== 'OK') {
        console.error('[geocodificar] reversa', datos.status, datos.error_message)
        throw new RespuestaError(
          `Google rechazó la ubicación: ${datos.status}${datos.error_message ? ' — ' + datos.error_message : ''}`,
          502,
        )
      }

      const lugar = datos.results[0]
      const trozo = (tipo: string) =>
        (lugar.address_components ?? []).find((c: { types: string[] }) => c.types.includes(tipo))
          ?.long_name ?? null

      return responder({
        direccion: {
          google_place_id: lugar.place_id ?? null,
          direccion_formateada: lugar.formatted_address ?? '',
          calle: trozo('route'),
          numero: trozo('street_number'),
          localidad:
            trozo('locality') ?? trozo('administrative_area_level_2') ?? trozo('sublocality'),
          provincia: trozo('administrative_area_level_1'),
          pais: trozo('country') ?? 'Argentina',
          codigo_postal: trozo('postal_code') ?? trozo('postal_code_prefix'),
          // Las coordenadas que se guardan son las del GPS, no las que Google
          // devuelve del portal más cercano: el vendedor está donde está.
          lat,
          lng,
          verificada: true,
        },
        precision_google: lugar.geometry?.location_type ?? null,
      })
    }

    if (operacion === 'sugerir') {
      if (!texto || texto.trim().length < 3) return responder({ sugerencias: [] })

      const respuesta = await fetch(AUTOCOMPLETE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': clave },
        body: JSON.stringify({
          input: texto,
          languageCode: 'es-419',
          regionCode: 'AR',
          includedRegionCodes: ['ar'],
          locationBias: SESGO_ARGENTINA,
          // El token de sesión agrupa el autocompletado con el detalle
          // posterior y hace que Google los cobre como una sola operación.
          sessionToken: sesion,
        }),
      })

      if (!respuesta.ok) {
        throw await errorDeGoogle('autocomplete', respuesta)
      }

      const datos = await respuesta.json()
      const sugerencias = (datos.suggestions ?? [])
        .filter((s: { placePrediction?: unknown }) => s.placePrediction)
        .map((s: { placePrediction: Record<string, never> }) => ({
          place_id: (s.placePrediction as never as { placeId: string }).placeId,
          texto: (s.placePrediction as never as { text: { text: string } }).text?.text ?? '',
          principal:
            (s.placePrediction as never as { structuredFormat?: { mainText?: { text: string } } })
              .structuredFormat?.mainText?.text ?? '',
          secundario:
            (s.placePrediction as never as { structuredFormat?: { secondaryText?: { text: string } } })
              .structuredFormat?.secondaryText?.text ?? '',
        }))

      return responder({ sugerencias })
    }

    if (operacion === 'detallar') {
      if (!place_id) throw new RespuestaError('Falta place_id', 400)

      const url = new URL(`${DETALLE_URL}/${place_id}`)
      url.searchParams.set('languageCode', 'es-419')
      url.searchParams.set('regionCode', 'AR')
      if (sesion) url.searchParams.set('sessionToken', sesion)

      const respuesta = await fetch(url, {
        headers: {
          'X-Goog-Api-Key': clave,
          'X-Goog-FieldMask': 'id,formattedAddress,location,addressComponents,displayName',
        },
      })

      if (!respuesta.ok) {
        throw await errorDeGoogle('detalle', respuesta)
      }

      const lugar = await respuesta.json()
      const comp = (tipo: string, corto = false) => {
        const c = (lugar.addressComponents ?? []).find((x: { types: string[] }) =>
          x.types.includes(tipo),
        )
        return c ? (corto ? c.shortText : c.longText) : null
      }

      return responder({
        direccion: {
          google_place_id: lugar.id,
          direccion_formateada: lugar.formattedAddress ?? '',
          calle: comp('route'),
          numero: comp('street_number'),
          localidad:
            comp('locality') ?? comp('administrative_area_level_2') ?? comp('sublocality'),
          provincia: comp('administrative_area_level_1'),
          pais: comp('country') ?? 'Argentina',
          // En Argentina Google devuelve tanto "1704" como "B1704ARQ".
          codigo_postal: comp('postal_code') ?? comp('postal_code_prefix'),
          lat: lugar.location?.latitude ?? null,
          lng: lugar.location?.longitude ?? null,
          verificada: true,
        },
      })
    }

    throw new RespuestaError('Operación desconocida. Usá "sugerir", "detallar" o "reversa".', 400)
  } catch (e) {
    return manejarError(e)
  }
})
