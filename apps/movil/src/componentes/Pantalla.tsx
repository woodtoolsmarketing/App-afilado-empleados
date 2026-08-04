import { colores, espaciado, radios, sombras, tipografia } from '@woodtools/compartido'
import { formatearFechaCorta } from '@woodtools/compartido'
import type { ReactNode } from 'react'
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

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
}: {
  children: ReactNode
  desplazable?: boolean
  style?: StyleProp<ViewStyle>
  contentStyle?: StyleProp<ViewStyle>
}) {
  if (!desplazable) {
    return <View style={[estilos.panel, style, contentStyle]}>{children}</View>
  }

  return (
    <View style={[estilos.panel, style]}>
      <ScrollView
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

/** Título grande en mayúsculas, como "TUS ENVÍOS DE HOY SON: 13". */
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

const estilos = StyleSheet.create({
  fondo: {
    flex: 1,
    backgroundColor: colores.rojo,
  },
  panel: {
    flex: 1,
    backgroundColor: colores.panel,
    borderWidth: 2.5,
    borderColor: colores.negro,
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
    fontFamily: tipografia.familia.fuerte,
    fontSize: tipografia.tamano.base,
    color: colores.tinta,
  },
  presionado: {
    opacity: 0.55,
  },
  barraTitulo: {
    flex: 1,
    textAlign: 'center',
    fontFamily: tipografia.familia.fuerte,
    fontSize: tipografia.tamano.sm,
    color: colores.tintaSuave,
  },
  fecha: {
    fontFamily: tipografia.familia.subtitulo,
    fontSize: tipografia.tamano.sm,
    color: colores.tinta,
    letterSpacing: 0.5,
  },
  titulo: {
    fontFamily: tipografia.familia.titulo,
    fontSize: tipografia.tamano.xl,
    lineHeight: tipografia.tamano.xl * tipografia.interlineado.ajustado,
    color: colores.tinta,
    textAlign: 'center',
    letterSpacing: 0.4,
  },
  tituloDestacado: {
    color: colores.rojoAccion,
  },
})
