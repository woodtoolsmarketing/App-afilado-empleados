/**
 * Carga `catalogo_medidas` por PostgREST desde el JSON del repo.
 *
 * Mismo criterio que `cargar-catalogo.cjs`: el archivo lo lee el shell y lo
 * postea solo, sin pasarlo por el chat. La service role key se lee del .env y
 * NUNCA se imprime.
 *
 * El JSON lo genera `normalizar-medidas.py` a partir del paquete de catálogos
 * técnicos. Es idempotente: cada corrida hace upsert por código, así que se
 * puede volver a correr cuando llegue una lista nueva.
 *
 *     npm run cargar:medidas
 */

const fs = require('node:fs')
const path = require('node:path')

const RAIZ = path.resolve(__dirname, '..')
const DATOS = path.join(RAIZ, 'supabase/datos/medidas-tecnicas.json')
const TABLA = 'catalogo_medidas'
const LOTE = 200

const env = Object.fromEntries(
  fs
    .readFileSync(path.join(RAIZ, '.env'), 'utf8')
    .split(/\r?\n/)
    .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2].trim().replace(/^["']|["']$/g, '')]),
)

const URL = process.env.SUPABASE_URL || env.SUPABASE_URL
const LLAVE = process.env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !LLAVE) {
  console.error('Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env')
  process.exit(1)
}

if (!fs.existsSync(DATOS)) {
  console.error(
    `No existe ${path.relative(RAIZ, DATOS)}.\n` +
      'Generalo antes con:\n' +
      '  python herramientas/normalizar-medidas.py <carpeta-del-paquete-de-catalogos>',
  )
  process.exit(1)
}

const crudas = JSON.parse(fs.readFileSync(DATOS, 'utf8'))

/**
 * Todas las filas con las mismas claves.
 *
 * El JSON omite las medidas que la lista no publica —una cuchilla no tiene
 * dientes— y eso hace los archivos mucho más chicos, pero PostgREST rechaza un
 * lote donde las filas no tienen las mismas columnas ("All object keys must
 * match"). Así que acá se rellenan con null, que es justamente lo que
 * significan.
 */
const COLUMNAS = [...new Set(crudas.flatMap((f) => Object.keys(f)))].sort()
const filas = crudas.map((f) => Object.fromEntries(COLUMNAS.map((c) => [c, f[c] ?? null])))

async function subir(lote) {
  const respuesta = await fetch(`${URL}/rest/v1/${TABLA}?on_conflict=codigo`, {
    method: 'POST',
    headers: {
      apikey: LLAVE,
      Authorization: `Bearer ${LLAVE}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(lote),
  })
  if (!respuesta.ok) {
    // El cuerpo del error trae el código que falló, que es lo único que sirve
    // para arreglarlo. La clave no aparece por ningún lado.
    throw new Error(`${respuesta.status} ${await respuesta.text()}`)
  }
}

;(async () => {
  console.log(`${filas.length} códigos para cargar en ${TABLA}…`)
  for (let i = 0; i < filas.length; i += LOTE) {
    const lote = filas.slice(i, i + LOTE)
    await subir(lote)
    console.log(`  ${Math.min(i + LOTE, filas.length)}/${filas.length}`)
  }

  // Se cuenta contra la base y no contra el archivo: lo que importa es lo que
  // quedó del otro lado.
  const cuenta = await fetch(`${URL}/rest/v1/${TABLA}?select=codigo`, {
    headers: { apikey: LLAVE, Authorization: `Bearer ${LLAVE}`, Prefer: 'count=exact', Range: '0-0' },
  })
  console.log(`Listo. En la base: ${cuenta.headers.get('content-range')?.split('/')[1] ?? '?'}`)
})().catch((e) => {
  console.error('Falló la carga:', e.message)
  process.exit(1)
})
