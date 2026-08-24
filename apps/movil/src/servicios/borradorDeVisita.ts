import type { FormularioVisita } from '@woodtools/compartido'

/**
 * Lo que el vendedor lleva cargado de una visita, mientras se va a otra
 * pantalla y vuelve.
 *
 * ── Por qué hace falta ──────────────────────────────────────────────────────
 *
 * El formulario de la visita vive en el estado del componente. Desde que se
 * puede saltar a hacer la nota de pedido en el medio de la carga, ese estado se
 * pierde: React desmonta la pantalla al navegar. El vendedor volvía y se
 * encontraba los tildes en cero, el nombre de quien lo atendió vacío y —peor—
 * la observación que había dictado, borrada.
 *
 * ── Por qué en memoria y no en disco ───────────────────────────────────────
 *
 * Porque lo que hay que sobrevivir es una navegación, no un cierre de app. Un
 * borrador en disco tiene el problema contrario: sobrevive demasiado, y al día
 * siguiente le devuelve al vendedor los tildes de la visita de ayer sobre un
 * cliente distinto. Si la app se cierra, la visita se vuelve a cargar; son
 * cuatro tildes y una línea.
 *
 * Se guarda por parada: dos visitas a medio cargar no se pisan entre sí.
 */
interface BorradorDeVisita {
  form: FormularioVisita
  /**
   * Si la observación la escribió una persona.
   *
   * Viaja con el borrador y no se recalcula al volver: sin esto, la pantalla
   * arrancaba creyendo que la observación era suya y le pasaba el trapo a lo
   * que el vendedor había dictado antes de irse a hacer la nota.
   */
  escritaAMano: boolean
}

const borradores = new Map<string, BorradorDeVisita>()

export function guardarBorradorDeVisita(
  paradaId: string,
  form: FormularioVisita,
  escritaAMano: boolean,
): void {
  borradores.set(paradaId, { form: { ...form }, escritaAMano })
}

export function tomarBorradorDeVisita(paradaId: string): BorradorDeVisita | null {
  const guardado = borradores.get(paradaId)
  if (!guardado) return null
  // Se consume: si se dejara, volver a entrar a una visita ya registrada
  // reviviría lo que se había cargado antes de guardarla.
  borradores.delete(paradaId)
  return guardado
}

export function olvidarBorradorDeVisita(paradaId: string): void {
  borradores.delete(paradaId)
}
