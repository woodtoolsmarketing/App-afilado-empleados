import * as Battery from 'expo-battery'
import * as Location from 'expo-location'
import * as TaskManager from 'expo-task-manager'
import { Alert, Linking } from 'react-native'

import {
  distanciaEnMetros,
  enHorarioDeSeguimiento,
  fechaLocalISO,
  horarioSeguimientoDesde,
  HORARIO_SEGUIMIENTO_DEFECTO,
  type HorarioSeguimiento,
} from '@woodtools/compartido'

import { cacheLocal, supabase } from '../nucleo/supabase'

/**
 * Seguimiento de la ubicación durante el recorrido.
 *
 * El admin ve el pin del vendedor moverse en vivo, como en una app de reparto.
 * Se apaga solo al finalizar el recorrido: fuera de la jornada no se rastrea a
 * nadie.
 *
 * Dos destinos por cada punto:
 *  · `posiciones_actuales` → una sola fila por vendedor, con UPSERT. Es la que
 *    está publicada en Realtime y la que alimenta el mapa del panel.
 *  · `posiciones` → histórico append-only para reproducir el recorrido después.
 *
 * Si no hay señal, los puntos se encolan en disco y se reintentan. El histórico
 * no puede depender de que la red esté disponible en el momento exacto.
 */

export const TAREA_UBICACION = 'woodtools-seguimiento-recorrido'
const CLAVE_CONTEXTO = 'woodtools.contexto_seguimiento'
const CLAVE_COLA = 'woodtools.cola_posiciones'

/** Tope de la cola: si se pasa, se descartan los puntos más viejos. */
const MAX_EN_COLA = 500

interface ContextoSeguimiento {
  vendedorId: string
  /**
   * El recorrido en curso, o `null` cuando se rastrea por JORNADA (horario
   * laboral) sin un recorrido: los puntos van al histórico con `rol_visita_id`
   * nulo y al pin en vivo con `en_recorrido: false`.
   */
  rolVisitaId: string | null
  /**
   * El día local (Argentina) de la jornada. La tarea corta el seguimiento
   * cuando el reloj pasa a otro día: sin esto, un recorrido que no se finaliza
   * seguía rastreando noches y fines de semana y cargaba la traza en la jornada
   * vieja. Puede faltar en un contexto guardado por una versión anterior; ahí
   * se trata como "sin fecha" y no se corta por este motivo.
   */
  fecha?: string
  /**
   * El horario de seguimiento, fijado al arrancar. La tarea corta a la hora de
   * fin (p. ej. 17) con ESTO, sin pegarle a la base por cada punto. Si falta
   * (contexto viejo), rige el default.
   */
  horario?: HorarioSeguimiento
}

interface PuntoEncolado {
  rol_visita_id: string | null
  vendedor_id: string
  lat: number
  lng: number
  precision_m: number | null
  velocidad_mps: number | null
  rumbo: number | null
  bateria_pct: number | null
  registrado_en: string
}

async function leerContexto(): Promise<ContextoSeguimiento | null> {
  const crudo = await cacheLocal.getItem(CLAVE_CONTEXTO)
  if (!crudo) return null
  try {
    return JSON.parse(crudo) as ContextoSeguimiento
  } catch {
    return null
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Permisos
// ─────────────────────────────────────────────────────────────────────────────

export type ResultadoPermiso =
  | { concedido: true; segundoPlano: boolean }
  | { concedido: false; motivo: string }

/**
 * Pide los permisos en dos pasos, como exige Android: primero mientras se usa
 * la app, y sólo después el permiso de segundo plano. Pedirlos juntos hace que
 * el sistema rechace el segundo sin siquiera mostrarlo.
 */
export async function pedirPermisosUbicacion(): Promise<ResultadoPermiso> {
  const primerPlano = await Location.requestForegroundPermissionsAsync()
  if (!primerPlano.granted) {
    return {
      concedido: false,
      motivo:
        'Sin permiso de ubicación no podemos armar el recorrido ni avisar a la oficina dónde estás.',
    }
  }

  const segundoPlano = await Location.requestBackgroundPermissionsAsync()

  return { concedido: true, segundoPlano: segundoPlano.granted }
}

/**
 * Sólo el permiso de "mientras usás la app".
 *
 * Para leer dónde está parado el vendedor ahora mismo alcanza con éste. Pedirle
 * además el de segundo plano —que es el que Android muestra con la advertencia
 * de que la app puede seguirlo con la pantalla apagada— para completar un campo
 * de dirección sería pedir mucho más de lo que hace falta, y es la clase de
 * cartel que hace que alguien apriete "Rechazar" y no vuelva a intentarlo.
 *
 * El de segundo plano se sigue pidiendo aparte, cuando arranca el recorrido,
 * que es cuando de verdad se necesita.
 */
export async function permisoDeUbicacionPuntual(): Promise<boolean> {
  const { granted } = await Location.requestForegroundPermissionsAsync()
  return granted
}

// ─────────────────────────────────────────────────────────────────────────────
// Arranque y parada
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cuánto se espera un punto nuevo antes de conformarse con el último conocido.
 *
 * `getCurrentPositionAsync` no trae timeout propio: adentro de un galpón, en un
 * subsuelo o con el GPS frío puede no resolver NUNCA. Y un `await` que no
 * resuelve no lo salva un try/catch — deja la mutación colgada, el botón
 * girando y al vendedor sin saber si guardó o no.
 *
 * Doce segundos es lo que tarda un teléfono con cielo a la vista en dar un
 * punto bueno. Pasado eso, el último punto conocido dice más que nada.
 */
const ESPERA_MAXIMA_MS = 12_000

/** Cuán viejo puede ser el último punto conocido y todavía servir. */
const ANTIGUEDAD_ACEPTABLE_MS = 5 * 60_000

export async function ubicacionActual(): Promise<{ lat: number; lng: number; precision: number | null }> {
  // Se queda pidiendo `High`: el desvío de la visita se mide contra esto, y
  // cien metros de error alcanzan para marcar como "lejos" a alguien que está
  // parado en la puerta. El que afloja es el reloj, no la precisión.
  const pos = await Promise.race([
    Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
    new Promise<Location.LocationObject | null>((resolver) => {
      setTimeout(() => {
        // El pedido de arriba sigue vivo: si contesta antes que esto, gana él.
        Location.getLastKnownPositionAsync({ maxAge: ANTIGUEDAD_ACEPTABLE_MS })
          .then(resolver)
          .catch(() => resolver(null))
      }, ESPERA_MAXIMA_MS)
    }),
  ])

  // Fallar acá es aceptable y está previsto: quien registra una visita lo hace
  // dentro de un try/catch y la guarda sin coordenadas. Lo que no se podía
  // seguir haciendo era colgarse en silencio.
  if (!pos) {
    throw new Error('No pudimos leer tu ubicación. Probá a cielo abierto o reintentá en un momento.')
  }

  return {
    lat: pos.coords.latitude,
    lng: pos.coords.longitude,
    precision: pos.coords.accuracy ?? null,
  }
}

/** Arranca la tarea en segundo plano si todavía no está corriendo. */
async function arrancarTarea(): Promise<void> {
  const yaCorriendo = await Location.hasStartedLocationUpdatesAsync(TAREA_UBICACION)
  if (yaCorriendo) return

  const { intervaloSeg, distanciaMin } = await parametros()

  await Location.startLocationUpdatesAsync(TAREA_UBICACION, {
    accuracy: Location.Accuracy.Balanced,
    timeInterval: intervaloSeg * 1000,
    distanceInterval: distanciaMin,
    // Sin esto, Android mata el seguimiento apenas se apaga la pantalla.
    foregroundService: {
      notificationTitle: 'WoodTools · seguimiento activo',
      notificationBody: 'La oficina ve tu ubicación durante el horario laboral.',
      notificationColor: '#B30F0F',
      killServiceOnDestroy: false,
    },
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    activityType: Location.ActivityType.AutomotiveNavigation,
  })
}

/** Seguimiento de recorrido: se prende al iniciar un viaje y guarda la traza. */
export async function iniciarSeguimiento(contexto: ContextoSeguimiento): Promise<void> {
  // El día local y el horario quedan grabados en el contexto: es contra esto que
  // la tarea decide cortar cuando cambia el día o cuando termina el horario. Si
  // el llamador no los pasa, son los de hoy (que es cuando se inicia o se reanuda
  // una jornada).
  const conFecha: ContextoSeguimiento = {
    ...contexto,
    fecha: contexto.fecha ?? fechaLocalISO(new Date()),
    horario: contexto.horario ?? (await horarioDeSeguimiento()),
  }
  await cacheLocal.setItem(CLAVE_CONTEXTO, JSON.stringify(conFecha))
  await arrancarTarea()
}

/** El horario de seguimiento que configuró la oficina (o el default). */
async function horarioDeSeguimiento(): Promise<HorarioSeguimiento> {
  try {
    const { data } = await supabase
      .from('configuracion')
      .select('valor')
      .eq('clave', 'seguimiento_horario')
      .maybeSingle()
    return horarioSeguimientoDesde((data as { valor: unknown } | null)?.valor)
  } catch {
    return HORARIO_SEGUIMIENTO_DEFECTO
  }
}

async function permisoDeFondo(): Promise<boolean> {
  try {
    return (await Location.getBackgroundPermissionsAsync()).granted
  } catch {
    return false
  }
}

/**
 * Prende o APAGA el seguimiento de jornada según corresponda (Fase 1).
 *
 * Se llama al loguearse, al volver la app al frente, y por un reloj cada pocos
 * minutos (para no quedar prendido ni apagado por depender sólo de un evento).
 *
 *  · Debe rastrear (habilitado + horario laboral) y NO está → arranca la jornada,
 *    si hay permiso "siempre" y sesión.
 *  · NO debe (fuera de horario, o dejó de estar habilitado) y SÍ está:
 *     - si no está habilitado → corta del todo (un equipo bloqueado o
 *       desautorizado no sigue reportando, esté en recorrido o no);
 *     - si es sólo por horario → corta el modo jornada; un recorrido explícito lo
 *       cierra la propia tarea (corte por hora) o el "finalizar".
 *
 * Que ya esté en un recorrido cuenta como "ya rastreando": no lo pisa.
 */
export async function revisarSeguimiento(habilitado: boolean): Promise<void> {
  const activo = await seguimientoActivo()
  const horario = await horarioDeSeguimiento()
  const debeRastrear = habilitado && enHorarioDeSeguimiento(new Date(), horario)

  if (debeRastrear && !activo) {
    if (!(await permisoDeFondo())) return
    const { data } = await supabase.auth.getSession()
    const vendedorId = data.session?.user.id
    if (!vendedorId) return
    await iniciarSeguimiento({ vendedorId, rolVisitaId: null, horario })
    return
  }

  if (!debeRastrear && activo) {
    const ctx = await leerContexto()
    if (!ctx) {
      await detenerSeguimiento()
      return
    }
    // Sin habilitación: corta siempre. Sólo por horario: corta únicamente la
    // jornada (si hay recorrido, lo maneja el corte por hora de la tarea).
    if (!habilitado || ctx.rolVisitaId === null) {
      await detenerSeguimiento(ctx.vendedorId)
    }
  }
}

/**
 * Terminar un recorrido SIN cortar el seguimiento de jornada.
 *
 * Antes, finalizar el recorrido apagaba la tarea entera. Con el seguimiento
 * continuo, si todavía es horario laboral y está el permiso, el seguimiento
 * sigue —ahora en modo jornada, sin recorrido—; recién se apaga del todo fuera
 * de horario (o al cerrar sesión, que llama a `detenerSeguimiento`).
 */
export async function terminarRecorrido(vendedorId?: string): Promise<void> {
  const horario = await horarioDeSeguimiento()

  if (vendedorId && (await permisoDeFondo()) && enHorarioDeSeguimiento(new Date(), horario)) {
    const ctx = await leerContexto()
    if (ctx) {
      // Bajar a modo jornada: sacar el recorrido del contexto, la tarea sigue.
      await cacheLocal.setItem(CLAVE_CONTEXTO, JSON.stringify({ ...ctx, rolVisitaId: null, horario }))
    }
    await supabase
      .from('posiciones_actuales')
      .update({ en_recorrido: false, actualizado_en: new Date().toISOString() })
      .eq('vendedor_id', vendedorId)
      .then(undefined, () => undefined)
    return
  }

  await detenerSeguimiento(vendedorId)
}

/**
 * Pide el permiso "permitir siempre" una vez, para que el seguimiento de jornada
 * pueda andar. Se llama al loguearse. Si ya está concedido o ya se preguntó una
 * vez, no molesta de nuevo (el inicio de un recorrido lo vuelve a pedir si hace
 * falta).
 */
const CLAVE_PIDIO_PERMISO = 'woodtools.pidio_permiso_jornada'
export async function pedirPermisoDeSeguimientoSiFalta(): Promise<void> {
  try {
    if (await permisoDeFondo()) return
    if (await cacheLocal.getItem(CLAVE_PIDIO_PERMISO)) return
    await cacheLocal.setItem(CLAVE_PIDIO_PERMISO, '1')
    await pedirPermisosUbicacion()
    // El arranque del seguimiento queda a cargo de `revisarSeguimiento`, que el
    // que la llama corre justo después: así no se dispara dos veces.
  } catch {
    // Que falle pedir el permiso no puede tumbar el arranque de la app.
  }
}

/**
 * Olvida que ya se pidió el permiso de jornada.
 *
 * Va al cambiar de cuenta / cerrar sesión: la clave es del teléfono, no de la
 * cuenta, así que sin esto un segundo vendedor en el mismo equipo nunca recibía
 * el pedido de "permitir siempre" y su seguimiento de jornada no arrancaba.
 */
export async function olvidarPermisoDeJornada(): Promise<void> {
  try {
    await cacheLocal.removeItem(CLAVE_PIDIO_PERMISO)
  } catch {
    // Si no se puede olvidar, en el peor caso no se vuelve a preguntar.
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Confiabilidad (Fase 2): que Android/Samsung no "duerma" la app
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Abre los ajustes para sacar la app de la optimización de batería.
 *
 * En el APK 1.3.0 usa `expo-intent-launcher` (nativo, importado lazy porque en
 * 1.2.1 no existe e importarlo arriba rompería el bundle). Si no, cae a
 * `Linking`, que es de React Native y anda en los dos runtimes. Último recurso:
 * los ajustes de la app.
 */
export async function abrirAjustesDeBateria(): Promise<void> {
  const ACCION = 'android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS'
  try {
    const IntentLauncher = await import('expo-intent-launcher')
    await IntentLauncher.startActivityAsync(ACCION)
    return
  } catch {
    // 1.2.1 (sin el módulo nativo) o cualquier error: se intenta por Linking.
  }
  try {
    await Linking.sendIntent(ACCION)
    return
  } catch {
    // Si la acción no existe en este teléfono, al menos los ajustes de la app.
  }
  try {
    await Linking.openSettings()
  } catch {
    // Que no se pueda abrir ajustes no puede romper la app.
  }
}

/**
 * Explica por qué el seguimiento se puede cortar y ofrece arreglarlo.
 *
 * El problema real: Samsung (y Android en general) mata el servicio en segundo
 * plano para ahorrar batería, y ahí el seguimiento se corta aunque todo lo demás
 * esté bien. No se puede chequear por código si la app ya está exceptuada.
 *
 * NO se muestra sola: se abre A MANO desde Configuración ("QUE EL SEGUIMIENTO NO
 * SE CORTE"). No la queremos saltando en la cara de toda la flota al arrancar;
 * la oficina la usa con el vendedor que haga falta.
 */
export function mostrarGuiaDeBateria(): void {
  Alert.alert(
    'Que el seguimiento no se corte',
    'Para que la oficina te siga viendo con la pantalla apagada, Android no tiene que "dormir" la app.\n\n' +
      '1) Sacá a WoodTools de la optimización de batería (ponela en "Sin restricciones").\n' +
      '2) En Samsung, sacala también de "Apps que se duermen" / "en suspensión profunda".',
    [
      { text: 'Cerrar', style: 'cancel' },
      { text: 'Abrir ajustes', onPress: () => void abrirAjustesDeBateria() },
    ],
  )
}

export async function detenerSeguimiento(vendedorId?: string): Promise<void> {
  // Si no viene el id, se saca del contexto ANTES de borrarlo: así el pin en
  // vivo se apaga igual. Sin esto, parar sin pasar el id dejaba la fila con
  // `activo: true` de un seguimiento que ya no corre.
  const idReset = vendedorId ?? (await leerContexto())?.vendedorId

  const corriendo = await Location.hasStartedLocationUpdatesAsync(TAREA_UBICACION).catch(() => false)
  if (corriendo) await Location.stopLocationUpdatesAsync(TAREA_UBICACION)

  await cacheLocal.removeItem(CLAVE_CONTEXTO)
  await vaciarCola()

  if (idReset) {
    await supabase
      .from('posiciones_actuales')
      .update({ en_recorrido: false, activo: false, actualizado_en: new Date().toISOString() })
      .eq('vendedor_id', idReset)
      .then(undefined, () => undefined)
  }
}

export async function seguimientoActivo(): Promise<boolean> {
  return Location.hasStartedLocationUpdatesAsync(TAREA_UBICACION).catch(() => false)
}

// ─────────────────────────────────────────────────────────────────────────────
// La tarea en segundo plano
// ─────────────────────────────────────────────────────────────────────────────

TaskManager.defineTask(TAREA_UBICACION, async ({ data, error }) => {
  if (error) {
    console.warn('[seguimiento] error de la tarea', error)
    return
  }

  const { locations } = (data ?? {}) as { locations?: Location.LocationObject[] }
  const ultima = locations?.at(-1)
  if (!ultima) return

  const contexto = await leerContexto()
  if (!contexto) return

  // Si el día local ya no es el de la jornada, se corta acá: un recorrido que no
  // se finalizó no tiene que seguir rastreando la noche, el fin de semana, ni
  // atribuir puntos de hoy a la jornada de ayer. `detenerSeguimiento` apaga la
  // tarea, drena lo que quedó de ayer y marca al vendedor fuera de recorrido.
  if (contexto.fecha && fechaLocalISO(new Date(ultima.timestamp)) !== contexto.fecha) {
    await detenerSeguimiento(contexto.vendedorId)
    return
  }

  // Fuera del horario de seguimiento (p. ej. pasadas las 17, o un sábado): se
  // corta acá aunque la app no se haya abierto. El horario viene fijado en el
  // contexto al arrancar, así que esto no le pega a la base por cada punto.
  const horario = contexto.horario ?? HORARIO_SEGUIMIENTO_DEFECTO
  if (!enHorarioDeSeguimiento(new Date(ultima.timestamp), horario)) {
    await detenerSeguimiento(contexto.vendedorId)
    return
  }

  let bateria: number | null = null
  try {
    bateria = Math.round((await Battery.getBatteryLevelAsync()) * 100)
  } catch {
    // La batería es un dato de conveniencia; si falla, no importa.
  }

  const punto: PuntoEncolado = {
    rol_visita_id: contexto.rolVisitaId,
    vendedor_id: contexto.vendedorId,
    lat: ultima.coords.latitude,
    lng: ultima.coords.longitude,
    precision_m: ultima.coords.accuracy ?? null,
    velocidad_mps: ultima.coords.speed ?? null,
    rumbo: ultima.coords.heading ?? null,
    bateria_pct: bateria,
    registrado_en: new Date(ultima.timestamp).toISOString(),
  }

  await publicarPunto(punto)
})

async function publicarPunto(punto: PuntoEncolado): Promise<void> {
  // El pin en vivo primero: es lo que le importa al admin en este segundo.
  // Si falla no se reintenta y no se mira el error: el punto siguiente lo pisa,
  // porque es un upsert de una sola fila por vendedor.
  await supabase.from('posiciones_actuales').upsert(
    {
      vendedor_id: punto.vendedor_id,
      rol_visita_id: punto.rol_visita_id,
      lat: punto.lat,
      lng: punto.lng,
      precision_m: punto.precision_m,
      velocidad_mps: punto.velocidad_mps,
      rumbo: punto.rumbo,
      bateria_pct: punto.bateria_pct,
      // `activo` es lo que el panel muestra (acotado por el horario 8-17 según su
      // reloj); `en_recorrido` marca que además tiene un recorrido en curso —en
      // modo jornada (sin recorrido) va en false.
      activo: true,
      en_recorrido: punto.rol_visita_id !== null,
      actualizado_en: punto.registrado_en,
    },
    { onConflict: 'vendedor_id' },
  )

  const { error: errHistorico } = await supabase.from('posiciones').insert(punto)

  // Se encola sólo si falló EL HISTÓRICO. Antes alcanzaba con que fallara
  // cualquiera de las dos, y cuando la que fallaba era el pin en vivo el punto
  // ya estaba guardado: al drenar la cola se insertaba una segunda vez y la
  // traza del recorrido quedaba con puntos repetidos. Que se pierda un pin en
  // vivo no cuesta nada — el siguiente punto lo pisa, es un upsert.
  if (errHistorico) {
    await encolar(punto)
    return
  }

  // Con la red de vuelta, se drena lo que quedó pendiente.
  await drenarCola()
}

async function encolar(punto: PuntoEncolado): Promise<void> {
  const crudo = await cacheLocal.getItem(CLAVE_COLA)
  const cola: PuntoEncolado[] = crudo ? JSON.parse(crudo) : []
  cola.push(punto)
  await cacheLocal.setItem(CLAVE_COLA, JSON.stringify(cola.slice(-MAX_EN_COLA)))
}

/** Devuelve si la cola llegó entera al servidor. Sólo borra lo que se aceptó. */
async function drenarCola(): Promise<boolean> {
  const crudo = await cacheLocal.getItem(CLAVE_COLA)
  if (!crudo) return true

  let cola: PuntoEncolado[] = JSON.parse(crudo)
  if (cola.length === 0) return true

  // Los puntos de OTRA cuenta la RLS los rechaza siempre y envenenarían la cola.
  // La cola es del vendedor en curso: los ajenos se descartan.
  const contexto = await leerContexto()
  if (contexto) {
    const propios = cola.filter((p) => p.vendedor_id === contexto.vendedorId)
    if (propios.length !== cola.length) {
      cola = propios
      await cacheLocal.setItem(CLAVE_COLA, JSON.stringify(cola))
    }
  }
  if (cola.length === 0) {
    await cacheLocal.removeItem(CLAVE_COLA)
    return true
  }

  const { error } = await supabase.from('posiciones').insert(cola)
  if (!error) {
    await cacheLocal.removeItem(CLAVE_COLA)
    return true
  }

  // El lote falló. Sólo vale reintentar punto por punto cuando el rechazo es del
  // tipo que UN punto puede causar por sí mismo (RLS o integridad): ahí un punto
  // malo —p. ej. de otra cuenta— envenena al resto y hay que soltarlo. Cualquier
  // otro fallo (red, 5xx del gateway, agotamiento de conexiones) afecta a TODOS
  // por igual y es transitorio: se conserva la cola entera para el próximo drenado
  // en vez de perder la traza de la tarde.
  if (!esRechazoDefinitivo(error)) return false

  const quedan: PuntoEncolado[] = []
  for (const punto of cola) {
    const { error: e } = await supabase.from('posiciones').insert(punto)
    if (!e) continue // subió: se descarta de la cola
    // Se suelta SÓLO el punto que la base rechaza de forma definitiva (RLS/
    // integridad): reintentarlo daría siempre lo mismo. Un fallo transitorio se
    // conserva.
    if (esRechazoDefinitivo(e)) continue
    quedan.push(punto)
  }
  if (quedan.length === 0) {
    await cacheLocal.removeItem(CLAVE_COLA)
    return true
  }
  await cacheLocal.setItem(CLAVE_COLA, JSON.stringify(quedan))
  return false
}

/**
 * ¿La base rechazó esta fila de forma DEFINITIVA (reintentarla daría lo mismo)?
 *
 * Sólo los códigos SQLSTATE de permiso/RLS (42501) e integridad (clase 23:
 * unique, FK, check, not-null). Un 5xx del gateway, un agotamiento de conexiones
 * (53xxx) o una caída de red no traen ese código: son transitorios y NO se
 * descartan, para no perder puntos que sí van a poder subir después.
 */
function esRechazoDefinitivo(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code
  if (typeof code !== 'string') return false
  return code === '42501' || code.startsWith('23')
}

/**
 * Cierra el seguimiento intentando subir lo que quedó pendiente.
 *
 * Antes borraba la cola SIEMPRE, incluso cuando el envío acababa de fallar.
 * `drenarCola` era cuidadoso a propósito —sólo limpiaba si Postgres había
 * aceptado— y esta función tiraba abajo ese cuidado dos líneas después: el
 * recorrido de una tarde entera sin señal se perdía justo al terminar el día,
 * que es cuando el vendedor toca "finalizar".
 *
 * Ahora lo que no se pudo subir se queda en el teléfono. Se drena solo en el
 * próximo punto que se publique, o al arrancar el recorrido siguiente.
 */
async function vaciarCola(): Promise<void> {
  await drenarCola()
}

async function parametros(): Promise<{ intervaloSeg: number; distanciaMin: number }> {
  try {
    const { data } = await supabase
      .from('configuracion')
      .select('clave, valor')
      .in('clave', ['tracking_intervalo_seg', 'tracking_distancia_min_m'])

    const mapa = new Map((data ?? []).map((f: { clave: string; valor: unknown }) => [f.clave, Number(f.valor)]))
    return {
      intervaloSeg: mapa.get('tracking_intervalo_seg') ?? 20,
      distanciaMin: mapa.get('tracking_distancia_min_m') ?? 30,
    }
  } catch {
    return { intervaloSeg: 20, distanciaMin: 30 }
  }
}

/**
 * A partir de cuántos metros se considera que el vendedor llegó al destino.
 *
 * Sale de la base y no de una constante para que la oficina lo pueda mover sin
 * recompilar nada. Es el mismo valor con el que el servidor decide si una nota
 * de pedido se hizo en el lugar: si cada lado usara el suyo, la app podría
 * decirle "llegaste" a alguien de quien el panel dice que no estuvo ahí.
 */
export async function radioDeLlegadaM(): Promise<number> {
  try {
    const { data } = await supabase
      .from('configuracion')
      .select('valor')
      .eq('clave', 'llegada_radio_m')
      .maybeSingle()
    const n = Number((data as { valor: unknown } | null)?.valor)
    return Number.isFinite(n) && n > 0 ? n : 150
  } catch {
    return 150
  }
}

/**
 * Qué prioridad le toca a un destino que se agrega en el momento.
 *
 * ── Por qué ya no la elige el vendedor ──────────────────────────────────────
 *
 * Antes había que elegir entre ALTA, MEDIA y BAJA en un desplegable, y ALTA
 * prometía "se visita a continuación, sin importar la distancia". Eso convertía
 * una decisión de logística —¿conviene desviarse?— en una de urgencia, y las
 * dos no son la misma: un envío urgentísimo del otro lado del conurbano no
 * conviene meterlo al medio del recorrido, y uno que queda a tres cuadras
 * conviene aunque no corra apuro.
 *
 * Ahora la decide la distancia. Si el vendedor está cerca, el destino se clava
 * adelante y se desvía. Si no, entra a la ruta y la optimización de Google lo
 * ubica donde menos cuesta.
 *
 * ── El radio ────────────────────────────────────────────────────────────────
 *
 * Diez veces el radio de llegada: si "llegué" son 150 metros, "me queda de
 * paso" es un kilómetro y medio. No es un número exacto porque no hay uno
 * exacto — es el orden de magnitud de "estoy por acá".
 *
 * Sin señal devuelve `baja`: no saber dónde está el vendedor no es razón para
 * mandarlo a cruzar la ciudad.
 */
export async function prioridadPorCercania(lat: number, lng: number): Promise<'alta' | 'baja'> {
  try {
    const [donde, radio] = await Promise.all([ubicacionActual(), radioDeLlegadaM()])
    const metros = distanciaEnMetros(donde, { lat, lng })
    return metros <= radio * 10 ? 'alta' : 'baja'
  } catch {
    return 'baja'
  }
}
