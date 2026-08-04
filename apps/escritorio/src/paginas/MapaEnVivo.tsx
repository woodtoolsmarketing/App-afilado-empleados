import type { PosicionActual } from '@woodtools/compartido'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import L from 'leaflet'
import { useEffect, useState } from 'react'
import { MapContainer, Marker, Polyline, Popup, TileLayer } from 'react-leaflet'

import { supabase } from '../nucleo/supabase'

/**
 * Mapa en vivo.
 *
 * Cada vendedor en recorrido aparece con su foto dentro de un círculo, como en
 * las apps de reparto. La posición llega por Realtime desde
 * `posiciones_actuales`, que tiene una sola fila por vendedor: por eso el canal
 * se mantiene liviano aunque el histórico crezca.
 */

type PosicionConPerfil = PosicionActual & {
  perfiles: { nombre_completo: string; codigo_vendedor: string | null; foto_url: string | null } | null
}

const CENTRO_AMBA: [number, number] = [-34.6037, -58.3816]

export function PaginaMapaEnVivo() {
  const cliente = useQueryClient()
  const [seleccionado, setSeleccionado] = useState<string | null>(null)

  const { data: posiciones } = useQuery({
    queryKey: ['posiciones-actuales'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('posiciones_actuales')
        .select('*, perfiles:vendedor_id ( nombre_completo, codigo_vendedor, foto_url )')
        .eq('en_recorrido', true)
      if (error) throw error
      return data as PosicionConPerfil[]
    },
    refetchInterval: 30_000,
  })

  // Traza del recorrido del vendedor seleccionado.
  const { data: traza } = useQuery({
    queryKey: ['traza', seleccionado],
    queryFn: async () => {
      const posicion = posiciones?.find((p) => p.vendedor_id === seleccionado)
      if (!posicion?.rol_visita_id) return []

      const { data, error } = await supabase
        .from('posiciones')
        .select('lat, lng')
        .eq('rol_visita_id', posicion.rol_visita_id)
        .order('registrado_en', { ascending: true })
        .limit(2000)
      if (error) throw error
      return (data ?? []).map((p) => [p.lat, p.lng] as [number, number])
    },
    enabled: !!seleccionado,
  })

  // Suscripción en vivo: cada UPSERT de posición refresca el mapa sin esperar
  // al refetch periódico.
  useEffect(() => {
    const canal = supabase
      .channel('posiciones-en-vivo')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'posiciones_actuales' },
        () => void cliente.invalidateQueries({ queryKey: ['posiciones-actuales'] }),
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(canal)
    }
  }, [cliente])

  const activos = posiciones ?? []

  return (
    <>
      <header className="encabezado-pagina">
        <div>
          <h1>Mapa en vivo</h1>
          <p>
            {activos.length === 0
              ? 'Ningún vendedor tiene el recorrido en curso en este momento.'
              : `${activos.length} vendedor${activos.length === 1 ? '' : 'es'} en la calle.`}
          </p>
        </div>
      </header>

      <div className="mapa">
        <MapContainer center={CENTRO_AMBA} zoom={11} style={{ height: '100%', width: '100%' }}>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          {seleccionado && traza && traza.length > 1 ? (
            <Polyline positions={traza} color="#1d6fe0" weight={4} opacity={0.75} />
          ) : null}

          {activos.map((p) => (
            <Marker
              key={p.vendedor_id}
              position={[p.lat, p.lng]}
              icon={iconoVendedor(p)}
              eventHandlers={{ click: () => setSeleccionado(p.vendedor_id) }}
            >
              <Popup>
                <strong>{p.perfiles?.nombre_completo ?? 'Vendedor'}</strong>
                {p.perfiles?.codigo_vendedor ? ` (#${p.perfiles.codigo_vendedor})` : ''}
                <br />
                Actualizado:{' '}
                {new Date(p.actualizado_en).toLocaleTimeString('es-AR', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
                <br />
                {p.velocidad_mps !== null
                  ? `Velocidad: ${Math.round(p.velocidad_mps * 3.6)} km/h`
                  : 'Detenido'}
                {p.bateria_pct !== null ? <> · Batería: {p.bateria_pct}%</> : null}
                <br />
                <button
                  className="chico"
                  style={{ marginTop: 6 }}
                  onClick={() => setSeleccionado(p.vendedor_id)}
                >
                  Ver su recorrido
                </button>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>

      {seleccionado ? (
        <div className="aviso" style={{ marginTop: 16 }}>
          Mostrando el recorrido de{' '}
          <strong>
            {activos.find((p) => p.vendedor_id === seleccionado)?.perfiles?.nombre_completo ?? '—'}
          </strong>
          .{' '}
          <button className="chico" onClick={() => setSeleccionado(null)}>
            Quitar traza
          </button>
        </div>
      ) : null}

      <section className="tarjeta" style={{ marginTop: 18 }}>
        <h2>Vendedores en recorrido</h2>

        {activos.length === 0 ? (
          <p className="vacio">Nadie inició el recorrido todavía.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Vendedor</th>
                <th>Última señal</th>
                <th>Velocidad</th>
                <th>Precisión</th>
                <th>Batería</th>
              </tr>
            </thead>
            <tbody>
              {activos.map((p) => {
                const minutos = Math.floor((Date.now() - new Date(p.actualizado_en).getTime()) / 60_000)
                return (
                  <tr key={p.vendedor_id} onClick={() => setSeleccionado(p.vendedor_id)}>
                    <td>
                      {p.perfiles?.nombre_completo ?? '—'}
                      {p.perfiles?.codigo_vendedor ? ` (#${p.perfiles.codigo_vendedor})` : ''}
                    </td>
                    <td>
                      {minutos < 2 ? (
                        <span className="pastilla verde">Ahora</span>
                      ) : minutos < 10 ? (
                        <span className="pastilla azul">Hace {minutos} min</span>
                      ) : (
                        // Sin señal hace rato: puede ser un túnel, o que Android
                        // haya matado el servicio en segundo plano.
                        <span className="pastilla ambar">Hace {minutos} min</span>
                      )}
                    </td>
                    <td>{p.velocidad_mps !== null ? `${Math.round(p.velocidad_mps * 3.6)} km/h` : '—'}</td>
                    <td>{p.precision_m !== null ? `±${Math.round(p.precision_m)} m` : '—'}</td>
                    <td>{p.bateria_pct !== null ? `${p.bateria_pct}%` : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </section>
    </>
  )
}

/** Círculo con la foto del vendedor, o sus iniciales si no tiene foto cargada. */
function iconoVendedor(p: PosicionConPerfil): L.DivIcon {
  const nombre = p.perfiles?.nombre_completo ?? '?'
  const iniciales = nombre
    .split(/\s+/)
    .slice(0, 2)
    .map((x) => x[0]?.toUpperCase() ?? '')
    .join('')

  const interior = p.perfiles?.foto_url
    ? `<img src="${escapar(p.perfiles.foto_url)}" width="44" height="44" class="marcador-vendedor" alt="" />`
    : `<div class="marcador-vendedor" style="width:44px;height:44px;display:grid;place-items:center;font-weight:800;color:#B30F0F;font-family:system-ui">${iniciales}</div>`

  return L.divIcon({
    html: interior,
    className: '',
    iconSize: [44, 44],
    iconAnchor: [22, 22],
    popupAnchor: [0, -24],
  })
}

function escapar(s: string): string {
  return s.replace(/"/g, '&quot;').replace(/</g, '&lt;')
}
