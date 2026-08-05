/**
 * Template de impresión del Rol de Visita.
 *
 * Es la planilla en papel que el vendedor llevaba en el auto: una hoja por
 * vendedor y por día, con un renglón numerado por destino. El panel de
 * escritorio ya la imprimía desde su propio DOM; esto la lleva al paquete
 * compartido para que la app también pueda generarla, que es lo que hace falta
 * para imprimirla **junto con las notas de pedido** en un solo trabajo.
 *
 * Va en A4 vertical, igual que el talonario. En el escritorio la planilla sale
 * apaisada, pero acá comparte documento con las notas: una sola orientación por
 * PDF es lo único que el motor de impresión de Android respeta de verdad, y
 * mezclar orientaciones en un mismo trabajo termina en hojas rotadas al azar.
 */

/** Un renglón numerado de la planilla. */
export interface RenglonRolDeVisita {
  numero: number | string
  /** Columna "HORA": la hora real de llegada, no la estimada. */
  hora: string
  cliente_numero: string
  razon_social: string
  direccion: string

  // "TIPO DE VISITA"
  vendio: boolean
  cobro: boolean
  retiro_afilado: boolean
  entrego: boolean

  contacto: string
  /** Columna "RESULTADO (OBSERVACIONES)". */
  resultado: string
}

export interface RolDeVisitaParaImprimir {
  /** Ya formateada: el template no decide formatos de fecha. */
  fecha: string
  vendedor: string
  vendedor_numero: string

  paradas: RenglonRolDeVisita[]

  visitadas: number
  no_visitadas: number
  observaciones_jornada: string
}

/**
 * Renglones en blanco que se imprimen igual. La planilla de papel los tiene, y
 * el vendedor los usa para anotar a mano el destino que aparece en el día.
 */
const FILAS_ROL = 18

function escapar(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function tilde(v: boolean): string {
  return v ? 'X' : ''
}

const RENGLON_VACIO = (): RenglonRolDeVisita => ({
  numero: '',
  hora: '',
  cliente_numero: '',
  razon_social: '',
  direccion: '',
  vendio: false,
  cobro: false,
  retiro_afilado: false,
  entrego: false,
  contacto: '',
  resultado: '',
})

export function generarHtmlRolDeVisita(rol: RolDeVisitaParaImprimir): string {
  const filas = rol.paradas.slice()
  while (filas.length < FILAS_ROL) filas.push(RENGLON_VACIO())

  const cuerpo = filas
    .map(
      (p) => `<tr>
      <td class="c">${escapar(p.numero)}</td>
      <td class="c">${escapar(p.hora)}</td>
      <td class="c">${escapar(p.cliente_numero)}</td>
      <td>${escapar(p.razon_social)}</td>
      <td>${escapar(p.direccion)}</td>
      <td class="tick">${tilde(p.vendio)}</td>
      <td class="tick">${tilde(p.cobro)}</td>
      <td class="tick">${tilde(p.retiro_afilado)}</td>
      <td class="tick">${tilde(p.entrego)}</td>
      <td>${escapar(p.contacto)}</td>
      <td class="resultado">${escapar(p.resultado)}</td>
    </tr>`,
    )
    .join('')

  const sinResolver = Math.max(0, rol.paradas.length - rol.visitadas - rol.no_visitadas)

  return `<div class="rol">
  <div class="rol-cabecera">
    <div class="rol-titulo">ROL DE VISITA</div>
    <div class="rol-datos">
      <span>FECHA: <u>${escapar(rol.fecha)}</u></span>
      <span>VENDEDOR: <u>${escapar(rol.vendedor)}</u></span>
      <span>CÓDIGO: <u>${escapar(rol.vendedor_numero || '—')}</u></span>
    </div>
  </div>

  <table class="rol-tabla">
    <thead>
      <tr>
        <th rowspan="2" class="w-nro">Nº</th>
        <th rowspan="2" class="w-hora">Hora</th>
        <th rowspan="2" class="w-cli">Cliente Nº</th>
        <th rowspan="2" class="w-razon">Razón social o nombre</th>
        <th rowspan="2" class="w-dir">Dirección</th>
        <th colspan="4" class="grupo w-ticks">Tipo de visita</th>
        <th rowspan="2" class="w-contacto">Atendido / Contacto</th>
        <th rowspan="2" class="w-resultado">Resultado (observaciones)</th>
      </tr>
      <tr>
        <th class="w-tick">Ven.</th>
        <th class="w-tick">Cob.</th>
        <th class="w-tick">Afil.</th>
        <th class="w-tick">Ent.</th>
      </tr>
    </thead>
    <tbody>${cuerpo}</tbody>
  </table>

  <div class="rol-pie">
    <div class="rol-resumen">
      <span>Destinos: <strong>${rol.paradas.length}</strong></span>
      <span>Visitados: <strong>${rol.visitadas}</strong></span>
      <span>No visitados: <strong>${rol.no_visitadas}</strong></span>
      ${sinResolver > 0 ? `<span>Sin resolver: <strong>${sinResolver}</strong></span>` : ''}
    </div>
    <div class="rol-observaciones">
      <div class="rol-rotulo">OBSERVACIONES DE LA JORNADA:</div>
      <div class="rol-texto">${escapar(rol.observaciones_jornada)}</div>
    </div>
    <div class="rol-firma">
      <div class="linea"></div>
      Firma del vendedor
    </div>
  </div>
</div>`
}

/**
 * Hoja de estilos de la planilla. Se sirve aparte del HTML por lo mismo que la
 * del talonario: se incrusta una sola vez aunque el documento tenga varias
 * páginas.
 */
export const ESTILOS_ROL_DE_VISITA = `
.rol {
  font-family: Arial, Helvetica, sans-serif;
  font-size: 8pt;
  color: #000;
  width: 190mm;
  margin: 0 auto 8mm;
  page-break-after: always;
}
.rol:last-child { page-break-after: auto; }

.rol-cabecera {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  border: 1px solid #000;
  padding: 3px 5px;
  margin-bottom: 0;
}
.rol-titulo { font-size: 14pt; font-weight: bold; letter-spacing: 1px; }
.rol-datos { display: flex; gap: 8mm; font-size: 9pt; }
.rol-datos u { min-width: 24mm; display: inline-block; }

.rol-tabla { border-collapse: collapse; width: 100%; table-layout: fixed; }
.rol-tabla th, .rol-tabla td {
  border: 1px solid #000;
  padding: 1.5px 3px;
  vertical-align: top;
  word-break: break-word;
}
.rol-tabla th { background: #d9d9d9; font-weight: normal; font-size: 7.5pt; text-align: center; }
.rol-tabla .grupo { font-weight: bold; }
.rol-tabla td { height: 7mm; font-size: 7.5pt; }
.rol-tabla .c { text-align: center; }
.rol-tabla .tick { text-align: center; font-weight: bold; }
.rol-tabla .resultado { font-size: 7pt; line-height: 1.15; }

/* Con table-layout:fixed las columnas salen de la PRIMERA fila del thead, así
   que el grupo "Tipo de visita" necesita su propio ancho: sin él las cuatro
   columnas de tilde se reparten la sobra y los rótulos se parten al medio. */
.w-nro { width: 4%; } .w-hora { width: 6%; } .w-cli { width: 7%; }
.w-razon { width: 17%; } .w-dir { width: 18%; }
.w-ticks { width: 18%; } .w-tick { width: 4.5%; }
.w-contacto { width: 11%; } .w-resultado { width: 19%; }

.rol-pie { margin-top: 3mm; }
.rol-resumen { display: flex; gap: 10mm; font-size: 9pt; margin-bottom: 2mm; }

.rol-observaciones { border: 1px solid #000; }
.rol-rotulo { background: #d9d9d9; border-bottom: 1px solid #000; padding: 2px 4px; font-weight: bold; }
.rol-texto { min-height: 14mm; padding: 2px 4px; white-space: pre-wrap; word-break: break-word; }

.rol-firma { margin-top: 12mm; width: 60mm; margin-left: auto; text-align: center; font-size: 8pt; }
.rol-firma .linea { border-top: 1px dotted #000; margin-bottom: 2px; }

@media print {
  .rol { margin: 0 auto; }
  .rol-tabla th, .rol-rotulo {
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
}
`
