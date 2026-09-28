import { supabase } from '../nucleo/supabase'

/**
 * El vendedor propone corregir la dirección/ubicación de un cliente.
 *
 * NO pisa la dirección oficial: queda como pedido pendiente. La oficina lo
 * aplica desde el panel ("Cambios de dirección"). Re-proponer para el mismo
 * cliente actualiza el pedido pendiente en vez de duplicarlo (lo maneja la RPC).
 */
export async function proponerCambioDireccion(params: {
  clienteId: string
  direccionId: string | null
  direccion: string
  lat: number | null
  lng: number | null
  motivo?: string | null
}): Promise<void> {
  const { error } = await supabase.rpc('proponer_cambio_direccion', {
    p_cliente_id: params.clienteId,
    p_direccion_id: params.direccionId,
    p_direccion: params.direccion,
    p_lat: params.lat,
    p_lng: params.lng,
    p_motivo: params.motivo ?? null,
  })
  if (error) throw error
}

export interface CambioPendiente {
  cliente_id: string
  direccion_propuesta: string
  lat_propuesta: number | null
  lng_propuesta: number | null
}

/**
 * Los cambios de dirección que ESTE vendedor propuso y la oficina todavía no
 * aplicó. La RLS ya limita a los propios. Se devuelve indexado por cliente:
 * lo usa la ficha (mostrar la observación) y la navegación (llevar al punto
 * nuevo, no al viejo, hasta que la oficina lo aplique).
 */
export async function misCambiosPendientes(): Promise<Record<string, CambioPendiente>> {
  const { data, error } = await supabase
    .from('cambios_direccion')
    .select('cliente_id, direccion_propuesta, lat_propuesta, lng_propuesta')
    .eq('estado', 'pendiente')
  if (error) throw error
  const porCliente: Record<string, CambioPendiente> = {}
  for (const c of (data ?? []) as CambioPendiente[]) porCliente[c.cliente_id] = c
  return porCliente
}
