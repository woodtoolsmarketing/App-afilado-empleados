import { useQueryClient } from '@tanstack/react-query'
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'

import { supabase } from './supabase'
import { obtenerImpresora } from './impresora'
import { describirOrden, renderizarOrden, type OrdenImpresion } from '../servicios/renderizarOrden'

/**
 * El agente de impresión: la PC de la oficina imprime la cola sola.
 *
 * ─── Qué hace ────────────────────────────────────────────────────────────────
 *
 * Con el panel abierto, un loop reclama la orden pendiente más vieja
 * (`tomar_siguiente_orden`, atómico: dos PCs no imprimen la misma), arma el
 * documento según el tipo (nota / rol / cobranzas) y lo manda por IPP a la
 * impresora activa, sin que nadie toque nada. Al confirmar el papel, sella lo
 * que corresponda (`resolver_orden_impresion`).
 *
 * ─── Reintentos y anti-trabazón ──────────────────────────────────────────────
 *
 * Si la impresora no contesta, la orden se LIBERA (vuelve a la cola) y se espera
 * un rato antes de reintentar: cuando la impresora vuelve, sale sola. Para que
 * un pedido imposible (datos rotos) no trabe la cola para siempre —siempre es el
 * más viejo, siempre se reclama primero—, tras varios fallos del MISMO pedido se
 * lo marca fallido y se pasa al que sigue.
 *
 * ─── Dónde corre ─────────────────────────────────────────────────────────────
 *
 * Sólo en el panel INSTALADO (necesita `window.woodtools.imprimirDocumento`, el
 * puente con el proceso principal). Abierto en un navegador no reclama nada.
 */

const CLAVE_ACTIVO = 'cola-impresion.automatico'

const ESPERA_OCIOSA = 4_000 // la cola está vacía: cada cuánto volver a mirar
const ESPERA_SIGUIENTE = 600 // acaba de salir una: puede haber más, mirar ya
const ESPERA_ERROR = 20_000 // la impresora no contestó: esperar antes de reintentar
const MAX_FALLOS = 3 // fallos del MISMO pedido antes de darlo por perdido

interface EstadoAgente {
  /** Si el agente imprime solo. Se guarda por PC (localStorage), arranca prendido. */
  automatico: boolean
  ponerAutomatico: (v: boolean) => void
  /** El panel instalado puede imprimir; el navegador no. */
  puedeImprimir: boolean
  /** Lo que se está imprimiendo ahora, o null. */
  imprimiendo: string | null
  /** El último problema (impresora apagada, etc.), para mostrarlo. */
  ultimoError: string | null
}

const Contexto = createContext<EstadoAgente | null>(null)

export function usarAgenteDeImpresion(): EstadoAgente {
  const ctx = useContext(Contexto)
  if (!ctx) throw new Error('usarAgenteDeImpresion fuera de ProveedorAgenteImpresion')
  return ctx
}

function mensajeDe(e: unknown): string {
  return e instanceof Error ? e.message : 'No se pudo imprimir.'
}

function leerActivo(): boolean {
  try {
    // Arranca prendido: si nunca se tocó, la oficina imprime sola.
    return localStorage.getItem(CLAVE_ACTIVO) !== 'no'
  } catch {
    return true
  }
}

export function ProveedorAgenteImpresion({ children }: { children: ReactNode }) {
  const cliente = useQueryClient()
  const puedeImprimir = typeof window.woodtools?.imprimirDocumento === 'function'

  const [automatico, setAutomatico] = useState(leerActivo)
  const [imprimiendo, setImprimiendo] = useState<string | null>(null)
  const [ultimoError, setUltimoError] = useState<string | null>(null)

  // El loop lee el estado por ref para no reiniciarse cada vez que se toca el
  // switch o cambia lo que se está imprimiendo.
  const automaticoRef = useRef(automatico)
  automaticoRef.current = automatico
  const fallos = useRef(new Map<string, number>())

  function ponerAutomatico(v: boolean) {
    setAutomatico(v)
    try {
      localStorage.setItem(CLAVE_ACTIVO, v ? 'si' : 'no')
    } catch {
      /* sin localStorage igual anda, sólo no recuerda la preferencia */
    }
  }

  useEffect(() => {
    if (!puedeImprimir) return
    let cancelado = false
    let timer: ReturnType<typeof setTimeout> | null = null

    /**
     * Fallo TRANSITORIO de impresora: la orden vuelve a la cola y espera a que la
     * impresora vuelva —sale sola cuando contesta—. NO cuenta hacia el tope: una
     * impresora apagada no es un pedido roto, y marcarla 'fallida' la sacaría de
     * la cola (la nota/cobro se perdería sin imprimirse). Reintento indefinido.
     */
    async function soltar(orden: OrdenImpresion, motivo: string): Promise<number> {
      try {
        await supabase.rpc('liberar_orden_impresion', { p_orden_id: orden.id, p_motivo: motivo })
      } catch {
        // Si ni liberar anda (red caída), la orden queda 'imprimiendo' y la
        // rescata el reclaim de 2 minutos de `tomar_siguiente_orden`.
      }
      setUltimoError(motivo)
      return ESPERA_ERROR
    }

    /**
     * Fallo al ARMAR el documento (una excepción, no la impresora): puede ser un
     * pedido con datos rotos. Se cuenta, y tras `MAX_FALLOS` del MISMO pedido se
     * lo marca 'fallida' para que no trabe la cola —siempre es el más viejo,
     * siempre se reclama primero—. La fallida NO se pierde: se ve y se reintenta
     * desde el panel (`reencolar_orden_impresion`). Mientras tanto, libera.
     */
    async function fallo(orden: OrdenImpresion, motivo: string): Promise<number> {
      const previos = (fallos.current.get(orden.id) ?? 0) + 1
      fallos.current.set(orden.id, previos)
      try {
        if (previos >= MAX_FALLOS) {
          await supabase.rpc('resolver_orden_impresion', {
            p_orden_id: orden.id,
            p_ok: false,
            p_motivo: `${motivo} (tras ${previos} intentos)`,
          })
          fallos.current.delete(orden.id)
        } else {
          await supabase.rpc('liberar_orden_impresion', { p_orden_id: orden.id, p_motivo: motivo })
        }
      } catch {
        // Si ni liberar/resolver andan (red caída), la rescata el reclaim de 2 min.
      }
      setUltimoError(motivo)
      return ESPERA_ERROR
    }

    async function procesar(orden: OrdenImpresion): Promise<number> {
      setImprimiendo(describirOrden(orden))
      try {
        const doc = await renderizarOrden(orden)
        if (!doc) {
          // No había nada que imprimir (un rol de un día sin recorrido, una
          // rendición sin cobros): se cierra la orden, hecha, sin papel.
          await supabase.rpc('resolver_orden_impresion', {
            p_orden_id: orden.id,
            p_ok: true,
            p_motivo: null,
          })
          fallos.current.delete(orden.id)
          return ESPERA_SIGUIENTE
        }

        const impresora = await obtenerImpresora()
        const salida = await window.woodtools!.imprimirDocumento!(doc.html, impresora, doc.tamano)

        if (salida.impreso) {
          await supabase.rpc('resolver_orden_impresion', {
            p_orden_id: orden.id,
            p_ok: true,
            p_motivo: null,
          })
          fallos.current.delete(orden.id)
          setUltimoError(null)
          return ESPERA_SIGUIENTE
        }

        // Viajó pero no confirmó, o no hay impresora y cayó al diálogo: es un
        // problema de IMPRESORA (transitorio), se suelta y espera a que vuelva.
        return await soltar(orden, salida.motivo ?? 'La impresora no confirmó el trabajo.')
      } catch (e) {
        // Excepción al armar/mandar el documento: puede ser un pedido roto, se cuenta.
        return await fallo(orden, mensajeDe(e))
      } finally {
        setImprimiendo(null)
        void cliente.invalidateQueries({ queryKey: ['cola-impresion'] })
      }
    }

    async function tick() {
      if (cancelado) return
      let espera = ESPERA_OCIOSA
      if (automaticoRef.current) {
        try {
          const { data } = await supabase.rpc('tomar_siguiente_orden')
          const orden = ((data ?? []) as OrdenImpresion[])[0] ?? null
          if (orden) espera = await procesar(orden)
        } catch (e) {
          setUltimoError(mensajeDe(e))
          espera = ESPERA_ERROR
        }
      }
      if (!cancelado) timer = setTimeout(tick, espera)
    }

    void tick()
    return () => {
      cancelado = true
      if (timer) clearTimeout(timer)
    }
  }, [puedeImprimir, cliente])

  return (
    <Contexto.Provider
      value={{ automatico, ponerAutomatico, puedeImprimir, imprimiendo, ultimoError }}
    >
      {children}
    </Contexto.Provider>
  )
}
