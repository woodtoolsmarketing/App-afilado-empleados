import { fechaLocalISO } from '@woodtools/compartido'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import ExcelJS from 'exceljs'
import L from 'leaflet'
import { useEffect, useState } from 'react'
import { MapContainer, Marker, TileLayer, Tooltip, useMap } from 'react-leaflet'

import { supabase } from '../nucleo/supabase'
import { ubicacionComoDireccion } from '../servicios/geocodificar'

/**
 * Cambios de dirección propuestos por los vendedores.
 *
 * ─── Por qué esta pantalla existe ───────────────────────────────────────────
 *
 * Cuando un vendedor está parado en el cliente y ve que la dirección registrada
 * está mal, corrige la ubicación desde la app. Eso NO pisa la dirección oficial
 * —que maneja el mapa y las coordenadas de todo el sistema—: entra acá como un
 * pedido. La oficina lo revisa contra el mapa y lo aplica (o lo rechaza). Recién
 * ahí se cambia la ubicación real del cliente en la base.
 *
 * Mientras tanto, el recorrido del vendedor que lo propuso ya lo lleva a la
 * ubicación nueva: lo resuelve la app, sin tocar la base.
 */

interface CambioDireccion {
  id: string
  cliente_id: string
  direccion_id: string | null
  direccion_propuesta: string
  lat_propuesta: number | null
  lng_propuesta: number | null
  motivo: string | null
  estado: 'pendiente' | 'aplicado' | 'rechazado'
  creado_en: string
  resuelto_en: string | null
  motivo_rechazo: string | null
  cliente: { codigo: string | null; razon_social: string } | null
  direccion: { direccion_formateada: string | null; lat: number | null; lng: number | null } | null
  vendedor: { nombre_completo: string; codigo_vendedor: string | null } | null
}

const SELECT =
  '*, cliente:clientes!cambios_direccion_cliente_id_fkey (codigo, razon_social),' +
  ' direccion:direcciones!cambios_direccion_direccion_id_fkey (direccion_formateada, lat, lng),' +
  ' vendedor:perfiles!cambios_direccion_vendedor_id_fkey (nombre_completo, codigo_vendedor)'

/**
 * Pines dibujados a mano: el icono por defecto de Leaflet apunta a imágenes que
 * el empaquetador no resuelve (salen rotas). El gris es dónde está hoy; el rojo,
 * dónde dice el vendedor que está de verdad.
 */
function pin(color: string, size: number) {
  return L.divIcon({
    className: '',
    html: `<div style="width:${size}px;height:${size}px;border-radius:50% 50% 50% 0;background:${color};border:2px solid #fff;transform:rotate(-45deg);box-shadow:0 1px 4px rgba(0,0,0,.45)"></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size],
  })
}
const ICONO_ACTUAL = pin('#888', 16)
const ICONO_NUEVO = pin('#B30F0F', 18)

function Encuadrar({ puntos }: { puntos: [number, number][] }) {
  const mapa = useMap()
  useEffect(() => {
    if (puntos.length === 1) mapa.setView(puntos[0], 16)
    else if (puntos.length > 1) mapa.fitBounds(L.latLngBounds(puntos), { padding: [45, 45] })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return null
}

function MapaCambio({
  actual,
  nueva,
}: {
  actual: [number, number] | null
  nueva: [number, number] | null
}) {
  const puntos = [actual, nueva].filter(Boolean) as [number, number][]
  if (puntos.length === 0) return null
  return (
    <div style={{ height: 220, borderRadius: 8, overflow: 'hidden', margin: '10px 0' }}>
      <MapContainer center={puntos[0]} zoom={16} style={{ height: '100%', width: '100%' }} scrollWheelZoom={false}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Encuadrar puntos={puntos} />
        {actual ? (
          <Marker position={actual} icon={ICONO_ACTUAL}>
            <Tooltip>Dónde está registrado hoy</Tooltip>
          </Marker>
        ) : null}
        {nueva ? (
          <Marker position={nueva} icon={ICONO_NUEVO}>
            <Tooltip>Dónde dice el vendedor</Tooltip>
          </Marker>
        ) : null}
      </MapContainer>
    </div>
  )
}

/**
 * ¿Es un texto que la oficina no puede ubicar de un vistazo? Un plus code de
 * Google ("XCC7+W7 Puerto Esperanza, Misiones, Argentina") o coordenadas crudas
 * ("-26.0276, -54.5868"). Son los que conviene resolver a un nombre de calle.
 *
 * El plus code arranca siempre con un bloque de caracteres, un '+' y otro
 * bloque: una dirección de calle de verdad nunca empieza así.
 */
function pareceDireccionCriptica(texto: string | null | undefined): boolean {
  const t = (texto ?? '').trim()
  if (!t) return false
  if (/^[A-Z0-9]{2,}\+[A-Z0-9]{2,}\b/i.test(t)) return true
  if (/^-?\d{1,3}\.\d{3,}\s*,\s*-?\d{1,3}\.\d{3,}$/.test(t)) return true
  return false
}

/**
 * Si la dirección propuesta es un plus code (o coordenadas) y hay un pin,
 * resuelve el nombre de calle legible desde esas coordenadas, reutilizando el
 * reverse-geocode del panel (que ahora, con `preferirCalle`, prefiere la calle
 * al plus code). Así la oficina ve "Ruta Nacional 12, Puerto Esperanza" en vez
 * de "XCC7+W7 …".
 *
 * Es best-effort: si Google falla o vuelve a contestar un plus code, devuelve
 * `null` y la vista cae al texto original sin romperse. `staleTime: Infinity`
 * porque la calle de un punto no cambia: se resuelve una vez por coordenada.
 */
function useDireccionLegible(c: CambioDireccion): { resuelta: string | null; cargando: boolean } {
  const tienePin = c.lat_propuesta != null && c.lng_propuesta != null
  // Sólo resolvemos las PENDIENTES: las resueltas/rechazadas son historia y no
  // vale gastar llamadas a Google en ellas (al aplicar ya quedó escrita la
  // dirección buena en el cliente). Importa porque "Ver resueltos" trae hasta 100.
  const habilitado =
    pareceDireccionCriptica(c.direccion_propuesta) && tienePin && c.estado === 'pendiente'
  const consulta = useQuery({
    queryKey: ['direccion-legible', c.lat_propuesta, c.lng_propuesta],
    enabled: habilitado,
    staleTime: Infinity,
    retry: false,
    queryFn: async () => {
      const d = await ubicacionComoDireccion(
        { lat: c.lat_propuesta as number, lng: c.lng_propuesta as number },
        { preferirCalle: true },
      )
      return d.direccion_formateada?.trim() || null
    },
  })
  // `habilitado` también acá: una tarjeta deshabilitada que comparta coordenada
  // con otra podría leer la dirección ya cacheada de esa otra (react-query
  // devuelve el dato por clave aunque el observador esté `enabled: false`). No
  // queremos mostrar —ni, al aplicar, guardar— la calle resuelta de un vecino.
  const resuelta =
    habilitado && consulta.data && !pareceDireccionCriptica(consulta.data) ? consulta.data : null
  return { resuelta, cargando: habilitado && consulta.isLoading }
}

/**
 * Una tarjeta de cambio: dirección vieja tachada + la nueva propuesta (resuelta
 * a calle legible si venía como plus code) + nota del vendedor + mapa + los
 * botones de aplicar/rechazar. Es un componente aparte porque cada tarjeta
 * resuelve su propia dirección con un hook, y los hooks no pueden ir dentro de
 * un `.map`.
 */
function TarjetaCambio({
  c,
  soloLectura,
  trabajando,
  enModoRechazo,
  motivo,
  onMotivoChange,
  onIniciarRechazo,
  onCancelarRechazo,
  onAplicar,
  onRechazar,
}: {
  c: CambioDireccion
  soloLectura: boolean
  trabajando: boolean
  enModoRechazo: boolean
  motivo: string
  onMotivoChange: (v: string) => void
  onIniciarRechazo: () => void
  onCancelarRechazo: () => void
  onAplicar: (direccion: string | null) => void
  onRechazar: (motivo: string) => void
}) {
  const { resuelta, cargando } = useDireccionLegible(c)
  const actual: [number, number] | null =
    c.direccion?.lat != null && c.direccion?.lng != null ? [c.direccion.lat, c.direccion.lng] : null
  const nueva: [number, number] | null =
    c.lat_propuesta != null && c.lng_propuesta != null ? [c.lat_propuesta, c.lng_propuesta] : null
  const pendiente = c.estado === 'pendiente'

  return (
    <div
      className="tarjeta"
      style={{
        padding: 16,
        borderRadius: 10,
        // Los pendientes saltan a la vista: borde rojo a la izquierda.
        borderLeft: pendiente ? '5px solid #B30F0F' : undefined,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 15 }}>
          {c.cliente?.razon_social ?? 'Cliente'}
          {c.cliente?.codigo ? <span style={{ color: 'var(--tinta-suave)' }}> · {c.cliente.codigo}</span> : null}
        </strong>
        <span style={{ fontSize: 12, color: 'var(--tinta-suave)' }}>
          {c.vendedor?.nombre_completo ?? 'Vendedor'}
          {c.vendedor?.codigo_vendedor ? ` (#${c.vendedor.codigo_vendedor})` : ''} ·{' '}
          {new Date(c.creado_en).toLocaleString('es-AR')}
          {!pendiente ? ` · ${c.estado.toUpperCase()}` : ''}
        </span>
      </div>

      {/*
        El cambio, de un vistazo: la dirección vieja tachada y en gris, y la
        NUEVA —lo que de verdad hay que mirar— en un recuadro rojo, grande y en
        negrita. Si la propuesta venía como plus code ("XCC7+W7 …") y pudimos
        resolver el nombre de calle, mostramos la calle grande y el plus code
        chiquito debajo (para cruzarlo con Google Maps si hace falta).
      */}
      <div style={{ marginTop: 12, fontSize: 14 }}>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--tinta-suave)' }}>
          Dirección actual
        </div>
        <div
          style={{
            color: 'var(--tinta-suave)',
            textDecoration: pendiente && c.direccion?.direccion_formateada ? 'line-through' : 'none',
          }}
        >
          {c.direccion?.direccion_formateada ?? '— (el cliente no tenía dirección cargada)'}
        </div>

        <div
          style={{
            marginTop: 8,
            background: 'rgba(179,15,15,0.08)',
            border: '2px solid #B30F0F',
            borderRadius: 8,
            padding: '10px 12px',
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: '#B30F0F' }}>
            📍 {pendiente ? 'Dirección nueva propuesta' : 'Dirección propuesta'}
          </div>
          <div style={{ fontSize: 17, fontWeight: 700, marginTop: 2 }}>{resuelta ?? c.direccion_propuesta}</div>
          {resuelta ? (
            <div style={{ fontSize: 12, color: 'var(--tinta-suave)', marginTop: 2 }}>{c.direccion_propuesta}</div>
          ) : cargando ? (
            <div style={{ fontSize: 12, color: 'var(--tinta-suave)', marginTop: 2, fontStyle: 'italic' }}>
              Buscando el nombre de la calle…
            </div>
          ) : null}
        </div>

        {c.motivo ? (
          <div style={{ marginTop: 8, fontStyle: 'italic', color: 'var(--tinta-suave)' }}>“{c.motivo}”</div>
        ) : null}
        {!nueva ? (
          <div className="aviso atencion" style={{ marginTop: 8, fontSize: 13 }}>
            El vendedor no marcó el punto en el mapa. Al aplicar, la dirección cambia pero la
            coordenada queda como estaba: ajustala a mano en Clientes si hace falta.
          </div>
        ) : null}
      </div>

      <MapaCambio actual={actual} nueva={nueva} />

      {!pendiente ? (
        <div style={{ fontSize: 13, color: 'var(--tinta-suave)' }}>
          {c.estado === 'aplicado' ? 'Aplicado' : 'Rechazado'}
          {c.resuelto_en ? ` el ${new Date(c.resuelto_en).toLocaleString('es-AR')}` : ''}
          {c.motivo_rechazo ? ` — ${c.motivo_rechazo}` : ''}
        </div>
      ) : soloLectura ? (
        <div style={{ fontSize: 13, color: 'var(--tinta-suave)' }}>
          Sólo un administrador puede aplicar o rechazar.
        </div>
      ) : enModoRechazo ? (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            type="text"
            placeholder="Motivo del rechazo (opcional)"
            value={motivo}
            onChange={(e) => onMotivoChange(e.target.value)}
            style={{ flex: 1, minWidth: 220 }}
          />
          <button className="primario" disabled={trabajando} onClick={() => onRechazar(motivo)}>
            Confirmar rechazo
          </button>
          <button className="chico" disabled={trabajando} onClick={onCancelarRechazo}>
            Volver
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8 }}>
          {/* Al aplicar guardamos la calle resuelta (si la hay), no el plus code. */}
          <button className="primario" disabled={trabajando} onClick={() => onAplicar(resuelta)}>
            ✓ Aplicar a la base
          </button>
          <button className="chico" disabled={trabajando} onClick={onIniciarRechazo}>
            Rechazar
          </button>
        </div>
      )}
    </div>
  )
}

export function PaginaCambiosDireccion({ soloLectura }: { soloLectura: boolean }) {
  const cliente = useQueryClient()
  const [verResueltos, setVerResueltos] = useState(false)
  const [rechazando, setRechazando] = useState<string | null>(null)
  const [motivos, setMotivos] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [exportando, setExportando] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['cambios-direccion', verResueltos],
    queryFn: async () => {
      // Sólo las correcciones a revisar: las ubicaciones nuevas van en su propia
      // sección (es_ubicacion_nueva), que es informativa y no se aprueba.
      const base = supabase
        .from('cambios_direccion')
        .select(SELECT)
        .eq('es_ubicacion_nueva', false)
        .order('creado_en', { ascending: false })
      const { data, error: err } = verResueltos ? await base.limit(100) : await base.eq('estado', 'pendiente')
      if (err) throw err
      return (data ?? []) as unknown as CambioDireccion[]
    },
    refetchInterval: 30_000,
  })

  /**
   * Ubicaciones nuevas que cargaron los vendedores desde la calle.
   *
   * No son correcciones a revisar: clientes que estaban sin mapa y el vendedor
   * ubicó por primera vez. Ya quedaron cargadas; esto es para que la oficina se
   * entere de que pasó y quién fue. Se muestran las de los últimos 15 días.
   */
  const { data: ubicaciones } = useQuery({
    queryKey: ['ubicaciones-nuevas'],
    queryFn: async () => {
      const desde = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString()
      const { data, error: err } = await supabase
        .from('cambios_direccion')
        .select(SELECT)
        .eq('es_ubicacion_nueva', true)
        .gte('creado_en', desde)
        .order('creado_en', { ascending: false })
        .limit(80)
      if (err) throw err
      return (data ?? []) as unknown as CambioDireccion[]
    },
    refetchInterval: 30_000,
  })

  function invalidar() {
    void cliente.invalidateQueries({ queryKey: ['cambios-direccion'] })
    void cliente.invalidateQueries({ queryKey: ['cambios-direccion-pendientes'] })
    void cliente.invalidateQueries({ queryKey: ['clientes-en-mapa'] })
  }

  const aplicar = useMutation({
    mutationFn: async (p: { id: string; direccion: string | null }) => {
      // Mandamos `p_direccion` SÓLO cuando hay una calle resuelta. Así el caso
      // normal (sin resolver) sigue llamando con `{ p_id }` a secas y funciona
      // aunque en la base todavía esté el RPC viejo sin `p_direccion` —PostgREST
      // elige la sobrecarga por el juego de argumentos del body—. Con calle
      // resuelta se guarda ESA como dirección oficial, no el plus code.
      const args = p.direccion ? { p_id: p.id, p_direccion: p.direccion } : { p_id: p.id }
      const { error: err } = await supabase.rpc('aplicar_cambio_direccion', args)
      if (err) throw err
    },
    onSuccess: () => {
      setError(null)
      invalidar()
    },
    onError: (e: Error) => setError(e.message),
  })

  const rechazar = useMutation({
    mutationFn: async (p: { id: string; motivo: string }) => {
      const { error: err } = await supabase.rpc('rechazar_cambio_direccion', {
        p_id: p.id,
        p_motivo: p.motivo.trim() || null,
      })
      if (err) throw err
    },
    onSuccess: () => {
      setError(null)
      setRechazando(null)
      invalidar()
    },
    onError: (e: Error) => setError(e.message),
  })

  const cambios = data ?? []
  const trabajando = aplicar.isPending || rechazar.isPending

  /**
   * Exporta a Excel SÓLO los cambios pendientes, sin importar si en pantalla se
   * están viendo los resueltos.
   *
   * Lleva lo que la oficina tiene que cargar en el sistema de gestión: el cliente
   * con su código, la dirección anterior y la nueva. Se piden aparte (no se usa la
   * lista en pantalla) por dos motivos: con "Ver resueltos" la consulta recorta a
   * 100 y podría dejar pendientes afuera; y la "anterior" sólo es fiel en los
   * pendientes —al aplicar un cambio, la base pisa esa dirección con la nueva—.
   */
  async function exportarExcel() {
    setExportando(true)
    setError(null)
    try {
      const { data, error: err } = await supabase
        .from('cambios_direccion')
        .select(SELECT)
        .eq('estado', 'pendiente')
        .order('creado_en', { ascending: false })
      if (err) throw err
      const pendientes = (data ?? []) as unknown as CambioDireccion[]
      if (pendientes.length === 0) {
        setError('No hay cambios de dirección pendientes para exportar.')
        return
      }

      const libro = new ExcelJS.Workbook()
      const hoja = libro.addWorksheet('Cambios pendientes')
      hoja.columns = [
        { header: 'Cliente Nº', key: 'codigo', width: 14 },
        { header: 'Cliente', key: 'cliente', width: 34 },
        { header: 'Dirección anterior', key: 'anterior', width: 42 },
        { header: 'Dirección nueva', key: 'nueva', width: 42 },
        { header: 'Vendedor', key: 'vendedor', width: 24 },
        { header: 'Motivo', key: 'motivo', width: 28 },
        { header: 'Fecha', key: 'fecha', width: 18 },
      ]
      hoja.getRow(1).font = { bold: true }

      for (const c of pendientes) {
        hoja.addRow({
          codigo: c.cliente?.codigo ?? '—',
          cliente: c.cliente?.razon_social ?? '—',
          anterior: c.direccion?.direccion_formateada ?? '(el cliente no tenía dirección cargada)',
          nueva: c.direccion_propuesta,
          vendedor: c.vendedor
            ? `${c.vendedor.nombre_completo}${c.vendedor.codigo_vendedor ? ` (#${c.vendedor.codigo_vendedor})` : ''}`
            : '—',
          motivo: c.motivo ?? '',
          fecha: new Date(c.creado_en).toLocaleString('es-AR', {
            dateStyle: 'short',
            timeStyle: 'short',
          }),
        })
      }

      const buffer = await libro.xlsx.writeBuffer()
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      const url = URL.createObjectURL(blob)
      const enlace = document.createElement('a')
      enlace.href = url
      enlace.download = `cambios-direccion-pendientes-${fechaLocalISO(new Date())}.xlsx`
      enlace.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setExportando(false)
    }
  }

  return (
    <>
      <header className="encabezado-pagina">
        <div>
          <h1>Cambios de dirección</h1>
          <p>
            Correcciones de ubicación que mandaron los vendedores desde la calle. Revisalas contra el
            mapa y aplicalas: recién ahí se cambia la ubicación del cliente en el sistema.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
          <label style={{ fontSize: 13, display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={verResueltos} onChange={(e) => setVerResueltos(e.target.checked)} />
            Ver resueltos
          </label>
          <button
            className="primario"
            disabled={exportando}
            onClick={exportarExcel}
            title="Baja una planilla de los cambios PENDIENTES: cliente, código, dirección anterior y nueva"
          >
            {exportando ? 'Exportando…' : '⬇ Exportar pendientes'}
          </button>
        </div>
      </header>

      {error ? <div className="aviso error">{error}</div> : null}

      {isLoading ? (
        <p className="vacio">Cargando…</p>
      ) : cambios.length === 0 ? (
        <p className="vacio">
          {verResueltos ? 'No hay cambios de dirección.' : 'No hay cambios de dirección pendientes.'}
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {cambios.map((c) => (
            <TarjetaCambio
              key={c.id}
              c={c}
              soloLectura={soloLectura}
              trabajando={trabajando}
              enModoRechazo={rechazando === c.id}
              motivo={motivos[c.id] ?? ''}
              onMotivoChange={(v) => setMotivos((m) => ({ ...m, [c.id]: v }))}
              onIniciarRechazo={() => setRechazando(c.id)}
              onCancelarRechazo={() => setRechazando(null)}
              onAplicar={(direccion) => aplicar.mutate({ id: c.id, direccion })}
              onRechazar={(mot) => rechazar.mutate({ id: c.id, motivo: mot })}
            />
          ))}
        </div>
      )}

      {/*
        Ubicaciones nuevas: INFORMATIVO, no se aprueba.
        Clientes que estaban sin mapa y un vendedor ubicó desde la calle. Ya
        quedaron cargadas; esto es para que la oficina se entere de que pasó y
        quién fue. Borde verde (= hecho) para distinguirlas de las correcciones
        pendientes (rojo).
      */}
      {ubicaciones && ubicaciones.length > 0 ? (
        <section style={{ marginTop: 32 }}>
          <h2 style={{ marginBottom: 4 }}>📍 Ubicaciones nuevas cargadas por vendedores</h2>
          <p style={{ fontSize: 13, color: 'var(--tinta-suave)', marginTop: 0 }}>
            Clientes que estaban sin mapa y un vendedor ubicó desde la calle (últimos 15 días). Ya
            quedaron cargadas: es solo para que te enteres, no hay que aprobar nada.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
            {ubicaciones.map((u) => (
              <div
                key={u.id}
                className="tarjeta"
                style={{ padding: 12, borderRadius: 8, borderLeft: '5px solid #2E7D32' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <strong>
                    {u.cliente?.razon_social ?? 'Cliente'}
                    {u.cliente?.codigo ? <span style={{ color: 'var(--tinta-suave)' }}> · {u.cliente.codigo}</span> : null}
                  </strong>
                  <span style={{ fontSize: 12, color: 'var(--tinta-suave)' }}>
                    {u.vendedor?.nombre_completo ?? 'Vendedor'}
                    {u.vendedor?.codigo_vendedor ? ` (#${u.vendedor.codigo_vendedor})` : ''} ·{' '}
                    {new Date(u.creado_en).toLocaleString('es-AR')}
                  </span>
                </div>
                <div style={{ marginTop: 6, fontSize: 14 }}>📍 {u.direccion_propuesta}</div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </>
  )
}
