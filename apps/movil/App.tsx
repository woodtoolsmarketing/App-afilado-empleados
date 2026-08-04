import {
  Poppins_400Regular,
  Poppins_500Medium,
  Poppins_600SemiBold,
  Poppins_700Bold,
  Poppins_800ExtraBold,
  useFonts,
} from '@expo-google-fonts/poppins'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StatusBar } from 'expo-status-bar'
import * as SplashScreen from 'expo-splash-screen'
import { useEffect } from 'react'
import { AppState } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'

import { Navegacion } from './src/navegacion/Navegacion'
import { usarSesion } from './src/nucleo/sesion'
import { supabase } from './src/nucleo/supabase'

// Se importa por su efecto secundario: registra la tarea de segundo plano.
// TaskManager exige que la definición corra en el arranque, antes de que el
// sistema pueda despertar la app para entregar ubicaciones.
import './src/servicios/ubicacion'

void SplashScreen.preventAutoHideAsync()

const clienteConsultas = new QueryClient({
  defaultOptions: {
    queries: {
      // El vendedor trabaja con señal intermitente: mejor mostrar lo último
      // que tenemos que una pantalla vacía.
      staleTime: 30_000,
      retry: 2,
      refetchOnReconnect: true,
    },
  },
})

export default function App() {
  const arrancar = usarSesion((s) => s.arrancar)
  const estado = usarSesion((s) => s.estado)

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
    if (fuentesListas && estado !== 'cargando') void SplashScreen.hideAsync()
  }, [fuentesListas, estado])

  // Sin esto, el token deja de renovarse cuando la app queda en segundo plano
  // y el vendedor vuelve a una sesión vencida a mitad del recorrido.
  useEffect(() => {
    const suscripcion = AppState.addEventListener('change', (siguiente) => {
      if (siguiente === 'active') supabase.auth.startAutoRefresh()
      else supabase.auth.stopAutoRefresh()
    })
    supabase.auth.startAutoRefresh()
    return () => suscripcion.remove()
  }, [])

  if (!fuentesListas) return null

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={clienteConsultas}>
        <StatusBar style="light" backgroundColor="#B30F0F" />
        <Navegacion />
      </QueryClientProvider>
    </SafeAreaProvider>
  )
}
