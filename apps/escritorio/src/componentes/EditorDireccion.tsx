import L from 'leaflet'
import { useEffect, useState } from 'react'
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet'

import { ubicacionComoDireccion } from '../servicios/geocodificar'

/**
 * Una dirección que se está cargando/editando en el panel, con su punto en el
 * mapa. Es el mismo dato de la tabla `direcciones`, pero con lat/lng como número
 * o `null` (todavía sin pin) y una marca de si el que carga ya confirmó que la
 * calle y la altura que resolvió Google son las correctas.
 */
export interface DireccionEditable {
  /** id de la fila en `direcciones`; `undefined` si es nueva. */
  id?: string
  etiqueta: string
  direccion: string
  codigo_postal: string
  lat: number | null
  lng: number | null
  google_place_id: string | null
  /** El que carga vio la dirección sugerida y confirmó que es ésa. */
  confirmada: boolean
}

/** Rafaela (Santa Fe): el centro de la zona, para cuando todavía no hay pin. */
const CENTRO_POR_DEFECTO: [number, number] = [-31.2515, -61.4917]

/**
 * Pin dibujado a mano: el icono por defecto de Leaflet apunta a imágenes que el
 * empaquetador no resuelve (salen rotas). Mismo patrón que el resto del panel.
 */
const PIN = L.divIcon({
  className: '',
  html: `<div style="width:20px;height:20px;border-radius:50% 50% 50% 0;background:#B30F0F;border:2px solid #fff;transform:rotate(-45deg);box-shadow:0 1px 4px rgba(0,0,0,.45)"></div>`,
  iconSize: [20, 20],
  iconAnchor: [10, 20],
})

/** Mueve el pin cuando se hace clic en cualquier parte del mapa. */
function ClicParaMover({ alElegir }: { alElegir: (p: [number, number]) => void }) {
  useMapEvents({
    click(e) {
      alElegir([e.latlng.lat, e.latlng.lng])
    },
  })
  return null
}

/**
 * Lleva el mapa al pin cuando aparece de golpe en otro lado —"usar mi ubicación
 * actual" o el primer pin—, pero NO mientras lo arrastran dentro de lo que ya se
 * ve: ahí el pin ya está a la vista y recentrar marearía.
 */
function Recentrar({ pos }: { pos: [number, number] | null }) {
  const mapa = useMap()
  useEffect(() => {
    if (pos && !mapa.getBounds().contains(pos)) {
      mapa.setView(pos, Math.max(mapa.getZoom(), 16))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos?.[0], pos?.[1]])
  return null
}

export function EditorDireccion({
  valor,
  alCambiar,
  alQuitar,
  esPrincipal,
}: {
  valor: DireccionEditable
  alCambiar: (v: DireccionEditable) => void
  alQuitar?: () => void
  esPrincipal: boolean
}) {
  const [buscando, setBuscando] = useState(false)
  const [sugerida, setSugerida] = useState<string | null>(null)
  const [errorMapa, setErrorMapa] = useState<string | null>(null)

  const pos: [number, number] | null =
    valor.lat !== null && valor.lng !== null ? [valor.lat, valor.lng] : null

  /**
   * Puso el pin (clic, arrastre o "mi ubicación"): se guardan esas coordenadas
   * —las que eligió, no las que Google redondea— y se le pregunta a Google qué
   * calle y altura hay ahí para que lo confirme. Mover el pin tira abajo la
   * confirmación: es otra dirección.
   */
  async function ponerPin([lat, lng]: [number, number]) {
    setErrorMapa(null)
    alCambiar({ ...valor, lat, lng, confirmada: false })
    setBuscando(true)
    try {
      const d = await ubicacionComoDireccion({ lat, lng })
      setSugerida(d.direccion_formateada)
      alCambiar({
        ...valor,
        lat,
        lng,
        direccion: d.direccion_formateada,
        codigo_postal: d.codigo_postal ?? valor.codigo_postal,
        google_place_id: d.google_place_id,
        confirmada: false,
      })
    } catch (e) {
      // Si Google falla, el pin igual queda puesto: pueden escribir la calle a
      // mano y confirmar. No se traba la carga por no poder resolver el texto.
      setSugerida(null)
      setErrorMapa((e as Error).message)
    } finally {
      setBuscando(false)
    }
  }

  function usarMiUbicacion() {
    setErrorMapa(null)
    if (!('geolocation' in navigator)) {
      setErrorMapa('Este dispositivo no permite tomar la ubicación actual. Marcá el punto en el mapa.')
      return
    }
    setBuscando(true)
    navigator.geolocation.getCurrentPosition(
      (p) => {
        void ponerPin([p.coords.latitude, p.coords.longitude])
      },
      (err) => {
        setBuscando(false)
        setErrorMapa(
          err.code === err.PERMISSION_DENIED
            ? 'No diste permiso de ubicación. Marcá el punto en el mapa, o permití la ubicación y probá de nuevo.'
            : 'No pudimos tomar tu ubicación. Marcá el punto en el mapa.',
        )
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
    )
  }

  return (
    <div
      style={{
        border: '1px solid var(--borde, #ccc)',
        borderRadius: 8,
        padding: 12,
        marginBottom: 12,
        background: 'var(--panel-claro, rgba(255,255,255,.02))',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        {esPrincipal ? (
          <strong>Dirección principal</strong>
        ) : (
          <div className="campo" style={{ flex: 1, margin: 0 }}>
            <label>Nombre del lugar de entrega</label>
            <input
              value={valor.etiqueta}
              onChange={(e) => alCambiar({ ...valor, etiqueta: e.target.value })}
              placeholder="Depósito, Sucursal centro…"
            />
          </div>
        )}
        {alQuitar ? (
          <button type="button" onClick={alQuitar} title="Quitar este lugar de entrega">
            ✕ Quitar
          </button>
        ) : null}
      </div>

      <div style={{ display: 'flex', gap: 8, margin: '10px 0' }}>
        <button type="button" onClick={usarMiUbicacion} disabled={buscando}>
          📍 Usar mi ubicación actual
        </button>
        <span style={{ fontSize: 13, color: 'var(--tinta-suave, #888)', alignSelf: 'center' }}>
          o hacé clic en el mapa / arrastrá el pin
        </span>
      </div>

      <div style={{ height: 240, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--borde, #ccc)' }}>
        <MapContainer
          center={pos ?? CENTRO_POR_DEFECTO}
          zoom={pos ? 16 : 13}
          style={{ height: '100%', width: '100%' }}
          scrollWheelZoom
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <ClicParaMover alElegir={(p) => void ponerPin(p)} />
          <Recentrar pos={pos} />
          {pos ? (
            <Marker
              position={pos}
              icon={PIN}
              draggable
              eventHandlers={{
                dragend: (e) => {
                  const m = e.target as L.Marker
                  const { lat, lng } = m.getLatLng()
                  void ponerPin([lat, lng])
                },
              }}
            />
          ) : null}
        </MapContainer>
      </div>

      {buscando ? (
        <p style={{ fontSize: 13, color: 'var(--tinta-suave, #888)', margin: '8px 0 0' }}>
          Buscando la dirección del punto…
        </p>
      ) : null}
      {errorMapa ? <div className="aviso atencion" style={{ marginTop: 8 }}>{errorMapa}</div> : null}
      {sugerida && !buscando ? (
        <p style={{ fontSize: 13, color: 'var(--tinta-suave, #888)', margin: '8px 0 0' }}>
          Google sugiere: <strong>{sugerida}</strong>. Corregila si hace falta y confirmá abajo.
        </p>
      ) : null}

      <div className="campo" style={{ marginTop: 10 }}>
        <label>Dirección (calle y altura)</label>
        <input
          value={valor.direccion}
          onChange={(e) => alCambiar({ ...valor, direccion: e.target.value })}
          placeholder="Marcá el punto en el mapa para que aparezca sola"
        />
      </div>

      <div className="fila">
        <div className="campo">
          <label>Código postal</label>
          <input
            value={valor.codigo_postal}
            onChange={(e) => alCambiar({ ...valor, codigo_postal: e.target.value })}
          />
        </div>
        <div className="campo">
          <label>Coordenadas</label>
          <input
            readOnly
            value={pos ? `${pos[0].toFixed(6)}, ${pos[1].toFixed(6)}` : 'Sin ubicar'}
            style={{ color: 'var(--tinta-suave, #888)' }}
          />
        </div>
      </div>

      {/* Confirmación obligatoria: igual que en la app, una ubicación propuesta
          no se guarda hasta que alguien la miró y dijo que es ésa. */}
      {pos ? (
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginTop: 6,
            padding: 8,
            borderRadius: 6,
            border: valor.confirmada ? '1px solid transparent' : '2px solid var(--rojo, #B30F0F)',
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={valor.confirmada}
            onChange={(e) => alCambiar({ ...valor, confirmada: e.target.checked })}
          />
          <span>Confirmo que ésta es la dirección correcta</span>
        </label>
      ) : null}
    </div>
  )
}
