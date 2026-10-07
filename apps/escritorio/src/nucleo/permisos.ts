import { useQuery } from '@tanstack/react-query'
import type { ClaveFuncionPanel, Funcion, RolUsuario } from '@woodtools/compartido'

import { supabase } from './supabase'

/**
 * Permisos del panel por rol.
 *
 * Qué sección del panel ve cada rol lo decide la tabla `funciones` (ámbito
 * 'panel'), que el administrador configura desde "Permisos". admin ve TODO
 * siempre. El Tablero (landing) y Permisos quedan afuera del catálogo: el
 * Tablero lo ve cualquiera que entre, y Permisos es sólo de admin.
 *
 * Mientras no llegó la config, para un rol que no es admin se esconde todo (se
 * muestra recién lo habilitado): es un panel, no hay apuro ni datos que se filtren
 * —la RLS igual gatea el backend—, y así nada aparece un instante y se va.
 */

async function traerFuncionesPanel(): Promise<Funcion[]> {
  const { data, error } = await supabase
    .from('funciones')
    .select('clave, etiqueta, descripcion, orden, roles_habilitados, ambito')
    .eq('ambito', 'panel')
    .order('orden')
  if (error) throw error
  return (data ?? []) as Funcion[]
}

export function usarPermisosPanel(rol: RolUsuario | undefined): {
  puedeVer: (clave: ClaveFuncionPanel) => boolean
  listo: boolean
} {
  const { data } = useQuery({
    queryKey: ['funciones-panel'],
    queryFn: traerFuncionesPanel,
    staleTime: 10 * 60 * 1000,
    enabled: !!rol,
  })

  const catalogo = data
    ? new Map<string, RolUsuario[]>(data.map((f) => [f.clave, f.roles_habilitados]))
    : null

  function puedeVer(clave: ClaveFuncionPanel): boolean {
    if (rol === 'admin') return true
    if (!rol || !catalogo) return false
    const roles = catalogo.get(clave)
    return roles ? roles.includes(rol) : false
  }

  // admin no necesita esperar la consulta: ve todo igual.
  return { puedeVer, listo: rol === 'admin' || !!data }
}
