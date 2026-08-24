import {
  ETIQUETA_ESTADO_PARADA,
  fechaLocalISO,
  formatearHora,
  type Cliente,
  type Direccion,
  type ParadaCompleta,
  type Perfil,
  type PrioridadParada,
  type RolVisita,
} from '@woodtools/compartido'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'

import { supabase } from '../nucleo/supabase'

/** Cuántas filas se traen por consulta. El resto se alcanza buscando. */
const VENTANA = 200

/** Cuántas se dibujan. Más que esto es scroll, no ayuda para elegir una. */
const MOSTRAR = 40

/**
 * Armado e impresión del Rol de Visita.
 *
 * Reemplaza la planilla en papel: se elige el vendedor y el día, se agregan los
 * clientes a visitar, se ordena la ruta y se imprime. Una vez que el vendedor
 * arranca, esta misma pantalla muestra cómo se va completando.
 */
export function PaginaRolesDeVisita({ soloLectura }: { soloLectura: boolean }) {
  const cliente = useQueryClient()
  const [vendedorId, setVendedorId] = useState('')
  // En el calendario de acá y no en UTC: después de las 21:00 `toISOString()`
  // devuelve mañana, y la pantalla abría en el día equivocado — decía que el
  // vendedor no tenía rol y ofrecía crearle uno para el día siguiente.
  const [fecha, setFecha] = useState(() => fechaLocalISO(new Date()))
  const [busqueda, setBusqueda] = useState('')
  const [mensaje, setMensaje] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { data: vendedores } = useQuery({
    queryKey: ['vendedores'],
    queryFn: async () => {
      const { data, error: err } = await supabase
        .from('perfiles')
        .select('id, nombre_completo, codigo_vendedor')
        .eq('rol', 'vendedor')
        .eq('estado', 'aprobado')
        .order('codigo_vendedor')
      if (err) throw err
      return data as Pick<Perfil, 'id' | 'nombre_completo' | 'codigo_vendedor'>[]
    },
  })

  const { data: jornada, isLoading } = useQuery({
    queryKey: ['rol-visita', vendedorId, fecha],
    queryFn: async () => {
      const { data: rol, error: err } = await supabase
        .from('roles_visita')
        .select('*')
        .eq('vendedor_id', vendedorId)
        .eq('fecha', fecha)
        .maybeSingle<RolVisita>()
      if (err) throw err
      if (!rol) return null

      const { data: paradas, error: errParadas } = await supabase
        .from('paradas')
        .select('*, cliente:clientes ( * ), direccion:direcciones ( * ), visita:visitas ( * )')
        .eq('rol_visita_id', rol.id)
        .order('orden')
      if (errParadas) throw errParadas

      return {
        rol,
        paradas: (paradas ?? []).map((p: Record<string, unknown>) => ({
          ...p,
          visita: Array.isArray(p.visita) ? (p.visita[0] ?? null) : p.visita,
        })) as ParadaCompleta[],
      }
    },
    enabled: !!vendedorId,
  })

  // Debounce: la búsqueda es una consulta al servidor, no un filtro en memoria.
  const [termino, setTermino] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setTermino(busqueda.trim()), 300)
    return () => clearTimeout(t)
  }, [busqueda])

  /**
   * Los clientes que se pueden meter en un recorrido.
   *
   * Esto bajaba la tabla entera y filtraba en el navegador. PostgREST corta en
   * 1.000 filas y la cartera son 12.181 desde que se importó el padrón, así que
   * el buscador sólo encontraba lo que cayera en ese primer millar por orden
   * alfabético: todo lo que empieza con una letra avanzada era invisible, y sin
   * ningún cartel que lo dijera. Es el mismo problema que ya estaba corregido
   * en la pantalla de Clientes.
   *
   * `direcciones!inner` reemplaza al filtro en memoria: un cliente sin
   * coordenadas no entra a un recorrido —la ruta se calcula sobre lat/lng— así
   * que los descarta la base y no gastan lugar de la ventana.
   */
  const { data: clientes } = useQuery({
    queryKey: ['clientes-con-direccion', termino],
    queryFn: async () => {
      let consulta = supabase
        .from('clientes')
        .select('*, direcciones!inner ( * )')
        .eq('activo', true)
        .order('razon_social')
        .limit(VENTANA)

      if (termino) {
        // `or` de PostgREST separa por comas, así que una coma en el término
        // partiría el filtro en dos condiciones inválidas.
        const limpio = termino.replace(/[,()]/g, ' ')
        consulta = consulta.or(
          [
            `codigo.ilike.%${limpio}%`,
            `razon_social.ilike.%${limpio}%`,
            `nombre_fantasia.ilike.%${limpio}%`,
          ].join(','),
        )
      }

      const { data, error: err } = await consulta
      if (err) throw err
      return data as Array<Cliente & { direcciones: Direccion[] }>
    },
    enabled: !!vendedorId,
  })

  const disponibles = useMemo(() => {
    const yaCargados = new Set((jornada?.paradas ?? []).map((p) => p.cliente_id))
    return (clientes ?? []).filter((c) => !yaCargados.has(c.id))
  }, [clientes, jornada])

  const candidatos = useMemo(() => disponibles.slice(0, MOSTRAR), [disponibles])
  /** Cuántos quedaron afuera. Recortar sin decirlo se lee como "no hay más". */
  const ocultos = disponibles.length - candidatos.length

  const crearJornada = useMutation({
    mutationFn: async () => {
      const { error: err } = await supabase
        .from('roles_visita')
        .insert({ vendedor_id: vendedorId, fecha, estado: 'planificado' })
      if (err) throw err
    },
    onSuccess: () => void cliente.invalidateQueries({ queryKey: ['rol-visita'] }),
    onError: (e: Error) => setError(e.message),
  })

  const agregar = useMutation({
    mutationFn: async (params: { cliente: Cliente & { direcciones: Direccion[] }; prioridad: PrioridadParada }) => {
      if (!jornada) throw new Error('Creá primero el rol de visita del día')

      const direccion =
        params.cliente.direcciones.find((d) => d.principal) ?? params.cliente.direcciones[0]

      const { error: err } = await supabase.rpc('agregar_parada', {
        p_rol_visita_id: jornada.rol.id,
        p_direccion_id: direccion.id,
        p_prioridad: params.prioridad,
        p_cliente_id: params.cliente.id,
      })
      if (err) throw err
    },
    onSuccess: () => {
      setMensaje('Cliente agregado al recorrido.')
      void cliente.invalidateQueries({ queryKey: ['rol-visita'] })
    },
    onError: (e: Error) => setError(e.message),
  })

  const quitar = useMutation({
    mutationFn: async (paradaId: string) => {
      const { error: err } = await supabase.from('paradas').delete().eq('id', paradaId)
      if (err) throw err
    },
    onSuccess: () => void cliente.invalidateQueries({ queryKey: ['rol-visita'] }),
    onError: (e: Error) => setError(e.message),
  })

  const optimizar = useMutation({
    mutationFn: async () => {
      if (!jornada) return
      const { error: err } = await supabase.functions.invoke('optimizar-ruta', {
        body: { rol_visita_id: jornada.rol.id },
      })
      if (err) throw err
    },
    onSuccess: () => {
      setMensaje('Recorrido ordenado por tiempo de manejo.')
      void cliente.invalidateQueries({ queryKey: ['rol-visita'] })
    },
    onError: (e: Error) =>
      setError(
        `${e.message}. Verificá que el vendedor tenga cargado un punto de partida en su perfil.`,
      ),
  })

  const vendedor = vendedores?.find((v) => v.id === vendedorId)

  // Abierto en el navegador no existe el puente con el sistema, así que el
  // botón no imprimía nada y tampoco lo decía: se tocaba tres veces esperando
  // que saliera algo. Mismo criterio que la cola de impresión.
  const puedeImprimir = typeof window.woodtools?.imprimir === 'function'

  return (
    <>
      <header className="encabezado-pagina">
        <div>
          <h1>Roles de visita</h1>
          <p>Armá el recorrido del día, ordenalo e imprimí la planilla.</p>
        </div>
        <div className="acciones">
          <button
            onClick={() => optimizar.mutate()}
            disabled={soloLectura || !jornada || jornada.paradas.length < 2 || optimizar.isPending}
          >
            {optimizar.isPending ? 'Ordenando…' : 'Ordenar por cercanía'}
          </button>
          <button
            className="rojo"
            onClick={() => void window.woodtools?.imprimir()}
            disabled={!jornada || !puedeImprimir}
            title={
              puedeImprimir
                ? undefined
                : 'Abrí el panel instalado en la PC de la oficina: desde el navegador no se puede imprimir.'
            }
          >
            Imprimir
          </button>
        </div>
      </header>

      {mensaje && <div className="aviso exito no-imprimir">{mensaje}</div>}
      {error && (
        <div className="aviso error no-imprimir" role="alert">
          {error}
        </div>
      )}

      <div className="tarjeta no-imprimir">
        <div className="fila">
          <div className="campo" style={{ marginBottom: 0 }}>
            <label htmlFor="vendedor">Vendedor</label>
            <select id="vendedor" value={vendedorId} onChange={(e) => setVendedorId(e.target.value)}>
              <option value="">Elegí un vendedor…</option>
              {vendedores?.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.codigo_vendedor ? `#${v.codigo_vendedor} · ` : ''}
                  {v.nombre_completo}
                </option>
              ))}
            </select>
          </div>
          <div className="campo" style={{ marginBottom: 0 }}>
            <label htmlFor="fecha">Fecha</label>
            <input id="fecha" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
          </div>
        </div>
      </div>

      {!vendedorId ? (
        <div className="tarjeta">
          <p className="vacio">Elegí un vendedor para ver o armar su rol de visita.</p>
        </div>
      ) : isLoading ? (
        <div className="tarjeta">
          <p>Cargando…</p>
        </div>
      ) : !jornada ? (
        <div className="tarjeta">
          <p className="vacio">
            {vendedor?.nombre_completo} no tiene rol de visita para el {fecha}.
          </p>
          <div style={{ textAlign: 'center' }}>
            <button className="primario" disabled={soloLectura} onClick={() => crearJornada.mutate()}>
              Crear el rol de visita
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* ── La planilla, tal cual sale impresa ─────────────────────────── */}
          <div className="hoja-impresion">
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
              <strong style={{ fontSize: 16 }}>ROL DE VISITA</strong>
              <div style={{ fontSize: 12 }}>
                <strong>FECHA:</strong> {new Date(`${fecha}T12:00:00`).toLocaleDateString('es-AR')}
                {'   '}
                <strong>VENDEDOR:</strong> {vendedor?.nombre_completo}
                {'   '}
                <strong>CÓDIGO:</strong> {vendedor?.codigo_vendedor ?? '—'}
              </div>
            </div>

            <table>
              <thead>
                <tr>
                  {/* Los mismos anchos y las mismas columnas que la planilla
                      compartida. Vive escrita dos veces —acá y en
                      `rol-de-visita-impresion.ts`— y ya se desalinearon una vez:
                      tocar una sola deja el mismo recorrido saliendo distinto
                      según quién apretó imprimir. */}
                  <th style={{ width: 24 }}>Nº</th>
                  <th style={{ width: 42 }}>Hora</th>
                  <th style={{ width: 48 }}>Cliente Nº</th>
                  <th style={{ width: 180 }}>Razón social o nombre</th>
                  <th style={{ width: 34 }}>Ven.</th>
                  <th style={{ width: 34 }}>Cob.</th>
                  <th style={{ width: 34 }}>Afil.</th>
                  <th style={{ width: 34 }}>Ent.</th>
                  <th style={{ width: 100 }}>Contacto</th>
                  <th>Resultado (observaciones)</th>
                  <th className="no-imprimir" style={{ width: 80 }} />
                </tr>
              </thead>
              <tbody>
                {jornada.paradas.length === 0 ? (
                  <tr>
                    <td colSpan={11} style={{ textAlign: 'center', padding: 24 }}>
                      Todavía no hay destinos cargados.
                    </td>
                  </tr>
                ) : (
                  jornada.paradas.map((p) => (
                    <tr key={p.id}>
                      <td>{p.orden}</td>
                      <td>{p.llegada_en ? formatearHora(p.llegada_en) : ''}</td>
                      <td>{p.cliente?.codigo ?? ''}</td>
                      <td>{p.cliente?.razon_social ?? p.razon_social_snapshot ?? '—'}</td>
                      <td style={{ textAlign: 'center' }}>{p.visita?.vendio ? 'X' : ''}</td>
                      <td style={{ textAlign: 'center' }}>{p.visita?.cobro ? 'X' : ''}</td>
                      <td style={{ textAlign: 'center' }}>{p.visita?.retiro_afilado ? 'X' : ''}</td>
                      <td style={{ textAlign: 'center' }}>{p.visita?.entrego ? 'X' : ''}</td>
                      <td>{p.visita?.contacto_nombre ?? p.cliente?.contacto_nombre ?? ''}</td>
                      <td>
                        {p.visita?.observacion ??
                          (p.estado === 'pendiente' || p.estado === 'en_camino'
                            ? ''
                            : ETIQUETA_ESTADO_PARADA[p.estado])}
                      </td>
                      <td className="no-imprimir">
                        <button
                          className="chico peligro"
                          disabled={soloLectura || p.estado === 'visitada' || p.estado === 'no_visitada'}
                          onClick={() => quitar.mutate(p.id)}
                        >
                          Quitar
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* ── Agregar clientes ───────────────────────────────────────────── */}
          <section className="tarjeta no-imprimir" style={{ marginTop: 18 }}>
            <h2>Agregar clientes al recorrido</h2>

            <input
              placeholder="Buscar cliente por código o razón social…"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              style={{ marginBottom: 14 }}
              aria-label="Buscar cliente"
            />

            {candidatos.length === 0 ? (
              <p className="vacio">
                {termino
                  ? `Ningún cliente ubicado en el mapa coincide con "${termino}".`
                  : 'No hay clientes con dirección cargada. Cargá primero las direcciones desde Clientes.'}
              </p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Cliente Nº</th>
                    <th>Razón social</th>
                    <th>Dirección</th>
                    <th style={{ width: 280 }}>Agregar con prioridad</th>
                  </tr>
                </thead>
                <tbody>
                  {candidatos.map((c) => {
                    const d = c.direcciones.find((x) => x.principal) ?? c.direcciones[0]
                    return (
                      <tr key={c.id}>
                        <td>
                          <code>{c.codigo}</code>
                        </td>
                        <td>{c.razon_social}</td>
                        <td>
                          <small>{d.direccion_formateada}</small>
                        </td>
                        <td>
                          <div className="acciones">
                            {(['alta', 'media', 'baja'] as const).map((p) => (
                              <button
                                key={p}
                                className="chico"
                                disabled={soloLectura || agregar.isPending}
                                onClick={() => agregar.mutate({ cliente: c, prioridad: p })}
                              >
                                {p.toUpperCase()}
                              </button>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}

            {/* Recortar la lista sin decirlo se lee como "no hay más": el que
                busca a un cliente que no ve concluye que no está cargado. */}
            {ocultos > 0 ? (
              <p style={{ color: 'var(--tinta-suave)', fontSize: 13 }}>
                Se muestran {candidatos.length} de {disponibles.length}
                {disponibles.length === VENTANA ? ' o más' : ''}. Escribí el código o el nombre para
                achicar la lista.
              </p>
            ) : null}
          </section>
        </>
      )}
    </>
  )
}
