import type { Perfil } from '@woodtools/compartido'
import { useEffect, useState } from 'react'

import { supabase } from './supabase'

/**
 * Sesión del panel.
 *
 * Al panel sólo entran `admin` y `supervisor`. Un vendedor tiene credenciales
 * válidas pero acá no tiene nada que hacer, así que se lo rechaza en el
 * ingreso — y aunque forzara la interfaz, RLS no le devolvería datos ajenos.
 */

export interface EstadoSesion {
  cargando: boolean
  perfil: Perfil | null
  error: string | null
}

export function usarSesion() {
  const [estado, setEstado] = useState<EstadoSesion>({
    cargando: true,
    perfil: null,
    error: null,
  })

  async function cargarPerfil() {
    const { data: sesion } = await supabase.auth.getSession()
    if (!sesion.session) {
      setEstado({ cargando: false, perfil: null, error: null })
      return
    }

    const { data: perfil } = await supabase
      .from('perfiles')
      .select('*')
      .eq('id', sesion.session.user.id)
      .maybeSingle<Perfil>()

    if (!perfil || perfil.estado !== 'aprobado') {
      await supabase.auth.signOut()
      setEstado({
        cargando: false,
        perfil: null,
        error: 'Tu cuenta no está habilitada para usar el panel.',
      })
      return
    }

    if (perfil.rol === 'vendedor') {
      await supabase.auth.signOut()
      setEstado({
        cargando: false,
        perfil: null,
        error: 'El panel de escritorio es para administradores y supervisores. Usá la app del celular.',
      })
      return
    }

    setEstado({ cargando: false, perfil, error: null })
  }

  useEffect(() => {
    void cargarPerfil()

    const { data } = supabase.auth.onAuthStateChange((evento) => {
      if (evento === 'SIGNED_OUT') setEstado({ cargando: false, perfil: null, error: null })
      if (evento === 'SIGNED_IN' || evento === 'TOKEN_REFRESHED') void cargarPerfil()
    })

    return () => data.subscription.unsubscribe()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return {
    ...estado,
    esAdmin: estado.perfil?.rol === 'admin',
    recargar: cargarPerfil,
    salir: () => supabase.auth.signOut(),
    setError: (error: string | null) => setEstado((e) => ({ ...e, error })),
  }
}
