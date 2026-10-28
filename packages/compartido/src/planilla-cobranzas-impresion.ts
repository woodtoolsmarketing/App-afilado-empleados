/**
 * Template de impresión de la PLANILLA DE COBRANZAS.
 *
 * Es la hoja que el vendedor rendía a mano: encabezado con vendedor, gira y
 * fecha, un renglón por cobro, y un TOTAL GENERAL abajo. Se reproduce con las
 * mismas columnas y en el mismo orden que la de papel, porque la oficina la
 * lee de memoria y una columna corrida obliga a leerla dos veces.
 *
 * Va en A4 vertical, igual que el talonario y que el rol de visita: comparte
 * documento con ellos, y una sola orientación por PDF es lo único que el motor
 * de impresión de Android respeta de verdad.
 */

/** Un cobro, ya escrito. El template no decide formatos. */
export interface RenglonCobranza {
  cliente_codigo: string
  cliente_nombre: string
  total: string
  cheque: string
  efectivo: string
  /** Importe retenido, ya escrito. Vacío cuando es 0 (misma regla que cheque/efectivo). */
  retenciones: string
  comentarios: string
}

export interface PlanillaCobranzasParaImprimir {
  vendedor_numero: string
  /**
   * `true` si la planilla es de PRESUPUESTO, `false` si es de FACTURA. Cada
   * planilla es de un solo comprobante.
   *
   * El nombre del comprobante ya NO se imprime: la de presupuesto lleva un `*`
   * en la esquina superior derecha y la de factura no lleva nada. Con eso la
   * oficina las distingue de un vistazo, sin la palabra "FACTURA"/"PRESUPUESTO".
   */
  esPresupuesto: boolean
  fecha: string
  cobros: RenglonCobranza[]
  /** La suma, ya escrita. */
  total_general: string
}

function escapar(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function generarHtmlPlanillaCobranzas(planilla: PlanillaCobranzasParaImprimir): string {
  // Solo los cobros que cargo el vendedor: NO se rellenan renglones en blanco.
  // Antes se completaba hasta 14 filas para imitar la planilla de papel (que
  // trae renglones para anotar a mano); se saco a pedido. La hoja sale con lo
  // que hay y nada mas, sin recuadros de mas.
  const cuerpo = planilla.cobros
    .map(
      (c) => `<tr>
      <td class="c">${escapar(c.cliente_codigo)}</td>
      <td>${escapar(c.cliente_nombre)}</td>
      <td class="num">${escapar(c.total)}</td>
      <td class="num">${escapar(c.cheque)}</td>
      <td class="num">${escapar(c.efectivo)}</td>
      <td class="num">${escapar(c.retenciones)}</td>
      <td>${escapar(c.comentarios)}</td>
    </tr>`,
    )
    .join('')

  return `<div class="cobranzas">
  ${planilla.esPresupuesto ? '<div class="cob-marca" aria-hidden="true">*</div>' : ''}
  <div class="cob-cabecera">
    <div class="cob-vendedor">VENDEDOR Nº <u>${escapar(planilla.vendedor_numero || '—')}</u></div>
    <div class="cob-datos">
      <span>FECHA: <u>${escapar(planilla.fecha)}</u></span>
    </div>
  </div>

  <table class="cob-tabla">
    <thead>
      <tr>
        <th class="w-cod">CODIGO</th>
        <th class="w-cli">CLIENTE</th>
        <th class="w-tot">TOTAL</th>
        <th class="w-che">CHEQUE</th>
        <th class="w-efe">EFECTIVO</th>
        <th class="w-ret">RETENC.</th>
        <th class="w-com">COMENTARIOS</th>
      </tr>
    </thead>
    <tbody>${cuerpo}</tbody>
    <tfoot>
      <tr class="cob-total">
        <td></td>
        <td>TOTAL GENERAL</td>
        <td class="num">${escapar(planilla.total_general)}</td>
        <td></td>
        <td></td>
        <td></td>
        <td></td>
      </tr>
    </tfoot>
  </table>
</div>`
}

/**
 * El documento de las planillas de un día: factura y presupuesto en UNA sola
 * hoja A4, divididas por una línea.
 *
 * Antes iba en A5, una planilla por página. Ahora las dos (factura y presupuesto
 * del día) conviven en la misma A4, separadas por una línea de corte:
 * `.cobranzas` ya no rompe página entre una y otra (se pisa a `auto` abajo), y
 * como la tabla trae sólo los cobros cargados —sin renglones en blanco— las dos
 * entran sobradas. El tamaño físico lo fija también quien imprime: en el panel,
 * electron `printToPDF({ pageSize: 'A4' })`. Los dos tienen que declarar lo
 * mismo —este `@page` y el `pageSize`— o la impresora reescala, como pasaba con
 * Letter vs A4.
 *
 * Lo imprime SÓLO el panel (la oficina). El teléfono ya no imprime la planilla
 * aparte: el vendedor sólo carga los cobros y los mira en el historial.
 */
/**
 * Umbral para partir las planillas: con 15 cobros o más entre factura y
 * presupuesto no entran en una sola A4, así que se parten en hojas distintas.
 * Con menos, los dos recuadros van JUNTOS en una hoja (pedido de la oficina).
 */
export const COBROS_PLANILLA_SE_PARTE = 15

/**
 * CSS para que las planillas de un mismo día convivan en una hoja.
 *
 * Lo comparten el documento del panel y el del teléfono. El salto de página va
 * DESPUÉS del bloque del día (`.cobranzas-dia`), no entre la factura y el
 * presupuesto: adentro del bloque las `.cobranzas` se pisan a `auto`.
 */
export const ESTILOS_PLANILLAS_JUNTAS = `
.cobranzas-dia { page-break-after: always; }
.cobranzas-dia .cobranzas { page-break-after: auto; }
.cob-divisor { border-top: 1.5px dashed #000; margin: 5mm 6mm; }
`

/**
 * El HTML de las planillas de UN día (su factura y/o su presupuesto).
 *
 * Con pocos cobros, los dos recuadros van JUNTOS en una hoja, divididos por la
 * línea de corte. Con `COBROS_PLANILLA_SE_PARTE` (15) o más entre los dos no
 * entran, así que quedan como hojas sueltas (cada `.cobranzas` con su salto).
 * Con una sola planilla tampoco hay nada que juntar.
 */
export function bloqueDePlanillasDelDia(planillasDelDia: PlanillaCobranzasParaImprimir[]): string {
  const html = planillasDelDia.map(generarHtmlPlanillaCobranzas)
  const total = planillasDelDia.reduce((suma, p) => suma + p.cobros.length, 0)
  if (html.length <= 1 || total >= COBROS_PLANILLA_SE_PARTE) {
    return html.join('\n')
  }
  return `<div class="cobranzas-dia">${html.join(
    '\n<div class="cob-divisor" aria-hidden="true"></div>\n',
  )}</div>`
}

export function generarDocumentoPlanillasCobranzas(
  planillas: PlanillaCobranzasParaImprimir[],
): string {
  // El panel arma por vendedor+día, así que `planillas` son la factura y/o el
  // presupuesto de un solo día: van juntas salvo que sumen 15+ cobros.
  const cuerpo = bloqueDePlanillasDelDia(planillas)
  // El margen va en `.cobranzas` (padding) y no en `@page`: el panel imprime con
  // `printToPDF({ margins: 0 })`, que pisa el margen de `@page`.
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<style>
@page { size: A4 portrait; margin: 0; }
html, body { margin: 0; padding: 0; }
${ESTILOS_PLANILLA_COBRANZAS}
${ESTILOS_PLANILLAS_JUNTAS}
</style>
</head>
<body>${cuerpo}</body>
</html>`
}

/**
 * Hoja de estilos de la planilla.
 *
 * Los anchos suman 100 y la tabla es table-layout:fixed, igual que las otras
 * dos: si no suman, el navegador reparte la sobra a su criterio y la maqueta se
 * desarma.
 */
export const ESTILOS_PLANILLA_COBRANZAS = `
.cobranzas { font-family: Arial, Helvetica, sans-serif; color: #000; padding: 6mm; page-break-after: always; position: relative; }
.cobranzas:last-child { page-break-after: auto; }

.cob-cabecera {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 6mm;
  margin-bottom: 1mm;
}
.cob-vendedor { font-size: 9pt; }
/* La marca que distingue la planilla de PRESUPUESTO de la de FACTURA: un
   asterisco en la esquina superior derecha, solo en la de presupuesto (la de
   factura no lleva nada). Va posicionado en la esquina, afuera del renglon del
   encabezado, para no pisar la FECHA que vive a la derecha de esa fila. */
.cob-marca { position: absolute; top: 2mm; right: 4mm; font-size: 18pt; font-weight: bold; line-height: 1; }
.cob-datos { display: flex; gap: 6mm; font-size: 9pt; }
.cob-datos u, .cob-vendedor u { min-width: 22mm; display: inline-block; }
.cob-nombre { font-size: 9pt; margin-bottom: 2mm; }

.cob-tabla { width: 100%; border-collapse: collapse; table-layout: fixed; }
.cob-tabla th, .cob-tabla td {
  border: 1px solid #000;
  padding: 1.5px 3px;
  vertical-align: top;
  word-break: break-word;
}
.cob-tabla th {
  background: #d9d9d9;
  font-weight: normal;
  font-size: 7.5pt;
  text-align: center;
}
.cob-tabla td { height: 7mm; font-size: 8pt; }
.cob-tabla .c { text-align: center; }
.cob-tabla .num { text-align: right; }
/* El comprobante va abajo del nombre y más chico: aclara contra qué se cobró
   sin gastar una columna, que en esta hoja no sobra ninguna. */
.comprobante { font-size: 6.5pt; color: #444; }

.cob-total td { font-weight: bold; background: #ececec; height: 8mm; }

/* Entró la columna RETENC.: se le hace lugar achicando CODIGO (10→8) y
   COMENTARIOS (22→13). Siguen sumando 100, que es lo que table-layout:fixed
   necesita para no repartir la sobra a su criterio. */
.w-cod { width: 8%; } .w-cli { width: 30%; }
.w-tot { width: 14%; } .w-che { width: 12%; } .w-efe { width: 12%; }
.w-ret { width: 11%; } .w-com { width: 13%; }
`
