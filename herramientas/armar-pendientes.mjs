/**
 * Junta las migraciones que todavía no están aplicadas en UN solo archivo .sql,
 * listo para pegar en el SQL Editor de Supabase.
 *
 *   node herramientas/armar-pendientes.mjs
 *
 * Es la alternativa a `npx supabase db push` para cuando no se quiere pelear
 * con el link del CLI y la contraseña de la base.
 *
 * Lo importante y lo que nadie se acuerda: además del SQL, el archivo registra
 * cada migración en `supabase_migrations.schema_migrations`. Sin eso el
 * servidor no se entera de que ya corrieron, y el próximo `db push` intentaría
 * aplicarlas de nuevo — que es exactamente el lío del que este proyecto ya
 * salió una vez.
 *
 * Todo va en una transacción: si algo falla, no queda nada a medias.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const AQUI = path.dirname(fileURLToPath(import.meta.url))
const RAIZ = path.resolve(AQUI, '..')
const MIGRACIONES = path.join(RAIZ, 'supabase/migrations')
const SALIDA = path.join(RAIZ, 'supabase/PENDIENTES.sql')

/**
 * Versiones que el servidor ya tiene registradas. Se pasan por argumento para
 * no depender de una credencial: se sacan del panel (Database → Migrations) o
 * de `npx supabase migration list`.
 */
const yaAplicadas = new Set(
  process.argv.slice(2).length
    ? process.argv.slice(2)
    : [
        '20260803183426', '20260803183456', '20260803183532', '20260803183558',
        '20260803183705', '20260803183741', '20260803183820', '20260803183901',
        '20260804140331', '20260804140730', '20260805150659', '20260805151045',
        '20260805152716', '20260805153142', '20260805153217', '20260805160825',
        '20260805161917', '20260805163839',
      ],
)

const archivos = fs
  .readdirSync(MIGRACIONES)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => ({ archivo: f, version: f.slice(0, 14), nombre: f.slice(15, -4) }))

const pendientes = archivos.filter((m) => !yaAplicadas.has(m.version))

if (!pendientes.length) {
  console.log('\n  No hay migraciones pendientes.\n')
  process.exit(0)
}

const partes = [
  `-- =============================================================================`,
  `-- WoodTools · migraciones pendientes`,
  `--`,
  `-- Generado por herramientas/armar-pendientes.mjs. NO editar a mano.`,
  `--`,
  `-- Pegar entero en el SQL Editor de Supabase y ejecutar. Corre en una sola`,
  `-- transacción: si algo falla no queda nada a medias.`,
  `--`,
  `-- Al final registra cada migración en supabase_migrations.schema_migrations`,
  `-- para que un futuro \`supabase db push\` no las vuelva a aplicar.`,
  `--`,
  pendientes.map((m) => `--   ${m.version}  ${m.nombre}`).join('\n'),
  `-- =============================================================================`,
  ``,
  `begin;`,
  ``,
]

for (const m of pendientes) {
  const sql = fs.readFileSync(path.join(MIGRACIONES, m.archivo), 'utf8')
  partes.push(
    ``,
    `-- ─────────────────────────────────────────────────────────────────────────`,
    `-- ${m.archivo}`,
    `-- ─────────────────────────────────────────────────────────────────────────`,
    ``,
    sql.trimEnd(),
    ``,
  )
}

partes.push(
  ``,
  `-- ─────────────────────────────────────────────────────────────────────────`,
  `-- Registro en el historial de migraciones`,
  `-- ─────────────────────────────────────────────────────────────────────────`,
  ``,
  `insert into supabase_migrations.schema_migrations (version, name, statements)`,
  `values`,
  pendientes
    .map((m) => `  ('${m.version}', '${m.nombre.replace(/'/g, "''")}', array[]::text[])`)
    .join(',\n'),
  `on conflict (version) do nothing;`,
  ``,
  `commit;`,
  ``,
)

const contenido = partes.join('\n')
fs.writeFileSync(SALIDA, contenido, 'utf8')

console.log(`\n  ${path.relative(RAIZ, SALIDA)}  (${(contenido.length / 1024).toFixed(0)} KB)`)
console.log(`  ${pendientes.length} migraciones:`)
for (const m of pendientes) console.log(`    ${m.version}  ${m.nombre}`)
console.log(`\n  Pegalo en el SQL Editor de Supabase y ejecutalo.\n`)
