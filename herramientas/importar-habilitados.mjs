/**
 * Re-importa el listado de "Clientes habilitados" del Gestión y deja la app
 * móvil mostrándole al vendedor SÓLO a esos clientes.
 *
 *   SECRETO_IMPORTACION=elsecreto node herramientas/importar-habilitados.mjs <listado>
 *
 * El <listado> puede ser:
 *   • el PDF que exporta el Gestión ("Sólo Clientes Habilitados") — se extraen
 *     los códigos con pdftotext (viene con Git); o
 *   • un .txt con un código por línea.
 *
 * ─── Antes de correrlo ──────────────────────────────────────────────────────
 * Hay que crear la función temporal una vez: pegá herramientas/importar-
 * habilitados.sql en el SQL Editor de Supabase (con el secreto puesto adentro) y
 * ejecutá. Al terminar, borrala (los pasos están ahí arriba). Es el mismo
 * mecanismo que importar-clientes.mjs.
 *
 * ─── Qué hace ────────────────────────────────────────────────────────────────
 * Full sync: habilita a los del listado y deshabilita a los del padrón que ya no
 * están. A los clientes creados en la app (creado_por not null) no los toca, así
 * que un cliente que la oficina confirmó sigue habilitado aunque el Gestión
 * todavía no lo liste. Ver la nota de la función SQL.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const SECRETO = process.env.SECRETO_IMPORTACION ?? ''
if (!SECRETO) {
  console.error('\n  Falta SECRETO_IMPORTACION: el mismo que lleva adentro la función temporal.\n')
  process.exit(1)
}

const ARCHIVO = process.argv[2]
if (!ARCHIVO || !fs.existsSync(ARCHIVO)) {
  console.error('\n  Uso: node herramientas/importar-habilitados.mjs <listado.pdf | listado.txt>\n')
  process.exit(1)
}

// ── Configuración ───────────────────────────────────────────────────────────
const env = {}
for (const linea of fs.readFileSync(path.join(RAIZ, '.env'), 'utf8').split(/\r?\n/)) {
  const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}

async function rpc(cuerpo) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/importar_habilitados_temporal`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(cuerpo),
  })
  if (!r.ok) return { error: { message: `${r.status} ${(await r.text()).slice(0, 300)}` } }
  return { data: await r.json() }
}

// ── Extracción de códigos ─────────────────────────────────────────────────────

/** Del texto en formato -layout del Gestión: el código está en la columna 0,
 *  con 11 dígitos (ceros de relleno). El resto de las columnas va indentado. */
function codigosDeLayout(texto) {
  const re = /^(\d{11}) {1,}\S/
  const set = new Set()
  for (const linea of texto.split(/\r?\n/)) {
    const m = re.exec(linea)
    if (m) set.add(String(Number(m[1]))) // sin ceros de relleno
  }
  return set
}

/** Un .txt con un código por línea. */
function codigosDeTxt(texto) {
  const set = new Set()
  for (const linea of texto.split(/\r?\n/)) {
    const s = linea.trim().replace(/^0+(?=\d)/, '')
    if (/^\d+$/.test(s)) set.add(s)
  }
  return set
}

let codigos
const ext = path.extname(ARCHIVO).toLowerCase()
if (ext === '.pdf') {
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wt-hab-')), 'habilitados.txt')
  // pdftotext viene con Git for Windows. shell:true para que resuelva el .exe por PATH.
  const r = spawnSync(`pdftotext -layout "${ARCHIVO}" "${tmp}"`, { shell: true })
  if (r.error || r.status !== 0) {
    console.error('\n  No pude correr pdftotext. ¿Está Git for Windows en el PATH?\n')
    process.exit(1)
  }
  codigos = [...codigosDeLayout(fs.readFileSync(tmp, 'utf8'))]
  fs.rmSync(path.dirname(tmp), { recursive: true, force: true })
} else {
  codigos = [...codigosDeTxt(fs.readFileSync(ARCHIVO, 'utf8'))]
}

if (codigos.length === 0) {
  console.error('\n  No encontré ningún código en el archivo. ¿Es el listado correcto?\n')
  process.exit(1)
}
console.log(`\n  Leídos ${codigos.length} códigos habilitados.`)

// ── Envío por tandas; el sync corre en la última ──────────────────────────────
const TANDA = 3000
let resultado = null
for (let i = 0; i < codigos.length; i += TANDA) {
  const tanda = codigos.slice(i, i + TANDA)
  const esPrimera = i === 0
  const esUltima = i + TANDA >= codigos.length
  const { data, error } = await rpc({
    p_secreto: SECRETO,
    p_codigos: tanda,
    p_reiniciar: esPrimera,
    p_aplicar: esUltima,
  })
  if (error) {
    if (error.message.startsWith('404')) {
      console.error(
        '\n  No existe `importar_habilitados_temporal` en la base.\n' +
          '  Pegá herramientas/importar-habilitados.sql en el SQL Editor —con el secreto\n' +
          '  puesto adentro— y volvé a correr esto.\n',
      )
      process.exit(1)
    }
    console.error(`\n  FALLÓ la tanda que arranca en ${i}: ${error.message}\n`)
    process.exit(1)
  }
  resultado = data
  console.log(`  ${Math.min(i + TANDA, codigos.length)} / ${codigos.length}`)
}

console.log('\n  Listo:')
console.log(`    en el listado:  ${resultado.en_listado}`)
console.log(`    habilitados:    ${resultado.habilitados}`)
console.log(`    deshabilitados: ${resultado.deshabilitados}`)
console.log(`    sin cliente en la base: ${resultado.sin_cliente}`)
console.log('\n  Acordate de borrar la función y la tabla de staging (ver el .sql).\n')
