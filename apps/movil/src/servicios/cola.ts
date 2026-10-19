import { supabase } from '../nucleo/supabase'

/**
 * Mandar cosas a la cola de impresión de la oficina y ver dónde quedaron.
 *
 * El vendedor manda el rol o las cobranzas "a la oficina": entran a
 * `ordenes_impresion` y la PC de la oficina las imprime sola (el agente). No
 * importa si el teléfono está cerca de la impresora: el papel lo saca el
 * servidor. La nota ya tenía su propio `encolarImpresion` (en `notasPedido.ts`);
 * acá van el rol y las cobranzas sueltas, y "mi cola" con la posición.
 */

export interface EnCola {
  encolada: boolean
  /** Por qué no entró (ya estaba, sin sesión). */
  motivo?: string
}

/** Código de violación de índice único de Postgres: ya hay una orden viva igual. */
const YA_ENCOLADA = '23505'

async function encolar(tipo: 'rol' | 'cobranzas', fecha: string): Promise<EnCola> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const quien = session?.user.id
  if (!quien) return { encolada: false, motivo: 'No hay sesión.' }

  const { error } = await supabase
    .from('ordenes_impresion')
    .insert({ tipo, pedida_por: quien, parametros: { fecha } })

  if (!error) return { encolada: true }
  // El índice único `ordenes_impresion_una_por_fecha` rechaza una segunda orden
  // viva del mismo tipo+fecha: tocar dos veces no manda dos.
  if ((error as { code?: string }).code === YA_ENCOLADA) {
    return { encolada: false, motivo: 'Ya está en la cola de la oficina.' }
  }
  throw error
}

/** Manda el rol de visita de una fecha a la cola de la oficina. */
export function encolarRol(fecha: string): Promise<EnCola> {
  return encolar('rol', fecha)
}

/** Manda la rendición de cobranzas de una fecha a la cola de la oficina. */
export function encolarCobranzas(fecha: string): Promise<EnCola> {
  return encolar('cobranzas', fecha)
}

export interface OrdenEnMiCola {
  id: string
  tipo: 'nota' | 'rol' | 'cobranzas'
  estado: 'pendiente' | 'imprimiendo'
  creado_en: string
  /** Puesto en la cola global (1 = el próximo en salir). Para 'imprimiendo' no se muestra. */
  posicion: number
  total_en_cola: number
  /** "Rol de visita del 15/10", "Cobranzas del 14/10", "Nota de …". */
  descripcion: string
}

/**
 * Lo que este vendedor tiene en la cola, con su posición.
 *
 * `mi_cola_de_impresion` es SECURITY DEFINER: para la posición cuenta los
 * pendientes de TODOS, que el vendedor no puede ver por RLS.
 */
export async function miColaDeImpresion(): Promise<OrdenEnMiCola[]> {
  const { data, error } = await supabase.rpc('mi_cola_de_impresion')
  if (error) throw error
  return (data ?? []) as unknown as OrdenEnMiCola[]
}
