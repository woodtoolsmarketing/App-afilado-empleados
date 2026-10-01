import { fechaLocalISO } from '@woodtools/compartido'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import ExcelJS from 'exceljs'
import L from 'leaflet'
import { useEffect, useState } from 'react'
import { MapContainer, Marker, TileLayer, Tooltip, useMap } from 'react-leaflet'

import { supabase } from '../nucleo/supabase'

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
      const base = supabase.from('cambios_direccion').select(SELECT).order('creado_en', { ascending: false })
      const { data, error: err } = verResueltos ? await base.limit(100) : await base.eq('estado', 'pendiente')
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
    mutationFn: async (id: string) => {
      const { error: err } = await supabase.rpc('aplicar_cambio_direccion', { p_id: id })
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
          {cambios.map((c) => {
            const actual: [number, number] | null =
              c.direccion?.lat != null && c.direccion?.lng != null ? [c.direccion.lat, c.direccion.lng] : null
            const nueva: [number, number] | null =
              c.lat_propuesta != null && c.lng_propuesta != null ? [c.lat_propuesta, c.lng_propuesta] : null
            const pendiente = c.estado === 'pendiente'

            return (
              <div key={c.id} className="tarjeta" style={{ padding: 16, borderRadius: 10 }}>
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

                <div style={{ marginTop: 10, fontSize: 14 }}>
                  <div style={{ color: 'var(--tinta-suave)' }}>Registrada hoy</div>
                  <div>{c.direccion?.direccion_formateada ?? '— (el cliente no tenía dirección cargada)'}</div>
                  <div style={{ color: 'var(--tinta-suave)', marginTop: 8 }}>Propuesta por el vendedor</div>
                  <div style={{ fontWeight: 600 }}>{c.direccion_propuesta}</div>
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
                ) : rechazando === c.id ? (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    <input
                      type="text"
                      placeholder="Motivo del rechazo (opcional)"
                      value={motivos[c.id] ?? ''}
                      onChange={(e) => setMotivos((m) => ({ ...m, [c.id]: e.target.value }))}
                      style={{ flex: 1, minWidth: 220 }}
                    />
                    <button
                      className="primario"
                      disabled={trabajando}
                      onClick={() => rechazar.mutate({ id: c.id, motivo: motivos[c.id] ?? '' })}
                    >
                      Confirmar rechazo
                    </button>
                    <button className="chico" disabled={trabajando} onClick={() => setRechazando(null)}>
                      Volver
                    </button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="primario" disabled={trabajando} onClick={() => aplicar.mutate(c.id)}>
                      ✓ Aplicar a la base
                    </button>
                    <button className="chico" disabled={trabajando} onClick={() => setRechazando(c.id)}>
                      Rechazar
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}
