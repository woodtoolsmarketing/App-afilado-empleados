import type { TipoMecha } from './notas-pedido'

/**
 * El afilado de mechas.
 *
 * ─── Lo que estaba pasando ───────────────────────────────────────────────────
 *
 * El renglón de afilado de una mecha salía cotizado con el código y el precio
 * de COMPRAR una mecha nueva. El selector de modelo escribía el código de
 * producto —`MPD04`— en `codigos_computo` y el precio de lista en `precio`, y
 * de ahí salía el total. Afilar una pasante de 4 mm se cobraba $ 31.406,10, que
 * es lo que sale la mecha, en vez de $ 10.528, que es lo que sale afilarla.
 *
 * Ninguno de los códigos de afilado de la lista era alcanzable desde el
 * formulario: no hay ninguna pantalla que los ofrezca.
 *
 * ─── Cómo se elige el código ─────────────────────────────────────────────────
 *
 * No por medida. La lista de afilado no tiene un solo rango de diámetro: el
 * código sale de DOS respuestas, y de una tercera en las integrales.
 *
 *   1. QUÉ TIPO de mecha es          → ya se pregunta (`tipo_mecha`)
 *   2. DE QUÉ MATERIAL es            → HSS o metal duro
 *   3. CUÁNTOS FILOS tiene           → sólo en las integrales: 2, 3 ó 4
 *
 * El material es el que parte la tabla en dos, y es el que la app no preguntaba
 * en ninguna parte. En HSS, afilar cualquier mecha cuesta lo mismo. En metal
 * duro, el precio va de $ 10.528 a $ 47.480 según el tipo.
 *
 * Es el mismo mecanismo que ya usa el afilado de cuchillas —tres respuestas
 * eligen uno de seis códigos— y está copiado de ahí a propósito: el vendedor ya
 * lo conoce, y no hacía falta inventar otro.
 *
 * ─── De dónde sale esto ──────────────────────────────────────────────────────
 *
 * · Catálogo General de WoodTools, página 23, panel «Mechas». La bajada dice
 *   textualmente: «Toda la línea de mechas en HSS y HM para bisagra, agujeros
 *   ciegos, pasantes, malletadoras y mandriles de cabo cónico y recto». De ahí
 *   salen los dos materiales y el tipo `malletadora`, que la app no tenía.
 *
 * · LISTA PRECIO AFIL MEHAS del 02/06/2026, sub-rubros 030 y 031.
 */

/**
 * De qué está hecho el filo.
 *
 * `hm` (metal duro) y «widia» son lo mismo que `md`: el catálogo lo escribe HM,
 * la lista de precios M.D. y el taller dice widia. Se guarda un solo valor y el
 * rótulo lo dice de las dos maneras, para que el vendedor lo reconozca venga
 * como venga.
 */
export type MaterialMecha = 'hss' | 'md'

export const ETIQUETA_MATERIAL_MECHA: Record<MaterialMecha, string> = {
  hss: 'HSS (acero rápido)',
  md: 'M.D. / HM (metal duro o widia)',
}

/** Los filos que la lista contempla para una mecha integral. */
export const DIENTES_MECHA_INTEGRAL = [2, 3, 4] as const

/**
 * Los tipos que se afilan con la tabla de las integrales.
 *
 * Las tres son mechas integrales de metal duro: cambia para qué sirve cada una
 * —la de compresión es una nesting Z=2+2, la de caja de cerradura es una
 * integral larga— pero el afilado es el mismo trabajo y la lista las cobra por
 * la misma tabla, que va por cantidad de filos.
 */
export const MECHAS_INTEGRALES: TipoMecha[] = ['integral_widia', 'compresion', 'caja_cerradura']

/**
 * Las mechas cuyo material no hace falta preguntar, porque el tipo ya lo dice.
 *
 * Medido sobre las 166 filas de la lista de producto:
 *
 *   · Las 20 del sub-rubro 303 son METAL DURO. El sub-rubro se llama "Mechas
 *     Integrales de Widia" y ninguna dice HSS: una integral de widia de acero
 *     rápido no existe. Preguntarlo habilitaría elegir HSS y cotizar $ 8.064
 *     un trabajo de $ 39.764,50.
 *
 *   · Las 5 del sub-rubro 307 son HSS, y lo dicen las cinco en la descripción
 *     («MECHA PARA BARRENO Ø=18mm HSS»). Ninguna es de metal duro, y la lista
 *     de afilado tampoco tiene precio de barreno en metal duro.
 *
 * En las pasantes, las ciegas y las bisagras SÍ hay de las dos —MCD03 y MCI03
 * son HS y sus vecinas de la misma familia son M.D.— así que ahí se pregunta.
 * No se deduce de la descripción ni del prefijo del código: los pares espejo
 * demuestran que no se puede.
 */
const MATERIAL_QUE_YA_SE_SABE: Partial<Record<TipoMecha, MaterialMecha>> = {
  integral_widia: 'md',
  compresion: 'md',
  caja_cerradura: 'md',
  barreno: 'hss',
}

/**
 * El material que el tipo ya determina, o `null` si hay que preguntarlo.
 *
 * Se usa para dos cosas: no hacer una pregunta cuya respuesta ya se sabe, y no
 * ofrecer la opción equivocada en los tipos donde una de las dos no existe.
 */
export function materialFijoDeLaMecha(tipo: TipoMecha | null): MaterialMecha | null {
  return (tipo && MATERIAL_QUE_YA_SE_SABE[tipo]) ?? null
}

/**
 * Qué código de afilado le toca a una mecha.
 *
 * `null` cuando la lista no tiene precio para esa combinación, que es un caso
 * real y no un error: una mecha de barreno de metal duro no figura en la tabla.
 * Ahí el vendedor pone el código y el importe a mano, y la pantalla se lo dice
 * en vez de proponerle un código de otra cosa.
 */
export function codigoAfiladoMecha(
  tipo: TipoMecha | null,
  material: MaterialMecha | null,
  dientes: number | null,
): string | null {
  if (!tipo || !material) return null

  /*
   * En HSS no importa qué mecha sea: es un solo precio para toda la línea.
   *
   * La lista trae DOS códigos con el mismo importe, `MEHSS010AF` («AFILADO DE
   * MECHA HSS») y `MEHSSAF` («AFILADO MECHA ASS»). Se usa el primero, que es el
   * que está bien escrito; el otro parece el mismo con una errata de tipeo y
   * quedó anotado para que la oficina lo confirme.
   */
  if (material === 'hss') return 'MEHSS010AF'

  if (MECHAS_INTEGRALES.includes(tipo)) {
    switch (dientes) {
      case 2: return '10101'
      case 3: return '10102'
      case 4: return '10103'
      default: return null
    }
  }

  switch (tipo) {
    case 'ciega': return 'MEMD005AF'
    case 'pasante': return 'MEMD010AF'
    case 'bisagra': return 'MEMDBIAF'
    case 'malletadora': return 'MEMDMAAF'
    // Barreno, practiwall y plegado no están en la tabla de metal duro. No se
    // devuelve un código parecido: cobrar el de otra mecha es peor que decir
    // que falta.
    default: return null
  }
}

/**
 * ¿Hay que preguntarle cuántos filos tiene?
 *
 * Sólo en las integrales de metal duro, que es donde el número cambia el
 * precio: de $ 34.423 con dos filos a $ 47.480 con cuatro.
 */
export function pideDientesLaMecha(
  tipo: TipoMecha | null,
  material: MaterialMecha | null,
): boolean {
  const cual = material ?? materialFijoDeLaMecha(tipo)
  return cual === 'md' && !!tipo && MECHAS_INTEGRALES.includes(tipo)
}

/**
 * Lo que cuesta afilar, en pesos.
 *
 * El precio de la lista es POR MECHA, no por filo ni por milímetro: afilar
 * cuatro pasantes son cuatro veces $ 10.528. Es la diferencia con las
 * cuchillas, que se cobran por cada 100 mm de largo.
 */
export function totalAfiladoMecha(precioPorMecha: number, unidades: number): number {
  if (!Number.isFinite(precioPorMecha) || precioPorMecha <= 0) return 0
  const cuantas = Number.isFinite(unidades) && unidades > 0 ? unidades : 1
  return Math.round(precioPorMecha * cuantas * 100) / 100
}
