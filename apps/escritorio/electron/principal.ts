import { spawn } from 'node:child_process'
import { app, BrowserWindow, ipcMain, shell } from 'electron'
import fs from 'node:fs'
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

/**
 * Publicar una actualización por aire para los celulares.
 *
 * Corre `eas update` en esta máquina. No lo puede hacer el renderer —no tiene
 * acceso a Node, y así tiene que seguir— ni un servidor: hace falta el código
 * del proyecto y una sesión de Expo, y las dos cosas viven en la PC de la
 * oficina.
 *
 * Por eso lo primero que hace es fijarse si el proyecto está al alcance. En una
 * máquina donde sólo se instaló el panel no lo va a estar, y el botón ni
 * aparece: es preferible eso a un botón que falla cuando lo tocan.
 *
 * `shell: false` a propósito: los argumentos van como argumentos y no se
 * concatenan en una línea de comandos que alguien pueda torcer.
 */
function carpetaDelProyecto(): string | null {
  // Empaquetado, `__dirname` cae adentro del asar y no hay proyecto alrededor.
  if (app.isPackaged) {
    const desdeEntorno = process.env.WOODTOOLS_PROYECTO
    return desdeEntorno && fs.existsSync(path.join(desdeEntorno, 'apps/movil/app.config.ts'))
      ? desdeEntorno
      : null
  }
  const raiz = path.resolve(__dirname, '../../..')
  return fs.existsSync(path.join(raiz, 'apps/movil/app.config.ts')) ? raiz : null
}

ipcMain.handle('proyecto-disponible', () => carpetaDelProyecto() !== null)

/**
 * A qué canales se puede publicar, y con qué APK se corresponde cada uno.
 *
 * No es una lista decorativa: **una actualización sólo llega a los teléfonos
 * cuyo APK se compiló para ese canal**. El panel publicaba siempre a
 * `produccion`, y los teléfonos que hay hoy tienen el APK `interno`: aunque
 * todo lo demás estuviera bien, no les llegaba nada y el panel decía que sí.
 */
const CANALES = ['interno', 'beta', 'produccion'] as const
type Canal = (typeof CANALES)[number]

/**
 * ¿Está prendido el circuito de actualizaciones por aire?
 *
 * Sin `EAS_UPDATE_URL`, la app se compila con las actualizaciones apagadas y
 * publicar no sirve de nada. Estuvo así seis versiones seguidas: la línea
 * existía en el `.env` pero vacía, que para el código es lo mismo que no
 * estar. El panel lo mira antes de ofrecer el botón, para no prometer algo que
 * no va a pasar.
 */
function actualizacionesConfiguradas(raiz: string): boolean {
  const archivo = path.join(raiz, '.env')
  if (!fs.existsSync(archivo)) return false
  const linea = fs
    .readFileSync(archivo, 'utf8')
    .split(/\r?\n/)
    .find((l) => l.startsWith('EAS_UPDATE_URL='))
  return !!linea && linea.slice('EAS_UPDATE_URL='.length).trim() !== ''
}

ipcMain.handle('actualizaciones-configuradas', () => {
  const raiz = carpetaDelProyecto()
  return raiz !== null && actualizacionesConfiguradas(raiz)
})

ipcMain.handle('publicar-actualizacion', async (_evento, canalPedido: string) => {
  const raiz = carpetaDelProyecto()
  if (!raiz) {
    return { ok: false, salida: 'No se encontró la carpeta del proyecto en esta máquina.' }
  }

  // El canal viene del renderer: se valida contra la lista y no se pasa nunca
  // tal cual a la línea de comandos.
  const canal: Canal = (CANALES as readonly string[]).includes(canalPedido)
    ? (canalPedido as Canal)
    : 'interno'

  if (!actualizacionesConfiguradas(raiz)) {
    return {
      ok: false,
      salida:
        'Las actualizaciones por aire están apagadas: falta EAS_UPDATE_URL en el .env del ' +
        'proyecto. Mientras esté vacía, la app se compila sin la capacidad de recibirlas y ' +
        'publicar no le llega a ningún teléfono.',
    }
  }

  const eas = path.join(raiz, 'node_modules', 'eas-cli', 'bin', 'run')
  if (!fs.existsSync(eas)) {
    return { ok: false, salida: 'Falta eas-cli. Corré `npm install` en la carpeta del proyecto.' }
  }

  return new Promise((resolver) => {
    const proceso = spawn(
      process.execPath,
      [eas, 'update', '--branch', canal, '--message', `Actualización desde el panel (${canal})`],
      {
        cwd: path.join(raiz, 'apps', 'movil'),
        // ELECTRON_RUN_AS_NODE hace que este mismo ejecutable se comporte como
        // Node a secas. Sin eso, `process.execPath` levantaría otra ventana de
        // Electron en vez de correr el script.
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      },
    )

    let salida = ''
    const juntar = (d: Buffer) => {
      salida += d.toString()
      // Un `eas update` que se va de las manos no puede llenar la memoria del
      // panel: alcanza con el final, que es donde está el resultado.
      if (salida.length > 40_000) salida = salida.slice(-40_000)
    }

    proceso.stdout.on('data', juntar)
    proceso.stderr.on('data', juntar)
    proceso.on('error', (e) => resolver({ ok: false, salida: `${salida}\n${e.message}` }))
    proceso.on('close', (codigo) => resolver({ ok: codigo === 0, salida }))
  })
})
