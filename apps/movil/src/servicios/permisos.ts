import { useQuery } from '@tanstack/react-query'
import {
  rolPuedeVer,
  type ClaveFuncion,
  type Funcion,
  type RolUsuario,
} from '@woodtools/compartido'

import { usarSesion } from '../nucleo/sesion'
import { supabase } from '../nucleo/supabase'

/**
 * Permisos por rol: qué opciones de la app ve el usuario actual.
 *
 * La oficina configura desde el panel qué roles ven cada opción del menú (como
 * "Cobranzas del día"). Acá se lee ese catálogo (`funciones`) y se expone
 * `puedeVer(clave)` atado al rol de la sesión.
 *
 * ── Sin parpadeo de lo restringido ──────────────────────────────────────────
 *
 * Mientras el catálogo no llegó del servidor (arranque en frío), `rolPuedeVer`
 * se cae al respaldo del catálogo canónico: Cobranzas y Mapa arrancan admin-only,
 * así una opción restringida NO aparece un instante y después desaparece. Cuando
 * llega la config del servidor, esa manda. Se cachea fuerte porque cambia
 * poquísimo.
 */

async function traerFunciones(): Promise<Funcion[]> {
  const { data, error } = await supabase
    .from('funciones')
    .select('clave, etiqueta, descripcion, orden, roles_habilitados')
    .order('orden')
  if (error) throw error
  return (data ?? []) as Funcion[]
}

export function usarPermisos(): { puedeVer: (clave: ClaveFuncion) => boolean; cargando: boolean } {
  const rol = usarSesion((s) => s.perfil?.rol)

  const { data, isLoading } = useQuery({
    queryKey: ['funciones'],
    queryFn: traerFunciones,
    // Cambia muy de vez en cuando; no hace falta consultarlo seguido.
    staleTime: 10 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    // No tiene sentido pedirlo antes de haber entrado.
    enabled: !!rol,
  })

  const catalogo: Map<ClaveFuncion, RolUsuario[]> | null = data
    ? new Map(data.map((f) => [f.clave, f.roles_habilitados]))
    : null

  function puedeVer(clave: ClaveFuncion): boolean {
    if (!rol) return false
    return rolPuedeVer(clave, rol, catalogo)
  }

  return { puedeVer, cargando: isLoading }
}
