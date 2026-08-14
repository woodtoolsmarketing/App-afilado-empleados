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

// ─────────────────────────────────────────────────────────────────────────────
// Compilar el APK desde el panel y dejarlo listo para bajar
//
// Es el circuito que hasta ahora se hacía a mano y en tres lugares: compilar en
// una terminal, bajar el archivo, y hacérselo llegar a cada vendedor por
// WhatsApp o por cable. Con diez teléfonos deja de cerrar — nadie sabe cuál es
// el último archivo ni quién quedó atrás.
//
// Acá pasa entero: se compila en esta máquina, se sube al bucket privado y
// queda anotado en `versiones_app`, que es de donde el panel saca cuál es la
// versión vigente de cada canal.
//
// **Compila localmente, no en la nube.** Con Gradle acá no hay cuota mensual
// que se agote ni cola que esperar. A cambio hace falta el JDK y el SDK de
// Android en esta PC; si faltan se dice cuál falta, en vez de fallar con un
// error de Gradle que no significa nada para quien lo lee.
// ─────────────────────────────────────────────────────────────────────────────

/** Dónde suele quedar el JDK 17, que es el que pide Expo 52. */
function buscarJdk(): string | null {
  if (process.env.JAVA_HOME && fs.existsSync(process.env.JAVA_HOME)) return process.env.JAVA_HOME
  for (const nido of ['C:\\Program Files\\Eclipse Adoptium', 'C:\\Program Files\\Java']) {
    if (!fs.existsSync(nido)) continue
    const jdk = fs
      .readdirSync(nido)
      .filter((n) => n.includes('17'))
      .sort()
      .pop()
    if (jdk) return path.join(nido, jdk)
  }
  return null
}

function buscarSdkAndroid(): string | null {
  const candidatos = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    'C:\\Android\\Sdk',
    path.join(process.env.LOCALAPPDATA ?? '', 'Android', 'Sdk'),
  ].filter((c): c is string => !!c)
  return candidatos.find((c) => fs.existsSync(path.join(c, 'platform-tools'))) ?? null
}

/**
 * Corre un comando y va contando lo que sale.
 *
 * `alAvanzar` existe porque compilar tarda varios minutos, y una ventana quieta
 * durante cinco minutos se lee como colgada. Se manda la última línea, que es
 * donde Gradle dice en qué tarea está.
 */
function correr(
  comando: string,
  argumentos: string[],
  opciones: { cwd: string; env: NodeJS.ProcessEnv },
  alAvanzar: (linea: string) => void,
): Promise<{ ok: boolean; salida: string }> {
  return new Promise((resolver) => {
    // `shell: false`: los argumentos van como argumentos y no se concatenan en
    // una línea de comandos que alguien pueda torcer.
    const proceso = spawn(comando, argumentos, { ...opciones, shell: false })
    let salida = ''
    const juntar = (d: Buffer) => {
      const texto = d.toString()
      salida += texto
      if (salida.length > 60_000) salida = salida.slice(-60_000)
      const ultima = texto.trim().split(/\r?\n/).pop()
      if (ultima) alAvanzar(ultima)
    }
    proceso.stdout.on('data', juntar)
    proceso.stderr.on('data', juntar)
    proceso.on('error', (e) => resolver({ ok: false, salida: `${salida}\n${e.message}` }))
    proceso.on('close', (codigo) => resolver({ ok: codigo === 0, salida }))
  })
}

/** La versión que declara la app, para nombrar el archivo y anotarla. */
function leerVersionDeLaApp(movil: string): string {
  try {
    const config = fs.readFileSync(path.join(movil, 'app.config.ts'), 'utf8')
    return config.match(/version:\s*'([^']+)'/)?.[1] ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}

ipcMain.handle('herramientas-de-compilacion', () => ({
  proyecto: carpetaDelProyecto() !== null,
  jdk: buscarJdk(),
  sdk: buscarSdkAndroid(),
}))

ipcMain.handle(
  'compilar-apk',
  async (
    evento,
    datos: { canal: string; token: string; supabaseUrl: string; anonKey: string },
  ) => {
    const raiz = carpetaDelProyecto()
    if (!raiz) return { ok: false, salida: 'No se encontró la carpeta del proyecto.' }

    const canal = (CANALES as readonly string[]).includes(datos?.canal) ? datos.canal : 'interno'

    const jdk = buscarJdk()
    if (!jdk) {
      return {
        ok: false,
        salida:
          'Falta el JDK 17 en esta máquina. Se instala con:\n' +
          '  winget install --id EclipseAdoptium.Temurin.17.JDK',
      }
    }

    const sdk = buscarSdkAndroid()
    if (!sdk) {
      return {
        ok: false,
        salida:
          'Falta el SDK de Android en esta máquina: hace falta la carpeta con platform-tools,\n' +
          'normalmente en C:\\Android\\Sdk.',
      }
    }

    const avisar = (etapa: string, detalle: string) =>
      evento.sender.send('compilacion-avanza', { etapa, detalle })

    const entorno: NodeJS.ProcessEnv = {
      ...process.env,
      JAVA_HOME: jdk,
      ANDROID_HOME: sdk,
      ANDROID_SDK_ROOT: sdk,
      APP_VARIANTE: canal,
    }

    const movil = path.join(raiz, 'apps', 'movil')
    const android = path.join(movil, 'android')

    /**
     * El proyecto nativo se regenera siempre, no sólo si falta.
     *
     * Lo produce `app.config.ts`, que cambia: un permiso, el logo, la URL de
     * actualizaciones. Una carpeta vieja compilaría con lo de antes y no habría
     * nada que lo delatara hasta tener el APK instalado en un teléfono.
     */
    avisar('preparando', 'Generando el proyecto Android desde la configuración…')
    const preparacion = await correr(
      process.execPath,
      [path.join(raiz, 'node_modules', 'expo', 'bin', 'cli'), 'prebuild', '--platform', 'android', '--clean'],
      { cwd: movil, env: { ...entorno, ELECTRON_RUN_AS_NODE: '1' } },
      (l) => avisar('preparando', l),
    )
    if (!preparacion.ok) return { ok: false, salida: preparacion.salida }

    avisar('compilando', 'Compilando el APK. La primera vez tarda bastante…')
    const compilacion = await correr(
      path.join(android, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew'),
      ['assembleRelease'],
      { cwd: android, env: entorno },
      (l) => avisar('compilando', l),
    )

    if (!compilacion.ok) {
      /**
       * El error de Gradle que más cuesta reconocer.
       *
       * "Unable to establish loopback connection" suena a problema de red y no
       * lo es: Gradle abre un canal entre sus propios procesos y el antivirus
       * lo corta. Sin esta traducción, quien lo lee sale a revisar el wifi.
       */
      const esElAntivirus = /loopback connection/i.test(compilacion.salida)
      return {
        ok: false,
        salida: esElAntivirus
          ? 'La compilación la bloquea el antivirus: Gradle no puede comunicarse con su propio ' +
            'proceso auxiliar. No es un problema de red ni del código.\n\n' +
            'Hay que excluir en el antivirus:\n' +
            `  ${path.join(jdk, 'bin', 'java.exe')}\n\n` +
            `Salida original:\n${compilacion.salida}`
          : compilacion.salida,
      }
    }

    const apk = path.join(android, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk')
    if (!fs.existsSync(apk)) {
      return { ok: false, salida: `La compilación terminó pero no apareció el APK en:\n${apk}` }
    }

    /**
     * Se sube con el token de quien está usando el panel, no con una clave
     * maestra: así "sólo Administración publica" lo sigue haciendo cumplir la
     * base y no este archivo.
     */
    const tamano = fs.statSync(apk).size
    const version = leerVersionDeLaApp(movil)
    const sello = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')
    const destino = `${canal}/woodtools-${canal}-${version}-${sello}.apk`

    avisar('subiendo', `Subiendo ${(tamano / 1_048_576).toFixed(0)} MB…`)
    try {
      const respuesta = await fetch(
        `${datos.supabaseUrl}/storage/v1/object/instaladores/${destino}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${datos.token}`,
            apikey: datos.anonKey,
            'Content-Type': 'application/vnd.android.package-archive',
          },
          body: fs.readFileSync(apk),
        },
      )
      if (!respuesta.ok) {
        return { ok: false, salida: `No se pudo subir el APK: ${await respuesta.text()}` }
      }
    } catch (e) {
      return { ok: false, salida: `No se pudo subir el APK: ${(e as Error).message}` }
    }

    return { ok: true, salida: compilacion.salida, archivo: destino, tamano, version }
  },
)
