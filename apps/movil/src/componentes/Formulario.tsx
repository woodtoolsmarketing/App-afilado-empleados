import {
  colores,
  espaciado,
  radios,
  tipografia,
  TOQUE_MINIMO,
} from '@woodtools/compartido'
import { forwardRef, useState, type ReactNode } from 'react'
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native'

/**
 * Controles de formulario.
 *
 * Todos comparten el mismo tratamiento del error: borde rojo + mensaje debajo,
 * porque la consigna pide señalar exactamente qué campo está mal.
 */

export function Etiqueta({
  children,
  sobreRojo = false,
  obligatorio = false,
  centrada = false,
}: {
  children: ReactNode
  /** Cuando la etiqueta va sobre el fondo rojo (pantalla de login). */
  sobreRojo?: boolean
  obligatorio?: boolean
  /** Para los selectores que encabezan una pantalla, como el PERIODO. */
  centrada?: boolean
}) {
  return (
    <Text
      style={[
        estilos.etiqueta,
        sobreRojo && estilos.etiquetaSobreRojo,
        centrada && estilos.etiquetaCentrada,
      ]}
    >
      {children}
      {obligatorio ? <Text style={estilos.asterisco}> *</Text> : null}
    </Text>
  )
}

export function MensajeError({ children }: { children?: string | null }) {
  if (!children) return null
  return (
    <View style={estilos.errorCaja} accessibilityLiveRegion="polite">
      <Text style={estilos.errorIcono}>!</Text>
      <Text style={estilos.errorTexto}>{children}</Text>
    </View>
  )
}

export interface PropsCampo extends TextInputProps {
  etiqueta?: string
  error?: string | null
  sobreRojo?: boolean
  obligatorio?: boolean
  contenedorStyle?: StyleProp<ViewStyle>
  /** Se dibuja pegado al borde derecho del campo (por ejemplo, el micrófono). */
  accesorio?: ReactNode
  ayuda?: string
}

export const Campo = forwardRef<TextInput, PropsCampo>(function Campo(
  {
    etiqueta,
    error,
    sobreRojo = false,
    obligatorio = false,
    contenedorStyle,
    accesorio,
    ayuda,
    style,
    ...props
  },
  ref,
) {
  const [enfocado, setEnfocado] = useState(false)

  return (
    <View style={[estilos.campoContenedor, contenedorStyle]}>
      {etiqueta ? (
        <Etiqueta sobreRojo={sobreRojo} obligatorio={obligatorio}>
          {etiqueta}
        </Etiqueta>
      ) : null}

      <View
        style={[
          estilos.campoCaja,
          props.multiline && estilos.campoCajaMultilinea,
          enfocado && estilos.campoEnfocado,
          !!error && estilos.campoConError,
        ]}
      >
        <TextInput
          ref={ref}
          {...props}
          onFocus={(e) => {
            setEnfocado(true)
            props.onFocus?.(e)
          }}
          onBlur={(e) => {
            setEnfocado(false)
            props.onBlur?.(e)
          }}
          placeholderTextColor={colores.tintaTenue}
          style={[estilos.campoTexto, props.multiline && estilos.campoTextoMultilinea, style]}
          accessibilityLabel={etiqueta}
        />
        {accesorio ? <View style={estilos.accesorio}>{accesorio}</View> : null}
      </View>

      {ayuda && !error ? <Text style={[estilos.ayuda, sobreRojo && estilos.ayudaSobreRojo]}>{ayuda}</Text> : null}
      <MensajeError>{error}</MensajeError>
    </View>
  )
})

/** Casilla cuadrada con borde negro, como en "TIPO DE VISITA". */
export function Casilla({
  etiqueta,
  valor,
  alCambiar,
  deshabilitada,
}: {
  etiqueta: string
  valor: boolean
  alCambiar: (valor: boolean) => void
  deshabilitada?: boolean
}) {
  return (
    <Pressable
      onPress={() => alCambiar(!valor)}
      disabled={deshabilitada}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: valor, disabled: !!deshabilitada }}
      accessibilityLabel={etiqueta}
      style={({ pressed }) => [
        estilos.casillaFila,
        pressed && estilos.filaPresionada,
        deshabilitada && estilos.deshabilitado,
      ]}
      hitSlop={8}
    >
      <Text style={estilos.casillaEtiqueta}>{etiqueta}</Text>
      <View style={[estilos.casillaCaja, valor && estilos.casillaMarcada]}>
        {valor ? <Text style={estilos.casillaTilde}>✓</Text> : null}
      </View>
    </Pressable>
  )
}

/** Botón de radio, para listas donde se elige una sola opción. */
export function Opcion({
  etiqueta,
  descripcion,
  seleccionada,
  alSeleccionar,
}: {
  etiqueta: string
  descripcion?: string
  seleccionada: boolean
  alSeleccionar: () => void
}) {
  return (
    <Pressable
      onPress={alSeleccionar}
      accessibilityRole="radio"
      accessibilityState={{ selected: seleccionada }}
      accessibilityLabel={etiqueta}
      style={({ pressed }) => [
        estilos.opcion,
        seleccionada && estilos.opcionSeleccionada,
        pressed && estilos.filaPresionada,
      ]}
    >
      <View style={[estilos.radio, seleccionada && estilos.radioActivo]}>
        {seleccionada ? <View style={estilos.radioPunto} /> : null}
      </View>
      <View style={estilos.opcionTextos}>
        <Text style={estilos.opcionEtiqueta}>{etiqueta}</Text>
        {descripcion ? <Text style={estilos.opcionDescripcion}>{descripcion}</Text> : null}
      </View>
    </Pressable>
  )
}

export interface ItemDesplegable<T extends string> {
  valor: T
  etiqueta: string
  descripcion?: string
}

/**
 * Desplegable. Abre una hoja modal en lugar del selector nativo: se ve igual en
 * todos los teléfonos y las opciones entran con el tamaño de toque que
 * necesitamos.
 */
export function Desplegable<T extends string>({
  etiqueta,
  marcador = 'Seleccioná una opción',
  valor,
  items,
  alCambiar,
  error,
  obligatorio,
  deshabilitado,
  etiquetaCentrada,
}: {
  etiqueta?: string
  marcador?: string
  valor: T | null
  items: ItemDesplegable<T>[]
  alCambiar: (valor: T) => void
  error?: string | null
  obligatorio?: boolean
  deshabilitado?: boolean
  /**
   * Centra el rótulo. Lo usan los dos historiales, donde el PERIODO no es un
   * campo más de un formulario sino el control que manda en la pantalla.
   */
  etiquetaCentrada?: boolean
}) {
  const [abierto, setAbierto] = useState(false)
  const elegido = items.find((i) => i.valor === valor)

  return (
    <View style={estilos.campoContenedor}>
      {etiqueta ? (
        <Etiqueta obligatorio={obligatorio} centrada={etiquetaCentrada}>
          {etiqueta}
        </Etiqueta>
      ) : null}

      {/*
        El triángulo va FUERA de la caja blanca, como en el mockup, pero DENTRO
        de lo que se toca: es el gesto más obvio para abrir un desplegable y
        dejarlo sin toque sería peor que el desvío visual que se corrige.

        Por eso el Pressable es la fila entera —caja + triángulo— y el recuadro
        pasó a ser un View adentro. El borde rojo del error sigue en la caja,
        que es lo que el vendedor mira.
      */}
      <Pressable
        onPress={() => setAbierto(true)}
        disabled={deshabilitado}
        accessibilityRole="button"
        accessibilityLabel={`${etiqueta ?? 'Opción'}: ${elegido?.etiqueta ?? marcador}`}
        style={({ pressed }) => [
          estilos.desplegableFila,
          pressed && estilos.filaPresionada,
          deshabilitado && estilos.deshabilitado,
        ]}
      >
        <View
          style={[estilos.campoCaja, estilos.desplegableCaja, !!error && estilos.campoConError]}
        >
          <Text style={[estilos.campoTexto, !elegido && estilos.marcador]} numberOfLines={1}>
            {elegido?.etiqueta ?? marcador}
          </Text>
        </View>
        <Text style={estilos.flecha}>▼</Text>
      </Pressable>

      <MensajeError>{error}</MensajeError>

      <Modal
        visible={abierto}
        transparent
        animationType="fade"
        onRequestClose={() => setAbierto(false)}
      >
        <Pressable style={estilos.velo} onPress={() => setAbierto(false)}>
          <Pressable style={estilos.hoja} onPress={(e) => e.stopPropagation()}>
            {etiqueta ? <Text style={estilos.hojaTitulo}>{etiqueta}</Text> : null}
            <ScrollView bounces={false}>
              {items.map((item) => (
                <Opcion
                  key={item.valor}
                  etiqueta={item.etiqueta}
                  descripcion={item.descripcion}
                  seleccionada={item.valor === valor}
                  alSeleccionar={() => {
                    alCambiar(item.valor)
                    setAbierto(false)
                  }}
                />
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  )
}

const estilos = StyleSheet.create({
  campoContenedor: {
    gap: espaciado.xs,
  },
  etiqueta: {
    fontFamily: tipografia.familia.cuerpo,
    fontSize: tipografia.tamano.base,
    color: colores.tinta,
  },
  etiquetaCentrada: { textAlign: 'center' },
  etiquetaSobreRojo: {
    color: colores.blanco,
    fontSize: tipografia.tamano.xl,
    fontFamily: tipografia.familia.fuerte,
    textShadowColor: 'rgba(0,0,0,0.35)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  asterisco: {
    color: colores.rojoAccion,
    fontFamily: tipografia.familia.subtitulo,
  },

  campoCaja: {
    minHeight: TOQUE_MINIMO,
    backgroundColor: colores.campo,
    borderWidth: 2,
    borderColor: colores.negro,
    borderRadius: radios.sm,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: espaciado.md,
  },
  campoCajaMultilinea: {
    minHeight: 150,
    alignItems: 'stretch',
    backgroundColor: colores.campoBlanco,
    paddingVertical: espaciado.sm,
  },
  campoEnfocado: {
    borderColor: colores.azul,
  },
  campoConError: {
    borderColor: colores.rojoAccion,
    borderWidth: 2.5,
  },
  campoTexto: {
    flex: 1,
    fontFamily: tipografia.familia.cuerpo,
    fontSize: tipografia.tamano.base,
    color: colores.tinta,
    paddingVertical: espaciado.sm,
  },
  campoTextoMultilinea: {
    textAlignVertical: 'top',
    minHeight: 120,
  },
  accesorio: {
    paddingLeft: espaciado.sm,
    alignSelf: 'flex-end',
    paddingBottom: espaciado.xs,
  },
  marcador: {
    color: colores.tintaTenue,
  },
  ayuda: {
    fontFamily: tipografia.familia.liviana,
    fontSize: tipografia.tamano.xs,
    color: colores.tintaSuave,
  },
  ayudaSobreRojo: {
    color: 'rgba(255,255,255,0.85)',
  },

  errorCaja: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: espaciado.sm,
    backgroundColor: 'rgba(224,27,36,0.12)',
    borderLeftWidth: 4,
    borderLeftColor: colores.rojoAccion,
    borderRadius: radios.sm,
    paddingVertical: espaciado.sm,
    paddingHorizontal: espaciado.sm,
  },
  errorIcono: {
    fontFamily: tipografia.familia.titulo,
    fontSize: tipografia.tamano.sm,
    color: colores.blanco,
    backgroundColor: colores.rojoAccion,
    width: 20,
    height: 20,
    borderRadius: 10,
    textAlign: 'center',
    lineHeight: 20,
    overflow: 'hidden',
  },
  errorTexto: {
    flex: 1,
    fontFamily: tipografia.familia.cuerpo,
    fontSize: tipografia.tamano.xs,
    color: '#8A0B0B',
    lineHeight: tipografia.tamano.xs * tipografia.interlineado.normal,
  },

  casillaFila: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: TOQUE_MINIMO,
    paddingVertical: espaciado.xs,
    paddingRight: espaciado.xs,
  },
  casillaEtiqueta: {
    fontFamily: tipografia.familia.cuerpo,
    fontSize: tipografia.tamano.lg,
    color: colores.tinta,
    letterSpacing: 0.3,
  },
  casillaCaja: {
    width: 36,
    height: 36,
    borderWidth: 2.5,
    borderColor: colores.negro,
    borderRadius: radios.sm,
    backgroundColor: colores.campoBlanco,
    alignItems: 'center',
    justifyContent: 'center',
  },
  casillaMarcada: {
    backgroundColor: colores.verde,
  },
  casillaTilde: {
    fontFamily: tipografia.familia.titulo,
    fontSize: 22,
    lineHeight: 26,
    color: colores.negro,
  },

  filaPresionada: {
    opacity: 0.65,
  },
  deshabilitado: {
    opacity: 0.45,
  },

  desplegableFila: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: TOQUE_MINIMO,
  },
  desplegableCaja: {
    flex: 1,
    backgroundColor: colores.campoBlanco,
  },
  flecha: {
    fontSize: tipografia.tamano.xl,
    color: colores.tintaSuave,
    // Padding y no margen: es lo que le da ancho propio dentro del área táctil.
    paddingHorizontal: espaciado.sm,
  },

  velo: {
    flex: 1,
    backgroundColor: colores.velo,
    justifyContent: 'flex-end',
  },
  hoja: {
    backgroundColor: colores.panelClaro,
    borderTopWidth: 3,
    borderColor: colores.negro,
    borderTopLeftRadius: radios.lg,
    borderTopRightRadius: radios.lg,
    padding: espaciado.base,
    maxHeight: '70%',
    gap: espaciado.sm,
  },
  hojaTitulo: {
    fontFamily: tipografia.familia.subtitulo,
    fontSize: tipografia.tamano.lg,
    color: colores.tinta,
    textAlign: 'center',
    paddingBottom: espaciado.sm,
  },

  opcion: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaciado.md,
    minHeight: TOQUE_MINIMO,
    paddingHorizontal: espaciado.md,
    paddingVertical: espaciado.sm,
    borderWidth: 2,
    borderColor: 'transparent',
    borderRadius: radios.sm,
    backgroundColor: colores.campoBlanco,
    marginBottom: espaciado.sm,
  },
  opcionSeleccionada: {
    borderColor: colores.negro,
    backgroundColor: colores.panelClaro,
  },
  radio: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2.5,
    borderColor: colores.negro,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioActivo: {
    borderColor: colores.rojo,
  },
  radioPunto: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colores.rojo,
  },
  opcionTextos: {
    flex: 1,
  },
  opcionEtiqueta: {
    fontFamily: tipografia.familia.fuerte,
    fontSize: tipografia.tamano.base,
    color: colores.tinta,
  },
  opcionDescripcion: {
    fontFamily: tipografia.familia.liviana,
    fontSize: tipografia.tamano.xs,
    color: colores.tintaSuave,
    marginTop: 2,
  },
})
