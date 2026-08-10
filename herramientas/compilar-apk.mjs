/**
 * Compila el APK en EAS, revisando antes todo lo que puede fallar.
 *
 *   npm run instalador:apk
 *   npm run instalador:apk:produccion
 *
 * ─── Por qué existe este envoltorio ──────────────────────────────────────────
 *
 * `eas build` hace preguntas. Algunas aparecen recién a mitad de camino —la del
 * keystore, por ejemplo— y para entonces uno ya se fue a hacer otra cosa. Lo
 * que pasa después es lo que uno esperaría: se vuelve a la terminal, se escribe
 * el comando siguiente, y ese comando entra como respuesta a la pregunta
 * abierta. El error que devuelve EAS entonces habla de un keystore inexistente
 * o de un usuario que no existe, y manda a buscar el problema a otro lado.
 *
 * Así que acá se chequea de antemano todo lo que se puede chequear sin
 * preguntar —sesión, proyecto, variables— y se avisa cuál es la única pregunta
 * que va a quedar y qué hay que contestarle.
 */

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PROYECTO_EXPO = path.join(RAIZ, 'apps', 'movil')
const EAS = path.join(RAIZ, 'node_modules', 'eas-cli', 'bin', 'run')

const perfil = process.argv[2] ?? 'interno'

/**
 * Tira lo que haya quedado escrito en el teclado antes de arrancar.
 *
 * Lo que se tipea mientras ningún programa está leyendo no se pierde: la
 * terminal lo guarda y se lo entrega entero al primero que lea. Así, los
 * comandos que uno escribió mientras esperaba terminan contestando la primera
 * pregunta de `eas`.
 *
 * Y el resultado no es un error cualquiera. A "Generate a new Android
 * Keystore?" le alcanza la primera letra: la "n" de "npm" contesta que NO, y
 * lo siguiente que aparece es un pedido de archivo de firma que no existe. El
 * mensaje no tiene nada que ver con lo que pasó, así que uno lo busca donde no
 * está.
 */
async function vaciarTeclado() {
  if (!process.stdin.isTTY) return

  return new Promise((listo) => {
    let descartado = 0
    const tirar = (datos) => {
      descartado += datos.length
    }

    try {
      process.stdin.setRawMode(true)
    } catch {
      // Sin modo crudo no se puede vaciar; el aviso de más abajo alcanza.
    }
    process.stdin.resume()
    process.stdin.on('data', tirar)

    setTimeout(() => {
      process.stdin.off('data', tirar)
      process.stdin.pause()
      try {
        process.stdin.setRawMode(false)
      } catch {
        /* ya estaba */
      }
      if (descartado > 0) {
        console.log(
          `\n  (Descarté ${descartado} caracteres que habían quedado escritos en la terminal.)`,
        )
      }
      listo()
    }, 300)
  })
}

function correrEas(argumentos, { interactivo = false } = {}) {
  return spawnSync(process.execPath, [EAS, ...argumentos], {
    cwd: PROYECTO_EXPO,
    stdio: interactivo ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  })
}

function cortar(titulo, ...lineas) {
  console.error(['', `  ${titulo}`, '', ...lineas.map((l) => `  ${l}`), ''].join('\n'))
  process.exit(1)
}

// ── Antes de arrancar ────────────────────────────────────────────────────────

if (!fs.existsSync(EAS)) {
  cortar('Falta eas-cli.', 'Corré `npm install` y volvé a intentar.')
}

const sesion = correrEas(['whoami'])
if (sesion.status !== 0) {
  cortar(
    'No hay sesión de Expo abierta.',
    'Entrá primero, en su propio comando:',
    '  npm run eas:entrar',
  )
}

const env = {}
const archivoEnv = path.join(RAIZ, '.env')
if (fs.existsSync(archivoEnv)) {
  for (const linea of fs.readFileSync(archivoEnv, 'utf8').split(/\r?\n/)) {
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
}

if (!env.EAS_PROJECT_ID) {
  cortar(
    'Falta EAS_PROJECT_ID en el .env.',
    'Lo devuelve `npm run eas:iniciar` y hay que pegarlo a mano,',
    'porque esta app usa app.config.ts y no app.json.',
  )
}

if (!env.GOOGLE_MAPS_ANDROID_KEY && perfil === 'produccion') {
  cortar(
    'Falta GOOGLE_MAPS_ANDROID_KEY en el .env.',
    'En producción es obligatoria: sin ella el mapa se ve gris.',
    'Para probar, compilá el perfil interno: npm run instalador:apk',
  )
}

// ── Lo único que va a preguntar ──────────────────────────────────────────────

console.log(
  [
    '',
    `  Compilando el perfil "${perfil}" para Android.`,
    `  Cuenta: ${String(sesion.stdout).trim().split('\n').pop()}`,
    '',
    '  ────────────────────────────────────────────────────────────────',
    '  Si es la primera vez, va a preguntar UNA cosa:',
    '',
    '      Generate a new Android Keystore?   →  contestá  Y',
    '',
    '  Es la firma de la app. Dejá que la guarde Expo: si se pierde, la',
    '  única salida es desinstalar y reinstalar en cada teléfono.',
    '',
    '  Mientras haya una pregunta abierta, NO escribas otro comando: lo',
    '  que tipees entra como respuesta, aunque no lo veas en pantalla.',
    '  ────────────────────────────────────────────────────────────────',
    '',
  ].join('\n'),
)

await vaciarTeclado()

const build = correrEas(['build', '--platform', 'android', '--profile', perfil], {
  interactivo: true,
})

process.exit(build.status ?? 1)
