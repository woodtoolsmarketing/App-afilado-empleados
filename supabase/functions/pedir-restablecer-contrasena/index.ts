import { createClient } from 'jsr:@supabase/supabase-js@2'

import { claveSecreta, cors, manejarError, responder, RespuestaError, URL_SUPABASE } from '../_compartido/comun.ts'

/**
 * Un vendedor pide que le restablezcan la contraseña.
 *
 * ─── Por qué esta función no verifica el JWT ─────────────────────────────────
 *
 * Quien pide es alguien que NO puede entrar: se olvidó la clave. No tiene
 * sesión, así que no hay JWT que verificar. Se despliega con `verify_jwt = false`
 * (ver supabase/config.toml), igual que `planilla`, y el amarre de seguridad es
 * otro: el pedido no hace nada solo. Queda "pendiente" hasta que un
 * administrador lo habilite a mano desde el panel, y completarlo exige un token
 * que sólo se devuelve acá, una vez, al aparato que pidió.
 *
 * ─── Qué hace y qué NO ───────────────────────────────────────────────────────
 *
 * Crea (o reemplaza) un pedido pendiente para ese usuario y devuelve un `id` y
 * un `token` de un solo uso. NO toca la contraseña, NO habilita nada: eso lo
 * decide una persona. Guardar sólo el hash del token es lo que hace que, aunque
 * alguien vea después que el pedido quedó habilitado, no pueda completarlo sin
 * el token que se llevó el teléfono.
 */

/** El mismo dominio por defecto que usa el resto del sistema. */
const DOMINIO = 'woodtools.com.ar'

async function sha256Hex(texto: string): Promise<string> {
  const datos = new TextEncoder().encode(texto)
  const hash = await crypto.subtle.digest('SHA-256', datos)
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('')
}

function tokenNuevo(): string {
  const azar = new Uint8Array(32)
  crypto.getRandomValues(azar)
  return Array.from(azar, (b) => b.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const admin = createClient(URL_SUPABASE, claveSecreta(), {
      auth: { persistSession: false },
    })

    const cuerpo = await req.json()
    const identificador = String(cuerpo.identificador ?? '').trim().toLowerCase()
    if (!identificador) throw new RespuestaError('Falta el usuario', 400)

    const origen = cuerpo.origen === 'panel' ? 'panel' : 'celular'
    const dispositivoId = String(cuerpo.dispositivo_id ?? '').trim() || null
    const dispositivoDesc = String(cuerpo.dispositivo_desc ?? '').trim() || null

    // Se busca por usuario o por correo, lo mismo que acepta el login. El correo
    // se arma con la regla del dominio cuando escribieron sólo el nombre.
    const email = identificador.includes('@') ? identificador : `${identificador}@${DOMINIO}`

    const { data: perfil } = await admin
      .from('perfiles')
      .select('id, usuario, estado')
      .or(`usuario.ilike.${identificador},email.ilike.${email}`)
      .maybeSingle()

    // Decir "no existe" es más útil que un OK genérico: esto es interno, no hay
    // padrón de usuarios que proteger, y el vendedor lo que necesita es saber
    // que escribió mal el nombre antes de esperar una habilitación que no va a
    // llegar nunca.
    if (!perfil) {
      throw new RespuestaError(
        'No encontramos ese usuario. Fijate que esté bien escrito o avisá a la oficina.',
        404,
      )
    }

    // Una cuenta dada de baja no se "recupera" por acá.
    if (perfil.estado === 'suspendido' || perfil.estado === 'baja' || perfil.estado === 'rechazado') {
      throw new RespuestaError('Esa cuenta no está activa. Hablá con la oficina.', 403)
    }

    // Un solo pedido activo por persona: los anteriores se cancelan para no
    // apilar filas en el panel y para que el token viejo deje de servir.
    await admin
      .from('pedidos_contrasena')
      .update({ estado: 'cancelada' })
      .eq('perfil_id', perfil.id)
      .in('estado', ['pendiente', 'habilitado'])

    const token = tokenNuevo()

    const { data: creado, error: errAlta } = await admin
      .from('pedidos_contrasena')
      .insert({
        perfil_id: perfil.id,
        usuario: perfil.usuario ?? identificador,
        estado: 'pendiente',
        origen,
        dispositivo_id: dispositivoId,
        dispositivo_desc: dispositivoDesc,
        token_hash: await sha256Hex(token),
      })
      .select('id')
      .single()

    if (errAlta || !creado) {
      throw new RespuestaError(errAlta?.message ?? 'No pudimos registrar el pedido', 400)
    }

    // El token viaja UNA vez. El teléfono lo guarda para completar el cambio
    // cuando la oficina habilite; de acá no se puede volver a sacar.
    return responder({ id: creado.id, token, usuario: perfil.usuario })
  } catch (e) {
    return manejarError(e)
  }
})
