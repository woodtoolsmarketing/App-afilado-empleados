import { espaciado, radios, sombras, TOQUE_MINIMO, type ClaveFuncion } from '@woodtools/compartido'
import { useNavigation, useNavigationState } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { useEffect, useRef, useState } from 'react'
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
import { usarSesion } from '../nucleo/sesion'
import { usarPermisos } from '../servicios/permisos'
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
  /**
   * `pantallaActual` es el nombre de la ruta desde la que se abrió el menú.
   * Sólo lo usa "REPORTAR UN PROBLEMA", igual que Configuración: el resto lo
   * ignora.
   */
  ir: (navegacion: NativeStackNavigationProp<ParametrosApp>, pantallaActual?: string) => void
  /**
   * La función de permisos a la que pertenece esta entrada. Si el rol no la
   * tiene habilitada (ver el apartado "Permisos" del panel), la entrada se
   * esconde, igual que en el menú principal. Las que no tienen `permiso`
   * (Reportar, Buscar actualización, etc.) se ven siempre.
   */
  permiso?: ClaveFuncion
}

const OPCIONES: Destino[] = [
  {
    etiqueta: 'VER DESTINOS DEL DÍA DE HOY',
    ir: (n) => n.navigate('Visitas'),
    permiso: 'visitas',
  },
  {
    etiqueta: 'CALENDARIO DE VISITAS',
    ir: (n) => n.navigate('CalendarioVisitas'),
    permiso: 'calendario',
  },
  {
    etiqueta: 'CREAR NOTA DE PEDIDO',
    ir: (n) => n.navigate('GenerarNota'),
    permiso: 'notas_pedido',
  },
  {
    // Las pendientes son, literalmente, las que están esperando el papel.
    etiqueta: 'IMPRIMIR NOTAS DE PEDIDO',
    ir: (n) => n.navigate('NotasPendientes'),
    permiso: 'notas_pedido',
  },
  {
    // La planilla del recorrido de hoy: la misma que arma la oficina, para
    // imprimirla en la impresora de la oficina.
    etiqueta: 'IMPRIMIR ROL DE VISITA',
    ir: (n) => n.navigate('RolDeVisita'),
  },
  {
    etiqueta: 'HISTORIAL DE VISITAS',
    ir: (n) => n.navigate('Historial'),
  },
  {
    etiqueta: 'HISTORIAL NOTAS DE PEDIDO',
    ir: (n) => n.navigate('HistorialNotas'),
    permiso: 'notas_pedido',
  },
  {
    etiqueta: 'REPORTAR UN PROBLEMA',
    // La pantalla de origen viaja con el reporte, igual que en Configuración:
    // sin ella, Marketing sólo sabe que alguien reportó algo, no desde dónde.
    ir: (n, pantallaActual) => n.navigate('ReportarProblema', { pantalla: pantallaActual }),
  },
  {
    etiqueta: 'COMUNICACIÓN INTERNA',
    ir: (n) => n.navigate('ComunicacionInterna'),
    permiso: 'comunicacion_interna',
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
  { etiqueta: 'CAMBIAR DE CUENTA', ir: (n) => n.navigate('Cuentas') },
  { etiqueta: 'CONFIGURACIÓN', ir: (n) => n.navigate('Configuracion', {}) },
]

/**
 * Las funciones de la oficina, sólo para administradores.
 *
 * Son las pestañas del panel de escritorio traídas al teléfono. El backend ya
 * gatea por `perfiles.rol`, pero además el menú las esconde: un vendedor no las
 * ve, y aunque adivinara la ruta, la base lo frenaría igual. Se muestran sólo
 * cuando `perfil.rol === 'admin'`.
 */
const ADMINISTRACION: Destino[] = [
  { etiqueta: 'USUARIOS Y TELÉFONOS', ir: (n) => n.navigate('AdminUsuarios') },
  { etiqueta: 'CLIENTES (CARTERA)', ir: (n) => n.navigate('AdminClientes') },
  { etiqueta: 'MODIFICACIONES DE CLIENTES', ir: (n) => n.navigate('AdminModificaciones') },
]

/**
 * Nombre legible de cada pantalla, para el campo que ve Marketing en un
 * reporte. Sin esto viajaba el nombre interno de la ruta ("NotasPendientes"),
 * que además quedaba mezclado con las etiquetas a mano que ya arma Configuración.
 */
const ETIQUETA_PANTALLA: Record<string, string> = {
  Menu: 'Menú',
  Visitas: 'Visitas',
  Recorrido: 'Mapa del recorrido',
  DestinoVisitado: 'Destino visitado',
  AgregarDestino: 'Agregar destino',
  Historial: 'Historial de visitas',
  DetalleVisita: 'Detalle de visita',
  Configuracion: 'Configuración',
  Cuentas: 'Cuentas',
  NotasPedido: 'Notas de pedido',
  GenerarNota: 'Generar nota de pedido',
  NuevoCliente: 'Nuevo cliente',
  NotasPendientes: 'Notas pendientes',
  Cobranzas: 'Historial de cobranzas',
  CalendarioEnvios: 'Próximas visitas',
  CalendarioVisitas: 'Calendario de visitas',
  RolDeVisita: 'Rol de visita',
  AdminUsuarios: 'Usuarios y teléfonos',
  AdminClientes: 'Clientes (cartera)',
  AdminModificaciones: 'Modificaciones de clientes',
  ComunicacionInterna: 'Comunicación interna',
  ClientesDelDia: 'Clientes de hoy',
  NotasImpresas: 'Notas impresas',
  HistorialNotas: 'Historial de notas de pedido',
  DetalleNota: 'Detalle de nota',
  VistaPrevia: 'Vista previa de impresión',
  EnPreparacion: 'En preparación',
}

export function MenuLateral({ abierto, alCerrar }: { abierto: boolean; alCerrar: () => void }) {
  const estilos = usarEstilos()
  const insets = useSafeAreaInsets()
  const { width, height: altoVentana } = useWindowDimensions()
  const navegacion = useNavigation<NativeStackNavigationProp<ParametrosApp>>()
  // La sección de administración se muestra sólo a las cuentas admin. El backend
  // ya lo gatea, pero esconderla evita ofrecerle a un vendedor una puerta que la
  // base le va a cerrar.
  const esAdmin = usarSesion((s) => s.perfil?.rol === 'admin')
  // "IMPRIMIR ROL DE VISITA" se oculta a los vendedores que la oficina no
  // habilitó. Sólo a los vendedores: admin y supervisor imprimen siempre.
  const ocultarImprimirRol = usarSesion(
    (s) => s.perfil?.rol === 'vendedor' && s.perfil?.imprime_roles === false,
  )
  // Mismas funciones que el menú principal: cada entrada con `permiso` se
  // esconde si el rol no lo tiene habilitado (admin ve todo).
  const { puedeVer } = usarPermisos()
  const opciones = OPCIONES.filter(
    (o) =>
      (!o.permiso || puedeVer(o.permiso)) &&
      !(ocultarImprimirRol && o.etiqueta === 'IMPRIMIR ROL DE VISITA'),
  )
  // Desde dónde se abrió el menú, para "REPORTAR UN PROBLEMA", con nombre legible.
  const rutaActual = useNavigationState((state) => state.routes[state.index]?.name)
  const pantallaActual = rutaActual ? (ETIQUETA_PANTALLA[rutaActual] ?? rutaActual) : undefined

  // 300 es el ancho del panel del mockup en un teléfono común. El tope por
  // proporción es para que en una pantalla angosta no ocupe todo y deje ver que
  // atrás sigue estando la pantalla de la que uno vino.
  const ancho = Math.min(320, width * 0.84)

  // Pista de "hay más abajo". La barra de scroll nativa no alcanza: el thumb de
  // Android sólo asoma al arrastrar, y en Samsung One UI ni con
  // `persistentScrollbar` se dibuja en reposo (medido: no aparece). Así que la
  // dibujamos nosotros, un fundido en el borde inferior, y sólo cuando de verdad
  // sobra contenido (admin, con la sección de administración) y todavía no se
  // llegó al final. El vendedor común, que entra entero, no lo ve.
  const [altoVisible, setAltoVisible] = useState(0)
  const [altoContenido, setAltoContenido] = useState(0)
  const [enElFondo, setEnElFondo] = useState(false)
  const hayMasAbajo = altoContenido > altoVisible + 4 && !enElFondo

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
    requestAnimationFrame(() => destino.ir(navegacion, pantallaActual))
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
            {
              width: ancho,
              // Alto explícito = alto de la ventana. Sin esto el panel tomaba el
              // alto de su CONTENIDO (no se estiraba a la pantalla como se creía),
              // así que el `flex: 1` del ScrollView no tenía contra qué acotarse y
              // el ScrollView crecía con su contenido: nunca scrolleaba de verdad,
              // los últimos ítems quedaban abajo del borde y sin forma de llegar.
              // Con un alto fijo, el ScrollView queda acotado y scrollea.
              height: altoVentana,
              paddingTop: insets.top + espaciado.md,
              transform: [{ translateX: corrimiento }],
            },
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
            // `flex: 1` acota la altura del ScrollView a lo que queda del panel;
            // sin eso crece con su contenido y no scrollea. Con el menú corto no
            // se notaba —entraba entero—, pero al sumar la sección de
            // administración el contenido pasa de largo y los últimos ítems
            // (Clientes, Modificaciones) quedaban abajo del borde, sin forma de
            // llegar a ellos.
            style={estilos.scroll}
            contentContainerStyle={[estilos.lista, { paddingBottom: insets.bottom + espaciado.md }]}
            // El indicador nativo se deja puesto (ayuda en los teléfonos donde sí
            // se dibuja), pero la pista principal de "hay más abajo" es el fundido
            // que agregamos abajo: la barra de Android no es confiable en reposo.
            showsVerticalScrollIndicator
            persistentScrollbar
            onLayout={(e) => setAltoVisible(e.nativeEvent.layout.height)}
            onContentSizeChange={(_ancho, alto) => setAltoContenido(alto)}
            onScroll={(e) => {
              const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent
              setEnElFondo(contentOffset.y + layoutMeasurement.height >= contentSize.height - 4)
            }}
            scrollEventThrottle={16}
          >
            {opciones.map((o) => (
              <Opcion key={o.etiqueta} destino={o} alElegir={irA} />
            ))}

            {esAdmin ? (
              <>
                <View style={estilos.linea} />
                <Text style={estilos.seccion}>ADMINISTRACIÓN</Text>
                {ADMINISTRACION.map((o) => (
                  <Opcion key={o.etiqueta} destino={o} alElegir={irA} />
                ))}
              </>
            ) : null}

            <View style={estilos.linea} />

            {AL_PIE.map((o) => (
              <Opcion key={o.etiqueta} destino={o} alElegir={irA} secundaria />
            ))}
          </ScrollView>

          {/*
            Pista de "hay más abajo": una flecha ▾ en un botón redondo, pegada
            sobre la barra de gestos. No intercepta toques (pointerEvents none) y
            sólo aparece cuando sobra contenido y todavía no se llegó al final —o
            sea, al admin, que es a quien se le va de largo—. La flecha se dibuja
            con bordes (no es un carácter) para que no dependa de que la fuente
            tenga el glifo. Un fundido del color del panel no servía: el fondo es
            del mismo color, así que no se veía.
          */}
          {hayMasAbajo ? (
            <View
              pointerEvents="none"
              style={[estilos.pistaMas, { bottom: insets.bottom + espaciado.sm }]}
            >
              <View style={estilos.pistaChip}>
                <View style={estilos.pistaFlecha} />
              </View>
            </View>
          ) : null}
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
  scroll: { flex: 1 },
  lista: {
    paddingHorizontal: espaciado.base,
    paddingTop: espaciado.xs,
    gap: espaciado.xs,
  },
  opcion: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: espaciado.sm,
    // 48 a propósito, no el TOQUE_MINIMO (56): este menú tiene hasta 16 opciones
    // (con la sección de administración) y con 56 no entraban todas —el vendedor
    // veía el final cortado—. 48 es el mínimo táctil estándar (Material 48,
    // WCAG 2.5.5 AAA 44) y acá son ítems de NAVEGACIÓN: un toque de más abre otra
    // pantalla, no dispara nada que no se pueda deshacer, así que se baja el piso
    // sólo en este menú. Con esto el no-admin entra sin scroll y el admin scrollea
    // poco (y la barra fija le avisa que hay más).
    minHeight: 48,
    paddingVertical: espaciado.xs,
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
    marginVertical: espaciado.xs,
  },
  seccion: {
    fontFamily: t.tipografia.familia.subtitulo,
    fontSize: t.tipografia.tamano.micro,
    color: t.colores.rojo,
    letterSpacing: 1,
    paddingHorizontal: espaciado.xs,
    marginBottom: espaciado.xs,
  },
  // La pista de "hay más abajo": flecha en un botón redondo, centrada. `bottom`
  // se setea inline con el inset para que quede sobre la barra de gestos.
  pistaMas: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  pistaChip: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: t.colores.panelOscuro,
    borderWidth: 1.5,
    borderColor: t.colores.borde,
    alignItems: 'center',
    justifyContent: 'center',
    ...sombras.flotante,
  },
  // Un cuadradito con sólo dos bordes, girado 45°, dibuja un "▾". El translateY lo
  // sube un poco para que quede centrado dentro del botón.
  pistaFlecha: {
    width: 11,
    height: 11,
    borderRightWidth: 2.5,
    borderBottomWidth: 2.5,
    borderColor: t.colores.tinta,
    transform: [{ translateY: -3 }, { rotate: '45deg' }],
  },
}))
