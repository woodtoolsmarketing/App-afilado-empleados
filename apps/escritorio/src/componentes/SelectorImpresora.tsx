import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { supabase } from '../nucleo/supabase'

/**
 * El apartado "IMPRESORA A UTILIZAR", arriba de todo en la barra lateral.
 *
 * ─── Qué hace ────────────────────────────────────────────────────────────────
 *
 * Deja elegir a qué impresora de la oficina sale TODO lo que se imprime —el
 * panel y también el teléfono—, entre las que están cargadas. No es un ajuste
 * sólo del panel: la elegida se guarda en `configuracion.impresora_oficina`, que
 * es la misma fila que leen la cola de impresión, los roles, las cobranzas y la
 * app del vendedor. Cambiarla acá reapunta a todos de una.
 *
 * ─── Por qué un RPC y no un UPDATE directo ───────────────────────────────────
 *
 * Escribir `configuracion` es sólo-admin por RLS, pero quien imprime en la
 * oficina es administración. El RPC `elegir_impresora` (SECURITY DEFINER) deja
 * elegir a admin Y administración, y sólo entre las IPs del catálogo curado
 * (`configuracion.impresoras`): nadie puede inyectar una dirección a mano por
 * este camino.
 */

interface Impresora {
  nombre?: string
  ip: string
  puerto?: number
  ruta?: string
}

/** El catálogo de impresoras y cuál está activa, de `configuracion`. */
async function leerImpresoras(): Promise<{ catalogo: Impresora[]; activa: Impresora | null }> {
  const { data, error } = await supabase
    .from('configuracion')
    .select('clave, valor')
    .in('clave', ['impresoras', 'impresora_oficina'])

  // Si la lectura falla (red caída, token vencido), se LANZA el error en vez de
  // devolver vacío: así react-query reintenta y, mientras, conserva el último
  // dato bueno —el apartado no desaparece de golpe por un blip—. Devolver
  // `{catalogo:[],activa:null}` ante un error lo hacía esfumarse en silencio.
  if (error) throw error

  const filas = (data ?? []) as Array<{ clave: string; valor: unknown }>
  const catRaw = filas.find((f) => f.clave === 'impresoras')?.valor
  const actRaw = filas.find((f) => f.clave === 'impresora_oficina')?.valor

  const catalogo = Array.isArray(catRaw) ? (catRaw as Impresora[]).filter((i) => i && i.ip) : []
  const activa =
    actRaw && typeof actRaw === 'object' && (actRaw as Impresora).ip ? (actRaw as Impresora) : null
  return { catalogo, activa }
}

function etiqueta(i: Impresora | null): string {
  if (!i) return 'Sin impresora'
  return i.nombre ? `${i.nombre} · ${i.ip}` : i.ip
}

export function SelectorImpresora({ puedeElegir }: { puedeElegir: boolean }) {
  const cliente = useQueryClient()
  const [abierto, setAbierto] = useState(false)

  const { data } = useQuery({
    queryKey: ['impresora-config'],
    queryFn: leerImpresoras,
    // La impresora no cambia a cada rato; con que se refresque cada tanto alcanza
    // para que si la cambió otra PC, acá se vea sin recargar el panel.
    refetchInterval: 60_000,
  })

  const elegir = useMutation({
    mutationFn: async (ip: string) => {
      const { error } = await supabase.rpc('elegir_impresora', { p_ip: ip })
      if (error) throw error
    },
    onSuccess: () => {
      setAbierto(false)
      void cliente.invalidateQueries({ queryKey: ['impresora-config'] })
    },
  })

  const catalogo = data?.catalogo ?? []
  const activa = data?.activa ?? null

  // Sin catálogo cargado no hay nada que elegir: no se muestra el apartado para
  // no ocupar lugar con algo que no hace nada.
  if (catalogo.length === 0 && !activa) return null

  // Quien no puede elegir (ni admin ni administración) igual ve cuál está activa,
  // pero sin desplegable: es informativo, no una acción que le vaya a funcionar.
  const interactivo = puedeElegir && catalogo.length > 0

  return (
    <div className="selector-impresora">
      <div className="selector-impresora-titulo">Impresora a utilizar</div>

      <button
        type="button"
        className="selector-impresora-boton"
        disabled={!interactivo || elegir.isPending}
        onClick={() => interactivo && setAbierto((v) => !v)}
        title={interactivo ? 'Elegir a qué impresora sale todo lo que se imprime' : undefined}
      >
        <span aria-hidden>🖨</span>
        <span className="selector-impresora-nombre">
          {elegir.isPending ? 'Cambiando…' : etiqueta(activa)}
        </span>
        {interactivo ? <span aria-hidden className="selector-impresora-flecha">{abierto ? '▲' : '▼'}</span> : null}
      </button>

      {abierto && interactivo ? (
        <>
          {/* Un fondo invisible detrás del menú: tocar afuera lo cierra, sin
              atrapar los clics del resto del panel. */}
          <div className="selector-impresora-fondo" onClick={() => setAbierto(false)} />
          <div className="selector-impresora-menu" role="listbox">
            {catalogo.map((i) => {
              const esActiva = activa?.ip === i.ip
              return (
                <button
                  key={i.ip}
                  type="button"
                  role="option"
                  aria-selected={esActiva}
                  className={`selector-impresora-opcion${esActiva ? ' activa' : ''}`}
                  disabled={elegir.isPending}
                  onClick={() => (esActiva ? setAbierto(false) : elegir.mutate(i.ip))}
                >
                  <span className="selector-impresora-tilde" aria-hidden>{esActiva ? '✓' : ''}</span>
                  <span>
                    {i.nombre ? <strong>{i.nombre}</strong> : null}
                    <small>{i.ip}</small>
                  </span>
                </button>
              )
            })}
          </div>
        </>
      ) : null}

      {elegir.isError ? (
        <div className="selector-impresora-error">
          {(elegir.error as Error)?.message ?? 'No se pudo cambiar la impresora.'}
        </div>
      ) : null}
    </div>
  )
}
