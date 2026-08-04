import type { NativeStackScreenProps } from '@react-navigation/native-stack'

/** Rutas de la app y qué parámetros espera cada una. */
export type ParametrosApp = {
  Menu: undefined
  Envios: undefined
  /** `iniciar` viene en true cuando se llega desde "INICIAR RECORRIDO". */
  Recorrido: { iniciar?: boolean } | undefined
  DestinoVisitado: { paradaId: string }
  AgregarDestino: { volverA?: 'Envios' | 'Recorrido' }
  Historial: undefined
  DetalleEnvio: { rolVisitaId: string; paradaId: string; fecha: string }
  Configuracion: undefined
  EnPreparacion: { modulo: string }
}

export type PropsPantalla<T extends keyof ParametrosApp> = NativeStackScreenProps<ParametrosApp, T>
