import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'

import { supabase } from '../nucleo/supabase'

/**
 * Artículos del catálogo que la app no puede cotizar.
 *
 * Son dos casos, y conviene distinguirlos porque se arreglan distinto:
 *
 *  · **Precio 0,00** — la lista los trae así (discontinuados o "a consultar").
 *  · **Sin moneda declarada** — el PDF no dice si está en pesos o en dólares.
 *    Es el caso de MUELAS: tiene precio, pero cotizarlo sin saber la moneda
 *    puede errar por un factor de mil.
 *
 * Mientras estén acá, el vendedor no los ve en el buscador. Es a propósito:
 * preferimos que falte un artículo a que salga un precio inventado en una nota
 * de pedido.
 */

interface ArticuloPendiente {
  codigo: string
  descripcion: string
  medida: string | null
  precio: number
  moneda: 'ARS' | 'USD' | null
  familia: string | null
  lista_origen: string
  lista_fecha: string
  motivo: string
}

export function PaginaArticulosAConfirmar({ soloLectura }: { soloLectura: boolean }) {
  const cliente = useQueryClient()
  const [busqueda, setBusqueda] = useState('')
  const [mensaje, setMensaje] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { data: articulos, isLoading } = useQuery({
    queryKey: ['articulos-a-confirmar'],
    queryFn: async () => {
      const { data, error: err } = await supabase.rpc('articulos_a_confirmar')
      if (err) throw err
      return (data ?? []) as ArticuloPendiente[]
    },
  })

  const completar = useMutation({
    mutationFn: async (p: { codigo: string; precio: number; moneda: string }) => {
      const { error: err } = await supabase.rpc('completar_articulo', {
        p_codigo: p.codigo,
        p_precio: p.precio,
        p_moneda: p.moneda,
      })
      if (err) throw err
    },
    onSuccess: (_d, v) => {
      setError(null)
      setMensaje(`${v.codigo} quedó cotizable. Ya lo pueden usar los vendedores.`)
      void cliente.invalidateQueries({ queryKey: ['articulos-a-confirmar'] })
    },
    onError: (e: Error) => {
      setMensaje(null)
      setError(e.message)
    },
  })

  const todos = articulos ?? []

  const filtrados = useMemo(() => {
    const t = busqueda.trim().toLowerCase()
    if (!t) return todos
    return todos.filter((a) =>
      `${a.codigo} ${a.descripcion} ${a.familia ?? ''}`.toLowerCase().includes(t),
    )
  }, [todos, busqueda])

  const porMotivo = useMemo(() => {
    const m = new Map<string, number>()
    for (const a of todos) m.set(a.motivo, (m.get(a.motivo) ?? 0) + 1)
    return [...m.entries()]
  }, [todos])

  return (
    <>
      <header className="encabezado-pagina">
        <div>
          <h1>Artículos a confirmar</h1>
          <p>
            {todos.length === 0
              ? 'Todos los artículos del catálogo se pueden cotizar.'
              : `${todos.length} artículos que los vendedores no ven hasta que les completes el precio.`}
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
          Estás como supervisor: podés ver la lista, pero los precios los completa Administración.
        </div>
      )}

      {porMotivo.length > 0 && (
        <div className="rejilla" style={{ marginBottom: 18 }}>
          {porMotivo.map(([motivo, n]) => (
            <div className="indicador" key={motivo}>
              <div className="valor">{n}</div>
              <div className="etiqueta">{motivo}</div>
            </div>
          ))}
        </div>
      )}

      <div className="tarjeta">
        <input
          placeholder="Buscar por código, descripción o familia…"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          aria-label="Buscar artículos"
        />
      </div>

      <section className="tarjeta">
        {isLoading ? (
          <p>Cargando…</p>
        ) : filtrados.length === 0 ? (
          <p className="vacio">
            {todos.length === 0
              ? 'No hay nada para completar.'
              : 'Ningún artículo coincide con la búsqueda.'}
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th style={{ width: 130 }}>Código</th>
                <th>Descripción</th>
                <th style={{ width: 100 }}>Familia</th>
                <th style={{ width: 90 }}>Actual</th>
                <th>Motivo</th>
                <th style={{ width: 300 }}>Completar</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map((a) => (
                <FilaArticulo
                  key={a.codigo}
                  articulo={a}
                  soloLectura={soloLectura}
                  guardando={completar.isPending}
                  alCompletar={(precio, moneda) =>
                    completar.mutate({ codigo: a.codigo, precio, moneda })
                  }
                />
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  )
}

function FilaArticulo({
  articulo,
  soloLectura,
  guardando,
  alCompletar,
}: {
  articulo: ArticuloPendiente
  soloLectura: boolean
  guardando: boolean
  alCompletar: (precio: number, moneda: string) => void
}) {
  // Si ya trae precio (el caso de MUELAS) se propone ese valor: lo único que
  // falta decidir es la moneda.
  const [precio, setPrecio] = useState(articulo.precio > 0 ? String(articulo.precio) : '')
  const [moneda, setMoneda] = useState<string>(articulo.moneda ?? '')

  const numero = Number(String(precio).replace(',', '.'))
  const listo = Number.isFinite(numero) && numero > 0 && (moneda === 'ARS' || moneda === 'USD')

  return (
    <tr>
      <td>
        <code>{articulo.codigo}</code>
      </td>
      <td>
        {articulo.descripcion}
        {articulo.medida && (
          <>
            <br />
            <small style={{ color: 'var(--tinta-tenue)' }}>{articulo.medida}</small>
          </>
        )}
      </td>
      <td>
        <small>{articulo.familia ?? '—'}</small>
      </td>
      <td>
        {articulo.precio > 0 ? (
          <>
            {articulo.precio.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
            <br />
            <span className="pastilla ambar">¿moneda?</span>
          </>
        ) : (
          <span className="pastilla roja">$0,00</span>
        )}
      </td>
      <td>
        <small>{articulo.motivo}</small>
      </td>
      <td>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            value={precio}
            onChange={(e) => setPrecio(e.target.value.replace(/[^\d.,]/g, ''))}
            placeholder="Precio"
            aria-label={`Precio de ${articulo.codigo}`}
            style={{ maxWidth: 110 }}
            disabled={soloLectura}
          />
          <select
            value={moneda}
            onChange={(e) => setMoneda(e.target.value)}
            aria-label={`Moneda de ${articulo.codigo}`}
            style={{ maxWidth: 90 }}
            disabled={soloLectura}
          >
            <option value="">—</option>
            <option value="ARS">$ ARS</option>
            <option value="USD">US$</option>
          </select>
          <button
            className="primario chico"
            disabled={soloLectura || !listo || guardando}
            onClick={() => alCompletar(numero, moneda)}
          >
            Guardar
          </button>
        </div>
      </td>
    </tr>
  )
}
