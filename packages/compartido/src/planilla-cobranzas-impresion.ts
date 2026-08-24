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
  /** "FACTURA" o "PRESUPUESTO". Va pegado al nombre, no en columna propia. */
  comprobante: string
  total: string
  cheque: string
  efectivo: string
  comentarios: string
}

export interface PlanillaCobranzasParaImprimir {
  vendedor_numero: string
  vendedor: string
  /** La zona que recorrió. En la planilla de papel dice "GIRA ZONA". */
  gira_zona: string
  fecha: string
  cobros: RenglonCobranza[]
  /** La suma, ya escrita. */
  total_general: string
}

/**
 * Renglones en blanco que se imprimen igual.
 *
 * La planilla de papel los tiene, y el vendedor los usa para anotar a mano el
 * cobro que aparece después de haber impreso la hoja.
 */
const FILAS_PLANILLA = 22

function escapar(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const VACIO = (): RenglonCobranza => ({
  cliente_codigo: '',
  cliente_nombre: '',
  comprobante: '',
  total: '',
  cheque: '',
  efectivo: '',
  comentarios: '',
})

export function generarHtmlPlanillaCobranzas(planilla: PlanillaCobranzasParaImprimir): string {
  const filas = planilla.cobros.slice()
  while (filas.length < FILAS_PLANILLA) filas.push(VACIO())

  const cuerpo = filas
    .map(
      (c) => `<tr>
      <td class="c">${escapar(c.cliente_codigo)}</td>
      <td>${escapar(c.cliente_nombre)}${
        c.comprobante ? `<br><span class="comprobante">${escapar(c.comprobante)}</span>` : ''
      }</td>
      <td class="num">${escapar(c.total)}</td>
      <td class="num">${escapar(c.cheque)}</td>
      <td class="num">${escapar(c.efectivo)}</td>
      <td>${escapar(c.comentarios)}</td>
    </tr>`,
    )
    .join('')

  return `<div class="cobranzas">
  <div class="cob-cabecera">
    <div class="cob-vendedor">VENDEDOR Nº <u>${escapar(planilla.vendedor_numero || '—')}</u></div>
    <div class="cob-titulo">PLANILLA DE COBRANZAS</div>
    <div class="cob-datos">
      <span>GIRA ZONA: <u>${escapar(planilla.gira_zona || '—')}</u></span>
      <span>FECHA: <u>${escapar(planilla.fecha)}</u></span>
    </div>
  </div>
  <div class="cob-nombre">${escapar(planilla.vendedor)}</div>

  <table class="cob-tabla">
    <thead>
      <tr>
        <th class="w-cod">CODIGO</th>
        <th class="w-cli">CLIENTE</th>
        <th class="w-tot">TOTAL COBRADO</th>
        <th class="w-che">CHEQUE</th>
        <th class="w-efe">EFECTIVO</th>
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
      </tr>
    </tfoot>
  </table>

  <div class="cob-firma">
    <div class="linea"></div>
    Firma del vendedor
  </div>
</div>`
}

/**
 * Hoja de estilos de la planilla.
 *
 * Los anchos suman 100 y la tabla es table-layout:fixed, igual que las otras
 * dos: si no suman, el navegador reparte la sobra a su criterio y la maqueta se
 * desarma — y esto se imprime desde el teléfono, donde nadie lo mira antes de
 * que salga la hoja.
 */
export const ESTILOS_PLANILLA_COBRANZAS = `
.cobranzas { font-family: Arial, Helvetica, sans-serif; color: #000; }

.cob-cabecera {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 6mm;
  margin-bottom: 1mm;
}
.cob-vendedor { font-size: 9pt; }
.cob-titulo { font-size: 13pt; font-weight: bold; letter-spacing: 0.5px; }
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

.w-cod { width: 10%; } .w-cli { width: 30%; }
.w-tot { width: 14%; } .w-che { width: 12%; } .w-efe { width: 12%; }
.w-com { width: 22%; }

.cob-firma { margin-top: 8mm; text-align: center; font-size: 8pt; }
.cob-firma .linea { border-top: 1px dotted #000; width: 60mm; margin: 0 auto 2px; }
`
