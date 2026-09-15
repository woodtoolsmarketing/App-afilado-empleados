import { createClient } from 'jsr:@supabase/supabase-js@2'

import { claveSecreta, cors, manejarError, responder, RespuestaError, URL_SUPABASE } from '../_compartido/comun.ts'

/**
 * El vendedor pone su contraseña nueva, después de que la oficina lo habilitó.
 *
 * ─── Por qué esta función tampoco verifica el JWT ────────────────────────────
 *
 * Sigue sin poder entrar: justamente viene a estrenar la clave con la que va a
 * entrar. No hay sesión. Cambiar la contraseña de otro sin sesión es una
 * operación de administrador de Auth (`updateUserById`), y eso exige la clave
 * de servicio, que vive sólo del lado del servidor.
 *
 * ─── Qué la hace segura sin JWT ──────────────────────────────────────────────
 *
 * Tres candados a la vez, y los tres tienen que dar:
 *
 *   1. El pedido tiene que estar en estado `habilitado`. Eso lo puso una
 *      persona, a mano, desde el panel. Es el candado principal.
 *   2. El token tiene que coincidir con el hash guardado. El token se lo llevó
 *      el aparato que pidió; que un tercero vea el pedido habilitado no le
 *      alcanza.
 *   3. La habilitación no tiene que estar vencida, y —si el pedido vino de un
 *      teléfono— el `instalacion_id` tiene que ser el mismo que pidió.
 *
 * Recién con los tres se cambia la clave. En ningún momento se guarda la
 * contraseña: viaja del teléfono a Auth y no queda en la fila.
 */

/** Lo mismo que exige el login y la pantalla de cambio del celular. */
const LARGO_MINIMO = 6

async function sha256Hex(texto: string): Promise<string> {
  const datos = new TextEncoder().encode(texto)
  const hash = await crypto.subtle.digest('SHA-256', datos)
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const admin = createClient(URL_SUPABASE, claveSecreta(), {
      auth: { persistSession: false },
    })

    const cuerpo = await req.json()
    const id = String(cuerpo.id ?? '').trim()
    const token = String(cuerpo.token ?? '').trim()
    const nueva = String(cuerpo.nueva ?? '')
    const dispositivoId = String(cuerpo.dispositivo_id ?? '').trim() || null

    if (!id || !token) throw new RespuestaError('Pedido inválido', 400)
    if (nueva.length < LARGO_MINIMO) {
      throw new RespuestaError(`La contraseña tiene que tener al menos ${LARGO_MINIMO} caracteres`, 400)
    }

    const { data: pedido } = await admin
      .from('pedidos_contrasena')
      .select('*')
      .eq('id', id)
      .maybeSingle()

    if (!pedido) throw new RespuestaError('No encontramos el pedido. Pedila de nuevo.', 404)

    if (pedido.estado === 'usada') {
      throw new RespuestaError('Ese pedido ya se usó. Si necesitás cambiarla otra vez, pedila de nuevo.', 409)
    }

    // Candado 1: lo habilitó una persona.
    if (pedido.estado !== 'habilitado') {
      throw new RespuestaError(
        'La oficina todavía no habilitó tu pedido. Esperá que te avisen y volvé a intentar.',
        403,
      )
    }

    // Candado 2: el token que se llevó el aparato que pidió.
    if ((await sha256Hex(token)) !== pedido.token_hash) {
      throw new RespuestaError('Este pedido no es de este aparato. Pedila de nuevo desde tu teléfono.', 403)
    }

    // Candado 3a: la habilitación no venció.
    if (pedido.vence_en && new Date(pedido.vence_en).getTime() < Date.now()) {
      await admin.from('pedidos_contrasena').update({ estado: 'cancelada' }).eq('id', id)
      throw new RespuestaError('El permiso se venció. Pedila de nuevo y avisá a la oficina.', 403)
    }

    // Candado 3b: si vino de un teléfono, tiene que ser el mismo teléfono.
    if (pedido.origen === 'celular' && pedido.dispositivo_id && pedido.dispositivo_id !== dispositivoId) {
      throw new RespuestaError('Este pedido no es de este teléfono. Pedila de nuevo desde el tuyo.', 403)
    }

    const { error: errClave } = await admin.auth.admin.updateUserById(pedido.perfil_id, {
      password: nueva,
    })
    if (errClave) throw new RespuestaError(errClave.message ?? 'No pudimos cambiar la contraseña', 400)

    // La eligió el dueño, así que ya no hay nada que cambiar obligatoriamente al
    // entrar: se baja la marca de contraseña provisoria por si la tenía puesta.
    await admin
      .from('perfiles')
      .update({ debe_cambiar_contrasena: false })
      .eq('id', pedido.perfil_id)

    // Queda "usada" para que la oficina vea en el panel que el círculo se cerró.
    await admin
      .from('pedidos_contrasena')
      .update({ estado: 'usada', usada_en: new Date().toISOString() })
      .eq('id', id)

    return responder({ ok: true, usuario: pedido.usuario })
  } catch (e) {
    return manejarError(e)
  }
})
