import { espaciado, radios, sombras } from '@woodtools/compartido'
import { formatearFechaCorta } from '@woodtools/compartido'
import { useEffect, useRef, type ReactNode } from 'react'
import {
  Keyboard,
  Pressable,
  ScrollView,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { hojaDeTema } from '../nucleo/tema'

/**
 * Estructura visual común a todas las pantallas: fondo rojo de la marca y, por
 * encima, el panel gris con borde negro marcado de los mockups.
 */

export function Pantalla({
  children,
  style,
}: {
  children: ReactNode
  style?: StyleProp<ViewStyle>
}) {
  const estilos = usarEstilos()
  const insets = useSafeAreaInsets()
  return (
    <View
      style={[
        estilos.fondo,
        { paddingTop: insets.top, paddingBottom: insets.bottom },
        style,
      ]}
    >
      {children}
    </View>
  )
}

export function Panel({
  children,
  desplazable = true,
  style,
  contentStyle,
  subirAlTopeCuando,
}: {
  children: ReactNode
  desplazable?: boolean
  style?: StyleProp<ViewStyle>
  contentStyle?: StyleProp<ViewStyle>
  /**
   * Cada vez que este valor cambia, el panel vuelve arriba de todo.
   *
   * ─── De dónde salió ───────────────────────────────────────────────────
   *
   * Casi todas las pantallas cambian de contenido cambiando de `Panel`, y ahí
   * el ScrollView es otro y arranca arriba de casualidad. La nota de pedido es
   * la excepción: deja el mismo `Panel` montado y le intercambia los hijos
   * según el paso. Como el ScrollView sobrevive, sobrevive también dónde
   * estaba parado — y el botón CONTINUAR está al pie, así que el vendedor
   * tocaba y se quedaba mirando el final de un formulario que ni sabía que
   * había cambiado.
   *
   * ─── Por qué acá adentro y no un ref hacia afuera ─────────────────────
   *
   * El ScrollView es de este componente. Si cada pantalla tuviera que pedirlo
   * y acordarse de moverlo, la que se olvide vuelve a tener el problema y no
   * se entera nadie hasta que lo reporta el que está en la calle. Además, la
   * nota de pedido cambia de paso en cuatro lugares distintos —el CONTINUAR,
   * el "Atrás", y dos rescates al intentar guardar— y así los cubre a los
   * cuatro con una sola línea.
   *
   * Se pide un valor simple a propósito: con un objeto o un arreglo, cada
   * dibujado trae una referencia nueva y el panel saltaría al tope todo el
   * tiempo, incluso mientras el vendedor está leyendo.
   */
  subirAlTopeCuando?: string | number | boolean | null
}) {
  const estilos = usarEstilos()
  // Los hooks van antes del atajo de `desplazable`: si quedaran después,
  // cambiar esa prop en caliente cambiaría cuántos hooks tiene el componente y
  // React se queja.
  const scroll = useRef<ScrollView>(null)
  const yaSeDibujo = useRef(false)

  useEffect(() => {
    // En el primer dibujado no hay nada que subir —el panel ya está arriba— y
    // cerrarle el teclado al vendedor apenas entra sería gratuito.
    if (!yaSeDibujo.current) {
      yaSeDibujo.current = true
      return
    }

    // Si venía escribiendo en el último campo, el teclado sigue abierto sobre
    // una página que ya no es la suya: le tapa media pantalla nueva.
    Keyboard.dismiss()

    // Sin animación. Lo que cambió no es la posición dentro de la misma hoja,
    // es la hoja entera: animar el desplazamiento haría parecer que la página
    // nueva se mueve sola. El salto seco se lee como "esto es otra cosa,
    // empezá de arriba".
    scroll.current?.scrollTo({ y: 0, animated: false })
  }, [subirAlTopeCuando])

  if (!desplazable) {
    return <View style={[estilos.panel, style, contentStyle]}>{children}</View>
  }

  return (
    <View style={[estilos.panel, style]}>
      <ScrollView
        ref={scroll}
        contentContainerStyle={[estilos.panelContenido, contentStyle]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {children}
      </ScrollView>
    </View>
  )
}

/**
 * Barra superior del panel: "< Atras" a la izquierda, fecha a la derecha.
 * `alVolver` opcional — el menú principal no muestra el botón de volver.
 */
export function BarraPanel({
  alVolver,
  fecha = new Date(),
  titulo,
}: {
  alVolver?: () => void
  fecha?: Date
  titulo?: string
}) {
  const estilos = usarEstilos()
  return (
    <View style={estilos.barra}>
      {alVolver ? (
        <Pressable
          onPress={alVolver}
          hitSlop={16}
          accessibilityRole="button"
          accessibilityLabel="Volver"
          style={({ pressed }) => [estilos.volver, pressed && estilos.presionado]}
        >
          <Text style={estilos.volverTexto}>‹ Atrás</Text>
        </Pressable>
      ) : (
        <View />
      )}

      {titulo ? <Text style={estilos.barraTitulo}>{titulo}</Text> : null}

      <Text style={estilos.fecha}>{formatearFechaCorta(fecha)}</Text>
    </View>
  )
}

/** Título grande en mayúsculas, como "TUS VISITAS DE HOY SON: 13". */
export function TituloPanel({
  children,
  destacado,
  style,
}: {
  children: ReactNode
  /** Se pinta en rojo, como el "13" del mockup. */
  destacado?: ReactNode
  style?: StyleProp<TextStyle>
}) {
  const estilos = usarEstilos()
  return (
    <Text style={[estilos.titulo, style]}>
      {children}
      {destacado !== undefined ? <Text style={estilos.tituloDestacado}> {destacado}</Text> : null}
    </Text>
  )
}

export function Separador({ alto = espaciado.base }: { alto?: number }) {
  return <View style={{ height: alto }} />
}

const usarEstilos = hojaDeTema((t) => ({
  fondo: {
    flex: 1,
    backgroundColor: t.colores.fondo,
  },
  panel: {
    flex: 1,
    backgroundColor: t.colores.panel,
    borderWidth: 2.5,
    borderColor: t.colores.borde,
    borderRadius: radios.sm,
    marginHorizontal: espaciado.md,
    marginBottom: espaciado.md,
    overflow: 'hidden',
    ...sombras.panel,
  },
  panelContenido: {
    paddingHorizontal: espaciado.base,
    paddingTop: espaciado.md,
    paddingBottom: espaciado.xl,
    gap: espaciado.base,
  },
  barra: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: espaciado.base,
    paddingTop: espaciado.md,
    paddingBottom: espaciado.xs,
    gap: espaciado.sm,
  },
  volver: {
    paddingVertical: espaciado.xs,
    paddingRight: espaciado.base,
  },
  volverTexto: {
    fontFamily: t.tipografia.familia.fuerte,
    fontSize: t.tipografia.tamano.base,
    color: t.colores.tinta,
  },
  presionado: {
    opacity: 0.55,
  },
  barraTitulo: {
    flex: 1,
    textAlign: 'center',
    fontFamily: t.tipografia.familia.fuerte,
    fontSize: t.tipografia.tamano.sm,
    color: t.colores.tintaSuave,
  },
  fecha: {
    fontFamily: t.tipografia.familia.subtitulo,
    fontSize: t.tipografia.tamano.sm,
    color: t.colores.tinta,
    letterSpacing: 0.5,
  },
  titulo: {
    fontFamily: t.tipografia.familia.titulo,
    fontSize: t.tipografia.tamano.xl,
    lineHeight: t.tipografia.tamano.xl * t.tipografia.interlineado.ajustado,
    color: t.colores.tinta,
    textAlign: 'center',
    letterSpacing: 0.4,
  },
  tituloDestacado: {
    color: t.colores.rojoAccion,
  },
}))
