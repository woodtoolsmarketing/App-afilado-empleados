import { supabase } from '../nucleo/supabase'

/**
 * Pasar de una coordenada a un domicilio escrito, desde el panel.
 *
 * Es lo mismo que hace la app del vendedor en `apps/movil/src/servicios/mapas.ts`
 * (`ubicacionComoDireccion`): las dos llaman a la MISMA Edge Function
 * `geocodificar` con `operacion: 'reversa'`, así el domicilio sale formateado
 * igual en los dos lados. La clave de Google vive sólo en el servidor
 * (`GOOGLE_MAPS_SERVER_KEY`), nunca en el panel, que es lo que queremos: una app
 * de escritorio no puede guardar una clave sin que cualquiera la saque del
 * instalador.
 *
 * Las coordenadas que devuelve son LAS QUE SE LE MANDARON (el pin que puso el
 * que carga), no el portal que Google elige como más cercano: si el pin cae en
 * la puerta del galpón, ahí queda, aunque Google escriba el número de la
 * esquina. La calle y la altura son sólo para confirmar que es ése.
 */
export interface DireccionResuelta {
  direccion_formateada: string
  calle: string | null
  numero: string | null
  localidad: string | null
  provincia: string | null
  pais: string
  codigo_postal: string | null
  lat: number
  lng: number
  google_place_id: string | null
  verificada: boolean
}

/**
 * Invoca una Edge Function dejando pasar el motivo real del error.
 *
 * `functions.invoke` siempre devuelve el mismo "Edge Function returned a non-2xx
 * status code"; el motivo verdadero —por ejemplo que falta `GOOGLE_MAPS_SERVER_KEY`—
 * viaja en el cuerpo (`error.context`). Sin esto, una función mal configurada se
 * ve como "no pudimos resolver la dirección" y nadie se entera de qué falta.
 */
async function invocar<T>(nombre: string, cuerpo: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(nombre, { body: cuerpo })
  if (!error) return data as T

  let motivo: string | null = null
  const respuesta = (error as { context?: Response }).context
  if (respuesta && typeof respuesta.json === 'function') {
    try {
      const cuerpoError = await respuesta.json()
      if (typeof cuerpoError?.error === 'string') motivo = cuerpoError.error
    } catch {
      // No era JSON: nos quedamos con el error original.
    }
  }
  throw motivo ? new Error(motivo) : (error as Error)
}

/** El domicilio en la coordenada elegida, para que el que carga lo confirme. */
export async function ubicacionComoDireccion(coords: {
  lat: number
  lng: number
}): Promise<DireccionResuelta> {
  const data = await invocar<{ direccion?: DireccionResuelta }>('geocodificar', {
    operacion: 'reversa',
    lat: coords.lat,
    lng: coords.lng,
  })
  if (!data?.direccion?.lat) {
    throw new Error('Google no devolvió una dirección para ese punto. Movelo un poco y probá de nuevo.')
  }
  return data.direccion
}
