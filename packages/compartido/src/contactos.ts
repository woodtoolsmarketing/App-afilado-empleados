/**
 * A quién llama el vendedor cuando necesita algo de la oficina.
 *
 * ─── Por qué los números están acá y no en la base ───────────────────────────
 *
 * Porque tienen que funcionar sin señal. El vendedor que necesita llamar a la
 * oficina muchas veces es justo el que está en un galpón sin datos, y una
 * pantalla de contactos que primero tiene que consultar el servidor es una
 * pantalla que no sirve el día que hace falta.
 *
 * Cambian una vez cada varios años, y cuando cambian se publica una versión.
 * Eso es más barato que una tabla, un panel para editarla y una caché.
 *
 * ─── Por qué el número se escribe una sola vez ───────────────────────────────
 *
 * Marcar y escribir por WhatsApp piden formatos distintos: el teléfono marca
 * `1141800506` y WhatsApp exige `5491141800506`, con el país y con el 9 que
 * llevan los celulares argentinos. Escribir los dos a mano es garantizar que
 * algún día uno quede viejo y el otro no, y el que falla —WhatsApp— falla
 * abriendo un chat con un desconocido, no con un error.
 *
 * Así que se escribe como se lee en la agenda de papel y las dos formas se
 * derivan de ahí.
 */

export interface ContactoInterno {
  /** La clave con la que la pantalla lo identifica. */
  id: string
  nombre: string
  /** Para qué se lo llama. Va debajo del nombre. */
  rol: string
  /** Como se ve escrito: "11 4180-0506". */
  legible: string
  /** Como lo marca un teléfono argentino: sin país y sin el 9. */
  paraLlamar: string
  /** Como lo pide WhatsApp: 54, el 9 de los celulares, y el número. */
  paraWhatsapp: string
}

/**
 * Arma un contacto a partir del número tal como se lee.
 *
 * Se exporta para poder probarla: la cuenta del prefijo es exactamente el tipo
 * de cosa que anda bien con los cinco números que hay hoy y se rompe con el
 * sexto que se agregue con otro formato.
 */
export function contactoInterno(
  id: string,
  nombre: string,
  rol: string,
  legible: string,
): ContactoInterno {
  const digitos = legible.replace(/\D/g, '')

  /*
   * El 9 de los celulares, venga como venga escrito el número.
   *
   * Argentina pide el 9 para hablar con un celular desde afuera del país, y
   * para WhatsApp todos los mensajes vienen de afuera.
   *
   * Antes esto era `digitos.startsWith('54') ? digitos : '549' + digitos`, o
   * sea: un número escrito CON el país se respetaba tal cual. Escrito
   * "54 11 4180-0506" salía `541141800506`, sin el 9 — que es justamente el
   * número que WhatsApp no encuentra. Ninguno de los cinco de hoy está escrito
   * así, con lo cual la rama nunca se ejecutó y el error esperaba al sexto.
   *
   * Ahora se arma en dos pasos y el resultado es el mismo escriba quien
   * escriba: se le pone el país si no lo tiene, y después el 9 si no lo tiene.
   *
   *   "11 4180-0506"      → 549 11 4180-0506
   *   "54 11 4180-0506"   → 549 11 4180-0506
   *   "549 11 4180-0506"  → 549 11 4180-0506
   */
  const conPais = digitos.startsWith('54') ? digitos : `54${digitos}`
  const paraWhatsapp = conPais.startsWith('549') ? conPais : `549${conPais.slice(2)}`

  /*
   * Y para MARCAR, al revés: sin país y sin el 9.
   *
   * El teléfono del vendedor está en Argentina, así que un `tel:` con el país
   * adelante no disca. Salía así por el mismo motivo: `paraLlamar` era
   * `digitos` pelado, y con el país escrito se llevaba el 54 puesto.
   */
  const paraLlamar = conPais.startsWith('549') ? conPais.slice(3) : conPais.slice(2)

  return { id, nombre, rol, legible, paraLlamar, paraWhatsapp }
}

/** Con quién se comunica el vendedor desde la calle. */
export const CONTACTOS_INTERNOS: ContactoInterno[] = [
  contactoInterno('gerardo', 'Gerardo Desiderio', 'Dirección', '11 4180-0506'),
  contactoInterno('veronica', 'Verónica Desiderio', 'Dirección', '11 4526-0205'),
  contactoInterno('ariel', 'Ariel Sosa', 'Ventas', '11 3481-1771'),
  contactoInterno('leticia', 'Leticia', 'Administración', '11 3097-6000'),
  contactoInterno('ana', 'Ana', 'Administración', '11 3400-5566'),
]

/**
 * El enlace para abrir el chat de WhatsApp.
 *
 * `wa.me` y no `whatsapp://`: el esquema propio falla en seco cuando la app no
 * está instalada, y `wa.me` en ese caso abre el navegador con la invitación a
 * instalarla. Es una diferencia entre "no pasó nada" y "ah, no lo tengo".
 */
export function enlaceWhatsapp(contacto: ContactoInterno, mensaje?: string): string {
  const texto = mensaje ? `?text=${encodeURIComponent(mensaje)}` : ''
  return `https://wa.me/${contacto.paraWhatsapp}${texto}`
}

/** El enlace para que el teléfono marque. */
export function enlaceLlamada(contacto: ContactoInterno): string {
  return `tel:${contacto.paraLlamar}`
}
