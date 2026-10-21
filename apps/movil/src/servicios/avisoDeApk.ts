import { useEffect } from 'react'
import { Alert, AppState, Linking } from 'react-native'

import { usarDescargaApk } from '../nucleo/descargaApk'
import { buscarApkNuevo, debeAutoInstalar, type ApkDisponible } from './actualizacionApk'
import { estadoDeRed } from './ipp'

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
 * Ya se avisó "hay una nueva, te falta el wifi" en esta corrida.
 *
 * El aviso sin wifi no deja nada para hacer en el momento —sólo conectarse a un
 * wifi—, así que se muestra UNA vez por corrida y no en cada vuelta del fondo:
 * un cartel sin acción, repetido, se aprende a cerrar sin leer. El de siempre
 * (con botón, en wifi) no usa este freno: ese sí se puede accionar.
 */
let avisadoSinWifi = false

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
        : 'La vas a bajar de internet por wifi.') +
      (apk.notas ? `\n\nQué trae:\n${apk.notas}` : ''),
    [
      { text: 'Ahora no', style: 'cancel' },
      {
        text: 'Bajar e instalar',
        // Desde 1.3.0 baja el APK adentro (con progreso, modal de la raíz) y lanza
        // el instalador. En 1.2.1 y anteriores no está el módulo nativo, así que
        // sigue por el navegador —y esa es la última vez a mano: el 1.3.0 ya trae
        // el auto-install—.
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
 * Avisar que hay una versión nueva cuando NO hay wifi para bajarla.
 *
 * Es sólo noticia, sin botón de bajar: el APK pesa ~50 MB y no se baja por datos
 * móviles (ver `descargarEInstalarApk`), así que lo único que se puede hacer es
 * conectarse a un wifi. Sin esto, el vendedor que trabaja todo el día con datos
 * móviles nunca se entera de que está atrasado —el aviso con botón sólo sale en
 * wifi—, que es el mismo agujero que este archivo nació para tapar, sólo que del
 * lado de la calle.
 */
export function avisarVersionNuevaSinWifi(nueva: string, actual: string) {
  Alert.alert(
    `Hay una versión nueva: ${nueva}`,
    `Tenés la ${actual}. Conectate a un wifi y la app te la ofrece sola para ` +
      `bajarla: son unos 50 MB, por eso no se baja con datos móviles.`,
    [{ text: 'Entendido' }],
  )
}

/**
 * Fijarse solo, al entrar, si hay un instalador más nuevo.
 *
 * Cuando hay uno (`estado: 'hay'`): en wifi sale el aviso con botón para bajarlo
 * (`ofrecerApk`); con datos móviles sale un aviso sólo-noticia —una vez por
 * corrida— diciendo que se conecte a un wifi (`avisarVersionNuevaSinWifi`),
 * porque un vendedor que trabaja siempre con datos nunca entraría al wifi a
 * enterarse. Los otros tres finales —no hay nada, no se pudo consultar, hay pero
 * no se llega— se callan acá y siguen saliendo por el botón de Configuración,
 * que es donde el vendedor preguntó y donde una respuesta larga tiene sentido.
 * Un cartel que aparece solo y no deja nada para hacer se aprende a cerrar sin
 * leer, por eso el de datos móviles es una sola vez y manda a una acción
 * concreta (conectarse a un wifi).
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
        const red = await estadoDeRed()
        if (!vivo || busqueda.estado !== 'hay') return
        if (red.enWifi) {
          // Con wifi, el aviso de siempre: con botón, baja e instala (gratis de
          // la PC en la oficina, o de internet en otro wifi).
          ofrecerApk(busqueda.apk)
        } else if (!avisadoSinWifi) {
          // Sin wifi NO se baja (son ~50 MB, no se gastan datos móviles), pero sí
          // se avisa —una sola vez por corrida— que está atrasado, así se conecta
          // a un wifi cuando pueda en vez de quedarse con la app vieja sin
          // enterarse. Ver `avisarVersionNuevaSinWifi`.
          avisadoSinWifi = true
          avisarVersionNuevaSinWifi(busqueda.apk.nueva, busqueda.apk.actual)
        }
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
