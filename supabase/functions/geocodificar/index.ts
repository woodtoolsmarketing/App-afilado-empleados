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
 * Búsqueda de direcciones para "AGREGAR NUEVO DESTINO".
 *
 * Dos operaciones:
 *  · `sugerir`  → autocompletado mientras el vendedor escribe.
 *  · `detallar` → al elegir una sugerencia, devuelve coordenadas y código
 *                 postal, que es lo que completa el campo CP automáticamente.
 *
 * La clave de servidor de Google no sale de acá. La del APK (Maps SDK for
 * Android) es distinta y está restringida por package name + huella SHA-1:
 * sirve para dibujar el mapa, no para consultar Places.
 */

const AUTOCOMPLETE_URL = 'https://places.googleapis.com/v1/places:autocomplete'
const DETALLE_URL = 'https://places.googleapis.com/v1/places'

/** Sesga la búsqueda al AMBA, que es donde recorren los vendedores. */
const SESGO_ARGENTINA = {
  circle: {
    center: { latitude: -34.6037, longitude: -58.3816 },
    radius: 90_000.0,
  },
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

    const { operacion, texto, place_id, sesion } = await req.json()

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
        console.error('[geocodificar] autocomplete', respuesta.status, await respuesta.text())
        throw new RespuestaError('No pudimos buscar la dirección', 502)
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
        console.error('[geocodificar] detalle', respuesta.status, await respuesta.text())
        throw new RespuestaError('No pudimos leer los datos de esa dirección', 502)
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

    throw new RespuestaError('Operación desconocida. Usá "sugerir" o "detallar".', 400)
  } catch (e) {
    return manejarError(e)
  }
})
