/**
 * Sube al proyecto de EAS las variables que el APK necesita.
 *
 *   npm run eas:variables
 *
 * ─── Por qué hace falta ──────────────────────────────────────────────────────
 *
 * El `.env` está en .gitignore y NO viaja a EAS: allá se compila desde el
 * repositorio, sin él. `app.config.ts` corta el build cuando le faltan, así que
 * sin este paso la compilación falla — que es mejor que el otro final posible,
 * un APK que instala perfecto y no puede iniciar sesión.
 *
 * ─── Qué sube y qué no ───────────────────────────────────────────────────────
 *
 * Sólo las tres que viajan DENTRO del APK y son públicas por diseño: la URL del
 * proyecto, la clave anónima —que no da más permisos que los que RLS le conceda
 * al usuario que inicie sesión— y la clave de Maps de Android, que está
 * restringida al package y al SHA-1 de la app.
 *
 * NO sube `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY` ni
 * `GOOGLE_MAPS_SERVER_KEY`. Ésas viven en las Edge Functions (`npm run
 * secretos`) y no tienen nada que hacer en un teléfono.
 *
 * Los valores no se imprimen nunca: se pasan directo al comando.
 */

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Sin éstas no hay login: el APK se instala y no sirve para nada. */
const OBLIGATORIAS = ['SUPABASE_URL', 'SUPABASE_ANON_KEY']

/**
 * Sin ésta el mapa se ve gris, pero el resto de la app anda. Se avisa y se
 * sigue: quedarse sin poder compilar por el mapa, cuando lo que se quiere
 * probar son las notas de pedido, es un precio que no vale la pena.
 */
const RECOMENDADAS = ['GOOGLE_MAPS_ANDROID_KEY']

const OPCIONALES = ['DOMINIO_USUARIO', 'EAS_UPDATE_URL', 'EAS_PROJECT_ID']

/** Las que nunca pueden salir de la máquina, por más que estén en el .env. */
const PROHIBIDAS = ['SUPABASE_SERVICE_ROLE_KEY', 'GEMINI_API_KEY', 'GOOGLE_MAPS_SERVER_KEY']

function leerEnv() {
  const archivo = path.join(RAIZ, '.env')
  if (!fs.existsSync(archivo)) {
    console.error(`\n  No está el .env de la raíz: ${archivo}\n`)
    process.exit(1)
  }

  const vars = {}
  for (const linea of fs.readFileSync(archivo, 'utf8').split(/\r?\n/)) {
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
    if (m) vars[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
  return vars
}

const env = leerEnv()

const faltan = OBLIGATORIAS.filter((v) => !env[v])
if (faltan.length) {
  console.error(`\n  Faltan en el .env: ${faltan.join(', ')}\n`)
  process.exit(1)
}

/** Igual que en el probador: una clave de service role no puede ir al APK. */
function esClaveDeServicio(clave) {
  if (clave.startsWith('sb_secret_')) return true
  try {
    const payload = JSON.parse(Buffer.from(clave.split('.')[1], 'base64').toString('utf8'))
    return payload.role === 'service_role'
  } catch {
    return false
  }
}

if (esClaveDeServicio(env.SUPABASE_ANON_KEY)) {
  console.error(
    '\n  SUPABASE_ANON_KEY tiene una clave de SERVICE ROLE.\n' +
      '  Esa clave saltea RLS y no puede viajar dentro de un APK.\n',
  )
  process.exit(1)
}

for (const nombre of RECOMENDADAS) {
  if (!env[nombre]) {
    console.warn(`  ⚠  Falta ${nombre} en el .env: el mapa se va a ver gris. Lo demás anda.`)
  }
}

const aSubir = [
  ...OBLIGATORIAS,
  ...RECOMENDADAS.filter((v) => env[v]),
  ...OPCIONALES.filter((v) => env[v]),
].filter((v) => !PROHIBIDAS.includes(v))

console.log(`\n  Subiendo ${aSubir.length} variables al proyecto de EAS.\n`)

let fallidas = []

for (const nombre of aSubir) {
  const comunes = [
    '--scope',
    'project',
    '--name',
    nombre,
    '--value',
    env[nombre],
    '--environment',
    'production',
    '--visibility',
    'plaintext',
    '--non-interactive',
  ]

  // `env:set` crea o actualiza, según haga falta. Sus antecesores
  // —`env:create` y `env:update`— quedaron deprecados en eas-cli 21.
  const r = spawnSync('npx', ['eas', 'env:set', ...comunes], {
    cwd: RAIZ,
    stdio: ['inherit', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
    encoding: 'utf8',
  })

  if (r.status === 0) {
    console.log(`  ok    ${nombre}`)
  } else {
    fallidas.push(nombre)
    console.log(`  FALLÓ ${nombre}`)
    // La salida de eas puede traer el valor adentro (lo recibe como argumento),
    // así que se tacha antes de mostrarla. Un error que obliga a copiar y pegar
    // en un chat no puede llevarse la clave puesta.
    const salida = String(r.stderr || '') + String(r.stdout || '')
    // `eas` abre con un consejo sobre la versión del CLI que no tiene nada que
    // ver con el error. Si se lo deja pasar, tapa las tres líneas que importan.
    const RUIDO = /eas-cli in your project dependencies|cli\.version|Learn more:/
    const lineas = salida
      .replaceAll(env[nombre], '«el valor»')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !RUIDO.test(l))

    for (const linea of lineas.slice(-3)) console.log(`        ${linea}`)
  }
}

if (fallidas.length) {
  console.log(
    [
      '',
      `  Quedaron sin subir: ${fallidas.join(', ')}`,
      '',
      '  Si dice que no estás autenticado, corré primero:',
      '    npm run eas:entrar',
      '',
    ].join('\n'),
  )
  process.exit(1)
}

console.log('\n  Listo. Ya se puede compilar el APK:\n    npm run instalador:apk\n')
