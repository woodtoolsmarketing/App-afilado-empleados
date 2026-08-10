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
 * Alta de un empleado desde el panel de administración.
 *
 * Crear una cuenta es una operación de administrador de Auth, y para eso hace
 * falta la clave de servicio, que saltea RLS por completo. Esa clave no puede
 * vivir en una app de escritorio que se instala en las máquinas de la oficina.
 * Acá se queda del lado del servidor y lo único que viaja es el pedido.
 *
 * La contraseña la genera esta función, al azar, y se devuelve UNA vez para que
 * el administrador se la pase al empleado. No se guarda en ningún lado. Y como
 * la vio alguien que no es su dueño, la cuenta queda marcada con
 * `debe_cambiar_contrasena`: la app no deja pasar hasta que el empleado ponga
 * una suya.
 */

/** Sin caracteres que se confunden al dictarla: nada de O/0, l/I/1. */
const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
const LARGO_CONTRASENA = 12

function contrasenaProvisoria(): string {
  const azar = new Uint32Array(LARGO_CONTRASENA)
  crypto.getRandomValues(azar)
  return Array.from(azar, (n) => ALFABETO[n % ALFABETO.length]).join('')
}

const COMBINANTES = new RegExp('[\\u0300-\\u036f]', 'g')

/** "Ana Sosa" -> "asosa". Es lo que la oficina va a tipear para entrar. */
function usuarioSugerido(nombre: string): string {
  const partes = nombre
    .normalize('NFD')
    .replace(COMBINANTES, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)

  if (partes.length === 0) return ''
  if (partes.length === 1) return partes[0]
  return `${partes[0][0]}${partes[partes.length - 1]}`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const admin = createClient(URL_SUPABASE, claveSecreta(), {
      auth: { persistSession: false },
    })

    const llamador = await autenticar(req, admin as never)
    if (llamador.rol !== 'admin') {
      throw new RespuestaError('Sólo un administrador puede dar de alta usuarios', 403)
    }

    const cuerpo = await req.json()

    const nombre = String(cuerpo.nombre_completo ?? '').trim()
    if (!nombre) throw new RespuestaError('Falta el nombre y apellido', 400)

    const usuario = (String(cuerpo.usuario ?? '').trim() || usuarioSugerido(nombre)).toLowerCase()
    if (!/^[a-z0-9._-]{3,}$/.test(usuario)) {
      throw new RespuestaError(
        'El nombre de usuario tiene que ser de al menos 3 letras, sin espacios ni acentos',
        400,
      )
    }

    const dominio = String(cuerpo.dominio ?? 'woodtools.com.ar').trim()
    const email = (String(cuerpo.email ?? '').trim() || `${usuario}@${dominio}`).toLowerCase()

    const rol = ['vendedor', 'supervisor', 'admin'].includes(cuerpo.rol) ? cuerpo.rol : 'vendedor'
    const codigo = String(cuerpo.codigo_vendedor ?? '').trim() || null
    const zonas: string[] = Array.isArray(cuerpo.zonas)
      ? cuerpo.zonas.map((z: unknown) => String(z).trim()).filter(Boolean)
      : []

    // Que el usuario esté libre se chequea antes de crear nada en Auth: si el
    // índice único saltara después, quedaría una cuenta de Auth sin perfil
    // utilizable y nadie sabría que está ahí.
    const { data: repetido } = await admin
      .from('perfiles')
      .select('id')
      .ilike('usuario', usuario)
      .maybeSingle()

    if (repetido) throw new RespuestaError(`Ya hay alguien con el usuario "${usuario}"`, 409)

    const contrasena = contrasenaProvisoria()

    const { data: creado, error: errAlta } = await admin.auth.admin.createUser({
      email,
      password: contrasena,
      // Sin confirmar el correo, Auth no lo deja entrar hasta que abra un mail
      // que puede no existir: varias de estas cuentas son internas.
      email_confirm: true,
      user_metadata: { nombre_completo: nombre, usuario, codigo_vendedor: codigo },
    })

    if (errAlta || !creado?.user) {
      const yaExiste = String(errAlta?.message ?? '').toLowerCase().includes('already')
      throw new RespuestaError(
        yaExiste ? `Ya hay una cuenta con el correo ${email}` : (errAlta?.message ?? 'No pudimos crear la cuenta'),
        yaExiste ? 409 : 400,
      )
    }

    // El disparador `manejar_nuevo_usuario` ya creó el perfil en estado
    // pendiente. Acá se completa y se aprueba: quien está dando el alta es un
    // administrador.
    const { error: errPerfil } = await admin
      .from('perfiles')
      .update({
        nombre_completo: nombre,
        usuario,
        rol,
        codigo_vendedor: codigo,
        zonas,
        estado: 'aprobado',
        aprobado_por: llamador.id,
        aprobado_en: new Date().toISOString(),
        debe_cambiar_contrasena: true,
        telefono: String(cuerpo.telefono ?? '').trim() || null,
        foto_url: String(cuerpo.foto_url ?? '').trim() || null,
      })
      .eq('id', creado.user.id)

    if (errPerfil) {
      // Una cuenta de Auth sin perfil completo no sirve para nada y encima
      // ocupa el correo: si el perfil falla, se deshace el alta entera.
      await admin.auth.admin.deleteUser(creado.user.id)
      throw new RespuestaError(`No pudimos completar el perfil: ${errPerfil.message}`, 400)
    }

    return responder({
      id: creado.user.id,
      usuario,
      email,
      // Se devuelve una sola vez. No queda guardada en ningún lado.
      contrasena_provisoria: contrasena,
    })
  } catch (e) {
    return manejarError(e)
  }
})
