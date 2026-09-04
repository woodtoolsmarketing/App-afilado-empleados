import type {
  Cliente,
  ClienteBuscado,
  FormularioClienteNuevo,
  FormularioDestinoNuevo,
  ParadaCompleta,
  PrioridadParada,
} from '@woodtools/compartido'

import { supabase } from '../nucleo/supabase'
import type { DireccionResuelta } from './mapas'

/**
 * Búsqueda y alta de clientes desde la calle.
 *
 * El buscador acepta indistintamente el código o la razón social: es la misma
 * consulta, porque el vendedor a veces se acuerda del número y a veces del
 * nombre, y obligarlo a elegir de antemano sería trabajo suyo para comodidad
 * nuestra.
 */

/**
 * Cuánto se espera después de la última tecla antes de salir a buscar.
 *
 * Eran 300 ms en cada pantalla por separado. Subió a 450 y vive acá, con la
 * búsqueda, por una cuenta simple: un código de cliente son cuatro o cinco
 * dígitos, y con 300 ms el vendedor que tipea a velocidad normal dispara TRES o
 * CUATRO búsquedas para llegar al mismo cliente. Cada una es un viaje de ida y
 * vuelta por la red del celular parado en un taller, que es lo que de verdad se
 * siente lento: el servidor tarda unos 45 ms.
 *
 * No se sube más porque el que escribe el nombre sí quiere ver la lista
 * mientras escribe. Para el que sabe el código está la tecla "Listo", que busca
 * en el acto y no espera nada.
 */
export const ESPERA_TECLEO = 450

/**
 * Cuántos clientes devuelve una búsqueda.
 *
 * Se exporta porque la pantalla lo necesita para saber si la lista quedó
 * cortada y decirlo. Con tres dígitos de un código de cinco hay más de cien
 * candidatos: mostrar los primeros sin avisar es lo que hace que el vendedor
 * crea que su cliente no está cargado.
 *
 * Eran quince, y quince le quedaban cortos al que escribe una palabra del MEDIO
 * del nombre: buscando "TORRES", los cuarenta apellidos Torres se comen la
 * lista antes de llegar a CARPINTERIA TORRES. La función admite hasta 50; 25 es
 * el punto donde entra ese caso sin volver la lista una pared de scroll.
 */
export const LIMITE_CLIENTES = 25

/**
 * Lo que ya se preguntó hace un rato, para no volver a preguntarlo.
 *
 * Buscar un cliente es un viaje de ida y vuelta por la red del celular, y el
 * vendedor repite la misma búsqueda todo el tiempo sin darse cuenta: borra una
 * letra y la vuelve a escribir, vuelve al paso 1 a mirar el cliente, carga dos
 * notas seguidas al mismo taller. Cada una de esas era otro viaje.
 *
 * Un minuto de memoria alcanza para todo eso y es corto de sobra para lo que
 * puede cambiar: la ficha de un cliente no se edita mientras el vendedor está
 * parado adelante suyo. Es memoria, no base de datos: se pierde al cerrar la
 * app, y así tiene que ser.
 */
const VIDA_DEL_RECUERDO = 60_000
const recordadas = new Map<string, { cuando: number; clientes: ClienteBuscado[] }>()

/** Se olvida todo. Va después de crear un cliente: la lista quedó vieja. */
export function olvidarBusquedasDeClientes(): void {
  recordadas.clear()
}

export async function buscarClientes(
  texto: string,
  limite = LIMITE_CLIENTES,
): Promise<ClienteBuscado[]> {
  const clave = `${limite}|${texto.trim().toLowerCase()}`
  const recuerdo = recordadas.get(clave)
  if (recuerdo && Date.now() - recuerdo.cuando < VIDA_DEL_RECUERDO) return recuerdo.clientes

  const { data, error } = await supabase.rpc('buscar_clientes', {
    p_texto: texto,
    p_limite: limite,
  })

  if (error) throw error
  const clientes = (data ?? []) as ClienteBuscado[]

  // Sólo se guarda lo que salió bien: recordar un error dejaría al vendedor sin
  // poder reintentar durante un minuto, que es justo cuando quiere reintentar.
  recordadas.set(clave, { cuando: Date.now(), clientes })
  // El padrón tiene 16.496 clientes y esto vive en memoria del teléfono: se
  // corta antes de que crezca. Cien búsquedas son las de una jornada entera.
  if (recordadas.size > 100) {
    const masVieja = recordadas.keys().next().value
    if (masVieja !== undefined) recordadas.delete(masVieja)
  }
  return clientes
}

/**
 * Geolocaliza un cliente del padrón que sólo tiene el domicilio en texto.
 *
 * Los clientes importados del Gestión traen calle, localidad y CP, pero
 * ninguna coordenada, y sin coordenadas no entran a un recorrido. Esto lo
 * resuelve desde la calle: el vendedor confirma la dirección contra las
 * sugerencias de Google y el cliente queda ubicado para siempre, no sólo para
 * la visita de hoy.
 */
export async function ubicarCliente(params: {
  clienteId: string
  direccion: DireccionResuelta
}): Promise<{ direccion_id: string; lat: number; lng: number; localidad: string | null }> {
  const { direccion } = params

  const { data, error } = await supabase.rpc('ubicar_cliente', {
    p_cliente_id: params.clienteId,
    p_direccion_formateada: direccion.direccion_formateada,
    p_lat: direccion.lat,
    p_lng: direccion.lng,
    p_codigo_postal: direccion.codigo_postal,
    p_google_place_id: direccion.google_place_id,
    p_localidad: direccion.localidad,
    p_provincia: direccion.provincia,
  })

  if (error) {
    if (error.code === '23514') throw new Error(error.message)
    throw error
  }

  /**
   * Que haya venido `data` no quiere decir que se haya guardado.
   *
   * La RPC devuelve una fila de `direcciones`. Si adentro no pudo escribir,
   * devuelve un composite NULL, y PostgREST no lo traduce a "nada": lo traduce
   * a UNA fila con todas las columnas en NULL, con `error` en null. Confiar en
   * `error` solo dejó al vendedor mirando un cartel verde mientras el cliente
   * seguía sin ubicar — y sin ubicar no entra al recorrido.
   *
   * La función ya levanta excepción en ese caso (migración 20260821192454),
   * así que esto es el segundo cerrojo: cubre cualquier vía que la esquive.
   */
  const fila = data as { id: string | null; lat: number | null; lng: number | null; localidad: string | null } | null
  if (!fila || fila.id === null || fila.lat === null || fila.lng === null) {
    throw new Error('No pudimos guardar la ubicación del cliente. Avisá a la oficina.')
  }

  /**
   * Ubicar un cliente le cambia la ficha, y el buscador la tiene guardada.
   *
   * `buscar_clientes` devuelve la dirección del cliente —`direccion_id`, lat,
   * lng y localidad salen de `direcciones`— y esto acaba de escribir justo esa
   * fila. Sin olvidar lo buscado, el vendedor ubica el cliente y si vuelve a
   * buscarlo dentro del minuto le sale otra vez la fila vieja, con la pastilla
   * roja SIN UBICAR sobre un cliente que ya está ubicado. Peor: sin
   * `direccion_id` no se lo puede agregar al recorrido.
   */
  olvidarBusquedasDeClientes()

  return { direccion_id: fila.id, lat: fila.lat, lng: fila.lng, localidad: fila.localidad }
}

/** Agrega al recorrido un cliente que ya está en el padrón. */
export async function agregarDestinoExistente(params: {
  rolVisitaId: string
  cliente: ClienteBuscado
  prioridad: PrioridadParada
}): Promise<ParadaCompleta> {
  if (!params.cliente.direccion_id) {
    throw new Error(
      'Ese cliente todavía no está ubicado en el mapa. Confirmá su dirección con el buscador de Google antes de agregarlo.',
    )
  }

  const { data, error } = await supabase.rpc('agregar_parada', {
    p_rol_visita_id: params.rolVisitaId,
    p_direccion_id: params.cliente.direccion_id,
    p_prioridad: params.prioridad,
    p_cliente_id: params.cliente.cliente_id,
  })

  if (error) throw error
  return data as ParadaCompleta
}

/**
 * Crea un cliente nuevo y lo agrega al recorrido, todo en una transacción.
 *
 * El cliente nace **provisorio**, con un código automático `P-000123`. La
 * oficina después le pone el código real y completa los datos fiscales; el
 * panel de escritorio los muestra aparte para que no se traspapelen.
 */
export async function agregarDestinoClienteNuevo(params: {
  rolVisitaId: string
  form: FormularioDestinoNuevo
}): Promise<ParadaCompleta> {
  const { form } = params

  const { data, error } = await supabase.rpc('agregar_destino_cliente_nuevo', {
    p_rol_visita_id: params.rolVisitaId,
    p_razon_social: form.razon_social.trim(),
    p_direccion_formateada: form.direccion_formateada.trim(),
    p_codigo_postal: form.codigo_postal.trim(),
    p_lat: form.lat,
    p_lng: form.lng,
    p_prioridad: form.prioridad,
    p_google_place_id: form.google_place_id,
    p_localidad: form.localidad,
    p_provincia: form.provincia,
    p_telefono: form.telefono.trim() || null,
    p_contacto: form.contacto_nombre.trim() || null,
  })

  if (error) {
    // Los CHECK de la función devuelven 23514 con un mensaje ya redactado
    // para el vendedor; no hay nada que traducir.
    if (error.code === '23514') throw new Error(error.message)
    throw error
  }

  // Esta función también da de alta un cliente: lo que se buscó antes ya no lo
  // incluye. Ver `olvidarBusquedasDeClientes`.
  olvidarBusquedasDeClientes()

  return data as ParadaCompleta
}

/**
 * Alta de un cliente desde "GENERAR NUEVO CLIENTE".
 *
 * Junta todo lo que Administración necesita para darlo de alta en el sistema,
 * así no tienen que llamar al vendedor para pedirle el CUIT o la dirección.
 * Nace provisorio: existe y es buscable, pero con código automático.
 */
export async function crearClienteProvisorio(
  form: FormularioClienteNuevo,
): Promise<Cliente> {
  // Varios teléfonos en un solo campo, separados con " / ": es como los anota
  // la oficina en la ficha de papel.
  const telefonos = form.telefonos
    .map((t) => t.trim())
    .filter(Boolean)
    .join(' / ')

  const { data, error } = await supabase.rpc('crear_cliente_provisorio', {
    p_razon_social: form.razon_social.trim(),
    p_documento: form.documento.trim() || null,
    p_direccion_formateada: form.direccion.trim() || null,
    p_codigo_postal: form.codigo_postal.trim() || null,
    p_lat: form.lat,
    p_lng: form.lng,
    p_telefonos: telefonos || null,
    p_email: form.email.trim() || null,
    p_nombre_fantasia: form.nombre_fantasia.trim() || null,
    p_google_place_id: form.google_place_id,
    p_localidad: form.localidad,
    p_provincia: form.provincia,
  })

  if (error) {
    if (error.code === '23514') throw new Error(error.message)
    if (error.code === '23505') {
      throw new Error('Ya existe un cliente con ese código. Probá buscarlo antes de crearlo.')
    }
    throw error
  }

  // El cliente recién creado no está en nada de lo que se buscó hasta ahora, y
  // buscarlo es lo primero que se hace después de crearlo.
  olvidarBusquedasDeClientes()

  return data as Cliente
}
