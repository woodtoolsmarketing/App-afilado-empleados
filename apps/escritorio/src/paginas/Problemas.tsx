import {
  ETIQUETA_ESTADO_REPORTE,
  etiquetaDelMotivo,
  type EstadoReporte,
  type ReporteProblema,
} from '@woodtools/compartido'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'

import { supabase } from '../nucleo/supabase'

/**
 * Los problemas que reportan los vendedores desde la app.
 *
 * ─── Por qué esta página existe ─────────────────────────────────────────────
 *
 * Porque sin ella "reportar un problema" sería tirar un papel a un pozo. El
 * vendedor manda el reporte desde la calle y del otro lado tiene que haber
 * alguien que lo lea, lo conteste, y lo cierre. Ese alguien es Marketing.
 *
 * ─── Qué se ve acá y no en el teléfono ──────────────────────────────────────
 *
 * La versión que estaba corriendo, el modelo del teléfono y su código de
 * instalación. El vendedor no los escribió —no tiene por qué saberlos— y son
 * los que contestan la pregunta que sigue a todo reporte: ¿le pasa a él o le
 * pasa a todos?
 *
 * ─── Por qué la respuesta se escribe acá ────────────────────────────────────
 *
 * Porque vuelve a la app: el vendedor la ve abajo del reporte, en la misma
 * pantalla donde lo escribió. Contestar por WhatsApp deja al que reportó sin
 * saber si su aviso sirvió para algo, y al que atiende sin saber cuáles ya
 * contestó.
 */

interface ReporteConVendedor extends ReporteProblema {
  vendedor: { nombre_completo: string; codigo_vendedor: string | null } | null
}

const ESTADOS: EstadoReporte[] = ['nuevo', 'en_revision', 'resuelto', 'descartado']

export function PaginaProblemas({ soloLectura }: { soloLectura: boolean }) {
  const cliente = useQueryClient()
  const [verCerrados, setVerCerrados] = useState(false)
  const [respuestas, setRespuestas] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)

  const { data: reportes, isLoading } = useQuery({
    queryKey: ['reportes-problema'],
    queryFn: async () => {
      const { data, error: err } = await supabase
        .from('reportes_problema')
        .select('*, vendedor:perfiles!reportes_problema_vendedor_id_fkey (nombre_completo, codigo_vendedor)')
        .order('creado_en', { ascending: false })
        .limit(200)
      if (err) throw err
      return (data ?? []) as ReporteConVendedor[]
    },
    refetchInterval: 60_000,
  })

  const guardar = useMutation({
    mutationFn: async (p: { id: string; estado: EstadoReporte; respuesta?: string | null }) => {
      const { error: err } = await supabase
        .from('reportes_problema')
        .update({
          estado: p.estado,
          respuesta: p.respuesta ?? undefined,
          atendido_por: (await supabase.auth.getUser()).data.user?.id ?? null,
          atendido_en: new Date().toISOString(),
        })
        .eq('id', p.id)
      if (err) throw err
    },
    onSuccess: () => {
      setError(null)
      void cliente.invalidateQueries({ queryKey: ['reportes-problema'] })
      void cliente.invalidateQueries({ queryKey: ['reportes-abiertos'] })
    },
    onError: (e: Error) => setError(e.message),
  })

  const todos = reportes ?? []
  const abiertos = todos.filter((r) => r.estado === 'nuevo' || r.estado === 'en_revision')
  const visibles = verCerrados ? todos : abiertos

  /**
   * Cuántas veces se reportó cada motivo.
   *
   * Es el número por el que existe la tabla: un problema que reportaron ocho
   * vendedores distintos y uno que reportó uno se atienden en distinto orden, y
   * leyendo los reportes de a uno eso no se ve.
   */
  const porMotivo = useMemo(() => {
    const cuenta = new Map<string, number>()
    for (const r of abiertos) cuenta.set(r.motivo, (cuenta.get(r.motivo) ?? 0) + 1)
    return [...cuenta.entries()].sort((a, b) => b[1] - a[1])
  }, [abiertos])

  return (
    <>
      <header className="encabezado-pagina">
        <div>
          <h1>Problemas reportados</h1>
          <p>
            {abiertos.length === 0
              ? 'No hay problemas abiertos.'
              : `${abiertos.length} sin resolver, de ${todos.length} reportados.`}
          </p>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="checkbox"
            checked={verCerrados}
            onChange={(e) => setVerCerrados(e.target.checked)}
          />
          Ver también los cerrados
        </label>
      </header>

      {error && (
        <div className="aviso error" role="alert">
          {error}
        </div>
      )}

      {soloLectura && (
        <div className="aviso atencion">
          Podés leer los reportes, pero contestarlos y cerrarlos es de un administrador.
        </div>
      )}

      {porMotivo.length > 0 && (
        <div className="rejilla" style={{ marginBottom: 18 }}>
          {porMotivo.map(([motivo, veces]) => (
            <div key={motivo} className="tarjeta">
              <strong style={{ fontSize: 24 }}>{veces}</strong>
              <div style={{ fontSize: 13, opacity: 0.8 }}>{etiquetaDelMotivo(motivo)}</div>
            </div>
          ))}
        </div>
      )}

      {isLoading ? (
        <p>Cargando…</p>
      ) : visibles.length === 0 ? (
        <p>No hay nada para mostrar.</p>
      ) : (
        <div style={{ display: 'grid', gap: 14 }}>
          {visibles.map((r) => (
            <article key={r.id} className="tarjeta" style={{ display: 'grid', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <strong>{etiquetaDelMotivo(r.motivo)}</strong>
                <span className={`pastilla ${r.estado === 'resuelto' ? 'verde' : r.estado === 'nuevo' ? 'roja' : ''}`}>
                  {ETIQUETA_ESTADO_REPORTE[r.estado]}
                </span>
              </div>

              <div style={{ fontSize: 13, opacity: 0.8 }}>
                {r.vendedor?.nombre_completo ?? 'Vendedor desconocido'}
                {r.vendedor?.codigo_vendedor ? ` (#${r.vendedor.codigo_vendedor})` : ''} ·{' '}
                {new Date(r.creado_en).toLocaleString('es-AR')}
              </div>

              {r.detalle && <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{r.detalle}</p>}

              {r.cuando_se_da && (
                <div style={{ fontSize: 13 }}>
                  <strong>Cuándo se da:</strong> {r.cuando_se_da}
                </div>
              )}

              {/* Lo que el vendedor no escribió y es lo que permite reproducirlo. */}
              <div style={{ fontSize: 12, opacity: 0.7, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                {r.version_app && <span>Versión: {r.version_app}</span>}
                {r.modelo && <span>Teléfono: {r.modelo}</span>}
                {r.instalacion && <span>Instalación: {r.instalacion.slice(0, 8).toUpperCase()}</span>}
                {r.pantalla && <span>Desde: {r.pantalla}</span>}
              </div>

              {r.respuesta && (
                <div className="aviso exito" style={{ margin: 0 }}>
                  <strong>Respuesta:</strong> {r.respuesta}
                </div>
              )}

              {!soloLectura && (
                <div style={{ display: 'grid', gap: 8 }}>
                  <textarea
                    rows={2}
                    placeholder="Contestale al vendedor. Lo va a ver en la app, abajo de su reporte."
                    value={respuestas[r.id] ?? r.respuesta ?? ''}
                    onChange={(e) => setRespuestas((p) => ({ ...p, [r.id]: e.target.value }))}
                  />
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {ESTADOS.filter((e) => e !== r.estado).map((e) => (
                      <button
                        key={e}
                        className="chico"
                        disabled={guardar.isPending}
                        onClick={() =>
                          guardar.mutate({
                            id: r.id,
                            estado: e,
                            respuesta: respuestas[r.id] ?? r.respuesta ?? null,
                          })
                        }
                      >
                        {ETIQUETA_ESTADO_REPORTE[e]}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </>
  )
}
