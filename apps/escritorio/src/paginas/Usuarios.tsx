import { ETIQUETA_ESTADO_USUARIO, type Perfil, type RolUsuario } from '@woodtools/compartido'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { supabase } from '../nucleo/supabase'

/**
 * Altas, bajas y aprobaciones.
 *
 * Son los dos candados que separan "tener la contraseña" de "poder usar la
 * app": el alta del usuario y la habilitación del teléfono. Los dos se resuelven
 * desde acá.
 */
export function PaginaUsuarios({ soloLectura }: { soloLectura: boolean }) {
  const cliente = useQueryClient()
  const [mensaje, setMensaje] = useState<string | null>(null)

  const { data: perfiles, isLoading } = useQuery({
    queryKey: ['perfiles'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('perfiles')
        .select('*')
        .order('estado', { ascending: true })
        .order('creado_en', { ascending: false })
      if (error) throw error
      return data as Perfil[]
    },
  })

  const { data: dispositivos } = useQuery({
    queryKey: ['dispositivos'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('dispositivos')
        .select('*, perfiles ( nombre_completo, codigo_vendedor )')
        .order('creado_en', { ascending: false })
      if (error) throw error
      return data as Array<
        Record<string, unknown> & {
          id: string
          instalacion_id: string
          autorizado: boolean
          perfiles: { nombre_completo: string; codigo_vendedor: string | null } | null
        }
      >
    },
  })

  const resolver = useMutation({
    mutationFn: async (params: {
      perfilId: string
      aprobar: boolean
      rol?: RolUsuario
      codigo?: string
      motivo?: string
    }) => {
      const { error } = await supabase.rpc('resolver_alta_usuario', {
        p_perfil_id: params.perfilId,
        p_aprobar: params.aprobar,
        p_rol: params.rol ?? 'vendedor',
        p_codigo: params.codigo ?? null,
        p_motivo: params.motivo ?? null,
      })
      if (error) throw error
    },
    onSuccess: (_d, v) => {
      setMensaje(v.aprobar ? 'Usuario aprobado. Ya puede entrar a la app.' : 'Solicitud rechazada.')
      void cliente.invalidateQueries()
    },
    onError: (e: Error) => setMensaje(`No se pudo completar: ${e.message}`),
  })

  const cambiarEstado = useMutation({
    mutationFn: async (params: { perfilId: string; estado: Perfil['estado'] }) => {
      const { error } = await supabase
        .from('perfiles')
        .update({ estado: params.estado })
        .eq('id', params.perfilId)
      if (error) throw error
    },
    onSuccess: () => {
      setMensaje('Estado actualizado.')
      void cliente.invalidateQueries()
    },
  })

  const autorizarDispositivo = useMutation({
    mutationFn: async (params: { id: string; autorizado: boolean }) => {
      const { error } = await supabase
        .from('dispositivos')
        .update({
          autorizado: params.autorizado,
          autorizado_en: params.autorizado ? new Date().toISOString() : null,
        })
        .eq('id', params.id)
      if (error) throw error
    },
    onSuccess: () => {
      setMensaje('Teléfono actualizado.')
      void cliente.invalidateQueries()
    },
  })

  const pendientes = (perfiles ?? []).filter((p) => p.estado === 'pendiente')
  const resto = (perfiles ?? []).filter((p) => p.estado !== 'pendiente')
  const telefonosPendientes = (dispositivos ?? []).filter((d) => !d.autorizado)

  return (
    <>
      <header className="encabezado-pagina">
        <div>
          <h1>Usuarios</h1>
          <p>Aprobá altas, asigná el código de vendedor y habilitá los teléfonos.</p>
        </div>
      </header>

      {mensaje && (
        <div className="aviso exito" role="status">
          {mensaje}
        </div>
      )}
      {soloLectura && (
        <div className="aviso atencion">
          Estás como supervisor: podés ver todo, pero las altas y bajas las resuelve un administrador.
        </div>
      )}

      {/* ── Altas esperando aprobación ─────────────────────────────────────── */}
      <section className="tarjeta">
        <h2>Esperando aprobación ({pendientes.length})</h2>

        {isLoading ? (
          <p>Cargando…</p>
        ) : pendientes.length === 0 ? (
          <p className="vacio">No hay solicitudes pendientes.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Usuario</th>
                <th>Solicitado</th>
                <th style={{ width: 300 }}>Aprobar como</th>
                <th style={{ width: 130 }} />
              </tr>
            </thead>
            <tbody>
              {pendientes.map((p) => (
                <FilaPendiente
                  key={p.id}
                  perfil={p}
                  soloLectura={soloLectura}
                  alResolver={(datos) => resolver.mutate({ perfilId: p.id, ...datos })}
                />
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* ── Teléfonos ──────────────────────────────────────────────────────── */}
      <section className="tarjeta">
        <h2>Teléfonos por habilitar ({telefonosPendientes.length})</h2>

        {telefonosPendientes.length === 0 ? (
          <p className="vacio">Todos los teléfonos registrados están habilitados.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Vendedor</th>
                <th>Equipo</th>
                <th>Código</th>
                <th>Versión</th>
                <th style={{ width: 140 }} />
              </tr>
            </thead>
            <tbody>
              {telefonosPendientes.map((d) => (
                <tr key={d.id}>
                  <td>
                    {d.perfiles?.nombre_completo ?? '—'}
                    {d.perfiles?.codigo_vendedor ? ` (#${d.perfiles.codigo_vendedor})` : ''}
                  </td>
                  <td>
                    {String(d.fabricante ?? '')} {String(d.modelo ?? '')}
                    <br />
                    <small style={{ color: 'var(--tinta-tenue)' }}>{String(d.version_so ?? '')}</small>
                  </td>
                  {/* El vendedor ve estos 8 caracteres en su pantalla de espera. */}
                  <td>
                    <code>{d.instalacion_id.slice(0, 8).toUpperCase()}</code>
                  </td>
                  <td>{String(d.version_app ?? '—')}</td>
                  <td>
                    <button
                      className="primario chico"
                      disabled={soloLectura}
                      onClick={() => autorizarDispositivo.mutate({ id: d.id, autorizado: true })}
                    >
                      Habilitar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* ── Todos ──────────────────────────────────────────────────────────── */}
      <section className="tarjeta">
        <h2>Todos los usuarios ({resto.length})</h2>

        <table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Código</th>
              <th>Rol</th>
              <th>Estado</th>
              <th>Último acceso</th>
              <th style={{ width: 210 }} />
            </tr>
          </thead>
          <tbody>
            {resto.map((p) => (
              <tr key={p.id}>
                <td>
                  {p.nombre_completo}
                  <br />
                  <small style={{ color: 'var(--tinta-tenue)' }}>{p.email}</small>
                </td>
                <td>{p.codigo_vendedor ? `#${p.codigo_vendedor}` : '—'}</td>
                <td style={{ textTransform: 'capitalize' }}>{p.rol}</td>
                <td>
                  <span className={`pastilla ${claseEstado(p.estado)}`}>
                    {ETIQUETA_ESTADO_USUARIO[p.estado]}
                  </span>
                </td>
                <td>
                  {p.ultimo_acceso_en
                    ? new Date(p.ultimo_acceso_en).toLocaleString('es-AR', {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      })
                    : 'Nunca'}
                </td>
                <td>
                  <div className="acciones">
                    {p.estado === 'aprobado' ? (
                      <button
                        className="chico"
                        disabled={soloLectura}
                        onClick={() => cambiarEstado.mutate({ perfilId: p.id, estado: 'suspendido' })}
                      >
                        Suspender
                      </button>
                    ) : (
                      <button
                        className="chico primario"
                        disabled={soloLectura}
                        onClick={() => cambiarEstado.mutate({ perfilId: p.id, estado: 'aprobado' })}
                      >
                        Reactivar
                      </button>
                    )}
                    <button
                      className="chico peligro"
                      disabled={soloLectura || p.estado === 'baja'}
                      onClick={() => {
                        if (confirm(`¿Dar de baja definitiva a ${p.nombre_completo}?`)) {
                          cambiarEstado.mutate({ perfilId: p.id, estado: 'baja' })
                        }
                      }}
                    >
                      Baja
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  )
}

function FilaPendiente({
  perfil,
  soloLectura,
  alResolver,
}: {
  perfil: Perfil
  soloLectura: boolean
  alResolver: (datos: { aprobar: boolean; rol?: RolUsuario; codigo?: string; motivo?: string }) => void
}) {
  const [rol, setRol] = useState<RolUsuario>('vendedor')
  const [codigo, setCodigo] = useState(perfil.codigo_vendedor ?? '')

  // Sin código de vendedor la planilla del rol de visita queda sin la columna
  // "Codigo", así que se exige antes de aprobar.
  const faltaCodigo = rol === 'vendedor' && !codigo.trim()

  return (
    <tr>
      <td>{perfil.nombre_completo}</td>
      <td>{perfil.email}</td>
      <td>{new Date(perfil.creado_en).toLocaleDateString('es-AR')}</td>
      <td>
        <div style={{ display: 'flex', gap: 8 }}>
          <select value={rol} onChange={(e) => setRol(e.target.value as RolUsuario)}>
            <option value="vendedor">Vendedor</option>
            <option value="supervisor">Supervisor</option>
            <option value="admin">Administrador</option>
          </select>
          <input
            placeholder="Código"
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
            style={{ maxWidth: 110 }}
            aria-label="Código de vendedor"
          />
        </div>
        {faltaCodigo && <div className="error-campo">Asigná el código de vendedor</div>}
      </td>
      <td>
        <div className="acciones">
          <button
            className="primario chico"
            disabled={soloLectura || faltaCodigo}
            onClick={() => alResolver({ aprobar: true, rol, codigo })}
          >
            Aprobar
          </button>
          <button
            className="peligro chico"
            disabled={soloLectura}
            onClick={() => {
              const motivo = prompt('Motivo del rechazo (lo va a ver el usuario):')
              if (motivo !== null) alResolver({ aprobar: false, motivo })
            }}
          >
            Rechazar
          </button>
        </div>
      </td>
    </tr>
  )
}

function claseEstado(estado: Perfil['estado']): string {
  switch (estado) {
    case 'aprobado':
      return 'verde'
    case 'pendiente':
      return 'ambar'
    case 'rechazado':
    case 'baja':
      return 'roja'
    default:
      return 'gris'
  }
}
