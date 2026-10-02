import { createClient } from 'jsr:@supabase/supabase-js@2'

import {
  autenticar,
  claveSecreta,
  cors,
  manejarError,
  responder,
  RespuestaError,
  URL_SUPABASE,
} from '../_compartido/comun.ts'

/**
 * Cambiar el email de un usuario.
 *
 * El email es la identidad de Auth —con él entra a la app y con él pide
 * restablecer la contraseña—, así que vive en `auth.users`, no sólo en
 * `perfiles`. Cambiarlo es una operación de administrador de Auth
 * (`updateUserById`), que exige la clave de servicio; por eso es una edge
 * function y no un UPDATE del panel. Se confirma en el acto (`email_confirm`)
 * para que el usuario no tenga que tocar ningún correo.
 *
 * Después se copia el email al perfil, que es lo que muestra el panel y lo que
 * sale impreso donde haga falta.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const admin = createClient(URL_SUPABASE, claveSecreta(), {
      auth: { persistSession: false },
    })

    const llamador = await autenticar(req, admin as never)
    if (llamador.rol !== 'admin') {
      throw new RespuestaError('Sólo un administrador puede cambiar el email de un usuario', 403)
    }

    const cuerpo = await req.json()
    const perfilId = String(cuerpo.perfil_id ?? '').trim()
    const nuevoEmail = String(cuerpo.nuevo_email ?? '').trim().toLowerCase()
    if (!perfilId) throw new RespuestaError('Falta el usuario', 400)
    if (!EMAIL_RE.test(nuevoEmail)) {
      throw new RespuestaError('El email no tiene un formato válido', 400)
    }

    const { data: perfil } = await admin
      .from('perfiles')
      .select('id, email, nombre_completo')
      .eq('id', perfilId)
      .maybeSingle()
    if (!perfil) throw new RespuestaError('No encontramos ese usuario', 404)

    // Ya lo tiene: no hay nada que tocar (y así no gastamos una llamada a Auth).
    if ((perfil.email ?? '').toLowerCase() === nuevoEmail) {
      return responder({ id: perfilId, email: nuevoEmail, sin_cambios: true })
    }

    // 1) El email en Auth (la identidad). `email_confirm` lo deja confirmado,
    //    así no se manda ningún correo de verificación.
    const { error: errAuth } = await admin.auth.admin.updateUserById(perfilId, {
      email: nuevoEmail,
      email_confirm: true,
    })
    if (errAuth) {
      const msg = (errAuth.message ?? '').toLowerCase()
      const estado = (errAuth as { status?: number }).status
      if (estado === 422 || msg.includes('already') || msg.includes('registered') || msg.includes('exist')) {
        throw new RespuestaError('Ese email ya lo tiene otra cuenta. Usá otro.', 409)
      }
      throw new RespuestaError(errAuth.message ?? 'No pudimos cambiar el email en Auth', 400)
    }

    // 2) El email en el perfil, para que coincida con lo que muestra el panel.
    const { error: errPerfil } = await admin
      .from('perfiles')
      .update({ email: nuevoEmail })
      .eq('id', perfilId)
    if (errPerfil) {
      throw new RespuestaError(
        `Cambiamos el email en Auth pero no en el perfil: ${errPerfil.message}`,
        500,
      )
    }

    return responder({ id: perfilId, email: nuevoEmail })
  } catch (e) {
    return manejarError(e)
  }
})
