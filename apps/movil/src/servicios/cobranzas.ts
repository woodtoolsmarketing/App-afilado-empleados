import { fechaLocalISO } from '@woodtools/compartido'

import { conMensajeDeSenal } from '../nucleo/loUltimoQueSupimos'
import { supabase } from '../nucleo/supabase'

/**
 * Cobranzas del vendedor.
 *
 * Lo que cobra en la calle, para poder rendirlo en la planilla del día. Es
 * deliberadamente independiente de la impresión de la nota: hay tres caminos
 * por los que una nota puede salir en papel y sólo uno confirma que salió de
 * verdad. Si el cobro se colgara del camino confirmado, todo lo impreso por el
 * diálogo de Android o exportado a PDF no se registraría nunca.
 */

export interface Cobranza {
  id: string
  fecha: string
  nota_id: string | null
  cliente_codigo: string | null
  cliente_nombre: string
  tipo_comprobante: 'factura' | 'presupuesto'
  total: number
  cheque: number
  efectivo: number
  comentarios: string | null
  /** Cuándo salió en papel. Null = todavía se puede corregir. */
  impreso_en: string | null
}

export interface DatosCobranza {
  /** Lo genera el teléfono, para que un reintento con mala señal no duplique. */
  id: string
  notaId?: string | null
  clienteId?: string | null
  clienteCodigo?: string | null
  clienteNombre: string
  tipoComprobante: 'factura' | 'presupuesto'
  cheque: number
  efectivo: number
  comentarios?: string | null
  /**
   * El día del cobro. Sin esto la base pone hoy —lo normal, porque se cobra en la
   * visita del día—. Lo manda sólo el alta suelta ("AGREGAR COBRANZA"), para
   * poder cargar un cobro que se olvidó en el día que se está mirando.
   */
  fecha?: string
}

export async function registrarCobranza(datos: DatosCobranza): Promise<Cobranza> {
  const { data: sesion } = await supabase.auth.getSession()
  const vendedorId = sesion.session?.user.id
  if (!vendedorId) throw new Error('No hay sesión')

  const cheque = redondear(datos.cheque)
  const efectivo = redondear(datos.efectivo)
  const total = redondear(cheque + efectivo)

  if (total <= 0) throw new Error('Poné cuánto cobraste, en cheque o en efectivo.')

  const { data, error } = await supabase
    .from('cobranzas')
    .insert({
      id: datos.id,
      vendedor_id: vendedorId,
      // Sin fecha, la base pone hoy (el caso normal: se cobra en la visita del
      // día). El alta suelta la manda para dejar el cobro en el día elegido.
      ...(datos.fecha ? { fecha: datos.fecha } : {}),
      nota_id: datos.notaId ?? null,
      cliente_id: datos.clienteId ?? null,
      cliente_codigo: datos.clienteCodigo ?? null,
      cliente_nombre: datos.clienteNombre,
      tipo_comprobante: datos.tipoComprobante,
      // El total no se pide: es la suma, y pedirlo aparte deja abierta la
      // puerta a que no cierre contra el TOTAL GENERAL de la planilla, que es
      // lo único que la oficina compara.
      total,
      cheque,
      efectivo,
      comentarios: (datos.comentarios ?? '').trim() || null,
    })
    .select()
    .single()

  if (error) {
    // Los CHECK de la tabla `cobranzas` (cheque + efectivo = total, total > 0,
    // montos no negativos) devuelven 23514 con el texto crudo de Postgres en
    // inglés —a diferencia de las RPC de otros servicios, que arman el mensaje
    // en castellano con RAISE EXCEPTION—. Como es una pantalla de plata, lo
    // traducimos a mano en vez de mostrar el crudo. El resto de los errores: si
    // fue falta de señal, salen en castellano en lugar del crudo de la red.
    if (error.code === '23514') {
      throw new Error('No pudimos guardar el cobro: los montos no cierran. Revisá cheque y efectivo.')
    }
    // Clave repetida: ya hay un cobro con este id. Pasa cuando el INSERT anterior
    // entró pero se perdió la respuesta (mala señal) y el vendedor tocó GUARDAR de
    // nuevo. No es un error ni un duplicado: el cobro ya está grabado, así que lo
    // devolvemos en vez de reventar o de insertar una segunda fila.
    if (error.code === '23505') {
      const { data: existente } = await supabase
        .from('cobranzas')
        .select('*')
        .eq('id', datos.id)
        .single()
      if (existente) return normalizarCobranza(existente)
    }
    throw conMensajeDeSenal(error)
  }
  return normalizarCobranza(data)
}

/**
 * PostgREST devuelve las columnas `numeric` (total/cheque/efectivo) como STRING.
 * El tipo `Cobranza` las declara `number`, así que acá se las pasa a número una
 * sola vez, en la capa de datos: si no, `formatearPesos('15000.00')` devuelve ''
 * (usa `Number.isFinite`, que no coacciona strings) y los montos del historial
 * salían en blanco aunque el TOTAL —que sumaba con `Number()`— saliera bien.
 */
function normalizarCobranza(fila: Record<string, unknown>): Cobranza {
  return {
    ...(fila as unknown as Cobranza),
    total: Number(fila.total) || 0,
    cheque: Number(fila.cheque) || 0,
    efectivo: Number(fila.efectivo) || 0,
  }
}

/**
 * Corrige un cobro ya cargado: tipo de comprobante, montos y comentario.
 *
 * El total no se manda: lo recalcula el servidor como cheque + efectivo, igual
 * que al cargarlo. La RPC rechaza si el cobro ya se imprimió (una vez en papel
 * la cifra no se toca) o si no es del vendedor que llama.
 */
export async function editarCobranza(datos: {
  id: string
  tipoComprobante: 'factura' | 'presupuesto'
  cheque: number
  efectivo: number
  comentarios?: string | null
}): Promise<Cobranza> {
  const { data, error } = await supabase.rpc('editar_cobranza', {
    p_id: datos.id,
    p_tipo: datos.tipoComprobante,
    p_cheque: redondear(datos.cheque),
    p_efectivo: redondear(datos.efectivo),
    p_comentarios: (datos.comentarios ?? '').trim() || null,
  })

  if (error) {
    // Las RPC arman el mensaje en castellano; 23514 (impreso, montos) y 42501
    // (no es tuyo) ya vienen listos para mostrar.
    if (['23514', '42501', 'P0002'].includes(error.code ?? '')) throw new Error(error.message)
    throw conMensajeDeSenal(error)
  }
  return normalizarCobranza(data as Record<string, unknown>)
}

/**
 * Sella como impresos los cobros del vendedor en esos días.
 *
 * La llama la impresión cuando la rendición de cobranzas salió junto con las
 * notas: a partir de ahí esos cobros quedan cerrados. Falla suave —devuelve 0—
 * no tiene sentido: si no se pudo sellar, se avisa arriba.
 */
export async function marcarCobranzasImpresas(fechas: string[]): Promise<number> {
  if (fechas.length === 0) return 0
  const { data, error } = await supabase.rpc('marcar_cobranzas_impresas', {
    p_fechas: fechas,
    p_vendedor_id: null,
  })
  if (error) throw conMensajeDeSenal(error)
  return Number(data ?? 0)
}

/** Los cobros de hoy, en el orden en que se hicieron. */
export async function cobranzasDelDia(fecha?: string): Promise<Cobranza[]> {
  const { data: sesion } = await supabase.auth.getSession()
  const vendedorId = sesion.session?.user.id
  if (!vendedorId) throw new Error('No hay sesión')

  const { data, error } = await supabase
    .from('cobranzas')
    .select('*')
    .eq('vendedor_id', vendedorId)
    .eq('fecha', fecha ?? hoyLocal())
    .order('creado_en', { ascending: true })

  if (error) throw error
  return (data ?? []).map(normalizarCobranza)
}

/** La fecha de hoy en Argentina, que es la que usa la base por defecto. */
export function hoyLocal(): string {
  // Una sola forma de calcular "hoy en hora local" en toda la app: la de
  // `fechaLocalISO` del paquete compartido. Acá había una cuenta a mano con
  // `toISOString()` que podía correrse un día cerca de medianoche; jornada.ts
  // ya la había abandonado por esto mismo.
  return fechaLocalISO(new Date())
}

function redondear(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100
}
