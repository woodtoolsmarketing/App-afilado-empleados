import {
  etiquetaDeOpcion,
  fechaLocalISO,
  OPCIONES_APP,
  OPCIONES_PANEL,
  type PlataformaTelemetria,
} from '@woodtools/compartido'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import ExcelJS from 'exceljs'
import { useMemo, useState } from 'react'

import { supabase } from '../nucleo/supabase'

/**
 * Reporte y MAPA DE CALOR de tiempos de uso.
 *
 * Muestra cuánto tiempo pasa cada usuario en cada opción de la app y en cada
 * sección del panel (y, donde hay sub-pasos, en cada uno: p.ej. los pasos de la
 * nota de pedido). Lo ven sólo Admin Master y Ariel Sosa #12 (flag
 * `perfiles.ve_reporte_tiempos`); el acceso a la ruta ya está gateado en App.tsx
 * y la RPC vuelve a chequear el permiso del lado del servidor.
 *
 * El dato sale agregado de la RPC `heatmap_telemetria` (eventos, total, promedio,
 * mediana, p95 y el objetivo por opción). El "objetivo" se fija acá mismo con
 * `fijar_objetivo_tiempo`: el mapa pinta en rojo lo que lo supera.
 */

type Metrica = 'promedio_ms' | 'total_ms' | 'mediana_ms' | 'p95_ms'

interface FilaHeatmap {
  perfil_id: string
  nombre: string
  codigo_vendedor: string | null
  plataforma: PlataformaTelemetria
  seccion: string
  paso: string | null
  eventos: number | string
  total_ms: number | string
  promedio_ms: number | string
  mediana_ms: number | string
  p95_ms: number | string
  objetivo_ms: number | null
  ultimo: string | null
}

const num = (v: number | string | null | undefined): number => {
  const x = typeof v === 'string' ? Number(v) : (v ?? 0)
  return Number.isFinite(x) ? x : 0
}

/** ms → "45s" / "1m 20s" / "2h 3m". Vacío si es 0. */
function formatearDuracion(ms: number): string {
  if (!ms) return '—'
  const seg = Math.round(ms / 1000)
  if (seg < 60) return `${seg}s`
  const min = Math.floor(seg / 60)
  const s = seg % 60
  if (min < 60) return s ? `${min}m ${s}s` : `${min}m`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `${h}h ${m}m` : `${h}h`
}

/**
 * Color de una celda del mapa: verde (poco) → rojo (mucho). Si la opción tiene
 * objetivo, la intensidad es el cociente valor/objetivo (rojo al superarlo); si
 * no, es el valor relativo al máximo de la grilla.
 */
function colorDeCelda(valor: number, objetivoMs: number | null, maxValor: number): string {
  if (!valor) return 'transparent'
  const ratio =
    objetivoMs && objetivoMs > 0
      ? Math.min(valor / objetivoMs, 1.5) / 1.5
      : maxValor > 0
        ? valor / maxValor
        : 0
  // 140° (verde) → 0° (rojo).
  const hue = Math.round(140 - 140 * Math.min(Math.max(ratio, 0), 1))
  return `hsl(${hue}, 62%, 44%)`
}

const METRICAS: { valor: Metrica; etiqueta: string }[] = [
  { valor: 'promedio_ms', etiqueta: 'Promedio por visita' },
  { valor: 'mediana_ms', etiqueta: 'Mediana' },
  { valor: 'p95_ms', etiqueta: 'P95 (los más lentos)' },
  { valor: 'total_ms', etiqueta: 'Tiempo total' },
]

export function PaginaReporteTiempos() {
  const clienteConsultas = useQueryClient()
  const hoy = fechaLocalISO(new Date())
  const hace7 = useMemo(() => {
    const d = new Date()
    d.setDate(d.getDate() - 7)
    return fechaLocalISO(d)
  }, [])
  const [desde, setDesde] = useState(hace7)
  const [hasta, setHasta] = useState(hoy)
  const [plataforma, setPlataforma] = useState<'' | PlataformaTelemetria>('')
  const [metrica, setMetrica] = useState<Metrica>('promedio_ms')
  const [usuarioSel, setUsuarioSel] = useState<string>('')
  const [exportando, setExportando] = useState(false)
  const [mensaje, setMensaje] = useState<string | null>(null)
  const [vista, setVista] = useState<'heatmap' | 'resumen'>('heatmap')
  // Por defecto se muestran las opciones que SE USARON (las más entradas arriba);
  // con esto se suma el catálogo entero, para tener acceso a TODAS aunque no se
  // hayan usado todavía.
  const [incluirSinUso, setIncluirSinUso] = useState(false)

  const { data: filas, isLoading } = useQuery({
    queryKey: ['heatmap-telemetria', desde, hasta, plataforma],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('heatmap_telemetria', {
        p_desde: desde,
        p_hasta: hasta,
        p_plataforma: plataforma || null,
        p_perfil_id: null,
      })
      if (error) throw error
      return (data ?? []) as FilaHeatmap[]
    },
  })

  const objetivo = useMutation({
    mutationFn: async (args: {
      plataforma: PlataformaTelemetria
      seccion: string
      paso: string | null
      objetivo_ms: number | null
    }) => {
      const { error } = await supabase.rpc('fijar_objetivo_tiempo', {
        p_plataforma: args.plataforma,
        p_seccion: args.seccion,
        p_paso: args.paso,
        p_objetivo_ms: args.objetivo_ms,
      })
      if (error) throw error
    },
    onSuccess: () => {
      setMensaje(null)
      void clienteConsultas.invalidateQueries({ queryKey: ['heatmap-telemetria'] })
    },
    onError: (e: Error) => setMensaje(`No se pudo guardar el objetivo: ${e.message}`),
  })

  // Usuarios (columnas), opciones (filas) y el índice de celdas.
  const { usuarios, opciones, celda, maxValor } = useMemo(() => {
    const us = new Map<string, { id: string; nombre: string; codigo: string | null }>()
    const op = new Map<
      string,
      {
        clave: string
        plataforma: PlataformaTelemetria
        seccion: string
        paso: string | null
        etiqueta: string
        objetivo_ms: number | null
        total: number
      }
    >()
    const idx = new Map<string, FilaHeatmap>()
    let max = 0
    for (const f of filas ?? []) {
      us.set(f.perfil_id, {
        id: f.perfil_id,
        nombre: f.nombre,
        codigo: f.codigo_vendedor,
      })
      const claveOp = `${f.plataforma}|${f.seccion}|${f.paso ?? ''}`
      const prev = op.get(claveOp)
      op.set(claveOp, {
        clave: claveOp,
        plataforma: f.plataforma,
        seccion: f.seccion,
        paso: f.paso,
        etiqueta: etiquetaDeOpcion(f.plataforma, f.seccion, f.paso),
        objetivo_ms: f.objetivo_ms,
        total: (prev?.total ?? 0) + num(f.total_ms),
      })
      idx.set(`${f.perfil_id}|${claveOp}`, f)
      max = Math.max(max, num(f[metrica]))
    }
    if (incluirSinUso) {
      const sembrar = (plat: PlataformaTelemetria, secc: string) => {
        const claveOp = `${plat}|${secc}|`
        if (op.has(claveOp)) return
        op.set(claveOp, {
          clave: claveOp,
          plataforma: plat,
          seccion: secc,
          paso: null,
          etiqueta: etiquetaDeOpcion(plat, secc, null),
          objetivo_ms: null,
          total: 0,
        })
      }
      if (plataforma !== 'panel') for (const k of Object.keys(OPCIONES_APP)) sembrar('app', k)
      if (plataforma !== 'app') for (const k of Object.keys(OPCIONES_PANEL)) sembrar('panel', k)
    }
    return {
      usuarios: [...us.values()].sort((a, b) =>
        (a.codigo ?? a.nombre).localeCompare(b.codigo ?? b.nombre, 'es', { numeric: true }),
      ),
      opciones: [...op.values()].sort(
        (a, b) => a.plataforma.localeCompare(b.plataforma) || b.total - a.total,
      ),
      celda: idx,
      maxValor: max,
    }
  }, [filas, metrica, plataforma, incluirSinUso])

  const usuariosVisibles = usuarioSel ? usuarios.filter((u) => u.id === usuarioSel) : usuarios

  // Los indicadores de arriba cuentan SIEMPRE lo usado (no lo que suma el catálogo
  // con el toggle de "incluir sin uso"), para que no cambien de significado.
  const resumen = useMemo(() => {
    let eventos = 0
    let total = 0
    const ops = new Set<string>()
    const us = new Set<string>()
    for (const f of filas ?? []) {
      eventos += num(f.eventos)
      total += num(f.total_ms)
      ops.add(`${f.plataforma}|${f.seccion}|${f.paso ?? ''}`)
      us.add(f.perfil_id)
    }
    return { eventos, total, usuarios: us.size, opciones: ops.size }
  }, [filas])

  // Totales POR USUARIO (con el reparto app/panel) y POR OPCIÓN, para la vista
  // de resumen. Sale de las mismas filas del heatmap, agregando del lado del cliente.
  const porUsuario = useMemo(() => {
    const m = new Map<
      string,
      { id: string; nombre: string; codigo: string | null; eventos: number; totalMs: number; appMs: number; panelMs: number }
    >()
    for (const f of filas ?? []) {
      const u =
        m.get(f.perfil_id) ??
        { id: f.perfil_id, nombre: f.nombre, codigo: f.codigo_vendedor, eventos: 0, totalMs: 0, appMs: 0, panelMs: 0 }
      u.eventos += num(f.eventos)
      u.totalMs += num(f.total_ms)
      if (f.plataforma === 'app') u.appMs += num(f.total_ms)
      else u.panelMs += num(f.total_ms)
      m.set(f.perfil_id, u)
    }
    return [...m.values()].sort((a, b) => b.totalMs - a.totalMs)
  }, [filas])

  const porOpcion = useMemo(() => {
    const m = new Map<
      string,
      { clave: string; plataforma: PlataformaTelemetria; etiqueta: string; usuarios: Set<string>; eventos: number; totalMs: number }
    >()
    for (const f of filas ?? []) {
      const clave = `${f.plataforma}|${f.seccion}|${f.paso ?? ''}`
      const o =
        m.get(clave) ??
        { clave, plataforma: f.plataforma, etiqueta: etiquetaDeOpcion(f.plataforma, f.seccion, f.paso), usuarios: new Set<string>(), eventos: 0, totalMs: 0 }
      o.usuarios.add(f.perfil_id)
      o.eventos += num(f.eventos)
      o.totalMs += num(f.total_ms)
      m.set(clave, o)
    }
    if (incluirSinUso) {
      const sembrar = (plat: PlataformaTelemetria, secc: string) => {
        const clave = `${plat}|${secc}|`
        if (m.has(clave)) return
        m.set(clave, {
          clave,
          plataforma: plat,
          etiqueta: etiquetaDeOpcion(plat, secc, null),
          usuarios: new Set<string>(),
          eventos: 0,
          totalMs: 0,
        })
      }
      if (plataforma !== 'panel') for (const k of Object.keys(OPCIONES_APP)) sembrar('app', k)
      if (plataforma !== 'app') for (const k of Object.keys(OPCIONES_PANEL)) sembrar('panel', k)
    }
    // Ordenado por las que MÁS se entran (cantidad de visitas), y a igualdad, por tiempo.
    return [...m.values()].sort((a, b) => b.eventos - a.eventos || b.totalMs - a.totalMs)
  }, [filas, plataforma, incluirSinUso])

  async function descargar() {
    if (!filas?.length) return
    setExportando(true)
    try {
      const libro = new ExcelJS.Workbook()
      const hoja = libro.addWorksheet('Tiempos de uso')
      hoja.columns = [
        { header: 'Plataforma', key: 'plataforma', width: 11 },
        { header: 'Opción', key: 'opcion', width: 34 },
        { header: 'Usuario', key: 'usuario', width: 26 },
        { header: 'Código', key: 'codigo', width: 9 },
        { header: 'Eventos', key: 'eventos', width: 9 },
        { header: 'Total (s)', key: 'total', width: 11 },
        { header: 'Promedio (s)', key: 'prom', width: 13 },
        { header: 'Mediana (s)', key: 'med', width: 12 },
        { header: 'P95 (s)', key: 'p95', width: 10 },
        { header: 'Objetivo (s)', key: 'obj', width: 12 },
        { header: 'Último', key: 'ultimo', width: 20 },
      ]
      for (const f of filas) {
        hoja.addRow({
          plataforma: f.plataforma === 'app' ? 'App' : 'Panel',
          opcion: etiquetaDeOpcion(f.plataforma, f.seccion, f.paso),
          usuario: f.nombre,
          codigo: f.codigo_vendedor ?? '',
          eventos: num(f.eventos),
          total: Math.round(num(f.total_ms) / 1000),
          prom: Math.round(num(f.promedio_ms) / 1000),
          med: Math.round(num(f.mediana_ms) / 1000),
          p95: Math.round(num(f.p95_ms) / 1000),
          obj: f.objetivo_ms ? Math.round(f.objetivo_ms / 1000) : '',
          ultimo: f.ultimo ? new Date(f.ultimo).toLocaleString('es-AR') : '',
        })
      }
      hoja.getRow(1).font = { bold: true }
      const buffer = await libro.xlsx.writeBuffer()
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      const url = URL.createObjectURL(blob)
      const enlace = document.createElement('a')
      enlace.href = url
      enlace.download = `tiempos-de-uso-${desde}-a-${hasta}.xlsx`
      enlace.click()
      URL.revokeObjectURL(url)
    } finally {
      setExportando(false)
    }
  }

  return (
    <>
      <header className="encabezado-pagina">
        <div>
          <h1>Reporte de tiempos</h1>
          <p>
            Cuánto tiempo pasa cada usuario en cada opción de la app y sección del panel. El color
            va de verde (poco) a rojo (mucho); con objetivo, el rojo marca que lo supera.
          </p>
        </div>
        <div className="acciones" style={{ gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12 }}>
            <span style={{ color: 'var(--tinta-suave)' }}>Desde</span>
            <input type="date" value={desde} max={hasta} onChange={(e) => setDesde(e.target.value)} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12 }}>
            <span style={{ color: 'var(--tinta-suave)' }}>Hasta</span>
            <input type="date" value={hasta} min={desde} onChange={(e) => setHasta(e.target.value)} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12 }}>
            <span style={{ color: 'var(--tinta-suave)' }}>Dónde</span>
            <select value={plataforma} onChange={(e) => setPlataforma(e.target.value as '' | PlataformaTelemetria)}>
              <option value="">App y panel</option>
              <option value="app">Sólo app</option>
              <option value="panel">Sólo panel</option>
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12 }}>
            <span style={{ color: 'var(--tinta-suave)' }}>Medida</span>
            <select value={metrica} onChange={(e) => setMetrica(e.target.value as Metrica)}>
              {METRICAS.map((m) => (
                <option key={m.valor} value={m.valor}>
                  {m.etiqueta}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12 }}>
            <span style={{ color: 'var(--tinta-suave)' }}>Usuario</span>
            <select value={usuarioSel} onChange={(e) => setUsuarioSel(e.target.value)}>
              <option value="">Todos</option>
              {usuarios.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.nombre}
                  {u.codigo ? ` (#${u.codigo})` : ''}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12 }}>
            <span style={{ color: 'var(--tinta-suave)' }}>Vista</span>
            <select value={vista} onChange={(e) => setVista(e.target.value as 'heatmap' | 'resumen')}>
              <option value="heatmap">Mapa de calor</option>
              <option value="resumen">Por usuario y totales</option>
            </select>
          </label>
          <label
            style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, paddingBottom: 7 }}
            title="Suma todas las pantallas de la app y secciones del panel, aunque todavía no se hayan usado."
          >
            <input
              type="checkbox"
              checked={incluirSinUso}
              onChange={(e) => setIncluirSinUso(e.target.checked)}
            />
            <span style={{ color: 'var(--tinta-suave)' }}>Incluir opciones sin uso</span>
          </label>
          <button
            className="primario"
            disabled={exportando || !(filas?.length)}
            onClick={() => void descargar()}
          >
            {exportando ? 'Generando…' : '⬇ Excel'}
          </button>
        </div>
      </header>

      {mensaje && (
        <div className="aviso" role="status" style={{ marginBottom: 14 }}>
          {mensaje}
        </div>
      )}

      <section className="rejilla" style={{ marginBottom: 18 }}>
        <div className="indicador">
          <span className="valor">{resumen.eventos.toLocaleString('es-AR')}</span>
          <span className="etiqueta">Visitas medidas</span>
        </div>
        <div className="indicador">
          <span className="valor">{formatearDuracion(resumen.total)}</span>
          <span className="etiqueta">Tiempo total</span>
        </div>
        <div className="indicador">
          <span className="valor">{resumen.usuarios}</span>
          <span className="etiqueta">Usuarios</span>
        </div>
        <div className="indicador">
          <span className="valor">{resumen.opciones}</span>
          <span className="etiqueta">Opciones</span>
        </div>
      </section>

      {isLoading ? (
        <div className="tarjeta">
          <p>Cargando…</p>
        </div>
      ) : !filas?.length && !incluirSinUso ? (
        <div className="tarjeta">
          <p className="vacio">
            Todavía no hay tiempos registrados en ese período. A medida que la gente use la app y el
            panel, el mapa se va llenando.
          </p>
        </div>
      ) : vista === 'heatmap' ? (
        <section className="tarjeta">
          <h2>Mapa de calor</h2>
          <p style={{ color: 'var(--tinta-suave)', fontSize: 12, marginTop: -4 }}>
            Cada celda es el tiempo ({METRICAS.find((m) => m.valor === metrica)?.etiqueta.toLowerCase()})
            de ese usuario en esa opción. El “Objetivo” se edita por fila (en segundos); al fijarlo, el
            color pasa a medir cuánto se acerca o lo supera.
          </p>
          <div className="tabla-scroll" style={{ marginTop: 10 }}>
            <table className="tabla-heatmap">
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', position: 'sticky', left: 0, background: 'var(--panel-claro)' }}>
                    Opción
                  </th>
                  <th style={{ width: 92 }}>Objetivo (s)</th>
                  {usuariosVisibles.map((u) => (
                    <th key={u.id} title={u.nombre} style={{ minWidth: 72 }}>
                      {u.codigo ? `#${u.codigo}` : u.nombre.split(' ')[0]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {opciones.map((op) => (
                  <tr key={op.clave}>
                    <td style={{ textAlign: 'left', position: 'sticky', left: 0, background: 'var(--panel-claro)' }}>
                      <span
                        className={`pastilla ${op.plataforma === 'app' ? 'azul' : 'gris'}`}
                        style={{ marginRight: 6, fontSize: 10 }}
                      >
                        {op.plataforma === 'app' ? 'APP' : 'PANEL'}
                      </span>
                      {op.etiqueta}
                    </td>
                    <td>
                      <input
                        key={`${op.clave}:${op.objetivo_ms ?? ''}`}
                        type="number"
                        min={0}
                        step={5}
                        defaultValue={op.objetivo_ms ? Math.round(op.objetivo_ms / 1000) : ''}
                        style={{ width: 70, textAlign: 'right' }}
                        onBlur={(e) => {
                          const seg = e.target.value.trim() === '' ? null : Number(e.target.value)
                          const nuevo = seg && seg > 0 ? Math.round(seg * 1000) : null
                          if (nuevo === (op.objetivo_ms ?? null)) return
                          objetivo.mutate({
                            plataforma: op.plataforma,
                            seccion: op.seccion,
                            paso: op.paso,
                            objetivo_ms: nuevo,
                          })
                        }}
                      />
                    </td>
                    {usuariosVisibles.map((u) => {
                      const fila = celda.get(`${u.id}|${op.clave}`)
                      const valor = fila ? num(fila[metrica]) : 0
                      return (
                        <td
                          key={u.id}
                          title={
                            fila
                              ? `${op.etiqueta} · ${u.nombre}\n${num(fila.eventos)} visitas · total ${formatearDuracion(num(fila.total_ms))}`
                              : undefined
                          }
                          style={{
                            background: colorDeCelda(valor, op.objetivo_ms, maxValor),
                            color: valor ? '#fff' : 'var(--tinta-tenue)',
                            textAlign: 'center',
                            fontVariantNumeric: 'tabular-nums',
                            fontWeight: 600,
                          }}
                        >
                          {valor ? formatearDuracion(valor) : '·'}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <>
          <section className="tarjeta" style={{ marginBottom: 18 }}>
            <h2>Tiempo por usuario</h2>
            <p style={{ color: 'var(--tinta-suave)', fontSize: 12, marginTop: -4 }}>
              Cuánto tiempo pasó cada usuario en total, y cómo se reparte entre la app y el panel.
            </p>
            <div className="tabla-scroll" style={{ marginTop: 10 }}>
              <table>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left' }}>Usuario</th>
                    <th style={{ textAlign: 'right' }}>Visitas</th>
                    <th style={{ textAlign: 'right' }}>App</th>
                    <th style={{ textAlign: 'right' }}>Panel</th>
                    <th style={{ textAlign: 'right' }}>Total</th>
                    <th style={{ textAlign: 'right' }}>Prom/visita</th>
                  </tr>
                </thead>
                <tbody>
                  {porUsuario.map((u) => (
                    <tr key={u.id}>
                      <td style={{ textAlign: 'left' }}>
                        {u.nombre}
                        {u.codigo ? ` (#${u.codigo})` : ''}
                      </td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{u.eventos.toLocaleString('es-AR')}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{u.appMs ? formatearDuracion(u.appMs) : '—'}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{u.panelMs ? formatearDuracion(u.panelMs) : '—'}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{formatearDuracion(u.totalMs)}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {u.eventos ? formatearDuracion(Math.round(u.totalMs / u.eventos)) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ fontWeight: 700, borderTop: '2px solid var(--negro)' }}>
                    <td style={{ textAlign: 'left' }}>TOTAL ({porUsuario.length} usuarios)</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{resumen.eventos.toLocaleString('es-AR')}</td>
                    <td colSpan={2} />
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatearDuracion(resumen.total)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>

          <section className="tarjeta">
            <h2>Tiempo por opción</h2>
            <p style={{ color: 'var(--tinta-suave)', fontSize: 12, marginTop: -4 }}>
              El total acumulado en cada opción, sumando a todos los usuarios.
            </p>
            <div className="tabla-scroll" style={{ marginTop: 10 }}>
              <table>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left' }}>Opción</th>
                    <th style={{ textAlign: 'right' }}>Usuarios</th>
                    <th style={{ textAlign: 'right' }}>Visitas</th>
                    <th style={{ textAlign: 'right' }}>Total</th>
                    <th style={{ textAlign: 'right' }}>Prom/visita</th>
                  </tr>
                </thead>
                <tbody>
                  {porOpcion.map((o) => (
                    <tr key={o.clave}>
                      <td style={{ textAlign: 'left' }}>
                        <span
                          className={`pastilla ${o.plataforma === 'app' ? 'azul' : 'gris'}`}
                          style={{ marginRight: 6, fontSize: 10 }}
                        >
                          {o.plataforma === 'app' ? 'APP' : 'PANEL'}
                        </span>
                        {o.etiqueta}
                      </td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{o.usuarios.size}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{o.eventos.toLocaleString('es-AR')}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{formatearDuracion(o.totalMs)}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {o.eventos ? formatearDuracion(Math.round(o.totalMs / o.eventos)) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ fontWeight: 700, borderTop: '2px solid var(--negro)' }}>
                    <td style={{ textAlign: 'left' }}>TOTAL ({porOpcion.length} opciones)</td>
                    <td />
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{resumen.eventos.toLocaleString('es-AR')}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatearDuracion(resumen.total)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>
        </>
      )}
    </>
  )
}
