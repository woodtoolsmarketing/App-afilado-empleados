/**
 * Carga el padrón de clientes exportado del Gestión Comercial.
 *
 *   node herramientas/importar-clientes.mjs Listado-clientes.csv
 *
 * ─── Cómo llegan los datos a la base ────────────────────────────────────────
 *
 * Van del archivo a Postgres directo, en tandas, por una función temporal que
 * hay que crear antes y borrar después. Esa función es `security definer` y
 * está cerrada con un secreto de un solo uso: mientras existe, cualquiera con
 * la clave anónima Y el secreto puede escribir en `clientes`. Por eso se borra
 * apenas termina la carga — no queda dando vueltas.
 *
 * La función está en `herramientas/importar-clientes.sql`, al lado de este
 * archivo. Hay que pegarla en el SQL Editor de Supabase ANTES de correr esto, y
 * borrarla después. Los pasos están escritos ahí arriba.
 *
 * El secreto viaja en `SECRETO_IMPORTACION` y tiene que ser el mismo que quedó
 * escrito adentro de la función.
 *
 * ─── Se puede correr de nuevo ───────────────────────────────────────────────
 *
 * La función va por `codigo`: al que no está lo crea, y al que está le
 * actualiza lo que trae el listado. Así que para poner el padrón al día alcanza
 * con exportar el listado completo del Gestión y correr esto otra vez. No hace
 * falta recortar el archivo a los clientes nuevos.
 *
 * ─── Qué se mapea y qué no ──────────────────────────────────────────────────
 *
 *   Código            → `codigo`, sin los ceros de relleno ("00000001003" es
 *                       "1003", que es como lo dice la oficina)
 *   Razón social      → `razon_social`
 *   Nombre fantasía   → `nombre_fantasia`
 *   Domicilio, C.P.,
 *   Localidad         → `direccion`, `codigo_postal`, `localidad` DEL CLIENTE,
 *                       no de `direcciones`: el listado no trae coordenadas y
 *                       esa tabla las exige (ver la migración)
 *   Contacto          → `contacto_nombre`
 *   Teléfonos         → `telefono`
 *   Mail / notas      → `email` si tiene arroba; si no, va a `notas`
 *   Zona              → a `notas`. Viene como texto ("ZONA LA PLATA TIT"), no
 *                       como el número que usa la nota de pedido; ese número lo
 *                       resuelve la localidad, que es lo que la app ya sabe hacer
 *   Datos de entrega  → a `notas`
 *
 * El listado NO trae CUIT, así que la búsqueda por CUIT no encuentra a estos
 * clientes. No es un error del importador: el dato no está en el origen.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const AQUI = path.dirname(fileURLToPath(import.meta.url))
const RAIZ = path.resolve(AQUI, '..')

const SECRETO = process.env.SECRETO_IMPORTACION ?? ''
if (!SECRETO) {
  console.error('\n  Falta SECRETO_IMPORTACION: el mismo que lleva adentro la función temporal.\n')
  process.exit(1)
}

const ARCHIVO = process.argv[2]
if (!ARCHIVO || !fs.existsSync(ARCHIVO)) {
  console.error('\n  Uso: node herramientas/importar-clientes.mjs <listado.csv>\n')
  process.exit(1)
}

// ── Configuración ───────────────────────────────────────────────────────────

const env = {}
for (const linea of fs.readFileSync(path.join(RAIZ, '.env'), 'utf8').split(/\r?\n/)) {
  const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}

/** Sin librerías: alcanza `fetch` contra el endpoint de la función. */
async function rpc(nombre, cuerpo) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${nombre}`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(cuerpo),
  })
  if (!r.ok) return { error: { message: `${r.status} ${(await r.text()).slice(0, 200)}` } }
  return { data: await r.json() }
}

// ── Lectura del archivo ─────────────────────────────────────────────────────

/**
 * CSV separado por `;`, con comillas dobles y saltos de línea adentro de las
 * celdas. Se parsea a mano porque el campo "Datos de entrega" trae texto libre
 * con separadores adentro, y partir por `;` a secas corre las columnas.
 */
function leerCsv(texto) {
  const filas = []
  let campo = ''
  let fila = []
  let entreComillas = false

  for (let i = 0; i < texto.length; i++) {
    const c = texto[i]
    if (entreComillas) {
      if (c === '"') {
        if (texto[i + 1] === '"') { campo += '"'; i++ } else entreComillas = false
      } else campo += c
      continue
    }
    if (c === '"') entreComillas = true
    else if (c === ';') { fila.push(campo); campo = '' }
    else if (c === '\n') { fila.push(campo); filas.push(fila); fila = []; campo = '' }
    else if (c !== '\r') campo += c
  }
  if (campo || fila.length) { fila.push(campo); filas.push(fila) }
  return filas
}

const filas = leerCsv(fs.readFileSync(ARCHIVO, 'utf8').replace(/^﻿/, ''))
const cabecera = filas.shift()
const col = (nombre) => cabecera.findIndex((c) => c.trim().toLowerCase() === nombre)

const I = {
  codigo: col('código'),
  razon: col('razón social'),
  fantasia: col('nombre fantasía'),
  domicilio: col('domicilio'),
  cp: col('c.p.'),
  localidad: col('localidad'),
  zona: col('zona'),
  contacto: col('contacto'),
  telefonos: col('teléfonos'),
  mail: col('mail / notas'),
  entrega: col('datos de entrega'),
}

if (Object.values(I).some((i) => i < 0)) {
  console.error('\n  Faltan columnas. Las que encontré:', cabecera, '\n')
  process.exit(1)
}

const limpio = (v) => String(v ?? '').trim()

const registros = []
for (const f of filas) {
  if (!f || f.length < 2) continue
  const codigo = limpio(f[I.codigo]).replace(/^0+(?=\d)/, '')
  const razon = limpio(f[I.razon])
  if (!codigo || !razon) continue

  const mail = limpio(f[I.mail])
  const esEmail = mail.includes('@')

  registros.push({
    codigo,
    razon_social: razon,
    nombre_fantasia: limpio(f[I.fantasia]),
    contacto: limpio(f[I.contacto]),
    telefono: limpio(f[I.telefonos]),
    email: esEmail ? mail : '',
    notas: [
      limpio(f[I.zona]) ? `Zona (Gestión): ${limpio(f[I.zona])}` : '',
      !esEmail && mail ? mail : '',
    ].filter(Boolean).join(' · '),
    domicilio: limpio(f[I.domicilio]),
    cp: limpio(f[I.cp]),
    localidad: limpio(f[I.localidad]),
    entrega: limpio(f[I.entrega]),
  })
}

console.log(`\n  Leídos ${registros.length} clientes.`)

// ── Envío por tandas ────────────────────────────────────────────────────────

const TANDA = 400
let cargados = 0
let fallidasSeguidas = 0

for (let i = 0; i < registros.length; i += TANDA) {
  const tanda = registros.slice(i, i + TANDA)
  const { error } = await rpc('importar_clientes_temporal', { secreto: SECRETO, datos: tanda })

  if (error) {
    // El 404 es el caso típico y no se entiende leyendo el error crudo: la
    // función se borra después de cada importación, así que la primera tanda de
    // la importación siguiente siempre la encuentra faltando.
    if (error.message.startsWith('404')) {
      console.error(
        '\n  No existe `importar_clientes_temporal` en la base.\n' +
          '  Pegá herramientas/importar-clientes.sql en el SQL Editor de Supabase\n' +
          '  —con el secreto puesto adentro— y volvé a correr esto.\n',
      )
      process.exit(1)
    }

    fallidasSeguidas++
    console.log(`  FALLÓ la tanda ${Math.floor(i / TANDA) + 1}: ${error.message}`)
    if (fallidasSeguidas > 2) {
      console.log('  Tres seguidas fallando: corto acá para no seguir a ciegas.')
      break
    }
    continue
  }

  fallidasSeguidas = 0
  cargados += tanda.length
  if ((i / TANDA) % 5 === 0 || i + TANDA >= registros.length) {
    console.log(`  ${cargados} / ${registros.length}`)
  }
}

console.log(`\n  Listo: ${cargados} clientes.\n  Acordate de borrar la función temporal.\n`)
