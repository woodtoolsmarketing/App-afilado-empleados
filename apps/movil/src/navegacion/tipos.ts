import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import type { ModoDestino } from '@woodtools/compartido'

/**
 * Las partes de CONFIGURACIÓN que se abren adentro de la pantalla.
 *
 * "Reportar un problema" es la cuarta opción del mockup y no está acá: es una
 * pantalla propia, porque se llega también desde el menú de las tres rayas y
 * desde el enlace "¿No se te actualizó?".
 */
export type SeccionDeConfiguracion = 'tamano' | 'tema' | 'actualizaciones'

/** Rutas de la app y qué parámetros espera cada una. */
export type ParametrosApp = {
  Menu: undefined
  Visitas: undefined
  /** `iniciar` viene en true cuando se llega desde "INICIAR RECORRIDO". */
  Recorrido: { iniciar?: boolean } | undefined
  DestinoVisitado: { paradaId: string }
  /** Sin `modo` muestra el selector entre cliente existente y cliente nuevo. */
  /**
   * `fecha` (ISO, "2026-08-28") agenda el destino para OTRO día en vez de para
   * hoy. Es lo que usa el calendario de envíos: la pantalla de agregar es la
   * misma —con su buscador, su alta de cliente nuevo y su ubicación en el
   * mapa—, sólo cambia en qué jornada cae.
   */
  AgregarDestino: {
    volverA?: 'Visitas' | 'Recorrido' | 'CalendarioEnvios' | 'CalendarioVisitas'
    modo?: ModoDestino
    fecha?: string
    /**
     * Con quién arranca escrito el buscador de clientes.
     *
     * Lo usa el calendario cuando ofrece "UBICARLO EN EL MAPA" sobre un cliente
     * que el plan sugiere y todavía no tiene dirección: ese cliente ya está
     * nombrado en la pantalla de la que se viene, y hacérselo tipear de nuevo
     * sería pedirle que busque lo que acaba de señalar.
     */
    buscarA?: string
  }
  /** La agenda: qué hay comprometido para los próximos días. */
  CalendarioEnvios: undefined
  /**
   * La semana completa: a quién hay que ver cada día y a qué hora.
   *
   * `fecha` (ISO) abre parado en la semana de ese día en vez de en la de hoy.
   * Lo usa el que viene de otra pantalla mirando una fecha puntual.
   */
  CalendarioVisitas: { fecha?: string } | undefined
  /** Los teléfonos de la oficina, para llamar o escribir por WhatsApp. */
  ComunicacionInterna: undefined
  /** A quién toca visitar hoy según el rol maestro, para armar el recorrido. */
  ClientesDelDia: undefined
  Historial: undefined
  DetalleVisita: { rolVisitaId: string; paradaId: string; fecha: string }
  /**
   * `seccion` abre directo en una de las cuatro partes.
   *
   * Es lo que necesita "BUSCAR ACTUALIZACIÓN" del menú de las tres rayas: si
   * abriera la configuración en su portada, el que la eligió tendría que
   * volver a elegirla adentro.
   */
  Configuracion: { seccion?: SeccionDeConfiguracion } | undefined
  /**
   * Contar un problema.
   *
   * `motivo` lo deja elegido de entrada: lo usa el enlace "¿No se te
   * actualizó?", donde el vendedor ya dijo cuál es el problema al tocarlo y
   * volver a preguntárselo sería no haberlo escuchado.
   */
  ReportarProblema: { motivo?: string; pantalla?: string } | undefined
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
        /**
         * Desde qué parada del rol de visita se está generando.
         *
         * Queda guardado en la nota: es lo que permite después contar en la
         * observación de la visita qué se vendió, y saber si la nota se hizo
         * en el lugar.
         */
        paradaId?: string
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
  /**
   * La rendición de cobranzas del día.
   *
   * Los parámetros llegan cuando se entra desde una nota: el formulario abre
   * con el cliente y el comprobante ya puestos, que es lo que el vendedor tiene
   * delante cuando cobra.
   */
  Cobranzas:
    | {
        notaId?: string
        clienteId?: string | null
        clienteCodigo?: string | null
        clienteNombre?: string
        tipoComprobante?: 'factura' | 'presupuesto'
      }
    | undefined
  /** Las que ya salieron en papel. Se miran y se reimprimen; no se editan. */
  NotasImpresas: undefined
  HistorialNotas: undefined
  DetalleNota: { notaId: string }
  /** Lo que va a salir en papel, antes de mandarlo a la impresora. */
  VistaPrevia: { notaIds: string[]; incluirRolDeVisita?: boolean }
}

export type PropsPantalla<T extends keyof ParametrosApp> = NativeStackScreenProps<ParametrosApp, T>
