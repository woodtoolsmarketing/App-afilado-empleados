import {
  formatearFechaCorta,
  formatearPesos,
  type PlanillaCobranzasParaImprimir,
  type RenglonCobranza,
} from '@woodtools/compartido'

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
}

export interface DatosCobranza {
  notaId?: string | null
  clienteId?: string | null
  clienteCodigo?: string | null
  clienteNombre: string
  tipoComprobante: 'factura' | 'presupuesto'
  cheque: number
  efectivo: number
  comentarios?: string | null
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
      vendedor_id: vendedorId,
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

  if (error) throw error
  return data as Cobranza
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
  return (data ?? []) as Cobranza[]
}

/**
 * De los cobros del día a la planilla imprimible.
 *
 * Los importes se formatean acá y no en el template por lo mismo que en el rol
 * de visita: el papel no decide formatos, y así el que arma la planilla desde
 * el panel y el que la arma desde el teléfono no pueden escribir los números
 * distinto.
 */
export function planillaDesdeCobranzas(
  cobros: Cobranza[],
  vendedor: { nombre: string; codigo: string | null; zona: string | null },
  fecha: string,
): PlanillaCobranzasParaImprimir {
  const renglones: RenglonCobranza[] = cobros.map((c) => ({
    cliente_codigo: c.cliente_codigo ?? '',
    cliente_nombre: c.cliente_nombre,
    comprobante: c.tipo_comprobante === 'factura' ? 'FACTURA' : 'PRESUPUESTO',
    total: formatearPesos(c.total),
    // Un cero no se escribe: la planilla de papel se deja en blanco cuando no
    // hubo, y una columna de ceros se lee como si hubiera habido algo.
    cheque: c.cheque > 0 ? formatearPesos(c.cheque) : '',
    efectivo: c.efectivo > 0 ? formatearPesos(c.efectivo) : '',
    comentarios: c.comentarios ?? '',
  }))

  const total = cobros.reduce((suma, c) => suma + Number(c.total), 0)

  return {
    vendedor_numero: vendedor.codigo ?? '',
    vendedor: vendedor.nombre,
    gira_zona: vendedor.zona ?? '',
    fecha: formatearFechaCorta(`${fecha}T12:00:00`),
    cobros: renglones,
    total_general: formatearPesos(total),
  }
}

/** La fecha de hoy en Argentina, que es la que usa la base por defecto. */
export function hoyLocal(): string {
  const ahora = new Date()
  const local = new Date(ahora.getTime() - ahora.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 10)
}

function redondear(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100
}
