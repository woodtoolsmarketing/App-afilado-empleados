import {
  ETIQUETA_ESTADO_NOTA,
  ETIQUETA_TIPO_NOTA,
  ETIQUETA_TIPO_SERVICIO,
  type ClienteBuscado,
  type EstadoNotaPedido,
  type TipoNotaPedido,
  type TipoServicio,
} from '@woodtools/compartido'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'

import { usarConsola } from '../nucleo/consola'
import { supabase } from '../nucleo/supabase'

/**
 * Notas de pedido de todos los vendedores.
 *
 * El trabajo real de esta pantalla es una cosa: las notas que quedaron sin
 * número porque el cliente todavía no existe en el sistema. Van arriba de todo
 * y con el botón "Dar Cod. Cliente" a mano, porque cada una es una venta hecha
 * que todavía no se puede facturar.
 */

interface NotaFila {
  id: string
  numero: number | null
  tipo_nota: TipoNotaPedido | null
  estado: EstadoNotaPedido
  cliente_id: string | null
  cliente_codigo: string | null
  cliente_nombre: string
  cliente_cuit: string | null
  zona: string | null
  servicios: TipoServicio[]
  total: number | null
  creado_en: string
  vendedor: { nombre_completo: string; codigo_vendedor: string | null } | null
}

/**
 * Dónde se emitió la nota. Sólo aparece si la consola lo destrabó.
 *
 * La consulta se hace por nota y recién cuando hace falta, no en la lista: si
 * viajara con las notas, el dato estaría en el navegador de cualquiera que abra
 * la página, y esconderlo en pantalla no lo escondería.
 *
 * Del otro lado hay una función que exige un permiso por usuario. Si el que
 * mira no lo tiene, contesta 42501 y acá no se muestra nada — el desbloqueo de
 * la consola no alcanza por sí solo, y es a propósito.
 */
function DondeSeHizo({ notaId }: { notaId: string }) {
  const { data, isPending, isError } = useQuery({
    queryKey: ['donde-se-hizo', notaId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('ubicacion_de_nota', { p_nota_id: notaId })
      if (error) throw error
      const fila = (data ?? [])[0] as { veredicto: string; metros: number | null } | undefined
      return fila ?? null
    },
    retry: false,
  })

  if (isPending) return <div className="donde-se-hizo">Consultando…</div>
  if (isError || !data) return null

  return (
    <div className="donde-se-hizo">
      <strong>{data.veredicto}</strong>
      {data.metros !== null ? ` · a ${data.metros} m del cliente` : ''}
    </div>
  )
}

export function PaginaNotasPedido({ soloLectura }: { soloLectura: boolean }) {
  const consola = usarConsola()
  const cliente = useQueryClient()
  const [filtro, setFiltro] = useState<'todas' | 'sin_cliente' | 'pendientes'>('sin_cliente')
  const [busqueda, setBusqueda] = useState('')
  const [asignando, setAsignando] = useState<NotaFila | null>(null)
  const [mensaje, setMensaje] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { data: notas, isLoading } = useQuery({
    queryKey: ['notas-pedido-panel'],
    queryFn: async () => {
      const { data, error: err } = await supabase
        .from('notas_pedido')
        .select(
          'id, numero, tipo_nota, estado, cliente_id, cliente_codigo, cliente_nombre, cliente_cuit, zona, servicios, total, creado_en, vendedor:perfiles!notas_pedido_vendedor_id_fkey(nombre_completo, codigo_vendedor)',
        )
        .order('creado_en', { ascending: false })
        .limit(500)
      if (err) throw err
      return (data ?? []) as unknown as NotaFila[]
    },
    refetchInterval: 30_000,
  })

  const todas = notas ?? []
  const sinCliente = useMemo(
    () => todas.filter((n) => n.estado === 'pendiente_cliente'),
    [todas],
  )

  const visibles = useMemo(() => {
    let base = todas
    if (filtro === 'sin_cliente') base = sinCliente
    if (filtro === 'pendientes') base = todas.filter((n) => n.estado === 'pendiente')

    const t = busqueda.trim().toLowerCase()
    if (!t) return base
    return base.filter((n) =>
      `${n.numero ?? ''} ${n.cliente_codigo ?? ''} ${n.cliente_nombre} ${n.cliente_cuit ?? ''} ${n.vendedor?.nombre_completo ?? ''}`
        .toLowerCase()
        .includes(t),
    )
  }, [todas, sinCliente, filtro, busqueda])

  const asignar = useMutation({
    mutationFn: async (p: { notaId: string; clienteId: string }) => {
      const { error: err } = await supabase.rpc('asignar_cliente_a_nota', {
        p_nota_id: p.notaId,
        p_cliente_id: p.clienteId,
      })
      if (err) throw err
    },
    onSuccess: () => {
      setError(null)
      setMensaje('Cliente asignado. La nota ya tiene número y el vendedor la ve actualizada.')
      setAsignando(null)
      void cliente.invalidateQueries({ queryKey: ['notas-pedido-panel'] })
    },
    onError: (e: Error) => {
      setMensaje(null)
      setError(e.message)
    },
  })

  return (
    <>
      <header className="encabezado-pagina">
        <div>
          <h1>Notas de pedido</h1>
          <p>
            {sinCliente.length > 0
              ? `${sinCliente.length} esperan que les asignes el código de cliente.`
              : 'Todas las notas tienen su código de cliente asignado.'}
          </p>
        </div>
      </header>

      {mensaje && <div className="aviso exito">{mensaje}</div>}
      {error && (
        <div className="aviso error" role="alert">
          {error}
        </div>
      )}
      {soloLectura && (
        <div className="aviso atencion">
          Estás como supervisor: podés ver las notas, pero los códigos de cliente los asigna
          Administración.
        </div>
      )}

      {sinCliente.length > 0 && filtro !== 'sin_cliente' && (
        <div className="aviso atencion">
          Hay <strong>{sinCliente.length}</strong> notas sin número.{' '}
          <button className="chico" onClick={() => setFiltro('sin_cliente')}>
            Verlas
          </button>
        </div>
      )}

      <div className="tarjeta">
        <div className="fila">
          <div className="campo" style={{ marginBottom: 0, flex: 2 }}>
            <label htmlFor="buscar">Buscar</label>
            <input
              id="buscar"
              placeholder="Número, cliente, CUIT o vendedor…"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
            />
          </div>
          <div className="campo" style={{ marginBottom: 0 }}>
            <label htmlFor="filtro">Mostrar</label>
            <select
              id="filtro"
              value={filtro}
              onChange={(e) => setFiltro(e.target.value as typeof filtro)}
            >
              <option value="sin_cliente">Sin código de cliente ({sinCliente.length})</option>
              <option value="pendientes">Pendientes de imprimir</option>
              <option value="todas">Todas</option>
            </select>
          </div>
        </div>
      </div>

      <section className="tarjeta">
        {isLoading ? (
          <p>Cargando…</p>
        ) : visibles.length === 0 ? (
          <p className="vacio">
            {filtro === 'sin_cliente'
              ? 'No hay notas esperando código de cliente.'
              : 'No hay notas que coincidan.'}
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th style={{ width: 110 }}>Nº</th>
                <th>Cliente</th>
                <th style={{ width: 150 }}>Vendedor</th>
                <th style={{ width: 150 }}>Servicios</th>
                <th style={{ width: 110 }}>Estado</th>
                <th style={{ width: 110 }}>Total</th>
                <th style={{ width: 150 }}>Emitida</th>
                <th style={{ width: 150 }} />
              </tr>
            </thead>
            <tbody>
              {visibles.map((n) => (
                <tr key={n.id}>
                  <td>
                    {n.numero === null ? (
                      // Sin código de cliente todavía no es un comprobante.
                      <span style={{ color: 'var(--tinta-tenue)' }}>
                        — — —<br />
                        <small>(Pendiente)</small>
                      </span>
                    ) : (
                      <code>{String(n.numero).padStart(6, '0')}</code>
                    )}
                  </td>
                  <td>
                    {n.cliente_nombre}
                    {n.cliente_codigo && (
                      <>
                        <br />
                        <small style={{ color: 'var(--tinta-tenue)' }}>
                          Cliente Nº {n.cliente_codigo}
                        </small>
                      </>
                    )}
                    {consola.destrabado('ubicacion-de-notas') ? <DondeSeHizo notaId={n.id} /> : null}
                    {n.cliente_cuit && !n.cliente_codigo && (
                      <>
                        <br />
                        <small style={{ color: 'var(--tinta-tenue)' }}>CUIT {n.cliente_cuit}</small>
                      </>
                    )}
                  </td>
                  <td>
                    <small>
                      {n.vendedor?.nombre_completo ?? '—'}
                      {n.vendedor?.codigo_vendedor ? ` (#${n.vendedor.codigo_vendedor})` : ''}
                    </small>
                  </td>
                  <td>
                    {(n.servicios ?? []).map((s) => (
                      <span key={s} className="pastilla gris" style={{ marginRight: 3 }}>
                        {ETIQUETA_TIPO_SERVICIO[s]}
                      </span>
                    ))}
                  </td>
                  <td>
                    <span className={`pastilla ${claseEstado(n.estado)}`}>
                      {ETIQUETA_ESTADO_NOTA[n.estado]}
                    </span>
                    {n.tipo_nota && (
                      <>
                        <br />
                        <small>{ETIQUETA_TIPO_NOTA[n.tipo_nota]}</small>
                      </>
                    )}
                  </td>
                  <td>
                    {n.total
                      ? `$ ${Number(n.total).toLocaleString('es-AR', { minimumFractionDigits: 2 })}`
                      : '—'}
                  </td>
                  <td>
                    <small>
                      {new Date(n.creado_en).toLocaleString('es-AR', {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      })}
                    </small>
                  </td>
                  <td>
                    {n.estado === 'pendiente_cliente' ? (
                      <button
                        className="primario chico"
                        disabled={soloLectura}
                        onClick={() => {
                          setAsignando(n)
                          setError(null)
                        }}
                      >
                        Dar Cod. Cliente
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {asignando && (
        <DialogoAsignarCliente
          nota={asignando}
          guardando={asignar.isPending}
          alCerrar={() => setAsignando(null)}
          alElegir={(clienteId) => asignar.mutate({ notaId: asignando.id, clienteId })}
        />
      )}
    </>
  )
}

/**
 * Buscador para asignarle un cliente a la nota.
 *
 * Los clientes provisorios aparecen pero no se pueden elegir: asignar uno
 * dejaría un código automático (`P-000123`) en un comprobante. Primero hay que
 * completarle la ficha desde Clientes.
 */
function DialogoAsignarCliente({
  nota,
  guardando,
  alCerrar,
  alElegir,
}: {
  nota: NotaFila
  guardando: boolean
  alCerrar: () => void
  alElegir: (clienteId: string) => void
}) {
  // Arranca buscando por lo que el vendedor escribió: casi siempre alcanza.
  const [texto, setTexto] = useState(nota.cliente_cuit || nota.cliente_nombre)
  const [resultados, setResultados] = useState<ClienteBuscado[]>([])
  const [buscando, setBuscando] = useState(false)

  useEffect(() => {
    const id = setTimeout(async () => {
      if (texto.trim().length < 2) {
        setResultados([])
        return
      }
      setBuscando(true)
      const { data } = await supabase.rpc('buscar_clientes', { p_texto: texto, p_limite: 20 })
      setResultados((data ?? []) as ClienteBuscado[])
      setBuscando(false)
    }, 300)
    return () => clearTimeout(id)
  }, [texto])

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
      <div
        className="tarjeta"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(760px, 95vw)', maxHeight: '90vh', overflowY: 'auto', margin: 0 }}
      >
        <h2>Asignar código de cliente</h2>

        <div className="aviso">
          La nota la cargó <strong>{nota.vendedor?.nombre_completo ?? 'un vendedor'}</strong> a
          nombre de <strong>{nota.cliente_nombre}</strong>
          {nota.cliente_cuit ? ` (CUIT ${nota.cliente_cuit})` : ''}
          {nota.zona ? `, zona ${nota.zona}` : ''}. Al asignarle el cliente, la nota recibe su
          número.
        </div>

        <div className="campo">
          <label htmlFor="buscar-cliente">Buscar por código, nombre o CUIT</label>
          <input
            id="buscar-cliente"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            autoFocus
          />
        </div>

        {buscando && <p>Buscando…</p>}

        {!buscando && resultados.length === 0 && texto.trim().length >= 2 && (
          <div className="aviso atencion">
            No aparece ningún cliente. Cargalo primero desde <strong>Clientes</strong> y volvé acá.
          </div>
        )}

        {resultados.length > 0 && (
          <table>
            <thead>
              <tr>
                <th style={{ width: 110 }}>Código</th>
                <th>Razón social</th>
                <th style={{ width: 140 }}>CUIT</th>
                <th style={{ width: 120 }} />
              </tr>
            </thead>
            <tbody>
              {resultados.map((c) => (
                <tr key={c.cliente_id}>
                  <td>
                    <code>{c.codigo}</code>
                    {c.provisorio && (
                      <>
                        <br />
                        <span className="pastilla ambar">PROVISORIO</span>
                      </>
                    )}
                  </td>
                  <td>{c.razon_social}</td>
                  <td>
                    <small>{c.cuit ?? '—'}</small>
                  </td>
                  <td>
                    <button
                      className="primario chico"
                      disabled={guardando || c.provisorio}
                      title={
                        c.provisorio
                          ? 'Completá primero su código definitivo desde Clientes'
                          : undefined
                      }
                      onClick={() => alElegir(c.cliente_id)}
                    >
                      Asignar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="acciones" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
          <button onClick={alCerrar}>Cancelar</button>
        </div>
      </div>
    </div>
  )
}

function claseEstado(estado: EstadoNotaPedido): string {
  switch (estado) {
    case 'pendiente_cliente':
      return 'ambar'
    case 'impresa':
      return 'azul'
    case 'entregada':
      return 'verde'
    case 'anulada':
      return 'roja'
    default:
      return 'gris'
  }
}
