import { LOGO_WOODTOOLS, validarLogin, type CampoLogin } from '@woodtools/compartido'
import { useEffect, useState } from 'react'

import { supabase } from '../nucleo/supabase'

/** Dominio que se le agrega al usuario cuando escriben sólo el nombre. */
const DOMINIO_USUARIO = 'woodtools.com.ar'

/** Lo mismo que exige la app del celular y la función del servidor. */
const LARGO_MINIMO = 6

/** Un pedido de restablecimiento en curso, guardado en este navegador. */
const CLAVE_PEDIDO = 'woodtools.pedido_reset'

/**
 * Con qué correo hay que autenticar lo que escribieron en "Usuario o email".
 *
 * Igual que en el celular: Auth entra por correo, así que un nombre de usuario
 * lo traduce la base. Si no encuentra nada —o si no hay red— vuelve a la regla
 * de pegarle el dominio, que resuelve bien el caso normal.
 */
async function resolverEmailDeIngreso(identificador: string): Promise<string> {
  const limpio = identificador.trim().toLowerCase()
  if (!limpio) return limpio

  try {
    const { data } = await supabase.rpc('email_para_ingreso', { identificador: limpio })
    if (typeof data === 'string' && data.includes('@')) return data.toLowerCase()
  } catch {
    // Sin red: sigue la regla del dominio.
  }

  return limpio.includes('@') ? limpio : `${limpio}@${DOMINIO_USUARIO}`
}

/**
 * Invoca una función edge dejando pasar el motivo real del error.
 *
 * `functions.invoke` esconde el mensaje detrás de un "non-2xx" genérico; el que
 * arma el servidor viaja en el cuerpo, dentro de `error.context`.
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
  throw new Error(motivo ?? error.message)
}

interface PedidoGuardado {
  id: string
  token: string
  usuario: string
}

/** Botón que se ve como un enlace (el panel no tiene una clase para esto). */
const estiloEnlace: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'var(--rojo-accion)',
  textDecoration: 'underline',
  cursor: 'pointer',
  font: 'inherit',
  padding: 4,
}

function leerPedido(): PedidoGuardado | null {
  try {
    const crudo = localStorage.getItem(CLAVE_PEDIDO)
    if (!crudo) return null
    const p = JSON.parse(crudo) as PedidoGuardado
    return p.id && p.token ? p : null
  } catch {
    return null
  }
}

/** Ingreso al panel. Mismas reglas de validación que la app del celular. */
export function PaginaIngreso({
  error,
  alIngresar,
}: {
  error: string | null
  alIngresar: () => void
}) {
  const [usuario, setUsuario] = useState('')
  const [contrasena, setContrasena] = useState('')
  const [errores, setErrores] = useState<Partial<Record<CampoLogin, string>>>({})
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  // El pedido de restablecimiento en curso (si hay uno, se muestra ese panel).
  const [pedido, setPedido] = useState<PedidoGuardado | null>(null)
  const [avisoReset, setAvisoReset] = useState<string | null>(null)
  const [pidiendo, setPidiendo] = useState(false)

  useEffect(() => {
    setPedido(leerPedido())
  }, [])

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    setErrorGeneral(null)

    const { valido, errores: nuevos } = validarLogin(usuario, contrasena)
    setErrores(nuevos)
    if (!valido) return

    setEnviando(true)
    const email = await resolverEmailDeIngreso(usuario)

    const { error: errIngreso } = await supabase.auth.signInWithPassword({
      email,
      password: contrasena,
    })

    setEnviando(false)

    if (errIngreso) {
      setErrorGeneral(
        errIngreso.message === 'Invalid login credentials'
          ? 'Usuario o contraseña incorrectos.'
          : errIngreso.message,
      )
      return
    }

    alIngresar()
  }

  /**
   * Pide restablecer la contraseña del que quedó afuera.
   *
   * OJO con el arranque: quien habilita el pedido es un administrador, así que
   * si el ÚNICO administrador es el que se olvidó la clave, no hay quién lo
   * habilite. En ese caso hace falta otro administrador, o entrar por el panel
   * de Supabase a resetearla. No es lo común: los pedidos del panel suelen ser
   * de gente de oficina que no es admin, y hay más de un admin.
   */
  async function pedirReset() {
    setAvisoReset(null)
    if (!usuario.trim()) {
      setAvisoReset('Escribí primero tu usuario arriba y después tocá "Olvidé mi contraseña".')
      return
    }

    setPidiendo(true)
    try {
      const r = await invocar<{ id: string; token: string; usuario: string | null }>(
        'pedir-restablecer-contrasena',
        { identificador: usuario, origen: 'panel' },
      )
      const nuevo: PedidoGuardado = {
        id: r.id,
        token: r.token,
        usuario: r.usuario ?? usuario.trim().toLowerCase(),
      }
      localStorage.setItem(CLAVE_PEDIDO, JSON.stringify(nuevo))
      setPedido(nuevo)
    } catch (err) {
      setAvisoReset(err instanceof Error ? err.message : 'No pudimos registrar el pedido.')
    } finally {
      setPidiendo(false)
    }
  }

  if (pedido) {
    return (
      <ElegirNueva
        pedido={pedido}
        alCancelar={() => {
          localStorage.removeItem(CLAVE_PEDIDO)
          setPedido(null)
        }}
        alListo={() => {
          localStorage.removeItem(CLAVE_PEDIDO)
          setPedido(null)
          setUsuario(pedido.usuario)
          setContrasena('')
        }}
      />
    )
  }

  return (
    <div className="ingreso">
      <form onSubmit={enviar} noValidate>
        <img src={LOGO_WOODTOOLS} alt="WoodTools S.R.L." className="logo" />
        <p className="subtitulo">Panel de administración</p>

        {(errorGeneral || error) && (
          <div className="aviso error" role="alert">
            {errorGeneral ?? error}
          </div>
        )}
        {avisoReset && (
          <div className="aviso atencion" role="status">
            {avisoReset}
          </div>
        )}

        <div className="campo">
          <label htmlFor="usuario">Usuario o email</label>
          <input
            id="usuario"
            value={usuario}
            onChange={(e) => setUsuario(e.target.value)}
            autoComplete="username"
            autoFocus
            aria-invalid={!!errores.usuario}
          />
          {errores.usuario && <div className="error-campo">{errores.usuario}</div>}
        </div>

        <div className="campo">
          <label htmlFor="contrasena">Contraseña</label>
          <input
            id="contrasena"
            type="password"
            value={contrasena}
            onChange={(e) => setContrasena(e.target.value)}
            autoComplete="current-password"
            aria-invalid={!!errores.contrasena}
          />
          {errores.contrasena && <div className="error-campo">{errores.contrasena}</div>}
        </div>

        <button type="submit" className="primario" disabled={enviando} style={{ width: '100%' }}>
          {enviando ? 'Ingresando…' : 'INGRESAR'}
        </button>

        <button
          type="button"
          onClick={pedirReset}
          disabled={pidiendo}
          style={{ ...estiloEnlace, width: '100%', marginTop: 8 }}
        >
          {pidiendo ? 'Enviando el pedido…' : 'Olvidé mi contraseña'}
        </button>
      </form>
    </div>
  )
}

/**
 * "Elegí tu contraseña nueva", después de pedir el restablecimiento desde el
 * panel. Corre deslogueado: el cambio lo aplica la función del servidor, que
 * sólo lo deja pasar si otro administrador ya habilitó el pedido.
 */
function ElegirNueva({
  pedido,
  alCancelar,
  alListo,
}: {
  pedido: PedidoGuardado
  alCancelar: () => void
  alListo: () => void
}) {
  const [nueva, setNueva] = useState('')
  const [repetida, setRepetida] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [listo, setListo] = useState(false)
  const [guardando, setGuardando] = useState(false)

  async function guardar(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (nueva.length < LARGO_MINIMO) {
      setError(`La contraseña tiene que tener al menos ${LARGO_MINIMO} caracteres.`)
      return
    }
    if (nueva !== repetida) {
      setError('Las dos contraseñas no son iguales.')
      return
    }

    setGuardando(true)
    try {
      await invocar('restablecer-contrasena', { id: pedido.id, token: pedido.token, nueva })
      setListo(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No pudimos cambiarla. Probá de nuevo.')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="ingreso">
      <form onSubmit={guardar} noValidate>
        <img src={LOGO_WOODTOOLS} alt="WoodTools S.R.L." className="logo" />
        <p className="subtitulo">Elegí tu contraseña · {pedido.usuario}</p>

        {listo ? (
          <>
            <div className="aviso exito" role="status">
              Contraseña cambiada. Entrá con la nueva.
            </div>
            <button type="button" className="primario" style={{ width: '100%' }} onClick={alListo}>
              IR A INGRESAR
            </button>
          </>
        ) : (
          <>
            <div className="aviso atencion" role="status">
              Pedile a un administrador que habilite tu pedido desde Usuarios. Cuando esté, elegí acá
              tu contraseña nueva. La habilitación dura unos minutos.
            </div>
            {error && (
              <div className="aviso error" role="alert">
                {error}
              </div>
            )}

            <div className="campo">
              <label htmlFor="nueva">Contraseña nueva</label>
              <input
                id="nueva"
                type="password"
                value={nueva}
                onChange={(e) => setNueva(e.target.value)}
                autoComplete="new-password"
                autoFocus
              />
            </div>

            <div className="campo">
              <label htmlFor="repetida">Repetila</label>
              <input
                id="repetida"
                type="password"
                value={repetida}
                onChange={(e) => setRepetida(e.target.value)}
                autoComplete="new-password"
              />
            </div>

            <button type="submit" className="primario" disabled={guardando} style={{ width: '100%' }}>
              {guardando ? 'Cambiando…' : 'CAMBIAR MI CONTRASEÑA'}
            </button>
            <button
              type="button"
              onClick={alCancelar}
              style={{ ...estiloEnlace, width: '100%', marginTop: 8 }}
            >
              Cancelar el pedido
            </button>
          </>
        )}
      </form>
    </div>
  )
}
