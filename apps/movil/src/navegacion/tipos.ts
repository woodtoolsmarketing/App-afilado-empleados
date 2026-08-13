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

  // ── Notas de pedido (Paso 2) ──────────────────────────────────────────────
  NotasPedido: undefined
  /**
   * Al volver de "Generar nuevo cliente" llega el cliente ya creado. La
   * localidad y la provincia vienen para que la nota le asigne la zona sola,
   * igual que cuando el cliente ya existía.
   */
  GenerarNota:
    | {
        /**
         * Con esto la pantalla abre cargada con una nota que todavía no se
         * imprimió, para corregirla, en vez de empezar una nueva.
         */
        notaId?: string
        clienteCreadoId?: string
        clienteCreadoNombre?: string
        clienteCreadoCuit?: string
        clienteCreadoLocalidad?: string
        clienteCreadoProvincia?: string
        clienteCreadoDireccion?: string
      }
    | undefined
  NuevoCliente: { nombreInicial?: string; documentoInicial?: string } | undefined
  NotasPendientes: undefined
  /** Las que ya salieron en papel. Se miran y se reimprimen; no se editan. */
  NotasImpresas: undefined
  HistorialNotas: undefined
  DetalleNota: { notaId: string }
  /** Lo que va a salir en papel, antes de mandarlo a la impresora. */
  VistaPrevia: { notaIds: string[]; incluirRolDeVisita?: boolean }
}

export type PropsPantalla<T extends keyof ParametrosApp> = NativeStackScreenProps<ParametrosApp, T>
