import {
  describirHorarioSeguimiento,
  enHorarioDeSeguimiento,
  HORARIO_SEGUIMIENTO_DEFECTO,
  horarioSeguimientoDesde,
  urlesDeFotos,
  versionAtrasada,
  type PosicionActual,
} from '@woodtools/compartido'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import L from 'leaflet'
import { useEffect, useState } from 'react'
import { MapContainer, Marker, Popup, TileLayer } from 'react-leaflet'

import { supabase } from '../nucleo/supabase'

/**
 * Cuánto puede tardar la última señal antes de dejar de mostrar al vendedor.
 * Es sólo una red de seguridad contra pines fantasma (una app que se murió a
 * mitad del recorrido y quedó marcada como activa): un vendedor de verdad en
 * recorrido reporta mucho más seguido, así que esto nunca lo oculta.
 */
const FRESCURA_MINUTOS = 180

/**
 * La primera build de flota que trae el seguimiento por horario. Un teléfono con
 * una APK anterior nunca manda posición continua aunque tenga el flag prendido:
 * le falta el código. Por eso lo marcamos como "APK vieja" en el diagnóstico.
 */
const MIN_APK_SEGUIMIENTO = '2.3.0'

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
  /**
   * La foto ya firmada. `foto_url` es la ruta dentro del bucket privado y no
   * sirve como `src`: el marcador salía siempre con las iniciales.
   */
  foto_firmada?: string | null
}

/** Una fila del diagnóstico "con seguimiento pero sin señal". */
type EstadoSeguimiento = {
  id: string
  nombre_completo: string
  codigo_vendedor: string | null
  rol: string
  estado: string
  version_app: string | null
  pos: { activo: boolean; actualizado_en: string } | null
}

type MotivoSeguimiento = { texto: string; nivel: 'alto' | 'medio' }

const CENTRO_AMBA: [number, number] = [-34.6037, -58.3816]

export function PaginaMapaEnVivo() {
  const cliente = useQueryClient()

  // El horario de seguimiento configurado (lun-vie 8-17 por defecto). El panel
  // decide mostrar o no con SU propio reloj.
  const { data: horario } = useQuery({
    queryKey: ['seguimiento-horario'],
    queryFn: async () => {
      const { data } = await supabase
        .from('configuracion')
        .select('valor')
        .eq('clave', 'seguimiento_horario')
        .maybeSingle()
      return horarioSeguimientoDesde((data as { valor: unknown } | null)?.valor)
    },
  })
  const horarioVigente = horario ?? HORARIO_SEGUIMIENTO_DEFECTO

  // Un tic para reevaluar el reloj y ocultar/mostrar al cruzar las 8 o las 17.
  const [ahora, setAhora] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setAhora(new Date()), 30_000)
    return () => clearInterval(t)
  }, [])
  const dentroDeHorario = enHorarioDeSeguimiento(ahora, horarioVigente)

  const { data: posiciones } = useQuery({
    queryKey: ['posiciones-actuales'],
    queryFn: async () => {
      const desde = new Date(Date.now() - FRESCURA_MINUTOS * 60_000).toISOString()
      const { data, error } = await supabase
        .from('posiciones_actuales')
        .select('*, perfiles:vendedor_id ( nombre_completo, codigo_vendedor, foto_url )')
        .eq('activo', true)
        .gte('actualizado_en', desde)
      if (error) throw error

      // El bucket de fotos es privado: hay que pedir una URL firmada por cada
      // ruta antes de armar los marcadores.
      const filas = (data ?? []) as PosicionConPerfil[]
      const firmadas = await urlesDeFotos(
        supabase,
        filas.map((f) => f.perfiles?.foto_url),
      )
      return filas.map((f) => ({
        ...f,
        foto_firmada: f.perfiles?.foto_url ? (firmadas.get(f.perfiles.foto_url) ?? null) : null,
      }))
    },
    refetchInterval: 30_000,
  })

  // Diagnóstico "con seguimiento pero sin señal": quién tiene el flag prendido
  // pero NO está apareciendo, y por qué. Cruza el flag (perfiles) con la última
  // posición y la versión de APK del teléfono. La causa casi siempre está en el
  // teléfono (APK vieja, permiso de fondo, o la app cerrada), no en la base.
  const { data: diagnostico } = useQuery({
    queryKey: ['seguimiento-sin-senal'],
    queryFn: async (): Promise<EstadoSeguimiento[]> => {
      const { data: perfilesData, error } = await supabase
        .from('perfiles')
        .select('id, nombre_completo, codigo_vendedor, rol, estado, seguimiento_24_7')
        .eq('seguimiento_24_7', true)
      if (error) throw error
      const perfiles = (perfilesData ?? []) as unknown as {
        id: string
        nombre_completo: string
        codigo_vendedor: string | null
        rol: string
        estado: string
      }[]
      if (perfiles.length === 0) return []
      const ids = perfiles.map((p) => p.id)

      const [posRes, dispRes] = await Promise.all([
        supabase.from('posiciones_actuales').select('vendedor_id, activo, actualizado_en').in('vendedor_id', ids),
        supabase
          .from('dispositivos')
          .select('perfil_id, version_app, ultimo_visto_en')
          .in('perfil_id', ids)
          .order('ultimo_visto_en', { ascending: false, nullsFirst: false }),
      ])
      if (posRes.error) throw posRes.error
      if (dispRes.error) throw dispRes.error

      const pos = (posRes.data ?? []) as unknown as {
        vendedor_id: string
        activo: boolean
        actualizado_en: string
      }[]
      const disp = (dispRes.data ?? []) as unknown as { perfil_id: string; version_app: string | null }[]

      const posPorId = new Map<string, { activo: boolean; actualizado_en: string }>(
        pos.map((r) => [r.vendedor_id, { activo: r.activo, actualizado_en: r.actualizado_en }]),
      )
      // Vienen ordenados por ultimo_visto_en desc: el primero de cada perfil es su teléfono más reciente.
      const versionPorId = new Map<string, string | null>()
      for (const d of disp) if (!versionPorId.has(d.perfil_id)) versionPorId.set(d.perfil_id, d.version_app)

      return perfiles.map((p) => ({
        id: p.id,
        nombre_completo: p.nombre_completo,
        codigo_vendedor: p.codigo_vendedor,
        rol: p.rol,
        estado: p.estado,
        version_app: versionPorId.get(p.id) ?? null,
        pos: posPorId.get(p.id) ?? null,
      }))
    },
    refetchInterval: 60_000,
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

  // Fuera del horario no se muestra a nadie, aunque queden posiciones frescas.
  const activos = dentroDeHorario ? (posiciones ?? []) : []

  return (
    <>
      <header className="encabezado-pagina">
        <div>
          <h1>Mapa en vivo</h1>
          <p>
            {!dentroDeHorario
              ? `Fuera del horario de seguimiento (${describirHorarioSeguimiento(horarioVigente)}). No se muestra la ubicación de nadie.`
              : activos.length === 0
                ? 'Ningún vendedor está activo en este momento.'
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

          {activos.map((p) => (
            <Marker key={p.vendedor_id} position={[p.lat, p.lng]} icon={iconoVendedor(p)}>
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
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>

      <section className="tarjeta" style={{ marginTop: 18 }}>
        <h2>Vendedores en la calle</h2>

        {activos.length === 0 ? (
          <p className="vacio">
            {dentroDeHorario
              ? 'Ningún vendedor está activo en este momento.'
              : `Fuera del horario de seguimiento (${describirHorarioSeguimiento(horarioVigente)}).`}
          </p>
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
                  <tr key={p.vendedor_id}>
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

      {(() => {
        const sinSenal = (diagnostico ?? [])
          .map((u) => ({ u, motivo: motivoSinSenal(u, dentroDeHorario) }))
          .filter(
            (x): x is { u: EstadoSeguimiento; motivo: MotivoSeguimiento } => x.motivo !== null,
          )
          .sort((a, b) => (a.motivo.nivel === b.motivo.nivel ? 0 : a.motivo.nivel === 'alto' ? -1 : 1))
        if (sinSenal.length === 0) return null
        return (
          <section className="tarjeta" style={{ marginTop: 18 }}>
            <h2>Con seguimiento, pero sin señal ({sinSenal.length})</h2>
            <p className="vacio" style={{ marginBottom: 12 }}>
              Tienen el seguimiento prendido pero no están apareciendo en el mapa. El motivo casi
              siempre está en el teléfono: una APK vieja (sin la feature), el permiso de ubicación en
              “Permitir siempre” sin conceder, o la app cerrada por el ahorro de batería.
            </p>
            <table>
              <thead>
                <tr>
                  <th>Usuario</th>
                  <th>Rol</th>
                  <th>APK</th>
                  <th>Motivo</th>
                  <th>Última señal</th>
                </tr>
              </thead>
              <tbody>
                {sinSenal.map(({ u, motivo }) => (
                  <tr key={u.id}>
                    <td>
                      {u.nombre_completo}
                      {u.codigo_vendedor ? ` (#${u.codigo_vendedor})` : ''}
                    </td>
                    <td>{u.rol}</td>
                    <td>{u.version_app ?? '—'}</td>
                    <td>
                      <span className={`pastilla ${motivo.nivel === 'alto' ? 'roja' : 'ambar'}`}>
                        {motivo.texto}
                      </span>
                    </td>
                    <td>
                      {u.pos?.actualizado_en
                        ? new Date(u.pos.actualizado_en).toLocaleString('es-AR', {
                            day: '2-digit',
                            month: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : 'nunca'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )
      })()}
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

  const interior = p.foto_firmada
    ? `<img src="${escapar(p.foto_firmada)}" width="44" height="44" class="marcador-vendedor" alt="" />`
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

/**
 * Por qué un usuario con el seguimiento prendido NO está apareciendo en el mapa.
 * Devuelve null si está apareciendo —o si, fuera de horario, está simplemente en
 * pausa, que no es un problema—. Los motivos "alto" (estructurales: APK vieja,
 * sin teléfono, perfil no aprobado) se muestran siempre; los "medio" (transitorios:
 * app cerrada, señal vieja) sólo dentro del horario.
 */
function motivoSinSenal(u: EstadoSeguimiento, dentroDeHorario: boolean): MotivoSeguimiento | null {
  if (u.estado !== 'aprobado') return { texto: 'Perfil no aprobado', nivel: 'alto' }
  if (!u.version_app) return { texto: 'Sin teléfono registrado', nivel: 'alto' }
  if (versionAtrasada(u.version_app, MIN_APK_SEGUIMIENTO))
    return { texto: `APK ${u.version_app} — vieja, sin seguimiento`, nivel: 'alto' }
  if (!u.pos) return { texto: 'Nunca mandó posición (¿permiso de ubicación?)', nivel: 'alto' }

  // Tiene una APK con la feature y ya mandó alguna vez. Fuera de horario el
  // seguimiento está pausado para todos: no es un problema que reportar.
  if (!dentroDeHorario) return null

  if (!u.pos.activo) return { texto: 'App cerrada o detenida', nivel: 'medio' }
  const minutos = Math.floor((Date.now() - new Date(u.pos.actualizado_en).getTime()) / 60_000)
  if (minutos > FRESCURA_MINUTOS) return { texto: `Señal vieja (${describirHace(minutos)})`, nivel: 'medio' }
  return null // activo y fresco → está apareciendo en el mapa
}

/** "hace 45 min" / "hace 3 h" / "hace 2 d" para un lapso en minutos. */
function describirHace(minutos: number): string {
  if (minutos < 120) return `hace ${minutos} min`
  const horas = Math.floor(minutos / 60)
  if (horas < 48) return `hace ${horas} h`
  return `hace ${Math.floor(horas / 24)} d`
}
