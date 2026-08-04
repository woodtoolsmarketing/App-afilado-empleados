/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

/** Puente expuesto por `electron/precarga.ts`. */
interface Window {
  woodtools: {
    imprimir: () => Promise<{ impreso: boolean; motivo?: string }>
    abrirExterno: (url: string) => Promise<boolean>
    version: () => Promise<string>
  }
}
