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
  woodtools?: {
    imprimir: () => Promise<{ impreso: boolean; motivo?: string }>
    abrirExterno: (url: string) => Promise<boolean>
    version: () => Promise<string>
    /** Sólo con el panel abierto desde la carpeta del proyecto. */
    proyectoDisponible?: () => Promise<boolean>
    /** false cuando la app se compila sin poder recibir actualizaciones. */
    actualizacionesConfiguradas?: () => Promise<boolean>
    /** `canal` decide a qué teléfonos llega: cada APK escucha el suyo. */
    publicarActualizacion?: (canal: string) => Promise<{ ok: boolean; salida: string }>
  }
}
