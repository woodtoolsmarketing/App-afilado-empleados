/**
 * Lectura del catálogo de precios.
 *
 * Las listas del Gestión Comercial traen las características de la herramienta
 * **adentro de la descripción**, no en columnas:
 *
 *   `1100 S.C. D=300 B=3.2/2.2 d=30 Z=72`
 *    ─────      ───   ───────    ────  ────
 *    modelo     Ø ext  ancho de   Ø int  dientes
 *                      corte / cuerpo
 *
 * Este módulo las saca de ahí. Sirve para dos cosas que el vendedor pide todo
 * el tiempo: ver de un vistazo si el código que encontró es la herramienta que
 * tiene en la mano, y completar solo el renglón de la nota —ancho de corte,
 * diámetro y cantidad de dientes— en vez de copiarlos a mano de la lista.
 *
 * Se lee acá y no en una migración porque las descripciones son irregulares y
 * esto va a necesitar retoques; una función que se puede correr sobre los 1.315
 * artículos y medir cuántos entiende es más fácil de arreglar que una columna
 * ya escrita en la base.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Convenciones de la lista
//
// `D` mayúscula es el diámetro exterior y `d` minúscula el agujero: la única
// diferencia entre los dos es la caja de la letra, así que todas las
// expresiones de acá son sensibles a mayúsculas a propósito.
// ─────────────────────────────────────────────────────────────────────────────

/** Un número de la lista: `3.2`, `3,2`, `300`. Se devuelve con coma. */
const NUMERO = '([0-9]+(?:[.,][0-9]+)?)'

const DIAMETRO_EXTERIOR = new RegExp(`\\bD\\s*=?\\s*${NUMERO}`)
/** `d=30`, `d 30`, `d20`. Sin \\b delante: viene pegado a un punto en "S.C.d=30". */
const DIAMETRO_INTERIOR = new RegExp(`(?:^|[^A-Za-z])d\\s*=?\\s*${NUMERO}`)
const ANCHO_CORTE_B = new RegExp(`\\bB\\s*=?\\s*${NUMERO}`)
/**
 * El ancho de corte sin `B`: un decimal suelto justo después del diámetro.
 * Sale de `AA3 S.C. D=100 3.2 d=20 Z=24`, que es como está escrita media lista.
 * Se exige decimal para no confundirlo con el modelo o con otra medida entera.
 */
const ANCHO_CORTE_SUELTO = new RegExp(`\\bD\\s*=?\\s*[0-9]+(?:[.,][0-9]+)?\\s+([0-9]+[.,][0-9]+)`)
/** `Z=72`, `Z 24`, `Z12+12`, `Z=30+4`. Los sumandos se suman. */
const DIENTES = /\bZ\s*=?\s*([0-9]+(?:\s*\+\s*[0-9]+)*)/
/** `12x12x1.5`, `54.5x29x3` — largo × ancho × espesor de un inserto o cuchilla. */
const TRES_MEDIDAS = new RegExp(`\\b${NUMERO}\\s*[xX]\\s*${NUMERO}\\s*[xX]\\s*${NUMERO}`)
/** `25x30` — sólo dos, cuando no hay espesor. */
const DOS_MEDIDAS = new RegExp(`\\b${NUMERO}\\s*[xX]\\s*${NUMERO}(?![\\s]*[xX])`)

export interface CaracteristicasArticulo {
  /** Ø exterior en mm. */
  diametro_exterior?: string
  /** Ø del agujero en mm. */
  diametro_interior?: string
  /** Ancho de corte (el diente), en mm. */
  ancho_corte?: string
  /** Cantidad de dientes, ya sumados los `12+12`. */
  dientes?: string
  largo?: string
  ancho?: string
  espesor?: string
}

/** Deja el número con coma decimal, que es como se escribe en la nota. */
function aComa(n: string): string {
  return n.replace('.', ',')
}

function primerGrupo(re: RegExp, texto: string): string | undefined {
  const m = re.exec(texto)
  return m ? aComa(m[1]) : undefined
}

/**
 * Las características que se pueden leer de un artículo del catálogo.
 *
 * Lo que no se entiende no se inventa: queda sin la clave. Un ancho de corte
 * adivinado sale más caro que uno vacío, porque de él dependen el código de
 * cómputo y el precio.
 */
export function caracteristicasDeArticulo(
  descripcion: string | null | undefined,
  medida?: string | null,
): CaracteristicasArticulo {
  const texto = `${descripcion ?? ''} ${medida ?? ''}`.trim()
  if (!texto) return {}

  const salida: CaracteristicasArticulo = {}

  const dExt = primerGrupo(DIAMETRO_EXTERIOR, texto)
  if (dExt) salida.diametro_exterior = dExt

  const dInt = primerGrupo(DIAMETRO_INTERIOR, texto)
  if (dInt) salida.diametro_interior = dInt

  // `B=3.2/2.2` es corte/cuerpo: manda el primero, que es el que se afila.
  const ancho = primerGrupo(ANCHO_CORTE_B, texto) ?? primerGrupo(ANCHO_CORTE_SUELTO, texto)
  if (ancho) salida.ancho_corte = ancho

  const z = DIENTES.exec(texto)
  if (z) {
    // `Z=30+4` son 30 dientes más 4 limpiadores: al taller le importa el total.
    const total = z[1]
      .split('+')
      .map((p) => Number(p.trim()))
      .filter((n) => Number.isFinite(n))
      .reduce((a, b) => a + b, 0)
    if (total > 0) salida.dientes = String(total)
  }

  // Las medidas de placa (`24x12x1.5`) sólo se leen si no hubo diámetro: en una
  // sierra, un `3.2/2.2` no es un largo por ancho.
  if (!salida.diametro_exterior) {
    const tres = TRES_MEDIDAS.exec(texto)
    if (tres) {
      salida.largo = aComa(tres[1])
      salida.ancho = aComa(tres[2])
      salida.espesor = aComa(tres[3])
    } else {
      const dos = DOS_MEDIDAS.exec(texto)
      if (dos) {
        salida.largo = aComa(dos[1])
        salida.ancho = aComa(dos[2])
      }
    }
  }

  return salida
}

/** Cómo se nombra cada característica en el resumen de una línea. */
const ROTULO: Array<[keyof CaracteristicasArticulo, string, string]> = [
  ['diametro_exterior', 'Ø', ' mm'],
  ['ancho_corte', 'corte', ' mm'],
  ['diametro_interior', 'agujero', ' mm'],
  ['dientes', 'Z', ''],
  ['largo', 'largo', ' mm'],
  ['ancho', 'ancho', ' mm'],
  ['espesor', 'esp', ' mm'],
]

/** `Ø 300 mm · corte 3,2 mm · agujero 30 mm · Z 72` — para la lista de resultados. */
export function resumenCaracteristicas(c: CaracteristicasArticulo): string {
  return ROTULO.filter(([clave]) => c[clave])
    .map(([clave, rotulo, unidad]) => `${rotulo} ${c[clave]}${unidad}`)
    .join(' · ')
}

/** ¿Se entendió algo de la descripción? */
export function tieneCaracteristicas(c: CaracteristicasArticulo): boolean {
  return Object.keys(c).length > 0
}

// ─────────────────────────────────────────────────────────────────────────────
// Moneda
// ─────────────────────────────────────────────────────────────────────────────

export type Moneda = 'ARS' | 'USD'

/**
 * `U$S 116,77` o `$ 1.234,56`.
 *
 * Los dólares van con su símbolo SIEMPRE, también en la nota impresa: media
 * lista está en dólares y un número sin moneda al lado de otro en pesos es la
 * forma más rápida de cobrar mal.
 */
export function formatearMoneda(valor: number | null | undefined, moneda: Moneda = 'ARS'): string {
  if (valor === null || valor === undefined || !Number.isFinite(valor)) return ''
  const n = valor.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return moneda === 'USD' ? `U$S ${n}` : `$ ${n}`
}

/** Pasa a pesos lo que esté en dólares. Con cambio 0 devuelve el valor tal cual. */
export function aPesos(valor: number, moneda: Moneda, tipoCambio: number): number {
  if (moneda !== 'USD') return valor
  if (!Number.isFinite(tipoCambio) || tipoCambio <= 0) return valor
  return Math.round(valor * tipoCambio * 100) / 100
}
