import { compararVersiones, ETIQUETA_ROL, olvidarFotos, type Perfil } from '@woodtools/compartido'
import * as Application from 'expo-application'
import Constants from 'expo-constants'
import * as SecureStore from 'expo-secure-store'
import { create } from 'zustand'

import { registrarYVerificarDispositivo } from './dispositivo'
import {
  olvidarLoRecordado,
  pareceFaltaDeSenal,
  perfilRecordado,
  recordarPerfil,
} from './loUltimoQueSupimos'
import { supabase } from './supabase'

/**
 * Sesión del vendedor.
 *
 * Tres candados, en este orden:
 *   1. Credenciales correctas (Supabase Auth).
 *   2. El alta del usuario tiene que estar APROBADA por un administrador.
 *   3. El teléfono tiene que estar habilitado.
 *
 * ── La sesión ya no vence a los 30 días ────────────────────────────────────
 *
 * Antes había una casilla "Recordar mi cuenta por 30 días", y sin tildarla la
 * sesión no sobrevivía al cierre de la app. Cada 30 días —o cada arranque— el
 * vendedor tenía que escribir usuario y contraseña en la calle, con una mano,
 * en un teléfono con el teclado a mitad de pantalla.
 *
 * Ahora la sesión persiste y lo que la protege es el desbloqueo del teléfono:
 * huella, cara o PIN, lo que ese equipo tenga configurado. Es más seguro que la
 * contraseña, no menos: una contraseña que hay que tipear seguido termina
 * escrita en un papel adentro de la funda.
 */

const CLAVE_ULTIMO_USUARIO = 'woodtools.ultimo_usuario'

/** Dominio que se le agrega al usuario cuando escriben sólo el nombre. */
const DOMINIO_USUARIO: string =
  Constants.expoConfig?.extra?.dominioUsuario ?? 'woodtools.com.ar'

/**
 * La versión de esta app, para comparar contra la mínima que exige la oficina.
 *
 * Sale de la app instalada y no de `expoConfig`, que es lo que parecería más
 * directo: después de una actualización por aire, `expoConfig` ya trae la
 * versión del paquete nuevo mientras la app instalada sigue siendo la vieja.
 * La que el panel ve es ésta —la misma que se registra en `dispositivos`— y las
 * dos puntas tienen que estar mirando el mismo número.
 */
export const VERSION_APP: string = Application.nativeApplicationVersion ?? '0.0.0'

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
  | 'version_vieja'          // hay que actualizar antes de seguir
  | 'debe_cambiar_contrasena'
  | 'habilitado'

interface EstadoSesion {
  estado: EstadoAcceso
  perfil: Perfil | null
  usuarioRecordado: string | null
  errorAcceso: string | null
  procesando: boolean

  arrancar: () => Promise<void>
  iniciarSesion: (usuario: string, contrasena: string) => Promise<void>
  cerrarSesion: () => Promise<void>
  refrescarPerfil: () => Promise<void>
  recuperarContrasena: (usuario: string) => Promise<void>
  cambiarContrasena: (nueva: string) => Promise<void>
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

  // Antes que nada de lo que viene: una versión demasiado vieja puede estar
  // guardando notas de una forma que la base ya no entiende. Es preferible un
  // cartel que pide actualizar a datos mal grabados que después hay que buscar.
  if (await versionDemasiadoVieja()) {
    return { estado: 'version_vieja', error: null }
  }

  // La contraseña provisoria la vio un administrador. Mientras siga siendo la
  // misma, lo que la app registre no identifica a nadie en particular.
  if (perfil.debe_cambiar_contrasena) {
    return { estado: 'debe_cambiar_contrasena', error: null }
  }

  return { estado: 'habilitado', error: null }
}

/**
 * ¿Esta app quedó por debajo de la versión que la oficina exige?
 *
 * Ante la duda, no. Si la consulta falla —sin señal, por ejemplo— dejar al
 * vendedor afuera sería peor que dejarlo entrar: el mínimo existe para
 * ordenar una migración, no para trancar a alguien parado en un cliente.
 */
async function versionDemasiadoVieja(): Promise<boolean> {
  try {
    const { data } = await supabase
      .from('configuracion')
      .select('valor')
      .eq('clave', 'version_minima_app')
      .maybeSingle()

    const minima = (data?.valor as { android?: string } | null)?.android
    if (!minima) return false

    return compararVersiones(VERSION_APP, minima) < 0
  } catch {
    return false
  }
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

    // La sesión no vence: lo que protege la app es el desbloqueo del teléfono.
    await get().refrescarPerfil()
  },

  async iniciarSesion(usuario, contrasena) {
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

      /**
       * Si entró OTRA persona, se tira lo que quedó guardado del anterior.
       *
       * Esta limpieza vivía en la rama "no me recuerdes" de la casilla que se
       * acaba de sacar, y sacarla sin reubicarla dejaba un agujero silencioso:
       * dos vendedores que comparten un teléfono, sin señal, entrando cada uno
       * con el perfil cacheado del otro.
       *
       * Colgada del cambio de usuario funciona mejor que antes, además: el que
       * entra siempre es el que era, tildara lo que tildara.
       */
      const anterior = await SecureStore.getItemAsync(CLAVE_ULTIMO_USUARIO)
      if (anterior && anterior !== usuario.trim()) {
        await olvidarLoRecordado()
        await olvidarFotos()
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
      /**
       * Sin señal se entra con el último perfil conocido.
       *
       * Antes acá se mandaba derecho a la pantalla de ingreso, y el vendedor
       * quedaba afuera de la app en el peor momento: en un galpón, en la ruta,
       * con dos notas cargadas. Y no sólo no podía cargar — no podía ni mirar
       * lo que ya tenía.
       *
       * Sólo se perdona cuando el error es de red. Si el servidor contestó
       * —una cuenta dada de baja, un permiso denegado— eso es una respuesta y
       * se respeta. Ver `pareceFaltaDeSenal`.
       */
      const recordado = pareceFaltaDeSenal(error) ? await perfilRecordado<Perfil>() : null

      if (recordado) {
        const resultado = await evaluarAcceso(recordado)
        set({ perfil: recordado, estado: resultado.estado, errorAcceso: resultado.error })
        return
      }

      set({ estado: 'sin_sesion', errorAcceso: 'No pudimos verificar tu cuenta.' })
      return
    }

    // Lo que el servidor acaba de decir es lo que se va a recordar la próxima
    // vez que no se lo pueda alcanzar.
    if (perfil) await recordarPerfil(perfil)

    const resultado = await evaluarAcceso(perfil)
    set({ perfil, estado: resultado.estado, errorAcceso: resultado.error })
  },

  async cerrarSesion() {
    await supabase.auth.signOut().catch(() => undefined)
    // Cerrar sesión a mano SÍ tira lo cacheado: es el gesto de "este teléfono
    // deja de ser mío". Lo que ya no pasa es que se caiga sola a los 30 días.
    await olvidarLoRecordado()
    // Las URL firmadas de las fotos se emitieron contra la sesión que se va.
    olvidarFotos()
    set({ estado: 'sin_sesion', perfil: null, errorAcceso: null })
  },

  /**
   * La cambia el dueño de la cuenta, desde su teléfono y con su sesión abierta.
   *
   * La marca `debe_cambiar_contrasena` se baja recién después de que Auth
   * aceptó la nueva. Al revés —bajarla primero y después cambiarla— alcanzaría
   * con que fallara el segundo paso para que la cuenta quedara habilitada con
   * la contraseña que un administrador todavía conoce.
   */
  async cambiarContrasena(nueva) {
    const { error } = await supabase.auth.updateUser({ password: nueva })
    if (error) throw error

    const { perfil } = get()
    if (perfil) {
      await supabase
        .from('perfiles')
        .update({ debe_cambiar_contrasena: false })
        .eq('id', perfil.id)
    }

    await get().refrescarPerfil()
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
