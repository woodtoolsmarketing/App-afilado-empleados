import react from '@vitejs/plugin-react'
import path from 'node:path'
import { defineConfig } from 'vite'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'

export default defineConfig({
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
  resolve: {
    alias: {
      '@woodtools/compartido': path.resolve(__dirname, '../../packages/compartido/src/index.ts'),
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: { port: 5183 },
})
