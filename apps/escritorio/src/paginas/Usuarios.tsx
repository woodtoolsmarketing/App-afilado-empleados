import { ETIQUETA_ESTADO_USUARIO, type Perfil, type RolUsuario } from '@woodtools/compartido'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { supabase } from '../nucleo/supabase'
import { AltaUsuario } from './AltaUsuario'

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
  const [mostrarAlta, setMostrarAlta] = useState(false)

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

  /*
   * La última conexión de cada uno.
   *
   * `perfiles.ultimo_acceso_en` sola no sirve para esto: se escribe únicamente
   * cuando alguien tipea la contraseña, y la sesión de la app no vence, así
   * que la columna decía "Nunca" de gente que había abierto la app el día
   * anterior. La vista toma el máximo de las cuatro señales que ya se venían
   * guardando. Ver la migración 20260902115441.
   */
  const { data: conexiones } = useQuery({
    queryKey: ['ultima-conexion'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vista_ultima_conexion')
        .select('perfil_id, ultima_conexion, de_donde, cuantos_aparatos')
      if (error) throw error
      return data as Array<{
        perfil_id: string
        ultima_conexion: string | null
        de_donde: string | null
        cuantos_aparatos: number | null
      }>
    },
    refetchInterval: 60_000,
  })

  const conexionDe = new Map((conexiones ?? []).map((c) => [c.perfil_id, c]))

  const { data: dispositivos, error: falloDispositivos } = useQuery({
    queryKey: ['dispositivos'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('dispositivos')
        // El nombre de la clave foránea va explícito y no es un adorno:
        // `dispositivos` apunta DOS veces a `perfiles` —de quién es el teléfono
        // y quién lo habilitó—. Pidiendo "perfiles" a secas, PostgREST no sabe
        // por cuál de los dos caminos ir y rechaza la consulta entera. La lista
        // quedaba vacía y la pantalla anunciaba que no había teléfonos
        // esperando, que es la peor forma de fallar: sin ruido y diciendo que
        // todo está bien.
        .select('*, perfiles!dispositivos_perfil_id_fkey ( nombre_completo, codigo_vendedor )')
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

  /**
   * Qué zonas cubre cada vendedor.
   *
   * Con esto la nota de pedido puede completar sola el número de vendedor
   * cuando quien la carga no tiene uno propio. Mientras la columna esté vacía
   * no pasa nada malo: el campo de la nota simplemente queda para completar a
   * mano, como hasta ahora.
   */
  const guardarZonas = useMutation({
    mutationFn: async (params: { perfilId: string; zonas: string[] }) => {
      const { error } = await supabase
        .from('perfiles')
        .update({ zonas: params.zonas })
        .eq('id', params.perfilId)
      if (error) throw error
    },
    onSuccess: () => {
      setMensaje('Zonas actualizadas.')
      void cliente.invalidateQueries()
    },
    onError: (e: Error) => setMensaje(`No se pudieron guardar las zonas: ${e.message}`),
  })

  /**
   * El número de vendedor, después del alta.
   *
   * Hasta ahora se cargaba una sola vez, al aprobar el usuario, y si quedaba
   * mal no había dónde corregirlo: el número va impreso en cada nota de pedido
   * y en la columna "Codigo" del rol de visita, así que un dígito equivocado se
   * arrastra a todo el papel que firma ese vendedor.
   */
  const guardarCodigo = useMutation({
    mutationFn: async (params: { perfilId: string; codigo: string }) => {
      const limpio = params.codigo.trim()
      const { error } = await supabase
        .from('perfiles')
        .update({ codigo_vendedor: limpio === '' ? null : limpio })
        .eq('id', params.perfilId)
      if (error) throw error
    },
    onSuccess: () => {
      setMensaje('Número de vendedor actualizado. Sale en las notas nuevas.')
      void cliente.invalidateQueries()
    },
    onError: (e: Error) => setMensaje(`No se pudo guardar el número: ${e.message}`),
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
          <p>Dá de alta empleados, asigná el código de vendedor y habilitá los teléfonos.</p>
        </div>
        {!soloLectura && !mostrarAlta && (
          <button className="primario" onClick={() => setMostrarAlta(true)}>
            + Nuevo usuario
          </button>
        )}
      </header>

      {mostrarAlta && (
        <AltaUsuario
          alTerminar={() => {
            setMostrarAlta(false)
            void cliente.invalidateQueries()
          }}
        />
      )}

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

        {/* Sin esto, un fallo al traer la lista se ve igual que "no hay
            teléfonos esperando", y alguien se queda sin poder entrar a la app
            mientras el panel asegura que está todo en orden. */}
        {falloDispositivos ? (
          <p className="vacio" style={{ color: 'var(--rojo-accion)' }}>
            No pudimos traer los teléfonos: {(falloDispositivos as Error).message}. Nadie confirmó
            que no haya ninguno esperando; volvé a entrar en un momento.
          </p>
        ) : telefonosPendientes.length === 0 ? (
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
              <th>Zonas a cargo</th>
              <th>Rol</th>
              <th>Estado</th>
              <th>Última conexión</th>
              <th style={{ width: 210 }} />
            </tr>
          </thead>
          <tbody>
            {resto.map((p) => (
              <tr key={p.id}>
                <td>
                  {p.nombre_completo}
                  <br />
                  {/* El usuario es con lo que entra a la app; el correo, la
                      otra forma de entrar. Los dos sirven, así que los dos se
                      muestran. */}
                  <small style={{ color: 'var(--tinta-tenue)' }}>
                    {p.usuario ? `${p.usuario} · ` : ''}
                    {p.email}
                  </small>
                </td>
                <td>
                  <CodigoDeVendedor
                    perfil={p}
                    soloLectura={soloLectura}
                    alGuardar={(codigo) => guardarCodigo.mutate({ perfilId: p.id, codigo })}
                  />
                </td>
                <td>
                  <ZonasACargo
                    perfil={p}
                    soloLectura={soloLectura}
                    alGuardar={(zonas) => guardarZonas.mutate({ perfilId: p.id, zonas })}
                  />
                </td>
                <td style={{ textTransform: 'capitalize' }}>{p.rol}</td>
                <td>
                  <span className={`pastilla ${claseEstado(p.estado)}`}>
                    {ETIQUETA_ESTADO_USUARIO[p.estado]}
                  </span>
                </td>
                <td>
                  {conexionDe.get(p.id)?.ultima_conexion ? (
                    <>
                      {new Date(conexionDe.get(p.id)!.ultima_conexion!).toLocaleString('es-AR', {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      })}
                      <br />
                      {/* De dónde salió: no es lo mismo el que abrió la app que
                          el que sólo tipeó la contraseña una vez. */}
                      <small style={{ color: 'var(--tinta-tenue)' }}>
                        {conexionDe.get(p.id)?.de_donde}
                      </small>
                    </>
                  ) : (
                    'Nunca'
                  )}
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

/**
 * Las zonas del vendedor, escritas como en la planilla: "107, 121, 146".
 *
 * Se guardan sólo al tocar "Guardar" y no mientras se escribe: un `onChange`
 * que dispara un UPDATE por tecla convierte un error de tipeo en una zona
 * asignada a medias.
 *
 * No se validan contra el catálogo de zonas a propósito: la planilla es de la
 * empresa y puede sumar una zona antes que el código. Un código que no existe
 * simplemente no le va a coincidir a ninguna nota.
 */
/**
 * El número de vendedor de la celda, editable en el lugar.
 *
 * Mismo trato que las zonas: se escribe y el botón de guardar aparece recién
 * cuando hay algo distinto que guardar. Vaciarlo lo deja sin número, que es una
 * situación válida —administración y supervisores no llevan uno— y no un error.
 */
function CodigoDeVendedor({
  perfil,
  soloLectura,
  alGuardar,
}: {
  perfil: Perfil
  soloLectura: boolean
  alGuardar: (codigo: string) => void
}) {
  const guardado = perfil.codigo_vendedor ?? ''
  const [texto, setTexto] = useState(guardado)

  const cambio = texto.trim() !== guardado

  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <input
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        placeholder="—"
        inputMode="numeric"
        disabled={soloLectura}
        style={{ width: 56 }}
        aria-label={`Número de vendedor de ${perfil.nombre_completo}`}
      />
      {cambio ? (
        <button
          className="chico primario"
          disabled={soloLectura}
          onClick={() => alGuardar(texto)}
        >
          Guardar
        </button>
      ) : null}
    </div>
  )
}

function ZonasACargo({
  perfil,
  soloLectura,
  alGuardar,
}: {
  perfil: Perfil
  soloLectura: boolean
  alGuardar: (zonas: string[]) => void
}) {
  const guardadas = (perfil.zonas ?? []).join(', ')
  const [texto, setTexto] = useState(guardadas)

  const zonas = texto
    .split(/[,\s]+/)
    .map((z) => z.trim())
    .filter(Boolean)

  const cambio = zonas.join(', ') !== guardadas

  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <input
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        placeholder="107, 121"
        disabled={soloLectura}
        style={{ width: 120 }}
        aria-label={`Zonas a cargo de ${perfil.nombre_completo}`}
      />
      {cambio ? (
        <button className="chico primario" disabled={soloLectura} onClick={() => alGuardar(zonas)}>
          Guardar
        </button>
      ) : null}
    </div>
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
            <option value="administracion">Administración</option>
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
