import AsyncStorage from '@react-native-async-storage/async-storage'
import { compararVersiones } from '@woodtools/compartido'
import Constants from 'expo-constants'
import * as FileSystem from 'expo-file-system'

import { supabase } from '../nucleo/supabase'

/**
 * Buscar una versión nueva de la APP EN SÍ, no del código que viaja por aire.
 *
 * ─── Por qué hacen falta las dos cosas ───────────────────────────────────────
 *
 * "Buscar actualizaciones" hasta ahora sólo preguntaba por EAS Update, que trae
 * JavaScript y nada más. Alcanza para el 90 % de los cambios, pero no para un
 * permiso nuevo, una librería nativa o una versión de Android distinta: eso
 * viaja adentro del APK y no hay forma de que viaje por aire.
 *
 * Cuando lo que cambió es nativo, el vendedor tocaba el botón, la app le decía
 * "estás usando la última versión" —y era cierto para lo que ese botón miraba—
 * y se quedaba con la app vieja sin enterarse. Eso pasó: los teléfonos que
 * siguen en 1.0.0 no recibieron nunca nada, porque `runtimeVersion` sigue a la
 * versión y un APK 1.0.0 no escucha lo publicado para 1.0.2.
 *
 * ─── Por qué el instalador sale del panel de la oficina ──────────────────────
 *
 * Porque no hay otro lado. El APK pesa 82 MB y Supabase rechaza subidas de más
 * de 50; el enlace de EAS caduca a los 89 días. El panel lo guarda y lo sirve
 * en la misma red a la que estos teléfonos ya le hablan para imprimir.
 *
 * ─── Cómo se baja e instala ──────────────────────────────────────────────────
 *
 * La app baja el APK adentro y lanza el instalador de Android directo
 * (`descargarEInstalarApk`), sin mandar al vendedor al navegador. Baja con lo que
 * haya —wifi O datos móviles— (decisión del dueño: que la flota quede al día sin
 * depender de encontrar un wifi). Para que eso NO cueste datos de más, la bajada
 * es atómica y con cache: se baja a un `.part`, se valida (status 200 + que pese
 * como un APK real) y recién ahí se renombra al nombre final; si el APK ya está
 * en cache no se vuelve a bajar. Necesita el permiso `REQUEST_INSTALL_PACKAGES`
 * (ver `app.config.ts`), así que es un cambio NATIVO: sólo anda en un APK
 * compilado con ese permiso. Android igual pide UN toque "Instalar" y, la primera
 * vez, permitir "instalar apps de esta fuente": eso no se saltea sin privilegios
 * de sistema.
 */

/** Dónde está el panel de la oficina, tal como él mismo lo publica. */
interface PanelEnLaRed {
  ip: string
  puerto: number
}

export interface ApkDisponible {
  /** La que está instalada en este teléfono. */
  actual: string
  /** La que hay para bajar. */
  nueva: string
  /** De dónde bajar el APK. */
  direccion: string
  /** De dónde sale esa dirección, que cambia lo que hay que decirle al vendedor. */
  desde: 'panel' | 'internet'
  notas: string | null
}

/**
 * Piso de tamaño para dar por bueno un APK bajado.
 *
 * Es el ÚNICO chequeo de validez por tamaño, y es a propósito: un APK de esta app
 * pesa decenas de MB, mientras que un cuerpo de error (un 403 de un enlace de EAS
 * vencido, un HTML) pesa unos KB, así que 5 MB de piso deja pasar el APK y frena
 * el error. NO se compara contra `versiones_app.tamano_bytes`: esa columna se
 * carga a mano y suele faltar o quedar con el número de la versión anterior; atar
 * la validación a ella hacía que, ante un número mal, la app re-bajara el APK
 * entero en cada chequeo sin instalar nunca (dren de datos silencioso). El sello
 * final de validez lo pone igual Android al instalar (firma + parseo del paquete).
 */
const APK_MINIMO_BYTES = 5_000_000

/** Dónde se guarda el APK bajado (cache): un archivo por versión. */
function archivoApk(version: string): string {
  return `${FileSystem.cacheDirectory}woodtools-actualizacion-${version}.apk`
}

/** El archivo a medio bajar, antes de renombrarlo al nombre final. */
function archivoParcial(version: string): string {
  return `${archivoApk(version)}.part`
}

/**
 * ¿El APK de esta versión ya está bajado y completo?
 *
 * El nombre FINAL sólo existe tras una descarga validada y renombrada (ver
 * `bajarApk`): un `.part` a medio bajar NUNCA llega a ese nombre. Por eso la sola
 * existencia del archivo final, con un tamaño de APK real (supera el piso), ya
 * dice "completo" — sin depender de `versiones_app.tamano_bytes`.
 */
async function apkYaDescargado(apk: ApkDisponible): Promise<boolean> {
  try {
    const info = await FileSystem.getInfoAsync(archivoApk(apk.nueva))
    return info.exists && !info.isDirectory && info.size > APK_MINIMO_BYTES
  } catch {
    return false
  }
}

/** Borra los APK bajados de OTRAS versiones (y sus parciales), para no llenar el cache. */
async function limpiarApksViejos(versionAMantener: string): Promise<void> {
  try {
    const dir = FileSystem.cacheDirectory
    if (!dir) return
    const finalActual = `woodtools-actualizacion-${versionAMantener}.apk`
    const parcialActual = `${finalActual}.part`
    const archivos = await FileSystem.readDirectoryAsync(dir)
    await Promise.all(
      archivos
        .filter(
          (n) =>
            n.startsWith('woodtools-actualizacion') && n !== finalActual && n !== parcialActual,
        )
        .map((n) => FileSystem.deleteAsync(dir + n, { idempotent: true }).catch(() => undefined)),
    )
  } catch {
    // Mejor esfuerzo: si no se puede limpiar, lo peor es un archivo viejo de más.
  }
}

/**
 * Lanza el instalador de Android sobre un APK ya bajado.
 *
 * El instalador no puede leer un `file://` de otra app: hace falta un `content://`
 * (lo da el FileProvider de expo-file-system) con permiso de lectura
 * (FLAG_GRANT_READ_URI_PERMISSION). Android igual pide UN toque "Instalar" y, la
 * primera vez, permitir "instalar apps de esta fuente": eso no se saltea.
 *
 * Si ya hay un instalador abierto, expo-intent-launcher rechaza el segundo
 * llamado (un único `pendingPromise` nativo): por eso dos vías que resuelven
 * juntas no abren dos pantallas de instalación.
 */
async function lanzarInstalador(destino: string): Promise<void> {
  const contentUri = await FileSystem.getContentUriAsync(destino)
  // Import LAZY: expo-intent-launcher es nativo y sólo existe desde el APK 1.3.0.
  const IntentLauncher = await import('expo-intent-launcher')
  try {
    await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
      data: contentUri,
      type: 'application/vnd.android.package-archive',
      flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
    })
  } catch (e) {
    // Si YA hay un instalador abierto, expo-intent-launcher rechaza el 2º llamado
    // (tiene un único `pendingPromise` nativo) con E_ACTIVITY_ALREADY_STARTED. Eso
    // NO es un fallo: el instalador ya está en pantalla. Cuando la vía automática y
    // la manual resuelven juntas sobre la misma descarga, las dos llegan acá; tragar
    // ese rechazo evita que el modal manual diga "No se pudo actualizar" sobre una
    // instalación que sí abrió, y que la automática se saltee su throttle por un throw.
    const err = e as { code?: string; message?: string }
    const yaAbierto =
      err?.code === 'E_ACTIVITY_ALREADY_STARTED' ||
      /ActivityAlreadyStarted/i.test(err?.message ?? '')
    if (!yaAbierto) throw e
  }
}

/**
 * ¿Este teléfono puede bajar e instalar el APK solo?
 *
 * Sólo desde 1.3.0, que es el APK que trae el permiso `REQUEST_INSTALL_PACKAGES`
 * y el módulo `expo-intent-launcher`. En 1.2.1 y anteriores no están, así que la
 * actualización sigue yendo por el navegador (lo decide `ofrecerApk`). `apk.actual`
 * es la versión NATIVA instalada, no el JS que viaja por aire.
 */
export function debeAutoInstalar(apk: ApkDisponible): boolean {
  return compararVersiones(apk.actual, '1.3.0') >= 0
}

/**
 * Un solo candado para TODA descarga: la automática y la del botón manual pasan
 * por acá, así que nunca escriben el mismo archivo al mismo tiempo.
 *
 * Antes cada vía tenía su propio candado —`bajandoEnSilencio` la automática, el
 * estado del store la manual— y ninguno veía al otro: con la automática bajando
 * en silencio, el botón manual arrancaba una SEGUNDA descarga sobre el mismo
 * archivo (lo borraba y lo re-bajaba) y lo dejaba corrupto. Coalescer en una sola
 * promesa cierra esa carrera: el segundo que llega espera la MISMA descarga.
 *
 * Como el segundo que engancha puede traer su propia barra de progreso (el modal
 * manual), el progreso se reparte a TODOS los interesados (`suscriptoresProgreso`)
 * y no sólo al primero: si no, el modal del que llega tarde se quedaba clavado en
 * 0 % toda la descarga aunque por abajo estuviera avanzando.
 */
let descargaEnCurso: Promise<string> | null = null
const suscriptoresProgreso = new Set<(fraccion: number) => void>()
let progresoActual = 0

/**
 * Baja el APK a un `.part`, lo valida y lo renombra al nombre final. Devuelve la
 * ruta final. No instala nada. Si ya está en cache, no baja: devuelve la ruta.
 */
async function bajarApk(
  apk: ApkDisponible,
  alAvanzar: (fraccion: number) => void,
): Promise<string> {
  const destino = archivoApk(apk.nueva)

  if (await apkYaDescargado(apk)) {
    alAvanzar(1)
    return destino
  }

  await limpiarApksViejos(apk.nueva)

  const parcial = archivoParcial(apk.nueva)
  // Un parcial de un intento cortado se descarta: empezamos limpio.
  await FileSystem.deleteAsync(parcial, { idempotent: true }).catch(() => undefined)

  const descarga = FileSystem.createDownloadResumable(apk.direccion, parcial, {}, (p) => {
    if (p.totalBytesExpectedToWrite > 0) {
      alAvanzar(p.totalBytesWritten / p.totalBytesExpectedToWrite)
    }
  })

  let resultado: FileSystem.FileSystemDownloadResult | undefined
  try {
    resultado = await descarga.downloadAsync()
  } catch (e) {
    await FileSystem.deleteAsync(parcial, { idempotent: true }).catch(() => undefined)
    throw e
  }

  // `downloadAsync` NO rechaza ante 4xx/5xx: resuelve con un uri y escribe el
  // cuerpo de error al archivo. Sin mirar el status, instalaríamos esa "página de
  // error" (p. ej. un 403 de un enlace de EAS vencido) una y otra vez.
  if (!resultado?.uri || resultado.status !== 200) {
    await FileSystem.deleteAsync(parcial, { idempotent: true }).catch(() => undefined)
    throw new Error(`No se pudo bajar el instalador (respuesta ${resultado?.status ?? 'sin conexión'}).`)
  }

  const info = await FileSystem.getInfoAsync(parcial)
  const pesaComoApk = info.exists && !info.isDirectory && info.size > APK_MINIMO_BYTES
  if (!pesaComoApk) {
    await FileSystem.deleteAsync(parcial, { idempotent: true }).catch(() => undefined)
    throw new Error('Lo que se bajó no parece un instalador (demasiado chico).')
  }

  // Recién con la descarga completa y validada se la "publica" al nombre final,
  // con un rename atómico. Así `apkYaDescargado` nunca ve un archivo a medias.
  await FileSystem.deleteAsync(destino, { idempotent: true }).catch(() => undefined)
  await FileSystem.moveAsync({ from: parcial, to: destino })
  return destino
}

/**
 * Asegura que el APK esté bajado (coalescido: una sola descarga a la vez, la
 * compartan la vía automática y la manual). Devuelve la ruta al archivo final.
 * `alAvanzar` (opcional) se suscribe al progreso de la descarga en curso.
 */
function asegurarApkBajado(
  apk: ApkDisponible,
  alAvanzar?: (fraccion: number) => void,
): Promise<string> {
  if (alAvanzar) {
    suscriptoresProgreso.add(alAvanzar)
    // Ponerlo al día con lo que ya se bajó, para que no arranque en 0 si engancha
    // tarde sobre una descarga ya avanzada.
    alAvanzar(progresoActual)
  }
  if (descargaEnCurso) return descargaEnCurso
  progresoActual = 0
  descargaEnCurso = bajarApk(apk, (fraccion) => {
    progresoActual = fraccion
    suscriptoresProgreso.forEach((cb) => cb(fraccion))
  }).finally(() => {
    descargaEnCurso = null
    progresoActual = 0
    suscriptoresProgreso.clear()
  })
  return descargaEnCurso
}

/**
 * MANUAL: baja (si hace falta) e instala. El vendedor fue a buscarla a mano, así
 * que SIEMPRE se lanza el instalador. `alAvanzar` mueve la barra del modal.
 */
export async function descargarEInstalarApk(
  apk: ApkDisponible,
  alAvanzar?: (fraccion: number) => void,
): Promise<void> {
  const destino = await asegurarApkBajado(apk, alAvanzar)
  // Si justo coalescimos sobre una descarga de OTRA versión (la oficina publicó
  // una más nueva mientras bajaba la anterior), no instalamos la que no
  // corresponde: el próximo chequeo baja la versión que se ofreció en pantalla.
  if (destino !== archivoApk(apk.nueva)) {
    throw new Error('Se está bajando otra versión. Probá de nuevo en un momento.')
  }
  await lanzarInstalador(destino)
}

// ─── Throttle del instalador automático ──────────────────────────────────────
//
// El chequeo automático corre en cada arranque (`ultimoChequeo` nace en 0 con el
// proceso). Sin memoria, el instalador de Android reaparecería a pantalla
// completa en CADA arranque mientras el vendedor posterga "Instalar". Se recuerda
// en disco la última vez que se ofreció esta versión y no se vuelve a lanzar solo
// hasta pasada una ventana: un recordatorio por día, no en cada apertura. El
// botón manual no usa este freno (ahí el vendedor lo pidió).

const CLAVE_INSTALADOR_OFRECIDO = 'woodtools.apk.instalador_ofrecido'
const VENTANA_INSTALADOR_MS = 24 * 60 * 60 * 1000

async function instaladorOfrecidoReciente(version: string): Promise<boolean> {
  try {
    const crudo = await AsyncStorage.getItem(CLAVE_INSTALADOR_OFRECIDO)
    if (!crudo) return false
    const dato = JSON.parse(crudo) as { version?: string; ts?: number }
    return (
      dato.version === version &&
      typeof dato.ts === 'number' &&
      Date.now() - dato.ts < VENTANA_INSTALADOR_MS
    )
  } catch {
    return false
  }
}

async function marcarInstaladorOfrecido(version: string): Promise<void> {
  try {
    await AsyncStorage.setItem(CLAVE_INSTALADOR_OFRECIDO, JSON.stringify({ version, ts: Date.now() }))
  } catch {
    // Si no se puede guardar, lo peor es un recordatorio de más: no es grave.
  }
}

/**
 * AUTO: baja sola (callada, sin modal) y lanza el instalador —pero no más de una
 * vez por día por versión, para no reaparecer en cada arranque—. Best-effort: la
 * llama `autoActualizar` de `avisoDeApk`, que ya traga los errores.
 */
export async function autoActualizarApk(apk: ApkDisponible): Promise<void> {
  // En un build que trae ESTE código la versión instalada es >= 1.3.0, así que el
  // auto-install anda; el guardia es por si alguna vez corre en uno más viejo.
  if (!debeAutoInstalar(apk)) return
  const destino = await asegurarApkBajado(apk)
  // Coalescimos sobre otra versión (se publicó una nueva mientras bajaba): no es la
  // ofrecida, la deja para el próximo chequeo.
  if (destino !== archivoApk(apk.nueva)) return
  if (await instaladorOfrecidoReciente(apk.nueva)) return
  await lanzarInstalador(destino)
  await marcarInstaladorOfrecido(apk.nueva)
}

/** El canal con el que se compiló este APK: `interno`, `beta` o `produccion`. */
function canalDeEsteTelefono(): string {
  const variante = Constants.expoConfig?.extra?.variante
  return typeof variante === 'string' && variante ? variante : 'interno'
}

function versionDeEsteTelefono(): string {
  return Constants.expoConfig?.version ?? '0.0.0'
}

/**
 * Qué se averiguó sobre el instalador, que no es lo mismo que "hay o no hay".
 *
 * Antes esto era un `ApkDisponible | null`, y ese `null` significaba cinco
 * cosas a la vez: no hay nada nuevo, hay pero no se llega, la oficina nunca
 * publicó, la consulta falló, o el teléfono está sin señal. La pantalla las
 * mostraba todas como "Estás usando la última versión", que es verdad en una
 * sola de las cinco. Es exactamente el modo de fallar que este archivo dice
 * querer evitar más arriba: el vendedor se queda con la app vieja convencido
 * de que está al día.
 */
export type BusquedaDeApk =
  /** Hay una versión más nueva y hay de dónde bajarla. */
  | { estado: 'hay'; apk: ApkDisponible }
  /**
   * Hay una versión más nueva pero no se llega hasta ella: el panel de la
   * oficina no contesta y la fila no trae un enlace de internet. No se puede
   * ofrecer un botón, pero la noticia se da igual — el vendedor tiene que
   * poder enterarse de que está atrasado aunque hoy no pueda hacer nada.
   */
  | { estado: 'sin-donde-bajarlo'; actual: string; nueva: string; notas: string | null }
  /** Se consultó y no hay nada más nuevo que lo que tiene puesto. */
  | { estado: 'al-dia'; actual: string }
  /** No se pudo consultar. Distinto de "no hay": acá no sabemos. */
  | { estado: 'no-se-pudo'; actual: string; motivo: string }

/**
 * ¿Hay un APK más nuevo, y se puede llegar hasta él?
 *
 * Lo que NO hace es fallar ruidosamente: esto se consulta como agregado del
 * botón de siempre, y un problema para averiguar si hay un APK nuevo no puede
 * romper la búsqueda de actualizaciones por aire. Pero tampoco se lo traga:
 * el problema vuelve como `no-se-pudo` para que la pantalla diga la verdad.
 */
export async function buscarApkNuevo(): Promise<BusquedaDeApk> {
  const actual = versionDeEsteTelefono()

  try {
    const { data: fila, error } = await supabase
      .from('versiones_app')
      .select('version, notas, url_externa, archivo')
      .eq('canal', canalDeEsteTelefono())
      .order('publicado_en', { ascending: false })
      .limit(1)
      .maybeSingle()

    // supabase-js no tira: los problemas vuelven acá adentro. Sin mirar esto,
    // una consulta que se cayó se lee igual que una que contestó "no hay nada".
    if (error) return { estado: 'no-se-pudo', actual, motivo: error.message }

    // Sin fila no hay nada publicado para este canal todavía.
    if (!fila?.version) return { estado: 'al-dia', actual }
    // Sólo hacia adelante: una versión igual o más vieja no es una actualización.
    if (compararVersiones(actual, fila.version) >= 0) return { estado: 'al-dia', actual }

    const nueva = fila.version
    const notas = (fila.notas as string | null) ?? null

    /**
     * El panel de la oficina primero, y el enlace de internet de respaldo.
     *
     * El panel gana cuando se lo alcanza: el archivo está a un salto por la red
     * local, baja en segundos y no caduca nunca. Pero vive en una dirección
     * privada, así que desde la calle no existe — y el vendedor que quiere
     * actualizar un martes a la mañana en un galpón no tiene por qué esperar a
     * pasar por la oficina.
     *
     * Por eso, si el panel no contesta, se usa el enlace de afuera que quedó
     * anotado en la fila. Ese sí funciona con datos móviles.
     */
    const panelOrigin = await direccionDelPanel()
    const archivo = (fila.archivo as string | null) ?? null
    // La URL del APK en el panel es /apk/<archivo>: la raíz (http://IP:puerto/)
    // devuelve la PÁGINA de descarga en HTML, no el instalador. Pedir la raíz era
    // el bug por el que la actualización por wifi fallaba —se bajaba el HTML y
    // Android no lo podía instalar ("problema al analizar el paquete")—. HEADear
    // el /apk/<archivo> real también evita el falso positivo del wifi de la casa:
    // otro aparato en 192.168.1.x no sirve ESE archivo, así que da 404 y se cae al
    // enlace de internet.
    const panelApk =
      panelOrigin && archivo ? `${panelOrigin}/apk/${encodeURIComponent(archivo)}` : null
    if (panelApk && (await contesta(panelApk))) {
      return { estado: 'hay', apk: { actual, nueva, notas, direccion: panelApk, desde: 'panel' } }
    }

    const externa = fila.url_externa as string | null
    if (externa && /^https?:\/\//.test(externa)) {
      return { estado: 'hay', apk: { actual, nueva, notas, direccion: externa, desde: 'internet' } }
    }

    // Hay versión nueva pero no hay de dónde bajarla. Ofrecer un botón que no
    // lleva a ningún lado sigue siendo peor que no ofrecer nada — pero callarse
    // la noticia entera es peor todavía.
    return { estado: 'sin-donde-bajarlo', actual, nueva, notas }
  } catch (e) {
    return { estado: 'no-se-pudo', actual, motivo: (e as Error)?.message ?? 'error desconocido' }
  }
}

/** La dirección del panel, tal como él mismo la publica. */
async function direccionDelPanel(): Promise<string | null> {
  const { data } = await supabase
    .from('configuracion')
    .select('valor')
    .eq('clave', 'panel_oficina')
    .maybeSingle()

  const panel = data?.valor as PanelEnLaRed | null
  return panel?.ip ? `http://${panel.ip}:${panel.puerto ?? 8756}` : null
}

/**
 * ¿Se llega al panel desde acá?
 *
 * Con un límite corto a propósito. La dirección es privada: desde afuera de la
 * oficina no falla rápido, se queda esperando hasta que el sistema se rinde, y
 * son varios segundos con el vendedor mirando un botón que no responde. Dos
 * segundos alcanzan de sobra en la red local y no se notan.
 *
 * Se mira `ok` y no sólo que haya llegado algo. `fetch` sólo tira cuando no
 * hubo respuesta: un 404 o un 401 llegan como respuesta válida. Y la dirección
 * es una IP privada de las comunes —192.168.1.x—, así que en la red de la casa
 * del vendedor ese número puede ser cualquier otro aparato, que contesta
 * cualquier cosa. Sin mirar `ok`, la app lo daba por el panel y mandaba el
 * navegador ahí en vez de usar el enlace de internet, que sí funciona.
 */
async function contesta(direccion: string): Promise<boolean> {
  const corte = new AbortController()
  const reloj = setTimeout(() => corte.abort(), 2000)
  try {
    const respuesta = await fetch(direccion, { method: 'HEAD', signal: corte.signal })
    return respuesta.ok
  } catch {
    return false
  } finally {
    clearTimeout(reloj)
  }
}
