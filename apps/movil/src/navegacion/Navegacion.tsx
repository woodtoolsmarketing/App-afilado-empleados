import { NavigationContainer, type Theme } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'

import { BotonMenu } from '../componentes/Botones'
import { Aviso, Cargando } from '../componentes/Estado'
import { Pantalla, Panel, TituloPanel } from '../componentes/Pantalla'
import { usarSesion } from '../nucleo/sesion'
import { usarTema, type Tema } from '../nucleo/tema'
import { PantallaAgregarDestino } from '../pantallas/AgregarDestino'
import { PantallaCalendarioEnvios } from '../pantallas/CalendarioEnvios'
import { PantallaCalendarioVisitas } from '../pantallas/CalendarioVisitas'
import { PantallaClientesDelDia } from '../pantallas/ClientesDelDia'
import { PantallaCobranzas } from '../pantallas/Cobranzas'
import { PantallaComunicacionInterna } from '../pantallas/ComunicacionInterna'
import { PantallaConfiguracion } from '../pantallas/Configuracion'
import { PantallaDestinoVisitado } from '../pantallas/DestinoVisitado'
import { PantallaDetalleNota } from '../pantallas/DetalleNota'
import { PantallaDetalleVisita } from '../pantallas/DetalleVisita'
import { PantallaEnPreparacion } from '../pantallas/EnPreparacion'
import { PantallaVisitas } from '../pantallas/Visitas'
import { PantallaCambiarContrasena } from '../pantallas/CambiarContrasena'
import { PantallaEstadoCuenta } from '../pantallas/EstadoCuenta'
import { PantallaHistorial } from '../pantallas/HistorialVisitas'
import { PantallaGenerarNota } from '../pantallas/GenerarNota'
import { PantallaHistorialNotas } from '../pantallas/HistorialNotas'
import { PantallaNotasPedido } from '../pantallas/NotasPedido'
import { PantallaNuevoCliente } from '../pantallas/NuevoCliente'
import { PantallaNotasImpresas } from '../pantallas/NotasImpresas'
import { PantallaNotasPendientes } from '../pantallas/NotasPendientes'
import { PantallaVistaPreviaNota } from '../pantallas/VistaPreviaNota'
import { PantallaIniciarSesion } from '../pantallas/IniciarSesion'
import { PantallaMenu } from '../pantallas/Menu'
import { PantallaRecorrido } from '../pantallas/Recorrido'
import { PantallaReportarProblema } from '../pantallas/ReportarProblema'
import { usarAvisoDeApkAlEntrar } from '../servicios/avisoDeApk'
import { usarCandado } from '../servicios/presencia'
import type { ParametrosApp } from './tipos'

const Pila = createNativeStackNavigator<ParametrosApp>()

/**
 * El tema que ve React Navigation.
 *
 * Es aparte del nuestro y hay que darselo igual: lo que pinta el hueco entre
 * una pantalla y la siguiente durante la transicion es ESTE `background`, no
 * el de nuestras pantallas. Con el tema oscuro puesto y este color fijo en
 * rojo, cada vez que se navega aparecia un destello rojo entre dos pantallas
 * negras.
 */
function temaDeLaNavegacion(tema: Tema): Theme {
  return {
    dark: tema.oscuro,
    colors: {
      primary: tema.colores.rojo,
      background: tema.colores.fondo,
      card: tema.colores.fondo,
      text: tema.colores.blanco,
      border: tema.colores.borde,
      notification: tema.colores.rojoAccion,
    },
    fonts: {
      regular: { fontFamily: 'Poppins_400Regular', fontWeight: '400' },
      medium: { fontFamily: 'Poppins_500Medium', fontWeight: '500' },
      bold: { fontFamily: 'Poppins_700Bold', fontWeight: '700' },
      heavy: { fontFamily: 'Poppins_800ExtraBold', fontWeight: '800' },
    },
  }
}

/**
 * Enrutado por estado de sesión.
 *
 * Hay tres pilas mutuamente excluyentes, no una sola con guardas: mientras la
 * cuenta no esté habilitada, las pantallas de la app ni siquiera existen en el
 * árbol de navegación.
 */
export function Navegacion() {
  const estado = usarSesion((s) => s.estado)
  const tema = usarTema()

  /**
   * Fijarse solo si hay un instalador nuevo.
   *
   * Va acá y no en una pantalla porque no pertenece a ninguna: es de la app
   * entera, tiene que pasar entre en la pantalla que entre, y tiene que pasar
   * una sola vez y no cada vez que el vendedor vuelve al menú. Va antes del
   * corte de arriba porque un hook no puede quedar del otro lado de un return.
   */
  usarAvisoDeApkAlEntrar(estado === 'habilitado')

  /**
   * El candado del teléfono.
   *
   * Va acá por lo mismo que el aviso de la app nueva: es de la app entera y no
   * de una pantalla. Y va ANTES del corte de abajo porque un hook no puede
   * quedar del otro lado de un return.
   */
  const candado = usarCandado(estado === 'habilitado')

  if (estado === 'cargando') {
    return (
      <Pantalla>
        <Cargando texto="Verificando tu cuenta…" />
      </Pantalla>
    )
  }

  /*
   * Con el candado puesto no se dibuja la app.
   *
   * Se devuelve otra cosa en vez de tapar con un modal: un modal encima del
   * navegador deja las pantallas montadas y sus datos en memoria, y lo que hay
   * que cerrar es el acceso a lo que se ve, no sólo a lo que se toca.
   */
  if (candado.bloqueado) {
    return (
      <Pantalla>
        <Panel>
          <TituloPanel>WOODTOOLS</TituloPanel>
          <Aviso tono="info" titulo="Desbloqueá para entrar">
            Usá la huella, la cara o el PIN del teléfono. Es la misma llave con la que abrís el
            resto del equipo.
          </Aviso>
          <BotonMenu
            titulo="DESBLOQUEAR"
            alTocar={() => void candado.desbloquear()}
            cargando={candado.verificando}
          />
        </Panel>
      </Pantalla>
    )
  }

  return (
    <NavigationContainer theme={temaDeLaNavegacion(tema)}>
      <Pila.Navigator screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
        {estado === 'sin_sesion' ? (
          <Pila.Screen name="Menu" component={PantallaIniciarSesion} />
        ) : estado === 'debe_cambiar_contrasena' ? (
          // Pantalla propia y no un cartel: de acá no se sale sin cambiarla.
          <Pila.Screen name="Menu" component={PantallaCambiarContrasena} />
        ) : estado !== 'habilitado' ? (
          <Pila.Screen name="Menu" component={PantallaEstadoCuenta} />
        ) : (
          <>
            <Pila.Screen name="Menu" component={PantallaMenu} />
            <Pila.Screen name="Visitas" component={PantallaVisitas} />
            <Pila.Screen name="Recorrido" component={PantallaRecorrido} />
            <Pila.Screen name="DestinoVisitado" component={PantallaDestinoVisitado} />
            <Pila.Screen name="AgregarDestino" component={PantallaAgregarDestino} />
            <Pila.Screen name="Historial" component={PantallaHistorial} />
            <Pila.Screen name="DetalleVisita" component={PantallaDetalleVisita} />
            <Pila.Screen name="Configuracion" component={PantallaConfiguracion} />
            <Pila.Screen name="NotasPedido" component={PantallaNotasPedido} />
            <Pila.Screen name="GenerarNota" component={PantallaGenerarNota} />
            <Pila.Screen name="NuevoCliente" component={PantallaNuevoCliente} />
            <Pila.Screen name="NotasPendientes" component={PantallaNotasPendientes} />
            <Pila.Screen name="Cobranzas" component={PantallaCobranzas} />
            <Pila.Screen name="CalendarioEnvios" component={PantallaCalendarioEnvios} />
            <Pila.Screen name="CalendarioVisitas" component={PantallaCalendarioVisitas} />
            <Pila.Screen name="ComunicacionInterna" component={PantallaComunicacionInterna} />
            <Pila.Screen name="ReportarProblema" component={PantallaReportarProblema} />
            <Pila.Screen name="ClientesDelDia" component={PantallaClientesDelDia} />
            <Pila.Screen name="NotasImpresas" component={PantallaNotasImpresas} />
            <Pila.Screen name="HistorialNotas" component={PantallaHistorialNotas} />
            <Pila.Screen name="DetalleNota" component={PantallaDetalleNota} />
            <Pila.Screen name="VistaPrevia" component={PantallaVistaPreviaNota} />
            <Pila.Screen name="EnPreparacion" component={PantallaEnPreparacion} />
          </>
        )}
      </Pila.Navigator>
    </NavigationContainer>
  )
}
