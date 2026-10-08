import {
  BUCKET_FOTOS,
  ETIQUETA_ESTADO_USUARIO,
  ETIQUETA_ROL,
  urlesDeFotos,
  type Perfil,
  type RolUsuario,
} from '@woodtools/compartido'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'

import { supabase } from '../nucleo/supabase'
import { AltaUsuario } from './AltaUsuario'

/** 2 MB, igual que en el alta: es la foto de un carnet, no una galería. */
const PESO_MAXIMO_FOTO = 2 * 1024 * 1024

/**
 * Altas, bajas y aprobaciones.
 *
 * Son los dos candados que separan "tener la contraseña" de "poder usar la
 * app": el alta del usuario y la habilitación del teléfono. Los dos se resuelven
 * desde acá.
 */
export function PaginaUsuarios({ soloLectura }: { soloLectura: boolean }) {
  const cliente = useQueryClient()
  const [mensaje, setMensaje] = useState<string | null>(null)
  const [mostrarAlta, setMostrarAlta] = useState(false)
  const [rehabilitado, setRehabilitado] = useState<{
    usuario: string
    contrasena_provisoria: string
  } | null>(null)

  const { data: perfiles, isLoading } = useQuery({
    queryKey: ['perfiles'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('perfiles')
        .select('*')
        .order('estado', { ascending: true })
        .order('creado_en', { ascending: false })
      if (error) throw error
      return data as Perfil[]
    },
  })

  /*
   * Las fotos de los vendedores viven en un bucket privado, así que `foto_url`
   * es la ruta del objeto y no una dirección usable. Se firman todas juntas
   * —una sola vez por ruta— para mostrarlas en la lista. La clave incluye las
   * rutas, así que al cambiar una foto se vuelve a firmar sola.
   */
  const rutasFotos = (perfiles ?? []).map((p) => p.foto_url)
  const { data: fotosFirmadas } = useQuery({
    queryKey: ['fotos-perfiles', [...new Set(rutasFotos.filter(Boolean))].sort().join('|')],
    queryFn: () => urlesDeFotos(supabase, rutasFotos),
    enabled: (perfiles ?? []).length > 0,
  })

  /*
   * La última conexión de cada uno.
   *
   * `perfiles.ultimo_acceso_en` sola no sirve para esto: se escribe únicamente
   * cuando alguien tipea la contraseña, y la sesión de la app no vence, así
   * que la columna decía "Nunca" de gente que había abierto la app el día
   * anterior. La vista toma el máximo de las cuatro señales que ya se venían
   * guardando. Ver la migración 20260902115441.
   */
  const { data: conexiones } = useQuery({
    queryKey: ['ultima-conexion'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vista_ultima_conexion')
        .select('perfil_id, ultima_conexion, de_donde, cuantos_aparatos')
      if (error) throw error
      return data as Array<{
        perfil_id: string
        ultima_conexion: string | null
        de_donde: string | null
        cuantos_aparatos: number | null
      }>
    },
    refetchInterval: 60_000,
  })

  const conexionDe = new Map((conexiones ?? []).map((c) => [c.perfil_id, c]))

  const { data: dispositivos, error: falloDispositivos } = useQuery({
    queryKey: ['dispositivos'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('dispositivos')
        // El nombre de la clave foránea va explícito y no es un adorno:
        // `dispositivos` apunta DOS veces a `perfiles` —de quién es el teléfono
        // y quién lo habilitó—. Pidiendo "perfiles" a secas, PostgREST no sabe
        // por cuál de los dos caminos ir y rechaza la consulta entera. La lista
        // quedaba vacía y la pantalla anunciaba que no había teléfonos
        // esperando, que es la peor forma de fallar: sin ruido y diciendo que
        // todo está bien.
        .select('*, perfiles!dispositivos_perfil_id_fkey ( nombre_completo, codigo_vendedor )')
        .order('creado_en', { ascending: false })
      if (error) throw error
      return data as Array<
        Record<string, unknown> & {
          id: string
          instalacion_id: string
          autorizado: boolean
          perfiles: { nombre_completo: string; codigo_vendedor: string | null } | null
        }
      >
    },
  })

  const resolver = useMutation({
    mutationFn: async (params: {
      perfilId: string
      aprobar: boolean
      rol?: RolUsuario
      codigo?: string
      motivo?: string
    }) => {
      const { error } = await supabase.rpc('resolver_alta_usuario', {
        p_perfil_id: params.perfilId,
        p_aprobar: params.aprobar,
        p_rol: params.rol ?? 'vendedor',
        p_codigo: params.codigo ?? null,
        p_motivo: params.motivo ?? null,
      })
      if (error) throw error
    },
    onSuccess: (_d, v) => {
      setMensaje(v.aprobar ? 'Usuario aprobado. Ya puede entrar a la app.' : 'Solicitud rechazada.')
      void cliente.invalidateQueries()
    },
    onError: (e: Error) => setMensaje(`No se pudo completar: ${e.message}`),
  })

  const cambiarEstado = useMutation({
    mutationFn: async (params: { perfilId: string; estado: Perfil['estado'] }) => {
      const { error } = await supabase
        .from('perfiles')
        .update({ estado: params.estado })
        .eq('id', params.perfilId)
      if (error) throw error
    },
    onSuccess: () => {
      setMensaje('Estado actualizado.')
      void cliente.invalidateQueries()
    },
  })

  /**
   * Sacar a alguien de la suspensión, REINICIÁNDOLE la contraseña.
   *
   * A diferencia de reactivar una baja o un rechazo —que es un simple UPDATE de
   * estado (cambiarEstado)—, sacar a alguien de la suspensión le rota la clave a
   * una provisoria nueva (la vieja deja de servir) y lo obliga a cambiarla al
   * entrar, igual que en el alta. Rotar la clave de otro es una operación de
   * administrador de Auth, así que va por la edge function `rehabilitar-usuario`
   * (service_role del lado servidor), no por un UPDATE del panel.
   */
  const rehabilitar = useMutation({
    mutationFn: async (perfilId: string) => {
      const { data, error: errFuncion } = await supabase.functions.invoke('rehabilitar-usuario', {
        body: { perfil_id: perfilId },
      })
      if (errFuncion) {
        // El cuerpo del error trae el mensaje de verdad; la capa de funciones
        // dice siempre lo mismo. Mismo patrón que el alta.
        let detalle = errFuncion.message
        try {
          const cuerpo = await (errFuncion as { context?: Response }).context?.json()
          if (cuerpo?.error) detalle = cuerpo.error
        } catch {
          /* se queda con el genérico */
        }
        throw new Error(detalle)
      }
      return data as { usuario: string; contrasena_provisoria: string }
    },
    onSuccess: (data) => {
      setRehabilitado(data)
      setMensaje('Cuenta rehabilitada. Anotá la contraseña provisoria: no se vuelve a mostrar.')
      void cliente.invalidateQueries()
    },
    onError: (e: Error) => setMensaje(`No se pudo rehabilitar: ${e.message}`),
  })

  /**
   * Qué zonas cubre cada vendedor.
   *
   * Con esto la nota de pedido puede completar sola el número de vendedor
   * cuando quien la carga no tiene uno propio. Mientras la columna esté vacía
   * no pasa nada malo: el campo de la nota simplemente queda para completar a
   * mano, como hasta ahora.
   */
  const guardarZonas = useMutation({
    mutationFn: async (params: { perfilId: string; zonas: string[] }) => {
      const { error } = await supabase
        .from('perfiles')
        .update({ zonas: params.zonas })
        .eq('id', params.perfilId)
      if (error) throw error
    },
    onSuccess: () => {
      setMensaje('Zonas actualizadas.')
      void cliente.invalidateQueries()
    },
    onError: (e: Error) => setMensaje(`No se pudieron guardar las zonas: ${e.message}`),
  })

  /**
   * Si el vendedor puede imprimir el rol de visita desde la app.
   *
   * La oficina decide quién sí y quién no; en la app, al que tiene esto en `false`
   * no le aparece la opción "IMPRIMIR ROL DE VISITA". No aplica a admin/supervisor.
   */
  const guardarImprimeRoles = useMutation({
    mutationFn: async (params: { perfilId: string; imprime: boolean }) => {
      const { error } = await supabase
        .from('perfiles')
        .update({ imprime_roles: params.imprime })
        .eq('id', params.perfilId)
      if (error) throw error
    },
    onSuccess: () => {
      setMensaje('Permiso de impresión del rol actualizado.')
      void cliente.invalidateQueries()
    },
    onError: (e: Error) => setMensaje(`No se pudo guardar el permiso de impresión: ${e.message}`),
  })

  /**
   * Cambiar el rol de un usuario.
   *
   * Va por la RPC `cambiar_rol_usuario` y no por un UPDATE directo: la función
   * del servidor es la que garantiza que lo pida un admin, que nadie se quite a
   * sí mismo el admin, y que no quede la oficina sin ningún administrador. Qué
   * ve cada rol en la app se configura aparte, en "Permisos".
   */
  const cambiarRol = useMutation({
    mutationFn: async (params: { perfilId: string; rol: RolUsuario }) => {
      const { error } = await supabase.rpc('cambiar_rol_usuario', {
        p_usuario_id: params.perfilId,
        p_rol: params.rol,
      })
      if (error) throw error
    },
    onSuccess: () => {
      setMensaje('Rol actualizado. Qué ve ese rol en la app se configura en "Permisos".')
      void cliente.invalidateQueries()
    },
    onError: (e: Error) => setMensaje(`No se pudo cambiar el rol: ${e.message}`),
  })

  /**
   * El número de vendedor, después del alta.
   *
   * Hasta ahora se cargaba una sola vez, al aprobar el usuario, y si quedaba
   * mal no había dónde corregirlo: el número va impreso en cada nota de pedido
   * y en la columna "Codigo" del rol de visita, así que un dígito equivocado se
   * arrastra a todo el papel que firma ese vendedor.
   */
  const guardarCodigo = useMutation({
    mutationFn: async (params: { perfilId: string; codigo: string }) => {
      const limpio = params.codigo.trim()
      const { error } = await supabase
        .from('perfiles')
        .update({ codigo_vendedor: limpio === '' ? null : limpio })
        .eq('id', params.perfilId)
      if (error) throw error
    },
    onSuccess: () => {
      setMensaje('Número de vendedor actualizado. Sale en las notas nuevas.')
      void cliente.invalidateQueries()
    },
    onError: (e: Error) => setMensaje(`No se pudo guardar el número: ${e.message}`),
  })

  /**
   * El nombre y el usuario de login, corregibles después del alta.
   *
   * Antes el nombre quedaba fijo desde que se creaba la cuenta y no había dónde
   * arreglar un tipeo; el usuario (con lo que entra a la app) tampoco. Los dos
   * son del perfil, así que es un UPDATE directo que la policy de admin permite.
   * El `usuario` es único (índice `perfiles_usuario_unico` sobre `lower(usuario)`):
   * si choca con otro, se traduce el 23505 a algo entendible.
   */
  const guardarDatos = useMutation({
    mutationFn: async (params: {
      perfilId: string
      nombre_completo: string
      usuario: string | null
    }) => {
      const { error } = await supabase
        .from('perfiles')
        .update({ nombre_completo: params.nombre_completo, usuario: params.usuario })
        .eq('id', params.perfilId)
      if (error) {
        if (error.code === '23505') {
          throw new Error('Ese nombre de usuario ya lo tiene otra persona. Elegí otro.')
        }
        throw error
      }
    },
    onSuccess: () => {
      setMensaje('Datos del usuario actualizados.')
      void cliente.invalidateQueries()
    },
    onError: (e: Error) => setMensaje(`No se pudieron guardar: ${e.message}`),
  })

  /**
   * Cambiar el email de un usuario.
   *
   * El email es la identidad de Auth —con él entra y pide restablecer la clave—,
   * así que no se puede cambiar con un UPDATE del perfil: va por la edge function
   * `cambiar-email-usuario` (service_role), que lo cambia en Auth y lo copia al
   * perfil. Mismo patrón que `rehabilitar`.
   */
  const cambiarEmail = useMutation({
    mutationFn: async (params: { perfilId: string; email: string }) => {
      const { data, error: errFuncion } = await supabase.functions.invoke('cambiar-email-usuario', {
        body: { perfil_id: params.perfilId, nuevo_email: params.email },
      })
      if (errFuncion) {
        // El cuerpo del error trae el mensaje de verdad; la capa de funciones
        // dice siempre lo mismo. Mismo patrón que el alta y la rehabilitación.
        let detalle = errFuncion.message
        try {
          const cuerpo = await (errFuncion as { context?: Response }).context?.json()
          if (cuerpo?.error) detalle = cuerpo.error
        } catch {
          /* se queda con el genérico */
        }
        throw new Error(detalle)
      }
      return data as { email: string }
    },
    onSuccess: () => {
      setMensaje('Email actualizado. Con ese email entra a la app y pide la contraseña.')
      void cliente.invalidateQueries()
    },
    onError: (e: Error) => setMensaje(`No se pudo cambiar el email: ${e.message}`),
  })

  /**
   * Cambiar —o quitar— la foto de un usuario.
   *
   * La foto es sólo `perfiles.foto_url` (la ruta en el bucket privado), así que
   * no hace falta edge function: el administrador sube al bucket y actualiza el
   * perfil directo, como con el código y las zonas. Se sube con un nombre nuevo
   * (fecha incluida) en vez de pisar el anterior, para no depender de una policy
   * de UPDATE en storage; recién cuando el perfil quedó apuntando a la nueva se
   * borra la vieja, que ya no referencia nadie. `foto` en null sólo la quita.
   */
  const cambiarFoto = useMutation({
    mutationFn: async (params: { perfil: Perfil; foto: File | null }) => {
      const { perfil, foto } = params
      const anterior = perfil.foto_url
      let nuevaRuta: string | null = null

      if (foto) {
        if (foto.size > PESO_MAXIMO_FOTO) {
          throw new Error('La foto pesa más de 2 MB. Probá con una más chica.')
        }
        const extension = foto.name.split('.').pop()?.toLowerCase() ?? 'jpg'
        const base =
          (perfil.usuario || perfil.codigo_vendedor || 'vendedor').replace(/[^a-z0-9._-]/gi, '') ||
          'vendedor'
        nuevaRuta = `${base}-${Date.now()}.${extension}`
        const { error: errSubida } = await supabase.storage
          .from(BUCKET_FOTOS)
          .upload(nuevaRuta, foto, { contentType: foto.type, upsert: false })
        if (errSubida) throw new Error(`No pudimos subir la foto: ${errSubida.message}`)
      }

      const { error: errPerfil } = await supabase
        .from('perfiles')
        .update({ foto_url: nuevaRuta })
        .eq('id', perfil.id)
      if (errPerfil) {
        // No quedó apuntando a la nueva: se borra la que se acaba de subir para
        // no dejar un objeto huérfano en el bucket.
        if (nuevaRuta) {
          try {
            await supabase.storage.from(BUCKET_FOTOS).remove([nuevaRuta])
          } catch {
            /* best-effort */
          }
        }
        throw errPerfil
      }

      // La anterior ya no la referencia nadie: se borra. Best-effort —si la
      // policy no dejara, no es un error para quien cambió la foto—. Las URLs
      // completas viejas (si alguna quedó guardada así) no son del bucket.
      if (anterior && !/^(https?:|data:|blob:)/i.test(anterior)) {
        try {
          await supabase.storage.from(BUCKET_FOTOS).remove([anterior])
        } catch {
          /* best-effort */
        }
      }
    },
    onSuccess: (_d, v) => {
      setMensaje(v.foto ? 'Foto actualizada.' : 'Foto quitada.')
      void cliente.invalidateQueries()
    },
    onError: (e: Error) => setMensaje(`No se pudo cambiar la foto: ${e.message}`),
  })

  const autorizarDispositivo = useMutation({
    mutationFn: async (params: { id: string; autorizado: boolean }) => {
      const { error } = await supabase
        .from('dispositivos')
        .update({
          autorizado: params.autorizado,
          autorizado_en: params.autorizado ? new Date().toISOString() : null,
        })
        .eq('id', params.id)
      if (error) throw error
    },
    onSuccess: () => {
      setMensaje('Teléfono actualizado.')
      void cliente.invalidateQueries()
    },
  })

  /**
   * Eliminar el registro de un teléfono. DELETE directo: la RLS
   * `dispositivos_admin` ya lo permite al admin y ninguna FK lo bloquea. No
   * borra al vendedor ni sus datos; si el equipo sigue instalado se re-registra
   * como "Sin autorizar" al reabrir la app. Sirve para descartar registros de
   * más o equipos reemplazados. La lista completa de teléfonos está en
   * ACTUALIZACIONES; acá se pueden descartar los pendientes.
   */
  const eliminarDispositivo = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('dispositivos').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      setMensaje('Teléfono eliminado.')
      void cliente.invalidateQueries()
    },
    onError: (e: Error) => setMensaje(`No se pudo eliminar: ${e.message}`),
  })

  /*
   * Pedidos de restablecer contraseña.
   *
   * El que se olvidó la clave no tiene sesión, así que no puede cambiarla solo:
   * pide desde el celular (o desde el login del panel), esto lo muestra, y un
   * administrador lo habilita. Recién ahí el vendedor elige su contraseña nueva
   * —nadie le dicta ninguna provisoria—. Se ven también los ya usados, para
   * saber que el vendedor efectivamente la cambió.
   */
  const { data: pedidos } = useQuery({
    queryKey: ['pedidos-contrasena'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pedidos_contrasena')
        .select('*')
        .in('estado', ['pendiente', 'habilitado', 'usada'])
        .order('creado_en', { ascending: false })
        .limit(30)
      if (error) throw error
      return data as Array<{
        id: string
        usuario: string
        estado: 'pendiente' | 'habilitado' | 'usada' | 'cancelada'
        origen: string
        dispositivo_desc: string | null
        habilitado_en: string | null
        vence_en: string | null
        usada_en: string | null
        creado_en: string
      }>
    },
    refetchInterval: 30_000,
  })

  /** Cuánto vale la habilitación antes de vencer. */
  const MINUTOS_HABILITADO = 30

  const habilitarPedido = useMutation({
    mutationFn: async (id: string) => {
      const { data: yo } = await supabase.auth.getUser()
      const ahora = Date.now()
      const { error } = await supabase
        .from('pedidos_contrasena')
        .update({
          estado: 'habilitado',
          habilitado_por: yo.user?.id ?? null,
          habilitado_en: new Date(ahora).toISOString(),
          vence_en: new Date(ahora + MINUTOS_HABILITADO * 60_000).toISOString(),
        })
        .eq('id', id)
        // Sólo se habilita lo que está pendiente: si alguien ya lo tocó desde
        // otra pantalla, esto no lo pisa.
        .eq('estado', 'pendiente')
      if (error) throw error
    },
    onSuccess: () => {
      setMensaje(
        `Habilitado. El vendedor tiene ${MINUTOS_HABILITADO} minutos para elegir su contraseña nueva desde la app.`,
      )
      void cliente.invalidateQueries()
    },
    onError: (e: Error) => setMensaje(`No se pudo habilitar: ${e.message}`),
  })

  const pendientes = (perfiles ?? []).filter((p) => p.estado === 'pendiente')
  const resto = (perfiles ?? []).filter((p) => p.estado !== 'pendiente')
  const telefonosPendientes = (dispositivos ?? []).filter((d) => !d.autorizado)
  const resetsPendientes = (pedidos ?? []).filter((p) => p.estado === 'pendiente')
  const resetsResueltos = (pedidos ?? []).filter((p) => p.estado !== 'pendiente')

  return (
    <>
      <header className="encabezado-pagina">
        <div>
          <h1>Usuarios</h1>
          <p>Dá de alta empleados, asigná el código de vendedor y habilitá los teléfonos.</p>
        </div>
        {!soloLectura && !mostrarAlta && (
          <button className="primario" onClick={() => setMostrarAlta(true)}>
            + Nuevo usuario
          </button>
        )}
      </header>

      {mostrarAlta && (
        <AltaUsuario
          alTerminar={() => {
            setMostrarAlta(false)
            void cliente.invalidateQueries()
          }}
        />
      )}

      {mensaje && (
        <div className="aviso exito" role="status">
          {mensaje}
        </div>
      )}

      {/* ── Contraseña provisoria de una cuenta recién rehabilitada ──────────
          Mismo trato que el alta: se muestra UNA vez para dictársela al
          empleado y no queda guardada. */}
      {rehabilitado && (
        <section className="tarjeta">
          <h2>Contraseña provisoria de {rehabilitado.usuario}</h2>
          <table>
            <tbody>
              <tr>
                <td style={{ width: 200 }}>Usuario</td>
                <td>
                  <code>{rehabilitado.usuario}</code>
                </td>
              </tr>
              <tr>
                <td>Contraseña provisoria</td>
                <td>
                  <code style={{ fontSize: 18, letterSpacing: 1 }}>
                    {rehabilitado.contrasena_provisoria}
                  </code>
                </td>
              </tr>
            </tbody>
          </table>

          <div className="aviso atencion" role="alert" style={{ marginTop: 16 }}>
            <strong>Anotala ahora: no se vuelve a mostrar.</strong> Dásela al vendedor. La contraseña
            anterior ya no sirve; al entrar, la app le va a pedir que la cambie por una suya.
          </div>

          <div className="acciones" style={{ marginTop: 16 }}>
            <button
              className="primario"
              onClick={() => {
                void navigator.clipboard.writeText(
                  `Usuario: ${rehabilitado.usuario}\nContraseña: ${rehabilitado.contrasena_provisoria}`,
                )
              }}
            >
              Copiar usuario y contraseña
            </button>
            <button onClick={() => setRehabilitado(null)}>Listo</button>
          </div>
        </section>
      )}

      {soloLectura && (
        <div className="aviso atencion">
          Estás como supervisor: podés ver todo, pero las altas y bajas las resuelve un administrador.
        </div>
      )}

      {/* ── Altas esperando aprobación ─────────────────────────────────────── */}
      <section className="tarjeta">
        <h2>Esperando aprobación ({pendientes.length})</h2>

        {isLoading ? (
          <p>Cargando…</p>
        ) : pendientes.length === 0 ? (
          <p className="vacio">No hay solicitudes pendientes.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Usuario</th>
                <th>Solicitado</th>
                <th style={{ width: 300 }}>Aprobar como</th>
                <th style={{ width: 130 }} />
              </tr>
            </thead>
            <tbody>
              {pendientes.map((p) => (
                <FilaPendiente
                  key={p.id}
                  perfil={p}
                  soloLectura={soloLectura}
                  alResolver={(datos) => resolver.mutate({ perfilId: p.id, ...datos })}
                />
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* ── Teléfonos ──────────────────────────────────────────────────────── */}
      <section className="tarjeta">
        <h2>Teléfonos por habilitar ({telefonosPendientes.length})</h2>

        {/* Sin esto, un fallo al traer la lista se ve igual que "no hay
            teléfonos esperando", y alguien se queda sin poder entrar a la app
            mientras el panel asegura que está todo en orden. */}
        {falloDispositivos ? (
          <p className="vacio" style={{ color: 'var(--rojo-accion)' }}>
            No pudimos traer los teléfonos: {(falloDispositivos as Error).message}. Nadie confirmó
            que no haya ninguno esperando; volvé a entrar en un momento.
          </p>
        ) : telefonosPendientes.length === 0 ? (
          <p className="vacio">Todos los teléfonos registrados están habilitados.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Vendedor</th>
                <th>Equipo</th>
                <th>Código</th>
                <th>Versión</th>
                <th style={{ width: 140 }} />
              </tr>
            </thead>
            <tbody>
              {telefonosPendientes.map((d) => (
                <tr key={d.id}>
                  <td>
                    {d.perfiles?.nombre_completo ?? '—'}
                    {d.perfiles?.codigo_vendedor ? ` (#${d.perfiles.codigo_vendedor})` : ''}
                  </td>
                  <td>
                    {String(d.fabricante ?? '')} {String(d.modelo ?? '')}
                    <br />
                    <small style={{ color: 'var(--tinta-tenue)' }}>{String(d.version_so ?? '')}</small>
                  </td>
                  {/* El vendedor ve estos 8 caracteres en su pantalla de espera. */}
                  <td>
                    <code>{d.instalacion_id.slice(0, 8).toUpperCase()}</code>
                  </td>
                  <td>{String(d.version_app ?? '—')}</td>
                  <td>
                    <div className="acciones">
                      <button
                        className="primario chico"
                        disabled={soloLectura}
                        onClick={() => autorizarDispositivo.mutate({ id: d.id, autorizado: true })}
                      >
                        Habilitar
                      </button>
                      <button
                        className="chico peligro"
                        disabled={soloLectura || eliminarDispositivo.isPending}
                        onClick={() => {
                          if (
                            confirm(
                              `¿Eliminar este teléfono de ${d.perfiles?.nombre_completo ?? 'este vendedor'}? Si el equipo sigue instalado, va a volver a aparecer acá al reabrir la app.`,
                            )
                          ) {
                            eliminarDispositivo.mutate(d.id)
                          }
                        }}
                      >
                        Eliminar
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* ── Contraseñas olvidadas ──────────────────────────────────────────── */}
      <section className="tarjeta">
        <h2>Contraseñas olvidadas ({resetsPendientes.length})</h2>
        <p className="vacio" style={{ marginTop: 0 }}>
          Cuando alguien pide restablecer la contraseña, aparece acá. Al habilitarlo, tiene{' '}
          {MINUTOS_HABILITADO} minutos para elegir una nueva desde la app; no se dicta ninguna
          contraseña provisoria.
        </p>

        {resetsPendientes.length === 0 ? (
          <p className="vacio">No hay pedidos esperando.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Usuario</th>
                <th>Pidió desde</th>
                <th>Cuándo</th>
                <th style={{ width: 140 }} />
              </tr>
            </thead>
            <tbody>
              {resetsPendientes.map((p) => (
                <tr key={p.id}>
                  <td>
                    <strong>{p.usuario}</strong>
                  </td>
                  <td>
                    {p.origen === 'panel' ? 'el panel' : 'el celular'}
                    {p.dispositivo_desc ? (
                      <>
                        <br />
                        <small style={{ color: 'var(--tinta-tenue)' }}>{p.dispositivo_desc}</small>
                      </>
                    ) : null}
                  </td>
                  <td>{new Date(p.creado_en).toLocaleString('es-AR')}</td>
                  <td>
                    <button
                      className="primario chico"
                      disabled={soloLectura || habilitarPedido.isPending}
                      onClick={() => habilitarPedido.mutate(p.id)}
                    >
                      Permitir cambio
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Los ya resueltos: para ver que el vendedor efectivamente la cambió. */}
        {resetsResueltos.length > 0 && (
          <table style={{ marginTop: 'var(--espacio-3, 12px)' }}>
            <thead>
              <tr>
                <th>Usuario</th>
                <th>Estado</th>
                <th>Cuándo</th>
              </tr>
            </thead>
            <tbody>
              {resetsResueltos.map((p) => (
                <tr key={p.id}>
                  <td>{p.usuario}</td>
                  <td>
                    {p.estado === 'usada' ? (
                      <span style={{ color: 'var(--verde, green)' }}>Ya la cambió</span>
                    ) : p.estado === 'habilitado' ? (
                      `Habilitado${p.vence_en && new Date(p.vence_en).getTime() < Date.now() ? ' (vencido)' : ' · esperando que la cambie'}`
                    ) : (
                      'Cancelado'
                    )}
                  </td>
                  <td>
                    {new Date(p.usada_en ?? p.habilitado_en ?? p.creado_en).toLocaleString('es-AR')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* ── Todos ──────────────────────────────────────────────────────────── */}
      <section className="tarjeta">
        <h2>Todos los usuarios ({resto.length})</h2>

        <div className="tabla-scroll">
        <table>
          <thead>
            <tr>
              <th style={{ width: 92 }}>Foto</th>
              <th>Nombre</th>
              <th>Código</th>
              <th>Zonas a cargo</th>
              <th>Imprime rol</th>
              <th>Rol</th>
              <th>Estado</th>
              <th>Última conexión</th>
              <th style={{ width: 170 }} />
            </tr>
          </thead>
          <tbody>
            {resto.map((p) => (
              <tr key={p.id}>
                <td>
                  <FotoDePerfil
                    perfil={p}
                    urlFirmada={p.foto_url ? (fotosFirmadas?.get(p.foto_url) ?? null) : null}
                    soloLectura={soloLectura}
                    subiendo={cambiarFoto.isPending && cambiarFoto.variables?.perfil.id === p.id}
                    alCambiar={(foto) => cambiarFoto.mutate({ perfil: p, foto })}
                  />
                </td>
                <td>
                  <NombreYUsuario
                    perfil={p}
                    soloLectura={soloLectura}
                    alGuardar={(datos) => guardarDatos.mutate({ perfilId: p.id, ...datos })}
                    alGuardarEmail={(email) => cambiarEmail.mutate({ perfilId: p.id, email })}
                  />
                </td>
                <td>
                  <CodigoDeVendedor
                    perfil={p}
                    soloLectura={soloLectura}
                    alGuardar={(codigo) => guardarCodigo.mutate({ perfilId: p.id, codigo })}
                  />
                </td>
                <td>
                  <ZonasACargo
                    perfil={p}
                    soloLectura={soloLectura}
                    alGuardar={(zonas) => guardarZonas.mutate({ perfilId: p.id, zonas })}
                  />
                </td>
                <td>
                  {p.rol === 'vendedor' ? (
                    <label
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        cursor: soloLectura ? 'default' : 'pointer',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={p.imprime_roles}
                        disabled={
                          soloLectura ||
                          (guardarImprimeRoles.isPending &&
                            guardarImprimeRoles.variables?.perfilId === p.id)
                        }
                        onChange={(e) =>
                          guardarImprimeRoles.mutate({ perfilId: p.id, imprime: e.target.checked })
                        }
                      />
                      <span style={{ fontSize: 13 }}>{p.imprime_roles ? 'Sí' : 'No'}</span>
                    </label>
                  ) : (
                    <small style={{ color: 'var(--tinta-tenue)' }}>Siempre</small>
                  )}
                </td>
                <td>
                  {soloLectura ? (
                    <span style={{ textTransform: 'capitalize' }}>{ETIQUETA_ROL[p.rol]}</span>
                  ) : (
                    <select
                      value={p.rol}
                      style={{ minWidth: 150 }}
                      disabled={cambiarRol.isPending && cambiarRol.variables?.perfilId === p.id}
                      onChange={(e) =>
                        cambiarRol.mutate({ perfilId: p.id, rol: e.target.value as RolUsuario })
                      }
                    >
                      {(['vendedor', 'supervisor', 'administracion', 'admin'] as RolUsuario[]).map(
                        (r) => (
                          <option key={r} value={r}>
                            {ETIQUETA_ROL[r]}
                          </option>
                        ),
                      )}
                    </select>
                  )}
                </td>
                <td>
                  <span className={`pastilla ${claseEstado(p.estado)}`}>
                    {ETIQUETA_ESTADO_USUARIO[p.estado]}
                  </span>
                </td>
                <td>
                  {conexionDe.get(p.id)?.ultima_conexion ? (
                    <>
                      {new Date(conexionDe.get(p.id)!.ultima_conexion!).toLocaleString('es-AR', {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      })}
                      <br />
                      {/* De dónde salió: no es lo mismo el que abrió la app que
                          el que sólo tipeó la contraseña una vez. */}
                      <small style={{ color: 'var(--tinta-tenue)' }}>
                        {conexionDe.get(p.id)?.de_donde}
                      </small>
                    </>
                  ) : (
                    'Nunca'
                  )}
                </td>
                <td>
                  <div className="acciones">
                    {p.estado === 'aprobado' ? (
                      <button
                        className="chico"
                        disabled={soloLectura}
                        onClick={() => cambiarEstado.mutate({ perfilId: p.id, estado: 'suspendido' })}
                      >
                        Suspender
                      </button>
                    ) : p.estado === 'suspendido' ? (
                      // Sacar de la suspensión reinicia la contraseña: rota la
                      // clave a una provisoria nueva y obliga a cambiarla al
                      // entrar (edge function). Reactivar una baja/rechazo NO
                      // toca la clave (rama de abajo).
                      <button
                        className="chico primario"
                        disabled={soloLectura || rehabilitar.isPending}
                        onClick={() => {
                          if (
                            confirm(
                              `Reactivar a ${p.nombre_completo}: se le genera una contraseña provisoria nueva (la anterior deja de servir) y la va a tener que cambiar al entrar. ¿Seguir?`,
                            )
                          ) {
                            rehabilitar.mutate(p.id)
                          }
                        }}
                      >
                        Reactivar
                      </button>
                    ) : (
                      <button
                        className="chico primario"
                        disabled={soloLectura}
                        onClick={() => cambiarEstado.mutate({ perfilId: p.id, estado: 'aprobado' })}
                      >
                        Reactivar
                      </button>
                    )}
                    <button
                      className="chico peligro"
                      disabled={soloLectura || p.estado === 'baja'}
                      onClick={() => {
                        if (confirm(`¿Dar de baja definitiva a ${p.nombre_completo}?`)) {
                          cambiarEstado.mutate({ perfilId: p.id, estado: 'baja' })
                        }
                      }}
                    >
                      Baja
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </section>
    </>
  )
}

/**
 * Las zonas del vendedor, escritas como en la planilla: "107, 121, 146".
 *
 * Se guardan sólo al tocar "Guardar" y no mientras se escribe: un `onChange`
 * que dispara un UPDATE por tecla convierte un error de tipeo en una zona
 * asignada a medias.
 *
 * No se validan contra el catálogo de zonas a propósito: la planilla es de la
 * empresa y puede sumar una zona antes que el código. Un código que no existe
 * simplemente no le va a coincidir a ninguna nota.
 */
/**
 * El número de vendedor de la celda, editable en el lugar.
 *
 * Mismo trato que las zonas: se escribe y el botón de guardar aparece recién
 * cuando hay algo distinto que guardar. Vaciarlo lo deja sin número, que es una
 * situación válida —administración y supervisores no llevan uno— y no un error.
 */
function CodigoDeVendedor({
  perfil,
  soloLectura,
  alGuardar,
}: {
  perfil: Perfil
  soloLectura: boolean
  alGuardar: (codigo: string) => void
}) {
  const guardado = perfil.codigo_vendedor ?? ''
  const [texto, setTexto] = useState(guardado)

  const cambio = texto.trim() !== guardado

  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <input
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        placeholder="—"
        inputMode="numeric"
        disabled={soloLectura}
        style={{ width: 56 }}
        aria-label={`Número de vendedor de ${perfil.nombre_completo}`}
      />
      {cambio ? (
        <button
          className="chico primario"
          disabled={soloLectura}
          onClick={() => alGuardar(texto)}
        >
          Guardar
        </button>
      ) : null}
    </div>
  )
}

function ZonasACargo({
  perfil,
  soloLectura,
  alGuardar,
}: {
  perfil: Perfil
  soloLectura: boolean
  alGuardar: (zonas: string[]) => void
}) {
  const guardadas = (perfil.zonas ?? []).join(', ')
  const [texto, setTexto] = useState(guardadas)

  const zonas = texto
    .split(/[,\s]+/)
    .map((z) => z.trim())
    .filter(Boolean)

  const cambio = zonas.join(', ') !== guardadas

  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <input
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        placeholder="107, 121"
        disabled={soloLectura}
        style={{ width: 120 }}
        aria-label={`Zonas a cargo de ${perfil.nombre_completo}`}
      />
      {cambio ? (
        <button className="chico primario" disabled={soloLectura} onClick={() => alGuardar(zonas)}>
          Guardar
        </button>
      ) : null}
    </div>
  )
}

/**
 * La foto del vendedor, con "Cambiar" y "Quitar".
 *
 * La imagen vive en el bucket privado, así que lo que se muestra es la URL ya
 * firmada que arma la página; sin foto —o si la firma falla— van las iniciales,
 * que es mejor que un cuadro roto. El archivo se elige con un input oculto, para
 * mostrar un botón propio en vez del "Elegir archivo" del navegador.
 */
function FotoDePerfil({
  perfil,
  urlFirmada,
  soloLectura,
  subiendo,
  alCambiar,
}: {
  perfil: Perfil
  urlFirmada: string | null
  soloLectura: boolean
  subiendo: boolean
  alCambiar: (foto: File | null) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
      {urlFirmada ? (
        <img
          src={urlFirmada}
          alt={`Foto de ${perfil.nombre_completo}`}
          style={{ width: 56, height: 56, borderRadius: '50%', objectFit: 'cover' }}
        />
      ) : (
        <div
          aria-hidden
          style={{
            width: 56,
            height: 56,
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--borde, #ccc)',
            color: 'var(--tinta-tenue, #555)',
            fontWeight: 600,
          }}
        >
          {inicialesDe(perfil.nombre_completo)}
        </div>
      )}

      {!soloLectura ? (
        <>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={(e) => {
              const archivo = e.target.files?.[0]
              // Se limpia el input para poder volver a elegir el MISMO archivo:
              // si no, al reintentar con el mismo nombre no vuelve a dispararse.
              e.target.value = ''
              if (archivo) alCambiar(archivo)
            }}
          />
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="chico" disabled={subiendo} onClick={() => inputRef.current?.click()}>
              {subiendo ? 'Subiendo…' : urlFirmada ? 'Cambiar' : 'Agregar'}
            </button>
            {urlFirmada ? (
              <button
                className="chico"
                disabled={subiendo}
                onClick={() => {
                  if (confirm(`¿Quitar la foto de ${perfil.nombre_completo}?`)) alCambiar(null)
                }}
              >
                Quitar
              </button>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  )
}

/** Hasta dos iniciales del nombre, para el círculo cuando no hay foto. */
function inicialesDe(nombre: string): string {
  return nombre
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
}

/**
 * El nombre, el usuario de login y el email, editables en el lugar.
 *
 * Mismo trato que el código y las zonas: el botón de guardar aparece recién
 * cuando hay algo distinto. El nombre es obligatorio; el usuario puede quedar
 * vacío (administración y supervisores entran por email).
 *
 * El EMAIL guarda aparte y pide confirmación: es la identidad de Auth —con él se
 * entra y se piden las contraseñas— así que cambiarlo va por la edge function, no
 * por el UPDATE del perfil, y conviene que no se dispare de un toque distraído.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function NombreYUsuario({
  perfil,
  soloLectura,
  alGuardar,
  alGuardarEmail,
}: {
  perfil: Perfil
  soloLectura: boolean
  alGuardar: (datos: { nombre_completo: string; usuario: string | null }) => void
  alGuardarEmail: (email: string) => void
}) {
  const usuarioGuardado = perfil.usuario ?? ''
  const emailGuardado = perfil.email ?? ''
  const [nombre, setNombre] = useState(perfil.nombre_completo)
  const [usuario, setUsuario] = useState(usuarioGuardado)
  const [email, setEmail] = useState(emailGuardado)

  const cambioDatos = nombre.trim() !== perfil.nombre_completo || usuario.trim() !== usuarioGuardado
  const nombreCorto = nombre.trim().length < 2
  const emailLimpio = email.trim().toLowerCase()
  const cambioEmail = emailLimpio !== emailGuardado.toLowerCase()
  const emailValido = EMAIL_RE.test(emailLimpio)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 220 }}>
      <input
        value={nombre}
        onChange={(e) => setNombre(e.target.value)}
        placeholder="Nombre y apellido"
        disabled={soloLectura}
        aria-label={`Nombre de ${perfil.nombre_completo}`}
      />
      <input
        value={usuario}
        onChange={(e) => setUsuario(e.target.value)}
        placeholder="usuario (para entrar)"
        disabled={soloLectura}
        autoCapitalize="none"
        autoCorrect="off"
        style={{ maxWidth: 180 }}
        aria-label={`Usuario de ${perfil.nombre_completo}`}
      />
      {nombreCorto && cambioDatos ? (
        <div className="error-campo">Escribí el nombre y apellido.</div>
      ) : null}
      {cambioDatos ? (
        <button
          className="chico primario"
          disabled={soloLectura || nombreCorto}
          onClick={() =>
            alGuardar({
              nombre_completo: nombre.trim(),
              usuario: usuario.trim() === '' ? null : usuario.trim(),
            })
          }
        >
          Guardar
        </button>
      ) : null}

      {/* El email: identidad de Auth, guarda por su cuenta y con confirmación. */}
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="correo@woodtools.com.ar"
        disabled={soloLectura}
        autoCapitalize="none"
        autoCorrect="off"
        aria-label={`Email de ${perfil.nombre_completo}`}
      />
      {cambioEmail && !emailValido ? (
        <div className="error-campo">El email no tiene un formato válido.</div>
      ) : null}
      {cambioEmail && emailValido ? (
        <button
          className="chico"
          disabled={soloLectura}
          onClick={() => {
            if (
              confirm(
                `¿Cambiar el email de ${perfil.nombre_completo} a ${emailLimpio}? Con ese email va a entrar a la app y pedir la contraseña.`,
              )
            ) {
              alGuardarEmail(emailLimpio)
            }
          }}
        >
          Guardar email
        </button>
      ) : null}
    </div>
  )
}

function FilaPendiente({
  perfil,
  soloLectura,
  alResolver,
}: {
  perfil: Perfil
  soloLectura: boolean
  alResolver: (datos: { aprobar: boolean; rol?: RolUsuario; codigo?: string; motivo?: string }) => void
}) {
  const [rol, setRol] = useState<RolUsuario>('vendedor')
  const [codigo, setCodigo] = useState(perfil.codigo_vendedor ?? '')
  // El motivo del rechazo se pide con un input propio: window.prompt() no
  // funciona en Electron (devolvía null y el rechazo no hacía nada).
  const [rechazando, setRechazando] = useState(false)
  const [motivo, setMotivo] = useState('')

  // Sin código de vendedor la planilla del rol de visita queda sin la columna
  // "Codigo", así que se exige antes de aprobar.
  const faltaCodigo = rol === 'vendedor' && !codigo.trim()

  return (
    <tr>
      <td>{perfil.nombre_completo}</td>
      <td>{perfil.email}</td>
      <td>{new Date(perfil.creado_en).toLocaleDateString('es-AR')}</td>
      <td>
        <div style={{ display: 'flex', gap: 8 }}>
          <select value={rol} onChange={(e) => setRol(e.target.value as RolUsuario)}>
            <option value="vendedor">Vendedor</option>
            <option value="supervisor">Supervisor</option>
            <option value="administracion">Administración</option>
            <option value="admin">Administrador</option>
          </select>
          <input
            placeholder="Código"
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
            style={{ maxWidth: 110 }}
            aria-label="Código de vendedor"
          />
        </div>
        {faltaCodigo && <div className="error-campo">Asigná el código de vendedor</div>}
      </td>
      <td>
        {rechazando ? (
          <div className="acciones">
            <input
              placeholder="Motivo del rechazo (lo va a ver el usuario)"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              aria-label="Motivo del rechazo"
              autoFocus
            />
            <button
              className="peligro chico"
              disabled={soloLectura}
              onClick={() => alResolver({ aprobar: false, motivo: motivo.trim() || undefined })}
            >
              Confirmar rechazo
            </button>
            <button
              className="chico"
              onClick={() => {
                setRechazando(false)
                setMotivo('')
              }}
            >
              Cancelar
            </button>
          </div>
        ) : (
          <div className="acciones">
            <button
              className="primario chico"
              disabled={soloLectura || faltaCodigo}
              onClick={() => alResolver({ aprobar: true, rol, codigo })}
            >
              Aprobar
            </button>
            <button
              className="peligro chico"
              disabled={soloLectura}
              onClick={() => setRechazando(true)}
            >
              Rechazar
            </button>
          </div>
        )}
      </td>
    </tr>
  )
}

function claseEstado(estado: Perfil['estado']): string {
  switch (estado) {
    case 'aprobado':
      return 'verde'
    case 'pendiente':
      return 'ambar'
    case 'rechazado':
    case 'baja':
      return 'roja'
    default:
      return 'gris'
  }
}
