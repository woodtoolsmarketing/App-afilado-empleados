import { type RolUsuario } from '@woodtools/compartido'
import { useState } from 'react'

import { supabase } from '../nucleo/supabase'

/**
 * Alta de un empleado.
 *
 * ─── La contraseña ──────────────────────────────────────────────────────────
 *
 * La genera el servidor y se muestra UNA vez, para que el administrador se la
 * pase al empleado. No queda guardada: Auth guarda su hash, no el texto. Si se
 * pierde, se restablece; no hay forma de volver a verla, y así tiene que ser.
 *
 * Como la vio alguien que no es su dueño, la cuenta queda obligada a cambiarla
 * en el primer ingreso. Una contraseña que conocen dos personas no identifica a
 * ninguna, y todo lo que la app registra queda firmado con ese usuario.
 *
 * ─── La foto ────────────────────────────────────────────────────────────────
 *
 * Va al bucket privado `fotos-vendedores`, que ya existe y sólo un
 * administrador puede escribir. Se sube ANTES de crear la cuenta: si la subida
 * falla, no queda un usuario a medio dar de alta.
 */

const BUCKET_FOTOS = 'fotos-vendedores'

/** 2 MB. Es la foto de un carnet, no una galería. */
const PESO_MAXIMO = 2 * 1024 * 1024

interface UsuarioCreado {
  usuario: string
  email: string
  contrasena_provisoria: string
}

export function AltaUsuario({
  alTerminar,
  dominio = 'woodtools.com.ar',
}: {
  alTerminar: () => void
  dominio?: string
}) {
  const [nombre, setNombre] = useState('')
  const [usuario, setUsuario] = useState('')
  const [email, setEmail] = useState('')
  const [telefono, setTelefono] = useState('')
  const [rol, setRol] = useState<RolUsuario>('vendedor')
  const [codigo, setCodigo] = useState('')
  const [zonas, setZonas] = useState('')
  const [foto, setFoto] = useState<File | null>(null)

  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [creado, setCreado] = useState<UsuarioCreado | null>(null)
  const [copiada, setCopiada] = useState(false)

  /**
   * El usuario se sugiere solo mientras no lo hayan tocado a mano.
   * "Ana Sosa" → "asosa", que es como la oficina la nombra.
   */
  const usuarioEfectivo = usuario.trim() || sugerirUsuario(nombre)
  const emailEfectivo = email.trim() || (usuarioEfectivo ? `${usuarioEfectivo}@${dominio}` : '')

  async function subirFoto(): Promise<string | null> {
    if (!foto) return null
    if (foto.size > PESO_MAXIMO) {
      throw new Error('La foto pesa más de 2 MB. Probá con una más chica.')
    }
    const extension = foto.name.split('.').pop()?.toLowerCase() ?? 'jpg'
    const ruta = `${usuarioEfectivo}-${Date.now()}.${extension}`

    const { error: errSubida } = await supabase.storage
      .from(BUCKET_FOTOS)
      .upload(ruta, foto, { contentType: foto.type, upsert: false })

    if (errSubida) throw new Error(`No pudimos subir la foto: ${errSubida.message}`)
    return ruta
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!nombre.trim()) {
      setError('Falta el nombre y apellido.')
      return
    }
    if (!/^[a-z0-9._-]{3,}$/.test(usuarioEfectivo)) {
      setError('El nombre de usuario tiene que ser de al menos 3 letras, sin espacios ni acentos.')
      return
    }

    setEnviando(true)
    try {
      const foto_url = await subirFoto()

      const { data, error: errFuncion } = await supabase.functions.invoke('crear-usuario', {
        body: {
          nombre_completo: nombre.trim(),
          usuario: usuarioEfectivo,
          email: emailEfectivo,
          telefono: telefono.trim(),
          rol,
          codigo_vendedor: codigo.trim(),
          zonas: zonas.split(/[,\s]+/).map((z) => z.trim()).filter(Boolean),
          foto_url,
          dominio,
        },
      })

      if (errFuncion) {
        // El cuerpo del error trae el mensaje de verdad; el de la capa de
        // funciones dice siempre lo mismo y no ayuda a nadie.
        let detalle = errFuncion.message
        try {
          const cuerpo = await (errFuncion as { context?: Response }).context?.json()
          if (cuerpo?.error) detalle = cuerpo.error
        } catch {
          /* se queda con el genérico */
        }
        throw new Error(detalle)
      }

      setCreado(data as UsuarioCreado)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No pudimos crear el usuario.')
    } finally {
      setEnviando(false)
    }
  }

  // ── Contraseña recién creada ────────────────────────────────────────────
  if (creado) {
    return (
      <section className="tarjeta">
        <h2>Usuario creado</h2>

        <table>
          <tbody>
            <tr>
              <td style={{ width: 200 }}>Usuario</td>
              <td>
                <code>{creado.usuario}</code>
              </td>
            </tr>
            <tr>
              <td>Correo de la cuenta</td>
              <td>
                <code>{creado.email}</code>
              </td>
            </tr>
            <tr>
              <td>Contraseña provisoria</td>
              <td>
                <code style={{ fontSize: 18, letterSpacing: 1 }}>
                  {creado.contrasena_provisoria}
                </code>
              </td>
            </tr>
          </tbody>
        </table>

        <div className="aviso atencion" role="alert" style={{ marginTop: 16 }}>
          <strong>Anotala ahora: no se vuelve a mostrar.</strong> No queda guardada en ningún lado.
          Si se pierde, hay que restablecerla. Al entrar por primera vez, la app le va a pedir que
          la cambie por una suya.
        </div>

        <div className="acciones" style={{ marginTop: 16 }}>
          <button
            className="primario"
            onClick={() => {
              void navigator.clipboard
                .writeText(`Usuario: ${creado.usuario}\nContraseña: ${creado.contrasena_provisoria}`)
                .then(() => setCopiada(true))
            }}
          >
            {copiada ? 'Copiado' : 'Copiar usuario y contraseña'}
          </button>
          <button onClick={alTerminar}>Listo</button>
        </div>
      </section>
    )
  }

  // ── Formulario ──────────────────────────────────────────────────────────
  return (
    <section className="tarjeta">
      <h2>Nuevo usuario</h2>

      <form onSubmit={enviar} noValidate>
        {error && (
          <div className="aviso error" role="alert">
            {error}
          </div>
        )}

        <div className="campo">
          <label htmlFor="nombre">Nombre y apellido</label>
          <input
            id="nombre"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            autoFocus
          />
        </div>

        <div className="campo">
          <label htmlFor="usuario">Nombre de usuario</label>
          <input
            id="usuario"
            value={usuario}
            onChange={(e) => setUsuario(e.target.value.toLowerCase())}
            placeholder={sugerirUsuario(nombre) || 'asosa'}
          />
          <small>
            Con esto entra a la app. Si lo dejás vacío usamos <code>{usuarioEfectivo || '—'}</code>.
          </small>
        </div>

        <div className="campo">
          <label htmlFor="email">Correo de la cuenta</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={emailEfectivo}
          />
          <small>
            También sirve para entrar. Vacío, se arma solo: <code>{emailEfectivo || '—'}</code>.
          </small>
        </div>

        <div className="campo">
          <label htmlFor="telefono">Teléfono</label>
          <input id="telefono" value={telefono} onChange={(e) => setTelefono(e.target.value)} />
        </div>

        <div className="campo">
          <label htmlFor="rol">Rol</label>
          <select id="rol" value={rol} onChange={(e) => setRol(e.target.value as RolUsuario)}>
            <option value="vendedor">Vendedor</option>
            <option value="supervisor">Supervisor</option>
            <option value="admin">Administrador</option>
          </select>
        </div>

        <div className="campo">
          <label htmlFor="codigo">Código de vendedor</label>
          <input
            id="codigo"
            value={codigo}
            onChange={(e) => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 4))}
            placeholder="7"
          />
          <small>El que sale impreso en la nota de pedido y en el rol de visita.</small>
        </div>

        <div className="campo">
          <label htmlFor="zonas">Zonas a cargo</label>
          <input
            id="zonas"
            value={zonas}
            onChange={(e) => setZonas(e.target.value)}
            placeholder="107, 121"
          />
          <small>
            Con esto la nota de pedido completa sola el número de vendedor cuando quien la carga no
            tiene uno propio.
          </small>
        </div>

        <div className="campo">
          <label htmlFor="foto">Foto</label>
          <input
            id="foto"
            type="file"
            accept="image/*"
            onChange={(e) => setFoto(e.target.files?.[0] ?? null)}
          />
          <small>Opcional. Hasta 2 MB.</small>
        </div>

        <div className="acciones" style={{ marginTop: 20 }}>
          <button type="submit" className="primario" disabled={enviando}>
            {enviando ? 'Creando…' : 'Crear usuario'}
          </button>
          <button type="button" onClick={alTerminar} disabled={enviando}>
            Cancelar
          </button>
        </div>
      </form>
    </section>
  )
}

/** Mismo criterio que usa el servidor, para que lo que se muestra coincida. */
function sugerirUsuario(nombre: string): string {
  const partes = nombre
    .normalize('NFD')
    .replace(new RegExp('[\\u0300-\\u036f]', 'g'), '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)

  if (partes.length === 0) return ''
  if (partes.length === 1) return partes[0]
  return `${partes[0][0]}${partes[partes.length - 1]}`
}
