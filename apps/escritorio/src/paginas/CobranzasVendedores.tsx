import {
  fechaLocalISO,
  formatearFechaCorta,
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
  comentarios: string | null
  creado_en: string
  perfiles: { nombre_completo: string; codigo_vendedor: string | null } | null
}

/** numeric de Postgres puede venir como string; se normaliza antes de sumar. */
const n = (v: number | string | null | undefined): number => {
  const x = typeof v === 'string' ? Number(v) : (v ?? 0)
  return Number.isFinite(x) ? x : 0
}

const pesos = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 2,
})

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
}

function sumar(cobros: CobranzaFila[]): Totales {
  return cobros.reduce(
    (acc, c) => ({
      total: acc.total + n(c.total),
      cheque: acc.cheque + n(c.cheque),
      efectivo: acc.efectivo + n(c.efectivo),
    }),
    { total: 0, cheque: 0, efectivo: 0 },
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
  titulo: string,
  fecha: string,
): PlanillaCobranzasParaImprimir {
  const renglones: RenglonCobranza[] = cobros.map((c) => ({
    cliente_codigo: c.cliente_codigo ?? '',
    cliente_nombre: c.cliente_nombre,
    total: formatearPesos(n(c.total)),
    // Un cero se deja en blanco: una columna de ceros se lee como si hubiera pasado algo.
    cheque: n(c.cheque) > 0 ? formatearPesos(n(c.cheque)) : '',
    efectivo: n(c.efectivo) > 0 ? formatearPesos(n(c.efectivo)) : '',
    comentarios: c.comentarios ?? '',
  }))
  return {
    vendedor_numero: cobros[0]?.perfiles?.codigo_vendedor ?? '',
    titulo,
    fecha: formatearFechaCorta(`${fecha}T12:00:00`),
    cobros: renglones,
    total_general: formatearPesos(sumar(cobros).total),
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
  const [exportando, setExportando] = useState(false)
  const [mensaje, setMensaje] = useState<string | null>(null)

  const { data: cobranzas, isLoading } = useQuery({
    queryKey: ['cobranzas-vendedores', desde, hasta],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cobranzas')
        .select(
          'id, vendedor_id, fecha, cliente_codigo, cliente_nombre, tipo_comprobante, total, cheque, efectivo, comentarios, creado_en, perfiles:vendedor_id ( nombre_completo, codigo_vendedor )',
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

  /** fecha → (vendedor_id → cobros), respetando el orden que trae la consulta. */
  const porDia = useMemo(() => {
    const dias = new Map<string, Map<string, CobranzaFila[]>>()
    for (const c of cobranzas ?? []) {
      const porVend = dias.get(c.fecha) ?? new Map<string, CobranzaFila[]>()
      const lista = porVend.get(c.vendedor_id) ?? []
      lista.push(c)
      porVend.set(c.vendedor_id, lista)
      dias.set(c.fecha, porVend)
    }
    return dias
  }, [cobranzas])

  /** Total del período por vendedor, para el resumen de arriba. */
  const resumenVendedores = useMemo(() => {
    const porVend = new Map<string, { nombre: string; tot: Totales }>()
    for (const c of cobranzas ?? []) {
      const prev = porVend.get(c.vendedor_id)
      const tot = prev?.tot ?? { total: 0, cheque: 0, efectivo: 0 }
      porVend.set(c.vendedor_id, {
        nombre: nombreVendedor(c),
        tot: {
          total: tot.total + n(c.total),
          cheque: tot.cheque + n(c.cheque),
          efectivo: tot.efectivo + n(c.efectivo),
        },
      })
    }
    return [...porVend.values()].sort((a, b) => b.tot.total - a.tot.total)
  }, [cobranzas])

  const totalPeriodo = useMemo(() => sumar(cobranzas ?? []), [cobranzas])

  /**
   * Imprimir las planillas de un vendedor en un día: una por FACTURA y otra por
   * PRESUPUESTO (sólo las que tienen cobros), en A5. Es SÓLO de administradores
   * —el botón se gatea con `esAdmin`, aunque otro rol tenga la vista—.
   */
  const imprimir = useMutation({
    mutationFn: async ({ cobros, fecha }: { cobros: CobranzaFila[]; fecha: string }) => {
      const imprimirDoc = window.woodtools?.imprimirDocumento
      if (!imprimirDoc) {
        throw new Error('La impresión es sólo desde el panel instalado en la oficina.')
      }
      const facturas = cobros.filter((c) => c.tipo_comprobante === 'factura')
      const presupuestos = cobros.filter((c) => c.tipo_comprobante === 'presupuesto')
      const planillas: PlanillaCobranzasParaImprimir[] = []
      if (facturas.length > 0) planillas.push(armarPlanilla(facturas, 'FACTURA', fecha))
      if (presupuestos.length > 0) planillas.push(armarPlanilla(presupuestos, 'PRESUPUESTO', fecha))
      if (planillas.length === 0) throw new Error('No hay cobros para imprimir.')
      const html = generarDocumentoPlanillasCobranzas(planillas)
      const impresora = await obtenerImpresora()
      const r = await imprimirDoc(html, impresora, 'A5')
      if (!r.impreso) throw new Error(r.motivo ?? 'La impresora no confirmó el trabajo.')
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
    if (!cobranzas || cobranzas.length === 0) return
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
        { header: 'Comentarios', key: 'comentarios', width: 30 },
      ]
      for (const c of cobranzas) {
        hoja.addRow({
          fecha: c.fecha,
          vendedor: nombreVendedor(c),
          codigo: c.cliente_codigo ?? '',
          cliente: c.cliente_nombre,
          comprobante: c.tipo_comprobante === 'factura' ? 'FACTURA' : 'PRESUPUESTO',
          total: n(c.total),
          cheque: n(c.cheque),
          efectivo: n(c.efectivo),
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
      ]
      for (const v of resumenVendedores) {
        resumen.addRow({
          vendedor: v.nombre,
          total: v.tot.total,
          cheque: v.tot.cheque,
          efectivo: v.tot.efectivo,
        })
      }
      const totalRow = resumen.addRow({
        vendedor: 'Total general',
        total: totalPeriodo.total,
        cheque: totalPeriodo.cheque,
        efectivo: totalPeriodo.efectivo,
      })
      totalRow.font = { bold: true }

      // Formato de moneda y encabezados en negrita en las dos hojas.
      for (const h of [hoja, resumen]) {
        h.getRow(1).font = { bold: true }
        for (const k of ['total', 'cheque', 'efectivo']) {
          h.getColumn(k).numFmt = '"$"#,##0.00'
        }
      }

      const buffer = await libro.xlsx.writeBuffer()
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      const url = URL.createObjectURL(blob)
      const enlace = document.createElement('a')
      enlace.href = url
      enlace.download = `cobranzas-${desde}-a-${hasta}.xlsx`
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
              disabled={exportando || (cobranzas?.length ?? 0) === 0}
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

      {isLoading ? (
        <div className="tarjeta">
          <p>Cargando…</p>
        </div>
      ) : (cobranzas?.length ?? 0) === 0 ? (
        <div className="tarjeta">
          <p className="vacio">No hay cobranzas registradas en ese período.</p>
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
                </tr>
              </thead>
              <tbody>
                {resumenVendedores.map((v) => (
                  <tr key={v.nombre}>
                    <td>{v.nombre}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {pesos.format(v.tot.total)}
                    </td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {v.tot.cheque > 0 ? pesos.format(v.tot.cheque) : '—'}
                    </td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {v.tot.efectivo > 0 ? pesos.format(v.tot.efectivo) : '—'}
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
                    <strong>{pesos.format(totalPeriodo.total)}</strong>
                  </td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {totalPeriodo.cheque > 0 ? pesos.format(totalPeriodo.cheque) : '—'}
                  </td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {totalPeriodo.efectivo > 0 ? pesos.format(totalPeriodo.efectivo) : '—'}
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
                    Total del día: <strong>{pesos.format(totDia.total)}</strong>
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
                            {pesos.format(tot.total)}
                          </span>
                        </h3>
                        {/* Imprimir las planillas (factura/presupuesto, A5) es SÓLO de
                            administradores, aunque la vista la tenga otro rol. */}
                        {esAdmin ? (
                          <button
                            className="chico"
                            disabled={imprimir.isPending}
                            onClick={() => imprimir.mutate({ cobros, fecha })}
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
                                {pesos.format(n(c.total))}
                              </td>
                              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                                {n(c.cheque) > 0 ? pesos.format(n(c.cheque)) : '—'}
                              </td>
                              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                                {n(c.efectivo) > 0 ? pesos.format(n(c.efectivo)) : '—'}
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
                              <strong>{pesos.format(tot.total)}</strong>
                            </td>
                            <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                              {tot.cheque > 0 ? pesos.format(tot.cheque) : '—'}
                            </td>
                            <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                              {tot.efectivo > 0 ? pesos.format(tot.efectivo) : '—'}
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
