import type { Cliente, Direccion, Perfil, RolUsuario } from '@woodtools/compartido'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import L from 'leaflet'
import { useEffect, useState } from 'react'
import { MapContainer, Marker, TileLayer, Tooltip } from 'react-leaflet'

import { EditorDireccion, type DireccionEditable } from '../componentes/EditorDireccion'
import { filtrarPorPalabras } from '../nucleo/buscarClientes'
import { supabase } from '../nucleo/supabase'

type ClienteConDirecciones = Cliente & { direcciones: Direccion[] }

/** Cuántas filas se traen por consulta. El resto se alcanza buscando. */
const VENTANA = 200

/** Alta, baja y modificación de la cartera de clientes. */
export function PaginaClientes({ rol, esAdmin }: { rol: RolUsuario; esAdmin: boolean }) {
  const cliente = useQueryClient()
  // El admin hace el ABM completo (alta, baja y editar cualquier campo).
  // Administración ve la ficha y puede PEDIR editar un cliente (ver
  // FichaClienteAdministracion); el supervisor sólo mira la lista. Alta, baja y
  // "+ Nuevo" quedan como estaban: sólo admin (soloLectura = todos menos admin).
  const soloLectura = !esAdmin
  const esAdministracion = rol === 'administracion'
  const [busqueda, setBusqueda] = useState('')
  const [editando, setEditando] = useState<ClienteConDirecciones | 'nuevo' | null>(null)
  const [mensaje, setMensaje] = useState<string | null>(null)

  // Debounce: la búsqueda es una consulta al servidor, no un filtro en memoria.
  const [termino, setTermino] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setTermino(busqueda.trim()), 300)
    return () => clearTimeout(t)
  }, [busqueda])

  const { data: total } = useQuery({
    queryKey: ['clientes-total'],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('clientes')
        .select('id', { count: 'exact', head: true })
      if (error) throw error
      return count ?? 0
    },
  })

  /**
   * La cartera son 16.496 clientes desde la depuración contra el listado del
   * Gestión del 03/09/2026.
   *
   * Antes esto bajaba la tabla entera y filtraba en el navegador. PostgREST
   * corta en 1.000 filas, así que el panel mostraba 1.000 de más de doce mil y el
   * buscador sólo encontraba lo que estuviera en ese primer millar por orden
   * alfabético: todo lo que empieza con una letra avanzada era invisible, sin
   * ningún cartel que lo dijera.
   */
  const { data: clientes, isLoading } = useQuery({
    queryKey: ['clientes', termino],
    queryFn: async () => {
      let consulta = supabase
        .from('clientes')
        .select('*, direcciones ( * )')
        .order('razon_social')
        .limit(VENTANA)

      if (termino) {
        // Palabra por palabra contra `busqueda_plana`, igual que el buscador del
        // teléfono: sin acentos, sin puntuación y en cualquier orden. El CUIT y
        // la localidad van aparte porque no entran en esa columna.
        consulta = filtrarPorPalabras(consulta, termino, ['cuit', 'localidad'])
      }

      const { data, error } = await consulta
      if (error) throw error
      return data as ClienteConDirecciones[]
    },
  })

  const { data: provisorios } = useQuery({
    queryKey: ['clientes-provisorios'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clientes')
        .select('*, direcciones ( * )')
        .eq('provisorio', true)
        .eq('activo', true)
        .order('razon_social')
        .limit(50)
      if (error) throw error
      return data as ClienteConDirecciones[]
    },
  })

  const { data: vendedores } = useQuery({
    queryKey: ['vendedores'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('perfiles')
        .select('id, nombre_completo, codigo_vendedor')
        .eq('rol', 'vendedor')
        .eq('estado', 'aprobado')
        .order('nombre_completo')
      if (error) throw error
      return data as Pick<Perfil, 'id' | 'nombre_completo' | 'codigo_vendedor'>[]
    },
  })

  const filtrados = clientes ?? []

  /**
   * Refresca TODO lo que mira esta pantalla.
   *
   * Invalidar sólo `['clientes']` dejaba viejas las otras dos consultas:
   * react-query compara las claves por prefijo y `['clientes-provisorios']` no
   * empieza con `'clientes'` —es otra cadena—, así que el cartel de "cargados
   * desde la calle" seguía nombrando al cliente cuya ficha se acababa de
   * completar, y el conteo del encabezado no se movía al dar de alta uno nuevo.
   */
  function refrescarClientes() {
    // `['clientes-en-mapa']` también: si no, el Mapa de clientes se quedaba con
    // el pin viejo (o sin pin) hasta 5 minutos después de geolocalizar acá, que
    // es parte de "cargué la dirección y no aparece".
    for (const clave of [
      ['clientes'],
      ['clientes-provisorios'],
      ['clientes-total'],
      ['clientes-en-mapa'],
    ]) {
      void cliente.invalidateQueries({ queryKey: clave })
    }
  }

  const alternarActivo = useMutation({
    mutationFn: async (c: Cliente) => {
      const { error } = await supabase.from('clientes').update({ activo: !c.activo }).eq('id', c.id)
      if (error) throw error
    },
    onSuccess: () => {
      setMensaje('Cliente actualizado.')
      refrescarClientes()
    },
  })

  // Habilitar / deshabilitar para la app móvil. Va por RPC (set_cliente_habilitado,
  // gateada a administración/admin) y no por un update directo: así el permiso lo
  // decide el servidor, igual que confirmar un provisorio. El vendedor sólo ve a
  // los habilitados; la oficina ve a todos igual, así que esto no cambia lo que
  // ve el panel —sólo lo que queda visible en el teléfono—.
  const alternarHabilitado = useMutation({
    mutationFn: async (c: Cliente) => {
      const { error } = await supabase.rpc('set_cliente_habilitado', {
        p_cliente_id: c.id,
        p_habilitado: !c.habilitado,
      })
      if (error) throw error
    },
    onSuccess: () => {
      setMensaje('Cliente actualizado.')
      refrescarClientes()
    },
    onError: (e: Error) => setMensaje(e.message),
  })

  return (
    <>
      <header className="encabezado-pagina">
        <div>
          <h1>Clientes</h1>
          <p>
            {total ?? '…'} clientes en la cartera
            {termino ? ` · ${filtrados.length} coinciden con "${termino}"` : ''}.
          </p>
        </div>
        <button className="primario" disabled={soloLectura} onClick={() => setEditando('nuevo')}>
          + Nuevo cliente
        </button>
      </header>

      {mensaje && <div className="aviso exito">{mensaje}</div>}

      {/* Los clientes que los vendedores cargan desde la calle nacen sin código
          real ni datos fiscales. Si no se muestran acá, quedan enterrados en el
          padrón y nadie los completa nunca. */}
      {esAdmin && provisorios && provisorios.length > 0 && (
        <div className="aviso atencion">
          <strong>
            {provisorios.length} cliente{provisorios.length === 1 ? '' : 's'} cargado
            {provisorios.length === 1 ? '' : 's'} desde la calle
          </strong>{' '}
          {provisorios.length === 1 ? 'espera' : 'esperan'} que le
          {provisorios.length === 1 ? '' : 's'} asignes el código definitivo y completes la ficha:{' '}
          {provisorios.map((c, i) => (
            <span key={c.id}>
              {i > 0 && ' · '}
              <button className="chico" onClick={() => setEditando(c)}>
                {c.razon_social}
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="tarjeta">
        <input
          placeholder="Buscar por código, razón social, nombre de fantasía o CUIT…"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          aria-label="Buscar clientes"
        />
      </div>

      <section className="tarjeta">
        {isLoading ? (
          <p>Cargando…</p>
        ) : filtrados.length === 0 ? (
          <p className="vacio">No hay clientes que coincidan.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Cliente Nº</th>
                <th>Razón social</th>
                <th>Contacto</th>
                <th>Vendedor</th>
                <th>Direcciones</th>
                <th>Estado</th>
                <th style={{ width: 250 }} />
              </tr>
            </thead>
            <tbody>
              {filtrados.map((c) => (
                <tr key={c.id}>
                  <td>
                    <code>{c.codigo}</code>
                    {c.provisorio && (
                      <>
                        <br />
                        <span className="pastilla ambar">PROVISORIO</span>
                      </>
                    )}
                  </td>
                  <td>
                    {c.razon_social}
                    {c.nombre_fantasia && (
                      <>
                        <br />
                        <small style={{ color: 'var(--tinta-tenue)' }}>{c.nombre_fantasia}</small>
                      </>
                    )}
                  </td>
                  <td>
                    {c.contacto_nombre ?? '—'}
                    {c.telefono && (
                      <>
                        <br />
                        <small style={{ color: 'var(--tinta-tenue)' }}>{c.telefono}</small>
                      </>
                    )}
                  </td>
                  <td>
                    {vendedores?.find((v) => v.id === c.vendedor_id)?.nombre_completo ?? 'Sin asignar'}
                  </td>
                  {/*
                    Son dos estados distintos y antes se veían igual. El padrón
                    importado tiene el domicilio escrito pero no geolocalizado:
                    decirle "Sin dirección" a un cliente cuya calle está ahí
                    abajo es falso, y esconde que lo que falta son coordenadas.
                  */}
                  <td>
                    {c.direcciones.length > 0 ? (
                      <>
                        <small>
                          {c.direcciones.find((d) => d.principal)?.direccion_formateada ??
                            c.direcciones[0].direccion_formateada}
                        </small>
                        {c.direcciones.filter((d) => !d.principal).length > 0 ? (
                          <>
                            <br />
                            <span className="pastilla gris">
                              +{c.direcciones.filter((d) => !d.principal).length} lugar
                              {c.direcciones.filter((d) => !d.principal).length === 1 ? '' : 'es'} de
                              entrega
                            </span>
                          </>
                        ) : null}
                      </>
                    ) : c.direccion ? (
                      <>
                        <small>{[c.direccion, c.localidad].filter(Boolean).join(', ')}</small>
                        <br />
                        <span className="pastilla ambar">Sin ubicar en el mapa</span>
                      </>
                    ) : (
                      <span className="pastilla roja">Sin dirección</span>
                    )}
                  </td>
                  <td>
                    <span className={`pastilla ${c.activo ? 'verde' : 'gris'}`}>
                      {c.activo ? 'Activo' : 'Inactivo'}
                    </span>
                    <br />
                    {/* Habilitado = lo ve el vendedor en el teléfono. Los no
                        habilitados siguen acá (la oficina los ve), pero no
                        aparecen en la app móvil para hacer notas ni en el mapa. */}
                    <span
                      className={`pastilla ${c.habilitado ? 'verde' : 'ambar'}`}
                      title={
                        c.habilitado
                          ? 'El vendedor lo ve en la app'
                          : 'Oculto en la app del vendedor (la oficina lo ve igual)'
                      }
                    >
                      {c.habilitado ? 'Habilitado' : 'No habilitado'}
                    </span>
                  </td>
                  <td>
                    <div className="acciones">
                      <button
                        className="chico"
                        disabled={!esAdmin && !esAdministracion}
                        onClick={() => setEditando(c)}
                      >
                        {esAdmin ? 'Editar' : 'Ver ficha'}
                      </button>
                      <button
                        className="chico"
                        disabled={soloLectura}
                        onClick={() => alternarActivo.mutate(c)}
                      >
                        {c.activo ? 'Dar de baja' : 'Reactivar'}
                      </button>
                      <button
                        className="chico"
                        disabled={(!esAdmin && !esAdministracion) || alternarHabilitado.isPending}
                        onClick={() => alternarHabilitado.mutate(c)}
                        title="Habilita o esconde este cliente en la app del vendedor"
                      >
                        {c.habilitado ? 'Deshabilitar' : 'Habilitar'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {editando &&
        (esAdmin ? (
          <FormularioCliente
            cliente={editando === 'nuevo' ? null : editando}
            vendedores={vendedores ?? []}
            alCerrar={() => setEditando(null)}
            alGuardar={() => {
              setEditando(null)
              setMensaje('Cliente guardado.')
              refrescarClientes()
            }}
          />
        ) : editando !== 'nuevo' ? (
          <FichaClienteAdministracion
            cliente={editando}
            vendedores={vendedores ?? []}
            alCerrar={() => setEditando(null)}
            alGuardar={() => {
              setEditando(null)
              setMensaje('Cliente editado.')
              refrescarClientes()
            }}
          />
        ) : null)}
    </>
  )
}

function FormularioCliente({
  cliente,
  vendedores,
  alCerrar,
  alGuardar,
}: {
  cliente: ClienteConDirecciones | null
  vendedores: Pick<Perfil, 'id' | 'nombre_completo' | 'codigo_vendedor'>[]
  alCerrar: () => void
  alGuardar: () => void
}) {
  const direcciones = cliente?.direcciones ?? []
  const principal = direcciones.find((d) => d.principal) ?? direcciones[0]
  const entregasExistentes = direcciones.filter((d) => d.id !== principal?.id)

  /**
   * El domicilio que trajo el listado del Gestión, cuando todavía no se ubicó.
   * Los clientes importados tienen la calle escrita en su ficha
   * (`clientes.direccion`) y ninguna fila en `direcciones` —ésa exige lat/lng—,
   * así que la dirección principal arranca con ese texto, sin punto todavía.
   */
  const domicilioDelPadron = [cliente?.direccion, cliente?.localidad].filter(Boolean).join(', ')
  const direccionPrincipalInicial = principal?.direccion_formateada ?? domicilioDelPadron

  const [form, setForm] = useState({
    codigo: cliente?.codigo ?? '',
    razon_social: cliente?.razon_social ?? '',
    nombre_fantasia: cliente?.nombre_fantasia ?? '',
    cuit: cliente?.cuit ?? '',
    telefono: cliente?.telefono ?? '',
    email: cliente?.email ?? '',
    contacto_nombre: cliente?.contacto_nombre ?? '',
    vendedor_id: cliente?.vendedor_id ?? '',
    notas: cliente?.notas ?? '',
  })

  // La dirección principal y los lugares de entrega, cada uno con su punto en el
  // mapa. La principal que ya estaba guardada viene confirmada; el texto del
  // padrón sin coordenadas, no.
  const [principalDir, setPrincipalDir] = useState<DireccionEditable>(() => ({
    id: principal?.id,
    etiqueta: 'Principal',
    direccion: direccionPrincipalInicial,
    codigo_postal: principal?.codigo_postal ?? cliente?.codigo_postal ?? '',
    lat: principal?.lat ?? null,
    lng: principal?.lng ?? null,
    google_place_id: principal?.google_place_id ?? null,
    confirmada: Boolean(principal),
  }))

  const [entregas, setEntregas] = useState<DireccionEditable[]>(() =>
    entregasExistentes.map((d) => ({
      id: d.id,
      etiqueta: d.etiqueta || 'Entrega',
      direccion: d.direccion_formateada,
      codigo_postal: d.codigo_postal ?? '',
      lat: d.lat,
      lng: d.lng,
      google_place_id: d.google_place_id ?? null,
      confirmada: true,
    })),
  )
  // Para borrar en la base las que se quitaron (las que ya tenían id).
  const [entregasAEliminar, setEntregasAEliminar] = useState<string[]>([])

  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  function actualizar(campo: keyof typeof form, valor: string) {
    setForm((f) => ({ ...f, [campo]: valor }))
  }

  function agregarEntrega() {
    setEntregas((e) => [
      ...e,
      {
        etiqueta: `Entrega ${e.length + 1}`,
        direccion: '',
        codigo_postal: '',
        lat: null,
        lng: null,
        google_place_id: null,
        confirmada: false,
      },
    ])
  }
  function cambiarEntrega(i: number, v: DireccionEditable) {
    setEntregas((e) => e.map((x, j) => (j === i ? v : x)))
  }
  function quitarEntrega(i: number) {
    setEntregas((e) => {
      const quitada = e[i]
      if (quitada.id) setEntregasAEliminar((prev) => [...prev, quitada.id!])
      return e.filter((_, j) => j !== i)
    })
  }

  // ¿Guardar la dirección principal? Si tiene punto, o ya era una dirección
  // guardada, o se cambió el texto del padrón. Abrir un cliente del padrón para
  // tocar otro dato no obliga a geolocalizar.
  const principalTienePunto = principalDir.lat !== null && principalDir.lng !== null
  const guardarPrincipal =
    principalTienePunto ||
    Boolean(principal) ||
    (principalDir.direccion.trim() !== '' &&
      principalDir.direccion.trim() !== direccionPrincipalInicial.trim())

  async function guardar(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!form.codigo.trim() || !form.razon_social.trim()) {
      setError('El código de cliente y la razón social son obligatorios.')
      return
    }

    // Una dirección que se quiere guardar necesita punto en el mapa (la ruta se
    // calcula sobre lat/lng, no sobre texto) y confirmación de que la calle y la
    // altura resueltas son las correctas.
    if (guardarPrincipal) {
      if (!principalTienePunto) {
        setError('Marcá en el mapa dónde queda la dirección principal (o usá "Usar mi ubicación actual").')
        return
      }
      if (!principalDir.confirmada) {
        setError('Confirmá la dirección principal: revisá la calle y la altura, y tildá la casilla.')
        return
      }
    }
    for (const [i, en] of entregas.entries()) {
      const nombre = en.etiqueta.trim() || `Entrega ${i + 1}`
      if (en.lat === null || en.lng === null) {
        setError(`Marcá en el mapa el lugar de entrega "${nombre}", o quitalo.`)
        return
      }
      if (!en.confirmada) {
        setError(`Confirmá el lugar de entrega "${nombre}": tildá la casilla.`)
        return
      }
    }

    setGuardando(true)
    try {
      const datos = {
        codigo: form.codigo.trim(),
        razon_social: form.razon_social.trim(),
        nombre_fantasia: form.nombre_fantasia.trim() || null,
        cuit: form.cuit.trim() || null,
        telefono: form.telefono.trim() || null,
        email: form.email.trim() || null,
        contacto_nombre: form.contacto_nombre.trim() || null,
        vendedor_id: form.vendedor_id || null,
        notas: form.notas.trim() || null,
        // Asignarle un código real es lo que da por completada la ficha que
        // arrancó el vendedor en la calle. Mientras conserve el `P-` automático
        // sigue apareciendo en el aviso de pendientes.
        provisorio: form.codigo.trim().toUpperCase().startsWith('P-'),
      }

      const { data: guardado, error: errCliente } = cliente
        ? await supabase.from('clientes').update(datos).eq('id', cliente.id).select('id').single()
        : await supabase.from('clientes').insert(datos).select('id').single()

      if (errCliente) throw errCliente
      const clienteId = guardado.id as string

      /** Fila de `direcciones` lista para insertar/actualizar. */
      function filaDireccion(d: DireccionEditable, esPrincipal: boolean) {
        return {
          cliente_id: clienteId,
          etiqueta: esPrincipal ? 'Principal' : d.etiqueta.trim() || 'Entrega',
          direccion_formateada: d.direccion.trim(),
          codigo_postal: d.codigo_postal.trim() || null,
          lat: d.lat as number,
          lng: d.lng as number,
          google_place_id: d.google_place_id,
          principal: esPrincipal,
          verificada: true,
        }
      }

      async function guardarFila(d: DireccionEditable, esPrincipal: boolean) {
        const fila = filaDireccion(d, esPrincipal)
        const { error: err } = d.id
          ? await supabase.from('direcciones').update(fila).eq('id', d.id)
          : await supabase.from('direcciones').insert(fila)
        if (err) throw err
      }

      // Las que se quitaron, primero: así se libera el único índice de principal
      // y no choca si alguna cambió de rol.
      if (entregasAEliminar.length > 0) {
        const { error: errDel } = await supabase
          .from('direcciones')
          .delete()
          .in('id', entregasAEliminar)
        if (errDel) throw errDel
      }

      if (guardarPrincipal) await guardarFila(principalDir, true)
      for (const en of entregas) await guardarFila(en, false)

      alGuardar()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.55)',
        display: 'grid',
        placeItems: 'center',
        zIndex: 50,
        padding: 20,
      }}
      onClick={alCerrar}
    >
      <form
        className="tarjeta"
        onClick={(e) => e.stopPropagation()}
        onSubmit={guardar}
        style={{ width: 'min(760px, 95vw)', maxHeight: '90vh', overflowY: 'auto', margin: 0 }}
      >
        <h2>{cliente ? 'Editar cliente' : 'Nuevo cliente'}</h2>

        {error && <div className="aviso error">{error}</div>}

        {cliente?.provisorio && (
          <div className="aviso atencion">
            Este cliente lo cargó un vendedor durante el recorrido. Cambiale el código
            <code> {cliente.codigo} </code> por el definitivo y completá los datos que falten; con
            eso deja de figurar como provisorio.
          </div>
        )}

        <div className="fila">
          <div className="campo">
            <label htmlFor="codigo">Cliente Nº *</label>
            <input id="codigo" value={form.codigo} onChange={(e) => actualizar('codigo', e.target.value)} />
          </div>
          <div className="campo" style={{ flex: 3 }}>
            <label htmlFor="razon">Razón social *</label>
            <input id="razon" value={form.razon_social} onChange={(e) => actualizar('razon_social', e.target.value)} />
          </div>
        </div>

        <div className="fila">
          <div className="campo">
            <label htmlFor="fantasia">Nombre de fantasía</label>
            <input id="fantasia" value={form.nombre_fantasia} onChange={(e) => actualizar('nombre_fantasia', e.target.value)} />
          </div>
          <div className="campo">
            <label htmlFor="cuit">CUIT</label>
            <input id="cuit" value={form.cuit} onChange={(e) => actualizar('cuit', e.target.value)} placeholder="30-12345678-9" />
          </div>
        </div>

        <div className="fila">
          <div className="campo">
            <label htmlFor="contacto">Contacto habitual</label>
            <input id="contacto" value={form.contacto_nombre} onChange={(e) => actualizar('contacto_nombre', e.target.value)} />
          </div>
          <div className="campo">
            <label htmlFor="telefono">Teléfono</label>
            <input id="telefono" value={form.telefono} onChange={(e) => actualizar('telefono', e.target.value)} />
          </div>
          <div className="campo">
            <label htmlFor="email">Correo</label>
            {/* type="text", no "email": este campo guarda varios correos (y a
                veces teléfonos/notas) separados por " ; ", como vino del
                Gestión. La validación nativa de email rechaza el " ; " y no
                dejaba guardar. */}
            <input id="email" type="text" value={form.email} onChange={(e) => actualizar('email', e.target.value)} />
          </div>
        </div>

        <div className="campo">
          <label htmlFor="vendedor">Vendedor a cargo</label>
          <select id="vendedor" value={form.vendedor_id} onChange={(e) => actualizar('vendedor_id', e.target.value)}>
            <option value="">Sin asignar</option>
            {vendedores.map((v) => (
              <option key={v.id} value={v.id}>
                {v.nombre_completo}
                {v.codigo_vendedor ? ` (#${v.codigo_vendedor})` : ''}
              </option>
            ))}
          </select>
        </div>

        <h2 style={{ marginTop: 20 }}>Dirección principal</h2>
        <p style={{ fontSize: 13, color: 'var(--tinta-suave, #888)', marginTop: -6 }}>
          Marcá el punto en el mapa (o usá tu ubicación actual): la calle y la altura aparecen solas
          para que las confirmes.
        </p>
        <EditorDireccion valor={principalDir} alCambiar={setPrincipalDir} esPrincipal />

        <h2 style={{ marginTop: 20 }}>Lugares de entrega</h2>
        <p style={{ fontSize: 13, color: 'var(--tinta-suave, #888)', marginTop: -6 }}>
          Otros domicilios a donde se entrega, además de la dirección principal. Cada uno con su
          punto en el mapa.
        </p>
        {entregas.map((en, i) => (
          <EditorDireccion
            key={en.id ?? `nueva-${i}`}
            valor={en}
            alCambiar={(v) => cambiarEntrega(i, v)}
            alQuitar={() => quitarEntrega(i)}
            esPrincipal={false}
          />
        ))}
        <button type="button" onClick={agregarEntrega}>
          ➕ Agregar lugar de entrega
        </button>

        <div className="campo">
          <label htmlFor="notas">Notas</label>
          <textarea id="notas" rows={3} value={form.notas} onChange={(e) => actualizar('notas', e.target.value)} />
        </div>

        <div className="acciones" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
          <button type="button" onClick={alCerrar}>
            Cancelar
          </button>
          <button type="submit" className="primario" disabled={guardando}>
            {guardando ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </form>
    </div>
  )
}

interface PermisoEdicion {
  id: string
  estado: 'pendiente' | 'aprobado' | 'rechazado' | 'usado' | 'vencido'
  motivo: string | null
  vence_en: string | null
  motivo_rechazo: string | null
}

/**
 * Pin dibujado a mano: el icono por defecto de Leaflet apunta a imágenes que el
 * empaquetador no resuelve y salen rotas (mismo truco que en CambiosDireccion).
 */
const ICONO_UBICACION = L.divIcon({
  className: '',
  html: '<div style="width:18px;height:18px;border-radius:50% 50% 50% 0;background:#B30F0F;border:2px solid #fff;transform:rotate(-45deg);box-shadow:0 1px 4px rgba(0,0,0,.45)"></div>',
  iconSize: [18, 18],
  iconAnchor: [9, 18],
})

/** Un mapa chico, de sólo lectura, con el pin de la ubicación del cliente. */
function MapaUbicacion({ lat, lng, etiqueta }: { lat: number; lng: number; etiqueta: string }) {
  return (
    <div style={{ height: 220, borderRadius: 8, overflow: 'hidden', margin: '6px 0' }}>
      <MapContainer center={[lat, lng]} zoom={16} style={{ height: '100%', width: '100%' }} scrollWheelZoom={false}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Marker position={[lat, lng]} icon={ICONO_UBICACION}>
          <Tooltip>{etiqueta}</Tooltip>
        </Marker>
      </MapContainer>
    </div>
  )
}

function fechaHora(iso: string): string {
  return new Date(iso).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })
}

/**
 * La ficha del cliente para ADMINISTRACIÓN: ve los datos y, si necesita
 * corregir algo, pide permiso ("Permitir editar"). El pedido le llega al admin
 * (pantalla "Ediciones de clientes"); cuando lo aprueba, los campos se abren y
 * administración edita este cliente UNA vez (el guardado va por la RPC
 * `editar_cliente_con_permiso`, que consume el permiso). El código, el vendedor
 * y la dirección no se editan por acá: son del admin / del flujo de cambios de
 * dirección, así que van de referencia, en gris.
 */
function FichaClienteAdministracion({
  cliente,
  vendedores,
  alCerrar,
  alGuardar,
}: {
  cliente: ClienteConDirecciones
  vendedores: Pick<Perfil, 'id' | 'nombre_completo' | 'codigo_vendedor'>[]
  alCerrar: () => void
  alGuardar: () => void
}) {
  const qc = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [motivo, setMotivo] = useState('')
  const [form, setForm] = useState({
    razon_social: cliente.razon_social ?? '',
    nombre_fantasia: cliente.nombre_fantasia ?? '',
    cuit: cliente.cuit ?? '',
    telefono: cliente.telefono ?? '',
    email: cliente.email ?? '',
    contacto_nombre: cliente.contacto_nombre ?? '',
    notas: cliente.notas ?? '',
  })

  const { data: permiso } = useQuery({
    queryKey: ['permiso-edicion', cliente.id],
    queryFn: async () => {
      // La RLS ya devuelve sólo los pedidos propios: el último de este cliente
      // dice en qué estado está (pendiente / aprobado / usado / rechazado).
      const { data, error: err } = await supabase
        .from('permisos_edicion_cliente')
        .select('id, estado, motivo, vence_en, motivo_rechazo')
        .eq('cliente_id', cliente.id)
        .order('creado_en', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (err) throw err
      return (data as PermisoEdicion | null) ?? null
    },
  })

  const editable =
    permiso?.estado === 'aprobado' &&
    (!permiso.vence_en || new Date(permiso.vence_en).getTime() > Date.now())
  const pendiente = permiso?.estado === 'pendiente'

  function actualizar(campo: keyof typeof form, valor: string) {
    setForm((f) => ({ ...f, [campo]: valor }))
  }

  const pedir = useMutation({
    mutationFn: async () => {
      const { error: err } = await supabase.rpc('solicitar_edicion_cliente', {
        p_cliente_id: cliente.id,
        p_motivo: motivo.trim() || null,
      })
      if (err) throw err
    },
    onSuccess: () => {
      setError(null)
      void qc.invalidateQueries({ queryKey: ['permiso-edicion', cliente.id] })
      void qc.invalidateQueries({ queryKey: ['permisos-edicion-pendientes'] })
    },
    onError: (e: Error) => setError(e.message),
  })

  const guardar = useMutation({
    mutationFn: async () => {
      if (!form.razon_social.trim()) throw new Error('La razón social no puede quedar vacía.')
      const { error: err } = await supabase.rpc('editar_cliente_con_permiso', {
        p_cliente_id: cliente.id,
        p_razon_social: form.razon_social.trim(),
        p_nombre_fantasia: form.nombre_fantasia.trim() || null,
        p_cuit: form.cuit.trim() || null,
        p_telefono: form.telefono.trim() || null,
        p_email: form.email.trim() || null,
        p_contacto_nombre: form.contacto_nombre.trim() || null,
        p_notas: form.notas.trim() || null,
      })
      if (err) throw err
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['permisos-edicion-pendientes'] })
      alGuardar()
    },
    onError: (e: Error) => setError(e.message),
  })

  const vendedor = vendedores.find((v) => v.id === cliente.vendedor_id)
  const principal = cliente.direcciones?.find((d) => d.principal) ?? cliente.direcciones?.[0]
  const direccionTexto =
    principal?.direccion_formateada ||
    [cliente.direccion, cliente.localidad].filter(Boolean).join(', ') ||
    '—'

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.55)',
        display: 'grid',
        placeItems: 'center',
        zIndex: 50,
        padding: 20,
      }}
      onClick={alCerrar}
    >
      <form
        className="tarjeta"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault()
          if (editable) guardar.mutate()
        }}
        style={{ width: 'min(760px, 95vw)', maxHeight: '90vh', overflowY: 'auto', margin: 0 }}
      >
        <h2>Ficha del cliente</h2>

        {error && <div className="aviso error">{error}</div>}

        {editable ? (
          <div className="aviso exito">
            Un administrador te habilitó a editar este cliente
            {permiso?.vence_en ? ` (vence ${fechaHora(permiso.vence_en)})` : ''}. Hacé los cambios y
            guardá: es de un solo uso.
          </div>
        ) : pendiente ? (
          <div className="aviso atencion">
            Pediste permiso para editar este cliente. Esperá a que un administrador lo apruebe; cuando
            esté, vas a poder editarlo desde acá.
          </div>
        ) : (
          <div className="aviso">
            {permiso?.estado === 'rechazado'
              ? `Tu último pedido fue rechazado${permiso.motivo_rechazo ? `: ${permiso.motivo_rechazo}` : ''}. Podés volver a pedir.`
              : permiso?.estado === 'usado'
                ? 'Ya editaste este cliente con el último permiso. Si necesitás otro cambio, pedí de nuevo.'
                : 'Para corregir un dato, pedí permiso: un administrador lo aprueba y te habilita a editar este cliente.'}
            <div style={{ marginTop: 10 }}>
              <label htmlFor="motivo-edicion" style={{ fontSize: 13 }}>
                Qué querés corregir (opcional)
              </label>
              <textarea
                id="motivo-edicion"
                rows={2}
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Ej.: el teléfono está mal, es 0351-…"
                style={{ width: '100%', marginTop: 4 }}
              />
              <button
                type="button"
                className="primario"
                disabled={pedir.isPending}
                onClick={() => pedir.mutate()}
                style={{ marginTop: 8 }}
              >
                {pedir.isPending ? 'Enviando…' : 'Permitir editar'}
              </button>
            </div>
          </div>
        )}

        <div className="fila">
          <div className="campo">
            <label>Cliente Nº</label>
            <input value={cliente.codigo} disabled />
          </div>
          <div className="campo" style={{ flex: 3 }}>
            <label htmlFor="f-razon">Razón social</label>
            <input id="f-razon" value={form.razon_social} disabled={!editable} onChange={(e) => actualizar('razon_social', e.target.value)} />
          </div>
        </div>

        <div className="fila">
          <div className="campo">
            <label htmlFor="f-fantasia">Nombre de fantasía</label>
            <input id="f-fantasia" value={form.nombre_fantasia} disabled={!editable} onChange={(e) => actualizar('nombre_fantasia', e.target.value)} />
          </div>
          <div className="campo">
            <label htmlFor="f-cuit">CUIT</label>
            <input id="f-cuit" value={form.cuit} disabled={!editable} onChange={(e) => actualizar('cuit', e.target.value)} placeholder="30-12345678-9" />
          </div>
        </div>

        <div className="fila">
          <div className="campo">
            <label htmlFor="f-contacto">Contacto habitual</label>
            <input id="f-contacto" value={form.contacto_nombre} disabled={!editable} onChange={(e) => actualizar('contacto_nombre', e.target.value)} />
          </div>
          <div className="campo">
            <label htmlFor="f-tel">Teléfono</label>
            <input id="f-tel" value={form.telefono} disabled={!editable} onChange={(e) => actualizar('telefono', e.target.value)} />
          </div>
          <div className="campo">
            <label htmlFor="f-email">Correo</label>
            {/* type="text", no "email": el campo guarda varios correos (y a
                veces teléfonos/notas) separados por " ; "; la validación nativa
                de email rechazaba el " ; " y no dejaba guardar la ficha. */}
            <input id="f-email" type="text" value={form.email} disabled={!editable} onChange={(e) => actualizar('email', e.target.value)} />
          </div>
        </div>

        <div className="campo">
          <label>Vendedor a cargo</label>
          <input
            value={vendedor ? `${vendedor.nombre_completo}${vendedor.codigo_vendedor ? ` (#${vendedor.codigo_vendedor})` : ''}` : 'Sin asignar'}
            disabled
          />
        </div>
        <div className="campo">
          <label>Dirección principal</label>
          <input value={direccionTexto} disabled />
          {principal && principal.lat != null && principal.lng != null ? (
            <MapaUbicacion lat={principal.lat} lng={principal.lng} etiqueta={cliente.razon_social} />
          ) : (
            <div className="aviso atencion" style={{ marginTop: 6, fontSize: 13 }}>
              Este cliente todavía no tiene ubicación en el mapa.
            </div>
          )}
          <small style={{ color: 'var(--tinta-suave)' }}>
            La dirección se corrige por “Cambios de dirección”, no desde acá.
          </small>
        </div>

        <div className="campo">
          <label htmlFor="f-notas">Notas</label>
          <textarea id="f-notas" rows={3} value={form.notas} disabled={!editable} onChange={(e) => actualizar('notas', e.target.value)} />
        </div>

        <div className="acciones" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
          <button type="button" onClick={alCerrar}>
            Cerrar
          </button>
          {editable ? (
            <button type="submit" className="primario" disabled={guardar.isPending}>
              {guardar.isPending ? 'Guardando…' : 'Guardar cambios'}
            </button>
          ) : null}
        </div>
      </form>
    </div>
  )
}
