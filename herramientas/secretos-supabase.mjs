/**
 * Carga en las Edge Functions los secretos que necesitan, y sólo ésos.
 *
 *   npm run secretos
 *
 * ─── Por qué no es `supabase secrets set --env-file .env` ───────────────────
 *
 * Porque ese comando falla entero, y falla en silencio para el que lo corre:
 * el `.env` tiene `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_PROJECT_ID` y
 * `SUPABASE_SERVICE_ROLE_KEY`, y Supabase **rechaza cualquier secreto que
 * empiece con `SUPABASE_`** porque ese prefijo se lo reserva para las que
 * inyecta sola en cada función. Una sola variable prohibida en el archivo
 * aborta la carga completa, así que no se sube ninguna — ni las que sí eran
 * válidas.
 *
 * Eso fue exactamente lo que pasó acá: `GOOGLE_MAPS_SERVER_KEY` nunca llegó al
 * servidor, `geocodificar` devolvió 500 en cada llamada durante días, y el
 * autocompletado de direcciones no funcionó nunca.
 *
 * ─── Qué hace en su lugar ───────────────────────────────────────────────────
 *
 * Lee el `.env` de siempre —una sola fuente de verdad— y manda nada más que
 * las variables que las funciones realmente leen con `Deno.env.get`. Las pasa
 * por un archivo temporal en vez de por la línea de comandos, así las claves no
 * quedan en el historial de la terminal, y lo borra al terminar.
 */

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Las que las funciones piden con `Deno.env.get`, menos las `SUPABASE_*`.
 *
 * Si mañana una función nueva necesita otra, va acá. El chequeo de abajo avisa
 * si alguna quedó sin valor en el `.env`.
 */
const DEL_SERVIDOR = [
  'GOOGLE_MAPS_SERVER_KEY',
  'GEMINI_API_KEY',
  'GEMINI_MODELO',
  'PLANILLA_SECRETO',
]

// ── Leer el .env ────────────────────────────────────────────────────────────

const rutaEnv = path.join(RAIZ, '.env')
if (!fs.existsSync(rutaEnv)) {
  console.error('\n  No encontré el .env en la raíz del proyecto.\n')
  process.exit(1)
}

const env = {}
for (const linea of fs.readFileSync(rutaEnv, 'utf8').split(/\r?\n/)) {
  const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}

const proyecto = env.SUPABASE_PROJECT_ID
if (!proyecto) {
  console.error('\n  Falta SUPABASE_PROJECT_ID en el .env.\n')
  process.exit(1)
}

const presentes = DEL_SERVIDOR.filter((v) => env[v])
const faltantes = DEL_SERVIDOR.filter((v) => !env[v])

if (presentes.length === 0) {
  console.error('\n  Ninguna de las variables del servidor tiene valor en el .env:')
  console.error('  ' + DEL_SERVIDOR.join(', ') + '\n')
  process.exit(1)
}

console.log('\n  Se van a cargar en las Edge Functions:')
for (const v of presentes) console.log(`    ${v.padEnd(24)} …${env[v].slice(-6)}`)
if (faltantes.length > 0) {
  console.log('\n  Sin valor en el .env, se saltean:')
  for (const v of faltantes) console.log(`    ${v}`)
}
console.log('')

// ── Cargar ──────────────────────────────────────────────────────────────────

// Archivo temporal fuera del repo: las claves no pasan por la línea de comandos
// (y por lo tanto no quedan en el historial de la terminal).
const temporal = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wt-secretos-')), '.env')
fs.writeFileSync(temporal, presentes.map((v) => `${v}=${env[v]}`).join('\n') + '\n', {
  mode: 0o600,
})

try {
  // `shell: true` no es un adorno: en Windows, `npx` es `npx.cmd`, y desde el
  // parche de CVE-2024-27980 Node se niega a ejecutar un `.cmd` sin shell —
  // falla con EINVAL antes de correr nada. Con el nombre pelado da ENOENT.
  //
  // Va como una sola cadena y no como arreglo de argumentos: con `shell: true`,
  // pasar el arreglo hace que Node avise (DEP0190) de que no escapa nada, sólo
  // concatena. Acá se escapa a mano lo único que puede traer espacios.
  const r = spawnSync(
    `npx supabase secrets set --env-file "${temporal}" --project-ref ${proyecto}`,
    { stdio: 'inherit', shell: true },
  )

  if (r.error || r.status !== 0) {
    console.error(
      [
        '',
        '  No se pudieron cargar los secretos.',
        // Sin esto, un fallo al lanzar el proceso se veía igual que un rechazo
        // del servidor, y no había forma de distinguirlos desde la terminal.
        ...(r.error ? [`  No pude ejecutar npx: ${r.error.code ?? r.error.message}`] : []),
        '',
        '  Si dice que falta el token de acceso, entrá primero con:',
        '    npx supabase login',
        '',
      ].join('\n'),
    )
    process.exit(r.status ?? 1)
  }

  console.log('\n  Listo. Las funciones ya ven esas variables en la próxima invocación.\n')
} finally {
  fs.rmSync(path.dirname(temporal), { recursive: true, force: true })
}
