import { useEffect, type ReactNode } from 'react'

import type { EventoTelemetria } from '@woodtools/compartido'

import { supabase } from './supabase'

/**
 * Telemetría de tiempos de uso (panel de escritorio).
 *
 * Cronometra cuánto tiempo pasa cada usuario en cada sección del panel, y —en las
 * páginas con sub-opciones— en cada sub-paso (ver `useTelemetriaPaso`). Espejo del
 * servicio del móvil: dos trackers independientes (sección y sub-paso) y una cola
 * que se drena en lote por la RPC `registrar_eventos_telemetria`.
 *
 * La MEDICIÓN corre para todos los que entran al panel; quién ve el reporte lo
 * decide el flag `perfiles.ve_reporte_tiempos`. Es best-effort: nunca rompe la UI.
 *
 * Difiere del móvil en dos cosas: la cola va en `localStorage` (sincrónico) y el
 * panel queda abierto días, así que además de la navegación se cierra el tramo al
 * ocultar la ventana (`visibilitychange`) y al cerrarla (`beforeunload`).
 */

const CLAVE_COLA = 'woodtools.cola_telemetria_panel'
/** Tope de la cola: si se pasa, se descartan los eventos más viejos. */
const MAX_EN_COLA = 2000
/** Cuando la cola llega a esto, se intenta drenar sin esperar al intervalo. */
const UMBRAL_FLUSH = 25
/** Tramos más cortos que esto se descartan: son de paso, no uso real. */
const MINIMO_MS = 500

interface Tramo {
  seccion: string | null
  paso: string | null
  inicio: number | null
}

/** En la cola cada evento lleva de quién es, para no atribuirlo a otra cuenta al drenar. */
interface EventoEncolado extends EventoTelemetria {
  _perfil_id: string
}

const tramoSeccion: Tramo = { seccion: null, paso: null, inicio: null }
const tramoPaso: Tramo = { seccion: null, paso: null, inicio: null }
let uidActual: string | null = null
let enviando = false

function leerCola(): EventoEncolado[] {
  try {
    const crudo = localStorage.getItem(CLAVE_COLA)
    return crudo ? (JSON.parse(crudo) as EventoEncolado[]) : []
  } catch {
    return []
  }
}

function escribirCola(cola: EventoEncolado[]): void {
  try {
    localStorage.setItem(CLAVE_COLA, JSON.stringify(cola.slice(-MAX_EN_COLA)))
  } catch {
    // Sin localStorage (modo privado, cuota): la telemetría se pierde, no rompe.
  }
}

function cerrar(tramo: Tramo): void {
  if (tramo.inicio == null || !tramo.seccion) {
    tramo.inicio = null
    return
  }
  const duracion = Date.now() - tramo.inicio
  tramo.inicio = null
  if (duracion < MINIMO_MS) return
  encolar(tramo.seccion, tramo.paso, duracion)
}

function abrir(tramo: Tramo, seccion: string, paso: string | null): void {
  cerrar(tramo)
  tramo.seccion = seccion
  tramo.paso = paso
  tramo.inicio = Date.now()
}

/** Marca la sección actual (pathname). `null` cierra sin abrir otra. */
export function marcarSeccion(seccion: string | null): void {
  if (!seccion) {
    cerrar(tramoSeccion)
    tramoSeccion.seccion = null
    return
  }
  if (tramoSeccion.seccion === seccion && tramoSeccion.inicio != null) return
  abrir(tramoSeccion, seccion, null)
}

/** Marca el sub-paso actual dentro de una sección. `null` lo cierra. */
export function marcarPasoPanel(seccion: string, paso: string | null): void {
  if (!paso) {
    cerrar(tramoPaso)
    tramoPaso.seccion = null
    tramoPaso.paso = null
    return
  }
  abrir(tramoPaso, seccion, paso)
}

function pausar(): void {
  cerrar(tramoSeccion)
  cerrar(tramoPaso)
}

function reanudar(): void {
  if (tramoSeccion.seccion && tramoSeccion.inicio == null) tramoSeccion.inicio = Date.now()
  if (tramoPaso.seccion && tramoPaso.paso && tramoPaso.inicio == null) tramoPaso.inicio = Date.now()
}

function encolar(seccion: string, paso: string | null, duracion_ms: number): void {
  try {
    if (!uidActual) return
    const evento: EventoEncolado = {
      _perfil_id: uidActual,
      plataforma: 'panel',
      seccion,
      paso: paso ?? null,
      inicio: new Date(Date.now() - duracion_ms).toISOString(),
      duracion_ms,
      version_app: null,
    }
    const cola = leerCola()
    cola.push(evento)
    escribirCola(cola)
    if (cola.length >= UMBRAL_FLUSH) void flush()
  } catch {
    // La telemetría nunca debe romper la UI.
  }
}

/** Vacía la cola a la base por RPC. Sólo manda los eventos de la cuenta ACTIVA. */
export async function flush(): Promise<void> {
  if (enviando) return
  enviando = true
  try {
    const cola = leerCola()
    if (cola.length === 0) return
    const {
      data: { session },
    } = await supabase.auth.getSession()
    const uid = session?.user?.id
    if (!uid) return
    const propios = cola.filter((e) => e._perfil_id === uid)
    if (propios.length === 0) {
      localStorage.removeItem(CLAVE_COLA)
      return
    }
    const eventos = propios.map(({ _perfil_id, ...e }) => e)
    const { error } = await supabase.rpc('registrar_eventos_telemetria', { p_eventos: eventos })
    if (error) return
    const resto = cola.filter((e) => e._perfil_id !== uid)
    if (resto.length === 0) localStorage.removeItem(CLAVE_COLA)
    else escribirCola(resto)
  } catch {
    // Best-effort: la cola queda para el próximo intento.
  } finally {
    enviando = false
  }
}

/**
 * Cuelga la telemetría de tiempos del panel. Abre el tramo de la sección en cada
 * cambio de `pathname`, y cierra/drena al ocultar o cerrar la ventana.
 */
export function ProveedorTelemetria({
  perfilId,
  pathname,
  children,
}: {
  perfilId: string | null
  pathname: string
  children: ReactNode
}) {
  useEffect(() => {
    uidActual = perfilId
    if (!perfilId) pausar()
  }, [perfilId])

  useEffect(() => {
    if (perfilId) marcarSeccion(pathname)
  }, [pathname, perfilId])

  useEffect(() => {
    const reloj = setInterval(() => void flush(), 60_000)
    const alCambiarVisibilidad = () => {
      if (document.visibilityState === 'hidden') {
        pausar()
        void flush()
      } else {
        reanudar()
      }
    }
    const alCerrar = () => {
      pausar()
      void flush()
    }
    document.addEventListener('visibilitychange', alCambiarVisibilidad)
    window.addEventListener('beforeunload', alCerrar)
    void flush() // drena lo que haya quedado de una sesión anterior
    return () => {
      clearInterval(reloj)
      document.removeEventListener('visibilitychange', alCambiarVisibilidad)
      window.removeEventListener('beforeunload', alCerrar)
      pausar()
      void flush()
    }
  }, [])

  return <>{children}</>
}

/**
 * Mide el tiempo en un sub-paso dentro de una sección del panel (p.ej. el editor
 * de nota). Al desmontar o cambiar el paso, lo cierra.
 */
export function useTelemetriaPaso(seccion: string, paso: string | null): void {
  useEffect(() => {
    marcarPasoPanel(seccion, paso)
    return () => marcarPasoPanel(seccion, null)
  }, [seccion, paso])
}
