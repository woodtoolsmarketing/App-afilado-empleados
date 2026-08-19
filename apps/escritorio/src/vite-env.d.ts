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
    /** Imprime un documento armado por el panel, no la ventana visible. */
    imprimirDocumento?: (html: string) => Promise<{ impreso: boolean; motivo?: string }>
    abrirExterno: (url: string) => Promise<boolean>
    version: () => Promise<string>
    /** Sólo con el panel abierto desde la carpeta del proyecto. */
    proyectoDisponible?: () => Promise<boolean>
    /** false cuando la app se compila sin poder recibir actualizaciones. */
    actualizacionesConfiguradas?: () => Promise<boolean>
    /** `canal` decide a qué teléfonos llega: cada APK escucha el suyo. */
    publicarActualizacion?: (canal: string) => Promise<{ ok: boolean; salida: string }>
    /**
     * Los instaladores guardados en esta PC, y en qué dirección los sirve a la
     * red de la oficina. Llamarlo levanta el servidor si estaba apagado.
     */
    instaladores?: () => Promise<{
      archivos: Array<{ archivo: string; tamano: number; fecha: string }>
      direccion: string | null
      carpeta: string
      sirviendo: boolean
    }>
    /** Elegir un APK ya compilado y guardarlo para repartirlo. */
    agregarInstalador?: () => Promise<{
      ok: boolean
      motivo?: string
      archivo?: string
      tamano?: number
    }>
    borrarInstalador?: (archivo: string) => Promise<boolean>
    /** Qué hay instalado para compilar: proyecto, JDK y SDK de Android. */
    herramientasDeCompilacion?: () => Promise<{
      proyecto: boolean
      jdk: string | null
      sdk: string | null
    }>
    /** Compila el APK acá y lo guarda para repartirlo por la red de la oficina. */
    compilarApk?: (datos: { canal: string }) => Promise<{
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
