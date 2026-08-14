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
    /** Qué hay instalado para compilar: proyecto, JDK y SDK de Android. */
    herramientasDeCompilacion?: () => Promise<{
      proyecto: boolean
      jdk: string | null
      sdk: string | null
    }>
    /** Compila el APK en esta máquina y lo sube al bucket de instaladores. */
    compilarApk?: (datos: {
      canal: string
      token: string
      supabaseUrl: string
      anonKey: string
    }) => Promise<{
      ok: boolean
      salida: string
      archivo?: string
      tamano?: number
      version?: string
    }>
    /** Avisa en qué anda la compilación. Devuelve cómo desuscribirse. */
    alAvanzarCompilacion?: (
      escuchar: (paso: { etapa: string; detalle: string }) => void,
    ) => () => void
  }
}
