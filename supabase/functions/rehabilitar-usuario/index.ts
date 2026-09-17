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
 * Sacar a una cuenta de la suspensión, REINICIÁNDOLE la contraseña.
 *
 * ─── Por qué es una función de servidor y no un UPDATE del panel ─────────────
 *
 * "Reactivar" a secas (una baja o un rechazo) es sólo poner el estado en
 * 'aprobado': eso lo hace el panel con un UPDATE, porque la RLS deja que un
 * admin escriba `perfiles.estado`. Pero acá, además, hay que *reiniciar la
 * contraseña*: la vieja tiene que dejar de servir y hay que dictarle una nueva,
 * igual que en el alta. Cambiar la clave de OTRO usuario es una operación de
 * administrador de Auth (`updateUserById`), y eso exige la clave de servicio,
 * que vive sólo del lado del servidor. Por eso esto es una edge function y no
 * un botón que escribe directo en la base.
 *
 * ─── Qué hace ────────────────────────────────────────────────────────────────
 *
 *   1. Rota la contraseña a una provisoria nueva (la anterior queda inválida).
 *   2. Deja la cuenta 'aprobado' y marca `debe_cambiar_contrasena`, así la app
 *      obliga al vendedor a poner una suya al entrar. Es el mismo camino que
 *      recorre una cuenta recién dada de alta.
 *   3. Cancela cualquier pedido de "olvidé mi contraseña" viejo: la clave ya se
 *      rotó, un token pendiente no puede seguir sirviendo.
 *
 * La provisoria se devuelve UNA vez para que el administrador se la pase al
 * empleado. No se guarda en ningún lado.
 *
 * ─── Sólo desde 'suspendido' ─────────────────────────────────────────────────
 *
 * A propósito: reiniciar la contraseña se dispara únicamente al sacar a alguien
 * de la suspensión. Reactivar una baja o un rechazo sigue por el UPDATE simple
 * del panel, sin tocar la clave.
 */

/** Sin caracteres que se confunden al dictarla: nada de O/0, l/I/1. */
const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
const LARGO_CONTRASENA = 12

function contrasenaProvisoria(): string {
  const azar = new Uint32Array(LARGO_CONTRASENA)
  crypto.getRandomValues(azar)
  return Array.from(azar, (n) => ALFABETO[n % ALFABETO.length]).join('')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const admin = createClient(URL_SUPABASE, claveSecreta(), {
      auth: { persistSession: false },
    })

    const llamador = await autenticar(req, admin as never)
    if (llamador.rol !== 'admin') {
      throw new RespuestaError('Sólo un administrador puede rehabilitar cuentas', 403)
    }

    const cuerpo = await req.json()
    const perfilId = String(cuerpo.perfil_id ?? '').trim()
    if (!perfilId) throw new RespuestaError('Falta el usuario a rehabilitar', 400)

    const { data: perfil } = await admin
      .from('perfiles')
      .select('id, usuario, nombre_completo, estado')
      .eq('id', perfilId)
      .maybeSingle()

    if (!perfil) throw new RespuestaError('No encontramos ese usuario', 404)

    // Sólo desde suspendido. Reactivar una baja o un rechazo no reinicia la
    // clave: esos siguen por el UPDATE simple del panel.
    if (perfil.estado !== 'suspendido') {
      throw new RespuestaError(
        `Esta acción es sólo para cuentas suspendidas (esta está "${perfil.estado}").`,
        409,
      )
    }

    // 1) Rotar la contraseña: la vieja deja de servir.
    const contrasena = contrasenaProvisoria()
    const { error: errClave } = await admin.auth.admin.updateUserById(perfilId, {
      password: contrasena,
    })
    if (errClave) {
      throw new RespuestaError(errClave.message ?? 'No pudimos reiniciar la contraseña', 400)
    }

    // 2) Rehabilitar y obligar a cambiarla al entrar (misma marca que el alta).
    //    aprobado_en va seteado por el CHECK perfiles_aprobacion_completa.
    const { error: errPerfil } = await admin
      .from('perfiles')
      .update({
        estado: 'aprobado',
        debe_cambiar_contrasena: true,
        aprobado_por: llamador.id,
        aprobado_en: new Date().toISOString(),
      })
      .eq('id', perfilId)

    if (errPerfil) {
      throw new RespuestaError(`No pudimos rehabilitar el perfil: ${errPerfil.message}`, 400)
    }

    // 3) Cancelar pedidos de contraseña viejos: la clave ya se rotó.
    await admin
      .from('pedidos_contrasena')
      .update({ estado: 'cancelada' })
      .eq('perfil_id', perfilId)
      .in('estado', ['pendiente', 'habilitado'])

    return responder({
      id: perfilId,
      usuario: perfil.usuario,
      // Se devuelve una sola vez. No queda guardada en ningún lado.
      contrasena_provisoria: contrasena,
    })
  } catch (e) {
    return manejarError(e)
  }
})
