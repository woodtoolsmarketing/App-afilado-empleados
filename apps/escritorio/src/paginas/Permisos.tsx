import {
  ETIQUETA_ROL,
  ROLES_CONFIGURABLES,
  type Funcion,
  type RolUsuario,
} from '@woodtools/compartido'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { supabase } from '../nucleo/supabase'

/**
 * Permisos por rol.
 *
 * Dos matrices: qué opción de la APP ve cada rol, y qué sección del PANEL ve
 * cada rol. El administrador tilda o destilda; la app y el panel esconden lo que
 * el rol no tenga habilitado. El administrador ve TODO siempre —no se lo puede
 * autobloquear—, así que su columna va fija en "Siempre".
 *
 * El panel no lo usan los vendedores, así que su matriz sólo muestra supervisor
 * y administración. Una opción que todavía no está en la tabla se considera
 * visible (app) / oculta para no-admin (panel): ver `usarPermisos`/`usarPermisosPanel`.
 */

/** Los roles que se pueden tildar en la matriz del PANEL (el vendedor no entra). */
const ROLES_PANEL: RolUsuario[] = ROLES_CONFIGURABLES.filter((r) => r !== 'vendedor')

export function PaginaPermisos({ soloLectura }: { soloLectura: boolean }) {
  const cliente = useQueryClient()
  const [mensaje, setMensaje] = useState<string | null>(null)

  const { data: funciones, isLoading } = useQuery({
    queryKey: ['funciones-todas'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('funciones')
        .select('clave, etiqueta, descripcion, orden, roles_habilitados, ambito')
        .order('orden')
      if (error) throw error
      return data as Funcion[]
    },
  })

  const guardar = useMutation({
    mutationFn: async (params: { clave: string; roles: RolUsuario[] }) => {
      const { error } = await supabase
        .from('funciones')
        .update({ roles_habilitados: params.roles })
        .eq('clave', params.clave)
      if (error) throw error
    },
    onSuccess: () => {
      setMensaje('Permiso actualizado.')
      // Refresca las tres cachés que leen `funciones`: esta página, la app y el
      // sidebar del panel.
      void cliente.invalidateQueries({ queryKey: ['funciones-todas'] })
      void cliente.invalidateQueries({ queryKey: ['funciones'] })
      void cliente.invalidateQueries({ queryKey: ['funciones-panel'] })
    },
    onError: (e: Error) => setMensaje(`No se pudo guardar: ${e.message}`),
  })

  function alternar(f: Funcion, rol: RolUsuario, habilitar: boolean) {
    const roles = habilitar
      ? [...f.roles_habilitados, rol]
      : f.roles_habilitados.filter((r) => r !== rol)
    guardar.mutate({ clave: f.clave, roles })
  }

  const deApp = (funciones ?? []).filter((f) => f.ambito !== 'panel')
  const dePanel = (funciones ?? []).filter((f) => f.ambito === 'panel')

  const enGuardado = (clave: string) => guardar.isPending && guardar.variables?.clave === clave

  return (
    <>
      <header className="encabezado-pagina">
        <div>
          <h1>Permisos</h1>
          <p>Qué ve cada rol. Destildá para esconderlo. El administrador ve todo siempre.</p>
        </div>
      </header>

      {mensaje && (
        <div className="aviso exito" role="status">
          {mensaje}
        </div>
      )}

      {isLoading ? (
        <section className="tarjeta">
          <p>Cargando…</p>
        </section>
      ) : (
        <>
          <section className="tarjeta">
            <h2>Opciones de la app</h2>
            <TablaPermisos
              funciones={deApp}
              roles={ROLES_CONFIGURABLES}
              soloLectura={soloLectura}
              enGuardado={enGuardado}
              alternar={alternar}
            />
          </section>

          <section className="tarjeta">
            <h2>Secciones del panel</h2>
            <p style={{ marginTop: -8, color: 'var(--tinta-tenue)' }}>
              Qué secciones del panel ve cada rol. El Tablero lo ve cualquiera que entre, y los
              vendedores no usan el panel.
            </p>
            <TablaPermisos
              funciones={dePanel}
              roles={ROLES_PANEL}
              soloLectura={soloLectura}
              enGuardado={enGuardado}
              alternar={alternar}
            />
          </section>
        </>
      )}
    </>
  )
}

function TablaPermisos({
  funciones,
  roles,
  soloLectura,
  enGuardado,
  alternar,
}: {
  funciones: Funcion[]
  roles: RolUsuario[]
  soloLectura: boolean
  enGuardado: (clave: string) => boolean
  alternar: (f: Funcion, rol: RolUsuario, habilitar: boolean) => void
}) {
  return (
    <table>
      <thead>
        <tr>
          <th>Opción</th>
          {roles.map((r) => (
            <th key={r} style={{ textAlign: 'center' }}>
              {ETIQUETA_ROL[r]}
            </th>
          ))}
          <th style={{ textAlign: 'center' }}>Administrador</th>
        </tr>
      </thead>
      <tbody>
        {funciones.map((f) => (
          <tr key={f.clave}>
            <td>
              <strong>{f.etiqueta}</strong>
              {f.descripcion ? (
                <>
                  <br />
                  <small style={{ color: 'var(--tinta-tenue)' }}>{f.descripcion}</small>
                </>
              ) : null}
            </td>
            {roles.map((r) => (
              <td key={r} style={{ textAlign: 'center' }}>
                <input
                  type="checkbox"
                  aria-label={`${f.etiqueta} — ${ETIQUETA_ROL[r]}`}
                  checked={f.roles_habilitados.includes(r)}
                  disabled={soloLectura || enGuardado(f.clave)}
                  onChange={(e) => alternar(f, r, e.target.checked)}
                />
              </td>
            ))}
            <td style={{ textAlign: 'center', color: 'var(--tinta-tenue)' }}>
              <small>Siempre</small>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
