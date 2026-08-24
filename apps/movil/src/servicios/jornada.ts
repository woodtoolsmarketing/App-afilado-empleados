import { fechaLocalISO } from '@woodtools/compartido'
import type {
  FormularioVisita,
  ParadaCompleta,
  PrioridadParada,
  ResumenJornada,
  RolVisita,
  Visita,
} from '@woodtools/compartido'

import { supabase } from '../nucleo/supabase'

/**
 * Acceso a la jornada del vendedor.
 *
 * Todo lo que muta el recorrido pasa por funciones de Postgres (`rpc`) en vez de
 * hacer varios `update` desde el teléfono: así el reordenamiento y el registro
 * de una visita son atómicos, y no queda una jornada a medio actualizar si se
 * corta la señal en el medio.
 */

/**
 * Fecha local, no UTC: si el vendedor arranca a las 21:00 en Buenos Aires, la
 * jornada sigue siendo la de hoy y no la de mañana.
 *
 * La cuenta vive en el paquete compartido. Estaba escrita a mano acá y no en
 * `rangoDelPeriodo`, que quedó abajo con `toISOString()` pelado: la misma app
 * resolvía bien el día de la jornada y mal el del historial.
 */
function hoyISO(): string {
  return fechaLocalISO(new Date())
}

export async function obtenerResumenDeHoy(vendedorId: string): Promise<ResumenJornada | null> {
  const { data, error } = await supabase
    .from('vista_resumen_jornada')
    .select('*')
    .eq('vendedor_id', vendedorId)
    .eq('fecha', hoyISO())
    .maybeSingle<ResumenJornada>()

  if (error) throw error
  return data
}

export interface JornadaCompleta {
  jornada: RolVisita
  paradas: ParadaCompleta[]
}

export async function obtenerJornadaDeHoy(vendedorId: string): Promise<JornadaCompleta | null> {
  const { data: jornada, error } = await supabase
    .from('roles_visita')
    .select('*')
    .eq('vendedor_id', vendedorId)
    .eq('fecha', hoyISO())
    .maybeSingle<RolVisita>()

  if (error) throw error
  if (!jornada) return null

  const paradas = await obtenerParadas(jornada.id)
  return { jornada, paradas }
}

export async function obtenerParadas(rolVisitaId: string): Promise<ParadaCompleta[]> {
  const { data, error } = await supabase
    .from('paradas')
    .select(
      `*,
       cliente:clientes ( id, codigo, razon_social, contacto_nombre, telefono ),
       direccion:direcciones ( * ),
       visita:visitas ( * )`,
    )
    .eq('rol_visita_id', rolVisitaId)
    .order('orden', { ascending: true })

  if (error) throw error

  // `visita` viene como arreglo por la relación uno-a-uno de PostgREST.
  return (data ?? []).map((fila: Record<string, unknown>) => ({
    ...fila,
    visita: Array.isArray(fila.visita) ? ((fila.visita[0] as Visita) ?? null) : (fila.visita ?? null),
  })) as ParadaCompleta[]
}

/** Una parada puntual con todo su contexto: la usa el detalle del historial. */
export async function obtenerDetalleParada(paradaId: string): Promise<ParadaCompleta | null> {
  const { data, error } = await supabase
    .from('paradas')
    .select(
      `*,
       cliente:clientes ( id, codigo, razon_social, contacto_nombre, telefono ),
       direccion:direcciones ( * ),
       visita:visitas ( * )`,
    )
    .eq('id', paradaId)
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  const fila = data as Record<string, unknown>
  return {
    ...fila,
    visita: Array.isArray(fila.visita) ? ((fila.visita[0] as Visita) ?? null) : (fila.visita ?? null),
  } as ParadaCompleta
}

/**
 * Crea la jornada de hoy si la oficina todavía no la armó.
 * Permite que el vendedor agregue destinos a mano sin depender de nadie.
 */
export async function asegurarJornadaDeHoy(vendedorId: string): Promise<RolVisita> {
  const existente = await obtenerJornadaDeHoy(vendedorId)
  if (existente) return existente.jornada

  const { data, error } = await supabase
    .from('roles_visita')
    .insert({ vendedor_id: vendedorId, fecha: hoyISO(), estado: 'planificado' })
    .select('*')
    .single<RolVisita>()

  if (error) throw error
  return data
}

export async function iniciarRecorrido(
  rolVisitaId: string,
  lat: number,
  lng: number,
): Promise<RolVisita> {
  const { data, error } = await supabase.rpc('iniciar_recorrido', {
    p_rol_visita_id: rolVisitaId,
    p_lat: lat,
    p_lng: lng,
  })

  if (error) throw error
  return data as RolVisita
}

export async function finalizarRecorrido(rolVisitaId: string): Promise<RolVisita> {
  const { data, error } = await supabase.rpc('finalizar_recorrido', {
    p_rol_visita_id: rolVisitaId,
  })

  if (error) throw error
  return data as RolVisita
}

export interface DatosRegistroVisita extends FormularioVisita {
  parada_id: string
  audio_url?: string | null
  lat?: number | null
  lng?: number | null
  precision_m?: number | null
}

/**
 * "16:30" convertido a una marca de tiempo de HOY, en la zona del teléfono.
 *
 * Se arma acá y no en Postgres porque el servidor corre en UTC: un "16:30"
 * mandado como texto se guardaría tres horas corrido, y la parada volvería a
 * aparecer a las 13:30.
 */
function horaDeHoy(hhmm: string | null | undefined): string | null {
  const limpio = (hhmm ?? '').trim()
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(limpio)
  if (!m) return null
  const cuando = new Date()
  cuando.setHours(Number(m[1]), Number(m[2]), 0, 0)
  return cuando.toISOString()
}

export async function registrarVisita(datos: DatosRegistroVisita): Promise<Visita> {
  const { data, error } = await supabase.rpc('registrar_visita', {
    p_parada_id: datos.parada_id,
    p_visitado: datos.visitado,
    p_vendio: datos.vendio,
    p_cobro: datos.cobro,
    p_retiro_afilado: datos.retiro_afilado,
    p_entrego: datos.entrego,
    p_motivo: datos.motivo_no_visita,
    p_contacto: datos.contacto_nombre || null,
    p_observacion: datos.observacion,
    p_observacion_origen: datos.observacion_origen,
    p_audio_url: datos.audio_url ?? null,
    p_lat: datos.lat ?? null,
    p_lng: datos.lng ?? null,
    p_precision_m: datos.precision_m ?? null,
    // La hora viaja como marca de tiempo completa: la parte de la fecha es
    // siempre hoy, porque es el mismo recorrido más tarde. Armarla acá y no en
    // la base evita que el huso del servidor la corra un día.
    p_volver_a_las: horaDeHoy(datos.volver_a_las),
  })

  if (error) {
    // El CHECK de la base devuelve 23514; lo traducimos a algo entendible.
    if (error.code === '23514' || error.message.includes('observación')) {
      throw new Error(
        'La observación es obligatoria: escribí al menos una frase contando qué pasó en la visita.',
      )
    }
    throw error
  }

  return data as Visita
}

export async function agregarParada(params: {
  rolVisitaId: string
  direccionId: string
  prioridad: PrioridadParada
  clienteId?: string | null
}): Promise<ParadaCompleta> {
  const { data, error } = await supabase.rpc('agregar_parada', {
    p_rol_visita_id: params.rolVisitaId,
    p_direccion_id: params.direccionId,
    p_prioridad: params.prioridad,
    p_cliente_id: params.clienteId ?? null,
  })

  if (error) throw error
  return data as ParadaCompleta
}

// ─────────────────────────────────────────────────────────────────────────────
// Historial
// ─────────────────────────────────────────────────────────────────────────────

export interface DiaHistorial {
  fecha: string
  rol_visita_id: string
  vendedor_id: string
  vendedor: string
  total_paradas: number
  visitadas: number
  no_visitadas: number
  detalle: DetalleHistorial[]
}

export interface DetalleHistorial {
  parada_id: string
  nro: number
  cliente: string
  cliente_nro: string | null
  direccion: string | null
  estado: string
  hora: string | null
  visitado: boolean | null
  vendio: boolean | null
  cobro: boolean | null
  retiro_afilado: boolean | null
  entrego: boolean | null
  motivo: string | null
  contacto: string | null
  observacion: string | null
}

export type PeriodoHistorial = 'semana' | 'mes' | 'noventa' | 'personalizado'

export function rangoDelPeriodo(
  periodo: PeriodoHistorial,
  personalizado?: { desde: Date; hasta: Date },
): { desde: string; hasta: string } {
  const hasta = new Date()
  const desde = new Date()

  switch (periodo) {
    case 'semana':
      desde.setDate(hasta.getDate() - 7)
      break
    case 'mes':
      // Días, no meses: `setMonth(mes - 1)` desborda los días 29 a 31. Un 31 de
      // marzo pedía "31 de febrero" y JavaScript lo normalizaba al 3 de marzo,
      // así que el vendedor veía dos días de historial en vez de un mes.
      desde.setDate(hasta.getDate() - 30)
      break
    case 'noventa':
      desde.setDate(hasta.getDate() - 90)
      break
    case 'personalizado':
      if (personalizado) {
        return {
          desde: fechaLocalISO(personalizado.desde),
          hasta: fechaLocalISO(personalizado.hasta),
        }
      }
      desde.setDate(hasta.getDate() - 7)
      break
  }

  /**
   * En local, no en UTC.
   *
   * `toISOString()` pasa la fecha a UTC, y en Buenos Aires eso son tres horas
   * adelante: de las 21:00 en adelante devolvía **el día siguiente**. Los dos
   * extremos se corrían juntos, así que la ventana seguía midiendo siete días
   * pero se comía el más viejo y agregaba uno futuro que está vacío: el
   * vendedor perdía un día de historial cada noche.
   *
   * En el rango personalizado era peor de ver: elegía el 1 de agosto en el
   * calendario y la consulta pedía el 2.
   */
  return { desde: fechaLocalISO(desde), hasta: fechaLocalISO(hasta) }
}

export async function obtenerHistorial(
  periodo: PeriodoHistorial,
  personalizado?: { desde: Date; hasta: Date },
): Promise<DiaHistorial[]> {
  const { desde, hasta } = rangoDelPeriodo(periodo, personalizado)

  const { data, error } = await supabase.rpc('historial_visitas', {
    p_desde: desde,
    p_hasta: hasta,
  })

  if (error) throw error
  return (data ?? []) as DiaHistorial[]
}
