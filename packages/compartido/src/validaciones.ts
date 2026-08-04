/**
 * Validaciones compartidas.
 *
 * Son las mismas reglas que aplican los CHECK de Postgres
 * (`supabase/migrations/20260803120200_rol_de_visita.sql`). Se duplican acá a
 * propósito: la base es la que garantiza que no entre basura, y estas funciones
 * son las que le explican al vendedor qué le falta *antes* de que toque el
 * botón. Si cambiás una, cambiá la otra.
 */

import type {
  FormularioDestino,
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
    errores.usuario = 'Ingresá tu usuario'
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

export type CampoVisita =
  | 'visitado'
  | 'tipo_visita'
  | 'motivo_no_visita'
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

  const errObs = errorObservacion(form.observacion)
  if (errObs) errores.observacion = errObs

  return { valido: Object.keys(errores).length === 0, errores }
}

// ─────────────────────────────────────────────────────────────────────────────
// Formulario "AGREGAR NUEVO DESTINO"
// ─────────────────────────────────────────────────────────────────────────────

export type CampoDestino = 'direccion' | 'codigo_postal' | 'prioridad'

export function validarFormularioDestino(
  form: FormularioDestino,
): ResultadoValidacion<CampoDestino> {
  const errores: Partial<Record<CampoDestino, string>> = {}

  if (!form.direccion_formateada.trim()) {
    errores.direccion = 'Ingresá la dirección'
  } else if (form.lat === null || form.lng === null) {
    // Sin coordenadas no se puede trazar la ruta: hay que elegir una de las
    // sugerencias de Google, no escribir la dirección a mano.
    errores.direccion = 'Elegí una dirección de la lista de sugerencias'
  }

  if (!form.codigo_postal.trim()) {
    errores.codigo_postal = 'Falta el código postal'
  } else if (!/^[A-Za-z]?\d{4}([A-Za-z]{3})?$/.test(form.codigo_postal.trim())) {
    errores.codigo_postal = 'El código postal no parece válido (ej. 1704 o B1704ARQ)'
  }

  if (!form.prioridad) {
    errores.prioridad = 'Elegí la prioridad del destino'
  }

  return { valido: Object.keys(errores).length === 0, errores }
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilidades varias
// ─────────────────────────────────────────────────────────────────────────────

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

/** "LUNES 6/7", como en el historial de envíos. */
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
