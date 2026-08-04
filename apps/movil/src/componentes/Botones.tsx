import {
  colores,
  espaciado,
  radios,
  sombras,
  tipografia,
  TOQUE_MINIMO,
} from '@woodtools/compartido'
import type { ReactNode } from 'react'
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native'

/**
 * Botones de la app.
 *
 * Todos respetan `TOQUE_MINIMO`: el vendedor los usa parado en la calle, con
 * una sola mano y a veces con guantes.
 */

interface PropsBase {
  titulo: string
  alTocar: () => void
  deshabilitado?: boolean
  cargando?: boolean
  style?: StyleProp<ViewStyle>
  icono?: ReactNode
  accessibilityLabel?: string
}

/** Botón rojo grande del menú y de las listas de opciones. */
export function BotonMenu({
  titulo,
  alTocar,
  deshabilitado,
  cargando,
  style,
  subtitulo,
  accessibilityLabel,
}: PropsBase & { subtitulo?: string }) {
  const inactivo = deshabilitado || cargando

  return (
    <Pressable
      onPress={alTocar}
      disabled={inactivo}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? titulo}
      accessibilityState={{ disabled: !!inactivo }}
      style={({ pressed }) => [
        estilos.menu,
        pressed && estilos.menuPresionado,
        inactivo && estilos.inactivo,
        style,
      ]}
    >
      {cargando ? (
        <ActivityIndicator color={colores.blanco} />
      ) : (
        <View style={estilos.menuTextos}>
          <Text style={estilos.menuTitulo} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.75}>
            {titulo}
          </Text>
          {subtitulo ? <Text style={estilos.menuSubtitulo}>{subtitulo}</Text> : null}
        </View>
      )}
    </Pressable>
  )
}

/** Botón verde: la acción que hace avanzar (CONTINUAR, INICIAR SESIÓN). */
export function BotonPrincipal({
  titulo,
  alTocar,
  deshabilitado,
  cargando,
  style,
  accessibilityLabel,
}: PropsBase) {
  const inactivo = deshabilitado || cargando

  return (
    <Pressable
      onPress={alTocar}
      disabled={inactivo}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? titulo}
      accessibilityState={{ disabled: !!inactivo }}
      style={({ pressed }) => [
        estilos.principal,
        pressed && estilos.principalPresionado,
        inactivo && estilos.inactivo,
        style,
      ]}
    >
      {cargando ? (
        <ActivityIndicator color={colores.negro} />
      ) : (
        <Text style={estilos.principalTexto} numberOfLines={1} adjustsFontSizeToFit>
          {titulo}
        </Text>
      )}
    </Pressable>
  )
}

/** Botón de contorno, para acciones secundarias dentro del panel. */
export function BotonSecundario({
  titulo,
  alTocar,
  deshabilitado,
  cargando,
  style,
}: PropsBase) {
  const inactivo = deshabilitado || cargando
  return (
    <Pressable
      onPress={alTocar}
      disabled={inactivo}
      accessibilityRole="button"
      accessibilityLabel={titulo}
      style={({ pressed }) => [
        estilos.secundario,
        pressed && estilos.secundarioPresionado,
        inactivo && estilos.inactivo,
        style,
      ]}
    >
      {cargando ? (
        <ActivityIndicator color={colores.tinta} />
      ) : (
        <Text style={estilos.secundarioTexto}>{titulo}</Text>
      )}
    </Pressable>
  )
}

/**
 * Par SÍ / NO del formulario "¿Destino visitado?".
 * El seleccionado se rellena; el otro queda en contorno.
 */
export function BotonesSiNo({
  valor,
  alCambiar,
  error,
}: {
  valor: boolean | null
  alCambiar: (valor: boolean) => void
  error?: boolean
}) {
  return (
    <View style={estilos.siNoFila}>
      <Pressable
        onPress={() => alCambiar(true)}
        accessibilityRole="radio"
        accessibilityState={{ selected: valor === true }}
        accessibilityLabel="Sí, visité el destino"
        style={({ pressed }) => [
          estilos.siNo,
          valor === true ? estilos.siActivo : estilos.siInactivo,
          error && valor === null && estilos.siNoConError,
          pressed && estilos.menuPresionado,
        ]}
      >
        <Text style={[estilos.siNoTexto, valor === true ? estilos.textoSobreColor : estilos.textoVerde]}>
          SÍ
        </Text>
      </Pressable>

      <Pressable
        onPress={() => alCambiar(false)}
        accessibilityRole="radio"
        accessibilityState={{ selected: valor === false }}
        accessibilityLabel="No, no pude visitar el destino"
        style={({ pressed }) => [
          estilos.siNo,
          valor === false ? estilos.noActivo : estilos.noInactivo,
          error && valor === null && estilos.siNoConError,
          pressed && estilos.menuPresionado,
        ]}
      >
        <Text style={[estilos.siNoTexto, valor === false ? estilos.textoSobreColor : estilos.textoRojo]}>
          NO
        </Text>
      </Pressable>
    </View>
  )
}

const estilos = StyleSheet.create({
  menu: {
    minHeight: 74,
    backgroundColor: colores.rojoBoton,
    borderWidth: 2.5,
    borderColor: colores.negro,
    borderRadius: radios.sm,
    paddingHorizontal: espaciado.base,
    paddingVertical: espaciado.md,
    justifyContent: 'center',
    alignItems: 'center',
    ...sombras.boton,
  },
  menuPresionado: {
    transform: [{ scale: 0.98 }],
    opacity: 0.9,
  },
  menuTextos: {
    alignItems: 'center',
    gap: 2,
  },
  menuTitulo: {
    fontFamily: tipografia.familia.subtitulo,
    fontSize: tipografia.tamano.lg,
    color: colores.blanco,
    textAlign: 'center',
    letterSpacing: 0.6,
  },
  menuSubtitulo: {
    fontFamily: tipografia.familia.cuerpo,
    fontSize: tipografia.tamano.xs,
    color: 'rgba(255,255,255,0.82)',
    textAlign: 'center',
  },

  principal: {
    minHeight: TOQUE_MINIMO,
    backgroundColor: colores.verde,
    borderWidth: 2.5,
    borderColor: colores.negro,
    borderRadius: radios.sm,
    paddingHorizontal: espaciado.lg,
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'center',
    minWidth: 220,
    ...sombras.boton,
  },
  principalPresionado: {
    backgroundColor: colores.verdeOscuro,
    transform: [{ scale: 0.98 }],
  },
  principalTexto: {
    fontFamily: tipografia.familia.titulo,
    fontSize: tipografia.tamano.lg,
    color: colores.negro,
    letterSpacing: 0.8,
  },

  secundario: {
    minHeight: TOQUE_MINIMO,
    borderWidth: 2,
    borderColor: colores.negro,
    borderRadius: radios.sm,
    backgroundColor: colores.panelClaro,
    paddingHorizontal: espaciado.base,
    justifyContent: 'center',
    alignItems: 'center',
  },
  secundarioPresionado: {
    backgroundColor: colores.panelOscuro,
  },
  secundarioTexto: {
    fontFamily: tipografia.familia.fuerte,
    fontSize: tipografia.tamano.base,
    color: colores.tinta,
  },

  siNoFila: {
    flexDirection: 'row',
    gap: espaciado.xl,
    justifyContent: 'center',
    paddingVertical: espaciado.sm,
  },
  siNo: {
    minWidth: 130,
    minHeight: TOQUE_MINIMO,
    borderWidth: 2.5,
    borderColor: colores.negro,
    borderRadius: radios.sm,
    justifyContent: 'center',
    alignItems: 'center',
    ...sombras.boton,
  },
  siActivo: { backgroundColor: colores.verde },
  siInactivo: { backgroundColor: colores.panelClaro },
  noActivo: { backgroundColor: colores.rojoAccion },
  noInactivo: { backgroundColor: colores.panelClaro },
  siNoConError: { borderColor: colores.rojoAccion, borderWidth: 3 },
  siNoTexto: {
    fontFamily: tipografia.familia.titulo,
    fontSize: tipografia.tamano.xl,
    letterSpacing: 1,
  },
  textoSobreColor: { color: colores.blanco },
  textoVerde: { color: colores.verdeOscuro },
  textoRojo: { color: colores.rojoAccion },

  inactivo: {
    opacity: 0.45,
  },
})
