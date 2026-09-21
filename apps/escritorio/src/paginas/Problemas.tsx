import {
  ETIQUETA_ESTADO_REPORTE,
  etiquetaDelMotivo,
  type AdjuntoReporte,
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

  /**
   * Vuelve a pasar a texto el audio de un reporte.
   *
   * El audio siempre queda guardado, pero la transcripción es "lo mejor que se
   * pueda": si Gemini estaba caído cuando llegó el reporte (le pasa —503 por
   * demanda, o no responde—), la columna quedó vacía y no había forma de
   * recuperar ese texto salvo pedirle al vendedor que grabe de nuevo. Este botón
   * baja el audio que ya está guardado, lo manda de nuevo a la misma Edge
   * Function y escribe el resultado en la fila. No toca el audio.
   *
   * El UPDATE lo hace el panel (no la función) porque `transcribir-audio` sólo
   * transcribe y devuelve el texto; la escritura la habilita la RLS de admin.
   */
  const retranscribir = useMutation({
    mutationFn: async (p: { id: string; ruta: string }) => {
      const { data: blob, error: errBajar } = await supabase.storage
        .from('reportes-adjuntos')
        .download(p.ruta)
      if (errBajar || !blob) throw errBajar ?? new Error('No pudimos bajar el audio guardado.')

      const audioBase64 = await blobABase64(blob)

      const { data, error: errFuncion } = await supabase.functions.invoke('transcribir-audio', {
        body: { audioBase64, mimeType: 'audio/mp4' },
      })
      if (errFuncion) {
        // supabase-js pone un mensaje genérico ("non-2xx status code") en
        // errFuncion.message; el motivo real que devolvió la función viaja en el
        // body (errFuncion.context). Sin esto, cuando Gemini está caído —que es
        // justo para lo que sirve este botón— el admin veía ese texto inútil.
        let detalle = 'No se pudo transcribir ahora. Gemini puede estar saturado: probá de nuevo en un rato.'
        const contexto = (errFuncion as { context?: Response }).context
        if (contexto && typeof contexto.json === 'function') {
          try {
            const cuerpo = await contexto.json()
            if (typeof cuerpo?.error === 'string') detalle = cuerpo.error
          } catch {
            // El body no era JSON legible; queda el mensaje de arriba.
          }
        }
        throw new Error(detalle)
      }

      const texto = ((data?.transcripcion as string | undefined) ?? '').trim()
      if (!texto) {
        // Gemini contestó pero no entendió el audio (o volvió vacío): no pisamos
        // la fila con nada, y avisamos con lo que dijo la función.
        throw new Error(
          (data?.aviso as string | undefined) ?? 'El audio no se entendió. Escuchalo para ver qué dice.',
        )
      }

      // `.select('id')` para CONFIRMAR que se escribió. Si la RLS de admin no
      // matchea (p.ej. la sesión dejó de ser de admin desde que se abrió el
      // panel), el UPDATE no toca ninguna fila y NO tira error: sin esto se veía
      // como éxito, la transcripción no aparecía, y el botón invitaba a reintentar
      // en loop —gastando una llamada a Gemini cada vez—.
      const { data: filas, error: errGuardar } = await supabase
        .from('reportes_problema')
        .update({ transcripcion_audio: texto })
        .eq('id', p.id)
        .select('id')
      if (errGuardar) throw errGuardar
      if (!filas || filas.length === 0) {
        throw new Error(
          'No se pudo guardar la transcripción. Puede que tu sesión ya no sea de administrador: salí y volvé a entrar.',
        )
      }

      return { id: p.id, texto }
    },
    onSuccess: ({ id, texto }) => {
      setError(null)
      // Pintar la transcripción en el acto y hacer desaparecer el botón sin
      // esperar el refetch: si no, entre el éxito y que vuelva la lista el botón
      // queda habilitado con el texto viejo e invita a un segundo click (otra
      // llamada a Gemini al pedo).
      cliente.setQueryData<ReporteConVendedor[]>(['reportes-problema'], (prev) =>
        prev?.map((r) => (r.id === id ? { ...r, transcripcion_audio: texto } : r)),
      )
      void cliente.invalidateQueries({ queryKey: ['reportes-problema'] })
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

              {r.transcripcion_audio && (
                <div style={{ fontSize: 13, background: 'rgba(0,0,0,0.04)', borderRadius: 8, padding: '8px 10px' }}>
                  <strong>🎤 Lo que dijo (audio):</strong>{' '}
                  <span style={{ whiteSpace: 'pre-wrap' }}>{r.transcripcion_audio}</span>
                </div>
              )}

              {r.adjuntos?.length > 0 && <AdjuntosDelReporte adjuntos={r.adjuntos} />}

              {/* Recuperar la transcripción cuando el audio llegó pero Gemini
                  estaba caído: el audio está arriba para escuchar, y esto lo
                  vuelve a pasar a texto sin molestar al vendedor. */}
              {!soloLectura &&
                !r.transcripcion_audio &&
                r.adjuntos?.some((a) => a.tipo === 'audio') && (
                  <div>
                    <button
                      className="chico"
                      disabled={retranscribir.isPending}
                      onClick={() => {
                        const audio = r.adjuntos.find((a) => a.tipo === 'audio')
                        if (audio) retranscribir.mutate({ id: r.id, ruta: audio.ruta })
                      }}
                    >
                      {retranscribir.isPending && retranscribir.variables?.id === r.id
                        ? 'Transcribiendo…'
                        : '🎤 Transcribir de nuevo'}
                    </button>
                  </div>
                )}

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

/**
 * Blob → base64 sin el prefijo `data:...;base64,`.
 *
 * El móvil manda el audio como base64 crudo (expo-file-system) y la Edge
 * Function espera exactamente eso. `FileReader.readAsDataURL` devuelve un
 * data-URL, así que hay que quedarse con lo que va después de la coma.
 */
function blobABase64(blob: Blob): Promise<string> {
  return new Promise((resolver, rechazar) => {
    const lector = new FileReader()
    lector.onerror = () => rechazar(lector.error ?? new Error('No pudimos leer el audio.'))
    lector.onload = () => {
      const resultado = String(lector.result)
      const coma = resultado.indexOf(',')
      resolver(coma >= 0 ? resultado.slice(coma + 1) : resultado)
    }
    lector.readAsDataURL(blob)
  })
}

/**
 * Las fotos y el audio que adjuntó el vendedor.
 *
 * El bucket es privado, así que se piden URLs firmadas de vida corta (una hora).
 * Las fotos abren en grande al tocarlas; el audio se escucha en el mismo lugar.
 */
function AdjuntosDelReporte({ adjuntos }: { adjuntos: AdjuntoReporte[] }) {
  const rutas = adjuntos.map((a) => a.ruta)

  const { data: urls } = useQuery({
    queryKey: ['adjuntos-reporte', rutas.join('|')],
    queryFn: async () => {
      const { data } = await supabase.storage.from('reportes-adjuntos').createSignedUrls(rutas, 3600)
      const porRuta = new Map((data ?? []).map((d) => [d.path ?? '', d.signedUrl]))
      return adjuntos.map((a) => ({ ...a, url: porRuta.get(a.ruta) ?? null }))
    },
    enabled: rutas.length > 0,
    // Menos que la hora que dura la firma, para no servir un enlace vencido.
    staleTime: 50 * 60_000,
  })

  if (!urls) return <div style={{ fontSize: 12, opacity: 0.6 }}>Cargando adjuntos…</div>

  const fotos = urls.filter((a) => a.tipo === 'foto')
  const audios = urls.filter((a) => a.tipo === 'audio')

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {fotos.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {fotos.map((f, i) =>
            f.url ? (
              <a key={i} href={f.url} target="_blank" rel="noreferrer" title="Abrir en grande">
                <img
                  src={f.url}
                  alt="Adjunto del reporte"
                  style={{
                    width: 96,
                    height: 96,
                    objectFit: 'cover',
                    borderRadius: 8,
                    border: '1px solid rgba(0,0,0,0.15)',
                  }}
                />
              </a>
            ) : null,
          )}
        </div>
      )}
      {audios.map((a, i) =>
        a.url ? (
          <audio key={i} controls preload="none" src={a.url} style={{ width: '100%', maxWidth: 360 }} />
        ) : null,
      )}
    </div>
  )
}
