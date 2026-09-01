import { espaciado, radios } from '@woodtools/compartido'
import { useMemo, useRef, useState } from 'react'
import { PanResponder, Text, View, type LayoutChangeEvent } from 'react-native'

import { hojaDeTema } from '../nucleo/tema'

/**
 * La barra para elegir un valor entre dos extremos.
 *
 * ─── Por qué está escrita a mano ─────────────────────────────────────────────
 *
 * React Native sacó `Slider` del núcleo y el reemplazo oficial
 * (`@react-native-community/slider`) es un módulo NATIVO. Agregar un módulo
 * nativo a este proyecto no cuesta una dependencia: cuesta un APK nuevo
 * instalado a mano en cada teléfono, porque lo que viaja por aire es
 * JavaScript y el bundle que importa un módulo que el APK no tiene revienta al
 * cargar —en TODOS los teléfonos, no sólo en los que iban a usar la barra—.
 *
 * Una barra es un rectángulo, un círculo y una regla de tres. No vale eso.
 *
 * ─── Cómo se toca ───────────────────────────────────────────────────────────
 *
 * Tocar en cualquier punto de la barra salta a ese valor, y arrastrar lo
 * ajusta. Las dos cosas, no una: el que sabe que quiere el 100 % lo toca
 * directo, y el que está buscando el tamaño en el que ve bien arrastra
 * mirando. Arrastrando se va desde donde se toca, no desde donde estaba el
 * círculo, así el dedo no tapa lo que se está mirando.
 */

export function Deslizador({
  valor,
  alCambiar,
  alSoltar,
  minimo = 0,
  maximo = 100,
  paso = 5,
  etiquetaMinimo = '0%',
  etiquetaMaximo = '100%',
  deshabilitado = false,
  accessibilityLabel,
}: {
  valor: number
  /** Se llama mientras se arrastra: la vista previa tiene que ser en vivo. */
  alCambiar: (valor: number) => void
  /** Se llama al levantar el dedo. Es donde conviene guardar. */
  alSoltar?: (valor: number) => void
  minimo?: number
  maximo?: number
  paso?: number
  etiquetaMinimo?: string
  etiquetaMaximo?: string
  deshabilitado?: boolean
  accessibilityLabel?: string
}) {
  const estilos = usarEstilos()
  const [ancho, setAncho] = useState(0)

  /**
   * Lo que hay que recordar entre un toque y el que sigue.
   *
   * Va en un ref y no en estado porque el `PanResponder` se arma una sola vez
   * —si se rearmara en cada dibujado, soltaría el gesto en el medio del
   * arrastre— y por lo tanto sus funciones ven siempre el primer valor de
   * cualquier variable de estado que capturen.
   */
  const vivo = useRef({ ancho: 0, valor, deshabilitado, alCambiar, alSoltar, minimo, maximo, paso })
  vivo.current = { ancho, valor, deshabilitado, alCambiar, alSoltar, minimo, maximo, paso }

  /**
   * La regla, congelada en el momento de apoyar el dedo.
   *
   * ── Por qué congelada ──────────────────────────────────────────────────────
   *
   * Porque esta barra elige el tamaño de la letra de la app, y la app incluye a
   * la barra: sus rótulos "0%" y "100%" se agrandan con lo que la barra está
   * eligiendo, le comen ancho a la pista y le corren el borde izquierdo. Con la
   * regla leída de nuevo en cada movimiento, la misma posición del dedo pasaba a
   * valer un porcentaje más alto que un instante antes, y el círculo se
   * adelantaba al dedo. Midiendo una vez al apoyar, la pista con la que se
   * cuenta es la misma de punta a punta del gesto.
   *
   * (Los rótulos además dejaron de escalar —ver `extremo` en los estilos—, así
   * que la pista ya casi no se mueve. Las dos cosas: una arregla la causa y la
   * otra deja el gesto a salvo de que vuelva a aparecer.)
   *
   * ── `origen` ───────────────────────────────────────────────────────────────
   *
   * Es dónde arranca la barra EN LA PANTALLA. Hace falta porque `locationX` no
   * sirve para el arrastre: es relativo a la vista que hay debajo del dedo, y
   * el dedo se sale de la barra apenas el gesto se hace horizontal.
   */
  const gesto = useRef({ origen: 0, ancho: 0, horizontal: false })

  const respondedor = useMemo(
    () =>
      PanResponder.create({
        /*
         * Apoyar el dedo NO se queda con el gesto todavía.
         *
         * El panel entero es un ScrollView y la barra ocupa todo el ancho: si
         * la barra se quedara con cualquier toque, apoyar el dedo encima para
         * desplazar la pantalla no desplazaría nada y encima cambiaría el
         * tamaño de la letra. Se decide recién cuando el dedo se mueve, y sólo
         * si se mueve más a lo ancho que a lo largo.
         *
         * El toque suelto —tocar un punto de la barra para saltar ahí— se
         * resuelve al soltar, en `onPanResponderRelease`.
         */
        onStartShouldSetPanResponder: () => !vivo.current.deshabilitado,
        onMoveShouldSetPanResponder: (_evento, g) =>
          !vivo.current.deshabilitado && Math.abs(g.dx) > Math.abs(g.dy),

        /*
         * Mientras el gesto no se confirmó horizontal, el ScrollView se lo
         * puede llevar. Una vez confirmado, no: si no, arrastrar en diagonal
         * suelta la barra en la mitad del recorrido.
         */
        onPanResponderTerminationRequest: () => !gesto.current.horizontal,

        onPanResponderGrant: (evento) => {
          const v = vivo.current
          gesto.current = {
            origen: evento.nativeEvent.pageX - evento.nativeEvent.locationX,
            ancho: v.ancho,
            horizontal: false,
          }
        },

        onPanResponderMove: (_evento, g) => {
          const v = vivo.current
          const actual = gesto.current
          if (actual.ancho <= 0) return

          // Cuatro píxeles de margen: menos que eso es el temblor de la mano
          // apoyando el dedo, no una intención de arrastrar.
          if (!actual.horizontal) {
            if (Math.abs(g.dx) <= 4 || Math.abs(g.dy) > Math.abs(g.dx)) return
            actual.horizontal = true
          }

          v.alCambiar(desdeElToque(g.moveX - actual.origen, { ...v, ancho: actual.ancho }))
        },

        onPanResponderRelease: (_evento, g) => {
          const v = vivo.current
          const actual = gesto.current

          // No se arrastró: fue un toque. Salta al punto tocado.
          if (!actual.horizontal && actual.ancho > 0 && Math.abs(g.dx) <= 4 && Math.abs(g.dy) <= 4) {
            // `x0 + dx` y no el evento: al soltar, el evento nativo ya puede no
            // traer la posición, pero el gesto siempre sabe dónde empezó.
            const donde = desdeElToque(g.x0 + g.dx - actual.origen, {
              ...v,
              ancho: actual.ancho,
            })
            v.alCambiar(donde)
            v.alSoltar?.(donde)
            return
          }

          if (actual.horizontal) v.alSoltar?.(vivo.current.valor)
        },

        onPanResponderTerminate: () => {
          const v = vivo.current
          if (gesto.current.horizontal) v.alSoltar?.(v.valor)
        },
      }),
    [],
  )

  function medir(evento: LayoutChangeEvent) {
    setAncho(evento.nativeEvent.layout.width)
  }

  const proporcion = maximo > minimo ? (valor - minimo) / (maximo - minimo) : 0
  const acotada = Math.max(0, Math.min(1, proporcion))

  return (
    <View style={estilos.fila}>
      <Text style={estilos.extremo}>{etiquetaMinimo}</Text>

      <View
        style={estilos.zonaTocable}
        onLayout={medir}
        {...respondedor.panHandlers}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={accessibilityLabel}
        accessibilityValue={{ min: minimo, max: maximo, now: valor }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(evento) => {
          if (deshabilitado) return
          const paso_ = evento.nativeEvent.actionName === 'increment' ? paso : -paso
          const siguiente = Math.max(minimo, Math.min(maximo, valor + paso_))
          alCambiar(siguiente)
          alSoltar?.(siguiente)
        }}
      >
        <View style={[estilos.riel, deshabilitado && estilos.apagado]}>
          <View style={[estilos.relleno, { width: `${acotada * 100}%` }]} />
        </View>

        {/*
          El círculo se posiciona con un margen negativo de su propio radio para
          que en los extremos quede centrado sobre la punta de la barra y no
          medio afuera. `ancho` es cero en el primer dibujado —todavía no se
          midió— y ahí queda en el 0 %, que dura un cuadro.
        */}
        <View
          pointerEvents="none"
          style={[
            estilos.circulo,
            deshabilitado && estilos.apagado,
            { left: acotada * Math.max(0, ancho - DIAMETRO) },
          ]}
        />
      </View>

      <Text style={estilos.extremo}>{etiquetaMaximo}</Text>
    </View>
  )
}

/** El diámetro del círculo. Se usa en la cuenta de la posición y en el estilo. */
const DIAMETRO = 34

interface Regla {
  ancho: number
  minimo: number
  maximo: number
  paso: number
}

/** De dónde se tocó al valor que corresponde, redondeado al paso. */
function desdeElToque(x: number, regla: Regla): number {
  const util = Math.max(1, regla.ancho - DIAMETRO)
  const proporcion = Math.max(0, Math.min(1, (x - DIAMETRO / 2) / util))
  const crudo = regla.minimo + proporcion * (regla.maximo - regla.minimo)
  const escalonado = Math.round(crudo / regla.paso) * regla.paso
  return Math.max(regla.minimo, Math.min(regla.maximo, escalonado))
}

const usarEstilos = hojaDeTema((t) => ({
  fila: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaciado.sm,
  },
  /*
   * Los rótulos "0%" y "100%" NO escalan con el tema.
   *
   * Es el único texto de la app que no lo hace, y es a propósito: esta barra
   * elige el tamaño de la letra, así que si sus propios rótulos crecieran con
   * lo que ella elige, la pista se angostaría mientras el dedo la recorre. El
   * ancho fijo es por lo mismo: "100%" es más ancho que "0%" y sin fijarlo la
   * pista se corre unos píxeles al pasar de un extremo al otro.
   */
  extremo: {
    fontFamily: t.tipografia.familia.fuerte,
    fontSize: 17,
    width: 46,
    textAlign: 'center',
    color: t.colores.tinta,
  },
  /*
   * Alto generoso a propósito: lo que se toca es esto, no la barra. Con la
   * barra pelada de 22 px, el que la usa parado en la calle falla el toque una
   * de cada tres veces.
   */
  zonaTocable: {
    flex: 1,
    height: 52,
    justifyContent: 'center',
  },
  riel: {
    height: 26,
    borderRadius: radios.pastilla,
    backgroundColor: t.colores.campoBlanco,
    borderWidth: 2,
    borderColor: t.colores.borde,
    overflow: 'hidden',
  },
  /*
   * El relleno es el acento de la marca, no la tinta.
   *
   * Con la tinta, en el tema oscuro el riel quedaba casi blanco —es el color
   * de la LETRA, que ahí se da vuelta— y el círculo blanco encima desaparecía:
   * blanco sobre blanco. Encima era lo más brillante de la pantalla, justo en
   * la barra que usa el que eligió el tema oscuro porque le molesta la luz.
   */
  relleno: {
    height: '100%',
    backgroundColor: t.colores.rojo,
  },
  circulo: {
    position: 'absolute',
    width: DIAMETRO,
    height: DIAMETRO,
    borderRadius: DIAMETRO / 2,
    // `campoBlanco` y no `blanco`: contra el relleno se tiene que recortar en
    // los dos temas, y el blanco puro es el mismo en los dos.
    backgroundColor: t.colores.campoBlanco,
    borderWidth: 2.5,
    borderColor: t.colores.borde,
  },
  apagado: { opacity: 0.45 },
}))
