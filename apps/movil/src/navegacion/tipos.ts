import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import type { ModoDestino } from '@woodtools/compartido'

/** Rutas de la app y qué parámetros espera cada una. */
export type ParametrosApp = {
  Menu: undefined
  Visitas: undefined
  /** `iniciar` viene en true cuando se llega desde "INICIAR RECORRIDO". */
  Recorrido: { iniciar?: boolean } | undefined
  DestinoVisitado: { paradaId: string }
  /** Sin `modo` muestra el selector entre cliente existente y cliente nuevo. */
  AgregarDestino: { volverA?: 'Visitas' | 'Recorrido'; modo?: ModoDestino }
  Historial: undefined
  DetalleVisita: { rolVisitaId: string; paradaId: string; fecha: string }
  Configuracion: undefined
  EnPreparacion: { modulo: string }
}

export type PropsPantalla<T extends keyof ParametrosApp> = NativeStackScreenProps<ParametrosApp, T>
