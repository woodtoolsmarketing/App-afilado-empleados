import {
  fechaLocalISO,
  formatearFechaCorta,
  formatearMoneda,
  formatearPesos,
  generarDocumentoPlanillasCobranzas,
  type PlanillaCobranzasParaImprimir,
  type RenglonCobranza,
} from '@woodtools/compartido'
import { useMutation, useQuery } from '@tanstack/react-query'
import ExcelJS from 'exceljs'
import { useMemo, useState } from 'react'

import { supabase } from '../nucleo/supabase'

/**
 * Cobranzas de los vendedores.
 *
 * Lo que cobró cada vendedor, separado por DÍA y por VENDEDOR, para que la
 * oficina pueda ver qué rindió cada uno. Es sólo lectura: las cobranzas las
 * carga el vendedor desde la app (tabla `cobranzas`), acá nada más se miran.
 *
 * La RLS ya deja que la oficina (admin/supervisor/administración) lea las de
 * todos los vendedores; un vendedor sólo ve las suyas. Por eso esta página no
 * necesita ninguna función del servidor: consulta la tabla directo.
 */

interface CobranzaFila {
  id: string
  vendedor_id: string
  fecha: string
  cliente_codigo: string | null
  cliente_nombre: string
  tipo_comprobante: string
  total: number | string
  cheque: number | string
  efectivo: number | string
  retenciones: number | string
  comentarios: string | null
  creado_en: string
  moneda: string
  perfiles: { nombre_completo: string; codigo_vendedor: string | null } | null
}

/** numeric de Postgres puede venir como string; se normaliza antes de sumar. */
const n = (v: number | string | null | undefined): number => {
  const x = typeof v === 'string' ? Number(v) : (v ?? 0)
  return Number.isFinite(x) ? x : 0
}

/** "jueves 8 de octubre" a partir de un `date` de Postgres (al mediodía, sin corrimiento de huso). */
function diaLargo(fecha: string): string {
  return new Date(`${fecha}T12:00:00`).toLocaleDateString('es-AR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
}

interface Totales {
  total: number
  cheque: number
  efectivo: number
  retenciones: number
}

function sumar(cobros: CobranzaFila[]): Totales {
  return cobros.reduce(
    (acc, c) => ({
      total: acc.total + n(c.total),
      cheque: acc.cheque + n(c.cheque),
      efectivo: acc.efectivo + n(c.efectivo),
      retenciones: acc.retenciones + n(c.retenciones),
    }),
    { total: 0, cheque: 0, efectivo: 0, retenciones: 0 },
  )
}

function nombreVendedor(c: CobranzaFila): string {
  const p = c.perfiles
  if (!p) return 'Vendedor'
  return `${p.nombre_completo}${p.codigo_vendedor ? ` (#${p.codigo_vendedor})` : ''}`
}

/** Una planilla imprimible (un comprobante) con los cobros de un vendedor en un día. */
function armarPlanilla(
  cobros: CobranzaFila[],
  esPresupuesto: boolean,
  moneda: 'ARS' | 'USD',
  fecha: string,
): PlanillaCobranzasParaImprimir {
  const monto = (x: number) => (x > 0 ? formatearMoneda(x, moneda) : '')
  const renglones: RenglonCobranza[] = cobros.map((c) => ({
    cliente_codigo: c.cliente_codigo ?? '',
    cliente_nombre: c.cliente_nombre,
    total: formatearMoneda(n(c.total), moneda),
    // Un cero se deja en blanco: una columna de ceros se lee como si hubiera pasado algo.
    cheque: monto(n(c.cheque)),
    efectivo: monto(n(c.efectivo)),
    retenciones: monto(n(c.retenciones)),
    comentarios: c.comentarios ?? '',
  }))
  // Subtotales por columna para el pie. En blanco cuando dan 0, igual que por fila.
  const tot = sumar(cobros)
  return {
    vendedor_numero: cobros[0]?.perfiles?.codigo_vendedor ?? '',
    esPresupuesto,
    moneda,
    fecha: formatearFechaCorta(`${fecha}T12:00:00`),
    cobros: renglones,
    total_general: formatearMoneda(tot.total, moneda),
    total_cheque: tot.cheque > 0 ? formatearMoneda(tot.cheque, moneda) : '',
    total_efectivo: tot.efectivo > 0 ? formatearMoneda(tot.efectivo, moneda) : '',
    total_retenciones: tot.retenciones > 0 ? formatearMoneda(tot.retenciones, moneda) : '',
  }
}

/**
 * La impresora de la oficina, para mandarle la planilla directo por IPP. Misma
 * fila que leen la cola de impresión y el teléfono (`configuracion.impresora_oficina`);
 * sin IP cargada, `imprimirDocumento` cae al diálogo del sistema.
 */
async function obtenerImpresora(): Promise<{ ip: string; puerto?: number; ruta?: string } | null> {
  try {
    const { data } = await supabase
      .from('configuracion')
      .select('valor')
      .eq('clave', 'impresora_oficina')
      .maybeSingle()
    const cfg = data?.valor as { ip?: string; puerto?: number; ruta?: string } | undefined
    if (!cfg?.ip) return null
    return { ip: cfg.ip, puerto: cfg.puerto, ruta: cfg.ruta }
  } catch {
    return null
  }
}

export function PaginaCobranzasVendedores({ esAdmin }: { esAdmin: boolean }) {
  // Por defecto, los últimos 30 días: lo suficiente para ver la semana y la
  // anterior sin traer todo el histórico.
  const hoy = fechaLocalISO(new Date())
  const hace30 = useMemo(() => {
    const d = new Date()
    d.setDate(d.getDate() - 30)
    return fechaLocalISO(d)
  }, [])
  const [desde, setDesde] = useState(hace30)
  const [hasta, setHasta] = useState(hoy)
  const [moneda, setMoneda] = useState<'ARS' | 'USD'>('ARS')
  const [exportando, setExportando] = useState(false)
  const [mensaje, setMensaje] = useState<string | null>(null)

  const { data: cobranzas, isLoading } = useQuery({
    queryKey: ['cobranzas-vendedores', desde, hasta],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cobranzas')
        .select(
          'id, vendedor_id, fecha, cliente_codigo, cliente_nombre, tipo_comprobante, total, cheque, efectivo, retenciones, comentarios, creado_en, moneda, perfiles:vendedor_id ( nombre_completo, codigo_vendedor )',
        )
        .gte('fecha', desde)
        .lte('fecha', hasta)
        .order('fecha', { ascending: false })
        .order('vendedor_id')
        .order('creado_en')
      if (error) throw error
      return (data ?? []) as unknown as CobranzaFila[]
    },
  })

  const fmt = (x: number) => formatearMoneda(x, moneda)

  // #13: pesos y dólares no se suman. Se muestra UNA moneda por vez (pesos por
  // defecto): así el resumen, los totales del día y el Excel quedan siempre en
  // una sola moneda —única forma de que un total tenga sentido—. Si el período
  // tiene cobros en la otra moneda, un aviso lo dice y deja cambiar.
  const cobranzasMoneda = useMemo(
    () => (cobranzas ?? []).filter((c) => c.moneda === moneda),
    [cobranzas, moneda],
  )
  const cobrosOtraMoneda = useMemo(
    () => (cobranzas ?? []).filter((c) => c.moneda !== moneda).length,
    [cobranzas, moneda],
  )

  // Para IMPRIMIR se usan TODOS los cobros del día+vendedor (las dos monedas): la
  // impresión arma una planilla por (comprobante, moneda) y el sellado marca el
  // día entero, así que debe cubrir lo que haya y no sólo la moneda que se mira.
  const gruposCompletos = useMemo(() => {
    const m = new Map<string, CobranzaFila[]>()
    for (const c of cobranzas ?? []) {
      const k = `${c.fecha}|${c.vendedor_id}`
      const lista = m.get(k) ?? []
      lista.push(c)
      m.set(k, lista)
    }
    return m
  }, [cobranzas])

  /** fecha → (vendedor_id → cobros) de la moneda elegida, en el orden de la consulta. */
  const porDia = useMemo(() => {
    const dias = new Map<string, Map<string, CobranzaFila[]>>()
    for (const c of cobranzasMoneda) {
      const porVend = dias.get(c.fecha) ?? new Map<string, CobranzaFila[]>()
      const lista = porVend.get(c.vendedor_id) ?? []
      lista.push(c)
      porVend.set(c.vendedor_id, lista)
      dias.set(c.fecha, porVend)
    }
    return dias
  }, [cobranzasMoneda])

  /** Total del período por vendedor (moneda elegida), para el resumen de arriba. */
  const resumenVendedores = useMemo(() => {
    const porVend = new Map<string, { nombre: string; tot: Totales }>()
    for (const c of cobranzasMoneda) {
      const prev = porVend.get(c.vendedor_id)
      const tot = prev?.tot ?? { total: 0, cheque: 0, efectivo: 0, retenciones: 0 }
      porVend.set(c.vendedor_id, {
        nombre: nombreVendedor(c),
        tot: {
          total: tot.total + n(c.total),
          cheque: tot.cheque + n(c.cheque),
          efectivo: tot.efectivo + n(c.efectivo),
          retenciones: tot.retenciones + n(c.retenciones),
        },
      })
    }
    return [...porVend.values()].sort((a, b) => b.tot.total - a.tot.total)
  }, [cobranzasMoneda])

  const totalPeriodo = useMemo(() => sumar(cobranzasMoneda), [cobranzasMoneda])

  /**
   * Imprimir las planillas de un vendedor en un día: la de FACTURA y la de
   * PRESUPUESTO (sólo las que tienen cobros) en UNA sola hoja A4, divididas por
   * una línea. Es SÓLO de administradores —el botón se gatea con `esAdmin`,
   * aunque otro rol tenga la vista—.
   */
  const imprimir = useMutation({
    mutationFn: async ({ cobros, fecha }: { cobros: CobranzaFila[]; fecha: string }) => {
      const imprimirDoc = window.woodtools?.imprimirDocumento
      if (!imprimirDoc) {
        throw new Error('La impresión es sólo desde el panel instalado en la oficina.')
      }
      // Una planilla por (comprobante, moneda): pesos y dólares salen en hojas
      // separadas, y la moneda que no se cobró no genera hoja.
      const planillas: PlanillaCobranzasParaImprimir[] = []
      for (const [esPres, tipo] of [
        [false, 'factura'],
        [true, 'presupuesto'],
      ] as const) {
        for (const moneda of ['ARS', 'USD'] as const) {
          const grupo = cobros.filter((c) => c.tipo_comprobante === tipo && c.moneda === moneda)
          if (grupo.length > 0) planillas.push(armarPlanilla(grupo, esPres, moneda, fecha))
        }
      }
      if (planillas.length === 0) throw new Error('No hay cobros para imprimir.')
      const html = generarDocumentoPlanillasCobranzas(planillas)
      const impresora = await obtenerImpresora()
      const r = await imprimirDoc(html, impresora, 'A4')
      if (!r.impreso) throw new Error(r.motivo ?? 'La impresora no confirmó el trabajo.')

      // La planilla salió en papel: se sellan esos cobros como impresos para que
      // el vendedor no pueda retocarlos después desde la app (ahí van a figurar
      // con la pastilla IMPRESO). Best-effort: una impresión que sí salió no se
      // desdice porque falle el sello; reimprimir lo vuelve a intentar.
      try {
        await supabase.rpc('marcar_cobranzas_impresas', {
          p_fechas: [fecha],
          p_vendedor_id: cobros[0]?.vendedor_id ?? null,
        })
      } catch {
        /* el papel ya salió; el sello se reintenta en la próxima impresión */
      }
      return planillas.length
    },
    onSuccess: (cantidad) =>
      setMensaje(
        cantidad === 1 ? 'Planilla enviada a la impresora.' : 'Planillas enviadas a la impresora.',
      ),
    onError: (e: Error) => setMensaje(e.message),
  })

  /**
   * Descargar el Excel. Es SÓLO para administradores, aunque la sección la vean
   * otros roles: el botón ni aparece si no es admin (ver el `esAdmin &&` abajo).
   * Como el archivo se arma en el navegador con lo ya cargado, el gateo es acá;
   * no hay un endpoint aparte que haga falta cerrar.
   */
  async function descargar() {
    if (cobranzasMoneda.length === 0) return
    setExportando(true)
    try {
      const libro = new ExcelJS.Workbook()

      // Hoja 1: el detalle, un renglón por cobro.
      const hoja = libro.addWorksheet('Cobranzas')
      hoja.columns = [
        { header: 'Fecha', key: 'fecha', width: 12 },
        { header: 'Vendedor', key: 'vendedor', width: 28 },
        { header: 'Código', key: 'codigo', width: 10 },
        { header: 'Cliente', key: 'cliente', width: 34 },
        { header: 'Comprobante', key: 'comprobante', width: 13 },
        { header: 'Total', key: 'total', width: 14 },
        { header: 'Cheque', key: 'cheque', width: 14 },
        { header: 'Efectivo', key: 'efectivo', width: 14 },
        { header: 'Retenciones', key: 'retenciones', width: 14 },
        { header: 'Comentarios', key: 'comentarios', width: 30 },
      ]
      for (const c of cobranzasMoneda) {
        hoja.addRow({
          fecha: c.fecha,
          vendedor: nombreVendedor(c),
          codigo: c.cliente_codigo ?? '',
          cliente: c.cliente_nombre,
          comprobante: c.tipo_comprobante === 'factura' ? 'FACTURA' : 'PRESUPUESTO',
          total: n(c.total),
          cheque: n(c.cheque),
          efectivo: n(c.efectivo),
          retenciones: n(c.retenciones),
          comentarios: c.comentarios ?? '',
        })
      }

      // Hoja 2: el total del período por vendedor.
      const resumen = libro.addWorksheet('Resumen')
      resumen.columns = [
        { header: 'Vendedor', key: 'vendedor', width: 28 },
        { header: 'Total', key: 'total', width: 14 },
        { header: 'Cheque', key: 'cheque', width: 14 },
        { header: 'Efectivo', key: 'efectivo', width: 14 },
        { header: 'Retenciones', key: 'retenciones', width: 14 },
      ]
      for (const v of resumenVendedores) {
        resumen.addRow({
          vendedor: v.nombre,
          total: v.tot.total,
          cheque: v.tot.cheque,
          efectivo: v.tot.efectivo,
          retenciones: v.tot.retenciones,
        })
      }
      const totalRow = resumen.addRow({
        vendedor: 'Total general',
        total: totalPeriodo.total,
        cheque: totalPeriodo.cheque,
        efectivo: totalPeriodo.efectivo,
        retenciones: totalPeriodo.retenciones,
      })
      totalRow.font = { bold: true }

      // Formato de moneda (la elegida) y encabezados en negrita en las dos hojas.
      const numFmtMoneda = moneda === 'USD' ? '"US$ "#,##0.00' : '"$"#,##0.00'
      for (const h of [hoja, resumen]) {
        h.getRow(1).font = { bold: true }
        for (const k of ['total', 'cheque', 'efectivo', 'retenciones']) {
          h.getColumn(k).numFmt = numFmtMoneda
        }
      }

      const buffer = await libro.xlsx.writeBuffer()
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      const url = URL.createObjectURL(blob)
      const enlace = document.createElement('a')
      enlace.href = url
      enlace.download = `cobranzas-${moneda === 'USD' ? 'dolares' : 'pesos'}-${desde}-a-${hasta}.xlsx`
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
          <h1>Cobranzas de los vendedores</h1>
          <p>Lo que cobró cada vendedor, separado por día. Lo carga el vendedor desde la app.</p>
        </div>
        <div className="acciones" style={{ gap: 10, alignItems: 'flex-end' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12 }}>
            <span style={{ color: 'var(--tinta-suave)' }}>Moneda</span>
            <div style={{ display: 'flex', gap: 4 }}>
              <button
                className={moneda === 'ARS' ? 'chico primario' : 'chico'}
                onClick={() => setMoneda('ARS')}
              >
                $ Pesos
              </button>
              <button
                className={moneda === 'USD' ? 'chico primario' : 'chico'}
                onClick={() => setMoneda('USD')}
              >
                US$ Dólares
              </button>
            </div>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12 }}>
            <span style={{ color: 'var(--tinta-suave)' }}>Desde</span>
            <input type="date" value={desde} max={hasta} onChange={(e) => setDesde(e.target.value)} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12 }}>
            <span style={{ color: 'var(--tinta-suave)' }}>Hasta</span>
            <input type="date" value={hasta} min={desde} onChange={(e) => setHasta(e.target.value)} />
          </label>
          {/* Descargar el archivo es SÓLO de administradores, aunque la sección
              la vea otro rol: por eso el botón se gatea con `esAdmin` y no con el
              permiso de la sección. */}
          {esAdmin && (
            <button
              className="primario"
              disabled={exportando || cobranzasMoneda.length === 0}
              onClick={() => void descargar()}
            >
              {exportando ? 'Generando…' : '⬇ Descargar Excel'}
            </button>
          )}
        </div>
      </header>

      {mensaje && (
        <div className="aviso" role="status" style={{ marginBottom: 14 }}>
          {mensaje}
        </div>
      )}

      {/* Aviso de cobros en la OTRA moneda: la página muestra una sola moneda por
          vez para que los totales sean válidos; esto evita que pasen inadvertidos. */}
      {cobrosOtraMoneda > 0 && (
        <div className="aviso" role="status" style={{ marginBottom: 14 }}>
          Hay {cobrosOtraMoneda} cobro{cobrosOtraMoneda === 1 ? '' : 's'} en{' '}
          {moneda === 'ARS' ? 'dólares (US$)' : 'pesos ($)'} en este período, que no entra
          {cobrosOtraMoneda === 1 ? '' : 'n'} en estos totales.{' '}
          <button className="chico" onClick={() => setMoneda(moneda === 'ARS' ? 'USD' : 'ARS')}>
            Ver en {moneda === 'ARS' ? 'US$' : '$'}
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="tarjeta">
          <p>Cargando…</p>
        </div>
      ) : (cobranzas?.length ?? 0) === 0 ? (
        <div className="tarjeta">
          <p className="vacio">No hay cobranzas registradas en ese período.</p>
        </div>
      ) : cobranzasMoneda.length === 0 ? (
        <div className="tarjeta">
          <p className="vacio">
            No hay cobros en {moneda === 'USD' ? 'dólares (US$)' : 'pesos ($)'} en este período.
          </p>
        </div>
      ) : (
        <>
          {/* Resumen del período: cuánto cobró cada vendedor en total. */}
          <section className="tarjeta" style={{ marginBottom: 18 }}>
            <h2>Resumen del período</h2>
            <table>
              <thead>
                <tr>
                  <th>Vendedor</th>
                  <th style={{ textAlign: 'right' }}>Total</th>
                  <th style={{ textAlign: 'right' }}>Cheque</th>
                  <th style={{ textAlign: 'right' }}>Efectivo</th>
                  <th style={{ textAlign: 'right' }}>Retenciones</th>
                </tr>
              </thead>
              <tbody>
                {resumenVendedores.map((v) => (
                  <tr key={v.nombre}>
                    <td>{v.nombre}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {fmt(v.tot.total)}
                    </td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {v.tot.cheque > 0 ? fmt(v.tot.cheque) : '—'}
                    </td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {v.tot.efectivo > 0 ? fmt(v.tot.efectivo) : '—'}
                    </td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {v.tot.retenciones > 0 ? fmt(v.tot.retenciones) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>
                    <strong>Total general</strong>
                  </td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    <strong>{fmt(totalPeriodo.total)}</strong>
                  </td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {totalPeriodo.cheque > 0 ? fmt(totalPeriodo.cheque) : '—'}
                  </td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {totalPeriodo.efectivo > 0 ? fmt(totalPeriodo.efectivo) : '—'}
                  </td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {totalPeriodo.retenciones > 0 ? fmt(totalPeriodo.retenciones) : '—'}
                  </td>
                </tr>
              </tfoot>
            </table>
          </section>

          {/* El detalle, día por día (del más nuevo al más viejo). */}
          {[...porDia.entries()].map(([fecha, porVend]) => {
            const delDia = [...porVend.values()].flat()
            const totDia = sumar(delDia)
            return (
              <section className="tarjeta" key={fecha} style={{ marginBottom: 18 }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'baseline',
                    flexWrap: 'wrap',
                    gap: 8,
                  }}
                >
                  <h2 style={{ textTransform: 'capitalize', margin: 0 }}>{diaLargo(fecha)}</h2>
                  <span style={{ color: 'var(--tinta-suave)', fontSize: 14 }}>
                    Total del día: <strong>{fmt(totDia.total)}</strong>
                  </span>
                </div>

                {[...porVend.values()].map((cobros) => {
                  const tot = sumar(cobros)
                  return (
                    <div key={cobros[0].vendedor_id} style={{ marginTop: 14 }}>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'baseline',
                          gap: 10,
                          flexWrap: 'wrap',
                        }}
                      >
                        <h3 style={{ margin: '0 0 6px', fontSize: 15 }}>
                          {nombreVendedor(cobros[0])}
                          <span
                            style={{
                              color: 'var(--tinta-suave)',
                              fontWeight: 400,
                              marginLeft: 8,
                              fontSize: 13,
                            }}
                          >
                            {cobros.length} {cobros.length === 1 ? 'cobro' : 'cobros'} ·{' '}
                            {fmt(tot.total)}
                          </span>
                        </h3>
                        {/* Imprimir las planillas (factura/presupuesto, A5) es SÓLO de
                            administradores, aunque la vista la tenga otro rol. */}
                        {esAdmin ? (
                          <button
                            className="chico"
                            disabled={imprimir.isPending}
                            // Imprime TODAS las monedas del día+vendedor, no sólo la
                            // que se está viendo (el sellado marca el día entero).
                            onClick={() =>
                              imprimir.mutate({
                                cobros:
                                  gruposCompletos.get(`${fecha}|${cobros[0].vendedor_id}`) ?? cobros,
                                fecha,
                              })
                            }
                          >
                            {imprimir.isPending ? 'Imprimiendo…' : '🖨 Imprimir planillas'}
                          </button>
                        ) : null}
                      </div>
                      <table style={{ fontSize: 13 }}>
                        <thead>
                          <tr>
                            <th style={{ width: 70 }}>Código</th>
                            <th>Cliente</th>
                            <th style={{ textAlign: 'right', width: 120 }}>Total</th>
                            <th style={{ textAlign: 'right', width: 110 }}>Cheque</th>
                            <th style={{ textAlign: 'right', width: 110 }}>Efectivo</th>
                            <th style={{ textAlign: 'right', width: 110 }}>Retenciones</th>
                            <th>Comentarios</th>
                          </tr>
                        </thead>
                        <tbody>
                          {cobros.map((c) => (
                            <tr key={c.id}>
                              <td>{c.cliente_codigo ?? '—'}</td>
                              <td>
                                {c.cliente_nombre}
                                <br />
                                <small
                                  className={`pastilla ${c.tipo_comprobante === 'factura' ? 'azul' : ''}`}
                                >
                                  {c.tipo_comprobante === 'factura' ? 'FACTURA' : 'PRESUPUESTO'}
                                </small>
                              </td>
                              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                                {fmt(n(c.total))}
                              </td>
                              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                                {n(c.cheque) > 0 ? fmt(n(c.cheque)) : '—'}
                              </td>
                              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                                {n(c.efectivo) > 0 ? fmt(n(c.efectivo)) : '—'}
                              </td>
                              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                                {n(c.retenciones) > 0 ? fmt(n(c.retenciones)) : '—'}
                              </td>
                              <td style={{ color: 'var(--tinta-suave)' }}>{c.comentarios ?? ''}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr>
                            <td />
                            <td style={{ textAlign: 'right' }}>
                              <strong>Subtotal</strong>
                            </td>
                            <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                              <strong>{fmt(tot.total)}</strong>
                            </td>
                            <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                              {tot.cheque > 0 ? fmt(tot.cheque) : '—'}
                            </td>
                            <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                              {tot.efectivo > 0 ? fmt(tot.efectivo) : '—'}
                            </td>
                            <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                              {tot.retenciones > 0 ? fmt(tot.retenciones) : '—'}
                            </td>
                            <td />
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )
                })}
              </section>
            )
          })}
        </>
      )}
    </>
  )
}
