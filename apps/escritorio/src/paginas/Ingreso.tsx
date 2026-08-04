import { validarLogin, type CampoLogin } from '@woodtools/compartido'
import { useState } from 'react'

import { supabase } from '../nucleo/supabase'

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

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    setErrorGeneral(null)

    const { valido, errores: nuevos } = validarLogin(usuario, contrasena)
    setErrores(nuevos)
    if (!valido) return

    setEnviando(true)
    const email = usuario.includes('@') ? usuario.trim() : `${usuario.trim()}@woodtools.com.ar`

    const { error: errIngreso } = await supabase.auth.signInWithPassword({
      email: email.toLowerCase(),
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

  return (
    <div className="ingreso">
      <form onSubmit={enviar} noValidate>
        <h1>WOODTOOLS</h1>
        <p className="subtitulo">Panel de administración</p>

        {(errorGeneral || error) && (
          <div className="aviso error" role="alert">
            {errorGeneral ?? error}
          </div>
        )}

        <div className="campo">
          <label htmlFor="usuario">Usuario</label>
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
      </form>
    </div>
  )
}
