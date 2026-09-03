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
 *
 * ── Altas desde la planilla ─────────────────────────────────────────────────
 *
 * Una fila con un código que todavía no está en el padrón da de ALTA al
 * cliente. Antes devolvía "No existe un cliente con ese código", y como la
 * planilla se reescribe entera en cada sincronización, la fila tipeada se
 * perdía: la oficina cargaba un cliente nuevo, no aparecía en la app, y no
 * quedaba rastro de por qué.
 *
 * El padrón del Gestión entra por `herramientas/importar-clientes.mjs`, y entre
 * exportación y exportación pasan meses. Esto es lo que tapa ese hueco: el
 * cliente que se abrió ayer se carga acá y el vendedor lo tiene hoy. Cuando el
 * listado del Gestión lo traiga, el importador lo va a encontrar por el código
 * y le va a completar lo que la planilla no tiene (CUIT, contacto, teléfono).
 * Por eso el código que se tipea acá tiene que ser EL DEL GESTIÓN: es lo que
 * después une las dos cargas en una sola ficha.
 *
 * El alta no queda `provisorio`. Eso está para el cliente que levanta el
 * vendedor desde la calle y la oficina todavía no validó; acá el que carga es
 * la oficina, que es justamente quien valida.
 *
 * ── Qué puede hacer el que tenga el secreto ─────────────────────────────────
 *
 * Vale decirlo en voz alta, porque esto agranda lo que la función permite:
 * hasta ahora, con el secreto se podían mover de lugar clientes existentes;
 * ahora además se pueden crear. Sigue sin poder borrar, ni dar de baja, ni leer
 * nada que la planilla no muestre. El tope de 500 filas por llamada sigue
 * valiendo para las dos operaciones.
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
      if (filas.length === 0) {
        return responder({ aplicados: 0, codigos: [], altas: 0, codigos_alta: [], problemas: [] })
      }
      if (filas.length > 500) throw new RespuestaError('Mandá hasta 500 filas por vez', 400)

      const claveGoogle = Deno.env.get('GOOGLE_MAPS_SERVER_KEY')
      const aplicados: string[] = []
      const altas: string[] = []
      const problemas: Array<{ codigo: string; motivo: string }> = []

      for (const fila of filas) {
        // Lo que mandó la planilla se conserva TAL CUAL para contestarle: es la
        // clave con la que Apps Script decide qué fila quedó resuelta. Si le
        // devolvemos otra cosa, esa fila queda rebotando abajo de todo para
        // siempre aunque el cliente se haya cargado bien.
        const codigoRecibido = String(fila.codigo ?? '').trim()
        if (!codigoRecibido) continue

        // Contra la base va el código normalizado como lo hace el importador
        // del Gestión (herramientas/importar-clientes.sql): "00000001003" es
        // "1003". Sin esto, el que copia el código del export crea una segunda
        // ficha que el `on conflict (codigo)` del importador no fusiona nunca.
        const codigo = codigoRecibido.replace(/^0+(?=\d)/, '')

        const lat = Number(fila.lat)
        const lng = Number(fila.lng)
        const texto = String(fila.direccion ?? '').trim()
        const localidad = String(fila.localidad ?? '').trim()
        const codigoPostal = String(fila.codigo_postal ?? '').trim()

        // La planilla manda la razón social sólo en las filas nuevas; las de
        // edición de ubicación no la llevan. Es lo que distingue "esto es un
        // alta" de "esto es una corrección", incluso cuando el cliente ya
        // existe porque otra sincronización se adelantó.
        const razonSocial = String(fila.razon_social ?? '').trim()
        const esFilaDeAlta = razonSocial !== ''

        let { data: cliente } = await admin
          .from('clientes')
          .select('id, activo')
          .eq('codigo', codigo)
          .maybeSingle()

        let recienCreado = false

        if (!cliente) {
          if (!razonSocial) {
            problemas.push({
              codigo: codigoRecibido,
              motivo: 'Es un código nuevo y le falta la razón social para darlo de alta',
            })
            continue
          }
          if (razonSocial.length > 200) {
            problemas.push({ codigo: codigoRecibido, motivo: 'La razón social es demasiado larga' })
            continue
          }
          // Los 12.181 códigos del padrón son números de hasta cinco cifras.
          // Cualquier otra cosa es un error de tipeo o una columna corrida, y
          // conviene frenarla acá: un código inventado no lo va a encontrar el
          // importador, y uno con forma de provisorio ("P-000004") le pisa el
          // lugar a la secuencia del alta desde la calle.
          if (!/^\d{1,6}$/.test(codigo)) {
            problemas.push({
              codigo: codigoRecibido,
              motivo: 'El código tiene que ser el número del cliente en el Gestión, sin letras',
            })
            continue
          }

          const { data: creado, error: errAlta } = await admin
            .from('clientes')
            .insert({
              codigo,
              razon_social: razonSocial,
              // Los mismos campos que carga el importador del Gestión: el
              // domicilio del listado va en `clientes`, no en `direcciones`,
              // porque esa tabla exige coordenadas.
              direccion: texto || null,
              localidad: localidad || null,
              codigo_postal: codigoPostal || null,
            })
            .select('id, activo')
            .single()

          if (errAlta) {
            // 23505 es la clave única del código: entre que preguntamos y
            // escribimos, otra sincronización lo creó. No es un error para la
            // oficina — el cliente existe, que es lo que quería.
            if (errAlta.code === '23505') {
              const { data: recuperado } = await admin
                .from('clientes')
                .select('id, activo')
                .eq('codigo', codigo)
                .maybeSingle()
              if (!recuperado) {
                problemas.push({ codigo: codigoRecibido, motivo: errAlta.message })
                continue
              }
              cliente = recuperado
            } else {
              problemas.push({
                codigo: codigoRecibido,
                motivo: `No se pudo dar de alta: ${errAlta.message}`,
              })
              continue
            }
          } else {
            cliente = creado
            recienCreado = true
            altas.push(codigoRecibido)
          }
        }

        // Todos los caminos que dejan `cliente` en null hacen `continue`, pero
        // dejarlo escrito evita que un cambio futuro lo rompa en silencio.
        if (!cliente) continue

        // Un cliente dado de baja no se ve en la planilla, así que la oficina lo
        // vuelve a tipear como fila nueva. Sin esto el servidor lo encontraba
        // por código, contestaba que salió todo bien, y la bajada le borraba la
        // fila igual, porque `leer` sólo trae los activos.
        //
        // No se reactiva solo: la baja se hace a mano desde el panel, con un
        // botón que dice "Dar de baja", y deshacer eso desde una planilla es
        // demasiado. Se avisa y la fila queda pendiente, a la vista.
        if (cliente.activo === false) {
          problemas.push({
            codigo: codigoRecibido,
            motivo: 'Ese cliente está dado de baja. Reactivalo desde el panel de Clientes.',
          })
          continue
        }

        // Vale como alta tanto el que se creó recién como el que llegó en una
        // fila de alta y ya existía —porque el disparador de 15 minutos y la
        // sincronización a mano se encimaron—. Los dos casos tienen que
        // contarse como resueltos: si no, la fila rebota abajo de todo para
        // siempre con un cliente que ya está cargado.
        const dadoDeAlta = recienCreado || esFilaDeAlta

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
            localidad: localidad || null,
            provincia: null,
            codigo_postal: codigoPostal || null,
          }
        } else if (texto.length >= 5) {
          // Sólo hay dirección escrita: la resolvemos contra Google.
          if (!claveGoogle) {
            problemas.push({ codigo: codigoRecibido, motivo: 'Falta la clave de Google en el servidor' })
            continue
          }
          const g = await geocodificar(texto, claveGoogle)
          if (!g) {
            // El alta ya está hecha: el cliente existe y el vendedor lo va a
            // encontrar buscándolo. Lo único que falta es la ubicación, y eso
            // es lo que dice el mensaje. Decir "no se pudo" a secas haría que
            // la oficina lo cargue de nuevo.
            problemas.push({
              codigo: codigoRecibido,
              motivo: dadoDeAlta
                ? 'Cliente dado de alta, pero Google no encontró esa dirección: quedó sin ubicar'
                : 'Google no encontró esa dirección',
            })
            if (dadoDeAlta) aplicados.push(codigoRecibido)
            continue
          }
          resuelta = {
            direccion_formateada: g.direccion_formateada,
            lat: g.lat,
            lng: g.lng,
            google_place_id: g.google_place_id,
            localidad: g.localidad,
            provincia: g.provincia,
            codigo_postal: g.codigo_postal ?? (codigoPostal || null),
          }
        } else if (dadoDeAlta) {
          // Un cliente nuevo sin dirección es un caso normal: la oficina sabe
          // el nombre y todavía no el domicilio. Se da de alta igual y queda
          // "Sin ubicar", que es exactamente lo que le pasa a los 129 del
          // padrón que vinieron así del Gestión.
          aplicados.push(codigoRecibido)
          continue
        } else {
          problemas.push({ codigo: codigoRecibido, motivo: 'Sin dirección ni coordenadas' })
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
          problemas.push({
            codigo: codigoRecibido,
            motivo: dadoDeAlta
              ? `Cliente dado de alta, pero no se pudo ubicar: ${error.message}`
              : error.message,
          })
          // El alta salió bien aunque la ubicación no: se cuenta como aplicado
          // para que la planilla no vuelva a mandarlo como fila nueva.
          if (dadoDeAlta) aplicados.push(codigoRecibido)
          continue
        }

        aplicados.push(codigoRecibido)
      }

      return responder({
        aplicados: aplicados.length,
        codigos: aplicados,
        altas: altas.length,
        codigos_alta: altas,
        problemas,
      })
    }

    throw new RespuestaError('Operación desconocida. Usá "leer" o "guardar".', 400)
  } catch (e) {
    return manejarError(e)
  }
})
