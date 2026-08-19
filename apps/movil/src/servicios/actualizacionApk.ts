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
  /** La dirección del panel, lista para abrir en el navegador. */
  direccion: string
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
 * ¿Hay un APK más nuevo, y se puede llegar hasta él?
 *
 * Devuelve null cuando no hay nada que hacer, y son varios casos distintos que
 * a propósito se tratan igual: no hay versión nueva, la oficina todavía no
 * publicó dónde está el panel, o no se pudo consultar. En los tres el vendedor
 * no puede hacer nada al respecto, así que ofrecerle un botón sería ofrecerle
 * un botón que falla.
 *
 * Lo que NO hace es fallar ruidosamente: esto se consulta como agregado del
 * botón de siempre, y un problema para averiguar si hay un APK nuevo no puede
 * romper la búsqueda de actualizaciones por aire, que es la que sirve casi
 * siempre.
 */
export async function buscarApkNuevo(): Promise<ApkDisponible | null> {
  const actual = versionDeEsteTelefono()

  try {
    const { data: fila } = await supabase
      .from('versiones_app')
      .select('version, notas')
      .eq('canal', canalDeEsteTelefono())
      .order('publicado_en', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!fila?.version) return null
    // Sólo hacia adelante: una versión igual o más vieja no es una actualización.
    if (compararVersiones(actual, fila.version) >= 0) return null

    const { data: cfg } = await supabase
      .from('configuracion')
      .select('valor')
      .eq('clave', 'panel_oficina')
      .maybeSingle()

    const panel = cfg?.valor as PanelEnLaRed | null
    if (!panel?.ip) return null

    return {
      actual,
      nueva: fila.version,
      direccion: `http://${panel.ip}:${panel.puerto ?? 8756}`,
      notas: (fila.notas as string | null) ?? null,
    }
  } catch {
    return null
  }
}
