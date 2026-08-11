import { createClient } from 'jsr:@supabase/supabase-js@2'

import {
  claveSecreta,
  cors,
  manejarError,
  responder,
  RespuestaError,
  URL_SUPABASE,
} from '../_compartido/comun.ts'

/**
 * El puente entre la planilla de Google y el padrón.
 *
 * ── Por qué existe esta función y no un acceso directo ──────────────────────
 *
 * La planilla necesita leer y escribir ubicaciones de clientes. Podría hacerlo
 * contra PostgREST, pero eso obligaría a poner una clave de Supabase adentro de
 * Apps Script. Acá en cambio la planilla sólo conoce dos cosas: esta URL y un
 * secreto compartido. Toda la lógica —y el acceso privilegiado a la base— vive
 * de este lado.
 *
 * Se despliega con `--no-verify-jwt` a propósito: del otro lado no hay un
 * usuario logueado, hay una planilla. Lo que autentica es `x-planilla-secreto`,
 * que se compara en tiempo constante contra el secreto `PLANILLA_SECRETO`.
 *
 * ── Quién le gana a quién ───────────────────────────────────────────────────
 *
 * Supabase es la fuente de verdad; la planilla es un espejo que además se puede
 * editar. Para distinguir "esto lo cambió una persona en la planilla" de "esto
 * quedó viejo", la planilla guarda en columnas técnicas el último valor que le
 * mandamos. Si lo que hay en la celda difiere de eso, hubo edición humana y
 * gana la planilla. Si coincide, gana la base.
 *
 * Esa comparación la hace Apps Script, que es el único que ve las dos cosas a
 * la vez. Acá llegan sólo las filas que ya se decidió aplicar.
 *
 * ── Direcciones escritas a mano ─────────────────────────────────────────────
 *
 * Si en la planilla alguien escribe una dirección pero no toca lat/lng, se
 * geocodifica acá contra Google antes de guardar. Es lo que hace que la oficina
 * pueda corregir una dirección tipeando, sin tener que averiguar coordenadas.
 */

const GEOCODING_URL = 'https://maps.googleapis.com/maps/api/geocode/json'

/** Cuántas filas devuelve como máximo cada página de lectura. */
const PAGINA_MAXIMA = 2000

interface FilaPlanilla {
  codigo: string
  razon_social: string
  direccion: string
  localidad: string
  codigo_postal: string
  lat: number | ''
  lng: number | ''
  estado: string
}

/**
 * Comparación en tiempo constante.
 *
 * Un `===` sobre secretos filtra información por el tiempo que tarda en
 * fallar: cuantos más caracteres coinciden desde el principio, más tarda. Con
 * suficientes intentos eso permite adivinar el secreto carácter por carácter.
 */
function secretoValido(recibido: string | null, esperado: string): boolean {
  if (!recibido || recibido.length !== esperado.length) return false
  let diferencia = 0
  for (let i = 0; i < esperado.length; i += 1) {
    diferencia |= recibido.charCodeAt(i) ^ esperado.charCodeAt(i)
  }
  return diferencia === 0
}

/** De una dirección escrita a coordenadas. Devuelve null si Google no la ubica. */
async function geocodificar(texto: string, clave: string) {
  const url = new URL(GEOCODING_URL)
  url.searchParams.set('address', texto)
  url.searchParams.set('language', 'es-419')
  url.searchParams.set('region', 'ar')
  url.searchParams.set('key', clave)

  const r = await fetch(url)
  if (!r.ok) return null

  const d = await r.json()
  if (d.status !== 'OK' || !d.results?.length) return null

  const res = d.results[0]
  const trozo = (tipo: string) =>
    (res.address_components ?? []).find((c: { types: string[] }) => c.types.includes(tipo))
      ?.long_name ?? null

  return {
    direccion_formateada: res.formatted_address as string,
    lat: res.geometry.location.lat as number,
    lng: res.geometry.location.lng as number,
    google_place_id: res.place_id as string,
    localidad: trozo('locality') ?? trozo('administrative_area_level_2'),
    provincia: trozo('administrative_area_level_1'),
    codigo_postal: trozo('postal_code'),
    exacta:
      ['ROOFTOP', 'RANGE_INTERPOLATED'].includes(res.geometry.location_type) &&
      res.partial_match !== true,
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const esperado = Deno.env.get('PLANILLA_SECRETO')
    if (!esperado) throw new RespuestaError('Falta configurar PLANILLA_SECRETO', 500)

    if (!secretoValido(req.headers.get('x-planilla-secreto'), esperado)) {
      throw new RespuestaError('Secreto inválido', 401)
    }

    const admin = createClient(URL_SUPABASE, claveSecreta(), {
      auth: { persistSession: false },
    })

    const cuerpo = await req.json()
    const operacion = cuerpo?.operacion

    // ── Leer: el padrón tal como tiene que verse en la planilla ─────────────
    if (operacion === 'leer') {
      const desde = Number(cuerpo.desde ?? 0)
      const cantidad = Math.min(Number(cuerpo.cantidad ?? PAGINA_MAXIMA), PAGINA_MAXIMA)

      const { data, error, count } = await admin
        .from('clientes')
        .select(
          'codigo, razon_social, direccion, localidad, codigo_postal, direcciones ( direccion_formateada, localidad, codigo_postal, lat, lng, principal )',
          { count: 'exact' },
        )
        .eq('activo', true)
        .order('codigo')
        .range(desde, desde + cantidad - 1)

      if (error) throw new RespuestaError(`No pudimos leer el padrón: ${error.message}`, 500)

      const filas: FilaPlanilla[] = (data ?? []).map((c) => {
        const ds = (c.direcciones ?? []) as Array<{
          direccion_formateada: string
          localidad: string | null
          codigo_postal: string | null
          lat: number
          lng: number
          principal: boolean
        }>
        const d = ds.find((x) => x.principal) ?? ds[0]

        return {
          codigo: c.codigo,
          razon_social: c.razon_social,
          // La geocodificada manda; si no hay, el domicilio del listado.
          direccion: d?.direccion_formateada ?? c.direccion ?? '',
          localidad: d?.localidad ?? c.localidad ?? '',
          codigo_postal: d?.codigo_postal ?? c.codigo_postal ?? '',
          lat: d?.lat ?? '',
          lng: d?.lng ?? '',
          estado: d ? 'Ubicado' : 'Sin ubicar',
        }
      })

      return responder({ filas, total: count ?? 0, desde })
    }

    // ── Guardar: lo que alguien editó en la planilla ────────────────────────
    if (operacion === 'guardar') {
      const filas = Array.isArray(cuerpo.filas) ? cuerpo.filas : []
      if (filas.length === 0) return responder({ aplicados: 0, problemas: [] })
      if (filas.length > 500) throw new RespuestaError('Mandá hasta 500 filas por vez', 400)

      const claveGoogle = Deno.env.get('GOOGLE_MAPS_SERVER_KEY')
      const aplicados: string[] = []
      const problemas: Array<{ codigo: string; motivo: string }> = []

      for (const fila of filas) {
        const codigo = String(fila.codigo ?? '').trim()
        if (!codigo) continue

        const { data: cliente } = await admin
          .from('clientes')
          .select('id')
          .eq('codigo', codigo)
          .maybeSingle()

        if (!cliente) {
          problemas.push({ codigo, motivo: 'No existe un cliente con ese código' })
          continue
        }

        const lat = Number(fila.lat)
        const lng = Number(fila.lng)
        const texto = String(fila.direccion ?? '').trim()

        let resuelta: {
          direccion_formateada: string
          lat: number
          lng: number
          google_place_id: string | null
          localidad: string | null
          provincia: string | null
          codigo_postal: string | null
        } | null = null

        if (Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0)) {
          // Coordenadas escritas a mano: mandan ellas, tal cual.
          resuelta = {
            direccion_formateada: texto,
            lat,
            lng,
            google_place_id: null,
            localidad: String(fila.localidad ?? '').trim() || null,
            provincia: null,
            codigo_postal: String(fila.codigo_postal ?? '').trim() || null,
          }
        } else if (texto.length >= 5) {
          // Sólo hay dirección escrita: la resolvemos contra Google.
          if (!claveGoogle) {
            problemas.push({ codigo, motivo: 'Falta la clave de Google en el servidor' })
            continue
          }
          const g = await geocodificar(texto, claveGoogle)
          if (!g) {
            problemas.push({ codigo, motivo: 'Google no encontró esa dirección' })
            continue
          }
          resuelta = {
            direccion_formateada: g.direccion_formateada,
            lat: g.lat,
            lng: g.lng,
            google_place_id: g.google_place_id,
            localidad: g.localidad,
            provincia: g.provincia,
            codigo_postal: g.codigo_postal ?? (String(fila.codigo_postal ?? '').trim() || null),
          }
        } else {
          problemas.push({ codigo, motivo: 'Sin dirección ni coordenadas' })
          continue
        }

        // La misma función que usa el vendedor desde el teléfono: una sola
        // manera de escribir una ubicación, un solo lugar donde arreglarla.
        const { error } = await admin.rpc('ubicar_cliente', {
          p_cliente_id: cliente.id,
          p_direccion_formateada: resuelta.direccion_formateada,
          p_lat: resuelta.lat,
          p_lng: resuelta.lng,
          p_codigo_postal: resuelta.codigo_postal,
          p_google_place_id: resuelta.google_place_id,
          p_localidad: resuelta.localidad,
          p_provincia: resuelta.provincia,
        })

        if (error) {
          problemas.push({ codigo, motivo: error.message })
          continue
        }

        aplicados.push(codigo)
      }

      return responder({ aplicados: aplicados.length, codigos: aplicados, problemas })
    }

    throw new RespuestaError('Operación desconocida. Usá "leer" o "guardar".', 400)
  } catch (e) {
    return manejarError(e)
  }
})
