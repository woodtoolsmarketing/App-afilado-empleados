import { app, BrowserWindow, ipcMain, shell } from 'electron'
import path from 'node:path'

/**
 * Proceso principal de Electron.
 *
 * Se compila a CommonJS (por eso `__dirname` funciona sin `fileURLToPath`):
 * el preload con `sandbox: true` sólo admite CommonJS, así que mantener todo
 * el lado de Electron en el mismo formato evita sorpresas al empaquetar.
 *
 * El renderer corre aislado y sin acceso a Node: todo lo que necesita del
 * sistema pasa por el puente de `precarga.ts`. No hay razón para relajar eso
 * en una app que muestra la ubicación en tiempo real de personas.
 */

let ventana: BrowserWindow | null = null

function crearVentana() {
  ventana = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#B30F0F',
    title: 'WoodTools · Panel de administración',
    icon: path.join(__dirname, '../recursos/icono.png'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'precarga.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  ventana.once('ready-to-show', () => ventana?.show())

  // Cualquier enlace externo se abre en el navegador, nunca dentro de la app.
  ventana.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    void ventana.loadURL(process.env.VITE_DEV_SERVER_URL)
    ventana.webContents.openDevTools({ mode: 'detach' })
  } else {
    void ventana.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

app.whenReady().then(() => {
  crearVentana()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) crearVentana()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

/** Impresión del rol de visita. La vista ya viene maquetada para papel A4. */
ipcMain.handle('imprimir', async () => {
  if (!ventana) return { impreso: false }
  return new Promise((resolver) => {
    ventana!.webContents.print(
      { silent: false, printBackground: true, margins: { marginType: 'default' } },
      (impreso, motivo) => resolver({ impreso, motivo }),
    )
  })
})

ipcMain.handle('abrir-externo', async (_evento, url: string) => {
  if (typeof url === 'string' && url.startsWith('https://')) {
    await shell.openExternal(url)
    return true
  }
  return false
})

ipcMain.handle('version', () => app.getVersion())
