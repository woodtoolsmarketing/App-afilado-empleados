import type { Herramienta } from './notas-pedido'

/**
 * El mecanizado del agujero: achicar o agrandar el diámetro interior.
 *
 * ─── Qué es ───────────────────────────────────────────────────────────────────
 *
 * El agujero de una sierra o una fresa no siempre coincide con el eje de la
 * máquina del cliente. Cuando el eje es más chico que el agujero, se le pone un
 * BUJE reductor y el agujero queda más chico. Cuando el eje es más grande, hay
 * que AGRANDAR el agujero a máquina. Es un trabajo aparte del afilado, con su
 * propio precio de lista, y hasta ahora no había forma de cargarlo: entraba
 * escondido como una observación, sin código ni importe.
 *
 * ─── Cómo se elige el código ───────────────────────────────────────────────────
 *
 * Igual que el afilado de mecha o de cuchilla: el código no sale de una medida
 * sino de DOS respuestas.
 *
 *   1. QUÉ herramienta es   → sierra o fresa (lo único que se habilita)
 *   2. QUÉ operación es     → buje (achicar) o agrandado (agrandar)
 *
 * La operación no se pregunta: se deduce de comparar el agujero que la pieza
 * tiene hoy con el que hay que dejarle. Si el destino es más chico, es un buje;
 * si es más grande, se agranda. Ver `operacionMecanizado`.
 *
 *   sierra + buje       → 6105  (BUJE DE S.C.)
 *   sierra + agrandado  → 6103  (AGRANDAR DIAMETRO S.C.)
 *   fresa  + buje       → 7903  (BUJES DE FRESAS COMUN)
 *   fresa  + agrandado  → 7902  (AGRANDAR DIAMETRO INT. FRESA)
 *
 * Los cuatro ya están en el catálogo (familia `afilado_general`, precio fijo en
 * pesos, sin rango de medida). El precio es PLANO por unidad —no por diente ni
 * por milímetro— y sale de la lista por el código, como el de la mecha. Este
 * módulo decide el código; el importe lo trae `codigos_mecanizado` del catálogo.
 *
 * ─── De dónde sale esto ─────────────────────────────────────────────────────────
 *
 * · LISTA PRECIO AFIL Y REP del 02/06/2026 (6103, 6105, de sierra).
 * · LISTA PRECIO AFIL REP FRESAS Y SC del 09/09/2026 (7902, 7903, de fresa).
 */

/** Las dos herramientas que admiten mecanizado. El resto no lo ofrece. */
export const HERRAMIENTAS_MECANIZADO: Herramienta[] = ['sierra', 'fresa']

/** Qué le pasa al agujero. */
export type OperacionMecanizado = 'buje' | 'agrandado'

export const ETIQUETA_OPERACION_MECANIZADO: Record<OperacionMecanizado, string> = {
  buje: 'ACHICAR (buje reductor)',
  agrandado: 'AGRANDAR',
}

/** Una línea que diga qué significa cada operación, para leerla sin dudar. */
export const QUE_HACE_LA_OPERACION: Record<OperacionMecanizado, string> = {
  buje: 'El agujero queda más chico: se le pone un buje reductor',
  agrandado: 'El agujero queda más grande: se agranda a máquina',
}

/**
 * Qué operación es, comparando el agujero de hoy con el que hay que dejar.
 *
 * `null` cuando todavía no se puede decidir: falta alguno de los dos, o son
 * iguales —y un mecanizado que no cambia la medida no es un trabajo—. Ahí la
 * pantalla no propone código, porque no hay operación.
 *
 * Más chico es BUJE (se reduce el agujero con un casquillo), más grande es
 * AGRANDADO (se saca material). Es la misma distinción que ya hacía
 * `ajusteDeAgujero` para avisar en el afilado que la pieza venía modificada.
 */
export function operacionMecanizado(
  interiorActual: number | null,
  interiorDestino: number | null,
): OperacionMecanizado | null {
  if (interiorActual === null || interiorDestino === null) return null
  if (!Number.isFinite(interiorActual) || !Number.isFinite(interiorDestino)) return null
  if (interiorActual <= 0 || interiorDestino <= 0) return null
  if (interiorDestino < interiorActual) return 'buje'
  if (interiorDestino > interiorActual) return 'agrandado'
  return null
}

/**
 * Qué código de cómputo le toca a este mecanizado.
 *
 * `null` cuando falta alguna de las dos respuestas, o cuando la herramienta no
 * admite mecanizado (sólo sierra y fresa). Ahí el renglón queda sin código a
 * propósito, y la pantalla lo dice en vez de poner uno de otra cosa.
 */
export function codigoMecanizado(
  herramienta: Herramienta | null,
  operacion: OperacionMecanizado | null,
): string | null {
  if (!herramienta || !operacion) return null
  if (herramienta === 'sierra') return operacion === 'buje' ? '6105' : '6103'
  if (herramienta === 'fresa') return operacion === 'buje' ? '7903' : '7902'
  return null
}

/** Los cuatro códigos del mecanizado, para pedirle los precios al catálogo. */
export const CODIGOS_MECANIZADO: string[] = ['6105', '6103', '7903', '7902']

/**
 * Lo que cuesta el mecanizado, en pesos.
 *
 * El precio de la lista es POR PIEZA: achicar dos sierras son dos veces el
 * precio. Es un precio plano, no por diente ni por milímetro —la cantidad de
 * dientes de la pieza es un dato del taller, no multiplica—. Idéntico en forma
 * al afilado de mecha.
 */
export function totalMecanizado(precioPorPieza: number, unidades: number): number {
  if (!Number.isFinite(precioPorPieza) || precioPorPieza <= 0) return 0
  const cuantas = Number.isFinite(unidades) && unidades > 0 ? unidades : 1
  return Math.round(precioPorPieza * cuantas * 100) / 100
}
