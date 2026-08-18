import { contextBridge, ipcRenderer } from 'electron'

/**
 * Puente entre el renderer y el proceso principal.
 *
 * Se exponen tres operaciones concretas y nada más. Nunca `ipcRenderer` entero:
 * eso le daría al renderer la capacidad de invocar cualquier canal.
 */
// El tipo de `window.woodtools` está declarado una sola vez, en
// `src/vite-env.d.ts`. Repetirlo acá rompería la compilación por miembros
// duplicados al fusionarse las dos interfaces.
contextBridge.exposeInMainWorld('woodtools', {
  imprimir: (): Promise<{ impreso: boolean; motivo?: string }> => ipcRenderer.invoke('imprimir'),
  // Imprime un documento armado por el panel —una nota de la cola— en vez de
  // la ventana que se está mirando.
  imprimirDocumento: (html: string): Promise<{ impreso: boolean; motivo?: string }> =>
    ipcRenderer.invoke('imprimir-documento', html),
  abrirExterno: (url: string): Promise<boolean> => ipcRenderer.invoke('abrir-externo', url),
  version: (): Promise<string> => ipcRenderer.invoke('version'),
  // Sólo existe cuando el panel está abierto desde la carpeta del proyecto:
  // publicar necesita el código y una sesión de Expo, que en una máquina donde
  // sólo se instaló el panel no están.
  proyectoDisponible: (): Promise<boolean> => ipcRenderer.invoke('proyecto-disponible'),
  // Si esto da false, publicar no sirve: la app se compiló sin la capacidad de
  // recibir actualizaciones y el envío no le llega a ningún teléfono.
  actualizacionesConfiguradas: (): Promise<boolean> =>
    ipcRenderer.invoke('actualizaciones-configuradas'),
  // El canal decide a QUÉ teléfonos llega: cada APK escucha el suyo.
  publicarActualizacion: (canal: string): Promise<{ ok: boolean; salida: string }> =>
    ipcRenderer.invoke('publicar-actualizacion', canal),

  /** Qué hay instalado para poder compilar: proyecto, JDK y SDK de Android. */
  herramientasDeCompilacion: (): Promise<{
    proyecto: boolean
    jdk: string | null
    sdk: string | null
  }> => ipcRenderer.invoke('herramientas-de-compilacion'),

  /**
   * Compila el APK acá y lo sube.
   *
   * El token es el de la sesión de quien está usando el panel: la base sigue
   * decidiendo quién puede publicar, y esto no lleva ninguna clave maestra.
   */
  compilarApk: (datos: {
    canal: string
    token: string
    supabaseUrl: string
    anonKey: string
  }): Promise<{
    ok: boolean
    salida: string
    archivo?: string
    tamano?: number
    version?: string
  }> => ipcRenderer.invoke('compilar-apk', datos),

  /**
   * Avisa en qué anda la compilación. Devuelve la función para desuscribirse:
   * sin eso, cada vez que se vuelve a entrar a la pantalla queda otro oyente
   * escuchando el mismo canal.
   */
  alAvanzarCompilacion: (
    escuchar: (paso: { etapa: string; detalle: string }) => void,
  ): (() => void) => {
    const oyente = (_e: unknown, paso: { etapa: string; detalle: string }) => escuchar(paso)
    ipcRenderer.on('compilacion-avanza', oyente)
    return () => ipcRenderer.removeListener('compilacion-avanza', oyente)
  },
})
