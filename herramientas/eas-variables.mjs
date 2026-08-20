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

/**
 * Los comandos de `eas` se corren desde acá, no desde la raíz.
 *
 * El proyecto de Expo es `apps/movil`: ahí está el `app.config.ts`. Corrido
 * desde la raíz, `eas` no encuentra ninguna configuración y se pone a crear un
 * `app.json` vacío para tener algo — un archivo que después confunde a las
 * herramientas y no es de nadie.
 */
const PROYECTO_EXPO = path.join(RAIZ, 'apps', 'movil')

/**
 * El CLI se invoca como script de Node, no por el shell.
 *
 * En Windows, `spawn('npx', [...], { shell: true })` no escapa los argumentos:
 * los concatena. Una clave con un `&` o un `^` adentro rompería el comando —o
 * ejecutaría lo que venga después— y acá los argumentos son justamente claves.
 * Llamando al entrypoint con `node`, los argumentos viajan como argumentos.
 */
const EAS = path.join(RAIZ, 'node_modules', 'eas-cli', 'bin', 'run')

function correrEas(argumentos) {
  return spawnSync(process.execPath, [EAS, ...argumentos], {
    cwd: PROYECTO_EXPO,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  })
}

/**
 * Sin éstas el APK se instala y no sirve.
 *
 * Las dos de Supabase porque sin ellas no hay login. `EAS_UPDATE_URL` porque
 * sin ella el APK sale **sordo**: no se enlaza `expo-updates` y ese teléfono no
 * puede recibir nunca nada por aire, aunque por fuera se vea igual que uno
 * sano.
 *
 * Estaba abajo, entre las opcionales, y ahí está el eslabón que faltaba: las
 * opcionales se filtran por `env[v]`, así que una línea vacía en el `.env`
 * —que es lo que había— la descartaba en silencio y este comando terminaba
 * bien dejando el proyecto de EAS sin ella. Después el build salía bien
 * también, porque `app.config.ts` tampoco la exigía. Nadie se enteró durante
 * seis versiones. Ahora corta acá y corta allá.
 */
const OBLIGATORIAS = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'EAS_UPDATE_URL']

/**
 * Sin ésta el mapa se ve gris, pero el resto de la app anda. Se avisa y se
 * sigue: quedarse sin poder compilar por el mapa, cuando lo que se quiere
 * probar son las notas de pedido, es un precio que no vale la pena.
 */
const RECOMENDADAS = ['GOOGLE_MAPS_ANDROID_KEY']

const OPCIONALES = ['DOMINIO_USUARIO', 'EAS_PROJECT_ID']

/** Los que usan los tres perfiles de eas.json: desarrollo, interno, produccion. */
const ENTORNOS = ['production', 'preview', 'development']

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

/**
 * Que la sesión se revise ANTES de intentar subir nada.
 *
 * Sin esto, cada variable abre su propio pedido de usuario y contraseña en
 * medio de la corrida. Un pedido de contraseña que aparece cuando uno no lo
 * estaba esperando es un problema de verdad: lo que se tipee ahí —el comando
 * siguiente, por ejemplo— entra igual, y el error que devuelve es "usuario o
 * contraseña incorrectos", que manda a buscar el problema al lugar equivocado.
 */
const sesion = correrEas(['whoami'])

if (sesion.status !== 0) {
  console.error(
    [
      '',
      '  No hay sesión de Expo abierta.',
      '',
      '  Entrá primero, en su propio comando y esperando cada pregunta:',
      '    npm run eas:entrar',
      '',
      '  Y volvé a correr éste.',
      '',
    ].join('\n'),
  )
  process.exit(1)
}

console.log(`\n  Cuenta de Expo: ${String(sesion.stdout).trim().split('\n').pop()}`)

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
    // A los TRES entornos, y no sólo a producción.
    //
    // Cada perfil de eas.json compila contra el suyo: `produccion` usa
    // production, `interno` usa preview y `desarrollo` usa development. Con las
    // variables en uno solo, los otros dos compilan sin credenciales —el build
    // sale igual, y el APK se instala igual, y recién ahí se descubre que no
    // puede iniciar sesión—. Son las mismas credenciales en los tres casos
    // porque hay un solo Supabase.
    ...ENTORNOS.flatMap((e) => ['--environment', e]),
    '--visibility',
    'plaintext',
    '--non-interactive',
  ]

  // `env:set` crea o actualiza, según haga falta. Sus antecesores
  // —`env:create` y `env:update`— quedaron deprecados en eas-cli 21.
  const r = correrEas(['env:set', ...comunes])

  if (r.status === 0) {
    console.log(`  ok    ${nombre}`)
  } else {
    fallidas.push(nombre)
    console.log(`  FALLÓ ${nombre}`)
    // La salida de eas puede traer el valor adentro (lo recibe como argumento),
    // así que se tacha antes de mostrarla. Un error que obliga a copiar y pegar
    // en un chat no puede llevarse la clave puesta.
    // Primero lo que `eas` manda a stdout —ahí van las explicaciones— y después
    // el error. Al revés, la explicación queda arriba y se pierde de vista.
    const salida = String(r.stdout || '') + String(r.stderr || '')
    // `eas` abre con un consejo sobre la versión del CLI que no tiene nada que
    // ver con el error. Si se lo deja pasar, tapa las tres líneas que importan.
    // Sólo el aviso de la versión del CLI, que son tres líneas fijas. El
    // "Learn more:" va anclado al principio de la línea a propósito: los
    // mensajes de error de `eas` lo llevan adentro, al final, y un patrón
    // suelto se comía justo la línea que explicaba el problema.
    const RUIDO = /^Found eas-cli in your|^It's recommended to use the "cli\.version"|^Learn more:/
    const lineas = salida
      .replaceAll(env[nombre], '«el valor»')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !RUIDO.test(l))

    // Sin recortar: el motivo real suele venir en una línea larga y explicativa,
    // y cortarla deja al que mira sólo con "el comando falló".
    for (const linea of lineas) console.log(`        ${linea}`)
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
