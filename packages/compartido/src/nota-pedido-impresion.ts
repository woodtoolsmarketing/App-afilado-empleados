/**
 * Template de impresión de la Nota de Pedido.
 *
 * Reproduce el talonario preimpreso de Formas Continuas. Vive en el paquete
 * compartido porque lo usan los dos lados: el panel de escritorio para imprimir
 * por USB o red, y la app móvil para mandarlo a la impresora por WiFi.
 *
 * Cuatro variantes, que NO son cosméticas:
 *
 *  · ORIGINAL con logo   → tipo de nota "FACTURA"
 *  · ORIGINAL sin logo   → tipo de nota "PRESUPUESTO"
 *  · DUPLICADO           → **sin precios**. La copia que va al taller lleva
 *    sólo el código de cómputo y la cantidad, más los recuadros de Depósito Nº,
 *    Nº Movimiento, Fecha y Hora. El taller no tiene por qué ver lo que se le
 *    cobró al cliente.
 *
 * Las filas vacías de las dos tablas se imprimen igual: el formulario en papel
 * las tiene y la gente de fábrica las usa para anotar a mano.
 */

import { formatearMoneda, type Moneda } from './catalogo'
import { LOGO_WOODTOOLS } from './logo'
import {
  consolidarLineasDeComputo,
  describirCondicionVenta,
  lineasDeComputo,
  MAXIMO_RENGLONES,
  numeroDeVendedorImpreso,
  VENDEDORES_CON_CERO,
  type DatosComputo,
} from './notas-pedido'
import {
  ESTILOS_ROL_DE_VISITA,
  generarHtmlRolDeVisita,
  type RolDeVisitaParaImprimir,
} from './rol-de-visita-impresion'
import type { TipoNotaPedido, TipoServicio } from './tipos'

/**
 * Qué se anota en una casilla de "Operación".
 *
 * Cuando el trabajo se cuenta por dientes va el NÚMERO de dientes, no un tilde:
 * el mismo 187 que se computa del otro lado de la hoja. El taller mira la
 * columna técnica para saber qué hacer con la pieza, y "afilar" sin cantidad
 * obliga a cruzar con la tabla comercial para saber cuántos dientes son.
 *
 * `true` sigue significando "esta operación, sin cantidad" y sale como X.
 */
export type CasillaOperacion = boolean | number | string

export interface RenglonTecnico {
  descripcion: string
  /** Columnas "Operación" del formulario. */
  afilado: CasillaOperacion
  rectificado: CasillaOperacion
  reparacion: CasillaOperacion
  tensado: CasillaOperacion
  rellenado: CasillaOperacion
  otro: string
  cantidad: number | string
  /** Columna "ØExt.-Largo". */
  diametro_exterior: string
  /** Columna "ØInt.-Ancho". */
  diametro_interior: string
  /** Columna "Ancho Corte / Espesor". */
  ancho_corte: string
  /** Columna "Z-Paso": cantidad de dientes o paso de la sierra. */
  z_paso: string
}

export interface RenglonComercial {
  codigo_computo: string
  cantidad: number | string
  /**
   * Lo que vale UNA unidad de lo que se computa: el precio por diente que sale
   * de la lista de precios, o el precio de la unidad en una venta.
   */
  precio_unitario: string
  /** El resultado: cantidad × precio unitario. */
  precio: string
  condicion_venta: string
  anticipo: string
  observaciones: string
}

export interface NotaParaImprimir {
  numero: string | null
  tipo_nota: TipoNotaPedido | null
  servicios: TipoServicio[]

  vendedor_numero: string
  cliente_numero: string | null
  zona: string

  datos_cliente: string
  descripcion_herramientas: string

  tecnicos: RenglonTecnico[]
  comerciales: RenglonComercial[]

  /**
   * Los totales ya escritos, uno por moneda: `$ 65.696,40 · U$S 120,00`.
   *
   * Salen de las mismas líneas que se imprimen arriba, así que la suma no
   * puede diferir de los renglones que la componen.
   */
  totales: string

  tipo_cambio: string
  /** Ya escrita: "Contado", "Cheque a 30 días", el texto libre de "Otro". */
  condicion_venta?: string
  emision: string
  /**
   * La fecha que el vendedor acordó con el cliente. Va impresa en "Fca.
   * Entrega": el resto de esa caja son fechas que completa la fábrica a mano,
   * pero ésta ya se sabe cuando se emite la nota y es lo que el cliente espera
   * leer.
   */
  fecha_entrega?: string
}

export interface OpcionesImpresion {
  copia: 'original' | 'duplicado'
  /**
   * El logo va sólo en las notas tipo FACTURA, y va en las DOS copias: el
   * original que se lleva el cliente y el duplicado que va al taller.
   */
  conLogo: boolean
  /**
   * Data URI del logo. Por defecto el de la marca, embebido en el paquete.
   *
   * Se puede pisar, pero no hace falta: antes era obligatorio pasarlo y no lo
   * pasaba nadie, así que la casilla del logo salía vacía en todas las
   * facturas desde que existe el template.
   */
  logoDataUri?: string
}

/** Filas en blanco que trae el talonario y que la fábrica completa a mano. */
const FILAS_TECNICAS = MAXIMO_RENGLONES
const FILAS_COMERCIALES = MAXIMO_RENGLONES

/**
 * El alto de la hoja, en milímetros.
 *
 * Una A4 son 297 mm y con los márgenes de 8 mm quedan 281 útiles, pero ése es
 * el número teórico: el área imprimible real la decide la impresora y siempre
 * es menor. Con 265 la nota se ve llena —lo que sobra se lo reparten las filas
 * de las tablas— y queda colchón para que ninguna impresora la mande a una
 * segunda hoja.
 */
const ALTO_HOJA_MM = 265

/**
 * Una hoja A4 medida en puntos: 595 × 842.
 *
 * ─── Por qué hay que decirlo, y por qué acá ──────────────────────────────────
 *
 * El celular arma el PDF con `expo-print`, y `expo-print` genera **hoja Carta**
 * si no se le dice otra cosa: en su código el tamaño por defecto es 612 × 792
 * puntos, que son 8,5 × 11 pulgadas. Nadie lo eligió; es el default de una
 * librería pensada en Estados Unidos.
 *
 * El efecto no era un error visible sino una nota encogida. La plantilla pide
 * A4, el PDF salía Carta, y después la impresora aplicaba "reducir para
 * ajustar" para meter una Carta en una A4. La nota terminaba dibujada a algo
 * más del 90 % con una franja blanca abajo, y en el duplicado la palabra
 * DUPLICADO salía cortada al medio. Se veía como un problema de la plantilla
 * —que mide 265 mm exactos en un navegador— y era del tamaño de la hoja.
 *
 * 210 mm ÷ 25,4 × 72 = 595,3 y 297 mm ÷ 25,4 × 72 = 841,9. Redondeados, 595 y
 * 842. Con eso el `@page { size: A4 }` del CSS coincide con el papel de verdad
 * y no queda ninguna escala en el medio.
 */
export const A4_ANCHO_PT = 595
export const A4_ALTO_PT = 842

/**
 * El alto de los dos bloques de texto libre, en milímetros.
 *
 * **Fijo, como en el talonario de papel.** Antes crecían con el texto, y unos
 * datos de cliente largos —dirección, CP, dos teléfonos, mail y contacto, que
 * es lo que trae el padrón— empujaban toda la nota fuera de la hoja. En el
 * papel ese recuadro tampoco crece: lo que no entra, no entra.
 */
const ALTO_DATOS_CLIENTE_MM = 17
const ALTO_DESCRIPCION_MM = 11

/**
 * El duplicado tiene el chrome apretado —encabezado, rótulos y cajas chicas—
 * pero **llena la hoja**: el espacio que se le gana al adorno se le da a las
 * filas donde el taller escribe a mano. Una hoja A4 a medio usar es papel
 * igual de gastado que una con márgenes gordos.
 *
 * La tabla comercial se estira sola hasta el borde inferior (ver `.duplicado`
 * en los estilos), así que estos números son el piso, no el total.
 */
const FILAS_TECNICAS_DUPLICADO = MAXIMO_RENGLONES
const FILAS_COMERCIALES_DUPLICADO = MAXIMO_RENGLONES

function escapar(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Lo que se imprime en una casilla de operación: la cantidad de dientes si la
 * hay, una X si sólo se marcó la operación, y nada si no aplica.
 */
function tilde(v: CasillaOperacion): string {
  if (v === true) return 'X'
  if (v === false || v === null || v === undefined || v === '') return ''
  return String(v)
}

/**
 * Completa la lista con filas vacías hasta llegar al alto del formulario.
 *
 * **No corta.** Antes hacía `slice(0, hasta)` y una nota con doce renglones
 * —o con tres de cómputo y diez observaciones— perdía los últimos sin avisar:
 * la nota salía impresa, prolija, incompleta y sin nada que lo delatara. Si
 * sobran, la tabla crece y a lo sumo se estira la hoja, que es un problema que
 * se ve.
 */
function rellenar<T>(filas: T[], hasta: number, vacia: () => T): T[] {
  const salida = filas.slice()
  while (salida.length < hasta) salida.push(vacia())
  return salida
}

const TECNICO_VACIO = (): RenglonTecnico => ({
  descripcion: '',
  afilado: false,
  rectificado: false,
  reparacion: false,
  tensado: false,
  rellenado: false,
  otro: '',
  cantidad: '',
  diametro_exterior: '',
  diametro_interior: '',
  ancho_corte: '',
  z_paso: '',
})

/**
 * Reparte las observaciones en la columna que les corresponde.
 *
 * Van una por renglón, como en el talonario de papel. Si hay más observaciones
 * que renglones de cómputo se agregan filas: la observación es del cliente y no
 * se puede perder porque no haya sobrado una fila.
 */
function conObservaciones(filas: RenglonComercial[], observaciones: string[]): RenglonComercial[] {
  if (observaciones.length === 0) return filas
  const salida = filas.slice()
  observaciones.forEach((texto, i) => {
    if (!salida[i]) salida[i] = COMERCIAL_VACIO()
    salida[i] = { ...salida[i], observaciones: texto }
  })
  return salida
}

const COMERCIAL_VACIO = (): RenglonComercial => ({
  codigo_computo: '',
  cantidad: '',
  precio_unitario: '',
  precio: '',
  condicion_venta: '',
  anticipo: '',
  observaciones: '',
})

export function generarHtmlNotaPedido(
  nota: NotaParaImprimir,
  opciones: OpcionesImpresion,
): string {
  const esDuplicado = opciones.copia === 'duplicado'
  const tecnicos = rellenar(
    nota.tecnicos,
    esDuplicado ? FILAS_TECNICAS_DUPLICADO : FILAS_TECNICAS,
    TECNICO_VACIO,
  )
  const comerciales = rellenar(
    nota.comerciales,
    esDuplicado ? FILAS_COMERCIALES_DUPLICADO : FILAS_COMERCIALES,
    COMERCIAL_VACIO,
  )

  // El número va opaco mientras Administración no le asigne el código de
  // cliente: la nota existe pero todavía no es un comprobante.
  const numero = nota.numero
    ? escapar(nota.numero)
    : '<span class="pendiente">— — —<small>(Pendiente)</small></span>'

  const logo = opciones.logoDataUri ?? LOGO_WOODTOOLS
  const celdaLogo = opciones.conLogo
    ? `<img src="${escapar(logo)}" alt="WoodTools S.R.L." class="logo">`
    : ''

  const filasTecnicas = tecnicos
    .map(
      (t) => `<tr>
      <td class="desc">${escapar(t.descripcion)}</td>
      <td class="tick">${tilde(t.afilado)}</td>
      <td class="tick">${tilde(t.rectificado)}</td>
      <td class="tick">${tilde(t.reparacion)}</td>
      <td class="tick">${tilde(t.tensado)}</td>
      <td class="tick">${tilde(t.rellenado)}</td>
      <td>${escapar(t.otro)}</td>
      <td class="num">${escapar(t.cantidad)}</td>
      <td class="num">${escapar(t.diametro_exterior)}</td>
      <td class="num">${escapar(t.diametro_interior)}</td>
      <td class="num">${escapar(t.ancho_corte)}</td>
      <td class="num">${escapar(t.z_paso)}</td>
    </tr>`,
    )
    .join('')

  const filasComerciales = comerciales
    .map((c, i) => {
      if (esDuplicado) {
        // El duplicado sólo lleva código y cantidad.
        return `<tr>
          <td>${escapar(c.codigo_computo)}</td>
          <td class="num">${escapar(c.cantidad)}</td>
        </tr>`
      }
      // "Tipo de Cambio" va en la columna Condición de Venta, cerca del pie,
      // igual que en el talonario. La condición de venta de la nota va arriba
      // de todo, en la primera fila, que es donde se lee primero.
      const esFilaCambio = i === comerciales.length - 3
      // Lo propio de la fila —"SIN CARGO", "Reparación dientes"— no se pierde
      // aunque le toque compartir casilla con la condición de la nota: antes
      // la primera fila lo perdía sin aviso.
      const propia = escapar(c.condicion_venta)
      const condicion = esFilaCambio
        ? `Tipo de Cambio:<br><span class="cambio">${escapar(nota.tipo_cambio)}</span>`
        : i === 0 && nota.condicion_venta
          ? `<strong>${escapar(nota.condicion_venta)}</strong>${propia ? `<br>${propia}` : ''}`
          : propia
      return `<tr>
        <td>${escapar(c.codigo_computo)}</td>
        <td class="num">${escapar(c.cantidad)}</td>
        <td class="num">${escapar(c.precio_unitario)}</td>
        <td class="num">${escapar(c.precio)}</td>
        <td>${condicion}</td>
        <td class="num">${escapar(c.anticipo)}</td>
        <td>${escapar(c.observaciones)}</td>
      </tr>`
    })
    .join('')

  // "Precio unitario" y "Precio total" van apilados en dos renglones: puestos
  // de corrido se comían el ancho de las columnas de al lado. El código de
  // cómputo cede el espacio, que es el que le sobraba.
  const comercialesCabecera = esDuplicado
    ? `<tr><th class="w-codigo">Código de Cómputo</th><th class="w-cant">Cantidad</th></tr>`
    : `<tr>
        <th class="w-codigo">Código de Cómputo</th>
        <th class="w-cant">Cantidad</th>
        <th class="w-precio">Precio<br>unitario</th>
        <th class="w-precio">Precio<br>total</th>
        <th>Condicion de Venta</th>
        <th>Anticipo</th>
        <th>Observaciones</th>
      </tr>`

  const cajaDeposito = `<table class="caja">
          <tr><td>Deposito Nº</td></tr>
          <tr><td>Nº Movimiento</td></tr>
          <tr><td>Fecha</td></tr>
          <tr><td>Hora</td></tr>
        </table>`

  // El duplicado reemplaza el bloque de firmas por el talón desprendible. Los
  // recuadros de depósito ya no van acá: subieron al costado de la tabla
  // comercial, que es donde están en el talonario de papel.
  const pie = esDuplicado
    ? `<div class="talon">
        <div class="talon-num">NOTA DE<br>PEDIDO N<br><strong>${nota.numero ? escapar(nota.numero) : '— — —'}</strong></div>
        <div class="talon-medio"></div>
        ${cajaDeposito}
      </div>`
    : `<div class="firmas">
        <div><div class="linea"></div>Conforme del Vendedor</div>
        <div><div class="linea"></div>Retira el Vendedor</div>
      </div>`

  /**
   * El bloque comercial.
   *
   * En el ORIGINAL la tabla ocupa el ancho entero: son siete columnas y todas
   * llevan datos.
   *
   * En el DUPLICADO son dos —código y cantidad— y estirarlas a lo ancho de la
   * hoja dejaba dos columnas larguísimas con un número adentro y una pared de
   * líneas vacías al costado. Va como en el talonario impreso: la tabla angosta
   * a la izquierda, los recuadros de depósito y la firma a la derecha, y **el
   * medio libre** para que en fábrica agreguen renglones a mano.
   */
  const bloqueComercial = esDuplicado
    ? `<div class="comercial-duplicado">
        <table class="tabla comercial">
          <thead>${comercialesCabecera}</thead>
          <tbody>${filasComerciales}</tbody>
        </table>
        <div class="espacio-libre"></div>
        <div class="cajas-duplicado">
          ${cajaDeposito}
          <table class="caja firma-caja">
            <tr><td class="alto">Fecha:</td></tr>
            <tr><td class="pie-firma">Firma Retira el Vendedor</td></tr>
          </table>
        </div>
      </div>`
    : `<table class="tabla comercial">
        <thead>${comercialesCabecera}</thead>
        <tbody>${filasComerciales}</tbody>
      </table>`

  /**
   * Cuánto suma la nota.
   *
   * Antes acá iba también "Renglones cargados: N de 12". Se sacó a pedido: ese
   * número sirve para decidir mientras se carga —cuántos van, cuántos quedan— y
   * eso pasa en el teléfono, no en el papel. Impreso llegaba tarde, cuando ya
   * no se puede agregar nada. Ahora la app lo muestra desde el primer renglón.
   *
   * El duplicado no lleva importes: es la copia del taller. Como era lo único
   * que le quedaba a esta franja, en el duplicado no se dibuja nada en vez de
   * dejar un recuadro vacío; el alto que libera se lo reparten las filas de las
   * tablas, que es donde en fábrica escriben a mano.
   */
  const totalVisible = !esDuplicado && !!nota.totales
  const resumen = totalVisible
    ? `<div class="resumen">
    <span>TOTAL: <strong>${escapar(nota.totales)}</strong></span>
  </div>`
    : ''

  return `<div class="nota ${esDuplicado ? 'duplicado' : 'original'}">
  <table class="encabezado">
    <tr>
      <td class="celda-logo">${celdaLogo}</td>
      <td class="control">
        <div class="control-titulo">FECHA DE CONTROL</div>
        <div class="control-linea"><span>Emision NP:</span><span class="fecha-vacia">${escapar(nota.emision)}</span></div>
        <div class="control-linea"><span>Emision Plano:</span><span class="fecha-vacia">___/___/___</span></div>
        <div class="control-linea"><span>Recibido Fca.:</span><span class="fecha-vacia">___/___/___</span></div>
        <div class="control-linea"><span>Finalizado Fca.:</span><span class="fecha-vacia">___/___/___</span></div>
        <div class="control-linea"><span>Fecha de entrega:</span><span class="fecha-vacia">${
          nota.fecha_entrega ? escapar(nota.fecha_entrega) : '___/___/___'
        }</span></div>
      </td>
      <td class="numero-caja">
        <div class="numero-titulo">NOTA DE PEDIDO</div>
        <div class="numero">Nº ${numero}</div>
        <div class="comprobantes">
          <div>FACTURA Nº:</div>
          <div>REMITO Nº:</div>
        </div>
      </td>
    </tr>
  </table>

  <div class="identificacion">
    <span>Vendedor Nº <u>${escapar(nota.vendedor_numero)}</u></span>
    <span>Cliente Nº <u>${nota.cliente_numero ? escapar(nota.cliente_numero) : '&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;'}</u></span>
    <span>Zona <u>${escapar(nota.zona)}</u></span>
  </div>

  <div class="bloque-cliente">
    <div class="rotulo">DATOS DEL CLIENTE:</div>
    <div class="texto-libre">${escapar(nota.datos_cliente)}</div>
  </div>

  <div class="bloque-titulo">DESCRIPCION GENERAL DE LAS HERRAMIENTAS</div>
  <div class="texto-libre alto-2">${escapar(nota.descripcion_herramientas)}</div>

  <div class="bloque-titulo">CARACTERISTICAS TECNICAS</div>
  <table class="tabla tecnica">
    <thead>
      <tr>
        <th colspan="7" class="grupo">Operación</th>
        <th rowspan="2">Cantidad</th>
        <th rowspan="2">ØExt.-Largo</th>
        <th rowspan="2">ØInt.-Ancho</th>
        <th rowspan="2">Ancho Corte<br>Espesor</th>
        <th rowspan="2">Z-Paso</th>
      </tr>
      <tr>
        <th class="w-desc">Descripción</th>
        <th class="w-tick">Afil.</th>
        <th class="w-tick">Rect.</th>
        <th class="w-tick">Rep.</th>
        <th class="w-tick">Tens.</th>
        <th class="w-tick">Rell</th>
        <th class="w-otro">Otro</th>
      </tr>
    </thead>
    <tbody>${filasTecnicas}</tbody>
  </table>

  <div class="bloque-titulo">CARACTERISTICAS COMERCIALES</div>
  ${bloqueComercial}
  ${resumen}

  ${pie}

  <div class="copia">${esDuplicado ? 'DUPLICADO' : 'ORIGINAL'}</div>
</div>`
}

/**
 * Hoja de estilos del talonario.
 *
 * Se sirve aparte del HTML para poder incrustarla una sola vez cuando se
 * imprimen varias notas de corrido, que es el caso de "Imprimir notas de
 * pedido pendientes".
 */
export const ESTILOS_NOTA_PEDIDO = `
/* ── Que el teléfono no agrande la letra ─────────────────────────────────────
   Esto apaga el "autoajuste de texto" de Chromium, que reagranda por su cuenta
   los párrafos que le parecen chicos. No es lo mismo que el ajuste de letra del
   sistema —ése se compensa al generar el documento, ver conLetraCompensada—
   pero es la otra mitad del mismo problema y apagarlo es gratis. */
html {
  -webkit-text-size-adjust: none;
  text-size-adjust: none;
}

/* ── Una nota, una hoja ──────────────────────────────────────────────────────
   La hoja es una caja de alto FIJO, no una lista de bloques que se apilan
   hasta donde lleguen. Antes el original medía 277 mm contra los 281 útiles de
   una A4: entraba por cuatro milímetros en esta PC y se iba a una segunda hoja
   en cuanto el WebView del celular calculaba una fuente un pelo más alta o la
   impresora se guardaba un margen propio. Y al revés, una nota de dos
   renglones dejaba media hoja en blanco.

   Con el alto fijo pasan las dos cosas que hacen falta: lo que sobra se lo
   reparten las filas de las tablas —que es donde en fábrica escriben a mano— y
   lo que falta las aprieta hasta su mínimo. La hoja siempre sale llena y nunca
   pasa a la siguiente.

   ${ALTO_HOJA_MM} mm y no 281: el área imprimible real siempre es menor que la
   teórica y cambia con la impresora. El colchón es barato —se lo come el hueco
   de las firmas— y desbordar no lo es. */
.nota {
  font-family: Arial, Helvetica, sans-serif;
  font-size: 9.5pt;
  color: #000;
  width: 190mm;
  height: ${ALTO_HOJA_MM}mm;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  page-break-after: always;
  break-after: page;
}
.nota:last-child { page-break-after: auto; break-after: auto; }

/* Las dos tablas se reparten en partes iguales todo lo que sobra. El alto al
   100% es lo que hace que el sobrante baje a las FILAS y no quede como aire
   debajo de la tabla. */
.nota .tabla.tecnica, .nota .tabla.comercial { flex: 1 1 0; height: 100%; }
.nota .tabla tbody tr { height: auto; }
/* El bloque de firmas se va al pie. El aire de arriba es suyo y no sobrante:
   con las tablas repartiéndose todo lo que queda, dejarlo librado al sobrante
   pegaba las líneas de firma contra el borde de la hoja. */
.firmas { margin-top: auto; padding-top: 7mm; }

.nota table { border-collapse: collapse; width: 100%; }
.nota td, .nota th { border: 1px solid #000; padding: 1.5px 3px; }

.encabezado td { vertical-align: top; }
.celda-logo { width: 32%; text-align: center; vertical-align: middle; }
.logo { max-width: 90%; max-height: 24mm; }

.control { width: 40%; }
.control-titulo { font-weight: bold; font-size: 12pt; text-align: center; background: #d9d9d9; margin: -1.5px -3px 2px; padding: 2px; }
.control-linea { display: flex; justify-content: space-between; gap: 6px; padding: 0 2px; }
.fecha-vacia { letter-spacing: 1px; }

.numero-caja { width: 28%; padding: 0; }
.numero-titulo { font-weight: bold; text-align: center; background: #d9d9d9; padding: 2px; border-bottom: 1px solid #000; }
.numero { font-size: 15pt; text-align: center; padding: 3px 0 6px; border-bottom: 1px solid #000; }
.pendiente { color: #999; }
.pendiente small { display: block; font-size: 8pt; }
.comprobantes { padding: 6px 4px; line-height: 2.1; }

.identificacion { display: flex; gap: 10mm; border: 1px solid #000; border-top: 0; padding: 2px 4px; }
.identificacion u { min-width: 18mm; display: inline-block; }

.bloque-cliente { border: 1px solid #000; border-top: 0; }
.rotulo { padding: 2px 4px; }
/* Alto FIJO y no mínimo: es el recuadro del talonario, y crecer con el texto
   era lo que empujaba la nota a una segunda hoja. */
.texto-libre {
  border-top: 1px solid #000;
  height: ${ALTO_DATOS_CLIENTE_MM}mm;
  padding: 2px 4px;
  white-space: pre-wrap;
  word-break: break-word;
  overflow: hidden;
  /* Letra chica y renglones juntos: lo que se busca acá es que entren las
     cinco líneas que trae la ficha del padrón —dirección, CP, teléfono, mail
     y contacto— y no que se lea de lejos. */
  font-size: 8pt;
  line-height: 1.15;
}
.texto-libre.alto-2 {
  height: ${ALTO_DESCRIPCION_MM}mm;
  border: 1px solid #000;
  border-top: 0;
}

.bloque-titulo {
  background: #d9d9d9;
  border: 1px solid #000;
  border-top: 0;
  text-align: center;
  font-weight: bold;
  padding: 2px;
}

.tabla th { background: #d9d9d9; font-weight: normal; font-size: 8.5pt; text-align: center; }
.tabla .grupo { font-weight: bold; }
/* 4.4 mm es el PISO, no el alto: con el reparto de arriba las filas crecen
   hasta llenar la hoja, y sólo bajan hasta acá cuando la nota viene cargada
   hasta el tope. Menos que esto ya no se puede escribir a mano. */
.tabla td { height: 4.4mm; font-size: 8.5pt; }
.tabla .num { text-align: right; }
.tabla .tick { text-align: center; font-weight: bold; }
/* Las casillas de operación pasaron de una X a llevar la cantidad de dientes,
   así que 3.5% (6,6 mm) ya no alcanza: un "187" no entraba. El ancho sale de
   la descripción, que es texto libre y se acomoda. */
.w-desc { width: 14%; } .w-tick { width: 5%; } .w-otro { width: 8%; }
.tabla .tick { font-size: 8pt; }
/* El código de cómputo bajó de 20% a 14% para hacerle lugar a las dos
   columnas de precio. Entra igual: son códigos de cuatro dígitos, y en el peor
   caso —dos códigos separados por coma— sigue entrando. En el duplicado, que
   sólo tiene dos columnas, se lo deja ancho. */
.w-codigo { width: 14%; } .w-cant { width: 8%; } .w-precio { width: 11%; }
.comercial th { line-height: 1.1; }
.cambio { letter-spacing: 1px; }

/* ── El bloque comercial del duplicado ───────────────────────────────────────
   Tabla angosta a la izquierda, cajas a la derecha, y el medio libre para
   escribir a mano. Estirar dos columnas a lo ancho de la hoja dejaba una pared
   de líneas vacías al lado de un número de cuatro dígitos. */
.comercial-duplicado { display: flex; align-items: flex-start; gap: 4mm; }
.comercial-duplicado .comercial { width: 62mm; flex: 0 0 62mm; }
.duplicado .comercial-duplicado .w-codigo { width: 62%; }
.duplicado .comercial-duplicado .w-cant { width: 38%; }
/* El hueco del medio. Crece con la hoja: es el espacio para agregar renglones. */
.espacio-libre { flex: 1 1 auto; }
.cajas-duplicado { display: flex; flex-direction: column; gap: 3mm; flex: 0 0 52mm; }

/* Cuántos renglones lleva la nota y cuánto suma. */
.resumen {
  display: flex;
  /* Quedó un solo dato —el total— y va a la derecha, alineado con la columna
     de importes de la tabla de arriba. Con space-between se pegaba al margen
     izquierdo, lejos de los números que resume. */
  justify-content: flex-end;
  gap: 8mm;
  border: 1px solid #000;
  border-top: 0;
  padding: 2px 6px;
  font-size: 9pt;
}
.resumen strong { font-size: 10pt; }

.firmas { display: flex; justify-content: space-around; text-align: center; }
.firmas .linea { border-top: 1px dotted #000; width: 55mm; margin: 0 auto 2px; }

.deposito { display: flex; justify-content: flex-end; gap: 4mm; margin-top: 2mm; }
.caja { width: 52mm; }
.caja td { height: 5mm; font-size: 8pt; }
.caja .alto { height: 14mm; vertical-align: top; }
.pie-firma { text-align: center; font-size: 8pt; }

.talon { display: flex; align-items: stretch; gap: 0; margin-top: 4mm; border-top: 1px dashed #000; padding-top: 3mm; }
.talon-num { border: 1px solid #000; padding: 3px 6px; font-size: 8.5pt; line-height: 1.2; }
.talon .caja { flex: 0 0 52mm; }
.talon-num strong { font-size: 13pt; }
.talon-medio { flex: 1; border: 1px solid #000; border-left: 0; border-right: 0; }

.copia { text-align: right; font-size: 8pt; margin-top: 2mm; }

/* ── El duplicado, apretado ──────────────────────────────────────────────────
   Es la copia del taller: no lleva precios ni condiciones, así que el aire del
   original es papel desperdiciado. Se achica todo lo que no sea espacio para
   escribir a mano, y las filas de escritura se dejan usables. */
/* Llena la hoja: A4 (297mm) menos los 8mm de margen de cada lado. La tabla
   comercial es la única que crece, así que todo el espacio sobrante termina
   siendo renglones para escribir y no aire entre bloques. */
/* El alto ya lo pone la caja de la hoja para las dos copias: acá sólo queda lo
   que distingue al duplicado, que es la letra apretada. */
.duplicado { font-size: 8.5pt; }
/* En el duplicado la tabla comercial va angosta al costado, así que el bloque
   entero es el que se estira; adentro, la tabla llena su alto. */
.duplicado .comercial-duplicado { flex: 1 1 0; }
.duplicado .comercial-duplicado .comercial { height: 100%; }
.duplicado .tabla.comercial { flex: none; }
.duplicado .control-titulo, .duplicado .numero-titulo { font-size: 10pt; padding: 1px; }
.duplicado .control-linea { line-height: 1.25; }
.duplicado .numero { font-size: 13pt; padding: 2px 0 3px; }
.duplicado .comprobantes { line-height: 1.6; padding: 3px 4px; }
.duplicado .logo { max-height: 18mm; }
.duplicado .texto-libre { height: 10mm; }
.duplicado .texto-libre.alto-2 { height: 8mm; }
.duplicado .bloque-titulo { padding: 1px; font-size: 9pt; }
.duplicado .tabla th { font-size: 7.5pt; }
/* Igual que en el original: es el piso. El reparto de la hoja las estira
   hasta llenarla. */
.duplicado .tabla td { height: 4.2mm; font-size: 8pt; }
.duplicado .deposito { margin-top: 1.5mm; }
.duplicado .caja td { height: 4.2mm; font-size: 7.5pt; }
.duplicado .caja .alto { height: 10mm; }
.duplicado .talon { margin-top: 2.5mm; padding-top: 2mm; }

@page { size: A4 portrait; margin: 8mm; }

@media print {
  .nota { margin: 0 auto; }
  .control-titulo, .numero-titulo, .bloque-titulo, .tabla th {
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
}
`

/**
 * Pasa una nota tal como sale de la base al formato del talonario.
 *
 * Vive acá y no en el servicio de impresión de la app porque el panel de
 * escritorio y el probador imprimen las mismas notas: si cada uno arma su
 * propio mapeo, la columna de doble uso se interpreta distinto en cada lado y
 * nadie se entera hasta que sale mal en papel.
 */
export function notaImprimibleDesdeFila(nota: Record<string, any>): NotaParaImprimir {
  const items: Array<Record<string, any>> = nota.items ?? []
  const d = (i: Record<string, any>, k: string) => String(i.detalle?.[k] ?? '')
  const monto = (v: number | null) =>
    v === null || v === undefined
      ? ''
      : Number(v).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  /**
   * La fila guardada, traducida a lo que la cuenta necesita.
   *
   * Es el mismo cálculo que hace el formulario —viene de `lineasDeComputo`—
   * para que lo que se imprime no pueda diferir de lo que el vendedor vio.
   */
  const computoDeFila = (i: Record<string, any>): DatosComputo => ({
    concepto: i.servicio === 'venta' ? 'venta' : i.servicio === 'reparacion' ? 'reparacion' : 'afilado',
    cantidad: Math.max(1, Number(i.cantidad) || 1),
    // En una VENTA los dientes son una característica de la herramienta que se
    // vende, no algo que se cobre por unidad: lo que se computa son las
    // unidades. Sin esta condición, vender 3 sierras de 72 dientes computaba
    // 216 y multiplicaba el precio unitario por eso.
    dientesPorHerramienta: i.servicio === 'venta' ? 0 : Number(i.cantidad_dientes) || 0,
    precioUnitario: Number(i.precio_unitario) || 0,
    // Media lista de precios está en dólares y el renglón se cotiza así.
    moneda: (i.moneda === 'USD' ? 'USD' : 'ARS') as Moneda,
    // En la venta no hay código de cómputo: lo que se computa es el código del
    // artículo. `?? []` no alcanzaba porque la columna guarda un array vacío,
    // no null, y la nota salía sin código en la columna de cómputo.
    codigos: i.codigos_computo?.length
      ? i.codigos_computo
      : i.codigo_herramienta
        ? [i.codigo_herramienta]
        : [],
    dientesRotos: i.dientes_rotos ? Number(i.detalle?.dientes_rotos_cantidad) || 0 : 0,
    repararDientes: i.detalle?.reparar_dientes === true,
    codigoReparacion: d(i, 'codigo_reparacion'),
    precioReparacionPorDiente: Number(i.detalle?.precio_reparacion_unitario) || 0,
    // En venta el unitario ya está guardado, así que no hay total directo que
    // usar: si lo hubiera, tres unidades se imprimirían como una.
    precioTotalDirecto: i.servicio === 'venta' ? 0 : Number(i.precio_total) || 0,
    // Lo que no se cobra. Va en el detalle porque es una marca del renglón, no
    // un precio: el importe simbólico no se multiplica por nada.
    sinCargo: i.detalle?.sin_cargo === true,
    reparacionSinCargo: i.detalle?.reparacion_sin_cargo === true,
  })

  /**
   * Las líneas de cómputo, calculadas UNA vez.
   *
   * De acá salen las tres cosas que tienen que coincidir sí o sí: las filas de
   * la tabla comercial, el total impreso y la cantidad de renglones. Calculadas
   * por separado, tarde o temprano una queda atrás y la nota no cierra.
   */
  const lineas = consolidarLineasDeComputo(
    items.flatMap((i) => lineasDeComputo(computoDeFila(i))),
  )

  /**
   * El total, separado por moneda.
   *
   * No se convierte a una sola: media lista de precios está en dólares y el
   * tipo de cambio ya va impreso en su casilla. Sumar las dos monedas daría un
   * número que no es plata de ninguna.
   */
  const porMoneda = new Map<Moneda, number>()
  for (const l of lineas) {
    porMoneda.set(l.moneda, (porMoneda.get(l.moneda) ?? 0) + l.total)
  }
  const totales = Array.from(porMoneda.entries())
    .filter(([, valor]) => valor > 0)
    // Los pesos primero: es la moneda en la que se cobra.
    .sort(([a], [b]) => (a === b ? 0 : a === 'ARS' ? -1 : 1))
    .map(([moneda, valor]) => formatearMoneda(Math.round(valor * 100) / 100, moneda))
    .join('  ·  ')

  return {
    totales,
    numero: nota.numero ? String(nota.numero).padStart(6, '0') : null,
    tipo_nota: nota.tipo_nota,
    servicios: nota.servicios ?? [],
    // Sin los ceros de relleno del Gestión: "007" se escribe 7 en el talonario.
    vendedor_numero: numeroDeVendedorImpreso(
      nota.vendedor_numero ?? nota.vendedor?.codigo_vendedor,
      VENDEDORES_CON_CERO,
    ),
    cliente_numero: nota.cliente_codigo,
    zona: nota.zona ?? '',
    datos_cliente: nota.datos_cliente ?? '',
    descripcion_herramientas: nota.descripcion_herramienta ?? '',
    tecnicos: items.map((i) => {
      // Las casillas de operación llevan la CANTIDAD de dientes, no un tilde:
      // es el mismo número que se computa del otro lado de la hoja, y así el
      // taller no tiene que cruzar las dos tablas para saber cuántos son.
      const lineas = lineasDeComputo(computoDeFila(i))
      const dientesDe = (concepto: 'afilado' | 'reparacion') =>
        lineas.find((l) => l.concepto === concepto)?.cantidad ?? 0

      const trabajo = (aplica: boolean, concepto: 'afilado' | 'reparacion'): CasillaOperacion => {
        if (!aplica) return false
        const n = dientesDe(concepto)
        // Sin dientes —una mecha, una cuchilla— la casilla vuelve a ser un tilde.
        return n > 0 && i.cantidad_dientes ? n : true
      }

      return {
        descripcion: i.descripcion ?? i.codigo_herramienta ?? '',
        afilado: trabajo(i.servicio === 'afilado', 'afilado'),
        rectificado: trabajo(i.servicio === 'rectificado', 'afilado'),
        // También cuando se reparan los dientes rotos de una herramienta que
        // vino a afilar: sobre esa pieza se hacen las dos operaciones, y la
        // casilla de reparación lleva sólo los dientes rotos.
        reparacion: trabajo(
          i.servicio === 'reparacion' || i.detalle?.reparar_dientes === true,
          i.servicio === 'reparacion' ? 'afilado' : 'reparacion',
        ),
        tensado: false,
        rellenado: false,
        otro: ['hermanado', 'rebaje', 'reclamo', 'venta'].includes(i.servicio) ? i.servicio : '',
        cantidad: i.cantidad,
        // "ØExt.-Largo" y "ØInt.-Ancho" son columnas de doble uso: una sierra
        // trae diámetros y una cuchilla trae largo y ancho.
        diametro_exterior: d(i, 'diametro_exterior') || d(i, 'diametro') || d(i, 'largo'),
        // El agujero manda sobre las otras dos lecturas de esta columna: si se
        // cargó (o vino del catálogo), es el dato que la fábrica necesita.
        diametro_interior:
          d(i, 'diametro_interior') || d(i, 'ancho') || d(i, 'largo_util'),
        ancho_corte: d(i, 'ancho_corte') || d(i, 'espesor'),
        z_paso: i.cantidad_dientes ? String(i.cantidad_dientes) : d(i, 'paso'),
      }
    }),
    // Un renglón puede dar más de una línea: cuando hay dientes rotos que se
    // reparan, la reparación se computa aparte y con su propio código.
    //
    // Lo que se computa son los dientes TOTALES menos los rotos: los Z de la
    // columna técnica son por herramienta, y dos sierras de 96 son 192 dientes.
    //
    // Y a la inversa: varios renglones pueden dar UNA sola línea. Esta tabla se
    // lee por código de cómputo, no por herramienta, así que dos sierras
    // distintas que caen en el mismo código se suman en una fila. Las medidas
    // que las diferencian están arriba, en la tabla técnica.
    comerciales: conObservaciones(
      lineas.map((l) => ({
        codigo_computo: l.codigo,
        cantidad: l.cantidad,
        // Los dólares van con su símbolo. Un número sin moneda al lado de
        // otro en pesos es la forma más rápida de cobrar mal.
        //
        // En un renglón sin cargo la casilla del unitario va vacía: el importe
        // no sale de multiplicar, y poner "$ 0,00" al lado de 192 dientes
        // invita a rehacer una cuenta que no existe.
        precio_unitario: l.sinCargo
          ? ''
          : l.precioUnitario
            ? formatearMoneda(l.precioUnitario, l.moneda)
            : '',
        precio: l.total ? formatearMoneda(l.total, l.moneda) : '',
        // La condición de venta es de la nota entera y va una sola vez, en
        // la primera fila. La reparación de dientes rotos se aclara en su
        // propia fila, que es donde está su código, y lo que no se cobra se
        // dice con todas las letras.
        condicion_venta: l.sinCargo
          ? 'SIN CARGO'
          : l.concepto === 'reparacion'
            ? 'Reparación dientes'
            : '',
        anticipo: '',
        observaciones: '',
      })),
      nota.observaciones ?? [],
    ),
    // Vacío en las notas de afilado: se cobra en pesos y una cotización ahí
    // sólo hace dudar de en qué moneda está el total.
    tipo_cambio: nota.tipo_cambio ? monto(Number(nota.tipo_cambio)) : '',
    condicion_venta: describirCondicionVenta(
      nota.condicion_venta ?? null,
      nota.condicion_venta_detalle,
    ),
    emision: new Date(nota.creado_en).toLocaleDateString('es-AR'),
    // `fecha_entrega` es un `date` de Postgres: al mediodía, para que el huso
    // no la corra un día para atrás al pasarla por Date.
    fecha_entrega: nota.fecha_entrega
      ? new Date(`${nota.fecha_entrega}T12:00:00`).toLocaleDateString('es-AR')
      : undefined,
  }
}

/**
 * Documento completo listo para imprimir. Acepta varias notas de corrido, que
 * es lo que necesita "IMPRIMIR NOTAS DE PEDIDO PENDIENTES": todas juntas en un
 * solo trabajo de impresión.
 *
 * Opcionalmente lleva adelante el **rol de visita del día**. Va primero porque
 * es la hoja de la jornada: las notas son lo que pasó dentro de ella.
 */
/**
 * Devuelve la hoja de estilos con los tamaños de letra divididos por `escala`.
 *
 * ─── Por qué hace falta ──────────────────────────────────────────────────────
 *
 * La nota se arma como HTML y el celular la convierte a PDF con un WebView.
 * Android le aplica a ese WebView el ajuste de letra del sistema —el que el
 * vendedor mueve en Pantalla → Tamaño de la letra— porque es una función de
 * accesibilidad y está prendida por defecto. `expo-print` no la apaga: al
 * WebView sólo le configura la codificación de caracteres.
 *
 * El resultado es el peor de los mundos: las LETRAS crecen un 15 o un 30 %,
 * pero las cajas declaradas en milímetros —el alto de la hoja, el de las filas,
 * el de los recuadros— no se mueven. La nota se desborda o queda apretada
 * según qué teléfono la imprima, y los ${ALTO_HOJA_MM} mm medidos dejan de
 * valer. Dos vendedores con el mismo pedido sacaban hojas distintas.
 *
 * Como no se puede apagar el zoom desde el CSS, se compensa: si el sistema va a
 * multiplicar por 1,3, acá se divide por 1,3 y el papel sale igual que siempre.
 * `line-height` es sin unidad a propósito, así acompaña sola.
 *
 * Con escala 1 —o sin dato— devuelve el CSS intacto: quien no tenga el problema
 * no paga nada, ni siquiera un redondeo.
 */
function conLetraCompensada(css: string, escala: number | undefined): string {
  if (!escala || !Number.isFinite(escala) || escala <= 0 || escala === 1) return css
  return css.replace(
    /font-size:\s*([\d.]+)pt/g,
    (_todo, valor: string) => `font-size: ${Math.round((Number(valor) / escala) * 1000) / 1000}pt`,
  )
}

export function generarDocumentoImpresion(
  notas: Array<{ nota: NotaParaImprimir; opciones: OpcionesImpresion }>,
  extras?: {
    rolDeVisita?: RolDeVisitaParaImprimir
    /**
     * Cuánto agranda la letra el sistema donde se va a generar el PDF.
     *
     * En el celular es `PixelRatio.getFontScale()`. En la PC no se pasa: el
     * navegador de escritorio no le aplica al documento el tamaño de letra del
     * sistema operativo, así que ahí ya sale bien.
     */
    escalaDeLetra?: number
  },
): string {
  const paginas = notas.map(({ nota, opciones }) => generarHtmlNotaPedido(nota, opciones))
  if (extras?.rolDeVisita) paginas.unshift(generarHtmlRolDeVisita(extras.rolDeVisita))

  const titulo = extras?.rolDeVisita
    ? 'Rol de visita y notas de pedido · WoodTools'
    : 'Notas de pedido · WoodTools'

  return `<!doctype html>
<html lang="es-AR">
<head>
<meta charset="utf-8">
<title>${titulo}</title>
<style>${conLetraCompensada(ESTILOS_NOTA_PEDIDO + '\n' + ESTILOS_ROL_DE_VISITA, extras?.escalaDeLetra)}</style>
</head>
<body>${paginas.join('\n')}</body>
</html>`
}
