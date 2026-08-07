/**
 * Arma el probador en UN SOLO archivo HTML.
 *
 * Todo va embebido —el cliente de Supabase, el paquete compartido, los estilos—
 * para que sea un archivo suelto que se abre con doble clic y anda. Sin
 * servidor, sin `npm install` del otro lado, sin CDN.
 *
 * La configuración sale de las variables de entorno y, si no están, del `.env`
 * de la raíz. Por eso el HTML de salida está en .gitignore: la clave anónima es
 * pública por diseño (viaja dentro del APK), pero este repo no guarda claves y
 * no vamos a empezar ahora.
 *
 *   node herramientas/probador/construir.mjs
 *   node herramientas/probador/construir.mjs --salida publico/index.html
 *
 * El `--salida` es para publicarlo en un servidor: ahí el archivo tiene que
 * llamarse `index.html` y vivir en una carpeta sola, sin el código fuente al
 * lado. Ver el README.
 */

import crypto from 'node:crypto'
import { build } from 'esbuild'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const AQUI = path.dirname(fileURLToPath(import.meta.url))
const RAIZ = path.resolve(AQUI, '../..')

// `--salida ruta` para publicarlo en un servidor; si no, al lado del script.
const indiceSalida = process.argv.indexOf('--salida')
const SALIDA =
  indiceSalida >= 0 && process.argv[indiceSalida + 1]
    ? path.resolve(RAIZ, process.argv[indiceSalida + 1])
    : path.join(AQUI, 'probador.html')

// ── Configuración ───────────────────────────────────────────────────────────

/**
 * Del entorno primero, del `.env` después.
 *
 * El entorno gana porque es lo único que hay al construir en un servidor: allá
 * no existe el `.env`, y las variables se cargan en el panel del proveedor.
 * En la máquina de la oficina no hay variables cargadas y sigue mandando el
 * archivo, así que `npm run probador` anda igual que siempre.
 */
function leerEnv() {
  const vars = {}

  const archivo = path.join(RAIZ, '.env')
  if (fs.existsSync(archivo)) {
    for (const linea of fs.readFileSync(archivo, 'utf8').split(/\r?\n/)) {
      const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
      if (m) vars[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
    }
  }

  for (const clave of [
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY',
    'DOMINIO_USUARIO',
    'PROBADOR_INSTALACION_ID',
  ]) {
    if (process.env[clave]) vars[clave] = process.env[clave].trim()
  }

  return vars
}

const env = leerEnv()
const faltan = ['SUPABASE_URL', 'SUPABASE_ANON_KEY'].filter((k) => !env[k])
if (faltan.length) {
  console.error(
    `\n  Faltan: ${faltan.join(', ')}\n` +
      '  Poneelas en el .env de la raíz o como variables de entorno.\n',
  )
  process.exit(1)
}

/**
 * Qué credenciales viajan dentro del HTML y cuáles NO.
 *
 * Van: la URL del proyecto y la clave anónima. Son públicas por diseño —viajan
 * dentro del APK— y no dan más permisos que los que RLS conceda al usuario que
 * inicie sesión.
 *
 * NO van, y no es una limitación sino cómo está construido el sistema:
 *
 *   SUPABASE_SERVICE_ROLE_KEY  saltea RLS por completo: quien tenga el archivo
 *                              podría leer y borrar toda la base.
 *   GEMINI_API_KEY             se gasta por uso; vive en las Edge Functions.
 *   GOOGLE_MAPS_SERVER_KEY     ídem.
 *   GOOGLE_MAPS_ANDROID_KEY    está restringida al paquete y al SHA-1 de la
 *                              app: en un navegador no funciona.
 *
 * La app tampoco las lleva. Cuando necesita dictar o geocodificar llama a una
 * Edge Function, y el secreto se queda del lado del servidor.
 */
/**
 * Identidad del "dispositivo" del probador.
 *
 * El teléfono guarda su GUID en el Keystore, que sobrevive a todo salvo una
 * desinstalación. El navegador, abriendo un `file://`, no tiene nada parecido:
 * el `localStorage` de un archivo local se pierde solo, y cada pérdida generaba
 * un ID nuevo, un dispositivo nuevo y otra vuelta de "no autorizado". Se
 * autorizaba una PC que dejaba de existir al rato.
 *
 * Así que el ID lo fija el build y vive en un archivo al lado del script. Se
 * genera una vez, sobrevive a las reconstrucciones, y es el mismo en cualquier
 * copia del HTML: se autoriza una vez y listo.
 *
 * En un servidor ese archivo no existe —cada build arranca de cero desde el
 * repositorio— así que ahí el ID va en `PROBADOR_INSTALACION_ID`. Sin eso, cada
 * despliegue crearía un dispositivo nuevo y habría que volver a autorizarlo.
 */
function instalacionId() {
  if (process.env.PROBADOR_INSTALACION_ID) {
    return process.env.PROBADOR_INSTALACION_ID.trim()
  }

  const archivo = path.join(AQUI, '.instalacion-id')
  if (fs.existsSync(archivo)) {
    const guardado = fs.readFileSync(archivo, 'utf8').trim()
    if (guardado) return guardado
  }
  const id = crypto.randomUUID()
  fs.writeFileSync(archivo, `${id}\n`, 'utf8')
  console.log(`\n  Dispositivo nuevo: ${id}\n  Hay que autorizarlo una vez desde el panel.`)
  return id
}

const CONFIG = {
  url: env.SUPABASE_URL,
  anonKey: env.SUPABASE_ANON_KEY,
  dominioUsuario: env.DOMINIO_USUARIO ?? 'woodtools.com.ar',
  instalacionId: instalacionId(),
}

/**
 * Un `.env` con la clave equivocada no puede terminar en un archivo que se
 * manda por mail. Vale más frenar el build que descubrirlo después.
 */
function esClaveDeServicio(clave) {
  if (clave.startsWith('sb_secret_')) return true
  try {
    // Las claves legacy son JWT: el rol viene en el payload.
    const payload = JSON.parse(Buffer.from(clave.split('.')[1], 'base64').toString('utf8'))
    return payload.role === 'service_role'
  } catch {
    return false
  }
}

if (esClaveDeServicio(CONFIG.anonKey)) {
  console.error(
    '\n  SUPABASE_ANON_KEY tiene una clave de SERVICE ROLE.\n' +
      '  Esa clave saltea RLS y no puede ir dentro de un HTML.\n' +
      '  Poné la publishable / anon (Dashboard → Project Settings → API).\n',
  )
  process.exit(1)
}

// ── Bundle ──────────────────────────────────────────────────────────────────

const resultado = await build({
  entryPoints: [path.join(AQUI, 'src/entrada.ts')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['chrome110', 'edge110', 'firefox110'],
  write: false,
  minify: false,
  sourcemap: false,
  define: { CONFIG: JSON.stringify(CONFIG) },
  logLevel: 'warning',
})

const js = resultado.outputFiles[0].text

const html = `<!doctype html>
<html lang="es-AR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Probador · WoodTools</title>
</head>
<body>
<div id="app"></div>
<script>
${js}
</script>
</body>
</html>
`

fs.mkdirSync(path.dirname(SALIDA), { recursive: true })
fs.writeFileSync(SALIDA, html, 'utf8')

const kb = (html.length / 1024).toFixed(0)
console.log(`\n  Listo: ${path.relative(RAIZ, SALIDA)}  (${kb} KB)`)
console.log(`  Proyecto: ${CONFIG.url}`)
console.log(`  Dispositivo: ${CONFIG.instalacionId}`)
console.log(
  indiceSalida >= 0
    ? '\n  Publicá esa carpeta como sitio estático.\n'
    : '\n  Abrilo con doble clic.\n',
)
