/**
 * Tipos del dominio. Espejo de los enums y tablas de `supabase/migrations`.
 *
 * Cuando cambie el esquema, regenerá `base-de-datos.ts` con:
 *   npm run tipos
 * y ajustá acá lo que haga falta.
 */

export type RolUsuario = 'vendedor' | 'supervisor' | 'admin'

export type EstadoUsuario =
  | 'pendiente'
  | 'aprobado'
  | 'rechazado'
  | 'suspendido'
  | 'baja'

export type EstadoRolVisita = 'planificado' | 'en_curso' | 'finalizado' | 'cancelado'

export type PrioridadParada = 'alta' | 'media' | 'baja'

export type EstadoParada =
  | 'pendiente'
  | 'en_camino'
  | 'visitada'
  | 'no_visitada'
  | 'omitida'

export type OrigenParada = 'planificada' | 'agregada_en_ruta'

export type MotivoNoVisita = 'cliente_ausente' | 'direccion_erronea'

export type OrigenObservacion = 'texto' | 'voz'

// ─────────────────────────────────────────────────────────────────────────────
// Etiquetas legibles — se usan en la UI para no repetir strings sueltos
// ─────────────────────────────────────────────────────────────────────────────

export const ETIQUETA_MOTIVO_NO_VISITA: Record<MotivoNoVisita, string> = {
  cliente_ausente: 'El cliente no estaba',
  direccion_erronea: 'Dirección errónea',
}

export const ETIQUETA_PRIORIDAD: Record<PrioridadParada, string> = {
  alta: 'ALTA',
  media: 'MEDIA',
  baja: 'BAJA',
}

export const DESCRIPCION_PRIORIDAD: Record<PrioridadParada, string> = {
  alta: 'Se visita a continuación, sin importar la distancia',
  media: 'Se intercala unos destinos más adelante',
  baja: 'Se acomoda por cercanía junto al resto',
}

export const ETIQUETA_ESTADO_PARADA: Record<EstadoParada, string> = {
  pendiente: 'Pendiente',
  en_camino: 'En camino',
  visitada: 'Visitada',
  no_visitada: 'No visitada',
  omitida: 'Sin visitar',
}

export const ETIQUETA_ESTADO_USUARIO: Record<EstadoUsuario, string> = {
  pendiente: 'Esperando aprobación',
  aprobado: 'Habilitado',
  rechazado: 'Rechazado',
  suspendido: 'Suspendido',
  baja: 'Dado de baja',
}

// ─────────────────────────────────────────────────────────────────────────────
// Entidades
// ─────────────────────────────────────────────────────────────────────────────

export interface Perfil {
  id: string
  rol: RolUsuario
  estado: EstadoUsuario
  nombre_completo: string
  codigo_vendedor: string | null
  email: string
  telefono: string | null
  foto_url: string | null
  origen_lat: number | null
  origen_lng: number | null
  origen_descripcion: string | null
  aprobado_por: string | null
  aprobado_en: string | null
  motivo_rechazo: string | null
  ultimo_acceso_en: string | null
  creado_en: string
  actualizado_en: string
}

export interface Dispositivo {
  id: string
  perfil_id: string
  instalacion_id: string
  fabricante: string | null
  modelo: string | null
  version_so: string | null
  version_app: string | null
  autorizado: boolean
  autorizado_por: string | null
  autorizado_en: string | null
  push_token: string | null
  ultimo_visto_en: string | null
  creado_en: string
}

export interface Cliente {
  id: string
  codigo: string
  razon_social: string
  nombre_fantasia: string | null
  cuit: string | null
  telefono: string | null
  email: string | null
  contacto_nombre: string | null
  vendedor_id: string | null
  activo: boolean
  notas: string | null
  creado_en: string
  actualizado_en: string
}

export interface Direccion {
  id: string
  cliente_id: string | null
  etiqueta: string
  direccion_formateada: string
  calle: string | null
  numero: string | null
  piso: string | null
  depto: string | null
  localidad: string | null
  provincia: string | null
  pais: string
  codigo_postal: string | null
  lat: number
  lng: number
  google_place_id: string | null
  verificada: boolean
  principal: boolean
  observaciones: string | null
}

export interface RolVisita {
  id: string
  vendedor_id: string
  fecha: string
  estado: EstadoRolVisita
  iniciado_en: string | null
  finalizado_en: string | null
  origen_lat: number | null
  origen_lng: number | null
  distancia_total_m: number | null
  duracion_total_seg: number | null
  polilinea: string | null
  optimizado_en: string | null
  observaciones_jornada: string | null
}

export interface Parada {
  id: string
  rol_visita_id: string
  cliente_id: string | null
  direccion_id: string
  orden: number
  prioridad: PrioridadParada
  origen: OrigenParada
  estado: EstadoParada
  hora_estimada: string | null
  distancia_desde_anterior_m: number | null
  duracion_desde_anterior_seg: number | null
  llegada_en: string | null
  salida_en: string | null
  razon_social_snapshot: string | null
  direccion_snapshot: string | null
}

/** Parada con el cliente y la dirección ya resueltos: lo que consume la UI. */
export interface ParadaCompleta extends Parada {
  cliente: Pick<Cliente, 'id' | 'codigo' | 'razon_social' | 'contacto_nombre' | 'telefono'> | null
  direccion: Direccion
  visita: Visita | null
}

export interface Visita {
  id: string
  parada_id: string
  rol_visita_id: string
  vendedor_id: string
  cliente_id: string | null
  visitado: boolean
  vendio: boolean
  cobro: boolean
  retiro_afilado: boolean
  entrego: boolean
  motivo_no_visita: MotivoNoVisita | null
  contacto_nombre: string | null
  observacion: string
  observacion_origen: OrigenObservacion
  observacion_audio_url: string | null
  lat: number | null
  lng: number | null
  precision_m: number | null
  desvio_m: number | null
  registrado_en: string
}

export interface PosicionActual {
  vendedor_id: string
  rol_visita_id: string | null
  lat: number
  lng: number
  precision_m: number | null
  velocidad_mps: number | null
  rumbo: number | null
  bateria_pct: number | null
  en_recorrido: boolean
  actualizado_en: string
}

export interface ResumenJornada {
  rol_visita_id: string
  vendedor_id: string
  fecha: string
  estado: EstadoRolVisita
  iniciado_en: string | null
  finalizado_en: string | null
  distancia_total_m: number | null
  duracion_total_seg: number | null
  total_paradas: number
  pendientes: number
  en_camino: number
  visitadas: number
  no_visitadas: number
  omitidas: number
  con_venta: number
  con_cobro: number
  con_retiro_afilado: number
  con_entrega: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Formularios
// ─────────────────────────────────────────────────────────────────────────────

/** Formulario "¿DESTINO VISITADO?" */
export interface FormularioVisita {
  visitado: boolean | null
  vendio: boolean
  cobro: boolean
  retiro_afilado: boolean
  entrego: boolean
  motivo_no_visita: MotivoNoVisita | null
  contacto_nombre: string
  observacion: string
  observacion_origen: OrigenObservacion
}

export const FORMULARIO_VISITA_VACIO: FormularioVisita = {
  visitado: null,
  vendio: false,
  cobro: false,
  retiro_afilado: false,
  entrego: false,
  motivo_no_visita: null,
  contacto_nombre: '',
  observacion: '',
  observacion_origen: 'texto',
}

/** Formulario "AGREGAR NUEVO DESTINO" */
export interface FormularioDestino {
  direccion_formateada: string
  codigo_postal: string
  prioridad: PrioridadParada | null
  lat: number | null
  lng: number | null
  google_place_id: string | null
  cliente_id: string | null
  localidad: string | null
  provincia: string | null
}

export const FORMULARIO_DESTINO_VACIO: FormularioDestino = {
  direccion_formateada: '',
  codigo_postal: '',
  prioridad: null,
  lat: null,
  lng: null,
  google_place_id: null,
  cliente_id: null,
  localidad: null,
  provincia: null,
}

/** Resultado de una validación: qué campos están mal y por qué. */
export interface ResultadoValidacion<C extends string = string> {
  valido: boolean
  errores: Partial<Record<C, string>>
}
