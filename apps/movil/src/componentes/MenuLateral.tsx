import { espaciado, radios, sombras, TOQUE_MINIMO } from '@woodtools/compartido'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { useEffect, useRef } from 'react'
import {
  Animated,
  Easing,
  Modal,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { hojaDeTema } from '../nucleo/tema'
import type { ParametrosApp } from '../navegacion/tipos'

/**
 * El menú de las tres rayas.
 *
 * ─── Qué reemplaza ──────────────────────────────────────────────────────────
 *
 * Las tres rayas existían desde el primer día y llevaban a CONFIGURACIÓN. No
 * era un menú: era un atajo con cara de menú, y el vendedor que lo tocaba
 * buscando "imprimir notas" terminaba mirando su número de versión.
 *
 * ─── Por qué es un modal y no un Drawer de React Navigation ─────────────────
 *
 * Porque un Drawer obliga a envolver toda la pila de navegación en otro
 * navegador, y con eso cambia de dónde cuelga cada pantalla: los `goBack` que
 * hoy funcionan, el gesto de volver de Android, y las cuatro pantallas que
 * navegan con `navigate` esperando encontrar la de al lado. Es un cambio en el
 * esqueleto de la app para dibujar un panel que se desliza.
 *
 * Este panel se desliza igual, no toca la navegación, y vive adentro del
 * encabezado —que ya está en todas las pantallas—, así que se sumó a las 27 de
 * una sola vez.
 */

/** Adónde lleva cada opción. Son las del mockup, en el mismo orden. */
interface Destino {
  etiqueta: string
  ir: (navegacion: NativeStackNavigationProp<ParametrosApp>) => void
}

const OPCIONES: Destino[] = [
  {
    etiqueta: 'VER DESTINOS DEL DÍA DE HOY',
    ir: (n) => n.navigate('Visitas'),
  },
  {
    etiqueta: 'CALENDARIO DE VISITAS',
    ir: (n) => n.navigate('CalendarioVisitas'),
  },
  {
    etiqueta: 'CREAR NOTA DE PEDIDO',
    ir: (n) => n.navigate('GenerarNota'),
  },
  {
    // Las pendientes son, literalmente, las que están esperando el papel.
    etiqueta: 'IMPRIMIR NOTAS DE PEDIDO',
    ir: (n) => n.navigate('NotasPendientes'),
  },
  {
    etiqueta: 'HISTORIAL DE ENVÍOS',
    ir: (n) => n.navigate('Historial'),
  },
  {
    etiqueta: 'HISTORIAL NOTAS DE PEDIDO',
    ir: (n) => n.navigate('HistorialNotas'),
  },
  {
    etiqueta: 'REPORTAR UN PROBLEMA',
    ir: (n) => n.navigate('ReportarProblema', {}),
  },
  {
    etiqueta: 'COMUNICACIÓN INTERNA',
    ir: (n) => n.navigate('ComunicacionInterna'),
  },
  {
    etiqueta: 'BUSCAR ACTUALIZACIÓN',
    ir: (n) => n.navigate('Configuracion', { seccion: 'actualizaciones' }),
  },
]

/**
 * Las dos que no están en el mockup y van igual, separadas abajo.
 *
 * Antes de este menú, las tres rayas eran la única puerta a CONFIGURACIÓN
 * desde una pantalla que no fuera el menú principal. Reemplazarlas sin dejar
 * otra puerta habría sido cambiar un menú incompleto por uno que además saca
 * algo. Van abajo de una línea porque no son lo que se viene a buscar acá.
 */
const AL_PIE: Destino[] = [
  { etiqueta: 'MENÚ PRINCIPAL', ir: (n) => n.navigate('Menu') },
  { etiqueta: 'CONFIGURACIÓN', ir: (n) => n.navigate('Configuracion', {}) },
]

export function MenuLateral({ abierto, alCerrar }: { abierto: boolean; alCerrar: () => void }) {
  const estilos = usarEstilos()
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const navegacion = useNavigation<NativeStackNavigationProp<ParametrosApp>>()

  // 300 es el ancho del panel del mockup en un teléfono común. El tope por
  // proporción es para que en una pantalla angosta no ocupe todo y deje ver que
  // atrás sigue estando la pantalla de la que uno vino.
  const ancho = Math.min(320, width * 0.84)

  const corrimiento = useRef(new Animated.Value(-ancho)).current

  useEffect(() => {
    Animated.timing(corrimiento, {
      toValue: abierto ? 0 : -ancho,
      duration: abierto ? 220 : 160,
      easing: abierto ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start()
  }, [abierto, ancho, corrimiento])

  /**
   * Primero se cierra, después se navega.
   *
   * Navegando con el modal abierto, el modal queda arriba de la pantalla nueva
   * y tapa la app: el vendedor ve el menú sobre una pantalla que ya cambió, y
   * el único botón que le queda es la X. El cuadro de espera es para que la
   * animación de cierre no se corte a la mitad.
   */
  function irA(destino: Destino) {
    alCerrar()
    requestAnimationFrame(() => destino.ir(navegacion))
  }

  return (
    <Modal
      visible={abierto}
      transparent
      animationType="fade"
      onRequestClose={alCerrar}
      statusBarTranslucent
    >
      <View style={estilos.velo}>
        {/* Tocar afuera cierra: es lo que todo el mundo intenta primero. */}
        <Pressable style={estilos.afuera} onPress={alCerrar} accessibilityLabel="Cerrar el menú" />

        <Animated.View
          style={[
            estilos.panel,
            { width: ancho, paddingTop: insets.top + espaciado.md, transform: [{ translateX: corrimiento }] },
          ]}
        >
          <Pressable
            onPress={alCerrar}
            hitSlop={16}
            accessibilityRole="button"
            accessibilityLabel="Cerrar el menú"
            style={({ pressed }) => [estilos.cerrar, pressed && estilos.tocado]}
          >
            <Text style={estilos.cerrarTexto}>✕</Text>
          </Pressable>

          <ScrollView
            contentContainerStyle={[estilos.lista, { paddingBottom: insets.bottom + espaciado.lg }]}
            showsVerticalScrollIndicator={false}
          >
            {OPCIONES.map((o) => (
              <Opcion key={o.etiqueta} destino={o} alElegir={irA} />
            ))}

            <View style={estilos.linea} />

            {AL_PIE.map((o) => (
              <Opcion key={o.etiqueta} destino={o} alElegir={irA} secundaria />
            ))}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  )
}

function Opcion({
  destino,
  alElegir,
  secundaria = false,
}: {
  destino: Destino
  alElegir: (destino: Destino) => void
  secundaria?: boolean
}) {
  const estilos = usarEstilos()
  return (
    <Pressable
      onPress={() => alElegir(destino)}
      accessibilityRole="button"
      accessibilityLabel={destino.etiqueta}
      style={({ pressed }) => [estilos.opcion, pressed && estilos.tocado]}
    >
      <Text style={estilos.punto}>•</Text>
      <Text style={[estilos.etiqueta, secundaria && estilos.etiquetaSecundaria]}>
        {destino.etiqueta}
      </Text>
    </Pressable>
  )
}

const usarEstilos = hojaDeTema((t) => ({
  velo: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: t.colores.velo,
  },
  afuera: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
  },
  panel: {
    backgroundColor: t.colores.panelClaro,
    borderRightWidth: 2.5,
    borderRightColor: t.colores.borde,
    ...sombras.flotante,
  },
  cerrar: {
    width: TOQUE_MINIMO,
    height: TOQUE_MINIMO,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: espaciado.xs,
  },
  cerrarTexto: {
    fontFamily: t.tipografia.familia.subtitulo,
    fontSize: t.tipografia.tamano.xl,
    color: t.colores.tinta,
  },
  lista: {
    paddingHorizontal: espaciado.base,
    paddingTop: espaciado.xs,
    gap: espaciado.xs,
  },
  opcion: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: espaciado.sm,
    minHeight: TOQUE_MINIMO,
    paddingVertical: espaciado.sm,
    paddingHorizontal: espaciado.xs,
    borderRadius: radios.sm,
  },
  tocado: { backgroundColor: t.colores.panelOscuro },
  punto: {
    fontFamily: t.tipografia.familia.subtitulo,
    fontSize: t.tipografia.tamano.base,
    color: t.colores.tinta,
    lineHeight: t.tipografia.tamano.base * 1.5,
  },
  etiqueta: {
    flex: 1,
    fontFamily: t.tipografia.familia.subtitulo,
    fontSize: t.tipografia.tamano.base,
    lineHeight: t.tipografia.tamano.base * 1.35,
    color: t.colores.tinta,
    letterSpacing: 0.6,
  },
  etiquetaSecundaria: {
    fontFamily: t.tipografia.familia.cuerpo,
    color: t.colores.tintaSuave,
  },
  linea: {
    height: 1.5,
    backgroundColor: t.colores.panelOscuro,
    marginVertical: espaciado.sm,
  },
}))
