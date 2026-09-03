/**
 * El buscador de clientes del panel, con las mismas reglas que el del teléfono.
 *
 * El móvil llama a `buscar_clientes`, la función de Postgres, y por eso encuentra
 * sin acentos y con las palabras en cualquier orden. El panel no puede llamarla:
 * la función tiene `where c.activo` clavado adentro, y esta pantalla es
 * justamente la que da de baja y de alta clientes —si el cliente que acabás de
 * desactivar desaparece de acá, no queda dónde reactivarlo—. Además el panel
 * necesita traer las direcciones anidadas, que la función no devuelve.
 *
 * Así que en vez de llamarla, se copia su criterio contra la columna que ella
 * misma usa: `clientes.busqueda_plana`, que Postgres mantiene sola con la razón
 * social, el nombre de fantasía y el código en minúsculas, sin acentos y sin
 * puntuación.
 *
 * Lo que había antes era un `ilike` crudo con el término entero:
 *
 *     razon_social.ilike.%ACUÑA%
 *
 * y eso exige que lo tipeado aparezca literal, contiguo y con los acentos donde
 * la oficina los puso. Medido contra el padrón: 238 clientes tienen tilde o Ñ en
 * el nombre y 160 la tienen en la PRIMERA palabra, así que el primer intento del
 * operador no devolvía nada.
 */

/** Lo mínimo que se le pide a una consulta de PostgREST para poder filtrarla. */
type ConsultaFiltrable = { or: (filtros: string) => unknown }

/**
 * Deja el texto como está guardado en `clientes.busqueda_plana`.
 *
 * Tiene que dar exactamente lo mismo que `interno.normalizar_busqueda` seguida
 * del borrado de puntuación. Si un día cambia una, cambia la otra.
 */
export function normalizarBusqueda(texto: string): string {
  return (
    texto
      .toLowerCase()
      .normalize('NFD')
      // Saca los acentos, que el NFD dejó como marcas sueltas. La Ñ queda "n",
      // igual que en el `translate` de la base.
      .replace(/[̀-ͯ]/g, '')
      // Todo lo que no sea letra, número o espacio se BORRA, no se reemplaza por
      // espacio: "S.R.L." tiene que quedar "srl" para coincidir con el que la
      // escribió pegada.
      .replace(/[^a-z0-9 ]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  )
}

/**
 * Parte el texto en las palabras que hay que exigir.
 *
 * Se piden TODAS, en cualquier orden y repartidas como sea entre razón social,
 * nombre de fantasía y código: el que escribe "DAVID ACUÑA" tiene que encontrar
 * a "ACUÑA DAVID EZEQUIEL".
 */
export function palabrasDeBusqueda(texto: string): string[] {
  return normalizarBusqueda(texto).split(' ').filter(Boolean)
}

/**
 * Le cuelga a la consulta una condición por palabra.
 *
 * Cada `.or()` encadenado se combina con Y contra los anteriores, así que el
 * resultado es "todas las palabras", aunque cada una pueda aparecer en el nombre
 * o en alguno de los campos extra que pida la pantalla.
 *
 * `campos` son columnas que se comparan con la palabra sin columna espejo:
 * localidad, CUIT. Ahí sigue valiendo el `ilike` de siempre, que para números y
 * nombres de partido alcanza.
 */
export function filtrarPorPalabras<T extends ConsultaFiltrable>(
  consulta: T,
  termino: string,
  campos: string[] = [],
): T {
  let salida = consulta
  for (const palabra of palabrasDeBusqueda(termino)) {
    // La palabra ya viene sin comas, comillas ni paréntesis —los borró la
    // normalización—, así que no puede partir el `or` de PostgREST en dos
    // condiciones inválidas ni colarse como comodín de un LIKE.
    const condiciones = [
      `busqueda_plana.ilike.%${palabra}%`,
      ...campos.map((c) => `${c}.ilike.%${palabra}%`),
    ]
    salida = salida.or(condiciones.join(',')) as T
  }
  return salida
}
