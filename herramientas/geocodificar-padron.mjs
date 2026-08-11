/**
 * Pone en el mapa a los clientes del padrón que sólo tienen domicilio escrito.
 *
 *   node herramientas/geocodificar-padron.mjs                 (ensayo de 50)
 *   node herramientas/geocodificar-padron.mjs --limite 200    (ensayo más grande)
 *   node herramientas/geocodificar-padron.mjs --aplicar       (escribe de verdad)
 *
 * Medido sobre una muestra de 40 repartida por todo el padrón: 58% resuelve
 * con calle y altura, 40% sólo hasta la localidad y 2% no resuelve.
 *
 * ─── Por qué hace falta ─────────────────────────────────────────────────────
 *
 * Los 12.181 clientes que vinieron del Gestión traen calle, localidad y CP en
 * texto, sin coordenadas. El recorrido del vendedor se arma sobre `direcciones`,
 * y esa tabla exige lat/lng porque es la que alimenta el mapa y el optimizador
 * de ruta. Mientras un cliente no tenga fila ahí, no puede ser un destino.
 *
 * La app ya permite resolverlo de a uno desde la calle (el vendedor confirma la
 * dirección contra Google cuando lo agrega). Esto es lo mismo pero en lote, para
 * que la oficina no dependa de que cada vendedor vaya tropezando con los suyos.
 *
 * ─── Cuidado: esto le cuesta plata a la empresa ─────────────────────────────
 *
 * Cada cliente es una llamada a la Geocoding API de Google. Google da un tramo
 * mensual gratuito y cobra lo que pase de ahí; el precio y el tramo cambian, así
 * que ANTES de correrlo con `--aplicar` mirá el costo en la consola de Google
 * Cloud. Por eso el ensayo es lo que pasa por omisión y `--limite` existe.
 *
 * Se puede cortar y retomar cuando sea: cada corrida busca solamente los que
 * todavía no tienen dirección, así que volver a ejecutarlo no repite trabajo ni
 * vuelve a pagar por lo ya hecho.
 *
 * ─── Qué NO hace ────────────────────────────────────────────────────────────
 *
 * No pisa direcciones existentes. Si un cliente ya tiene una fila en
 * `direcciones` —la cargó un vendedor, o la corrigió la oficina— lo saltea.
 *
 * Las direcciones que Google resuelve sólo por aproximación (te ubica la ciudad
 * pero no la calle) se guardan con `verificada = false`, para que el panel las
 * pueda mostrar aparte y alguien las revise. Un pin en el centro de la ciudad es
 * peor que ningún pin si nadie sabe que es aproximado.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const AQUI = path.dirname(fileURLToPath(import.meta.url))
const RAIZ = path.resolve(AQUI, '..')

// ── Configuración ───────────────────────────────────────────────────────────

const env = {}
for (const linea of fs.readFileSync(path.join(RAIZ, '.env'), 'utf8').split(/\r?\n/)) {
  const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}

const URL_BASE = env.SUPABASE_URL
const LLAVE = process.env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY
const CLAVE_GOOGLE = process.env.GOOGLE_MAPS_SERVER_KEY || env.GOOGLE_MAPS_SERVER_KEY

if (!URL_BASE || !LLAVE) {
  console.error(
    [
      '',
      '  Falta SUPABASE_SERVICE_ROLE_KEY en el .env (o está vacía).',
      '',
      '  Esta herramienta escribe en `direcciones` para todos los clientes, así que',
      '  necesita la clave de servicio. Sacala de:',
      '    Supabase → Project Settings → API Keys → service_role',
      '',
      '  Es la clave que saltea RLS: va en el .env de la PC de la oficina y no se',
      '  comparte ni se sube a ningún lado.',
      '',
    ].join('\n'),
  )
  process.exit(1)
}
if (!CLAVE_GOOGLE) {
  console.error('\n  Falta GOOGLE_MAPS_SERVER_KEY en el .env\n')
  process.exit(1)
}

const APLICAR = process.argv.includes('--aplicar')
const GUARDAR_DUDOSAS = process.argv.includes('--incluir-aproximadas')

/**
 * El ensayo también le cuesta plata a la empresa.
 *
 * `--aplicar` decide si se ESCRIBE en la base, no si se LLAMA a Google: la
 * consulta se hace igual en los dos modos. Un ensayo sin tope son 12.000
 * llamadas facturables, o sea casi el costo del trabajo completo, para no
 * guardar nada. Por eso el ensayo viene acotado por omisión y hay que pedir el
 * total a propósito.
 */
const iLimite = process.argv.indexOf('--limite')
const LIMITE =
  iLimite > -1 ? Number(process.argv[iLimite + 1]) : APLICAR ? Infinity : 50

const cabeceras = {
  apikey: LLAVE,
  Authorization: `Bearer ${LLAVE}`,
  'Content-Type': 'application/json',
}

// ── Los que faltan ──────────────────────────────────────────────────────────

/**
 * Clientes activos, con domicilio escrito y sin fila en `direcciones`.
 *
 * El `direcciones!left(id)` con el filtro `direcciones.id=is.null` es el
 * anti-join de PostgREST: trae sólo los que no tienen ninguna.
 *
 * Va paginado porque PostgREST corta en 1.000 filas y no avisa: devuelve un
 * 206 y sigue de largo. Sin esto la herramienta veía 1.000 de 12.051 y daba la
 * impresión de haber terminado el padrón entero.
 */
const PAGINA = 1000

async function pendientes() {
  const url =
    `${URL_BASE}/rest/v1/clientes` +
    `?select=id,codigo,razon_social,direccion,localidad,codigo_postal,direcciones!left(id)` +
    `&activo=is.true&direccion=not.is.null&direcciones=is.null&order=codigo`

  const todos = []
  for (let desde = 0; ; desde += PAGINA) {
    const r = await fetch(url, {
      headers: { ...cabeceras, Range: `${desde}-${desde + PAGINA - 1}` },
    })
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`)

    const tanda = await r.json()
    todos.push(...tanda)
    if (tanda.length < PAGINA) return todos
  }
}

// ── Google ──────────────────────────────────────────────────────────────────

/**
 * La calidad de la respuesta importa tanto como la respuesta.
 *
 *  · ROOFTOP / RANGE_INTERPOLATED → la calle y la altura. Sirve para navegar.
 *  · GEOMETRIC_CENTER             → la cuadra o la calle. Aceptable.
 *  · APPROXIMATE                  → la localidad. Un pin en el centro del pueblo.
 *
 * Los dos primeros se marcan verificados; el resto queda para revisar.
 */
const CONFIABLES = new Set(['ROOFTOP', 'RANGE_INTERPOLATED'])

async function geocodificar(texto) {
  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json')
  url.searchParams.set('address', texto)
  url.searchParams.set('language', 'es-419')
  // Sesgo, no filtro: en el padrón hay clientes de Uruguay, Chile y Paraguay.
  url.searchParams.set('region', 'ar')
  url.searchParams.set('key', CLAVE_GOOGLE)

  const r = await fetch(url)
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const d = await r.json()

  if (d.status === 'ZERO_RESULTS') return null
  if (d.status !== 'OK') throw new Error(`${d.status} ${d.error_message ?? ''}`)

  const res = d.results[0]
  const comp = (tipo) => res.address_components?.find((c) => c.types.includes(tipo))?.long_name ?? null

  return {
    direccion_formateada: res.formatted_address,
    lat: res.geometry.location.lat,
    lng: res.geometry.location.lng,
    google_place_id: res.place_id,
    localidad: comp('locality') ?? comp('administrative_area_level_2'),
    provincia: comp('administrative_area_level_1'),
    codigo_postal: comp('postal_code'),
    precision: res.geometry.location_type,
    aproximada: !CONFIABLES.has(res.geometry.location_type) || res.partial_match === true,
  }
}

async function guardar(cliente, d) {
  const r = await fetch(`${URL_BASE}/rest/v1/direcciones`, {
    method: 'POST',
    headers: { ...cabeceras, Prefer: 'return=minimal' },
    body: JSON.stringify({
      cliente_id: cliente.id,
      etiqueta: 'Principal',
      principal: true,
      direccion_formateada: d.direccion_formateada,
      lat: d.lat,
      lng: d.lng,
      google_place_id: d.google_place_id,
      localidad: d.localidad,
      provincia: d.provincia,
      codigo_postal: d.codigo_postal ?? cliente.codigo_postal,
      verificada: !d.aproximada,
      observaciones: d.aproximada ? `Geocodificada en lote (${d.precision}) — revisar` : null,
    }),
  })
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`)
}

// ── Corrida ─────────────────────────────────────────────────────────────────

const faltan = await pendientes()
const aProcesar = faltan.slice(0, LIMITE)

console.log(`\n  Clientes sin ubicar: ${faltan.length}`)
console.log(`  Se van a procesar  : ${aProcesar.length}`)
console.log(`  Modo               : ${APLICAR ? 'APLICAR (escribe en la base)' : 'ENSAYO (no escribe)'}\n`)

if (APLICAR && aProcesar.length > 500) {
  console.log(`  ⚠  Son ${aProcesar.length} llamadas a Google, y Google las cobra.`)
  console.log('     Cortá con Ctrl+C ahora si no era la idea. Arranco en 10 segundos.\n')
  await new Promise((r) => setTimeout(r, 10_000))
}

const cuenta = { ok: 0, aproximadas: 0, sinResultado: 0, error: 0 }

for (const [i, c] of aProcesar.entries()) {
  const texto = [c.direccion, c.localidad, c.codigo_postal].filter(Boolean).join(', ')

  try {
    const d = await geocodificar(texto)

    if (!d) {
      cuenta.sinResultado++
      console.log(`  ${c.codigo.padEnd(8)} sin resultado   ${texto.slice(0, 52)}`)
    } else {
      // Las dudosas NO se guardan salvo que se pidan expresamente, y la razón
      // no es prolijidad: en cuanto un cliente tiene una dirección, la app deja
      // de ofrecer ubicarlo desde el teléfono —`ubicar_cliente` devuelve la que
      // hay en vez de crear otra—. Guardar un pin en el centro del pueblo le
      // saca al vendedor la posibilidad de corregir justamente el caso que
      // salió mal, y él es el único que sabe dónde queda el cliente en serio.
      const guardarla = APLICAR && (!d.aproximada || GUARDAR_DUDOSAS)

      if (d.aproximada) cuenta.aproximadas++
      else cuenta.ok++
      if (guardarla) await guardar(c, d)

      const marca = d.aproximada ? (GUARDAR_DUDOSAS ? '~' : '·') : '✓'
      console.log(
        `  ${c.codigo.padEnd(8)} ${marca} ${d.precision.padEnd(20)} ${d.direccion_formateada.slice(0, 46)}`,
      )
    }
  } catch (e) {
    cuenta.error++
    console.log(`  ${c.codigo.padEnd(8)} ERROR           ${e.message.slice(0, 60)}`)
    // Tres errores seguidos suele ser la clave o la cuota, no la dirección.
    if (cuenta.error > 3 && cuenta.ok === 0) {
      console.log('\n  Demasiados errores sin un solo acierto. Corto acá.\n')
      break
    }
  }

  // Google tolera bastante más, pero no hay apuro y así no se topa la cuota.
  if (i % 10 === 9) await new Promise((r) => setTimeout(r, 200))
}

const destinoDudosas = GUARDAR_DUDOSAS
  ? 'se guardan como no verificadas, para revisar'
  : 'NO se guardan: las resuelve el vendedor desde el teléfono'

console.log(`
  ─────────────────────────────────────────
  exactas       ${cuenta.ok}   ${APLICAR ? 'guardadas' : ''}
  aproximadas   ${cuenta.aproximadas}   (${destinoDudosas})
  sin resultado ${cuenta.sinResultado}
  errores       ${cuenta.error}
  ─────────────────────────────────────────
${
  APLICAR
    ? ''
    : `\n  Fue un ENSAYO: no se escribió nada, pero las ${aProcesar.length} consultas a Google` +
      '\n  se hicieron igual y se facturan. Repetí con --aplicar para guardar.\n'
}`)
