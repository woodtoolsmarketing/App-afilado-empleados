import { useEffect } from 'react'
import { Alert, AppState, Linking } from 'react-native'

import { buscarApkNuevo, type ApkDisponible } from './actualizacionApk'

/**
 * Avisar del instalador nuevo sin que haya que ir a buscarlo.
 *
 * ─── Por qué existe ──────────────────────────────────────────────────────────
 *
 * Hasta acá lo único que preguntaba si había un APK más nuevo era el botón
 * "Buscar actualizaciones", adentro de Configuración. Un vendedor que no entra
 * a esa pantalla —que es lo normal, no hay motivo para entrar— se quedaba con
 * la app vieja para siempre sin que nada se lo dijera. La información estaba en
 * la base, la app sabía cómo leerla, y no la leía nunca.
 *
 * Lo que viaja por aire no tapa este agujero, al revés: como se publica a los
 * dos runtimes para no dejar a nadie afuera, el teléfono atrasado recibe código
 * nuevo y sigue atrasado de APK, ahora sin ningún síntoma. Se pone al día en lo
 * que puede y se queda quieto justo en lo que no.
 *
 * Así que se pregunta sola al entrar. Es la misma consulta del botón; lo único
 * que cambia es quién la dispara.
 */

/**
 * Cada cuánto se vuelve a preguntar dentro de una misma corrida.
 *
 * Arrancar la app siempre pregunta —esto nace en cero con el proceso—, y esa es
 * la vía normal. La ventana es para el teléfono que queda semanas sin cerrarse:
 * ahí el arranque no vuelve a pasar nunca y sin esto no se enteraría jamás.
 */
const CADA = 6 * 60 * 60 * 1000

/** Cuándo se consultó por última vez, en esta corrida de la app. */
let ultimoChequeo = 0

/**
 * Hay una consulta en curso.
 *
 * El guardia va acá y no en el reloj de arriba porque entre que se pregunta y
 * que contesta pasa medio segundo, y en ese rato el arranque y la vuelta del
 * segundo plano pueden dispararse las dos. Sin esto salían dos carteles
 * iguales, uno tapando al otro.
 */
let consultando = false

/**
 * Ofrecer bajar la app nueva.
 *
 * Se abre el navegador y no se instala acá: instalar un APK desde adentro de la
 * app pide un permiso que este proyecto decidió no pedir (está anotado en
 * `actualizacionApk.ts`). El navegador sí lo tiene.
 */
export function ofrecerApk(apk: ApkDisponible) {
  Alert.alert(
    `Hay una versión nueva: ${apk.nueva}`,
    `Tenés la ${apk.actual}. Esta actualización cambia cosas que no viajan por ` +
      `aire, así que hay que instalarla.\n\n` +
      (apk.desde === 'panel'
        ? 'La vas a bajar de la PC de la oficina, así que va a ser rápido.'
        : 'La vas a bajar de internet: con datos móviles puede tardar unos minutos.') +
      (apk.notas ? `\n\nQué trae:\n${apk.notas}` : ''),
    [
      { text: 'Ahora no', style: 'cancel' },
      {
        text: 'Bajar e instalar',
        onPress: () => {
          void Linking.openURL(apk.direccion).catch(() =>
            Alert.alert(
              'No pudimos abrir la página',
              `Probá entrando a mano desde el navegador:\n${apk.direccion}`,
            ),
          )
        },
      },
    ],
  )
}

/**
 * Fijarse solo, al entrar, si hay un instalador más nuevo.
 *
 * Sólo avisa cuando hay algo que el vendedor puede hacer en ese momento. Los
 * otros tres finales —no hay nada, no se pudo consultar, hay pero no se llega—
 * se callan acá y siguen saliendo por el botón de Configuración, que es donde
 * el vendedor preguntó y donde una respuesta larga tiene sentido. Un cartel que
 * aparece solo y no deja nada para hacer se aprende a cerrar sin leer, y el día
 * que diga algo importante tampoco se va a leer.
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
        if (vivo && busqueda.estado === 'hay') ofrecerApk(busqueda.apk)
      } finally {
        consultando = false
      }
    }

    /**
     * Un respiro antes del primer cartel.
     *
     * Al arrancar todavía se está yendo la pantalla de carga y montándose el
     * menú. Un `Alert` ahí encima sale sobre una pantalla a medio dibujar y el
     * vendedor lo cierra por reflejo antes de leer de qué se trata.
     */
    const reloj = setTimeout(() => void fijarse(), 3_000)

    // Y de nuevo al volver del segundo plano, que en estos teléfonos es la
    // forma habitual de "entrar a la app": casi nunca se la cierra del todo.
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
