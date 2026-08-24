import { colores } from '@woodtools/compartido'
import { NavigationContainer, type Theme } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'

import { Cargando } from '../componentes/Estado'
import { Pantalla } from '../componentes/Pantalla'
import { usarSesion } from '../nucleo/sesion'
import { PantallaAgregarDestino } from '../pantallas/AgregarDestino'
import { PantallaCobranzas } from '../pantallas/Cobranzas'
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
import { usarAvisoDeApkAlEntrar } from '../servicios/avisoDeApk'
import type { ParametrosApp } from './tipos'

const Pila = createNativeStackNavigator<ParametrosApp>()

const tema: Theme = {
  dark: false,
  colors: {
    primary: colores.rojo,
    background: colores.rojo,
    card: colores.rojo,
    text: colores.blanco,
    border: colores.negro,
    notification: colores.rojoAccion,
  },
  fonts: {
    regular: { fontFamily: 'Poppins_400Regular', fontWeight: '400' },
    medium: { fontFamily: 'Poppins_500Medium', fontWeight: '500' },
    bold: { fontFamily: 'Poppins_700Bold', fontWeight: '700' },
    heavy: { fontFamily: 'Poppins_800ExtraBold', fontWeight: '800' },
  },
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

  /**
   * Fijarse solo si hay un instalador nuevo.
   *
   * Va acá y no en una pantalla porque no pertenece a ninguna: es de la app
   * entera, tiene que pasar entre en la pantalla que entre, y tiene que pasar
   * una sola vez y no cada vez que el vendedor vuelve al menú. Va antes del
   * corte de arriba porque un hook no puede quedar del otro lado de un return.
   */
  usarAvisoDeApkAlEntrar(estado === 'habilitado')

  if (estado === 'cargando') {
    return (
      <Pantalla>
        <Cargando texto="Verificando tu cuenta…" />
      </Pantalla>
    )
  }

  return (
    <NavigationContainer theme={tema}>
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
