/**
 * Comparar versiones de la app.
 *
 * Vive acá y no en cada app porque las dos puntas tienen que estar de acuerdo:
 * el panel decide qué celulares muestra como atrasados y el celular decide si
 * se deja entrar. Si cada uno comparara a su manera, el panel diría "al día"
 * sobre un teléfono que está mostrando el cartel de actualizar.
 */

/**
 * Devuelve -1, 0 o 1, como cualquier comparador.
 *
 * La comparación es numérica por tramo y no alfabética, que es donde esto se
 * rompe solo: como texto, "1.2.10" es menor que "1.2.9" —el "1" viene antes que
 * el "9"— y una app más nueva quedaría marcada como vieja.
 *
 * Los tramos que falten cuentan como cero: "1.2" y "1.2.0" son la misma
 * versión. Lo que no sea un número se lee como cero, así que un sufijo raro
 * degrada a algo comparable en vez de romper.
 */
export function compararVersiones(a: string, b: string): number {
  const na = String(a ?? '').split('.').map((n) => parseInt(n, 10) || 0)
  const nb = String(b ?? '').split('.').map((n) => parseInt(n, 10) || 0)

  for (let i = 0; i < Math.max(na.length, nb.length); i++) {
    const da = na[i] ?? 0
    const db = nb[i] ?? 0
    if (da !== db) return da < db ? -1 : 1
  }
  return 0
}

/** ¿`version` quedó por debajo de `minima`? */
export function versionAtrasada(version: string | null | undefined, minima: string): boolean {
  if (!version) return false
  return compararVersiones(version, minima) < 0
}
