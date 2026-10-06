import {
  Poppins_400Regular,
  Poppins_500Medium,
  Poppins_600SemiBold,
  Poppins_700Bold,
  Poppins_800ExtraBold,
  useFonts,
} from '@expo-google-fonts/poppins'
import { focusManager, QueryClientProvider } from '@tanstack/react-query'
import { StatusBar } from 'expo-status-bar'
import * as SplashScreen from 'expo-splash-screen'
import { useEffect } from 'react'
import { AppState } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'

import { DescargaDeApk } from './src/componentes/DescargaDeApk'
import { Navegacion } from './src/navegacion/Navegacion'
import { clienteConsultas } from './src/nucleo/consultas'
import { usarSesion } from './src/nucleo/sesion'
import { usarAjustesDeTema, usarTema } from './src/nucleo/tema'
import { supabase } from './src/nucleo/supabase'

// Se importa también por su efecto secundario: registra la tarea de segundo
// plano. TaskManager exige que la definición corra en el arranque, antes de que
// el sistema pueda despertar la app para entregar ubicaciones.
import {
  ofrecerAjustarBateriaSiFalta,
  pedirPermisoDeSeguimientoSiFalta,
  revisarSeguimiento,
} from './src/servicios/ubicacion'

void SplashScreen.preventAutoHideAsync()

export default function App() {
  const arrancar = usarSesion((s) => s.arrancar)
  const estado = usarSesion((s) => s.estado)

  /**
   * El tema se lee del teléfono antes de dibujar nada.
   *
   * Está arriba de todo y bloquea el primer dibujado a propósito: leer
   * AsyncStorage es asíncrono, así que si la app arrancara mientras tanto,
   * el que eligió el tema oscuro vería medio segundo de pantalla roja antes
   * de que se acomode. Medio segundo alcanza para que parezca que algo falló.
   */
  const cargarTema = usarAjustesDeTema((s) => s.cargar)
  const temaListo = usarAjustesDeTema((s) => s.listo)
  const tema = usarTema()

  useEffect(() => {
    void cargarTema()
  }, [cargarTema])

  const [fuentesListas] = useFonts({
    Poppins_400Regular,
    Poppins_500Medium,
    Poppins_600SemiBold,
    Poppins_700Bold,
    Poppins_800ExtraBold,
  })

  useEffect(() => {
    void arrancar()
  }, [arrancar])

  useEffect(() => {
    if (fuentesListas && temaListo && estado !== 'cargando') void SplashScreen.hideAsync()
  }, [fuentesListas, temaListo, estado])

  // Sin esto, el token deja de renovarse cuando la app queda en segundo plano
  // y el vendedor vuelve a una sesión vencida a mitad del recorrido.
  //
  // Y de paso avisamos a React Query cuándo la app vuelve al frente: en React
  // Native, `refetchOnWindowFocus` (ya puesto en Menu y NotasPedido) no hace
  // nada hasta que se conecta el focusManager a AppState. Con esto, al volver
  // de una llamada o del bolsillo, las pantallas montadas se refrescan solas si
  // los datos ya están viejos (staleTime 30s) — por ejemplo si la oficina movió
  // un destino mientras tanto. Reusamos este mismo listener para no suscribir
  // AppState dos veces.
  useEffect(() => {
    const suscripcion = AppState.addEventListener('change', (siguiente) => {
      const activo = siguiente === 'active'
      focusManager.setFocused(activo)
      if (activo) supabase.auth.startAutoRefresh()
      else supabase.auth.stopAutoRefresh()
      // Seguimiento continuo (Fase 1): al volver al frente se revisa si hay que
      // prender (horario laboral + habilitado) o apagar (fuera de horario, o
      // dejó de estar habilitado) el seguimiento de jornada.
      if (activo) {
        void revisarSeguimiento(usarSesion.getState().estado === 'habilitado')
      }
    })
    supabase.auth.startAutoRefresh()
    return () => suscripcion.remove()
  }, [])

  // Seguimiento continuo (Fase 1): cuando cambia el acceso, se revisa. Al quedar
  // habilitado se pide el permiso "siempre" si falta (una vez) y arranca si es
  // horario laboral. Si DEJÓ de estar habilitado (versión vieja, dispositivo
  // desautorizado, suspensión) sin cerrar sesión, `revisarSeguimiento` lo corta.
  useEffect(() => {
    if (estado === 'cargando') return
    const habilitado = estado === 'habilitado'
    void (async () => {
      if (habilitado) {
        await pedirPermisoDeSeguimientoSiFalta()
        // Fase 2: una vez concedido el permiso, ofrecer sacar la app de la
        // optimización de batería (lo que evita que Samsung mate el servicio).
        await ofrecerAjustarBateriaSiFalta()
      }
      await revisarSeguimiento(habilitado)
    })()
  }, [estado])

  // Un reloj cada pocos minutos revisa el seguimiento: cubre cruzar las 8 o las
  // 17 con la app abierta y quieta, cuando no hay un cambio de foco ni un punto
  // nuevo que dispare el arranque o el corte.
  useEffect(() => {
    const t = setInterval(
      () => void revisarSeguimiento(usarSesion.getState().estado === 'habilitado'),
      5 * 60_000,
    )
    return () => clearInterval(t)
  }, [])

  if (!fuentesListas || !temaListo) return null

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={clienteConsultas}>
        {/* Clara en los dos temas: abajo hay rojo intenso o casi negro. */}
        <StatusBar style="light" backgroundColor={tema.colores.fondo} />
        <Navegacion />
        {/* El modal de "bajando la actualización", global: la descarga puede
            arrancar desde cualquier pantalla (ofrecerApk) y el progreso se sigue
            viendo aunque el vendedor navegue. */}
        <DescargaDeApk />
      </QueryClientProvider>
    </SafeAreaProvider>
  )
}
