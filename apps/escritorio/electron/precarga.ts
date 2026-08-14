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
})
