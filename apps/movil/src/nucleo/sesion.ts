import { ETIQUETA_ROL, type Perfil } from '@woodtools/compartido'
import Constants from 'expo-constants'
import * as SecureStore from 'expo-secure-store'
import { create } from 'zustand'

import { registrarYVerificarDispositivo } from './dispositivo'
import { supabase } from './supabase'

/**
 * Sesión del vendedor.
 *
 * Tres candados, en este orden:
 *   1. Credenciales correctas (Supabase Auth).
 *   2. El alta del usuario tiene que estar APROBADA por un administrador.
 *   3. El teléfono tiene que estar habilitado.
 *
 * Y encima la regla de "Recordar mi cuenta por 30 días": si la tildan, no se
 * vuelve a pedir el login durante 30 días; si no, se pide en cada arranque.
 */

const CLAVE_RECORDAR_HASTA = 'woodtools.recordar_hasta'
const CLAVE_ULTIMO_USUARIO = 'woodtools.ultimo_usuario'

const DIAS_RECORDAR = 30

/** Dominio que se le agrega al usuario cuando escriben sólo el nombre. */
const DOMINIO_USUARIO: string =
  Constants.expoConfig?.extra?.dominioUsuario ?? 'woodtools.com.ar'

/** "asosa" → "asosa@woodtools.com.ar"; un correo completo se deja como está. */
export function normalizarUsuario(usuario: string): string {
  const limpio = usuario.trim().toLowerCase()
  return limpio.includes('@') ? limpio : `${limpio}@${DOMINIO_USUARIO}`
}

/**
 * Con qué correo hay que autenticar lo que escribieron en "Usuario o email".
 *
 * Supabase Auth entra por correo y nada más, así que un nombre de usuario hay
 * que traducirlo antes. La traducción la hace la base (`email_para_ingreso`),
 * que es la única que sabe qué correo tiene cada cuenta.
 *
 * Si la consulta no encuentra nada —o si no hay señal— se cae a la regla vieja
 * de pegarle el dominio. Esa regla resuelve bien el caso normal, y dejar que
 * el login dependa de una consulta previa sería cambiar un problema por otro:
 * sin red, la app tiene que poder intentar entrar igual.
 */
export async function resolverEmailDeIngreso(identificador: string): Promise<string> {
  const limpio = identificador.trim().toLowerCase()
  if (!limpio) return limpio

  try {
    const { data } = await supabase.rpc('email_para_ingreso', { identificador: limpio })
    if (typeof data === 'string' && data.includes('@')) return data.toLowerCase()
  } catch {
    // Sin red o con la función todavía sin desplegar: sigue la regla del dominio.
  }

  return normalizarUsuario(limpio)
}

export type EstadoAcceso =
  | 'cargando'        // arrancando la app, todavía no sabemos
  | 'sin_sesion'      // hay que iniciar sesión
  | 'pendiente'       // el alta espera aprobación del administrador
  | 'rechazado'
  | 'suspendido'
  | 'dispositivo_no_autorizado'
  | 'habilitado'

interface EstadoSesion {
  estado: EstadoAcceso
  perfil: Perfil | null
  usuarioRecordado: string | null
  errorAcceso: string | null
  procesando: boolean

  arrancar: () => Promise<void>
  iniciarSesion: (usuario: string, contrasena: string, recordar: boolean) => Promise<void>
  cerrarSesion: () => Promise<void>
  refrescarPerfil: () => Promise<void>
  recuperarContrasena: (usuario: string) => Promise<void>
}

async function leerRecordarHasta(): Promise<Date | null> {
  const guardado = await SecureStore.getItemAsync(CLAVE_RECORDAR_HASTA)
  if (!guardado) return null
  const fecha = new Date(guardado)
  return Number.isNaN(fecha.getTime()) ? null : fecha
}

/**
 * Resuelve a qué pantalla mandar al usuario según su perfil y su teléfono.
 * Concentra las tres validaciones para que no se dupliquen en cada pantalla.
 */
async function evaluarAcceso(
  perfil: Perfil | null,
): Promise<{ estado: EstadoAcceso; error: string | null }> {
  if (!perfil) {
    return { estado: 'sin_sesion', error: 'No pudimos cargar tu perfil. Probá de nuevo.' }
  }

  switch (perfil.estado) {
    case 'pendiente':
      return { estado: 'pendiente', error: null }
    case 'rechazado':
      return {
        estado: 'rechazado',
        error: perfil.motivo_rechazo ?? 'Un administrador rechazó tu solicitud de acceso.',
      }
    case 'suspendido':
    case 'baja':
      return { estado: 'suspendido', error: 'Tu cuenta está dada de baja. Hablá con la oficina.' }
    case 'aprobado':
      break
  }

  const dispositivo = await registrarYVerificarDispositivo(perfil.id)
  if (!dispositivo.autorizado) {
    return { estado: 'dispositivo_no_autorizado', error: null }
  }

  return { estado: 'habilitado', error: null }
}

export const usarSesion = create<EstadoSesion>((set, get) => ({
  estado: 'cargando',
  perfil: null,
  usuarioRecordado: null,
  errorAcceso: null,
  procesando: false,

  async arrancar() {
    const usuarioRecordado = await SecureStore.getItemAsync(CLAVE_ULTIMO_USUARIO)
    set({ usuarioRecordado })

    const { data } = await supabase.auth.getSession()

    if (!data.session) {
      set({ estado: 'sin_sesion', perfil: null })
      return
    }

    // ── Regla de los 30 días ────────────────────────────────────────────────
    const recordarHasta = await leerRecordarHasta()

    if (!recordarHasta) {
      // No tildaron "recordarme": la sesión no sobrevive al cierre de la app.
      await get().cerrarSesion()
      return
    }

    if (recordarHasta.getTime() < Date.now()) {
      // Se cumplieron los 30 días: vuelve a pedir usuario y contraseña.
      await get().cerrarSesion()
      set({
        errorAcceso: 'Pasaron 30 días desde tu último inicio de sesión. Ingresá de nuevo.',
      })
      return
    }

    await get().refrescarPerfil()
  },

  async iniciarSesion(usuario, contrasena, recordar) {
    set({ procesando: true, errorAcceso: null })

    try {
      const email = await resolverEmailDeIngreso(usuario)

      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password: contrasena,
      })

      if (error || !data.session) {
        set({
          procesando: false,
          estado: 'sin_sesion',
          errorAcceso:
            error?.message === 'Invalid login credentials'
              ? 'Usuario o contraseña incorrectos.'
              : (error?.message ?? 'No pudimos iniciar sesión. Revisá tu conexión.'),
        })
        return
      }

      // Guardamos el vencimiento del "recordarme" recién ahora, con el login OK.
      if (recordar) {
        const hasta = new Date(Date.now() + DIAS_RECORDAR * 24 * 60 * 60 * 1000)
        await SecureStore.setItemAsync(CLAVE_RECORDAR_HASTA, hasta.toISOString())
      } else {
        await SecureStore.deleteItemAsync(CLAVE_RECORDAR_HASTA).catch(() => undefined)
      }
      await SecureStore.setItemAsync(CLAVE_ULTIMO_USUARIO, usuario.trim())

      await get().refrescarPerfil()

      const { estado, perfil } = get()
      if (estado === 'habilitado' && perfil) {
        await supabase
          .from('perfiles')
          .update({ ultimo_acceso_en: new Date().toISOString() })
          .eq('id', perfil.id)
      }
    } finally {
      set({ procesando: false })
    }
  },

  async refrescarPerfil() {
    const { data: sesion } = await supabase.auth.getSession()
    if (!sesion.session) {
      set({ estado: 'sin_sesion', perfil: null })
      return
    }

    const { data: perfil, error } = await supabase
      .from('perfiles')
      .select('*')
      .eq('id', sesion.session.user.id)
      .maybeSingle<Perfil>()

    if (error) {
      set({ estado: 'sin_sesion', errorAcceso: 'No pudimos verificar tu cuenta.' })
      return
    }

    const resultado = await evaluarAcceso(perfil)
    set({ perfil, estado: resultado.estado, errorAcceso: resultado.error })
  },

  async cerrarSesion() {
    await supabase.auth.signOut().catch(() => undefined)
    await SecureStore.deleteItemAsync(CLAVE_RECORDAR_HASTA).catch(() => undefined)
    set({ estado: 'sin_sesion', perfil: null, errorAcceso: null })
  },

  async recuperarContrasena(usuario) {
    const email = await resolverEmailDeIngreso(usuario)
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: 'woodtoolsvisitas://recuperar',
    })
    if (error) throw error
  },
}))

/** Etiqueta que se muestra bajo el nombre: "Vendedor #27". */
export function etiquetaVendedor(perfil: Perfil | null): string {
  if (!perfil) return ''
  const rol = ETIQUETA_ROL[perfil.rol]
  return perfil.codigo_vendedor ? `${rol} #${perfil.codigo_vendedor}` : rol
}
