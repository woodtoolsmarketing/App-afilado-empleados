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
 *
 * Es el sesgo POR DEFECTO: cuando el que llama manda `sesgo` (la ubicación del
 * vendedor o del pueblo del cliente), se usa ESE centro en vez de éste — es lo
 * que hace que "Bolívar 1630" en San Carlos de Bolívar (a 330 km del Obelisco,
 * fuera de este círculo) caiga sobre la calle del pueblo y no sobre la ciudad
 * ni el país homónimos.
 */
const SESGO_ARGENTINA = {
  circle: {
    center: { latitude: -34.6037, longitude: -58.3816 },
    radius: 50_000.0,
  },
}

/** Radio del sesgo cuando viene un centro propio (pueblo/GPS): abarca el pueblo y el campo alrededor. */
const RADIO_SESGO_LOCAL = 20_000.0

/**
 * Tipos de lugar de Google. Una sugerencia que es SÓLO un país / provincia /
 * localidad (sin nada de calle) no es una dirección: es el error de cuando la
 * calle se llama igual que la ciudad o el país ("Bolívar" → la ciudad Bolívar o
 * el país Bolivia). Se descartan esas; ver `esSoloLugar`.
 */
const TIPOS_CALLE = [
  'route',
  'street_address',
  'premise',
  'subpremise',
  'establishment',
  'point_of_interest',
  'intersection',
]
const TIPOS_LUGAR = [
  'country',
  'locality',
  'administrative_area_level_1',
  'administrative_area_level_2',
  'administrative_area_level_3',
  'postal_code',
]

/**
 * ¿Esta sugerencia es SÓLO una ciudad / provincia / país (no una calle)?
 *
 * Defensivo a propósito: si Google no mandó `types` (array vacío) devuelve
 * `false` → la sugerencia se conserva. Nunca se tira algo por falta de dato.
 */
function esSoloLugar(tipos: string[]): boolean {
  return (
    tipos.length > 0 &&
    tipos.some((t) => TIPOS_LUGAR.includes(t)) &&
    !tipos.some((t) => TIPOS_CALLE.includes(t))
  )
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

/**
 * ¿`texto` arranca con un plus code de Google (Open Location Code)?
 *
 * Google devuelve la dirección formateada como plus code —"XCC7+W7 Puerto
 * Esperanza, Misiones, Argentina"— cuando el punto no cae sobre una calle con
 * numeración (campos, rutas). Para la oficina eso es ilegible. El patrón: un
 * bloque de dos o más caracteres, un '+', dos o más caracteres, al principio
 * del texto (una dirección de calle nunca empieza así).
 */
function esPlusCode(texto: string): boolean {
  return /^[A-Z0-9]{2,}\+[A-Z0-9]{2,}\b/i.test((texto ?? '').trim())
}

interface ResultadoGeo {
  types?: string[]
  formatted_address?: string
  address_components?: { types: string[]; long_name: string }[]
  place_id?: string
  geometry?: { location_type?: string }
}

/**
 * De los resultados del reverse-geocode, el más legible para una persona.
 *
 * Google ordena del más específico al menos, pero en el campo el "más
 * específico" suele ser un plus code (sin calle). Preferimos, en orden: una
 * dirección con número de calle; si no, una con calle (ej. "Ruta Nacional 12,
 * Puerto Esperanza"); si no, el primero que no sea un plus code (una
 * localidad). Como último recurso devolvemos el primero tal cual —aunque sea
 * el plus code—: siempre es mejor eso que dejar a la oficina sin nada.
 */
function elegirLugarLegible(results: ResultadoGeo[]): ResultadoGeo {
  const tiene = (r: ResultadoGeo, tipo: string) =>
    (r.address_components ?? []).some((c) => c.types?.includes(tipo))
  const esPlus = (r: ResultadoGeo) =>
    (r.types ?? []).includes('plus_code') || esPlusCode(r.formatted_address ?? '')
  return (
    results.find((r) => !esPlus(r) && tiene(r, 'street_number')) ??
    results.find((r) => !esPlus(r) && tiene(r, 'route')) ??
    results.find((r) => !esPlus(r)) ??
    results[0]
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

    // `sesgo` (opcional): { lat, lng } con el centro al que sesgar el
    // autocompletado — la ubicación del vendedor (GPS) o del pueblo del cliente.
    // `localidad` (opcional): el pueblo del cliente, que se le agrega al texto
    // para desambiguar cuando la calle se llama igual que la ciudad/país.
    // Los dos son retrocompatibles: si no vienen, el comportamiento es el de
    // siempre (sesgo AMBA, texto tal cual).
    const { operacion, texto, place_id, sesion, lat, lng, preferir_calle, sesgo, localidad } =
      await req.json()

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

      /**
       * El estado de Google manda ANTES que los resultados.
       *
       * Un `REQUEST_DENIED` —billing caído, clave sin permiso— también vuelve
       * sin `results`, así que chequear primero el largo lo disfrazaba de "no
       * hay dirección acá" y mandaba al vendedor a buscar a mano algo que en
       * realidad estaba roto del lado del servidor. Pasó exactamente eso: con la
       * facturación deshabilitada, la app decía "no encontramos una dirección"
       * y nadie se enteraba de que el motivo real era el billing.
       *
       * El único "sin resultados" legítimo es `ZERO_RESULTS`: ahí sí no hay una
       * calle para ese punto. Cualquier otro estado distinto de OK es un rechazo
       * y se dice tal cual, con el motivo que da Google.
       */
      if (datos.status === 'ZERO_RESULTS') {
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
      if (!datos.results?.length) {
        throw new RespuestaError(
          'No encontramos una dirección para donde estás parado. Buscala a mano.',
          404,
        )
      }

      // Normalmente la dirección exacta es el primer resultado. Pero en el campo
      // (rutas sin numeración) Google devuelve primero un PLUS CODE —"XCC7+W7
      // Puerto Esperanza…"—, ilegible para la oficina. Con `preferir_calle`
      // salteamos esos y nos quedamos con el primer resultado con calle (ej.
      // "Ruta Nacional 12, Puerto Esperanza"); si no hay mejor, cae al primero
      // igual que antes. Sin la bandera —como lo llama la app del vendedor— el
      // comportamiento NO cambia: sigue siendo results[0].
      const lugar =
        preferir_calle === true ? elegirLugarLegible(datos.results) : datos.results[0]
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

      // Desambiguar por pueblo: si viene `localidad` y el texto no la tiene ya,
      // se la pegamos ("Bolívar 1630" → "Bolívar 1630, San Carlos de Bolivar").
      // Así Google no confunde la CALLE con la CIUDAD/PAÍS homónimos.
      const loc = typeof localidad === 'string' ? localidad.trim() : ''
      const entrada =
        loc && !texto.toLowerCase().includes(loc.toLowerCase()) ? `${texto}, ${loc}` : texto

      // Sesgar al pueblo cuando viene un centro propio (GPS del vendedor o
      // ubicación del cliente). Si no, el sesgo AMBA de siempre.
      const sesgoValido =
        sesgo && typeof sesgo.lat === 'number' && typeof sesgo.lng === 'number'
      const locationBias = sesgoValido
        ? {
            circle: {
              center: { latitude: sesgo.lat, longitude: sesgo.lng },
              radius: RADIO_SESGO_LOCAL,
            },
          }
        : SESGO_ARGENTINA

      const respuesta = await fetch(AUTOCOMPLETE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': clave },
        body: JSON.stringify({
          input: entrada,
          languageCode: 'es-419',
          regionCode: 'AR',
          includedRegionCodes: ['ar'],
          locationBias,
          // El token de sesión agrupa el autocompletado con el detalle
          // posterior y hace que Google los cobre como una sola operación.
          sessionToken: sesion,
        }),
      })

      if (!respuesta.ok) {
        throw await errorDeGoogle('autocomplete', respuesta)
      }

      const datos = await respuesta.json()
      const predicciones = (datos.suggestions ?? [])
        .filter((s: { placePrediction?: unknown }) => s.placePrediction)
        .map((s: { placePrediction: Record<string, never> }) => {
          const p = s.placePrediction as never as {
            placeId: string
            text?: { text: string }
            types?: string[]
            structuredFormat?: {
              mainText?: { text: string }
              secondaryText?: { text: string }
            }
          }
          return {
            place_id: p.placeId,
            texto: p.text?.text ?? '',
            principal: p.structuredFormat?.mainText?.text ?? '',
            secundario: p.structuredFormat?.secondaryText?.text ?? '',
            types: Array.isArray(p.types) ? p.types : [],
          }
        })

      // Sacar las sugerencias que son SÓLO ciudad/provincia/país (el error de
      // "Bolívar" → la ciudad o "Bolivia"). Si al filtrar no queda NADA —porque
      // Google no mandó nada mejor—, devolvemos la lista original: mejor algo
      // imperfecto que una pantalla vacía.
      const calles = predicciones.filter((p) => !esSoloLugar(p.types))
      const elegidas = calles.length > 0 ? calles : predicciones

      // `types` era sólo para filtrar; no se devuelve.
      const sugerencias = elegidas.map((p) => ({
        place_id: p.place_id,
        texto: p.texto,
        principal: p.principal,
        secundario: p.secundario,
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
