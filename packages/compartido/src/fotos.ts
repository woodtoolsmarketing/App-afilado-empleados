import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Las fotos de los vendedores.
 *
 * El alta de usuario sube la imagen al bucket **privado** `fotos-vendedores` y
 * guarda en `perfiles.foto_url` la **ruta del objeto** —"ssayago-1786378844567.jpeg"—,
 * no una dirección web. Eso está bien: son fotos de empleados y el bucket no
 * tiene por qué ser público.
 *
 * Lo que faltaba es la otra mitad. El encabezado de la app y el mapa en vivo
 * tomaban ese valor y lo usaban como si fuera una URL, así que el navegador
 * pedía una dirección que no existe y el círculo quedaba vacío. No era que la
 * foto no se hubiera subido: nunca se pedía bien.
 *
 * Acá se resuelve la ruta a una URL firmada, que es lo que un bucket privado
 * entiende. La firma la emite Supabase contra la sesión del usuario, así que
 * sigue respetando la política de storage: sólo un usuario habilitado puede
 * leerlas.
 */

export const BUCKET_FOTOS = 'fotos-vendedores'

/**
 * Seis horas. Una jornada de trabajo entra entera, así que el vendedor no ve
 * la foto desaparecer a media mañana, y si el enlace se filtra tampoco queda
 * vivo para siempre.
 */
const VIGENCIA_SEGUNDOS = 6 * 60 * 60

/**
 * Se renueva cinco minutos antes de vencer. Sin ese margen, una firma pedida
 * justo en el límite llega vencida al servidor.
 */
const MARGEN_MS = 5 * 60 * 1000

interface Firmada {
  url: string
  venceEn: number
}

/**
 * Caché en memoria por ruta.
 *
 * El encabezado se vuelve a dibujar en cada pantalla; sin esto, cada navegación
 * pediría una firma nueva a Supabase para mostrar la misma cara.
 */
const cache = new Map<string, Firmada>()

/** ¿Ya es una dirección usable tal cual? */
function esDireccionCompleta(valor: string): boolean {
  return /^(https?:|data:|file:|blob:)/i.test(valor)
}

/**
 * La URL para mostrar una foto guardada, o null si no hay foto.
 *
 * Devuelve null —y no una cadena vacía— también cuando la firma falla: quien
 * llama ya sabe mostrar las iniciales en ese caso, que es mejor que un cuadro
 * roto.
 */
export async function urlDeFoto(
  supabase: SupabaseClient,
  ruta: string | null | undefined,
): Promise<string | null> {
  const clave = String(ruta ?? '').trim()
  if (!clave) return null

  // Compatibilidad: si alguna quedó guardada como URL entera, se usa así.
  if (esDireccionCompleta(clave)) return clave

  const ahora = Date.now()
  const guardada = cache.get(clave)
  if (guardada && guardada.venceEn - MARGEN_MS > ahora) return guardada.url

  const { data, error } = await supabase.storage
    .from(BUCKET_FOTOS)
    .createSignedUrl(clave, VIGENCIA_SEGUNDOS)

  if (error || !data?.signedUrl) return null

  cache.set(clave, { url: data.signedUrl, venceEn: ahora + VIGENCIA_SEGUNDOS * 1000 })
  return data.signedUrl
}

/**
 * Varias fotos de una vez, para las pantallas que listan gente.
 *
 * Firma cada ruta distinta una sola vez aunque se repita en la lista.
 */
export async function urlesDeFotos(
  supabase: SupabaseClient,
  rutas: Array<string | null | undefined>,
): Promise<Map<string, string>> {
  const distintas = [...new Set(rutas.map((r) => String(r ?? '').trim()).filter(Boolean))]
  const resueltas = await Promise.all(distintas.map((r) => urlDeFoto(supabase, r)))

  const salida = new Map<string, string>()
  distintas.forEach((ruta, i) => {
    const url = resueltas[i]
    if (url) salida.set(ruta, url)
  })
  return salida
}

/**
 * Vacía la caché. Va al cerrar sesión: las firmas quedaron emitidas contra el
 * usuario que se fue.
 */
export function olvidarFotos(): void {
  cache.clear()
}
