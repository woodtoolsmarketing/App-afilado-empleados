/**
 * Validaciones compartidas.
 *
 * Son las mismas reglas que aplican los CHECK de Postgres
 * (`supabase/migrations/20260803120200_rol_de_visita.sql`). Se duplican acá a
 * propósito: la base es la que garantiza que no entre basura, y estas funciones
 * son las que le explican al vendedor qué le falta *antes* de que toque el
 * botón. Si cambiás una, cambiá la otra.
 */

import { ETIQUETA_MOTIVO_NO_VISITA } from './tipos'
import type {
  FormularioDestinoExistente,
  FormularioDestinoNuevo,
  FormularioVisita,
  ResultadoValidacion,
} from './tipos'

const LETRAS = 'a-zA-ZáéíóúüñÁÉÍÓÚÜÑ'

/** Mínimo de caracteres alfanuméricos que tiene que tener una observación. */
export const MIN_CARACTERES_OBSERVACION = 12
/** Mínimo de palabras reales (2+ letras) que tiene que tener una observación. */
export const MIN_PALABRAS_OBSERVACION = 3

/**
 * Rechaza observaciones vacías o simbólicas.
 *
 * Un ".", un "ok" o una sola palabra no cuentan como observación: el objetivo
 * del campo es que quede escrito qué pasó realmente en la visita.
 */
export function observacionValida(texto: string | null | undefined): boolean {
  if (!texto) return false
  const alfanumericos = texto.replace(new RegExp(`[^0-9${LETRAS}]`, 'g'), '')
  if (alfanumericos.length < MIN_CARACTERES_OBSERVACION) return false
  const palabras = texto.match(new RegExp(`[${LETRAS}]{2,}`, 'g')) ?? []
  return palabras.length >= MIN_PALABRAS_OBSERVACION
}

/** Mensaje concreto de qué le falta a la observación. Null si está bien. */
export function errorObservacion(texto: string | null | undefined): string | null {
  if (!texto || !texto.trim()) {
    return 'Contá qué pasó en la visita. Este campo no puede quedar vacío.'
  }
  const alfanumericos = texto.replace(new RegExp(`[^0-9${LETRAS}]`, 'g'), '')
  const palabras = texto.match(new RegExp(`[${LETRAS}]{2,}`, 'g')) ?? []

  if (palabras.length < MIN_PALABRAS_OBSERVACION || alfanumericos.length < MIN_CARACTERES_OBSERVACION) {
    return `Escribí al menos una frase (${MIN_PALABRAS_OBSERVACION} palabras o más) describiendo qué pasó. Un punto o una sola palabra no alcanzan.`
  }
  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// Inicio de sesión
// ─────────────────────────────────────────────────────────────────────────────

export type CampoLogin = 'usuario' | 'contrasena'

export function validarLogin(usuario: string, contrasena: string): ResultadoValidacion<CampoLogin> {
  const errores: Partial<Record<CampoLogin, string>> = {}

  if (!usuario.trim()) {
    errores.usuario = 'Ingresá tu usuario o tu email'
  } else if (usuario.includes('@') && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(usuario.trim())) {
    errores.usuario = 'El correo no tiene un formato válido'
  }

  if (!contrasena) {
    errores.contrasena = 'Ingresá tu contraseña'
  } else if (contrasena.length < 6) {
    errores.contrasena = 'La contraseña tiene al menos 6 caracteres'
  }

  return { valido: Object.keys(errores).length === 0, errores }
}

// ─────────────────────────────────────────────────────────────────────────────
// Formulario "¿DESTINO VISITADO?"
// ─────────────────────────────────────────────────────────────────────────────

/** "16:30". Acepta de 00:00 a 23:59 y nada más. */
export const HORA_DEL_DIA = /^([01]\d|2[0-3]):[0-5]\d$/

/**
 * La observación escrita sola, a partir de lo que el vendedor marcó.
 *
 * ── Por qué se genera y no se deja en blanco ────────────────────────────────
 *
 * La observación es obligatoria por partida doble —el validador de acá y un
 * CHECK en la base— y eso está bien: un parte sin contar qué pasó no sirve para
 * nada. Pero obligar a redactar cuando el vendedor ya tildó "vendió" y "retiró
 * afilado" es pedirle que escriba dos veces lo mismo, en la calle y con una
 * mano. Lo que se escribe solo es lo que ya se dijo; lo que hay que agregar es
 * lo que no cabía en un tilde.
 *
 * ── El piso que hay que pasar ───────────────────────────────────────────────
 *
 * `interno.observacion_valida` exige 12 caracteres alfanuméricos y 3 palabras
 * de dos letras o más. Un "Cobró." no pasa, y el error que devuelve la base
 * —"la observación es obligatoria"— sobre un campo que la app acaba de
 * completar sola sería incomprensible. Por eso todas las frases de acá
 * arrancan con el sujeto completo ("Se visitó al cliente…"): puestas así, la
 * más corta posible ya pasa el filtro con margen.
 */
export function observacionSugerida(
  form: Pick<
    FormularioVisita,
    'visitado' | 'vendio' | 'cobro' | 'retiro_afilado' | 'entrego' | 'motivo_no_visita' | 'volver_a_las' | 'contacto_nombre'
  >,
  /** Qué se vendió o se mandó a taller, a grandes rasgos: "Venta de sierras". */
  resumenDeNotas: string[] = [],
): string {
  const partes: string[] = []

  if (form.visitado === false) {
    if (form.motivo_no_visita === 'visitar_mas_tarde') {
      const hora = form.volver_a_las.trim()
      partes.push(
        hora ? `No se pudo visitar ahora: vuelvo a pasar a las ${hora}.` : 'No se pudo visitar ahora: vuelvo a pasar más tarde.',
      )
    } else if (form.motivo_no_visita) {
      /*
        El `?? ''` no es de más.

        `ETIQUETA_MOTIVO_NO_VISITA` es un `Record` del tipo, así que TypeScript
        garantiza que la clave exista… mientras el valor venga del desplegable.
        No viene siempre: al reabrir una visita vieja el motivo sale de la base,
        y si algún día se saca un motivo de la lista —o se agrega uno del lado
        del servidor antes que del lado de la app— acá llega un `string` que no
        está en la tabla. Sin esto, `undefined.toLowerCase()` tiraba la pantalla
        entera del parte de visita.

        Con el motivo desconocido la frase queda igual de válida para el filtro
        de la base: "No se pudo visitar al cliente." son cuatro palabras.
      */
      const motivo = ETIQUETA_MOTIVO_NO_VISITA[form.motivo_no_visita] ?? ''
      partes.push(
        motivo
          ? `No se pudo visitar: ${motivo.toLowerCase()}.`
          : 'No se pudo visitar al cliente.',
      )
    } else {
      partes.push('No se pudo visitar al cliente.')
    }
    return partes.join(' ')
  }

  if (form.visitado === true) {
    const hizo: string[] = []
    if (form.vendio) hizo.push('vendió')
    if (form.cobro) hizo.push('cobró')
    if (form.retiro_afilado) hizo.push('retiró afilado')
    if (form.entrego) hizo.push('entregó')

    partes.push(hizo.length > 0 ? `Se visitó al cliente: ${enumerarEs(hizo)}.` : 'Se visitó al cliente.')

    const quien = form.contacto_nombre.trim()
    if (quien) partes.push(`Atendió ${quien}.`)

    // Lo que se llevó, en grueso. Sale de las notas hechas en esta visita.
    const resumen = resumenDeNotas.map((r) => r.trim()).filter(Boolean)
    if (resumen.length > 0) partes.push(`${enumerarEs(resumen)}.`)
  }

  return partes.join(' ')
}

/** "a", "a y b", "a, b y c". */
function enumerarEs(cosas: string[]): string {
  if (cosas.length === 0) return ''
  if (cosas.length === 1) return cosas[0]
  return `${cosas.slice(0, -1).join(', ')} y ${cosas[cosas.length - 1]}`
}


export type CampoVisita =
  | 'visitado'
  | 'tipo_visita'
  | 'motivo_no_visita'
  | 'volver_a_las'
  | 'contacto_nombre'
  | 'observacion'

export function validarFormularioVisita(
  form: FormularioVisita,
  opciones: { exigirContacto?: boolean } = {},
): ResultadoValidacion<CampoVisita> {
  const errores: Partial<Record<CampoVisita, string>> = {}

  if (form.visitado === null) {
    errores.visitado = 'Indicá si visitaste el destino'
  }

  if (form.visitado === true) {
    const algunTipo = form.vendio || form.cobro || form.retiro_afilado || form.entrego
    if (!algunTipo) {
      errores.tipo_visita = 'Marcá al menos un tipo de visita'
    }
    if (opciones.exigirContacto && !form.contacto_nombre.trim()) {
      errores.contacto_nombre = 'Indicá quién te atendió'
    }
  }

  if (form.visitado === false && !form.motivo_no_visita) {
    errores.motivo_no_visita = 'Elegí el motivo por el que no se concretó la visita'
  }

  // Sin hora, "visitar más tarde" no se distingue de "no lo visité": la parada
  // tiene que volver a la cola en algún momento concreto o no vuelve nunca.
  if (form.visitado === false && form.motivo_no_visita === 'visitar_mas_tarde') {
    if (!HORA_DEL_DIA.test(form.volver_a_las.trim())) {
      errores.volver_a_las = 'Decí a qué hora volvés (por ejemplo 16:30)'
    }
  }

  const errObs = errorObservacion(form.observacion)
  if (errObs) errores.observacion = errObs

  return { valido: Object.keys(errores).length === 0, errores }
}

// ─────────────────────────────────────────────────────────────────────────────
// Formularios de "AGREGAR NUEVO DESTINO"
// ─────────────────────────────────────────────────────────────────────────────

/** Acepta "1704" y también "B1704ARQ", los dos formatos que usa el Correo. */
export const CODIGO_POSTAL = /^[A-Za-z]?\d{4}([A-Za-z]{3})?$/

/**
 * La prioridad ya no se elige: la decide la distancia al destino.
 *
 * El campo sigue en el tipo del formulario porque la parada la sigue llevando
 * —la optimización de la ruta clava adelante las de prioridad alta— pero la
 * completa la app, no el vendedor, así que no hay nada que validar.
 */
export type CampoDestinoExistente = 'cliente' | 'prioridad'

export function validarDestinoExistente(
  form: FormularioDestinoExistente,
): ResultadoValidacion<CampoDestinoExistente> {
  const errores: Partial<Record<CampoDestinoExistente, string>> = {}

  if (!form.cliente) {
    errores.cliente = 'Buscá el cliente por código o razón social y elegilo de la lista'
  } else if (form.cliente.lat === null || form.cliente.lng === null) {
    // El cliente existe pero su ficha no tiene coordenadas: sin eso no entra
    // en el recorrido. Ya no es un callejón sin salida —la pantalla ofrece
    // ubicarlo ahí mismo contra Google—, así que el mensaje señala la acción
    // en vez de mandar al vendedor a llamar a la oficina.
    errores.cliente =
      'Ubicá el cliente en el mapa: confirmá su dirección en el buscador de acá abajo.'
  }


  return { valido: Object.keys(errores).length === 0, errores }
}

export type CampoDestinoNuevo =
  | 'razon_social'
  | 'direccion'
  | 'codigo_postal'
  | 'prioridad'

export function validarDestinoNuevo(
  form: FormularioDestinoNuevo,
): ResultadoValidacion<CampoDestinoNuevo> {
  const errores: Partial<Record<CampoDestinoNuevo, string>> = {}

  const nombre = form.razon_social.trim()
  if (!nombre) {
    errores.razon_social = 'Ingresá el nombre o la razón social del cliente'
  } else if (nombre.length < 3) {
    errores.razon_social = 'El nombre es demasiado corto'
  }

  if (!form.direccion_formateada.trim()) {
    errores.direccion = 'Ingresá la dirección'
  } else if (form.lat === null || form.lng === null) {
    // Sin coordenadas no se puede trazar la ruta: hay que elegir una de las
    // sugerencias de Google, no escribir la dirección a mano.
    errores.direccion = 'Elegí una dirección de la lista de sugerencias'
  }

  if (!form.codigo_postal.trim()) {
    errores.codigo_postal = 'Falta el código postal'
  } else if (!CODIGO_POSTAL.test(form.codigo_postal.trim())) {
    errores.codigo_postal = 'El código postal no parece válido (ej. 1704 o B1704ARQ)'
  }


  return { valido: Object.keys(errores).length === 0, errores }
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilidades varias
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cuántos metros hay entre dos puntos, en línea recta.
 *
 * Fórmula del haversine sobre una Tierra esférica. El error contra el elipsoide
 * real ronda el 0,3 %, que en las distancias que se miden acá —"¿está en la
 * puerta del cliente?", 150 metros— son centímetros. Postgres tiene PostGIS y
 * lo hace mejor, pero esto tiene que poder contestarse en el teléfono, sin
 * señal y en el momento.
 */
export function distanciaEnMetros(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const RADIO_TIERRA_M = 6_371_000
  const aRad = (g: number) => (g * Math.PI) / 180

  const dLat = aRad(b.lat - a.lat)
  const dLng = aRad(b.lng - a.lng)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aRad(a.lat)) * Math.cos(aRad(b.lat)) * Math.sin(dLng / 2) ** 2

  return Math.round(2 * RADIO_TIERRA_M * Math.asin(Math.min(1, Math.sqrt(h))))
}

/** Formatea metros como "850 m" o "12,4 km". */
export function formatearDistancia(metros: number | null | undefined): string {
  if (metros === null || metros === undefined) return '—'
  if (metros < 1000) return `${Math.round(metros)} m`
  return `${(metros / 1000).toFixed(1).replace('.', ',')} km`
}

/** Formatea segundos como "45 min" o "1 h 20 min". */
export function formatearDuracion(segundos: number | null | undefined): string {
  if (segundos === null || segundos === undefined) return '—'
  const minutos = Math.round(segundos / 60)
  if (minutos < 60) return `${minutos} min`
  const horas = Math.floor(minutos / 60)
  const resto = minutos % 60
  return resto === 0 ? `${horas} h` : `${horas} h ${resto} min`
}

/** "13/7/2026", como en la esquina de las pantallas. */
export function formatearFechaCorta(fecha: Date | string): string {
  const d = typeof fecha === 'string' ? new Date(fecha) : fecha
  return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`
}

/** "8:05" — la columna HORA de la planilla. */
export function formatearHora(fecha: Date | string | null | undefined): string {
  if (!fecha) return '—'
  const d = typeof fecha === 'string' ? new Date(fecha) : fecha
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
}

const DIAS = ['DOMINGO', 'LUNES', 'MARTES', 'MIÉRCOLES', 'JUEVES', 'VIERNES', 'SÁBADO']

/** "LUNES 6/7", como en el historial de visitas. */
export function formatearDiaHistorial(fecha: Date | string): string {
  const d = typeof fecha === 'string' ? new Date(`${fecha}T12:00:00`) : fecha
  return `${DIAS[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`
}

/** Distancia en metros entre dos coordenadas (fórmula de Haversine). */
export function distanciaMetros(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6_371_000
  const rad = (g: number) => (g * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/**
 * La fecha en formato ISO corto, según el calendario del teléfono.
 *
 * `toISOString()` convierte a UTC, y en Argentina eso adelanta el día a partir
 * de las 21:00. Una nota cargada a las 21:30 con entrega "mañana" se guardaba
 * con la fecha de pasado mañana, y ni el vendedor ni la oficina tenían cómo
 * notarlo: la pantalla mostraba bien el día que el vendedor había elegido.
 *
 * El mismo criterio que ya usaba `hoyISO` para la jornada, ahora en un solo
 * lugar para que no se vuelva a escribir mal.
 */
export function fechaLocalISO(fecha: Date): string {
  const desfase = fecha.getTimezoneOffset() * 60_000
  return new Date(fecha.getTime() - desfase).toISOString().slice(0, 10)
}

/**
 * ¿Esta parada todavía está esperando su hora?
 *
 * Una parada diferida con "visitar más tarde" vuelve a la cola con la hora que
 * el vendedor le prometió al cliente. Hasta que esa hora llegue no es candidata
 * a ser el próximo destino, aunque por orden le tocara.
 *
 * Existe en el paquete compartido porque la regla vive en dos lados: la RPC
 * `registrar_visita` decide a quién promueve a 'en_camino', y las pantallas
 * deciden a quién muestran como próximo destino. Si las dos no dicen lo mismo,
 * la app manda a navegar a un cliente que el servidor no considera en curso.
 */
export function todaviaNoLeToca(
  parada: { hora_estimada?: string | null },
  ahora: Date = new Date(),
): boolean {
  if (!parada.hora_estimada) return false
  const cuando = new Date(parada.hora_estimada)
  return Number.isFinite(cuando.getTime()) && cuando.getTime() > ahora.getTime()
}
