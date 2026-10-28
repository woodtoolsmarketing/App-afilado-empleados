/**
 * Catálogo de opciones/secciones para la telemetría de tiempos de uso.
 *
 * Fuente única de las ETIQUETAS legibles que muestra el mapa de calor del panel.
 * La app identifica cada opción con el NOMBRE DE RUTA de React Navigation; el
 * panel, con el PATHNAME del router. Las sub-opciones de la nota de pedido (el
 * asistente de 3 pasos, más el buscador de artículos y el guardado) se miden
 * aparte, bajo la sección 'GenerarNota'.
 *
 * Es TypeScript puro: lo consumen el móvil (RN), el panel (navegador) y el
 * reporte, sin dependencias de plataforma.
 */

export type PlataformaTelemetria = 'app' | 'panel'

/**
 * Un tramo de uso, tal como lo encola el cliente y lo recibe la RPC
 * `registrar_eventos_telemetria`. El servidor fuerza el `perfil_id` (= auth.uid)
 * y el `registrado_en`: acá sólo viaja lo que midió el equipo.
 */
export interface EventoTelemetria {
  plataforma: PlataformaTelemetria
  /** Nombre de ruta (app) o pathname (panel). */
  seccion: string
  /** Sub-paso dentro de la sección (p.ej. los pasos de la nota). Null = la pantalla entera. */
  paso?: string | null
  /** Inicio del tramo, con el reloj del dispositivo (ISO 8601). */
  inicio: string
  /** Cuánto duró el tramo, en milisegundos (el servidor lo clampa a 0..24h). */
  duracion_ms: number
  metadata?: Record<string, unknown>
  version_app?: string | null
  dispositivo_id?: string | null
}

/** La sección bajo la que se agrupan los sub-pasos de la nota de pedido. */
export const SECCION_NOTA = 'GenerarNota'

/**
 * Sub-pasos del asistente de la nota de pedido. El usuario pidió medir "cuánto
 * tiempo toma hacer la nota" y el detalle entre opciones: estos son esos tramos.
 */
export const PASOS_NOTA: Record<string, string> = {
  cliente: '1 · Cliente',
  herramienta: '2 · Herramienta',
  buscar_articulo: 'Buscar artículo',
  facturacion: '3 · Facturación',
  guardar: 'Guardar',
}

/** Ruta de la app (React Navigation) → etiqueta legible para el reporte. */
export const OPCIONES_APP: Record<string, string> = {
  Menu: 'Menú principal',
  Visitas: 'Visitas',
  Recorrido: 'Mapa del recorrido',
  DestinoVisitado: 'Destino visitado (parte)',
  AgregarDestino: 'Agregar destino',
  CorregirDireccion: 'Corregir dirección',
  Historial: 'Historial de visitas',
  DetalleVisita: 'Detalle de visita',
  Configuracion: 'Configuración',
  Cuentas: 'Cambiar de cuenta',
  NotasPedido: 'Notas de pedido',
  GenerarNota: 'Crear nota de pedido',
  NuevoCliente: 'Alta de cliente',
  NotasPendientes: 'Imprimir notas de pedido',
  Cobranzas: 'Cobranzas',
  CalendarioEnvios: 'Próximas visitas',
  CalendarioVisitas: 'Calendario de visitas',
  ComunicacionInterna: 'Comunicación interna',
  ReportarProblema: 'Reportar un problema',
  ClientesDelDia: 'Clientes de hoy',
  ListaSemanal: 'Lista semanal',
  MapaClientes: 'Mapa (todos los clientes)',
  RolDeVisita: 'Imprimir rol de visita',
  MisImpresiones: 'Mis impresiones',
  AdminUsuarios: 'Usuarios y teléfonos',
  AdminClientes: 'Clientes (cartera)',
  AdminModificaciones: 'Modificaciones de clientes',
  NotasImpresas: 'Notas impresas',
  HistorialNotas: 'Historial de notas de pedido',
  DetalleNota: 'Detalle de nota',
  VistaPrevia: 'Vista previa de impresión',
  EnPreparacion: 'En preparación',
}

/** Pathname del panel (HashRouter) → etiqueta legible. */
export const OPCIONES_PANEL: Record<string, string> = {
  '/': 'Tablero',
  '/mapa': 'Mapa en vivo',
  '/clientes-mapa': 'Mapa de clientes',
  '/notas': 'Notas de pedido',
  '/cola-impresion': 'Cola de impresión',
  '/roles': 'Roles de visita',
  '/cobranzas': 'Cobranzas de los vendedores',
  '/rol-maestro': 'Rol maestro',
  '/clientes': 'Clientes',
  '/permisos-edicion': 'Ediciones de clientes',
  '/clientes-a-confirmar': 'Clientes a confirmar',
  '/modificaciones': 'Modificaciones',
  '/cambios-direccion': 'Cambios de dirección',
  '/lugares-entrega': 'Lugares de entrega a cargar',
  '/usuarios': 'Usuarios',
  '/permisos': 'Permisos',
  '/a-confirmar': 'Artículos a confirmar',
  '/problemas': 'Problemas',
  '/actualizaciones': 'Actualizaciones',
  '/reporte-tiempos': 'Reporte de tiempos',
}

/** Etiqueta legible de un paso de la nota (o el id crudo si no está en el catálogo). */
export function etiquetaDePaso(paso: string): string {
  return PASOS_NOTA[paso] ?? paso
}

/**
 * Etiqueta legible de una opción (con su sub-paso si lo hay). Cae al id crudo
 * cuando la ruta/pathname no está en el catálogo, así una opción nueva igual se
 * ve en el reporte sin quedar oculta.
 */
export function etiquetaDeOpcion(
  plataforma: PlataformaTelemetria,
  seccion: string,
  paso?: string | null,
): string {
  const base =
    plataforma === 'app' ? (OPCIONES_APP[seccion] ?? seccion) : (OPCIONES_PANEL[seccion] ?? seccion)
  return paso ? `${base} · ${etiquetaDePaso(paso)}` : base
}
