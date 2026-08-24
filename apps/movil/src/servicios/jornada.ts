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

/**
 * La jornada de una fecha cualquiera, creándola si no existe.
 *
 * Es `asegurarJornadaDeHoy` sin el "de hoy", y existe para poder agendar: una
 * visita que se acuerda para el jueves tiene que entrar en el rol del jueves,
 * no en el de hoy.
 *
 * `roles_visita` tiene un único por vendedor y fecha, así que dos agendas
 * simultáneas para el mismo día no pueden duplicar la jornada: la segunda choca
 * contra el índice y vuelve a leer la que ya está.
 */
export async function asegurarJornadaDe(vendedorId: string, fecha: string): Promise<RolVisita> {
  const { data: existente } = await supabase
    .from('roles_visita')
    .select('*')
    .eq('vendedor_id', vendedorId)
    .eq('fecha', fecha)
    .maybeSingle<RolVisita>()

  if (existente) return existente

  const { data, error } = await supabase
    .from('roles_visita')
    .insert({ vendedor_id: vendedorId, fecha, estado: 'planificado' })
    .select('*')
    .single<RolVisita>()

  if (error) {
    // Carrera con otra agenda del mismo día: la fila ya está, se lee.
    const { data: recien } = await supabase
      .from('roles_visita')
      .select('*')
      .eq('vendedor_id', vendedorId)
      .eq('fecha', fecha)
      .maybeSingle<RolVisita>()
    if (recien) return recien
    throw error
  }
  return data
}

/** Un día agendado, con cuántos destinos tiene. */
export interface DiaAgendado {
  rol_visita_id: string
  fecha: string
  estado: string
  destinos: number
}

/**
 * Los días que ya tienen algo agendado, de hoy en adelante.
 *
 * Es lo que muestra el calendario de envíos: no un mes en blanco, sino los días
 * en los que hay trabajo comprometido.
 */
export async function diasAgendados(vendedorId: string, desde: string): Promise<DiaAgendado[]> {
  const { data, error } = await supabase
    .from('roles_visita')
    .select('id, fecha, estado, paradas(id)')
    .eq('vendedor_id', vendedorId)
    .gte('fecha', desde)
    .order('fecha', { ascending: true })

  if (error) throw error

  return ((data ?? []) as Array<{ id: string; fecha: string; estado: string; paradas: unknown[] }>)
    .map((r) => ({
      rol_visita_id: r.id,
      fecha: r.fecha,
      estado: r.estado,
      destinos: (r.paradas ?? []).length,
    }))
    // Un día que quedó creado y vacío no es una agenda: es ruido.
    .filter((d) => d.destinos > 0)
}

/** Un cliente al que toca visitar hoy, según el rol maestro. */
export interface CandidatoDelDia {
  cliente_id: string
  codigo: string | null
  razon_social: string
  direccion: string | null
  lat: number | null
  lng: number | null
  cada_cuantos_dias: number
  ultima_visita: string | null
  dias_desde: number | null
  orden: number | null
}

/**
 * A quién toca visitar hoy según el plan que cargó la oficina.
 *
 * No son paradas: son candidatos. El vendedor los ve todos deseleccionados y
 * elige cuáles hace; recién ahí se crean las paradas de su jornada.
 */
export async function candidatosDelDia(): Promise<CandidatoDelDia[]> {
  const { data, error } = await supabase.rpc('candidatos_del_dia', { p_vendedor_id: null })
  if (error) throw error
  return (data ?? []) as CandidatoDelDia[]
}

/**
 * Convierte en paradas los candidatos que el vendedor eligió.
 *
 * Devuelve cuántos entraron y cuántos no se pudieron agregar. Los que fallan no
 * frenan a los demás: si de doce clientes uno no está geolocalizado, los once
 * restantes tienen que entrar igual — el vendedor está por salir.
 */
export async function armarRecorridoCon(
  vendedorId: string,
  candidatos: CandidatoDelDia[],
): Promise<{ agregados: number; fallaron: Array<{ razon_social: string; motivo: string }> }> {
  const jornada = await asegurarJornadaDeHoy(vendedorId)
  const fallaron: Array<{ razon_social: string; motivo: string }> = []
  let agregados = 0

  for (const c of candidatos) {
    if (c.lat === null || c.lng === null) {
      fallaron.push({
        razon_social: c.razon_social,
        motivo: 'No está ubicado en el mapa',
      })
      continue
    }
    try {
      const { data, error } = await supabase.rpc('agregar_parada', {
        p_rol_visita_id: jornada.id,
        p_direccion_id: await direccionPrincipalDe(c.cliente_id),
        // El plan del día no se desvía por nadie: la ruta la ordena la
        // optimización. La prioridad alta es para lo que aparece en el camino.
        p_prioridad: 'baja',
        p_cliente_id: c.cliente_id,
      })
      if (error) throw error
      if (data) agregados++
    } catch (e) {
      fallaron.push({
        razon_social: c.razon_social,
        motivo: e instanceof Error ? e.message : 'No se pudo agregar',
      })
    }
  }

  return { agregados, fallaron }
}

/** La dirección principal de un cliente. Es lo que `agregar_parada` necesita. */
async function direccionPrincipalDe(clienteId: string): Promise<string> {
  const { data, error } = await supabase
    .from('direcciones')
    .select('id')
    .eq('cliente_id', clienteId)
    .order('principal', { ascending: false })
    .order('creado_en', { ascending: true })
    .limit(1)
    .maybeSingle<{ id: string }>()

  if (error) throw error
  if (!data) throw new Error('El cliente no tiene dirección cargada')
  return data.id
}
