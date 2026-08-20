import { spawn } from 'node:child_process'
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
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

  // El instalador queda disponible desde que el panel arranca, sin depender de
  // que alguien entre a la pantalla de actualizaciones. Un vendedor parado en
  // la oficina no tiene por qué esperar a que en administración abran una
  // pantalla para poder bajarse la app.
  arrancarServidorDeInstaladores()

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

/**
 * Imprimir un documento que arma el panel, no la ventana que se está mirando.
 *
 * Es lo que hace posible la cola: el celular encola una nota y esta máquina la
 * saca en papel. Y de paso resuelve el problema de raíz —el PDF lo arma
 * Chromium acá, con la misma letra y el mismo tamaño siempre, sin el ajuste de
 * accesibilidad del teléfono de cada vendedor en el medio—.
 *
 * Va en una ventana propia, oculta y sin Node:
 *
 *   · propia, porque `webContents.print()` imprime lo que la ventana muestra, y
 *     no se le puede pedir al panel que se convierta en la nota y vuelva;
 *   · oculta, porque el operador no tiene por qué ver parpadear una hoja;
 *   · sin Node y con `javascript: false`, porque acá entra HTML armado con
 *     datos de la base. No debería poder ejecutar nada, y no puede.
 *
 * `silent: false` a propósito: sale el diálogo de impresión. La oficina elige
 * impresora y confirma, que es lo que hoy hace a mano y no hay motivo para
 * quitárselo. Si alguna vez se quiere sin diálogo, es este parámetro.
 */
ipcMain.handle('imprimir-documento', async (_evento, html: unknown) => {
  if (typeof html !== 'string' || html.length === 0) {
    return { impreso: false, motivo: 'No llegó el documento a imprimir' }
  }

  const hoja = new BrowserWindow({
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      javascript: false,
    },
  })

  try {
    await hoja.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    return await new Promise<{ impreso: boolean; motivo?: string }>((resolver) => {
      hoja.webContents.print(
        { silent: false, printBackground: true, margins: { marginType: 'none' } },
        (impreso, motivo) => resolver({ impreso, motivo }),
      )
    })
  } catch (e) {
    return { impreso: false, motivo: (e as Error).message }
  } finally {
    // Pase lo que pase la ventana se cierra: una hoja oculta que queda viva es
    // memoria que nadie va a reclamar y que nadie ve.
    if (!hoja.isDestroyed()) hoja.destroy()
  }
})

ipcMain.handle('abrir-externo', async (_evento, url: string) => {
  if (typeof url === 'string' && url.startsWith('https://')) {
    await shell.openExternal(url)
    return true
  }
  return false
})

ipcMain.handle('version', () => app.getVersion())

// ─────────────────────────────────────────────────────────────────────────────
// El instalador de la app, guardado acá y servido a la red de la oficina
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Dónde vive el APK, y por qué acá.
 *
 * La idea original era guardarlo en Supabase y bajarlo desde cualquier lado.
 * No se puede: el plan del proyecto rechaza subidas de más de 50 MB y el APK
 * pesa 82. Está medido —1 MB y 40 MB entran, 55 MB devuelve 413— así que no es
 * un problema de permisos ni del bucket. El botón "Compilar APK" del panel
 * terminaba en error después de veinte minutos de compilación, con el archivo
 * ya hecho en el disco.
 *
 * Y el enlace de EAS tampoco sirve como archivo permanente: el artefacto se
 * borra a los 89 días, y el día que se borre el botón "Bajar APK" deja de
 * funcionar sin avisar.
 *
 * `userData` y no una carpeta al lado del ejecutable: es la carpeta de datos
 * del usuario, la única que sobrevive a una reinstalación o a una actualización
 * del panel. Un APK guardado junto al .exe se pierde en la primera.
 */
function carpetaDeInstaladores(): string {
  const carpeta = path.join(app.getPath('userData'), 'instaladores')
  fs.mkdirSync(carpeta, { recursive: true })
  return carpeta
}

/**
 * El puerto del servidor de instaladores.
 *
 * Fijo a propósito: la dirección se publica en la base para que el teléfono la
 * lea, y un puerto que cambia en cada arranque obligaría a republicar y a que
 * el teléfono acierte el momento. 8756 está bien arriba del rango reservado y
 * no lo usa nada común.
 */
const PUERTO_INSTALADORES = 8756

/** Los APK guardados, del más nuevo al más viejo. */
function instaladoresGuardados(): Array<{ archivo: string; tamano: number; fecha: string }> {
  return fs
    .readdirSync(carpetaDeInstaladores())
    .filter((n) => n.toLowerCase().endsWith('.apk'))
    .map((archivo) => {
      const datos = fs.statSync(path.join(carpetaDeInstaladores(), archivo))
      return { archivo, tamano: datos.size, fecha: datos.mtime.toISOString() }
    })
    .sort((a, b) => b.fecha.localeCompare(a.fecha))
}

/**
 * La dirección de esta PC en la red de la oficina.
 *
 * Se busca cada vez y no se guarda: el router la reparte por DHCP y puede
 * cambiar sola. Ya pasó con la impresora —por eso la app la busca en la red
 * antes de rendirse— y no hay motivo para suponer que con la PC no va a pasar.
 *
 * Se descartan las interfaces internas (127.0.0.1) y las de máquinas virtuales
 * y Docker, que existen en cualquier PC de trabajo y no llevan a ningún lado
 * desde un teléfono.
 */
function direccionEnLaRed(): string | null {
  const interfaces = os.networkInterfaces()
  const candidatas: string[] = []

  for (const [nombre, direcciones] of Object.entries(interfaces)) {
    if (/vmware|virtualbox|vethernet|docker|loopback/i.test(nombre)) continue
    for (const d of direcciones ?? []) {
      if (d.family !== 'IPv4' || d.internal) continue
      candidatas.push(d.address)
    }
  }

  // Las privadas primero: son las que un teléfono en el wifi de la oficina
  // puede alcanzar.
  const privada = candidatas.find((ip) => /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip))
  return privada ?? candidatas[0] ?? null
}

/**
 * El servidor que sirve el APK a los teléfonos.
 *
 * Sólo `GET`, sólo archivos `.apk`, y sólo los que están en la carpeta de
 * instaladores: el nombre pedido se compara contra la lista de archivos reales
 * en vez de pegarlo a una ruta, así que no hay forma de salirse de la carpeta
 * pidiendo `../../algo`.
 *
 * Queda abierto a toda la red de la oficina, sin contraseña. Es una decisión,
 * no un descuido: quien está en ese wifi ya puede ver la impresora y todo lo
 * demás, y el APK no lleva nada que un teléfono con la app instalada no tenga.
 * Poner una clave acá obligaría a repartir la clave, que es el problema que
 * esto viene a resolver.
 */
let servidorInstaladores: http.Server | null = null

function paginaDeDescarga(archivos: ReturnType<typeof instaladoresGuardados>): string {
  const filas = archivos
    .map(
      (a) =>
        `<li><a href="/apk/${encodeURIComponent(a.archivo)}">${a.archivo}</a>` +
        ` <small>${(a.tamano / 1_048_576).toFixed(0)} MB</small></li>`,
    )
    .join('')

  // Página mínima y sin nada externo: la abre un teléfono que quizá no tiene
  // datos, sólo el wifi de la oficina.
  return `<!doctype html><html lang="es-AR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>WoodTools · Instalar la app</title>
<style>
 body{font-family:system-ui,sans-serif;margin:0;padding:24px;background:#B30F0F;color:#fff}
 h1{font-size:20px;margin:0 0 4px}p{opacity:.85;margin:0 0 20px;font-size:14px}
 ul{list-style:none;padding:0;margin:0}
 li{background:#fff;border-radius:10px;margin-bottom:12px}
 a{display:block;padding:18px;color:#B30F0F;font-weight:700;text-decoration:none;font-size:17px}
 small{display:block;padding:0 18px 14px;color:#666;font-weight:400}
 .vacio{background:rgba(255,255,255,.15);border-radius:10px;padding:18px}
</style></head><body>
<h1>Instalar WoodTools</h1>
<p>Tocá el archivo y después "Instalar". Si Android pregunta, hay que permitirle
al navegador instalar aplicaciones.</p>
${filas ? `<ul>${filas}</ul>` : '<div class="vacio">Todavía no hay ningún instalador cargado.</div>'}
</body></html>`
}

function arrancarServidorDeInstaladores(): void {
  if (servidorInstaladores) return

  servidorInstaladores = http.createServer((pedido, respuesta) => {
    /**
     * HEAD también, no sólo GET.
     *
     * El gestor de descargas de Android pide primero las cabeceras para saber
     * cuánto pesa el archivo y poder mostrar el progreso. Rechazándole el HEAD
     * la descarga arranca a ciegas o directamente falla, y el vendedor ve un
     * error sin nada que lo explique. Se responde igual que a un GET pero sin
     * cuerpo, que es lo que HEAD significa.
     */
    const soloCabeceras = pedido.method === 'HEAD'
    if (pedido.method !== 'GET' && !soloCabeceras) {
      respuesta.writeHead(405, { Allow: 'GET, HEAD' })
      respuesta.end('Sólo GET')
      return
    }

    const ruta = decodeURIComponent((pedido.url ?? '/').split('?')[0])

    if (ruta === '/' || ruta === '/index.html') {
      const cuerpo = paginaDeDescarga(instaladoresGuardados())
      respuesta.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': String(Buffer.byteLength(cuerpo)),
      })
      respuesta.end(soloCabeceras ? undefined : cuerpo)
      return
    }

    if (ruta.startsWith('/apk/')) {
      const pedido_ = ruta.slice('/apk/'.length)
      // Contra la lista real, no contra una ruta armada: no hay travesía posible.
      const existe = instaladoresGuardados().some((a) => a.archivo === pedido_)
      if (!existe) {
        respuesta.writeHead(404)
        respuesta.end('No está')
        return
      }
      const completa = path.join(carpetaDeInstaladores(), pedido_)
      const datos = fs.statSync(completa)
      respuesta.writeHead(200, {
        'Content-Type': 'application/vnd.android.package-archive',
        'Content-Length': String(datos.size),
        'Content-Disposition': `attachment; filename="${pedido_}"`,
      })
      if (soloCabeceras) {
        respuesta.end()
        return
      }
      fs.createReadStream(completa).pipe(respuesta)
      return
    }

    respuesta.writeHead(404)
    respuesta.end('No está')
  })

  servidorInstaladores.on('error', (e) => {
    console.error('[instaladores] no se pudo abrir el puerto', e)
    servidorInstaladores = null
  })

  // 0.0.0.0 y no localhost: el que tiene que alcanzarlo es un teléfono, no
  // esta misma máquina.
  servidorInstaladores.listen(PUERTO_INSTALADORES, '0.0.0.0')
}

ipcMain.handle('instaladores', () => {
  arrancarServidorDeInstaladores()
  const ip = direccionEnLaRed()
  return {
    archivos: instaladoresGuardados(),
    direccion: ip ? `http://${ip}:${PUERTO_INSTALADORES}` : null,
    carpeta: carpetaDeInstaladores(),
    sirviendo: servidorInstaladores !== null,
  }
})

/**
 * Guardar un APK que ya existe, sin recompilar.
 *
 * Hace falta para el caso de hoy: el APK 1.0.2 ya está compilado en EAS y
 * bajado; obligar a recompilarlo veinte minutos para poder repartirlo sería
 * absurdo.
 */
ipcMain.handle('instalador-agregar', async () => {
  const elegido = await dialog.showOpenDialog({
    title: 'Elegí el APK para repartir a los teléfonos',
    filters: [{ name: 'Instalador de Android', extensions: ['apk'] }],
    properties: ['openFile'],
  })
  if (elegido.canceled || elegido.filePaths.length === 0) return { ok: false, motivo: 'cancelado' }

  const origen = elegido.filePaths[0]
  const destino = path.join(carpetaDeInstaladores(), path.basename(origen))
  await fs.promises.copyFile(origen, destino)
  arrancarServidorDeInstaladores()
  return { ok: true, archivo: path.basename(destino), tamano: fs.statSync(destino).size }
})

ipcMain.handle('instalador-borrar', (_evento, archivo: unknown) => {
  if (typeof archivo !== 'string') return false
  // Igual que al servir: contra la lista real, nunca pegando rutas.
  if (!instaladoresGuardados().some((a) => a.archivo === archivo)) return false
  fs.unlinkSync(path.join(carpetaDeInstaladores(), archivo))
  return true
})

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
        env: {
          ...process.env,
          // ELECTRON_RUN_AS_NODE hace que este mismo ejecutable se comporte
          // como Node a secas. Sin eso, `process.execPath` levantaría otra
          // ventana de Electron en vez de correr el script.
          ELECTRON_RUN_AS_NODE: '1',
          /**
           * La variante tiene que acompañar al canal, y son dos cosas.
           *
           * `--branch` decide a QUIÉN le llega el bundle. `APP_VARIANTE` decide
           * QUÉ dice el bundle de sí mismo: `app.config.ts` la escribe en
           * `extra.variante`, y eso viaja adentro del manifiesto.
           *
           * Faltaba, y el panel empaquetado no la trae en su entorno, así que
           * `app.config.ts` caía a su default `interno` publicara al canal que
           * publicara. Un teléfono de producción que recibía ese bundle quedaba
           * con `extra.variante: 'interno'` escrito encima — y
           * `canalDeEsteTelefono()`, en `apps/movil/src/servicios/actualizacionApk.ts`,
           * lee justamente eso para preguntar por el instalador nuevo. O sea
           * que el botón "Buscar actualizaciones" pasaba a contestar sobre el
           * canal equivocado. Se arregla solo al publicar bien, pero mientras
           * tanto no hay nada que lo delate.
           *
           * El handler de compilar ya la fijaba; éste no. Ahora los dos.
           */
          APP_VARIANTE: canal,
        },
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

/**
 * Compila el APK en esta máquina.
 *
 * Ya NO recibe el token de la sesión ni las claves de Supabase: los recibía
 * para subir el archivo al bucket, y esa subida se sacó porque nunca pudo
 * funcionar con 82 MB. Un token que no se usa no tiene por qué cruzar el
 * puente ni quedar en la memoria del proceso principal.
 */
ipcMain.handle('compilar-apk', async (evento, datos: { canal: string }) => {
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
     * El APK se queda acá, no se sube.
     *
     * Antes esto lo mandaba al bucket `instaladores` de Supabase, y **nunca
     * pudo terminar**: el plan del proyecto rechaza subidas de más de 50 MB y
     * el APK pesa 82. El bucket está vacío desde que existe. O sea que este
     * botón compilaba veinte minutos y fallaba en el último paso, con el
     * archivo ya hecho en el disco, al lado.
     *
     * Ahora se copia a la carpeta de instaladores del panel y se sirve a la red
     * de la oficina, que es donde están los teléfonos que lo necesitan. Sin
     * intermediarios y sin límite de tamaño.
     */
    const tamano = fs.statSync(apk).size
    const version = leerVersionDeLaApp(movil)
    const sello = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')
    const nombre = `woodtools-${canal}-${version}-${sello}.apk`

    avisar('guardando', `Guardando ${(tamano / 1_048_576).toFixed(0)} MB para repartir…`)
    try {
      await fs.promises.copyFile(apk, path.join(carpetaDeInstaladores(), nombre))
      arrancarServidorDeInstaladores()
    } catch (e) {
      return { ok: false, salida: `No se pudo guardar el APK: ${(e as Error).message}` }
    }

    return { ok: true, salida: compilacion.salida, archivo: nombre, tamano, version }
  },
)
