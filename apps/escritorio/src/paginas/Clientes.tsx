import type { Cliente, Direccion, Perfil } from '@woodtools/compartido'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { filtrarPorPalabras } from '../nucleo/buscarClientes'
import { supabase } from '../nucleo/supabase'

type ClienteConDirecciones = Cliente & { direcciones: Direccion[] }

/** Cuántas filas se traen por consulta. El resto se alcanza buscando. */
const VENTANA = 200

/** Alta, baja y modificación de la cartera de clientes. */
export function PaginaClientes({ soloLectura }: { soloLectura: boolean }) {
  const cliente = useQueryClient()
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
   * La cartera son 12.181 clientes desde que se importó el padrón del Gestión.
   *
   * Antes esto bajaba la tabla entera y filtraba en el navegador. PostgREST
   * corta en 1.000 filas, así que el panel mostraba 1.000 de 12.181 y el
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
    for (const clave of [['clientes'], ['clientes-provisorios'], ['clientes-total']]) {
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
      {provisorios && provisorios.length > 0 && (
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
                <th style={{ width: 170 }} />
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
                      <small>
                        {c.direcciones.find((d) => d.principal)?.direccion_formateada ??
                          c.direcciones[0].direccion_formateada}
                      </small>
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
                  </td>
                  <td>
                    <div className="acciones">
                      <button className="chico" disabled={soloLectura} onClick={() => setEditando(c)}>
                        Editar
                      </button>
                      <button
                        className="chico"
                        disabled={soloLectura}
                        onClick={() => alternarActivo.mutate(c)}
                      >
                        {c.activo ? 'Dar de baja' : 'Reactivar'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {editando && (
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
      )}
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
  const principal = cliente?.direcciones.find((d) => d.principal) ?? cliente?.direcciones[0]

  /**
   * El domicilio que trajo el listado del Gestión, cuando todavía no se ubicó.
   *
   * Son dos lugares distintos: los clientes importados tienen la calle escrita
   * en su ficha (`clientes.direccion`) y ninguna fila en `direcciones`, porque
   * ésa exige lat/lng. El formulario leía sólo la segunda, así que la ficha se
   * abría con la dirección en blanco — justo la del cliente que la tabla de al
   * lado estaba mostrando con el cartel "Sin ubicar en el mapa", que es el que
   * alguien abre para completarlo.
   */
  const domicilioDelPadron = [cliente?.direccion, cliente?.localidad].filter(Boolean).join(', ')

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
    direccion: principal?.direccion_formateada ?? domicilioDelPadron,
    codigo_postal: principal?.codigo_postal ?? cliente?.codigo_postal ?? '',
    lat: principal?.lat?.toString() ?? '',
    lng: principal?.lng?.toString() ?? '',
  })
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  function actualizar(campo: keyof typeof form, valor: string) {
    setForm((f) => ({ ...f, [campo]: valor }))
  }

  /**
   * Una coordenada tipeada acá, como número.
   *
   * Se acepta la coma: en Argentina el separador decimal es la coma y el
   * teclado la ofrece primero, así que "-34,6037" es lo que sale naturalmente.
   * Sin esto `Number()` daba `NaN`, el insert viajaba con la columna en null y
   * lo que aparecía en pantalla era un error crudo de Postgres sobre una
   * restricción `not null` — que no le dice a nadie que lo que pasó fue una
   * coma.
   */
  function aCoordenada(texto: string): number {
    return Number(texto.trim().replace(',', '.'))
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!form.codigo.trim() || !form.razon_social.trim()) {
      setError('El código de cliente y la razón social son obligatorios.')
      return
    }
    // Sin coordenadas el cliente no se puede meter en un recorrido: la ruta se
    // calcula sobre lat/lng, no sobre texto.
    if (form.direccion.trim()) {
      if (!form.lat.trim() || !form.lng.trim()) {
        setError('Si cargás una dirección, poné también la latitud y la longitud.')
        return
      }
      if (!Number.isFinite(aCoordenada(form.lat)) || !Number.isFinite(aCoordenada(form.lng))) {
        setError('La latitud y la longitud tienen que ser números. Ej. -34,6037 y -58,3816.')
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

      if (form.direccion.trim()) {
        const datosDireccion = {
          cliente_id: guardado.id,
          direccion_formateada: form.direccion.trim(),
          codigo_postal: form.codigo_postal.trim() || null,
          lat: aCoordenada(form.lat),
          lng: aCoordenada(form.lng),
          principal: true,
          etiqueta: 'Principal',
        }

        const { error: errDireccion } = principal
          ? await supabase.from('direcciones').update(datosDireccion).eq('id', principal.id)
          : await supabase.from('direcciones').insert(datosDireccion)

        if (errDireccion) throw errDireccion
      }

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
            <input id="email" type="email" value={form.email} onChange={(e) => actualizar('email', e.target.value)} />
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

        <div className="campo">
          <label htmlFor="direccion">Dirección</label>
          <input id="direccion" value={form.direccion} onChange={(e) => actualizar('direccion', e.target.value)} />
        </div>

        <div className="fila">
          <div className="campo">
            <label htmlFor="cp">Código postal</label>
            <input id="cp" value={form.codigo_postal} onChange={(e) => actualizar('codigo_postal', e.target.value)} />
          </div>
          <div className="campo">
            <label htmlFor="lat">Latitud</label>
            <input id="lat" value={form.lat} onChange={(e) => actualizar('lat', e.target.value)} placeholder="-34,6037" />
          </div>
          <div className="campo">
            <label htmlFor="lng">Longitud</label>
            <input id="lng" value={form.lng} onChange={(e) => actualizar('lng', e.target.value)} placeholder="-58,3816" />
          </div>
        </div>

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
