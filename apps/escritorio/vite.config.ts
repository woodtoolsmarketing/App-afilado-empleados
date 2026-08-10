import react from '@vitejs/plugin-react'
import path from 'node:path'
import { defineConfig, loadEnv } from 'vite'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'

const RAIZ_MONOREPO = path.resolve(__dirname, '../..')

/** Misma comprobación que hace el probador antes de embeber la clave. */
function esClaveDeServicio(clave: string): boolean {
  if (clave.startsWith('sb_secret_')) return true
  try {
    // Las claves legacy son JWT: el rol viene en el payload.
    const payload = JSON.parse(Buffer.from(clave.split('.')[1], 'base64').toString('utf8'))
    return payload.role === 'service_role'
  } catch {
    return false
  }
}

export default defineConfig(({ mode, command }) => {
  /**
   * Las credenciales salen del `.env` de la RAÍZ, no del de esta carpeta.
   *
   * Vite busca el `.env` al lado del proyecto y sólo expone lo que empiece con
   * `VITE_`. Acá no se cumple ninguna de las dos: el archivo es uno solo para
   * todo el monorepo —compartido con la app del celular— y las variables se
   * llaman `SUPABASE_URL` y `SUPABASE_ANON_KEY`.
   *
   * Sin este puente, `import.meta.env.VITE_SUPABASE_URL` llega `undefined` y
   * el resultado es un instalador que se instala perfecto y no puede iniciar
   * sesión. Ese modo de fallar —silencioso, y recién visible con la app ya
   * instalada en otra máquina— es lo que justifica cortar el build más abajo.
   *
   * El tercer argumento vacío desactiva el filtro por prefijo. Sólo se leen
   * dos variables, y las dos son públicas por diseño: viajan dentro del APK.
   * La `service_role` no se toca ni se nombra.
   */
  const env = loadEnv(mode, RAIZ_MONOREPO, '')

  const url = env.VITE_SUPABASE_URL || env.SUPABASE_URL || ''
  const anon = env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY || ''

  // En `vite build` falta significa un instalador roto; en `vite dev` alcanza
  // con el aviso que ya imprime `nucleo/supabase.ts` al arrancar.
  if (command === 'build' && (!url || !anon)) {
    throw new Error(
      [
        '',
        '───────────────────────────────────────────────────────────────',
        '  No se puede empaquetar el panel: faltan credenciales',
        '───────────────────────────────────────────────────────────────',
        '',
        `  Faltan: ${[!url && 'SUPABASE_URL', !anon && 'SUPABASE_ANON_KEY'].filter(Boolean).join(', ')}`,
        '',
        `  Completá el .env de la raíz: ${path.join(RAIZ_MONOREPO, '.env')}`,
        '  Los pasos están en docs/PUESTA-EN-MARCHA.md',
        '',
        '───────────────────────────────────────────────────────────────',
        '',
      ].join('\n'),
    )
  }

  // Un `.env` mal pegado no puede terminar dentro de un instalador que se
  // reparte por mail. Vale más frenar el build que descubrirlo después.
  if (esClaveDeServicio(anon)) {
    throw new Error(
      [
        '',
        '  SUPABASE_ANON_KEY tiene una clave de SERVICE ROLE.',
        '  Esa clave saltea RLS: quien tuviera el instalador podría leer y borrar toda la base.',
        '  Poné la publishable / anon (Dashboard → Project Settings → API).',
        '',
      ].join('\n'),
    )
  }

  return {
    // Rutas relativas: la app empaquetada se abre con `loadFile`, o sea
    // `file://`, y con la base absoluta de Vite ("/assets/…") la ventana sale
    // en blanco. Con `npm run dev` no se nota porque ahí hay un servidor.
    base: './',

    plugins: [
      react(),
      electron([
        { entry: 'electron/principal.ts' },
        {
          entry: 'electron/precarga.ts',
          onstart: (opciones) => opciones.reload(),
          // CommonJS obligatorio: un preload con `sandbox: true` no puede ser ESM.
          vite: { build: { rollupOptions: { output: { format: 'cjs', entryFileNames: 'precarga.js' } } } },
        },
      ]),
      renderer(),
    ],

    define: {
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(url),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(anon),
    },

    resolve: {
      alias: {
        '@woodtools/compartido': path.resolve(__dirname, '../../packages/compartido/src/index.ts'),
        '@': path.resolve(__dirname, 'src'),
      },
    },
    server: { port: 5183 },
  }
})
