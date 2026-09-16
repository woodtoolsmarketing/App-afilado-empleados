import { useQuery } from '@tanstack/react-query'
import L from 'leaflet'
import { useEffect } from 'react'
import { MapContainer, Marker, TileLayer, Tooltip, useMap } from 'react-leaflet'
import MarkerClusterGroup from 'react-leaflet-cluster'
import 'leaflet.markercluster/dist/MarkerCluster.css'
import 'leaflet.markercluster/dist/MarkerCluster.Default.css'

import { supabase } from '../nucleo/supabase'

/**
 * Mapa de clientes.
 *
 * Todos los clientes con coordenadas cargadas, sobre el mapa. Son casi diez mil,
 * así que van agrupados en racimos: de lejos se ven los racimos con la cantidad,
 * y al acercarse se abren en pines individuales. Cada pin, al pasarle el mouse,
 * muestra un recuadro con la razón social y el código.
 *
 * ─── Por qué el cartel aparece al pasar el mouse y no siempre ────────────────
 *
 * Con casi diez mil clientes, dibujar el recuadro de cada uno todo el tiempo es
 * una masa de texto pisado que no se lee. Al acercarse, los racimos se abren en
 * pocos pines, y el nombre y el código salen al apuntarlos. Así el dato está
 * cuando se lo busca y no estorba cuando no.
 *
 * ─── Por qué los datos vienen en un solo `jsonb` ─────────────────────────────
 *
 * PostgREST corta las consultas normales en 1.000 filas. El RPC
 * `clientes_en_mapa` devuelve todo adentro de un único valor —una fila— así que
 * no lo toca ese tope y llega el padrón entero de una.
 */

interface ClienteMapa {
  id: string
  codigo: string
  razon_social: string
  lat: number
  lng: number
}

/** Un punto de partida cualquiera: el mapa se reencuadra apenas llegan los datos. */
const CENTRO_ARGENTINA: [number, number] = [-38, -63]

/**
 * Pin rojo dibujado a mano.
 *
 * El icono por defecto de Leaflet apunta a imágenes que el empaquetador no
 * resuelve —salen rotas—, así que se dibuja con un `divIcon`, igual que los
 * marcadores del mapa en vivo.
 */
const iconoCliente = L.divIcon({
  className: '',
  html: '<div style="width:16px;height:16px;border-radius:50% 50% 50% 0;background:#B30F0F;border:2px solid #fff;transform:rotate(-45deg);box-shadow:0 1px 4px rgba(0,0,0,.45)"></div>',
  iconSize: [16, 16],
  iconAnchor: [8, 16],
})

/** Encuadra el mapa sobre todos los clientes una vez que llegan. */
function EncuadrarEnClientes({ puntos }: { puntos: ClienteMapa[] }) {
  const mapa = useMap()
  useEffect(() => {
    if (puntos.length === 0) return
    const limites = L.latLngBounds(puntos.map((p) => [p.lat, p.lng] as [number, number]))
    mapa.fitBounds(limites, { padding: [40, 40] })
  }, [puntos, mapa])
  return null
}

export function PaginaMapaClientes() {
  const {
    data: clientes,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['clientes-en-mapa'],
    queryFn: async (): Promise<ClienteMapa[]> => {
      const { data, error: err } = await supabase.rpc('clientes_en_mapa')
      if (err) throw err
      return (data ?? []) as ClienteMapa[]
    },
    // El padrón no se mueve de un minuto a otro; se cachea un rato.
    staleTime: 5 * 60 * 1000,
  })

  const puntos = clientes ?? []

  return (
    <>
      <header className="encabezado-pagina">
        <div>
          <h1>Mapa</h1>
          <p>
            Todos los clientes ubicados. Acercá para que los racimos se abran y ver cada uno con su
            razón social y su código.
          </p>
        </div>
        {!isLoading && !error ? (
          <span style={{ color: 'var(--tinta-suave)', fontSize: 13 }}>
            {puntos.length.toLocaleString('es-AR')} clientes en el mapa
          </span>
        ) : null}
      </header>

      {error ? (
        <div className="aviso error">
          No pudimos traer los clientes del mapa: {(error as Error).message}
        </div>
      ) : null}

      <div className="mapa">
        <MapContainer center={CENTRO_ARGENTINA} zoom={5} style={{ height: '100%', width: '100%' }}>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <EncuadrarEnClientes puntos={puntos} />
          <MarkerClusterGroup chunkedLoading maxClusterRadius={60}>
            {puntos.map((c) => (
              <Marker key={c.id} position={[c.lat, c.lng]} icon={iconoCliente}>
                <Tooltip direction="top" offset={[0, -14]} opacity={1}>
                  <strong>{c.razon_social}</strong>
                  <br />
                  Código: {c.codigo}
                </Tooltip>
              </Marker>
            ))}
          </MarkerClusterGroup>
        </MapContainer>
      </div>

      {isLoading ? (
        <div className="aviso" style={{ marginTop: 12 }}>
          Cargando los clientes del mapa…
        </div>
      ) : null}
    </>
  )
}
