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
  esRenglonDeArticulo,
  lineasDeComputo,
  MAXIMO_RENGLONES,
  numeroDeNotaImpreso,
  numeroDeVendedorImpreso,
  OBSERVACION_HERMANAS,
  VENDEDORES_CON_CERO,
  type DatosComputo,
} from './notas-pedido'
import {
  ESTILOS_PLANILLA_COBRANZAS,
  generarHtmlPlanillaCobranzas,
  type PlanillaCobranzasParaImprimir,
} from './planilla-cobranzas-impresion'
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
  /**
   * El descuento de la fila, ya escrito: "10 %". Vacío si no lleva.
   *
   * Ocupa el lugar donde antes iba el importe de la fila. El importe de cada
   * línea dejó de imprimirse: la hoja muestra el precio de lista, cuánto se
   * rebaja, y el total abajo. Los tres números alcanzan para rehacer la cuenta
   * y entran en el ancho que hay.
   */
  descuento: string
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
  /**
   * El nombre solo, sin la ficha entera.
   *
   * Es lo único del cliente que lleva el duplicado. Puede venir vacío —cuando
   * los datos se tipearon a mano en vez de salir del padrón— y ahí el duplicado
   * cae a la ficha completa: es fea, pero decir de quién es la herramienta
   * importa más que la prolijidad.
   */
  cliente_nombre: string | null
  zona: string

  datos_cliente: string
  descripcion_herramientas: string

  tecnicos: RenglonTecnico[]
  comerciales: RenglonComercial[]

  /**
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
  /**
   * Qué día de la semana cae la entrega: "Martes".
   *
   * Va en su propio renglón, debajo de la fecha. Nadie mira un 15/09 y sabe
   * qué día es: el cliente pregunta "¿el martes?" y el vendedor tiene que
   * abrir el calendario del teléfono para contestarle. Impreso al lado de la
   * fecha, la nota se contesta sola.
   */
  fecha_entrega_dia?: string
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
const ALTO_DATOS_CLIENTE_MM = 21
/**
 * Lo mismo, pero cuando el pie lleva subtotal Y total con IVA.
 *
 * Ese desglose agrega un renglón abajo de todo, y en esta hoja no hay lugar de
 * sobra: las dos tablas tienen `flex-basis: 0` y no devuelven nada, así que un
 * milímetro de más empuja la nota a una segunda hoja. Los cuatro milímetros
 * salen de acá porque es el recuadro que mejor los banca: son cinco líneas de
 * ficha del padrón y con cuatro se sigue sabiendo quién es el cliente y dónde
 * está. Sacárselos a la descripción, en cambio, taparía lo que hay que hacer.
 */
/**
 * El recuadro de la descripción general: cuatro renglones, 16 mm.
 *
 * ─── Por qué el alto es de verdad ────────────────────────────────────────────
 *
 * Antes esta caja valía 13 y crecer no servía de nada: las dos tablas tienen
 * `flex-basis: 0`, no devuelven nada, y el reparto negativo caía entero sobre
 * los recuadros de texto, que se encogían hasta el contenido. Declarar 18 daba
 * lo mismo que 13.
 *
 * Ahora el alto se respeta porque el recuadro dejó de encogerse: lleva
 * `flex-shrink: 0` (ver `.texto-libre`). Con eso 16 mm son 16 mm, y hacen falta:
 * a 9,5 pt entran los cuatro renglones que hoy conviven acá —la línea que arma
 * la app ("AFILADO DE SIERRAS Y FRESAS"), lo que agrega el vendedor y hasta dos
 * avisos de agujero—. Con la caja encogible de antes, y la letra más grande de
 * este cambio, la descripción se aplastaba a un renglón y el resto se recortaba
 * sin que nadie se enterara.
 *
 * OJO: bajar este número NO libera espacio para otra cosa —la hoja entra medida,
 * ver ALTO_HOJA_MM— sólo recorta renglones de la descripción.
 */
const ALTO_DESCRIPCION_MM = 16

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

/**
 * El reparto de columnas de las tablas, en porcentaje del ancho de la hoja.
 *
 * ─── Por qué las columnas se declaran y no se dejan al navegador ─────────────
 *
 * Antes el ancho lo repartía solo el algoritmo automático de tablas, que mira
 * el contenido. Y el contenido lo decidían los ENCABEZADOS: "ØExt.-Largo",
 * "ØInt.-Ancho", "Ancho Corte / Espesor" son títulos largos y se llevaban 23 mm
 * cada uno para mostrar números de dos o tres cifras. A la descripción de la
 * herramienta —el único texto libre de la fila, y el más largo— le quedaban
 * 26,6 mm.
 *
 * En esos 26,6 mm un "SIERRA CIRCULAR WIDIA 300x30" envuelve a TRES renglones,
 * y la fila pasa de 5,5 mm a 10,6. Con doce renglones cargados eso son 60 mm de
 * más, y la nota terminaba pidiendo 331 mm dentro de la caja de `.nota`, que
 * mide `ALTO_HOJA_MM`.
 *
 * Lo que hacía que no se notara —y que fuera tan difícil de encontrar— es que
 * `.nota` tiene `overflow: hidden`: esos 66 mm no daban error, no pasaban a una
 * segunda hoja y no aparecían en ningún lado. Se recortaban en silencio. Lo que
 * caía afuera era el final: el TOTAL, las firmas y la palabra ORIGINAL o
 * DUPLICADO del pie. De ahí que la nota "saliera cortada" sin importar el
 * tamaño de papel ni la impresora.
 *
 * Con `table-layout: fixed` (ver los estilos) el ancho sale de acá y no del
 * contenido, así que la fila mide siempre lo mismo y la hoja no puede
 * desbordar. Los porcentajes son sobre los 190 mm de `.nota`.
 */
const COLUMNAS_TECNICAS = [
  29.5, // Descripción — el texto libre, y por eso la más ancha; recorta con ellipsis
  5.5, // Afil.
  5.5, // Rect.
  5.5, // Rep.
  5.5, // Tens.
  5.5, // Rell
  7, // Otro — un servicio ("reclamo", "hermanado"): "hermanado" no entra ni entró nunca
  6, // Cantidad — la manda su encabezado, que ya se derrama (preexistente)
  7.5, // ØExt.-Largo
  7.5, // ØInt.-Ancho
  7.5, // Ancho Corte / Espesor
  7.5, // Z-Paso — "120+4" (dientes+rascadores) a 10 pt pide 51 px; 7,5 % = 54
]

/**
 * Los siete anchos, medidos contra la fuente MÁS ANCHA que puede tocar.
 *
 * Las celdas son `nowrap` con `text-overflow: ellipsis`: lo que no entra NO
 * baja de renglón, se corta. Cada ancho sale de medir el texto más largo que
 * esa columna puede tener, sobre la tabla real de 718 px.
 *
 * ── Por qué se mide en Verdana y no en Arial ────────────────────────────────
 *
 * El CSS pide `Arial, Helvetica, sans-serif`, pero **Android no tiene Arial**:
 * cae a Roboto, que es más ancha. La misma cuenta medía 82 px en Arial y 99 en
 * Verdana. Medir en Arial —que es lo que tiene la PC donde uno prueba— da
 * números optimistas y el papel sale cortado en el teléfono aunque en pantalla
 * se vea perfecto. Verdana es el techo: lo que entra ahí entra en cualquier sans.
 *
 * ── También se mide el ENCABEZADO ───────────────────────────────────────────
 *
 * Y esto no estaba. Los `th` no llevan el recorte que sí tienen los `td`, así
 * que un encabezado que no entra no se corta: se DERRAMA sobre la columna de al
 * lado y las letras se montan. "Descuento" pedía 60 px sobre una columna de 35
 * y se leía "DescuentoCon…" pisando a "Condicion de Venta". Ahora cada columna
 * entra su palabra más larga, y además se les puso el mismo recorte que a las
 * celdas para que no pueda volver a pasar.
 *
 * Medido en Verdana con los 6 px de padding, sobre la tabla de 718 px. La
 * celda va a 9 pt (ver `.comercial td`), salvo el código de cómputo, que va a
 * 10 pt negrita (ver `.computo`):
 *
 *                   celda                        encabezado
 *   Código          8 car. a 10 pt negrita   89  "Cómputo"   51  → 13 % = 93 px
 *   Cantidad        "1.240"                  35  "Cantidad"  57  →  8 % = 57 px
 *   Unitario        "$ 2.971.600,00"        100  "unitario"  85  → 15 % = 108 px
 *   Dto.            "65 %"                   39  "Dto."      27  →  6 % = 43 px
 *   Condición       "Cta. cte. 15-60 días"  138  "Condicion" 62  → 20 % = 144 px
 *   Anticipo        vacía                    —   "Anticipo"  52  →  7 % = 50 px
 *   Observaciones   "NP 02-0082, 02-0083…"  217  "Observ…"   90  → 31 % = 223 px
 *
 * La celda va a 9 pt y no a los 10 del resto: la condición con su plazo, el
 * precio de siete cifras y hasta tres notas hermanas, medidos en Verdana, no
 * entran todos a 10 pt —la tabla pediría 113 % de su ancho— y sí a 9. Sigue
 * siendo más grande que los 8,5 pt de antes.
 *
 * Observaciones se dimensiona contra "NP 02-0082, 02-0083, 02-0084" —las tres
 * notas hermanas, que son texto del sistema y no se pueden perder— y no contra
 * el texto libre del vendedor: ése recorta con puntos suspensivos si se pasa,
 * que es el trato de siempre para esa columna (ver más abajo). "Anticipo" en su
 * encabezado pide 52 px sobre 50 y pierde el último píxel en Verdana; es una
 * columna vacía y el dato no está ahí, así que se acepta.
 *
 * El encabezado del descuento dice "Dto." y no "Descuento": la palabra entera
 * pedía 60 px —más que el "65 %" que va debajo— y se llevaba 4 % que le hacen
 * más falta a las observaciones, que es texto de verdad. "Dto." es corriente en
 * una factura y no se confunde con nada; "Desc." sí, porque la tabla técnica de
 * arriba tiene una columna "Descripción".
 *
 * ── Sobre cuánto margen dejar ───────────────────────────────────────────────
 *
 * Verdana resultó ser un techo exagerado: mide 14 % más que Arial para la misma
 * frase. La evidencia de la nota 000060 impresa acota mejor el error real: esa
 * cuenta media 82 px en Arial y se cortó contra una casilla de 85, así que la
 * letra del teléfono es del orden de un 4 % más ancha que Arial, no un 14 %.
 *
 * Por eso las columnas se dimensionan contra Verdana donde eso sale gratis, y
 * donde cuesta ancho útil —observaciones— se acepta que en Verdana se recorte
 * algún carácter. En la letra que el teléfono usa de verdad, entra.
 */
const COLUMNAS_COMERCIALES = [
  13, // Código de Cómputo — a 10 pt negrita (ver .computo); los que no entran se achican por ancho, ver `celdaCodigo`
  8, // Cantidad — la manda su encabezado
  15, // Precio unitario — "$ 2.971.600,00", el artículo más caro del catálogo
  6, // Dto. — "65 %", todo descuento de dos cifras con su signo
  20, // Condición de Venta — "Cta. cte. 15-60 días" en negrita, el plazo más largo
  7, // Anticipo — se imprime vacía; la manda su encabezado
  31, // Observaciones — hasta tres notas hermanas; el texto libre puede recortar
]

/** El duplicado sólo lleva dos columnas, sobre los 62 mm de su tabla angosta. */
const COLUMNAS_COMERCIALES_DUPLICADO = [62, 38]

/**
 * El código de cómputo, dibujado lo más grande que entre en su columna.
 *
 * El catálogo tiene códigos de hasta 16 caracteres —`CLGNMFS3940MCAJA`, y 94
 * artículos pasan de once— que a cuerpo pleno no entran en los 93 px de la
 * columna (13 %). La celda no envuelve: recorta. Y un código recortado en una
 * nota de pedido es un renglón que la fábrica no puede identificar.
 *
 * Antes se decidía por LARGO: hasta 8 caracteres a 10 pt, de 9 en adelante a 6.
 * Pero el largo miente. `CHCRPERM` son 8 mayúsculas anchas y mide 89 px;
 * `LG3D 0600` son 9 —con un espacio y dígitos, angostos— y mide 68. El umbral
 * por largo mandaba a 6 pt códigos de venta de 9–11 caracteres que entraban a
 * cuerpo pleno, y salían impresos diminutos sin necesidad (fue un pedido de la
 * casa corregirlo).
 *
 * Ahora se mide el ANCHO real del código —sumando el ancho de cada carácter en
 * Arial— y se elige el cuerpo más grande que entra: 10 pt negrita si da (el
 * cuerpo pedido, igual que las casillas de operación), y si no, cuerpo normal
 * —más angosto que la negrita— achicado de a 0,5 pt hasta que entre, con piso
 * 6 pt. Así `LG3D 0600` y `LU3F 0300` van a 10 pt, `LI25M 31FA3` a 10 pt normal,
 * y sólo los verdaderamente largos como `CLGNMFS3940MCAJA` bajan a 6.
 */

/**
 * El ancho de cada carácter en Arial, en milésimas de em (las métricas AFM
 * estándar de Arial/Helvetica). Los códigos son mayúsculas, dígitos y espacios;
 * lo que no esté en la tabla se toma ancho —700— para pecar de recortar de
 * menos, nunca de más.
 */
const ANCHO_ARIAL: Record<string, number> = {
  ' ': 278, '-': 333, '.': 278, '/': 278,
  '0': 556, '1': 556, '2': 556, '3': 556, '4': 556,
  '5': 556, '6': 556, '7': 556, '8': 556, '9': 556,
  A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278,
  J: 500, K: 667, L: 556, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722,
  S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
}

/** El ancho del código en em (unidades del tamaño de letra), sumando la tabla. */
function anchoDeCodigoEm(codigo: string): number {
  let mil = 0
  for (const ch of codigo.toUpperCase()) mil += ANCHO_ARIAL[ch] ?? 700
  return mil / 1000
}

/**
 * Calibración anclada a las dos medidas del autor original: `CHCRPERM`
 * (5,777 em) entra a 10 pt NEGRITA en la columna de 93 px, y `CLGNMFS3940MCAJA`
 * (10,502 em) entra justo a 6 pt en cuerpo normal. De ahí salen los px por
 * (em × pt) de cada peso —la negrita mide ~4 % más que la normal—. El piso de
 * 6 pt son 8 px, el mínimo que dibuja el WebView de Android.
 *
 * Dos márgenes. El de la NEGRITA es 0,97, apenas por encima del 95,7 % de
 * columna que usa `CHCRPERM` —el autor lo validó impreso, así que ése tiene que
 * pasar—. El del cuerpo NORMAL, para los que se achican, es más holgado (0,90):
 * la letra del teléfono es ~4 % más ancha que la Arial contra la que se mide, y
 * un código de venta un punto más chico se sigue leyendo, pero recortado no.
 */
const COLUMNA_CODIGO_PX = 93
const MARGEN_NEGRITA = 0.97
const MARGEN_NORMAL = 0.9
const PX_POR_EM_PT_NEGRITA = 1.54
const PX_POR_EM_PT_NORMAL = 1.476
const CUERPO_CODIGO_PLENO = 10
const CUERPO_CODIGO_PISO = 6

function celdaCodigo(codigo: string): string {
  const texto = escapar(codigo)
  const em = anchoDeCodigoEm(codigo)

  // ¿Entra a 10 pt negrita, el cuerpo pedido? Casi todos: los de cómputo de un
  // servicio son de cuatro dígitos ("6005") y muchos de artículo son cortos.
  // Ésos se dibujan igual que siempre, sin span.
  if (em * CUERPO_CODIGO_PLENO * PX_POR_EM_PT_NEGRITA <= COLUMNA_CODIGO_PX * MARGEN_NEGRITA) {
    return texto
  }

  // No entra en negrita: se pasa a cuerpo normal —más angosto— y se toma el
  // cuerpo más grande, en pasos de 0,5 pt, que entre con margen. `.codigo-largo`
  // da el peso normal; el font-size lo pone acá inline.
  const maxCuerpo = (COLUMNA_CODIGO_PX * MARGEN_NORMAL) / (em * PX_POR_EM_PT_NORMAL)
  const cuerpo = Math.max(
    CUERPO_CODIGO_PISO,
    Math.min(CUERPO_CODIGO_PLENO, Math.floor(maxCuerpo * 2) / 2),
  )
  return `<span class="codigo-largo" style="font-size: ${cuerpo}pt">${texto}</span>`
}

/**
 * Los días de la semana, escritos acá y no sacados de `Intl`.
 *
 * `toLocaleDateString('es-AR', { weekday: 'long' })` da lo mismo en esta PC,
 * pero el nombre del día lo resuelve el ICU del aparato que arma el PDF: en un
 * Android viejo, o con el idioma del sistema en otra cosa, la misma nota podría
 * imprimir "Tuesday". Son siete palabras y no cambian nunca; escritas acá, la
 * hoja dice lo mismo salga del teléfono del vendedor o del panel de la oficina.
 */
const DIAS_DE_LA_SEMANA = [
  'Domingo',
  'Lunes',
  'Martes',
  'Miércoles',
  'Jueves',
  'Viernes',
  'Sábado',
]

/**
 * Separa el nombre del cliente del resto de su ficha.
 *
 * El nombre se imprime grande arriba de todo —es lo primero que se busca al
 * recibir la herramienta— y la ficha va abajo, en cuerpo chico. Pero los dos
 * salen del mismo lugar: cuando el cliente se elige del padrón, `datos_cliente`
 * se arma como "RAZÓN SOCIAL — dirección — CP — teléfono…" y `cliente_nombre`
 * es esa misma razón social. Impresos los dos enteros, el nombre salía dos
 * veces.
 *
 * Se saca el prefijo sólo cuando la ficha ARRANCA con el nombre tal cual. Lo
 * que el vendedor escribió a mano, o dictó, no se toca: puede empezar con
 * cualquier cosa y perderle una palabra es peor que repetir el nombre.
 */
function partirFichaDelCliente(
  nombre: string | null | undefined,
  ficha: string,
): { nombre: string; resto: string } {
  const n = String(nombre ?? '').trim()
  const f = String(ficha ?? '').trim()
  if (!n) return { nombre: '', resto: f }
  if (!f.toLowerCase().startsWith(n.toLowerCase())) return { nombre: n, resto: f }
  // El separador que viene atrás del nombre —el " — " del padrón o el salto de
  // línea de lo dictado— se va con él.
  return { nombre: n, resto: f.slice(n.length).replace(/^[\s—–-]+/, '') }
}

/**
 * La observación de las notas hermanas, con el número resaltado.
 *
 * "Va con nota de pedido 02-0082, 02-0083" lo escribe el servidor cuando una
 * carga se reparte en varios comprobantes, y lo único que se usa de esa frase
 * son los números: es con ellos que en la oficina se juntan las hojas del mismo
 * cliente. El resto es la explicación.
 *
 * Las demás observaciones son del vendedor y salen tal cual.
 */
function celdaObservacion(texto: string): string {
  const t = String(texto ?? '')
  if (!t.trimStart().startsWith(OBSERVACION_HERMANAS)) return escapar(t)
  const corte = t.indexOf(OBSERVACION_HERMANAS) + OBSERVACION_HERMANAS.length
  // "NP " y no "Va con NP ": con el prefijo entero, tres notas hermanas piden
  // 262 px sobre los 230 de la casilla en Verdana y se pierde el tercer número,
  // que es lo único que la casilla existe para mostrar. "NP" es la abreviatura
  // de esta misma hoja —la caja de fechas dice "Emision NP:"— así que no hay
  // que explicarla en la oficina.
  return `NP <strong class="hermanas">${escapar(t.slice(corte))}</strong>`
}

const colgroup = (anchos: number[]): string =>
  `<colgroup>${anchos.map((a) => `<col style="width:${a}%">`).join('')}</colgroup>`

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
  descuento: '',
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

  const ficha = partirFichaDelCliente(nota.cliente_nombre, nota.datos_cliente)
  /**
   * El duplicado lleva sólo el nombre y tira el resto de la ficha (ver el
   * comentario del bloque). Pero si no hay nombre —datos tipeados a mano— la
   * ficha entera es lo único que dice de quién es la herramienta, y ahí va:
   * fea, pero identifica la pieza.
   */
  const fichaResto = esDuplicado && ficha.nombre ? '' : ficha.resto

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
          <td class="computo">${celdaCodigo(c.codigo_computo)}</td>
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
        <td class="computo">${celdaCodigo(c.codigo_computo)}</td>
        <td class="num">${escapar(c.cantidad)}</td>
        <td class="num">${escapar(c.precio_unitario)}</td>
        <td class="num">${escapar(c.descuento)}</td>
        <td>${condicion}</td>
        <td class="num">${escapar(c.anticipo)}</td>
        <td>${celdaObservacion(c.observaciones)}</td>
      </tr>`
    })
    .join('')

  // "Precio unitario" y "Precio total" van apilados en dos renglones: puestos
  // de corrido se comían el ancho de las columnas de al lado. El código de
  // cómputo cede el espacio, que es el que le sobraba.
  const comercialesCabecera = esDuplicado
    ? `<tr><th>Código de Cómputo</th><th>Cantidad</th></tr>`
    : `<tr>
        <th>Código de Cómputo</th>
        <th>Cantidad</th>
        <th>Precio<br>unitario</th>
        <th>Dto.</th>
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
          ${colgroup(COLUMNAS_COMERCIALES_DUPLICADO)}
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
        ${colgroup(COLUMNAS_COMERCIALES)}
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
  /**
   * Un solo número abajo de todo, y se llama SUBTOTAL.
   *
   * La nota dejó de hablar de IVA. Antes decía tres cosas distintas según la
   * condición del cliente —el consumidor final lo llevaba sumado adentro sin
   * decirlo, el exento no, y el responsable inscripto veía el neto y el total
   * uno debajo del otro—, y eso obligaba a que el papel supiera de impuestos
   * para poder imprimir un número.
   *
   * Ahora imprime lo que se cobra por el trabajo y nada más. El impuesto es
   * cosa de la factura, que sale de otro sistema.
   *
   * Dice SUBTOTAL y no TOTAL porque eso es lo que es: la suma de los renglones
   * ya con su descuento, antes de cualquier cosa que se le agregue después.
   */
  const cuerpoTotal = `<span>SUBTOTAL: <strong>${escapar(nota.totales)}</strong></span>`

  const totalVisible = !esDuplicado && !!nota.totales
  const resumen = totalVisible ? `<div class="resumen">
    ${cuerpoTotal}
  </div>` : ''

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
        <!--
          El día sólo aparece si hay fecha. Sin ella no hay nada que decir, y un
          renglón "Día de entrega: ___" en una caja que ya tiene cinco es un
          renglón que empuja al resto de la hoja para no informar nada.
        -->${
          nota.fecha_entrega_dia
            ? `
        <div class="control-linea"><span>Día de entrega:</span><span class="dia-entrega">${escapar(
          nota.fecha_entrega_dia,
        )}</span></div>`
            : ''
        }
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
    <!--
      El duplicado lleva sólo el nombre.

      Es la copia que se queda en el taller, con la herramienta: lo que hace
      falta ahí es saber de quién es la pieza, no cómo llegarle. La direccion,
      el teléfono y el mail son para el original, que es el que va al cliente y
      a administración. Y de paso libera renglones en la copia más apretada.
    -->
    <div class="texto-libre">${
      ficha.nombre ? `<div class="cliente-nombre">${escapar(ficha.nombre)}</div>` : ''
    }${fichaResto ? `<div class="cliente-ficha">${escapar(fichaResto)}</div>` : ''}</div>
  </div>

  <div class="bloque-titulo">DESCRIPCION GENERAL DE LAS HERRAMIENTAS</div>
  <div class="texto-libre alto-2">${escapar(nota.descripcion_herramientas)}</div>

  <div class="bloque-titulo">CARACTERISTICAS TECNICAS</div>
  <table class="tabla tecnica">
    ${colgroup(COLUMNAS_TECNICAS)}
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
        <th>Descripción</th>
        <th>Afil.</th>
        <th>Rect.</th>
        <th>Rep.</th>
        <th>Tens.</th>
        <th>Rell</th>
        <th>Otro</th>
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
  font-size: 11.5pt;
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
.firmas { margin-top: auto; padding-top: 2mm; }

.nota table { border-collapse: collapse; width: 100%; }
.nota td, .nota th { border: 1px solid #000; padding: 1.5px 3px; }

.encabezado td { vertical-align: top; }
.celda-logo { width: 32%; text-align: center; vertical-align: middle; }
.logo { max-width: 90%; max-height: 24mm; }

.control { width: 40%; }
/* Cuerpo propio, más chico que el de la hoja: esta caja tiene cinco renglones
   —seis cuando hay día de entrega— y tres los completa la fábrica a mano
   (Emisión Plano, Recibido, Finalizado), así que lo que se lee es el rótulo, no
   el dato. Con el cuerpo de la nota se llevaba varios milímetros de más, y
   salían de los renglones donde se escribe. */
.control { font-size: 10pt; }
.control-titulo { font-weight: bold; font-size: 13pt; text-align: center; background: #d9d9d9; margin: -1.5px -3px 2px; padding: 2px; }
.control-linea { display: flex; justify-content: space-between; gap: 6px; padding: 0 2px; line-height: 1.05; }
.fecha-vacia { letter-spacing: 1px; }
/* El día de la entrega, el dato que se lee de reojo: la fecha de al lado hay
   que leerla entera para saber qué día cae. Grande —14 pt, contra los 10 del
   resto de la caja— y en negrita, que es lo que se pidió. No más que eso: en la
   nota más cargada, medida en Verdana, 14 pt dejan la hoja en 262,9 mm sobre
   265, y cada punto de más se come el colchón (18 pt la clavan en 264,4). */
.dia-entrega { font-weight: bold; font-size: 14pt; }

.numero-caja { width: 28%; padding: 0; }
.numero-titulo { font-weight: bold; text-align: center; background: #d9d9d9; padding: 2px; border-bottom: 1px solid #000; }
.numero { font-size: 16pt; text-align: center; padding: 3px 0 6px; border-bottom: 1px solid #000; }
.pendiente { color: #999; }
/* Al lado de los guiones y no debajo: en renglón aparte, esta casilla se hacía
   más alta que la de las fechas y empujaba a toda la hoja para decir una
   palabra que entra al costado. */
.pendiente small { font-size: 8pt; margin-left: 4px; }
.comprobantes { padding: 6px 4px; line-height: 1.35; }

/* Los tres números con los que se archiva la nota: quién la hizo, para quién y
   de qué zona. Grandes y en negrita porque es por donde se busca la hoja en un
   fajo, y hasta ahora iban en el mismo cuerpo que todo lo demás. */
.identificacion {
  display: flex;
  gap: 10mm;
  border: 1px solid #000;
  border-top: 0;
  padding: 2px 4px;
  font-size: 13pt;
  font-weight: bold;
}
.identificacion u { min-width: 22mm; display: inline-block; }

.bloque-cliente { border: 1px solid #000; border-top: 0; }
/* La única cosa de la hoja que se achicó: es la etiqueta del recuadro, y
   adentro ahora está el nombre del cliente en 17 pt. Dos cosas grandes seguidas
   compiten entre sí, y de las dos la que hay que leer es el nombre. */
.rotulo { padding: 0 4px; font-size: 8.5pt; }
/* Alto FIJO y no mínimo: es el recuadro del talonario, y crecer con el texto
   era lo que empujaba la nota a una segunda hoja.

   Y tampoco ACHICARSE. El flex-shrink en cero no es un detalle: de todos los
   bloques de la hoja, este recuadro y el de la descripción son los únicos que
   pueden encogerse —tienen alto declarado y recorte, así que su
   mínimo automático es cero—, y por eso se comían ELLOS SOLOS cualquier
   milímetro que faltara. Con la letra grande, la caja de la descripción general
   se aplastaba de 16 mm a 1,3 y la nota salía sin decir qué había que hacer con
   la herramienta, sin ningún aviso. La hoja entra medida (ver ALTO_HOJA_MM),
   así que acá no hay nada que repartir; si algún día vuelve a faltar, que se
   note en el pie y no en lo que el taller tiene que leer. */
.texto-libre {
  border-top: 1px solid #000;
  height: ${ALTO_DATOS_CLIENTE_MM}mm;
  flex-shrink: 0;
  padding: 2px 4px;
  white-space: pre-wrap;
  word-break: break-word;
  overflow: hidden;
  /* Letra chica y renglones juntos: lo que se busca acá es que entren las
     cinco líneas que trae la ficha del padrón —dirección, CP, teléfono, mail
     y contacto— y no que se lea de lejos. El nombre del cliente, que sí se lee
     de lejos, tiene su propio cuerpo abajo. */
  font-size: 9.5pt;
  line-height: 1.15;
}

/* ── El nombre del cliente ───────────────────────────────────────────────────
   Es el dato más buscado de la hoja: quien recibe la herramienta en fábrica, o
   quien archiva el comprobante en la oficina, busca el nombre y nada más. Iba
   metido adentro de la ficha, en 8 pt, indistinguible del mail y del código
   postal.

   El renglón NO envuelve: una razón social larga se corta con puntos
   suspensivos. Envolver le comería el renglón a la ficha de abajo —la caja
   tiene alto fijo, ver ALTO_DATOS_CLIENTE_MM— y perder la dirección entera
   para mostrar el final de un "S.A.I.C. y F." no es un buen cambio. */
.cliente-nombre {
  font-size: 17pt;
  font-weight: bold;
  line-height: 1.1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* El resto de la ficha: dirección, CP, teléfonos, mail y contacto. */
.cliente-ficha { padding-top: 0.6mm; font-size: 9pt; }
.texto-libre.alto-2 {
  height: ${ALTO_DESCRIPCION_MM}mm;
  border: 1px solid #000;
  border-top: 0;
  /* Acá conviven la línea del servicio, lo que agrega el vendedor y los avisos
     de agujero: son hasta cuatro renglones y la caja no crece (ver
     ALTO_DESCRIPCION_MM), así que el cuerpo se eligió midiendo cuántos entran,
     no a ojo. */
  font-size: 9.5pt;
}

.bloque-titulo {
  background: #d9d9d9;
  border: 1px solid #000;
  border-top: 0;
  text-align: center;
  font-weight: bold;
  padding: 1.5px;
  font-size: 9.5pt;
}

.tabla th { background: #d9d9d9; font-weight: normal; font-size: 8.5pt; text-align: center; }
.tabla .grupo { font-weight: bold; }
/* 4.4 mm es el PISO, no el alto: con el reparto de arriba las filas crecen
   hasta llenar la hoja, y sólo bajan hasta acá cuando la nota viene cargada
   hasta el tope. Menos que esto ya no se puede escribir a mano. */
.tabla td { height: 4.4mm; font-size: 10pt; }

/* ── De dónde salió el cuerpo más grande ─────────────────────────────────────
   Estas filas son veinticuatro —doce técnicas y doce comerciales— así que cada
   punto de cuerpo que se les agrega cuesta seis milímetros de hoja, y la hoja
   no da. El milímetro que faltaba salió del AIRE de la celda, no de la letra:
   el relleno vertical baja de 1,5 px a 0,5 y la fila queda tan alta como
   estaba, con la letra un 18 % más grande adentro.

   Medido: con el relleno de antes la nota más cargada pedía 274,4 mm sobre una
   hoja de ${ALTO_HOJA_MM}. Con éste pide 258,5 y sobran seis, que las filas se
   reparten y terminan midiendo lo mismo que siempre.

   El relleno horizontal no se toca: es lo que separa el texto de la línea de
   la columna de al lado. */
.nota .tabla td { padding-top: 0.5px; padding-bottom: 0.5px; }

/* ── Por qué la comercial va un punto más chica que la técnica ────────────────
   La técnica lleva números cortos —diámetros, cantidades, dientes— que entran
   holgados a 10 pt. La comercial lleva el precio de siete cifras, la condición
   con su plazo y hasta tres notas hermanas, y esos tres, medidos en Verdana (la
   fuente del teléfono, no la Arial de esta PC), NO entran a 10 pt: la tabla
   entera pediría 113 % de su ancho. A 9 pt entran con los anchos de
   COLUMNAS_COMERCIALES, y 9 pt sigue siendo más grande que los 8,5 de antes. */
.nota .comercial td { font-size: 9pt; }

/* ── Una fila, un renglón ────────────────────────────────────────────────────
   El ancho de cada columna lo fija el <colgroup> (ver COLUMNAS_TECNICAS) y no
   el contenido. Sin esto el reparto automático le daba 26,6 mm a la
   descripción, el texto envolvía a tres renglones y la nota se pasaba 66 mm de
   la hoja — que "overflow: hidden" recortaba sin avisar.

   El "nowrap" es la garantía, no un adorno: acá no hay JavaScript que pueda
   medir y reacomodar —el WebView que arma el PDF en el celular lo tiene
   apagado—, así que la única forma de que la hoja NO PUEDA desbordar es que
   ninguna fila pueda crecer. Una descripción más larga que su casilla se corta
   con puntos suspensivos: se pierde el final de un renglón, a la vista, en vez
   de perderse el pie de la nota entera sin que nadie se entere.

   Los <th> quedan afuera a propósito: los encabezados sí envuelven ("Ancho
   Corte / Espesor", "Precio unitario"), y son dos renglones fijos que no
   dependen de lo que se cargue. */
.nota .tabla { table-layout: fixed; }
.nota .tabla td { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* Los encabezados de la tabla COMERCIAL tambien se recortan. Sin esto un
   titulo que no entra se derrama sobre la columna vecina y las letras se
   montan: pasaba con "Descuento" sobre "Condicion de Venta". Los anchos ya
   estan calculados para que ninguno lo necesite; esto es la red por si manana
   cambia un titulo.
   Solo la comercial: en la tecnica el unico titulo que se derrama es
   "Cantidad" (rowspan, columna del 6 %), y ya lo hacia antes de este cambio;
   ponerle el recorte a los <th> tecnicos les comeria letras que se leen
   enteras, y no arregla el de "Cantidad", que es de ancho de columna. */
.nota .comercial th { overflow: hidden; text-overflow: ellipsis; }
.tabla .num { text-align: right; }
.tabla .tick { text-align: center; font-weight: bold; }
/* La descripción de la herramienta y el código de cómputo van en el MISMO
   cuerpo y peso que las casillas de operación (10 pt negrita). Es lo que se
   pidió: "Fresa", "6005" y "7701" tienen que verse igual que el "126" y el "2"
   de las columnas de operación, que son los tres datos con los que en fábrica
   se identifica la pieza y su cómputo. El código está en la tabla comercial,
   que va a 9 pt, así que se lo sube expresamente. */
.tabla .desc { font-weight: bold; }
.nota .comercial td.computo { font-size: 10pt; font-weight: bold; }
/* Los anchos de columna ya no se declaran acá: viven en los <colgroup> que
   arma "colgroup()", porque con "table-layout: fixed" el ancho lo fija la
   primera fila o las columnas, y los <th> de este talonario tienen colspan y
   rowspan —el reparto por encabezado no era posible—. */
/* La casilla de operación lleva la cantidad de dientes —hasta 120 en el
   catálogo real, tres cifras— o una X. "120" a 10 pt mide 27 px sobre los 39 de
   la columna (5,5 %), así que va al mismo cuerpo que el resto de la técnica. */
.tabla .tick { font-size: 10pt; }
.comercial th { line-height: 1.1; }
.cambio { letter-spacing: 1px; }

/* ── El bloque comercial del duplicado ───────────────────────────────────────
   Tabla angosta a la izquierda, cajas a la derecha, y el medio libre para
   escribir a mano. Estirar dos columnas a lo ancho de la hoja dejaba una pared
   de líneas vacías al lado de un número de cuatro dígitos. */
.comercial-duplicado { display: flex; align-items: flex-start; gap: 4mm; }
.comercial-duplicado .comercial { width: 62mm; flex: 0 0 62mm; }
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
  padding: 1px 6px;
  font-size: 12pt;
}
.resumen strong { font-size: 14pt; }
/* La cuenta de la fila, debajo del unitario y más chica: acompaña al precio sin
   competir con él, que es el número que el cliente busca primero. */
/* Ver celdaCodigo(): solo para los codigos que no entran en cuerpo normal.
   Sin acentos ni comillas invertidas: esto vive adentro de un template
   literal y una comilla invertida lo termina. Ya paso tres veces. */
/* Este NO sube con el resto: es la salida de emergencia de los codigos que no
   entran a 10 pt negrita (ver celdaCodigo, que mide el ancho y elige el cuerpo).
   La clase da el PESO normal y un font-size de 6 pt como piso; el cuerpo real de
   cada codigo lo pone celdaCodigo inline. "CLGNMFS3940MCAJA", el mas largo del
   catalogo, mide 93 px a 6 pt contra los 93 de la columna (13 %) y entra justo;
   6 pt son 8 px, el minimo que dibuja el WebView de Android. */
/* Sin negrita a propósito: la negrita es mas ancha, y estos codigos se achican
   justamente porque no entraban. El resto de la columna va en negrita (ver
   .computo), pero acá la prioridad es que entre entero. */
.codigo-largo { font-size: 6pt; font-weight: normal; }
/* Los números de las notas hermanas, en negrita: es lo único que se usa de esa
   observación —con ellos en la oficina se juntan las hojas del mismo cliente— y
   antes se leían igual que la frase que los explica.
   El cuerpo NO sube más allá del de la celda (9 pt): una nota puede listar
   hasta tres hermanas (cuatro grupos de facturación ⇒ cuatro notas), y
   "02-0082, 02-0083, 02-0084" en 9 pt negrita mide 210 px sobre los 223 de la
   columna. A 10 pt son 231 y se pierde el tercer número, que es justo lo que la
   casilla existe para mostrar. La negrita es el énfasis; agrandarla, no. */
.hermanas { font-weight: bold; }
/* La casilla NO envuelve —recorta con puntos suspensivos— y los números van al
   final, así que resaltarlos no sirve si la frase que los precede se come el
   ancho. Por eso al imprimir se escribe "NP " y no "Va con nota de pedido ":
   con el prefijo entero, tres hermanas piden 262 px sobre los 223 de la columna
   (medido en Verdana) y se pierde el tercer número. Con "NP " miden 210 y
   entran las tres. Ver celdaObservacion, que arma el texto.

   "NP" es la abreviatura de esta misma hoja: la caja de fechas dice "Emision
   NP:". No hay que explicarla en la oficina. */

.firmas { display: flex; justify-content: space-around; text-align: center; }
.firmas .linea { border-top: 1px dotted #000; width: 55mm; margin: 0 auto 2px; }

.deposito { display: flex; justify-content: flex-end; gap: 4mm; margin-top: 2mm; }
.caja { width: 52mm; }
.caja td { height: 5mm; font-size: 9.5pt; }
.caja .alto { height: 14mm; vertical-align: top; }
.pie-firma { text-align: center; font-size: 9pt; }

.talon { display: flex; align-items: stretch; gap: 0; margin-top: 4mm; border-top: 1px dashed #000; padding-top: 3mm; }
.talon-num { border: 1px solid #000; padding: 3px 6px; font-size: 10pt; line-height: 1.2; }
.talon .caja { flex: 0 0 52mm; }
.talon-num strong { font-size: 16pt; }
.talon-medio { flex: 1; border: 1px solid #000; border-left: 0; border-right: 0; }

.copia { text-align: right; font-size: 10pt; margin-top: 1.5mm; }

/* ── El duplicado, apretado ──────────────────────────────────────────────────
   Es la copia del taller: no lleva precios ni condiciones, así que el aire del
   original es papel desperdiciado. Se achica todo lo que no sea espacio para
   escribir a mano, y las filas de escritura se dejan usables. */
/* Llena la hoja: A4 (297mm) menos los 8mm de margen de cada lado. La tabla
   comercial es la única que crece, así que todo el espacio sobrante termina
   siendo renglones para escribir y no aire entre bloques. */
/* El alto ya lo pone la caja de la hoja para las dos copias: acá sólo queda lo
   que distingue al duplicado, que es la letra apretada. */
.duplicado { font-size: 10.5pt; }
/* En el duplicado la tabla comercial va angosta al costado, así que el bloque
   entero es el que se estira; adentro, la tabla llena su alto. */
.duplicado .comercial-duplicado { flex: 1 1 0; }
.duplicado .comercial-duplicado .comercial { height: 100%; }
.duplicado .tabla.comercial { flex: none; }
.duplicado .control-titulo, .duplicado .numero-titulo { font-size: 11.5pt; padding: 1px; }
.duplicado .control-linea { line-height: 1.25; }
.duplicado .numero { font-size: 15pt; padding: 2px 0 3px; }
.duplicado .comprobantes { line-height: 1.6; padding: 3px 4px; }
.duplicado .logo { max-height: 18mm; }
.duplicado .texto-libre { height: 12mm; }
/* En el duplicado el nombre es lo único que lleva el recuadro, y es todo lo
   que el taller necesita para saber de quién es la pieza. */
.duplicado .cliente-nombre { font-size: 16pt; }
/* El mismo alto que en el original, y no uno propio: adentro va el mismo texto
   con el mismo cuerpo. Con 15 mm le faltaban ocho centésimas para el cuarto
   renglón y la última línea de la descripción se cortaba —sólo en el duplicado,
   sólo con el ajuste de letra del sistema en grande—. Se escribe igual y no se
   borra porque la regla de al lado viene después y le pisaría el alto. */
.duplicado .texto-libre.alto-2 { height: ${ALTO_DESCRIPCION_MM}mm; }
.duplicado .bloque-titulo { padding: 1px; font-size: 10.5pt; }
.duplicado .tabla th { font-size: 8.5pt; }
/* Igual que en el original: es el piso. El reparto de la hoja las estira
   hasta llenarla. */
.duplicado .tabla td { height: 4.2mm; font-size: 10pt; }
.duplicado .deposito { margin-top: 1.5mm; }
.duplicado .caja td { height: 4.2mm; font-size: 9pt; }
.duplicado .caja .alto { height: 10mm; }
.duplicado .talon { margin-top: 2.5mm; padding-top: 2mm; }

@media print {
  .control-titulo, .numero-titulo, .bloque-titulo, .tabla th {
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
}
`

/**
 * El papel, y la caja donde entra cada hoja.
 *
 * Va aparte del resto de los estilos porque es lo único que NO se agranda
 * cuando el sistema agranda la letra: el papel mide lo que mide. Ver
 * `conMedidasEscaladas`, que escala todo lo demás y a esto no lo toca.
 */
const ESTILOS_PAGINA = `
@page { size: A4 portrait; margin: 8mm; }

/* Una hoja de papel. Mide siempre lo mismo, pase lo que pase con la letra del
   teléfono, y es la que decide dónde corta la página. */
.hoja {
  width: 190mm;
  height: ${ALTO_HOJA_MM}mm;
  margin: 0 auto;
  overflow: hidden;
  page-break-after: always;
  break-after: page;
}
.hoja:last-child { page-break-after: auto; break-after: auto; }

/* Adentro de una hoja, el salto de página lo manda la hoja. */
.hoja > .nota {
  margin: 0;
  page-break-after: auto;
  break-after: auto;
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
/**
 * Cómo se nombra en el papel el trabajo que se reclama. Va entre paréntesis
 * pegado a la descripción del renglón —"S.C. (afilado)"— para que la fábrica lea
 * de un vistazo sobre qué es el reclamo. `venta` significa que la herramienta
 * vino fallada.
 */
const ETIQUETA_RECLAMO: Record<string, string> = {
  afilado: 'afilado',
  reparacion: 'reparación',
  rectificado: 'rectificado',
  hermanado: 'hermanado',
  rebaje: 'rebaje',
  venta: 'vino fallada',
}

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
    concepto:
      esRenglonDeArticulo(i.servicio)
        ? 'venta'
        : i.servicio === 'reparacion'
          ? 'reparacion'
          : i.servicio === 'rectificado'
            ? 'rectificado'
            : 'afilado',
    cantidad: Math.max(1, Number(i.cantidad) || 1),
    // En una VENTA los dientes son una característica de la herramienta que se
    // vende, no algo que se cobre por unidad: lo que se computa son las
    // unidades. Sin esta condición, vender 3 sierras de 72 dientes computaba
    // 216 y multiplicaba el precio unitario por eso.
    // Un cabezal afilado como cuchillas se cobra por largo, no por diente: los
    // dientes valen 0 para que la reimpresión caiga en la misma rama (precio
    // total directo) que vio el vendedor. Espeja `cabezalAfiladoComoCuchilla`
    // sobre la fila guardada; sin esto, una fila con dientes cargados cotizaría
    // el cabezal entero al reimprimir.
    dientesPorHerramienta:
      esRenglonDeArticulo(i.servicio) ||
      (i.herramienta === 'cabezal' &&
        i.servicio === 'afilado' &&
        i.detalle?.cabezal_de_cuchillas === true)
        ? 0
        : Number(i.cantidad_dientes) || 0,
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
    /**
     * Reparar los dientes agrega una línea, no cambia la principal.
     *
     * La principal cobra los dientes sanos —los rotos no se afilan— y la
     * reparación va aparte con su código. Es el mismo criterio para todas las
     * notas, así que una nota vieja se vuelve a imprimir igual que como salió.
     */
    repararDientes: i.detalle?.reparar_dientes === true,
    // Los rascadores son por herramienta, igual que los dientes.
    rascadores:
      (Number(i.detalle?.rascadores) || 0) * Math.max(1, Number(i.cantidad) || 1),
    codigoRascador: d(i, 'codigo_rascador'),
    precioRascadorUnitario: Number(i.detalle?.precio_rascador_unitario) || 0,
    codigoReparacion: d(i, 'codigo_reparacion'),
    precioReparacionPorDiente: Number(i.detalle?.precio_reparacion_unitario) || 0,
    // En un renglón de artículo el unitario ya está guardado, así que no hay
    // total directo que usar: si lo hubiera, tres unidades se imprimirían como una.
    precioTotalDirecto: esRenglonDeArticulo(i.servicio) ? 0 : Number(i.precio_total) || 0,
    // Lo que no se cobra. Va en el detalle porque es una marca del renglón, no
    // un precio: el importe simbólico no se multiplica por nada. El reclamo va
    // sin cargo siempre, marca guardada o no (espeja `computoDeRenglon`).
    sinCargo: i.detalle?.sin_cargo === true || i.servicio === 'reclamo',
    reparacionSinCargo: i.detalle?.reparacion_sin_cargo === true,
    /**
     * El descuento del renglón, que se aplica UNA sola vez.
     *
     * Se puede aplicar acá sin miedo a duplicarlo porque lo que la base guarda
     * en `precio_unitario` y `precio_total` es precio de LISTA. Si alguna de
     * esas dos columnas viniera ya descontada, esta línea la descontaría de
     * nuevo y la reimpresión no daría el mismo número que el papel original.
     */
    descuentoPorcentaje: Number(i.descuento_porcentaje) || 0,
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

  const entrega = nota.fecha_entrega ? new Date(`${nota.fecha_entrega}T12:00:00`) : null

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

  /**
   * Los totales escritos, con o sin IVA según quién los pida.
   *
   * Los renglones y sus precios van SIEMPRE en neto: la nota lo dice en las
   * columnas. Lo único que cambia con la situación del cliente es qué se
   * muestra abajo de todo, y las dos versiones salen de este mismo mapa por
   * moneda para que no puedan discrepar entre ellas ni con la tabla de arriba.
   */
  const escribirTotales = (factor: number) =>
    Array.from(porMoneda.entries())
      .filter(([, valor]) => valor > 0)
      // Los pesos primero: es la moneda en la que se cobra.
      .sort(([a], [b]) => (a === b ? 0 : a === 'ARS' ? -1 : 1))
      .map(([moneda, valor]) => formatearMoneda(Math.round(valor * factor * 100) / 100, moneda))
      .join('  ·  ')

  const totales = escribirTotales(1)

  return {
    totales,
    /*
      El vendedor va adelante: la 81 del vendedor 2 se escribe 02-0081.

      Sale de `vendedor_numero` **y nada más**, sin caer al código del perfil
      como sí hace el casillero "Vendedor Nº" de abajo. La diferencia importa
      en una nota vieja con la columna en null: la base escribe el aviso
      cruzado entre notas hermanas con `interno.numero_de_nota_impreso(numero,
      vendedor_numero)` y las listas leen esa misma columna, así que caer al
      perfil acá haría que la hoja diga `07-0081` mientras la cola de impresión
      que la mandó a imprimir dice `000081`. Un comprobante con dos números es
      peor que uno sin prefijo.
    */
    numero: numeroDeNotaImpreso(nota.numero, nota.vendedor_numero),
    tipo_nota: nota.tipo_nota,
    servicios: nota.servicios ?? [],
    // Sin los ceros de relleno del Gestión: "007" se escribe 7 en el talonario.
    vendedor_numero: numeroDeVendedorImpreso(
      nota.vendedor_numero ?? nota.vendedor?.codigo_vendedor,
      VENDEDORES_CON_CERO,
    ),
    cliente_numero: nota.cliente_codigo,
    cliente_nombre: nota.cliente_nombre ?? null,
    zona: nota.zona ?? '',
    datos_cliente: nota.datos_cliente ?? '',
    descripcion_herramientas: nota.descripcion_herramienta ?? '',
    tecnicos: items.map((i) => {
      // Las casillas de operación llevan la CANTIDAD de dientes, no un tilde:
      // es el mismo número que se computa del otro lado de la hoja, y así el
      // taller no tiene que cruzar las dos tablas para saber cuántos son.
      const lineas = lineasDeComputo(computoDeFila(i))
      const dientesDe = (concepto: 'afilado' | 'rectificado' | 'reparacion') =>
        lineas.find((l) => l.concepto === concepto)?.cantidad ?? 0

      const trabajo = (
        aplica: boolean,
        concepto: 'afilado' | 'rectificado' | 'reparacion',
      ): CasillaOperacion => {
        if (!aplica) return false
        const n = dientesDe(concepto)
        // Sin dientes —una mecha, una cuchilla— la casilla vuelve a ser un tilde.
        return n > 0 && i.cantidad_dientes ? n : true
      }

      // Sobre qué trabajo se reclama, para pegarlo a la descripción del renglón.
      const reclamado =
        i.servicio === 'reclamo'
          ? (i.detalle?.servicio_reclamado as string | undefined)
          : undefined
      return {
        descripcion:
          (i.descripcion ?? i.codigo_herramienta ?? '') +
          (reclamado ? ` (${ETIQUETA_RECLAMO[reclamado] ?? reclamado})` : ''),
        afilado: trabajo(i.servicio === 'afilado', 'afilado'),
        rectificado: trabajo(i.servicio === 'rectificado', 'rectificado'),
        // También cuando se reparan los dientes rotos de una herramienta que
        // vino a afilar: sobre esa pieza se hacen las dos operaciones, y la
        // casilla de reparación lleva sólo los dientes rotos.
        // Siempre la línea de reparación, venga de un renglón que ES una
        // reparación o de uno que además repara sus dientes rotos: en los dos
        // casos esa línea lleva el concepto `reparacion`.
        reparacion: trabajo(
          i.servicio === 'reparacion' || i.detalle?.reparar_dientes === true,
          'reparacion',
        ),
        tensado: false,
        rellenado: false,
        otro: ['hermanado', 'rebaje', 'reclamo', 'venta'].includes(i.servicio) ? i.servicio : '',
        cantidad: i.cantidad,
        // "ØExt.-Largo" y "ØInt.-Ancho" son columnas de doble uso: una sierra
        // trae diámetros y una cuchilla trae largo y ancho.
        diametro_exterior: d(i, 'diametro_exterior') || d(i, 'diametro') || d(i, 'largo'),
        // El agujero manda sobre las otras dos lecturas de esta columna: si se
        // cargó, es el dato que la fábrica necesita.
        //
        // En las FRESAS, si no se cargó uno distinto, se imprime el de fábrica
        // (`diametro_interior_catalogo`): TODAS las fresas del catálogo llevan
        // 40, así que ése es el estándar y tiene que salir en el papel aunque el
        // vendedor no lo toque. En el resto de las herramientas NO se cae al de
        // fábrica —una sierra puede tener cinco agujeros posibles y poner uno
        // que nadie eligió es peor que dejarlo en blanco—, así que la caída sólo
        // vale para fresas.
        diametro_interior:
          d(i, 'diametro_interior') ||
          (i.herramienta === 'fresa' ? d(i, 'diametro_interior_catalogo') : '') ||
          d(i, 'ancho') ||
          d(i, 'largo_util'),
        ancho_corte: d(i, 'ancho_corte') || d(i, 'espesor'),
        /**
         * "18+4", como lo escribe la lista de Franzoi.
         *
         * Los dientes y los rascadores son dos números distintos y se afilan
         * con códigos distintos, pero en la pieza son una sola cosa: quien la
         * mira en fábrica cuenta 22 filos. Escribirlos sumados escondería que
         * cuatro de ellos son rascadores; escribir sólo los dientes haría
         * pensar que faltan.
         */
        z_paso: i.cantidad_dientes
          ? Number(i.detalle?.rascadores) > 0
            ? `${i.cantidad_dientes}+${Number(i.detalle?.rascadores)}`
            : String(i.cantidad_dientes)
          : d(i, 'paso'),
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
        // El porcentaje, no el importe: es lo que se pidió que se viera, y el
        // dinero ya lo dice el total de abajo.
        descuento: l.descuento > 0 ? `${l.descuento} %` : '',
        // La condición de venta es de la nota entera y va una sola vez, en
        // la primera fila. La reparación de dientes rotos se aclara en su
        // propia fila, que es donde está su código, y lo que no se cobra se
        // dice con todas las letras.
        /**
         * Qué trabajo es cada fila NO va acá.
         *
         * Esta columna es "Condición de Venta" y lo que le corresponde es la de
         * la nota. Nombrar el servicio acá lo decía dos veces —ya está en la
         * descripción general, que es donde se lee— y encima en la casilla
         * equivocada. Lo único propio de la fila que sobrevive es lo que no se
         * cobra, que no es un servicio sino una condición.
         */
        condicion_venta: l.sinCargo ? 'SIN CARGO' : '',
        anticipo: '',
        observaciones: '',
      })),
      nota.observaciones ?? [],
    ),
    // Vacío en las notas de afilado: se cobra en pesos y una cotización ahí
    // sólo hace dudar de en qué moneda está el total.
    tipo_cambio: nota.tipo_cambio ? monto(Number(nota.tipo_cambio)) : '',
    // Compacta: la casilla del talonario es angosta y recorta sin avisar.
    condicion_venta: describirCondicionVenta(
      nota.condicion_venta ?? null,
      nota.condicion_venta_detalle,
      { compacto: true },
    ),
    emision: new Date(nota.creado_en).toLocaleDateString('es-AR'),
    // `fecha_entrega` es un `date` de Postgres: al mediodía, para que el huso
    // no la corra un día para atrás al pasarla por Date. Vale para las dos
    // lecturas —la fecha y el día de la semana—, que salen del mismo Date para
    // que no puedan discrepar.
    fecha_entrega: entrega ? entrega.toLocaleDateString('es-AR') : undefined,
    fecha_entrega_dia: entrega ? DIAS_DE_LA_SEMANA[entrega.getDay()] : undefined,
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
/** ¿Hay que compensar algo, o el sistema no está agrandando la letra? */
function escalaValida(escala: number | undefined): escala is number {
  return !!escala && Number.isFinite(escala) && escala > 0 && escala !== 1
}

const redondear = (n: number) => Math.round(n * 1000) / 1000

/**
 * Agranda TODAS las medidas del documento por la escala de letra del sistema.
 *
 * ─── Por qué se agranda la hoja en vez de achicar la letra ───────────────────
 *
 * El WebView de Android que arma el PDF le aplica al texto —y sólo al texto— el
 * tamaño de letra del sistema. Las cajas en milímetros no se enteran, así que
 * con la letra en grande el contenido no entra y el pie de la hoja se pierde:
 * el TOTAL, las firmas y la palabra ORIGINAL o DUPLICADO.
 *
 * El primer intento fue el evidente: dividir cada `font-size` por la escala,
 * para que el WebView lo volviera a multiplicar y quedara igual. **No funciona,
 * y no por poco.** Ese WebView no dibuja texto por debajo de 8 px y no hay
 * forma de bajarle ese piso desde el CSS. Con el sistema en 2×, los 8,5 pt de
 * las filas quedaban en 4,25 pt = 5,67 px, o sea por debajo del piso: se
 * subían a 8 px y recién ahí se multiplicaban por 2. Resultado, 16 px donde
 * hacían falta 11,33 — un 41 % más grandes—. La compensación no sólo no
 * arreglaba: empeoraba, porque cuanto más chica la letra pedida, más la subía
 * el piso. Está medido en el teléfono, con el registro de `imprimirNotas`:
 * "escala de letra=2 · 8.5pt compensado=4.25pt".
 *
 * Así que se hace al revés, y por eso esto multiplica en lugar de dividir:
 *
 *  1. los `font-size` se dejan como están —nunca se acercan al piso de 8 px—;
 *  2. TODA otra medida (mm y px: altos, anchos, bordes, separaciones) se
 *     multiplica por la escala;
 *  3. el WebView multiplica el texto por la escala, por su cuenta;
 *  4. queda una maqueta idéntica, `escala` veces más grande en todo;
 *  5. `transform: scale(1 / escala)` la devuelve al tamaño del papel.
 *
 * El `transform` no pasa por el motor de fuentes, así que ningún piso lo toca.
 *
 * Los `pt` quedan afuera a propósito: en esta hoja de estilos **todo `pt` es un
 * `font-size`** y ninguna medida de caja se expresa en puntos. Si eso deja de
 * ser cierto hay que revisar esta función; la prueba que lo comprueba está en
 * el banco de medición.
 */
function conMedidasEscaladas(css: string, escala: number | undefined): string {
  if (!escalaValida(escala)) return css
  return css.replace(
    /([\d.]+)(mm|px)\b/g,
    (_todo, valor: string, unidad: string) => `${redondear(Number(valor) * escala)}${unidad}`,
  )
}

/**
 * La regla que devuelve la hoja agrandada a su tamaño real.
 *
 * Va aparte y después de todo lo demás para que gane por orden, y sólo se
 * emite cuando hace falta: en la PC el navegador no le aplica al documento el
 * tamaño de letra del sistema operativo, así que ahí no hay nada que compensar
 * y el documento sale exactamente como salía.
 */
function estilosDeEscala(escala: number | undefined): string {
  if (!escalaValida(escala)) return ''
  return `
/* La maqueta se dibujó ${escala}× más grande para esquivar el piso de tamaño de
   letra del WebView; acá vuelve al tamaño del papel. */
.hoja > .nota {
  transform: scale(${redondear(1 / escala)});
  transform-origin: top left;
}
`
}

export function generarDocumentoImpresion(
  notas: Array<{ nota: NotaParaImprimir; opciones: OpcionesImpresion }>,
  extras?: {
    rolDeVisita?: RolDeVisitaParaImprimir
    /** La rendición de cobranzas del día. Va en su propia hoja, adelante. */
    planillaCobranzas?: PlanillaCobranzasParaImprimir
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
  // Cada nota va adentro de una hoja de papel de tamaño fijo. La hoja es la que
  // manda el salto de página; la nota, adentro, puede estar dibujada más grande
  // y volver a escala con un transform (ver conMedidasEscaladas).
  const paginas = notas.map(
    ({ nota, opciones }) => `<div class="hoja">${generarHtmlNotaPedido(nota, opciones)}</div>`,
  )
  // El rol de visita queda afuera del escalado: no tiene alto fijo —crece con
  // los destinos del día y puede ocupar más de una hoja— así que encerrarlo en
  // una caja de tamaño fijo lo recortaría, que es justo el problema que se
  // acaba de sacar de la nota. Con la letra del sistema en grande el rol sale
  // más grande y puede pasar a una hoja más, pero no pierde nada.
  if (extras?.rolDeVisita) paginas.unshift(generarHtmlRolDeVisita(extras.rolDeVisita))
  // La planilla de cobranzas va PRIMERA de todo: es la rendición del día, y en
  // la oficina se separa de las notas apenas sale del cajón.
  if (extras?.planillaCobranzas) {
    paginas.unshift(generarHtmlPlanillaCobranzas(extras.planillaCobranzas))
  }

  const titulo = extras?.planillaCobranzas
    ? 'Planilla de cobranzas · WoodTools'
    : extras?.rolDeVisita
      ? 'Rol de visita y notas de pedido · WoodTools'
      : 'Notas de pedido · WoodTools'

  const estilos = [
    ESTILOS_PAGINA,
    conMedidasEscaladas(ESTILOS_NOTA_PEDIDO, extras?.escalaDeLetra),
    ESTILOS_ROL_DE_VISITA,
    ESTILOS_PLANILLA_COBRANZAS,
    estilosDeEscala(extras?.escalaDeLetra),
  ].join('\n')

  return `<!doctype html>
<html lang="es-AR">
<head>
<meta charset="utf-8">
<title>${titulo}</title>
<style>${estilos}</style>
</head>
<body>${paginas.join('\n')}</body>
</html>`
}
