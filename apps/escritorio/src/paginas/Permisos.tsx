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
 * Qué opción de la app ve cada rol. El administrador tilda o destilda, y la app
 * esconde lo que el rol no tenga habilitado (como "Cobranzas del día"). El
 * administrador ve TODO siempre —no se lo puede autobloquear—, así que su
 * columna va fija en "Siempre".
 *
 * Una opción que todavía no está en esta tabla se considera visible para todos,
 * así una función nueva de la app no queda escondida hasta configurarla.
 */
export function PaginaPermisos({ soloLectura }: { soloLectura: boolean }) {
  const cliente = useQueryClient()
  const [mensaje, setMensaje] = useState<string | null>(null)

  const { data: funciones, isLoading } = useQuery({
    queryKey: ['funciones'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('funciones')
        .select('clave, etiqueta, descripcion, orden, roles_habilitados')
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
      void cliente.invalidateQueries({ queryKey: ['funciones'] })
    },
    onError: (e: Error) => setMensaje(`No se pudo guardar: ${e.message}`),
  })

  function alternar(f: Funcion, rol: RolUsuario, habilitar: boolean) {
    const roles = habilitar
      ? [...f.roles_habilitados, rol]
      : f.roles_habilitados.filter((r) => r !== rol)
    guardar.mutate({ clave: f.clave, roles })
  }

  return (
    <>
      <header className="encabezado-pagina">
        <div>
          <h1>Permisos</h1>
          <p>
            Qué opción de la app ve cada rol. Destildá para esconderla. El administrador ve todo
            siempre.
          </p>
        </div>
      </header>

      {mensaje && (
        <div className="aviso exito" role="status">
          {mensaje}
        </div>
      )}

      <section className="tarjeta">
        <h2>Opciones de la app</h2>
        {isLoading ? (
          <p>Cargando…</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Opción</th>
                {ROLES_CONFIGURABLES.map((r) => (
                  <th key={r} style={{ textAlign: 'center' }}>
                    {ETIQUETA_ROL[r]}
                  </th>
                ))}
                <th style={{ textAlign: 'center' }}>Administrador</th>
              </tr>
            </thead>
            <tbody>
              {(funciones ?? []).map((f) => (
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
                  {ROLES_CONFIGURABLES.map((r) => (
                    <td key={r} style={{ textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        aria-label={`${f.etiqueta} — ${ETIQUETA_ROL[r]}`}
                        checked={f.roles_habilitados.includes(r)}
                        disabled={
                          soloLectura || (guardar.isPending && guardar.variables?.clave === f.clave)
                        }
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
        )}
      </section>
    </>
  )
}
