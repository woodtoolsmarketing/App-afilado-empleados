import { fechaLocalISO } from '@woodtools/compartido'

import { supabase } from '../nucleo/supabase'

/**
 * La agenda: a quién hay que ver, qué día, y a qué hora.
 *
 * Mezcla dos cosas que el vendedor necesita ver juntas y que hasta ahora
 * vivían separadas:
 *
 *  · lo AGENDADO, que son paradas de verdad —el rol que armó la oficina, lo
 *    que él mismo agendó, un envío comprometido para el jueves—, y
 *  · lo SUGERIDO, que sale del rol maestro: el cliente al que le toca por
 *    frecuencia y que todavía no está en ninguna jornada.
 *
 * Separarlas sería pedirle que mire dos pantallas y saque la cuenta él.
 */

export type TipoDeItem = 'agendada' | 'sugerida'

export interface ItemDeAgenda {
  fecha: string
  tipo: TipoDeItem
  parada_id: string | null
  rol_visita_id: string | null
  cliente_id: string | null
  codigo: string | null
  razon_social: string
  direccion: string | null
  lat: number | null
  lng: number | null
  /** Marca de tiempo completa. Null cuando no se le puso hora. */
  hora: string | null
  estado: string | null
  prioridad: string | null
  orden: number | null
  cada_cuantos_dias: number | null
  dias_desde: number | null
}

export async function agendaEntre(desde: Date, hasta: Date): Promise<ItemDeAgenda[]> {
  const { data, error } = await supabase.rpc('agenda_semanal', {
    p_desde: fechaLocalISO(desde),
    p_hasta: fechaLocalISO(hasta),
    p_vendedor_id: null,
  })

  if (error) throw error
  return (data ?? []) as ItemDeAgenda[]
}

/**
 * "16:30" del día `fecha`, como marca de tiempo.
 *
 * Se arma en el teléfono y no en Postgres porque el servidor corre en UTC: un
 * "16:30" mandado como texto se guardaría tres horas corrido y la parada
 * volvería a aparecer a las 13:30. El teléfono está en la misma zona que el
 * vendedor, que es la única que importa.
 *
 * Es la misma cuenta que hace `registrarVisita` con la hora de volver, con una
 * diferencia: acá el día no es hoy, es el que se está agendando.
 */
export function horaDelDia(fecha: string, hhmm: string): string | null {
  const limpio = hhmm.trim()
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(limpio)
  if (!m) return null

  const [anio, mes, dia] = fecha.split('-').map(Number)
  if (!anio || !mes || !dia) return null

  const cuando = new Date(anio, mes - 1, dia, Number(m[1]), Number(m[2]), 0, 0)
  return cuando.toISOString()
}

/** "16:30" leído de la marca de tiempo que guarda la parada, en hora del teléfono. */
export function horaLegible(marca: string | null): string | null {
  if (!marca) return null
  const cuando = new Date(marca)
  if (Number.isNaN(cuando.getTime())) return null
  return `${String(cuando.getHours()).padStart(2, '0')}:${String(cuando.getMinutes()).padStart(2, '0')}`
}

/** Agenda para una fecha a un cliente que hoy es sólo una sugerencia del plan. */
export async function agendarVisita(params: {
  clienteId: string
  fecha: string
  hora?: string | null
}): Promise<void> {
  const { error } = await supabase.rpc('agendar_visita', {
    p_cliente_id: params.clienteId,
    p_fecha: params.fecha,
    p_hora: params.hora ? horaDelDia(params.fecha, params.hora) : null,
  })

  if (error) {
    if (error.code === '23514') throw new Error(error.message)
    throw error
  }
}

/**
 * Cambia de día y/o de hora un destino ya agendado.
 *
 * `hora` en `null` no significa "no la toques": para eso está `borrarHora`. Sin
 * esa distinción no habría forma de sacarle la hora a una parada que ya la
 * tiene, y el vendedor que se equivocó al ponerla quedaría con ella para
 * siempre.
 */
export async function moverParada(params: {
  paradaId: string
  fecha?: string | null
  hora?: string | null
  borrarHora?: boolean
}): Promise<void> {
  const fecha = params.fecha ?? null
  const { error } = await supabase.rpc('mover_parada', {
    p_parada_id: params.paradaId,
    p_fecha: fecha,
    p_hora: params.hora && fecha ? horaDelDia(fecha, params.hora) : null,
    p_borrar_hora: params.borrarHora ?? false,
  })

  if (error) {
    if (error.code === '23514') throw new Error(error.message)
    throw error
  }
}

/** Saca un destino de la agenda. No lo borra: lo marca omitido. */
export async function quitarDeLaAgenda(paradaId: string): Promise<void> {
  const { error } = await supabase.rpc('quitar_de_la_agenda', { p_parada_id: paradaId })
  if (error) {
    if (error.code === '23514') throw new Error(error.message)
    throw error
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// La lista semanal del vendedor
//
// Una lista fija por día de la semana —"los lunes veo a estos"— que el vendedor
// arma y edita. No crea paradas: aparece como sugerida en el calendario todas
// las semanas, y el vendedor decide cuáles agenda. Ver `lista_visitas_vendedor`.
// ─────────────────────────────────────────────────────────────────────────────

/** Un cliente de la lista semanal, para verlo y editarlo. */
export interface ClienteDeLista {
  cliente_id: string
  codigo: string | null
  razon_social: string
  direccion: string | null
  lat: number | null
  lng: number | null
  orden: number | null
}

/** La lista fija del vendedor para un día. `dia` es ISO: 1 lunes … 7 domingo. */
export async function listaSemanalDe(dia: number): Promise<ClienteDeLista[]> {
  const { data, error } = await supabase.rpc('lista_semanal_de', { p_dia_semana: dia })
  if (error) throw error
  return (data ?? []) as ClienteDeLista[]
}

/** Reemplaza la lista de ese día con los clientes elegidos, en ese orden. */
export async function guardarListaSemanal(dia: number, clienteIds: string[]): Promise<void> {
  const { error } = await supabase.rpc('guardar_lista_semanal', {
    p_dia_semana: dia,
    p_cliente_ids: clienteIds,
  })
  if (error) {
    if (['23514', '42501'].includes(error.code ?? '')) throw new Error(error.message)
    throw error
  }
}

/**
 * Suma UN cliente a la lista de un día, sin tocar el resto.
 *
 * `guardar_lista_semanal` reemplaza el día entero, así que primero se trae lo
 * que ya hay y se agrega el cliente al final. Si ya estaba, no se guarda nada
 * —así el atajo desde el historial no reordena ni duplica una lista existente—.
 */
export async function agregarAListaSemanal(
  dia: number,
  clienteId: string,
): Promise<'agregado' | 'ya_estaba'> {
  const actual = await listaSemanalDe(dia)
  if (actual.some((c) => c.cliente_id === clienteId)) return 'ya_estaba'
  await guardarListaSemanal(dia, [...actual.map((c) => c.cliente_id), clienteId])
  return 'agregado'
}

/** Los siete días como los pide la lista: ISO 1 lunes … 7 domingo. */
export const DIAS_ISO: { iso: number; corto: string; largo: string }[] = [
  { iso: 1, corto: 'LUN', largo: 'Lunes' },
  { iso: 2, corto: 'MAR', largo: 'Martes' },
  { iso: 3, corto: 'MIÉ', largo: 'Miércoles' },
  { iso: 4, corto: 'JUE', largo: 'Jueves' },
  { iso: 5, corto: 'VIE', largo: 'Viernes' },
  { iso: 6, corto: 'SÁB', largo: 'Sábado' },
  { iso: 7, corto: 'DOM', largo: 'Domingo' },
]

/** El día ISO de hoy (1 lunes … 7 domingo), en hora del teléfono. */
export function isodowDeHoy(): number {
  const d = new Date().getDay() // 0 domingo … 6 sábado
  return d === 0 ? 7 : d
}

/** El nombre largo del día ISO (1 lunes … 7 domingo). */
export function nombreLargoDia(iso: number): string {
  return DIAS_ISO.find((d) => d.iso === iso)?.largo ?? ''
}

// ─────────────────────────────────────────────────────────────────────────────
// La semana
// ─────────────────────────────────────────────────────────────────────────────

/**
 * El lunes de la semana en la que cae `fecha`.
 *
 * Lunes y no domingo: la semana laboral argentina empieza el lunes, y una
 * grilla que arranca en domingo pone el fin de semana partido en los dos
 * extremos.
 */
export function lunesDeLaSemana(fecha: Date): Date {
  const dia = new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate())
  // getDay(): 0 es domingo. El domingo pertenece a la semana que ya terminó.
  const corrimiento = (dia.getDay() + 6) % 7
  dia.setDate(dia.getDate() - corrimiento)
  return dia
}

/** Los siete días de la semana que arranca en `lunes`. */
export function diasDeLaSemana(lunes: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(lunes.getFullYear(), lunes.getMonth(), lunes.getDate())
    d.setDate(d.getDate() + i)
    return d
  })
}

export const NOMBRE_DEL_DIA = ['LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB', 'DOM']

/** El nombre corto del día que le corresponde a esa fecha. */
export function nombreDelDia(fecha: Date): string {
  return NOMBRE_DEL_DIA[(fecha.getDay() + 6) % 7]
}
