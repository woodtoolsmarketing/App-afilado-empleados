/**
 * Publica una actualización por aire al canal que se le diga.
 *
 *   npm run publicar:ota              → interno
 *   npm run publicar:ota:beta         → beta
 *   npm run publicar:ota:produccion   → produccion
 *
 * ─── Por qué existe este envoltorio ──────────────────────────────────────────
 *
 * El comando de antes era `eas update --branch produccion`, clavado. Y la
 * variante por defecto de este proyecto es `interno`: quien compilaba con
 * `npm run instalador:apk` y publicaba con `npm run publicar:ota` mandaba la
 * actualización a una rama que ese APK no escucha. No fallaba, no avisaba —
 * publicaba bien, a nadie. Es el mismo defecto que el panel ya tenía y arregló;
 * este script quedó atrás.
 *
 * ─── Por qué acá se fija APP_VARIANTE y no alcanza con --branch ──────────────
 *
 * Porque son dos cosas distintas y las dos tienen que coincidir. `--branch`
 * decide a QUIÉN le llega el bundle; `APP_VARIANTE` decide QUÉ dice el bundle
 * de sí mismo, porque `app.config.ts` la mete en `extra.variante` y eso viaja
 * adentro del manifiesto.
 *
 * Si no coinciden, el teléfono se queda con la variante equivocada escrita
 * encima: `canalDeEsteTelefono()` —en `apps/movil/src/servicios/actualizacionApk.ts`—
 * lee justamente `extra.variante` para preguntar por el instalador nuevo. Un
 * teléfono de producción que recibe un bundle publicado con APP_VARIANTE en
 * `interno` pasa a buscar los APK del canal interno. Se arregla solo la próxima
 * vez que se publique bien, pero mientras tanto el botón "Buscar
 * actualizaciones" contesta sobre el canal que no es.
 *
 * ─── El otro requisito, el que no se ve ──────────────────────────────────────
 *
 * `runtimeVersion` sigue a `version` de `app.config.ts`. Un APK 1.0.4 NO recibe
 * lo publicado mientras esa versión decía 1.0.3. Así que si se subió el número
 * y todavía no se compiló, esto publica a un runtime que no tiene ningún
 * teléfono. No se puede chequear desde acá —habría que preguntarle a EAS qué
 * builds hay— así que se avisa antes de arrancar.
 */

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PROYECTO_EXPO = path.join(RAIZ, 'apps', 'movil')
const EAS = path.join(RAIZ, 'node_modules', 'eas-cli', 'bin', 'run')

/**
 * Los tres canales, que son los mismos de `eas.json` y de `versiones_app`.
 *
 * No es una lista decorativa: una actualización sólo llega a los teléfonos cuyo
 * APK se compiló para ese canal.
 */
const CANALES = ['interno', 'beta', 'produccion']

function cortar(titulo, ...lineas) {
  console.error(['', `  ${titulo}`, '', ...lineas.map((l) => `  ${l}`), ''].join('\n'))
  process.exit(1)
}

// ── El canal, que se pide y no se adivina ────────────────────────────────────

const canal = process.argv[2]

if (!canal || !CANALES.includes(canal)) {
  cortar(
    canal ? `"${canal}" no es un canal.` : 'Falta decir a qué canal se publica.',
    'Un default silencioso acá es peor que pedir el dato: publicar al canal',
    'equivocado sale bien, no avisa, y no le llega a ningún teléfono.',
    '',
    'Usá el comando que corresponde al APK que tienen los vendedores:',
    '',
    '    npm run publicar:ota              (interno)',
    '    npm run publicar:ota:beta',
    '    npm run publicar:ota:produccion',
  )
}

// ── Lo que se puede chequear antes de molestar a EAS ─────────────────────────

if (!fs.existsSync(EAS)) {
  cortar('Falta eas-cli.', 'Corré `npm install` y volvé a intentar.')
}

const env = {}
const archivoEnv = path.join(RAIZ, '.env')
if (fs.existsSync(archivoEnv)) {
  for (const linea of fs.readFileSync(archivoEnv, 'utf8').split(/\r?\n/)) {
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
}

if (!env.EAS_UPDATE_URL) {
  cortar(
    'Falta EAS_UPDATE_URL en el .env.',
    'Sin ella la app se compila sin la capacidad de recibir actualizaciones por',
    'aire, así que publicar no le llega a ningún teléfono. Estuvo así seis',
    'versiones seguidas: la línea existía pero vacía, que es lo mismo que nada.',
  )
}

const sesion = spawnSync(process.execPath, [EAS, 'whoami'], {
  cwd: PROYECTO_EXPO,
  stdio: ['ignore', 'pipe', 'pipe'],
  encoding: 'utf8',
})

if (sesion.status !== 0) {
  cortar(
    'No hay sesión de Expo abierta.',
    'Entrá primero, en su propio comando:',
    '  npm run eas:entrar',
  )
}

// ── Lo único que no se puede chequear desde acá ──────────────────────────────

const version =
  fs
    .readFileSync(path.join(PROYECTO_EXPO, 'app.config.ts'), 'utf8')
    .match(/^\s*version:\s*'([^']+)'/m)?.[1] ?? '?'

console.log(
  [
    '',
    `  Publicando al canal "${canal}".`,
    `  Cuenta: ${String(sesion.stdout).trim().split('\n').pop()}`,
    '',
    '  ────────────────────────────────────────────────────────────────',
    `  Esto le va a llegar SÓLO a los teléfonos con el APK "${canal}"`,
    `  compilado desde la versión ${version}.`,
    '',
    '  Si acabás de subir ese número y todavía no compilaste el APK, lo',
    '  que se publique ahora no lo va a recibir nadie: el runtime sigue a',
    '  la versión. En ese caso, compilá primero.',
    '  ────────────────────────────────────────────────────────────────',
    '',
  ].join('\n'),
)

const update = spawnSync(
  process.execPath,
  [EAS, 'update', '--branch', canal, '--message', `Actualización desde la terminal (${canal})`],
  {
    cwd: PROYECTO_EXPO,
    stdio: 'inherit',
    // La variante tiene que acompañar al canal: es lo que queda escrito en
    // `extra.variante` adentro del bundle, y de ahí sale a qué canal le
    // pregunta el teléfono por el instalador nuevo.
    env: { ...process.env, APP_VARIANTE: canal },
  },
)

process.exit(update.status ?? 1)
