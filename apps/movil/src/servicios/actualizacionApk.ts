import { compararVersiones } from '@woodtools/compartido'
import Constants from 'expo-constants'

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
 * ─── Por qué se abre el navegador y no se instala solo ───────────────────────
 *
 * Instalar un APK desde adentro de la app pide el permiso
 * `REQUEST_INSTALL_PACKAGES`, que este proyecto decidió no pedir —está anotado
 * en `app.config.ts`: lo prohíbe la política de Google Play para apps que se
 * auto-actualizan y cerraría la puerta a Managed Google Play—. El navegador sí
 * lo tiene. Así que la app lleva al vendedor hasta la puerta y Android hace el
 * resto, que además es donde tiene que estar la decisión de instalar algo.
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
  /** A dónde mandar el navegador. */
  direccion: string
  /** De dónde sale esa dirección, que cambia lo que hay que decirle al vendedor. */
  desde: 'panel' | 'internet'
  notas: string | null
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
      .select('version, notas, url_externa')
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
    const panel = await direccionDelPanel()
    if (panel && (await contesta(panel))) {
      return { estado: 'hay', apk: { actual, nueva, notas, direccion: panel, desde: 'panel' } }
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
