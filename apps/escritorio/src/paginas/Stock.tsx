import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import {
  alertasStockNuevas,
  buscarStock,
  fijarStock,
  marcarAlertasStockVistas,
  type ArticuloStock,
} from '../servicios/stock'
import { CargaStockExcel } from '../componentes/CargaStockExcel'

/**
 * Stock de productos.
 *
 * El apartado de la oficina para ver y cargar el stock de cada producto del
 * catálogo. Sólo PRODUCTOS: los servicios de taller (afilado, reparación,
 * rectificado, soldadura, etc.) no aparecen —la vista `vista_stock` ya los deja
 * afuera por `es_servicio`—. La carga es manual: no se descuenta al vender.
 *
 * Editan admin y administración; el supervisor lo ve de sólo lectura (igual que
 * "A confirmar"). Hay ~1.300 productos: la lista se busca, no se scrollea.
 */
export function PaginaStock({ soloLectura }: { soloLectura: boolean }) {
  const cliente = useQueryClient()
  const [busqueda, setBusqueda] = useState('')
  const [aplicada, setAplicada] = useState('')
  const [mensaje, setMensaje] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Debounce: no pegarle al servidor en cada tecla.
  useEffect(() => {
    const id = setTimeout(() => setAplicada(busqueda), 300)
    return () => clearTimeout(id)
  }, [busqueda])

  const { data: articulos, isLoading } = useQuery({
    queryKey: ['stock', aplicada],
    queryFn: () => buscarStock(aplicada),
  })

  const guardar = useMutation({
    mutationFn: (p: { codigo: string; cantidad: number }) => fijarStock(p.codigo, p.cantidad),
    onSuccess: (fila) => {
      setError(null)
      setMensaje(`Stock de ${fila.codigo} guardado: ${fila.cantidad} unidad${fila.cantidad === 1 ? '' : 'es'}.`)
      // El RPC ya devolvió la fila: parcheamos sólo ese código en la lista
      // cacheada, en vez de refetchear toda vista_stock en cada Guardar.
      cliente.setQueryData<ArticuloStock[]>(['stock', aplicada], (prev) =>
        prev?.map((a) => (a.codigo === fila.codigo ? { ...a, stock: fila.cantidad } : a)),
      )
    },
    onError: (e: Error) => {
      setMensaje(null)
      setError(e.message)
    },
  })

  const todos = articulos ?? []

  // Alertas de stock bajo/agotado sin ver (las genera el trigger al cruzar el umbral).
  const { data: alertas } = useQuery({
    queryKey: ['alertas-stock', 'lista'],
    queryFn: alertasStockNuevas,
  })
  const marcarVistas = useMutation({
    mutationFn: marcarAlertasStockVistas,
    onSuccess: () => void cliente.invalidateQueries({ queryKey: ['alertas-stock'] }),
  })

  return (
    <>
      <header className="encabezado-pagina">
        <div>
          <h1>Stock</h1>
          <p>
            Stock de los productos del catálogo. Los servicios (afilado, reparación,
            rectificado…) no llevan stock.{' '}
            {soloLectura ? 'Lo carga Administración.' : 'Se carga a mano o subiendo el Excel del Gestión.'}
          </p>
        </div>
        {!soloLectura && (
          <CargaStockExcel
            onAplicado={(r) => {
              setError(null)
              setMensaje(
                `Stock cargado desde el Excel: ${r.productos} producto${r.productos === 1 ? '' : 's'} actualizado${
                  r.productos === 1 ? '' : 's'
                }` +
                  (r.puestos_en_cero > 0
                    ? `, ${r.puestos_en_cero} puesto${r.puestos_en_cero === 1 ? '' : 's'} en 0`
                    : '') +
                  '.',
              )
              void cliente.invalidateQueries({ queryKey: ['stock'] })
              void cliente.invalidateQueries({ queryKey: ['alertas-stock'] })
            }}
          />
        )}
      </header>

      {mensaje && <div className="aviso exito">{mensaje}</div>}
      {error && (
        <div className="aviso error" role="alert">
          {error}
        </div>
      )}
      {soloLectura && (
        <div className="aviso atencion">
          Estás como supervisor: podés ver el stock, pero lo carga Administración.
        </div>
      )}

      {(alertas?.length ?? 0) > 0 && (
        <section className="tarjeta" style={{ marginBottom: 14 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              gap: 10,
              flexWrap: 'wrap',
            }}
          >
            <h2 style={{ margin: 0 }}>⚠ Stock bajo</h2>
            {!soloLectura && (
              <button
                className="chico"
                onClick={() => marcarVistas.mutate()}
                disabled={marcarVistas.isPending}
              >
                Marcar como vistas
              </button>
            )}
          </div>
          <table style={{ marginTop: 10 }}>
            <thead>
              <tr>
                <th style={{ width: 130 }}>Código</th>
                <th>Herramienta</th>
                <th style={{ textAlign: 'right', width: 90 }}>Quedan</th>
                <th style={{ width: 100 }}>Estado</th>
              </tr>
            </thead>
            <tbody>
              {alertas!.map((a) => (
                <tr key={a.id}>
                  <td>
                    <code>{a.codigo}</code>
                  </td>
                  <td>{a.nombre}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{a.cantidad}</td>
                  <td>
                    <span className={`pastilla ${a.tipo === 'agotado' ? 'roja' : 'ambar'}`}>
                      {a.tipo === 'agotado' ? 'AGOTADO' : 'BAJO'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <div className="tarjeta">
        <input
          placeholder="Buscar por código, descripción o medida…"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          aria-label="Buscar productos"
        />
      </div>

      <section className="tarjeta">
        {isLoading ? (
          <p>Cargando…</p>
        ) : todos.length === 0 ? (
          <p className="vacio">Ningún producto coincide con la búsqueda.</p>
        ) : (
          <>
            <table>
              <thead>
                <tr>
                  <th style={{ width: 130 }}>Código</th>
                  <th>Descripción</th>
                  <th style={{ width: 110 }}>Familia</th>
                  <th style={{ textAlign: 'right', width: 130 }}>Precio</th>
                  <th style={{ textAlign: 'right', width: 80 }}>Stock</th>
                  <th style={{ width: 210 }}>{soloLectura ? '' : 'Cargar stock'}</th>
                </tr>
              </thead>
              <tbody>
                {todos.map((a) => (
                  <FilaStock
                    key={a.codigo}
                    articulo={a}
                    soloLectura={soloLectura}
                    guardando={guardar.isPending && guardar.variables?.codigo === a.codigo}
                    alGuardar={(cantidad) => guardar.mutate({ codigo: a.codigo, cantidad })}
                  />
                ))}
              </tbody>
            </table>
            {todos.length >= 100 && (
              <p className="vacio" style={{ marginTop: 10 }}>
                Se muestran los primeros 100. Afiná la búsqueda para encontrar un producto puntual.
              </p>
            )}
          </>
        )}
      </section>
    </>
  )
}

function FilaStock({
  articulo,
  soloLectura,
  guardando,
  alGuardar,
}: {
  articulo: ArticuloStock
  soloLectura: boolean
  guardando: boolean
  alGuardar: (cantidad: number) => void
}) {
  const [valor, setValor] = useState(String(articulo.stock))

  // Si cambia el stock del servidor (se recargó la lista al guardar), refrescar
  // el input. Mientras el valor del servidor no cambie, se respeta lo tipeado.
  useEffect(() => {
    setValor(String(articulo.stock))
  }, [articulo.stock])

  const n = Number(valor)
  const valido = valor !== '' && Number.isInteger(n) && n >= 0
  const cambiado = valido && n !== articulo.stock

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
      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
        {articulo.precio_a_confirmar ? (
          <span className="pastilla ambar">a confirmar</span>
        ) : (
          `${articulo.precio.toLocaleString('es-AR', { minimumFractionDigits: 2 })} ${articulo.moneda ?? ''}`
        )}
      </td>
      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
        <strong>{articulo.stock}</strong>
      </td>
      <td>
        {soloLectura ? null : (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              value={valor}
              onChange={(e) => setValor(e.target.value.replace(/[^\d]/g, ''))}
              inputMode="numeric"
              aria-label={`Stock de ${articulo.codigo}`}
              style={{ maxWidth: 90, textAlign: 'right' }}
            />
            <button
              className="primario chico"
              disabled={!cambiado || guardando}
              onClick={() => alGuardar(n)}
            >
              Guardar
            </button>
          </div>
        )}
      </td>
    </tr>
  )
}
