/**
 * Arma el probador en UN SOLO archivo HTML.
 *
 * Todo va embebido —el cliente de Supabase, el paquete compartido, los estilos—
 * para que sea un archivo suelto que se abre con doble clic y anda. Sin
 * servidor, sin `npm install` del otro lado, sin CDN.
 *
 * La configuración se lee del `.env` de la raíz y se inyecta en el bundle. Por
 * eso el HTML de salida está en .gitignore: la clave anónima es pública por
 * diseño (viaja dentro del APK), pero este repo no guarda claves y no vamos a
 * empezar ahora.
 *
 *   node herramientas/probador/construir.mjs
 */

import { build } from 'esbuild'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const AQUI = path.dirname(fileURLToPath(import.meta.url))
const RAIZ = path.resolve(AQUI, '../..')
const SALIDA = path.join(AQUI, 'probador.html')

// ── Configuración ───────────────────────────────────────────────────────────

function leerEnv() {
  const archivo = path.join(RAIZ, '.env')
  if (!fs.existsSync(archivo)) {
    console.error(`\n  No encontré ${archivo}.\n  El probador necesita SUPABASE_URL y SUPABASE_ANON_KEY.\n`)
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
const faltan = ['SUPABASE_URL', 'SUPABASE_ANON_KEY'].filter((k) => !env[k])
if (faltan.length) {
  console.error(`\n  Faltan en .env: ${faltan.join(', ')}\n`)
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
const CONFIG = {
  url: env.SUPABASE_URL,
  anonKey: env.SUPABASE_ANON_KEY,
  dominioUsuario: env.DOMINIO_USUARIO ?? 'woodtools.com.ar',
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

fs.writeFileSync(SALIDA, html, 'utf8')

const kb = (html.length / 1024).toFixed(0)
console.log(`\n  Listo: ${path.relative(RAIZ, SALIDA)}  (${kb} KB)`)
console.log(`  Proyecto: ${CONFIG.url}`)
console.log(`\n  Abrilo con doble clic.\n`)
