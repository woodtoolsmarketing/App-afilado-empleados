import * as Battery from 'expo-battery'
import * as Location from 'expo-location'
import * as TaskManager from 'expo-task-manager'

import { distanciaEnMetros, fechaLocalISO } from '@woodtools/compartido'

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
   * El recorrido en curso, o `null` cuando se rastrea 24/7 (flag por vendedor
   * `seguimiento_24_7`) SIN un recorrido: los puntos van al histórico con
   * `rol_visita_id` nulo y al pin en vivo con `en_recorrido:false`.
   */
  rolVisitaId: string | null
  /**
   * El día local (Argentina) de la jornada. En modo RECORRIDO la tarea corta el
   * seguimiento cuando el reloj pasa a otro día (un recorrido que no se finaliza
   * no debe seguir rastreando noches y fines de semana). En modo 24/7 NO se
   * corta por el día: ése es justamente el punto. Puede faltar en un contexto
   * viejo; ahí se trata como "sin fecha" y no se corta por este motivo.
   */
  fecha?: string
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

/**
 * Arranca la tarea en segundo plano si todavía no está corriendo.
 *
 * La notificación del foreground service es lo que el vendedor VE mientras se lo
 * rastrea, y tiene que ser HONESTA: en modo 24/7 (`esRecorrido` false) dice que
 * la oficina ve su ubicación mientras el seguimiento esté activo, SIN mentir que
 * hay un "recorrido en curso". En recorrido mantiene su texto de siempre. (Que
 * la oficina pueda ver la ubicación es cierto en los dos modos, así que si la
 * tarea ya venía corriendo y no se reescribe la notificación, igual es honesta.)
 */
async function arrancarTarea(esRecorrido: boolean): Promise<void> {
  const yaCorriendo = await Location.hasStartedLocationUpdatesAsync(TAREA_UBICACION)
  if (yaCorriendo) return

  const { intervaloSeg, distanciaMin } = await parametros()

  await Location.startLocationUpdatesAsync(TAREA_UBICACION, {
    accuracy: Location.Accuracy.Balanced,
    timeInterval: intervaloSeg * 1000,
    distanceInterval: distanciaMin,
    // Sin esto, Android mata el seguimiento apenas se apaga la pantalla.
    foregroundService: {
      notificationTitle: esRecorrido
        ? 'WoodTools · recorrido en curso'
        : 'WoodTools · seguimiento activo',
      notificationBody: esRecorrido
        ? 'La oficina puede ver tu ubicación mientras dure el recorrido.'
        : 'La oficina puede ver tu ubicación mientras el seguimiento esté activo.',
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
  // El día local queda grabado en el contexto: es contra esto que la tarea
  // decide cortar cuando cambia el día. Si el llamador no lo pasa, es el de hoy
  // (que es cuando se inicia o se reanuda una jornada).
  const conFecha: ContextoSeguimiento = {
    ...contexto,
    fecha: contexto.fecha ?? fechaLocalISO(new Date()),
  }
  await cacheLocal.setItem(CLAVE_CONTEXTO, JSON.stringify(conFecha))
  await arrancarTarea(contexto.rolVisitaId !== null)
}

export async function detenerSeguimiento(vendedorId?: string): Promise<void> {
  const corriendo = await Location.hasStartedLocationUpdatesAsync(TAREA_UBICACION).catch(() => false)
  if (corriendo) await Location.stopLocationUpdatesAsync(TAREA_UBICACION)

  await cacheLocal.removeItem(CLAVE_CONTEXTO)
  await vaciarCola()

  if (vendedorId) {
    await supabase
      .from('posiciones_actuales')
      .update({ en_recorrido: false, activo: false, actualizado_en: new Date().toISOString() })
      .eq('vendedor_id', vendedorId)
      .then(undefined, () => undefined)
  }
}

export async function seguimientoActivo(): Promise<boolean> {
  return Location.hasStartedLocationUpdatesAsync(TAREA_UBICACION).catch(() => false)
}

// ─────────────────────────────────────────────────────────────────────────────
// Seguimiento 24/7 (flag por vendedor `seguimiento_24_7`)
// ─────────────────────────────────────────────────────────────────────────────
//
// Reusa EL MISMO task que el recorrido; la diferencia es el contexto
// (`rolVisitaId` null, `en_recorrido` false) y quién lo prende/apaga: el flag
// por vendedor, no el inicio/fin del recorrido. Lo prende la oficina con el
// comando `amrheadlock` del panel, de a uno, para los teléfonos de prueba.

/** Si ESTE vendedor tiene el 24/7 prendido (flag `perfiles.seguimiento_24_7`). */
async function seguimiento24_7Prendido(): Promise<boolean> {
  try {
    const { data } = await supabase.auth.getSession()
    const id = data.session?.user.id
    if (!id) return false
    const { data: perfil } = await supabase
      .from('perfiles')
      .select('seguimiento_24_7')
      .eq('id', id)
      .maybeSingle()
    return !!(perfil as { seguimiento_24_7?: boolean } | null)?.seguimiento_24_7
  } catch {
    return false
  }
}

/** ¿Está concedido el permiso de ubicación en segundo plano ("permitir siempre")? */
async function permisoDeFondo(): Promise<boolean> {
  try {
    return (await Location.getBackgroundPermissionsAsync()).granted
  } catch {
    return false
  }
}

/**
 * Prende o apaga el seguimiento 24/7 según el flag del vendedor.
 *
 * Se llama al loguearse, al volver la app al frente, y por un reloj cada pocos
 * minutos (para no depender de un solo evento). NO pisa un recorrido en curso:
 * si la tarea ya corre en modo recorrido (rolVisitaId set), la deja —ese lo
 * cierra "finalizar"—, y sólo corta cuando lo que corre es el 24/7 (rolVisitaId
 * null) y ya no corresponde (flag apagado o dejó de estar habilitado).
 */
export async function revisarSeguimiento(habilitado: boolean): Promise<void> {
  const activo = await seguimientoActivo()
  const debe = habilitado && (await seguimiento24_7Prendido())

  if (debe && !activo) {
    // Sin el permiso "siempre" no se puede: se pide aparte (al loguearse) y acá
    // sólo se arranca cuando ya está concedido.
    if (!(await permisoDeFondo())) return
    const { data } = await supabase.auth.getSession()
    const vendedorId = data.session?.user.id
    if (!vendedorId) return
    await iniciarSeguimiento({ vendedorId, rolVisitaId: null })
    return
  }

  if (!debe && activo) {
    const ctx = await leerContexto()
    // Sólo corta el 24/7 (rolVisitaId null). Un recorrido explícito no se toca:
    // lo cierra "finalizar". Sin contexto, se corta igual (estado inconsistente).
    if (!ctx || ctx.rolVisitaId === null) {
      await detenerSeguimiento(ctx?.vendedorId)
    }
  }
}

/**
 * Pide el permiso "permitir siempre" una vez, para que el 24/7 pueda andar.
 *
 * Sólo lo pide a quien TIENE el flag prendido (no se le pide a toda la flota el
 * permiso más invasivo de Android por una función que no usan). Se llama al
 * loguearse. Si ya está concedido, o ya se preguntó una vez en este teléfono, no
 * molesta de nuevo.
 */
const CLAVE_PIDIO_PERMISO = 'woodtools.pidio_permiso_24_7'
export async function pedirPermisoDeSeguimientoSiFalta(): Promise<void> {
  try {
    if (!(await seguimiento24_7Prendido())) return
    if (await permisoDeFondo()) return
    if (await cacheLocal.getItem(CLAVE_PIDIO_PERMISO)) return
    await cacheLocal.setItem(CLAVE_PIDIO_PERMISO, '1')
    await pedirPermisosUbicacion()
    // El arranque queda a cargo de `revisarSeguimiento`, que el llamador corre
    // justo después: así no se dispara dos veces.
  } catch {
    // Que falle pedir el permiso no puede tumbar el arranque de la app.
  }
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

  // En modo RECORRIDO: si el día local ya no es el de la jornada, se corta acá
  // —un recorrido que no se finalizó no tiene que seguir rastreando la noche ni
  // atribuir puntos de hoy a la jornada de ayer—. En modo 24/7 (rolVisitaId
  // null) NO se corta por el día: el seguimiento es continuo a propósito.
  if (
    contexto.rolVisitaId !== null &&
    contexto.fecha &&
    fechaLocalISO(new Date(ultima.timestamp)) !== contexto.fecha
  ) {
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
      // modo 24/7 (rol_visita_id null) va en false: se rastrea, pero no hay ruta.
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
