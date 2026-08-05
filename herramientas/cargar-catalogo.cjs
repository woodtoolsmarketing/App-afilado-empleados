/**
 * Carga el catálogo por PostgREST leyendo el .sql del repo.
 *
 * El archivo tiene 173 KB: pasarlo por el chat sería tirar tokens al pedo y
 * además innecesario, porque el shell puede leerlo y postearlo solo.
 *
 * La service role key se lee del .env y NUNCA se imprime.
 */

const fs = require('node:fs')
const path = require('node:path')

const RAIZ = path.resolve(__dirname, '..')

const env = Object.fromEntries(
  fs
    .readFileSync(path.join(RAIZ, '.env'), 'utf8')
    .split(/\r?\n/)
    .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2].trim().replace(/^["']|["']$/g, '')]),
)

// La variable de entorno gana sobre el .env: así la clave puede vivir sólo en
// el comando y no quedar guardada en un archivo.
const URL = process.env.SUPABASE_URL || env.SUPABASE_URL
const LLAVE = process.env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !LLAVE) {
  console.error('Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env')
  process.exit(1)
}

const COLUMNAS = [
  'codigo', 'descripcion', 'medida', 'precio', 'moneda',
  'lista_origen', 'lista_fecha', 'familia', 'rango_min', 'rango_max', 'rango_dimension',
]

/** Parte una fila `('a','b',NULL,1.0,...)` respetando las comillas escapadas. */
function partirFila(texto) {
  const valores = []
  let i = 0
  while (i < texto.length) {
    if (texto[i] === "'") {
      let s = ''
      i++
      while (i < texto.length) {
        if (texto[i] === "'" && texto[i + 1] === "'") { s += "'"; i += 2; continue }
        if (texto[i] === "'") { i++; break }
        s += texto[i++]
      }
      valores.push(s)
    } else {
      let s = ''
      while (i < texto.length && texto[i] !== ',') s += texto[i++]
      s = s.trim()
      valores.push(s === 'NULL' ? null : Number(s))
    }
    while (i < texto.length && (texto[i] === ',' || texto[i] === ' ')) i++
  }
  return valores
}

const sql = fs
  .readFileSync(path.join(RAIZ, 'supabase/migrations/20260805185500_catalogo_datos.sql'), 'utf8')
  .replace(/\r/g, '')

const filas = (sql.match(/^\(.*\),?$/gm) ?? []).map((linea) => {
  const cuerpo = linea.replace(/^\(/, '').replace(/\),?$/, '')
  const valores = partirFila(cuerpo)
  return Object.fromEntries(COLUMNAS.map((c, k) => [c, valores[k]]))
})

console.log(`Filas parseadas: ${filas.length}`)
if (filas.length !== 1315) {
  console.error('Se esperaban 1315 filas. No sigo.')
  process.exit(1)
}

// Una muestra, para ver que el parseo no se comió nada.
console.log('Primera:', JSON.stringify(filas[0]))
console.log('Última :', JSON.stringify(filas[filas.length - 1]))

const cabeceras = {
  apikey: LLAVE,
  Authorization: `Bearer ${LLAVE}`,
  'Content-Type': 'application/json',
}

async function main() {
  // ── 1 · Los 1.315 artículos ───────────────────────────────────────────────
  const LOTE = 300
  let cargadas = 0
  for (let i = 0; i < filas.length; i += LOTE) {
    const lote = filas.slice(i, i + LOTE)
    const r = await fetch(`${URL}/rest/v1/catalogo_articulos`, {
      method: 'POST',
      headers: { ...cabeceras, Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify(lote),
    })
    if (!r.ok) {
      console.error(`Lote ${i / LOTE + 1} falló: ${r.status} ${await r.text()}`)
      process.exit(1)
    }
    cargadas += lote.length
    console.log(`  lote ${i / LOTE + 1}: ${cargadas}/${filas.length}`)
  }

  // ── 2 · MUELAS en dólares ─────────────────────────────────────────────────
  //
  // Va DESPUÉS de la carga: es un update sobre las filas que se acaban de
  // insertar. Corrido antes sería un no-op y las 4 muelas quedarían sin moneda.
  const rm = await fetch(
    `${URL}/rest/v1/catalogo_articulos?familia=eq.muela&moneda=is.null`,
    {
      method: 'PATCH',
      headers: { ...cabeceras, Prefer: 'return=representation' },
      body: JSON.stringify({ moneda: 'USD' }),
    },
  )
  if (!rm.ok) {
    console.error(`MUELAS falló: ${rm.status} ${await rm.text()}`)
    process.exit(1)
  }
  const muelas = await rm.json()
  console.log(`MUELAS pasadas a USD: ${muelas.length}`)

  // ── 3 · Verificación ──────────────────────────────────────────────────────
  const rc = await fetch(`${URL}/rest/v1/catalogo_articulos?select=codigo`, {
    method: 'HEAD',
    headers: { ...cabeceras, Prefer: 'count=exact' },
  })
  console.log(`Total en la tabla: ${rc.headers.get('content-range')}`)
  console.log('\nListo. Avisale a Claude para que registre las migraciones.\n')
}

void main()
