import { useEffect } from 'react'
import { Alert, AppState, Linking } from 'react-native'

import { usarDescargaApk } from '../nucleo/descargaApk'
import {
  autoActualizarApk,
  buscarApkNuevo,
  debeAutoInstalar,
  type ApkDisponible,
} from './actualizacionApk'

/**
 * Bajar e instalar la última versión SOLO, apenas aparece.
 *
 * ─── Por qué existe ──────────────────────────────────────────────────────────
 *
 * Lo único que preguntaba si había un APK más nuevo era el botón "Buscar
 * actualizaciones", adentro de Configuración. Un vendedor que no entra a esa
 * pantalla —que es lo normal— se quedaba con la app vieja para siempre. Y lo que
 * viaja por aire no tapa el agujero: el teléfono recibe el JavaScript nuevo y
 * sigue con el APK viejo, que es donde van los permisos y las librerías nativas.
 *
 * ─── Qué hace ahora ──────────────────────────────────────────────────────────
 *
 * Al entrar (y al volver del segundo plano) chequea solo si hay una versión más
 * nueva y, si la hay, la baja e instala SIN PREGUNTAR —con wifi O datos móviles—.
 * Es una decisión del dueño: que toda la flota quede al día sin depender de que
 * el vendedor encuentre un wifi. La instalación en sí la confirma Android con un
 * toque "Instalar": eso no se puede saltear.
 */

/**
 * Cada cuánto se vuelve a chequear dentro de una misma corrida.
 *
 * Arrancar la app chequea —esto nace en cero con el proceso—, y ésa es la vía
 * normal. La ventana es para el teléfono que queda semanas sin cerrarse: ahí el
 * arranque no vuelve a pasar nunca y sin esto no se enteraría jamás.
 */
const CADA = 6 * 60 * 60 * 1000

/** Cuándo se chequeó por última vez, en esta corrida de la app. */
let ultimoChequeo = 0

/**
 * Hay un chequeo en curso.
 *
 * Entre que se pregunta y que contesta pasa medio segundo, y en ese rato el
 * arranque y la vuelta del segundo plano pueden dispararse los dos. Sin esto se
 * arrancaban dos descargas pisadas.
 */
let consultando = false

/**
 * Hay una descarga automática en curso.
 *
 * El chequeo libera `consultando` apenas dispara la descarga (no la espera), así
 * que hace falta un freno aparte para que una segunda vuelta no arranque OTRA
 * descarga sobre el mismo archivo mientras la primera todavía baja (dos escrituras
 * al mismo archivo = APK corrupto).
 */
let bajandoEnSilencio = false

/**
 * Ofrecer bajar la app nueva (camino MANUAL: el botón de Configuración / Estado
 * de cuenta). El automático no pregunta; este sí, porque es el vendedor el que
 * fue a buscar la actualización.
 *
 * Desde 1.3.0 baja el APK adentro (con progreso, modal de la raíz) y lanza el
 * instalador; en 1.2.1 y anteriores no está el módulo nativo, así que va por el
 * navegador. La descarga anda con wifi o datos.
 */
export function ofrecerApk(apk: ApkDisponible) {
  Alert.alert(
    `Hay una versión nueva: ${apk.nueva}`,
    `Tenés la ${apk.actual}. Esta actualización cambia cosas que no viajan por ` +
      `aire, así que hay que instalarla.` +
      (apk.desde === 'panel'
        ? '\n\nLa vas a bajar de la PC de la oficina, así que va a ser rápido.'
        : '\n\nSon unos 50 MB.') +
      (apk.notas ? `\n\nQué trae:\n${apk.notas}` : ''),
    [
      { text: 'Ahora no', style: 'cancel' },
      {
        text: 'Bajar e instalar',
        onPress: () => {
          if (debeAutoInstalar(apk)) {
            usarDescargaApk.getState().iniciar(apk)
          } else {
            void Linking.openURL(apk.direccion).catch(() =>
              Alert.alert(
                'No pudimos abrir la página',
                `Probá entrando a mano desde el navegador:\n${apk.direccion}`,
              ),
            )
          }
        },
      },
    ],
  )
}

/**
 * Bajar e instalar la nueva en segundo plano, sin modal y sin preguntar.
 *
 * El trabajo real lo hace `autoActualizarApk` (en actualizacionApk): NO pasa por
 * el store `usarDescargaApk` —ese prende el modal que tapa la pantalla—, así que
 * la descarga que arranca sola no interrumpe al vendedor; baja callada, no
 * re-baja si ya está en cache, y lanza el instalador a lo sumo una vez por día
 * por versión. Acá sólo se evita arrancarla dos veces en paralelo
 * (`bajandoEnSilencio`) y se tragan los errores (sin señal, descarga cortada):
 * se reintenta en el próximo chequeo.
 */
async function autoActualizar(apk: ApkDisponible): Promise<void> {
  if (bajandoEnSilencio) return
  bajandoEnSilencio = true
  try {
    await autoActualizarApk(apk)
  } catch {
    // Sin señal / descarga cortada: se reintenta solo en el próximo chequeo.
  } finally {
    bajandoEnSilencio = false
  }
}

/**
 * Chequear solo, al entrar y al volver del fondo, si hay un APK más nuevo; si lo
 * hay, bajarlo e instalarlo solo (ver `autoActualizar`). Los otros finales de
 * `buscarApkNuevo` —no hay nada, no se pudo consultar, hay pero no se llega— se
 * callan acá y siguen saliendo por el botón de Configuración, que es donde el
 * vendedor preguntó y donde una respuesta larga tiene sentido.
 */
export function usarAvisoDeApkAlEntrar(habilitado: boolean) {
  useEffect(() => {
    // Sin cuenta habilitada no hay nada que mirar: la fila del instalador sólo
    // se lee con el permiso de un usuario aprobado.
    if (!habilitado) return

    let vivo = true

    async function fijarse() {
      if (consultando || Date.now() - ultimoChequeo < CADA) return
      consultando = true
      try {
        ultimoChequeo = Date.now()
        const busqueda = await buscarApkNuevo()
        if (!vivo || busqueda.estado !== 'hay') return
        // Fire-and-forget: no esperamos la descarga para no retener `consultando`
        // (que es sólo el guardia del CHEQUEO); la concurrencia de la DESCARGA la
        // cuida `bajandoEnSilencio` adentro de `autoActualizar`.
        void autoActualizar(busqueda.apk)
      } finally {
        consultando = false
      }
    }

    /**
     * Un respiro antes del primer chequeo: al arrancar todavía se está yendo la
     * pantalla de carga y montándose el menú.
     */
    const reloj = setTimeout(() => void fijarse(), 3_000)

    // Y de nuevo al volver del segundo plano, que en estos teléfonos es la forma
    // habitual de "entrar a la app": casi nunca se la cierra del todo.
    const suscripcion = AppState.addEventListener('change', (siguiente) => {
      if (siguiente === 'active') void fijarse()
    })

    return () => {
      vivo = false
      clearTimeout(reloj)
      suscripcion.remove()
    }
  }, [habilitado])
}
