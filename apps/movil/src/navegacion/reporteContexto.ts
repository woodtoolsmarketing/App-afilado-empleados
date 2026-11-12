import type { ParametrosApp } from './tipos'

/**
 * De qué pantalla y sobre qué problema se reporta, según la ruta donde está
 * parado el vendedor.
 *
 * Lo usa el ícono "⚠" del Encabezado, que está en TODAS las pantallas: así
 * reportar es un toque desde donde se dio el problema, sin volver al menú ni
 * tener que elegir a mano de qué se trata. `motivo` se deja elegido cuando la
 * pantalla tiene un problema claro (cobranzas → "cobranzas"); donde una misma
 * pantalla junta varios problemas —la nota: un precio, un código, que no
 * guardó, la impresión— se OMITE a propósito, para que el vendedor elija en el
 * desplegable. Cambiar esto es cambiar este archivo: no hay enum ni migración.
 */
export interface ContextoDeReporte {
  /** Nombre legible de la pantalla, para el campo `pantalla` del reporte. */
  pantalla: string
  /** El motivo de `MOTIVOS_DE_PROBLEMA` a dejar elegido, si la pantalla tiene uno claro. */
  motivo?: string
}

const POR_RUTA: Partial<Record<keyof ParametrosApp, ContextoDeReporte>> = {
  Menu: { pantalla: 'Menú principal' },

  // Visitas / recorrido del día
  Visitas: { pantalla: 'Visitas del día', motivo: 'visitas' },
  ClientesDelDia: { pantalla: 'Clientes del día', motivo: 'visitas' },
  CalendarioVisitas: { pantalla: 'Calendario de visitas', motivo: 'visitas' },
  CalendarioEnvios: { pantalla: 'Agenda de envíos', motivo: 'visitas' },
  ListaSemanal: { pantalla: 'Lista semanal', motivo: 'visitas' },
  DetalleVisita: { pantalla: 'Detalle de la visita', motivo: 'visitas' },
  DestinoVisitado: { pantalla: 'Parte de la visita', motivo: 'visitas' },
  Historial: { pantalla: 'Historial de visitas', motivo: 'visitas' },

  // Mapa / ubicaciones
  Recorrido: { pantalla: 'Recorrido', motivo: 'mapa' },
  MapaClientes: { pantalla: 'Mapa de clientes', motivo: 'mapa' },
  CorregirDireccion: { pantalla: 'Corregir dirección', motivo: 'mapa' },

  // Clientes
  AgregarDestino: { pantalla: 'Agregar destino', motivo: 'cliente' },
  NuevoCliente: { pantalla: 'Nuevo cliente', motivo: 'cliente' },
  EditarProspecto: { pantalla: 'Editar cliente provisorio', motivo: 'cliente' },

  // Notas de pedido — varios problemas posibles: sin motivo, elige el vendedor.
  GenerarNota: { pantalla: 'Generar nota de pedido' },
  NotasPedido: { pantalla: 'Notas de pedido' },
  NotasPendientes: { pantalla: 'Notas pendientes', motivo: 'no_guarda' },
  HistorialNotas: { pantalla: 'Historial de notas' },
  DetalleNota: { pantalla: 'Detalle de la nota' },

  // Impresión
  MisImpresiones: { pantalla: 'Mis impresiones', motivo: 'impresion' },
  NotasImpresas: { pantalla: 'Notas impresas', motivo: 'impresion' },
  RolDeVisita: { pantalla: 'Rol de visita', motivo: 'impresion' },
  VistaPrevia: { pantalla: 'Vista previa de impresión', motivo: 'impresion' },

  // Cobranzas
  Cobranzas: { pantalla: 'Cobranzas', motivo: 'cobranzas' },

  // Consulta / configuración / administración
  StockDisponible: { pantalla: 'Stock disponible' },
  ComunicacionInterna: { pantalla: 'Comunicación interna' },
  Cuentas: { pantalla: 'Cuentas' },
  Configuracion: { pantalla: 'Configuración' },
  AdminUsuarios: { pantalla: 'Administración de usuarios' },
  AdminClientes: { pantalla: 'Administración de clientes', motivo: 'cliente' },
  AdminModificaciones: { pantalla: 'Auditoría de modificaciones' },
}

/**
 * El contexto del reporte para la ruta donde está parado el vendedor. Para una
 * ruta sin mapear cae al nombre de la ruta y sin motivo (el desplegable). Nunca
 * falla: el ícono tiene que andar en cualquier pantalla, mapeada o no.
 */
export function contextoDeReporte(ruta: string): ContextoDeReporte {
  return POR_RUTA[ruta as keyof ParametrosApp] ?? { pantalla: ruta }
}
