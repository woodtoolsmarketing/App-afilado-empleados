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
})
