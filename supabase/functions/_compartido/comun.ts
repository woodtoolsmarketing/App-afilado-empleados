/**
 * Utilidades comunes a todas las Edge Functions.
 *
 * Ninguna función de este proyecto se despliega con `--no-verify-jwt`: todas
 * manejan datos de clientes y ubicaciones de empleados, así que siempre se
 * valida quién llama.
 */

export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-aplicacion',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export function responder(cuerpo: unknown, estado = 200): Response {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

export function error(mensaje: string, estado = 400, detalle?: unknown): Response {
  return responder({ error: mensaje, detalle }, estado)
}

/**
 * Clave secreta del proyecto (rol de servicio).
 *
 * `SUPABASE_SECRET_KEYS` es la variable vigente; `SUPABASE_SERVICE_ROLE_KEY`
 * quedó marcada como legacy pero se sigue aceptando como respaldo.
 */
export function claveSecreta(): string {
  const nueva = Deno.env.get('SUPABASE_SECRET_KEYS')
  if (nueva) {
    // Puede venir como JSON con varias claves rotadas; nos sirve cualquiera vigente.
    try {
      const parseada = JSON.parse(nueva)
      if (Array.isArray(parseada)) return parseada[0]
      if (typeof parseada === 'object' && parseada !== null) {
        return Object.values(parseada)[0] as string
      }
    } catch {
      return nueva
    }
  }
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!legacy) throw new Error('Falta SUPABASE_SECRET_KEYS en el entorno de la función')
  return legacy
}

export const URL_SUPABASE = Deno.env.get('SUPABASE_URL')!

export interface Llamador {
  id: string
  /**
   * Los cuatro roles que existen, los mismos de `RolUsuario` en el paquete
   * compartido. `administracion` faltaba: el valor sale de la base y podía
   * llegar igual, así que el tipo decía una cosa y la fila decía otra.
   */
  rol: 'vendedor' | 'supervisor' | 'administracion' | 'admin'
  estado: string
  token: string
}

/**
 * Verifica el JWT del que llama y devuelve su perfil. Rechaza a quien no esté
 * aprobado: una cuenta pendiente no puede usar ninguna de estas funciones.
 */
export async function autenticar(
  req: Request,
  clienteAdmin: { from: (t: string) => any; auth: { getUser: (t: string) => Promise<any> } },
): Promise<Llamador> {
  const cabecera = req.headers.get('Authorization') ?? ''
  const token = cabecera.replace(/^Bearer\s+/i, '')
  if (!token) throw new RespuestaError('Falta el token de sesión', 401)

  const { data, error: errAuth } = await clienteAdmin.auth.getUser(token)
  if (errAuth || !data?.user) throw new RespuestaError('Sesión inválida', 401)

  const { data: perfil } = await clienteAdmin
    .from('perfiles')
    .select('id, rol, estado')
    .eq('id', data.user.id)
    .maybeSingle()

  if (!perfil) throw new RespuestaError('El usuario no tiene perfil', 403)
  if (perfil.estado !== 'aprobado') {
    throw new RespuestaError('Tu cuenta todavía no fue aprobada por un administrador', 403)
  }

  return { id: perfil.id, rol: perfil.rol, estado: perfil.estado, token }
}

export class RespuestaError extends Error {
  constructor(
    mensaje: string,
    public estado = 400,
  ) {
    super(mensaje)
  }
}

export function manejarError(e: unknown): Response {
  if (e instanceof RespuestaError) return error(e.message, e.estado)
  console.error('[woodtools] error no controlado', e)
  return error('Error interno', 500, String(e))
}
