import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { supabase } from '../nucleo/supabase'

/**
 * Pedidos de administración para editar un cliente.
 *
 * ─── Por qué existe ─────────────────────────────────────────────────────────
 *
 * Administración ve la ficha del cliente en sólo lectura. Cuando necesita
 * corregir un dato, no lo pisa: manda un pedido con "Permitir editar" (y una
 * nota de qué quiere cambiar). Ese pedido cae acá. El admin lo aprueba o lo
 * rechaza. Aprobado, administración queda habilitada a editar ESE cliente una
 * sola vez, dentro de 48 h; recién ahí toca la ficha.
 *
 * Es sólo para administradores: nadie más aprueba. (El globo del menú cuenta los
 * pendientes, igual que "Cambios de dirección".)
 */

interface PedidoEdicion {
  id: string
  cliente_id: string
  motivo: string | null
  estado: 'pendiente' | 'aprobado' | 'rechazado' | 'usado' | 'vencido'
  creado_en: string
  resuelto_en: string | null
  vence_en: string | null
  usado_en: string | null
  motivo_rechazo: string | null
  cliente: { codigo: string | null; razon_social: string } | null
  solicitante: { nombre_completo: string; rol: string } | null
}

const SELECT =
  '*, cliente:clientes!permisos_edicion_cliente_cliente_id_fkey (codigo, razon_social),' +
  ' solicitante:perfiles!permisos_edicion_cliente_solicitado_por_fkey (nombre_completo, rol)'

/** "hace 5 min", "ayer", una fecha: lo que lee cómodo en una cola. */
function cuando(iso: string): string {
  return new Date(iso).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })
}

export function PaginaPermisosEdicion() {
  const cliente = useQueryClient()
  const [verResueltos, setVerResueltos] = useState(false)
  const [rechazando, setRechazando] = useState<string | null>(null)
  const [motivos, setMotivos] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['permisos-edicion', verResueltos],
    queryFn: async () => {
      const base = supabase
        .from('permisos_edicion_cliente')
        .select(SELECT)
        .order('creado_en', { ascending: false })
      const { data, error: err } = verResueltos
        ? await base.limit(100)
        : await base.eq('estado', 'pendiente')
      if (err) throw err
      return (data ?? []) as unknown as PedidoEdicion[]
    },
    refetchInterval: 30_000,
  })

  function invalidar() {
    void cliente.invalidateQueries({ queryKey: ['permisos-edicion'] })
    void cliente.invalidateQueries({ queryKey: ['permisos-edicion-pendientes'] })
  }

  const aprobar = useMutation({
    mutationFn: async (id: string) => {
      const { error: err } = await supabase.rpc('aprobar_edicion_cliente', { p_id: id })
      if (err) throw err
    },
    onSuccess: () => {
      setError(null)
      invalidar()
    },
    onError: (e: Error) => setError(e.message),
  })

  const rechazar = useMutation({
    mutationFn: async (p: { id: string; motivo: string }) => {
      const { error: err } = await supabase.rpc('rechazar_edicion_cliente', {
        p_id: p.id,
        p_motivo: p.motivo.trim() || null,
      })
      if (err) throw err
    },
    onSuccess: () => {
      setError(null)
      setRechazando(null)
      invalidar()
    },
    onError: (e: Error) => setError(e.message),
  })

  const pedidos = data ?? []
  const trabajando = aprobar.isPending || rechazar.isPending

  return (
    <>
      <header className="encabezado-pagina">
        <div>
          <h1>Ediciones de clientes</h1>
          <p>
            Administración pide permiso para corregir un dato de un cliente. Aprobalo y queda
            habilitada a editar ESE cliente una sola vez, por 48 h; o rechazalo.
          </p>
        </div>
        <label style={{ fontSize: 13, display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={verResueltos} onChange={(e) => setVerResueltos(e.target.checked)} />
          Ver resueltos
        </label>
      </header>

      {error ? <div className="aviso error">{error}</div> : null}

      {isLoading ? (
        <p className="vacio">Cargando…</p>
      ) : pedidos.length === 0 ? (
        <p className="vacio">
          {verResueltos ? 'No hay pedidos de edición.' : 'No hay pedidos de edición pendientes.'}
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {pedidos.map((p) => {
            const pendiente = p.estado === 'pendiente'
            return (
              <div
                key={p.id}
                className="tarjeta"
                style={{
                  padding: 16,
                  borderRadius: 10,
                  borderLeft: pendiente ? '5px solid #B30F0F' : undefined,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <strong style={{ fontSize: 15 }}>
                    {p.cliente?.razon_social ?? 'Cliente'}
                    {p.cliente?.codigo ? <span style={{ color: 'var(--tinta-suave)' }}> · {p.cliente.codigo}</span> : null}
                  </strong>
                  <span style={{ fontSize: 12, color: 'var(--tinta-suave)' }}>
                    {p.solicitante?.nombre_completo ?? 'Administración'} · {cuando(p.creado_en)}
                    {!pendiente ? ` · ${p.estado.toUpperCase()}` : ''}
                  </span>
                </div>

                {/* Lo que administración quiere cambiar: es con esto que el admin decide. */}
                <div style={{ marginTop: 12, fontSize: 14 }}>
                  <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--tinta-suave)' }}>
                    Qué quiere corregir
                  </div>
                  <div style={{ fontStyle: p.motivo ? 'normal' : 'italic', color: p.motivo ? undefined : 'var(--tinta-suave)' }}>
                    {p.motivo ? `“${p.motivo}”` : 'No escribió una nota.'}
                  </div>
                </div>

                {!pendiente ? (
                  <div style={{ marginTop: 10, fontSize: 13, color: 'var(--tinta-suave)' }}>
                    {p.estado === 'aprobado'
                      ? `Aprobado${p.resuelto_en ? ` el ${cuando(p.resuelto_en)}` : ''}${p.vence_en ? ` · vence ${cuando(p.vence_en)}` : ''} · todavía sin usar`
                      : p.estado === 'usado'
                        ? `Usado${p.usado_en ? ` el ${cuando(p.usado_en)}` : ''} — administración ya editó el cliente`
                        : p.estado === 'rechazado'
                          ? `Rechazado${p.resuelto_en ? ` el ${cuando(p.resuelto_en)}` : ''}${p.motivo_rechazo ? ` — ${p.motivo_rechazo}` : ''}`
                          : 'Venció sin usarse'}
                  </div>
                ) : rechazando === p.id ? (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 12 }}>
                    <input
                      type="text"
                      placeholder="Motivo del rechazo (opcional)"
                      value={motivos[p.id] ?? ''}
                      onChange={(e) => setMotivos((m) => ({ ...m, [p.id]: e.target.value }))}
                      style={{ flex: 1, minWidth: 220 }}
                    />
                    <button
                      className="primario"
                      disabled={trabajando}
                      onClick={() => rechazar.mutate({ id: p.id, motivo: motivos[p.id] ?? '' })}
                    >
                      Confirmar rechazo
                    </button>
                    <button className="chico" disabled={trabajando} onClick={() => setRechazando(null)}>
                      Volver
                    </button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                    <button className="primario" disabled={trabajando} onClick={() => aprobar.mutate(p.id)}>
                      ✓ Permitir editar
                    </button>
                    <button className="chico" disabled={trabajando} onClick={() => setRechazando(p.id)}>
                      Rechazar
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}
