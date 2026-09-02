import type { Herramienta } from './notas-pedido'

/**
 * Qué TIPO de pieza es la que el cliente trajo.
 *
 * ─── Por qué hacía falta ─────────────────────────────────────────────────────
 *
 * Porque "FRESA" no es una herramienta: es una familia de veintinueve. Una
 * fresa recta, un machimbre de piso para grampa y un cabezal cepillador se
 * cargaban los tres con los mismos cuatro campos, y el vendedor tenía que saber
 * de memoria qué medida correspondía a cuál. En la base se veía el resultado:
 * de 325 fresas, el diámetro interior estaba cargado en 19 y el exterior en 51.
 *
 * ─── Qué resuelve ────────────────────────────────────────────────────────────
 *
 * El tipo va ANTES de las medidas y trae las suyas puestas. El catálogo general
 * de WoodTools dice, para cada tipo, qué vale para todos sus modelos: las
 * veintinueve clases de fresa llevan diámetro interior 40, sin una sola
 * excepción, y casi todas tienen un diámetro exterior fijo. Eso deja de ser algo
 * que el vendedor tiene que saber y pasa a ser algo que la app ya sabe.
 *
 * Lo que queda para escribir es lo que de verdad cambia de pieza a pieza: el
 * ancho de corte —que además es lo único que decide el precio del afilado, del
 * rectificado y de la reparación— y la cantidad de dientes.
 *
 * ─── De dónde salen estos datos ──────────────────────────────────────────────
 *
 * Del Catálogo General de WoodTools. Las fresas están en las páginas 3 a 12 y
 * los cabezales portacuchillas en las 18 a 20; cada panel es un tipo y trae su
 * tabla de códigos con las columnas del catálogo:
 *
 *   D   Diámetro exterior          Z   Número de dientes
 *   B   Ancho de corte             R   Número de dientes incisores
 *   d   Diámetro interior          b   Ancho de corte del diente
 *
 * Se usan esas letras en los rótulos a propósito: son las que el vendedor tiene
 * delante en el papel cuando está midiendo la pieza.
 *
 * ─── Relación con `tipo_mecha` ───────────────────────────────────────────────
 *
 * Las mechas ya tenían su propio campo de tipo, anterior a esto y con su propio
 * tipo de dato. Se deja como está: anda, está guardado en notas reales y no es
 * lo que se vino a arreglar. Cuando les toque el turno a las mechas se pliegan
 * acá, y mientras tanto conviven los dos — a sabiendas, no por accidente.
 */

export interface TipoDePieza {
  /**
   * Lo que se guarda. Es el mismo valor que `catalogo_medidas.geometria` **en
   * las fresas y los cabezales**.
   *
   * En las sierras y los incisores esa columna guarda otra cosa —la geometría
   * del diente: ATB, POS, NEG, TCG—, que no es un tipo de pieza. Por eso esas
   * herramientas no tienen lista acá y no la van a tener con estos valores.
   */
  valor: string
  /** Lo que se lee en el desplegable. */
  etiqueta: string
  /** Para que el que duda entre dos sepa cuál es. Sale del catálogo. */
  descripcion?: string
  /**
   * Lo que el catálogo fija para TODOS los modelos de este tipo.
   *
   * Se precarga al elegir el tipo, y el vendedor lo puede pisar: el catálogo
   * describe la línea estándar, y por el mostrador entra de todo. Lo que no
   * puede pasar es que tenga que adivinarlo.
   *
   * Sólo se pone lo que vale para todos. Cuando un tipo tiene modelos con
   * distinto diámetro —las contramolduras van 150, 250 y 320— no se pone
   * ninguno: es preferible un campo vacío a uno lleno con el número de otro.
   */
  fijas?: Partial<Record<'diametro_exterior' | 'diametro_interior' | 'ancho_corte' | 'cantidad_dientes', number>>
  /** Lo que el catálogo dice y no entra en ninguna medida de la app. */
  notas?: string
}

/**
 * El diámetro interior de las fresas del catálogo.
 *
 * Las veintinueve tablas dicen `d = 40`. No hay ninguna que diga otra cosa, y
 * en la base estaba cargado en 19 filas de 325. Se declara una sola vez para
 * que se vea que es una propiedad de la línea entera y no un número repetido
 * veintinueve veces por copiar y pegar.
 */
const AGUJERO_DE_FRESA = 40

/**
 * El cabezal cepillador, que está en las dos listas.
 *
 * El catálogo lo imprime entre las fresas —es la página 6— y la lista de
 * precios y la base lo tienen como cabezal: los siete CB están cargados con
 * `herramienta = 'cabezal'`. Las dos clasificaciones son ciertas y las dos
 * están en uso, así que aparece en los dos desplegables con el mismo valor.
 * Elija el vendedor la herramienta que elija, lo que se guarda es lo mismo y
 * coincide con la `geometria` que tienen los CB en el catálogo.
 */
const CABEZAL_CEPILLADOR: TipoDePieza = {
  valor: 'cabezal_cepillador',
  etiqueta: 'CABEZAL CEPILLADOR',
  descripcion: 'Para cepillar o espigar. Bajo nivel de ruido y menor consumo.',
  fijas: { diametro_exterior: 125, diametro_interior: AGUJERO_DE_FRESA },
  notas: 'Ancho de 55 a 220 mm según el modelo. b = 6 mm hasta el de 130, 12 mm de ahí en más.',
}

/** Las fresas del Catálogo General, páginas 3 a 12. */
const FRESAS: TipoDePieza[] = [
  CABEZAL_CEPILLADOR,

  { valor: 'fresa_recta', etiqueta: 'FRESA RECTA',
    descripcion: '4 ó 6 cortantes rectos para ranurar, cepillar o rebajar. Con ángulo axial a partir de 20 mm de ancho.',
    fijas: { diametro_exterior: 150, diametro_interior: AGUJERO_DE_FRESA } },

  { valor: 'fresa_recta_incisores', etiqueta: 'FRESA RECTA CON INCISORES',
    descripcion: '4 ó 6 cortantes con ángulo axial e incisores, para ranurar sin astillar.',
    fijas: { diametro_exterior: 150, diametro_interior: AGUJERO_DE_FRESA },
    notas: 'R = 2 a 6 incisores. Ancho de 15 a 100 mm.' },

  { valor: 'fresa_ranurar_regulable', etiqueta: 'FRESA PARA RANURAR REGULABLE',
    descripcion: 'Juego de fresas regulables para ranuras, rebajes y espigas.',
    fijas: { diametro_exterior: 160, diametro_interior: AGUJERO_DE_FRESA },
    notas: 'FRG0510: 5-10 mm, b=5. FRG1039: 10-39 mm, b=10. R=4 incisores.' },

  { valor: 'fresa_angulo', etiqueta: 'FRESA EN ÁNGULO',
    descripcion: '4 ó 6 cortantes para efectuar ángulos de 60º.',
    fijas: { diametro_exterior: 150, diametro_interior: AGUJERO_DE_FRESA },
    notas: 'Ancho de 10 a 50 mm.' },

  { valor: 'fresa_cuarto_circulo', etiqueta: 'FRESA 1/4 CÍRCULO',
    descripcion: 'Cóncavo o convexo, con ángulo axial. Formas de trabajo A, B, C ó D.',
    fijas: { diametro_exterior: 150, diametro_interior: AGUJERO_DE_FRESA },
    notas: 'Radios de 1/2 a 3/4" y de 3/4 a 1 1/4".' },

  { valor: 'fresa_medio_circulo', etiqueta: 'FRESA 1/2 CÍRCULO',
    descripcion: 'Cóncavo o convexo, con 4 ó 6 cortantes.',
    fijas: { diametro_exterior: 150, diametro_interior: AGUJERO_DE_FRESA },
    notas: 'Radios 1/2", 5/8", 3/4", 1", 1 1/2" y 2".' },

  { valor: 'zocalo_contramarco', etiqueta: 'ZÓCALO SIMPLE Y CONTRAMARCO',
    descripcion: 'Una fresa A y una B para zócalos; dos fresas A para contramarcos.',
    fijas: { diametro_exterior: 150, diametro_interior: AGUJERO_DE_FRESA, cantidad_dientes: 4 } },

  { valor: 'rinconera_simple', etiqueta: 'RINCONERA SIMPLE',
    descripcion: '4 ó 6 cortantes, según modelo 1 ó 2.',
    fijas: { diametro_exterior: 150, diametro_interior: AGUJERO_DE_FRESA } },

  { valor: 'rinconera_doble', etiqueta: 'RINCONERA DOBLE',
    descripcion: 'Fresas de 4 cortantes y sierra circular de 10, modelos 1 ó 2.',
    fijas: { diametro_exterior: 160, diametro_interior: AGUJERO_DE_FRESA },
    notas: 'Z = 2×4 y 1×10.' },

  { valor: 'frente_ingles', etiqueta: 'FRENTE INGLÉS',
    descripcion: 'Fresas regulables para Frente Inglés simple y machimbrado.',
    fijas: { diametro_exterior: 175, diametro_interior: AGUJERO_DE_FRESA },
    notas: 'Z = 4×4. Formas A y B.' },

  { valor: 'machimbre_simple', etiqueta: 'MACHIMBRE SIMPLE',
    descripcion: 'Para machimbre simple biselado o bajo fondo.',
    fijas: { diametro_exterior: 155, diametro_interior: AGUJERO_DE_FRESA } },

  { valor: 'machimbre_doble', etiqueta: 'MACHIMBRE DOBLE',
    descripcion: 'Para machimbre doble con chanfle o bajo fondo.',
    fijas: { diametro_exterior: 155, diametro_interior: AGUJERO_DE_FRESA },
    notas: 'Z = 10×4 y 2×16.' },

  { valor: 'machimbre_piso_standard', etiqueta: 'MACHIMBRE PISO STANDARD',
    descripcion: 'Juego de 4 fresas para machimbre de piso, junta abierta, macho y hembra redondeados.',
    fijas: { diametro_interior: AGUJERO_DE_FRESA },
    notas: 'JFMP3411: Ø 150. JFMP3416: Ø 160.' },

  { valor: 'machimbre_piso_grampa', etiqueta: 'MACHIMBRE PISO PARA GRAMPA',
    descripcion: 'Juego de 4 fresas con incisión para colocar grampa de sujeción.',
    fijas: { diametro_exterior: 180, diametro_interior: AGUJERO_DE_FRESA } },

  { valor: 'machimbre_piso_grampa_microbisel', etiqueta: 'MACHIMBRE PISO GRAMPA Y MICROBISEL',
    descripcion: 'Juego de 8 fresas con microbisel, aristas redondeadas e incisión para grampa.',
    fijas: { diametro_exterior: 180, diametro_interior: AGUJERO_DE_FRESA } },

  { valor: 'deck_standard', etiqueta: 'DECK STANDARD',
    descripcion: 'Juego de 2 fresas para deck tradicional. Regulable para distintos espesores.',
    fijas: { diametro_interior: AGUJERO_DE_FRESA },
    notas: 'JFDE4: Ø 150, Z=2×4. JFDE6: Ø 160, Z=2×6.' },

  { valor: 'deck_grampa', etiqueta: 'DECK PARA GRAMPA',
    descripcion: 'Juego de 4 fresas y 2 sierras para deck con grampas plásticas.',
    fijas: { diametro_exterior: 160, diametro_interior: AGUJERO_DE_FRESA } },

  { valor: 'replan_tablero', etiqueta: 'REPLÁN DE TABLERO',
    descripcion: 'Dos versiones: fresa sobre madera y madera sobre fresa.',
    fijas: { diametro_exterior: 200, diametro_interior: AGUJERO_DE_FRESA, ancho_corte: 55 },
    notas: 'Z = 3+3, b = 20 mm.' },

  { valor: 'moldura_puertas_ventanas', etiqueta: 'MOLDURA DE PUERTAS Y VENTANAS',
    descripcion: '2 fresas de moldura y una ranuradora, con ranura para tableros o vidrios.',
    fijas: { diametro_exterior: 150, diametro_interior: AGUJERO_DE_FRESA },
    notas: 'Z = 2×4 y 1×6.' },

  { valor: 'moldura_puertas_ventanas_simple', etiqueta: 'MOLDURA PUERTAS Y VENTANAS SIMPLE',
    descripcion: '1 fresa tipo replán y 2 rectas, para moldura, contramoldura y replán.',
    fijas: { diametro_exterior: 180, diametro_interior: AGUJERO_DE_FRESA },
    notas: 'Ancho de 35 a 45 mm. Z = 1×2+2 y 2×4.' },

  { valor: 'contramoldura_puertas_ventanas', etiqueta: 'CONTRAMOLDURA DE PUERTAS Y VENTANAS',
    descripcion: '4 ó 6 cortantes, para espigadoras o tupíes.',
    fijas: { diametro_interior: AGUJERO_DE_FRESA },
    notas: 'FCPV41: Ø 150 Z=4. FCPV6: Ø 250 Z=6. FCPV61: Ø 320 Z=6.' },

  { valor: 'puerta_muebles', etiqueta: 'PUERTA DE MUEBLES',
    descripcion: 'Una fresa de moldura y una ranuradora, para muebles de cocina y vanitoris.',
    fijas: { diametro_exterior: 160, diametro_interior: AGUJERO_DE_FRESA },
    notas: 'Z = 1×4 y 1×6.' },

  { valor: 'fresa_finger', etiqueta: 'FRESA PARA FINGER',
    descripcion: 'Finger en maderas de hasta 22 mm. Para unir a lo largo tableros de puertas.',
    fijas: { diametro_exterior: 150, diametro_interior: AGUJERO_DE_FRESA, ancho_corte: 22, cantidad_dientes: 4 } },

  { valor: 'fresa_finger_largo', etiqueta: 'FRESA PARA FINGER (HASTA 45 mm)',
    descripcion: 'Finger en maderas de hasta 45 mm. Para tableros, largueros y travesaños.',
    fijas: { diametro_exterior: 150, diametro_interior: AGUJERO_DE_FRESA, ancho_corte: 45 },
    notas: 'Z = 2+2.' },

  { valor: 'ensamble_conico', etiqueta: 'FRESA PARA ENSAMBLE CÓNICO',
    descripcion: 'Juego de fresas de 4 cortantes para unir madera. Profundidades 10-11, 8-9 y 12 mm.',
    fijas: { diametro_interior: AGUJERO_DE_FRESA },
    notas: 'JFE8122: Ø 150, ancho 10-45. JFE8121: Ø 160, ancho 3,8.' },

  { valor: 'fresa_encastre', etiqueta: 'FRESA PARA ENCASTRE',
    descripcion: 'Ensamble a 90º ó 180º. Para unir marcos de puertas y ventanas en escuadra.',
    fijas: { diametro_interior: AGUJERO_DE_FRESA },
    notas: 'JFE8Z122/124: Ø 180, ancho 19-40. JFME68: Ø 245, ancho 22-68. Z = 3+3.' },

  { valor: 'radios_multiples', etiqueta: 'FRESA PARA RADIOS MÚLTIPLES',
    descripcion: 'Multi-radios de 4 a 10 mm.',
    fijas: { diametro_exterior: 140, diametro_interior: AGUJERO_DE_FRESA, ancho_corte: 35, cantidad_dientes: 4 } },

  { valor: 'multimoldura', etiqueta: 'FRESA MULTIMOLDURA',
    descripcion: 'Distintas molduras sin cambiar los insertos: se sube o se baja el eje del tupí.',
    fijas: { diametro_exterior: 150, diametro_interior: AGUJERO_DE_FRESA, ancho_corte: 45, cantidad_dientes: 2 } },
]

/**
 * Los cabezales portacuchillas del Catálogo General, páginas 18 a 20, con las
 * medidas de la lista de precios Freud del 10/07/2025.
 *
 * Acá casi no hay medidas fijas y es a propósito: cada tipo tiene modelos con
 * diámetros y anchos distintos —el multirradio va de 12 a 45 mm de ancho— así
 * que precargar cualquier número sería precargar el de otro modelo. Lo que sí
 * queda es el TIPO, que es lo que le dice al taller qué pieza tiene delante.
 */
const CABEZALES: TipoDePieza[] = [
  CABEZAL_CEPILLADOR,

  { valor: 'portacuchillas_cepillar', etiqueta: 'PORTACUCHILLAS PARA CEPILLAR',
    descripcion: 'Apilables: se pueden juntar para aumentar el ancho de corte.',
    fijas: { diametro_exterior: 125, diametro_interior: 40, cantidad_dientes: 4 } },

  { valor: 'portacuchillas_cepillar_angulo_axial', etiqueta: 'PORTACUCHILLAS PARA CEPILLAR CON ÁNGULO AXIAL',
    descripcion: 'En molduleras y tupí, se logra un óptimo acabado superficial.',
    fijas: { diametro_exterior: 125, diametro_interior: 35, ancho_corte: 50, cantidad_dientes: 4 },
    notas: 'R = 4 precortadores.' },

  { valor: 'portacuchillas_regulable', etiqueta: 'PORTACUCHILLAS REGULABLE',
    descripcion: 'Ranurador regulable, para ranuras en distintos espesores.',
    fijas: { diametro_exterior: 140, diametro_interior: 40, cantidad_dientes: 4 },
    notas: 'T198M FC3 regula de 20 a 39 mm; T198M GC3, de 30 a 59. R = 4 precortadores.' },

  { valor: 'portacuchillas_multicorte_helicoidal', etiqueta: 'PORTACUCHILLAS MULTICORTE HELICOIDAL',
    descripcion: 'Desbaste en machimbradora y molduleras. Profundidad hasta 20 mm, muy silencioso.',
    fijas: { diametro_interior: 40 },
    notas: 'Anchos de 78,5 a 217,5 mm. Los de más de 160 mm todavía no tienen código de afilado.' },

  { valor: 'portacuchillas_juntar_madera_finger', etiqueta: 'PORTACUCHILLAS PARA JUNTAR MADERA (FINGER JOINT)',
    descripcion: 'Para juntar madera con distintos perfiles.',
    fijas: { diametro_exterior: 136, diametro_interior: 35, ancho_corte: 54.5, cantidad_dientes: 4 } },

  { valor: 'portacuchillas_juntar_madera', etiqueta: 'PORTACUCHILLAS PARA JUNTAR MADERA',
    descripcion: 'Muy usado para la unión de tableros.',
    fijas: { diametro_exterior: 140, diametro_interior: 35, ancho_corte: 70, cantidad_dientes: 4 } },

  { valor: 'portacuchillas_multirradio', etiqueta: 'PORTACUCHILLAS MULTIRRADIO',
    descripcion: 'Medios círculos y cuartos de círculo, internos y externos, con distintos radios.',
    fijas: { diametro_interior: 35, cantidad_dientes: 2 },
    notas: 'Anchos de 12 a 45 mm según el modelo.' },

  { valor: 'portacuchillas_multiperfil', etiqueta: 'PORTACUCHILLAS MULTIPERFIL',
    descripcion: 'Distintos perfiles sin cambiar el inserto.',
    fijas: { diametro_exterior: 160, diametro_interior: 35, ancho_corte: 55, cantidad_dientes: 2 } },

  { valor: 'portacuchillas_multiuso', etiqueta: 'PORTACUCHILLAS MULTIUSO',
    descripcion: 'Para maderas de 22 y de 30 mm.',
    fijas: { diametro_interior: 35, cantidad_dientes: 2 },
    notas: 'R = 4 precortadores en los de 30 mm.' },

  { valor: 'portacuchillas_replanar', etiqueta: 'PORTACUCHILLAS PARA REPLANAR',
    descripcion: 'Distintos modelos de replán cambiando los insertos.',
    fijas: { diametro_interior: 35, cantidad_dientes: 2 },
    notas: 'TD21M GB3: Ø 140, replán con 5 tipos de perfil. TD52M HB3: Ø 200, Z=2+2.' },

  { valor: 'portacuchillas_perfil_universal', etiqueta: 'PORTACUCHILLAS PERFIL UNIVERSAL',
    descripcion: 'Cuchillas intercambiables.',
    fijas: { diametro_exterior: 144, diametro_interior: 40, cantidad_dientes: 4 } },

  /*
   * Éste no sale del catálogo de Freud sino de la lista de Shark Tools, y está
   * acá porque los cuatro modelos ya existen en la base y no tenían dónde
   * clasificarse: figuraban con `geometria = 'PCD'`, que es de qué está hecho
   * el filo —diamante policristalino— y no qué pieza es.
   */
  { valor: 'cabezal_pegadora_cantos', etiqueta: 'CABEZAL PARA PEGADORA DE CANTOS',
    descripcion: 'Refilado de cantos con filo de diamante. Derecho e izquierdo.',
    fijas: { ancho_corte: 40, diametro_interior: 30, cantidad_dientes: 9 },
    notas: 'SSKP1004030: Ø 100. SSKP1254030: Ø 125. La L es izquierda y la R, derecha.' },

  { valor: 'fresa_ranurar_precortante', etiqueta: 'FRESA PARA RANURAR CON PRECORTANTE',
    descripcion: 'Ranuras finas con precortante para no astillar.',
    fijas: { diametro_exterior: 150, diametro_interior: 35, ancho_corte: 3, cantidad_dientes: 4 },
    notas: 'R = 4 precortadores. Con 3 mm de ancho queda por debajo del mínimo de la tabla de afilado.' },
]

/**
 * Los tipos que ofrece cada herramienta.
 *
 * Las que no están todavía —sierras, incisores, cuchillas, sierra sin fin— no
 * muestran el campo. Es a propósito: se van agregando a medida que se revisa el
 * catálogo de cada una, y una lista a medias sería peor que ninguna, porque el
 * vendedor elegiría "otro" en piezas que sí tienen tipo.
 */
export const TIPOS_DE_PIEZA: Partial<Record<Herramienta, TipoDePieza[]>> = {
  fresa: FRESAS,
  cabezal: CABEZALES,
}

/** Los tipos de una herramienta, o una lista vacía si todavía no se cargaron. */
export function tiposDePieza(herramienta: Herramienta | null): TipoDePieza[] {
  return herramienta ? (TIPOS_DE_PIEZA[herramienta] ?? []) : []
}

/** El tipo elegido, con todo lo que el catálogo sabe de él. */
export function tipoDePieza(
  herramienta: Herramienta | null,
  valor: string | null,
): TipoDePieza | null {
  if (!herramienta || !valor) return null
  return tiposDePieza(herramienta).find((t) => t.valor === valor) ?? null
}

/**
 * Cómo se llama UNA pieza de cada herramienta.
 *
 * Las tablas de rótulos que ya existían están todas en plural, porque nacieron
 * para "CANTIDAD DE FRESAS". Acá hace falta el singular: el renglón es una
 * pieza y el campo pregunta qué tipo es ésa, no qué tipo son.
 */
const UNA_PIEZA: Partial<Record<Herramienta, string>> = {
  fresa: 'fresa',
  cabezal: 'cabezal',
}

/** "fresa", "cabezal", o "pieza" si la herramienta todavía no tiene tipos. */
export function unaPieza(herramienta: Herramienta | null): string {
  return (herramienta && UNA_PIEZA[herramienta]) || 'pieza'
}

/**
 * Las medidas que el catálogo fija para un tipo, listas para el formulario.
 *
 * Devuelve el nombre del campo del renglón y el valor como texto argentino, que
 * es lo que los campos leen y escriben.
 *
 * El diámetro interior sale con OTRO nombre a propósito: va a
 * `diametro_interior_catalogo` y no al campo de carga. El de carga quiere decir
 * "esta pieza vino con un agujero distinto al de fábrica" —agrandado, o con
 * buje— y llenarlo con el de fábrica borra esa distinción antes de que nadie la
 * mire. Es la misma regla que usa la precarga desde un artículo del catálogo.
 */
export function medidasDelTipoDePieza(
  herramienta: Herramienta | null,
  valor: string | null,
): Record<string, string> {
  const fijas = tipoDePieza(herramienta, valor)?.fijas
  if (!fijas) return {}

  const medidas: Record<string, string> = {}
  for (const [campo, valorFijo] of Object.entries(fijas)) {
    if (valorFijo === undefined) continue
    const destino = campo === 'diametro_interior' ? 'diametro_interior_catalogo' : campo
    medidas[destino] = String(valorFijo).replace('.', ',')
  }
  return medidas
}

/** El rótulo del tipo. Si es uno viejo o desconocido, se muestra tal cual. */
export function etiquetaTipoDePieza(
  herramienta: Herramienta | null,
  valor: string | null,
): string | null {
  if (!valor) return null
  return tipoDePieza(herramienta, valor)?.etiqueta ?? valor
}
