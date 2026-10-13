import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'

import { supabase } from '../nucleo/supabase'
import { EditorDireccion, type DireccionEditable } from '../componentes/EditorDireccion'

/**
 * "Lugares de entrega a cargar"
 *
 * El reporte "LUGARES DE ENTREGA" del Gestión trajo, por cliente, un texto libre
 * sucio (dirección + teléfono + horario + notas, a veces varias direcciones). Lo
 * que se pudo geocodificar automáticamente ya entró como lugar de entrega; lo que
 * quedó corto o ambiguo quedó en `lugares_entrega_import` con estado 'crudo'.
 *
 * Acá la oficina lo termina a mano: lee el texto que vino del Gestión, marca el
 * punto en el mapa (reusa el mismo editor que Clientes) y lo guarda como lugar de
 * entrega del cliente —así el vendedor lo puede elegir en la nota y el recorrido—.
 * Si el texto no era una dirección (una nota, un teléfono, una zona sin altura),
 * lo descarta.
 *
 * La escritura va por RPC (cargar/descartar_lugar_entrega_import), igual que
 * confirmar clientes o aplicar cambios de dirección, para que administración
 * también pueda sin abrirle la escritura de toda la tabla.
 */

type DireccionBreve = {
  id: string
  etiqueta: string
  direccion_formateada: string
  principal: boolean
}

type ClienteBreve = {
  id: string
  codigo: string | null
  razon_social: string
  direccion: string | null
  localidad: string | null
  direcciones: DireccionBreve[]
}

type CrudoLugarEntrega = {
  id: string
  cliente_id: string | null
  cliente_codigo: string
  razon_archivo: string | null
  texto: string | null
  telefono: string | null
  estado: string
  creado_en: string
  cliente: ClienteBreve | null
}

const DIRECCION_VACIA: DireccionEditable = {
  etiqueta: 'Entrega',
  direccion: '',
  codigo_postal: '',
  lat: null,
  lng: null,
  google_place_id: null,
  confirmada: false,
}

export function PaginaLugaresEntregaACargar({ soloLectura }: { soloLectura: boolean }) {
  const [filtro, setFiltro] = useState('')

  const { data: filas, isLoading } = useQuery({
    queryKey: ['lugares-entrega-crudo'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('lugares_entrega_import')
        .select(
          'id, cliente_id, cliente_codigo, razon_archivo, texto, telefono, estado, creado_en, ' +
            'cliente:clientes ( id, codigo, razon_social, direccion, localidad, ' +
            'direcciones ( id, etiqueta, direccion_formateada, principal ) )',
        )
        .eq('estado', 'crudo')
        // Cola FIFO: lo más viejo primero, igual que el resto de las colas del panel.
        .order('creado_en', { ascending: true })
        .limit(1000)
      if (error) throw error
      return data as unknown as CrudoLugarEntrega[]
    },
  })

  const filtradas = useMemo(() => {
    const q = filtro.trim().toLowerCase()
    const todas = filas ?? []
    if (!q) return todas
    return todas.filter((f) => {
      const razon = f.cliente?.razon_social ?? ''
      const cod = f.cliente?.codigo ?? f.cliente_codigo
      const txt = f.texto ?? ''
      return `${razon} ${cod} ${txt}`.toLowerCase().includes(q)
    })
  }, [filas, filtro])

  return (
    <div>
      <header className="encabezado-pagina">
        <div>
          <h1>Lugares de entrega a cargar</h1>
          <p className="subtitulo">
            Direcciones de entrega que vinieron del Gestión y quedaron sin ubicar en el mapa. Leé el
            texto, marcá el punto y guardá: así el vendedor lo ve como lugar de entrega del cliente.
            Si no es una dirección (es una nota, un teléfono o una zona sin altura), descartalo.
          </p>
        </div>
        <input
          placeholder="Buscar por cliente, código o texto…"
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
          style={{ minWidth: 260 }}
        />
      </header>

      {isLoading ? (
        <section className="tarjeta">
          <p>Cargando…</p>
        </section>
      ) : filtradas.length === 0 ? (
        <section className="tarjeta">
          <p className="vacio">
            {filtro ? 'Nada coincide con la búsqueda.' : '¡No queda nada por cargar! 🎉'}
          </p>
        </section>
      ) : (
        <>
          <p className="subtitulo" style={{ marginBottom: 12 }}>
            {filtradas.length} pendiente{filtradas.length === 1 ? '' : 's'}
            {filtro && filas ? ` (de ${filas.length})` : ''}.
          </p>
          {filtradas.map((f) => (
            <TarjetaCrudo key={f.id} fila={f} soloLectura={soloLectura} />
          ))}
        </>
      )}
    </div>
  )
}

function TarjetaCrudo({ fila, soloLectura }: { fila: CrudoLugarEntrega; soloLectura: boolean }) {
  const query = useQueryClient()
  const [abierto, setAbierto] = useState(false)
  const [confirmandoDescarte, setConfirmandoDescarte] = useState(false)
  const [dir, setDir] = useState<DireccionEditable>(DIRECCION_VACIA)
  const [error, setError] = useState<string | null>(null)

  const cliente = fila.cliente
  const razon = cliente?.razon_social ?? '(cliente sin asociar)'
  const codigo = cliente?.codigo ?? fila.cliente_codigo
  const yaCargadas = cliente?.direcciones ?? []
  const sinCliente = !fila.cliente_id

  function invalidar() {
    void query.invalidateQueries({ queryKey: ['lugares-entrega-crudo'] })
    void query.invalidateQueries({ queryKey: ['lugares-entrega-crudo-total'] })
    // Crear una dirección cambia lo que ven Clientes y el Mapa.
    void query.invalidateQueries({ queryKey: ['clientes'] })
    void query.invalidateQueries({ queryKey: ['clientes-en-mapa'] })
  }

  const guardar = useMutation({
    mutationFn: async () => {
      if (dir.lat === null || dir.lng === null) {
        throw new Error('Marcá el punto en el mapa.')
      }
      if (!dir.direccion.trim()) {
        throw new Error('Escribí la calle y la altura (Google no la resolvió sola).')
      }
      if (!dir.confirmada) {
        throw new Error('Confirmá la dirección: tildá la casilla debajo del mapa.')
      }
      const { error: err } = await supabase.rpc('cargar_lugar_entrega_import', {
        p_import_id: fila.id,
        p_etiqueta: dir.etiqueta.trim() || 'Entrega',
        p_direccion_formateada: dir.direccion.trim(),
        p_lat: dir.lat,
        p_lng: dir.lng,
        p_codigo_postal: dir.codigo_postal.trim() || null,
        p_google_place_id: dir.google_place_id,
      })
      if (err) throw new Error(err.message)
    },
    onSuccess: invalidar,
    onError: (e: Error) => setError(e.message),
  })

  const descartar = useMutation({
    mutationFn: async () => {
      const { error: err } = await supabase.rpc('descartar_lugar_entrega_import', {
        p_import_id: fila.id,
      })
      if (err) throw new Error(err.message)
    },
    onSuccess: invalidar,
    onError: (e: Error) => setError(e.message),
  })

  const trabajando = guardar.isPending || descartar.isPending

  return (
    <section className="tarjeta" style={{ borderLeft: '4px solid var(--ambar, #c98a00)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <h2 style={{ margin: '0 0 2px' }}>{razon}</h2>
          <p style={{ margin: '0 0 10px', color: 'var(--tinta-tenue)' }}>
            Código <code>{codigo}</code>
            {fila.telefono ? ` · Tel. ${fila.telefono}` : ''}
          </p>

          {/* El texto crudo del Gestión, tal cual vino, como referencia para
              leer la dirección (puede traer varias calles, teléfonos y notas). */}
          <div className="campo" style={{ margin: 0 }}>
            <label>Texto del Gestión</label>
            <div
              style={{
                whiteSpace: 'pre-wrap',
                fontFamily: 'monospace',
                fontSize: 13,
                background: 'var(--panel-claro, rgba(0,0,0,.03))',
                border: '1px solid var(--borde, #ccc)',
                borderRadius: 6,
                padding: '8px 10px',
                color: 'var(--tinta)',
              }}
            >
              {fila.texto?.trim() || '— sin texto —'}
            </div>
          </div>

          {yaCargadas.length > 0 && (
            <p className="subtitulo" style={{ marginTop: 10, marginBottom: 0 }}>
              Ya tiene cargado:{' '}
              {yaCargadas
                .map((d) => `${d.principal ? '★ ' : ''}${d.etiqueta}: ${d.direccion_formateada}`)
                .join(' · ')}
            </p>
          )}
        </div>

        {/* ── Acciones ─────────────────────────────────────────────────────── */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            alignItems: 'stretch',
            minWidth: 200,
          }}
        >
          {sinCliente ? (
            <p className="aviso atencion" style={{ margin: 0 }}>
              Este registro no quedó asociado a ningún cliente (código {fila.cliente_codigo}). No se
              puede cargar como dirección.
            </p>
          ) : !abierto ? (
            <button
              className="primario"
              disabled={soloLectura || trabajando}
              onClick={() => {
                setAbierto(true)
                setError(null)
              }}
            >
              📍 Cargar ubicación
            </button>
          ) : (
            <button className="chico" disabled={trabajando} onClick={() => setAbierto(false)}>
              Cerrar el mapa
            </button>
          )}

          {confirmandoDescarte ? (
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                className="chico peligro"
                disabled={soloLectura || trabajando}
                onClick={() => descartar.mutate()}
                style={{ flex: 1 }}
              >
                {descartar.isPending ? 'Descartando…' : 'Sí, descartar'}
              </button>
              <button
                className="chico"
                disabled={trabajando}
                onClick={() => setConfirmandoDescarte(false)}
              >
                No
              </button>
            </div>
          ) : (
            <button
              className="chico"
              disabled={soloLectura || trabajando}
              onClick={() => {
                setConfirmandoDescarte(true)
                setError(null)
              }}
            >
              🗑 No es una dirección — descartar
            </button>
          )}

          {soloLectura && (
            <small style={{ color: 'var(--tinta-tenue)' }}>
              Sólo administración puede cargar o descartar.
            </small>
          )}
        </div>
      </div>

      {/* El mapa (pesado) se monta sólo al expandir esta tarjeta, no de entrada. */}
      {abierto && !sinCliente && (
        <div style={{ marginTop: 14 }}>
          <EditorDireccion valor={dir} alCambiar={setDir} esPrincipal={false} />
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button
              className="primario"
              disabled={soloLectura || trabajando}
              onClick={() => guardar.mutate()}
            >
              {guardar.isPending ? 'Guardando…' : 'Guardar lugar de entrega'}
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="aviso error" style={{ marginTop: 10 }}>
          {error}
        </div>
      )}
    </section>
  )
}
