import { urlDeFoto } from '@woodtools/compartido'
import { useEffect, useState } from 'react'

import { supabase } from './supabase'

/**
 * La foto de un perfil, lista para mostrar.
 *
 * `perfiles.foto_url` guarda la ruta dentro del bucket privado, no una
 * dirección web: hay que pedirle a Supabase una URL firmada antes de dibujarla.
 * Como eso es asincrónico y el componente ya está en pantalla, arranca en null
 * —o sea, iniciales— y aparece cuando llega.
 *
 * Devuelve null también si la firma falla, para que quien la use muestre las
 * iniciales en vez de un cuadro roto.
 */
export function usarFotoDePerfil(ruta: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    let vigente = true

    if (!ruta) {
      setUrl(null)
      return
    }

    urlDeFoto(supabase, ruta)
      .then((u) => {
        if (vigente) setUrl(u)
      })
      .catch(() => {
        if (vigente) setUrl(null)
      })

    return () => {
      vigente = false
    }
  }, [ruta])

  return url
}
