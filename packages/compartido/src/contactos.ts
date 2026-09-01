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
   * El 9 de los celulares.
   *
   * Argentina lo pide para hablar con un celular desde afuera del país, y para
   * WhatsApp todos los mensajes vienen de afuera. Si el número ya viniera
   * escrito con país —empieza con 54— se respeta lo que haya; si no, se le
   * pone 549 adelante, que es lo que corresponde a un número de diez dígitos
   * con característica de área.
   */
  const paraWhatsapp = digitos.startsWith('54') ? digitos : `549${digitos}`

  return { id, nombre, rol, legible, paraLlamar: digitos, paraWhatsapp }
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
