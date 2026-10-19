import { numeroDeNotaImpreso } from '@woodtools/compartido'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { supabase } from '../nucleo/supabase'
import { obtenerImpresora } from '../nucleo/impresora'
import { usarAgenteDeImpresion } from '../nucleo/agenteImpresion'
import { describirOrden, renderizarOrden, type OrdenImpresion } from '../servicios/renderizarOrden'

/**
 * La cola de impresión de la oficina.
 *
 * Los vendedores mandan a imprimir desde el celular —notas de pedido, el rol de
 * visita, las cobranzas— y esta máquina lo saca en papel. Por qué acá y no en el
 * teléfono: el PDF del celular lo arma un WebView con el ajuste de letra del
 * equipo, así que la misma nota entra o se desborda según el teléfono; acá lo
 * arma Chromium a tamaño fijo y sale igual siempre.
 *
 * ─── Automático vs a mano ────────────────────────────────────────────────────
 *
 * Con el panel abierto, el AGENTE (`ProveedorAgenteImpresion`) imprime la cola
 * solo, en orden, sin que nadie toque nada. Esta pantalla muestra lo que está
 * pasando y deja apagar el automático para imprimir a mano fila por fila
 * (respaldo para cuando la impresora anda rara). El papel siempre sale directo a
 * la impresora por IPP; la nota/cobro se sella sólo cuando la impresora confirma.
 */
export function PaginaColaImpresion({ soloLectura }: { soloLectura: boolean }) {
  const cliente = useQueryClient()
  const agente = usarAgenteDeImpresion()
  const [mensaje, setMensaje] = useState<string | null>(null)
  const [trabajando, setTrabajando] = useState<string | null>(null)

  const puedeImprimir = agente.puedeImprimir

  const {
    data: ordenes,
    error: fallo,
    isLoading,
  } = useQuery({
    queryKey: ['cola-impresion'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ordenes_impresion')
        .select(
          'id, tipo, estado, con_rol_de_visita, motivo_fallo, creado_en, nota_id, pedida_por, parametros,' +
            ' nota:notas_pedido(numero, vendedor_numero, tipo_nota, cliente_codigo, cliente_nombre),' +
            ' pedida:perfiles!ordenes_impresion_pedida_por_fkey(nombre_completo, codigo_vendedor)',
        )
        .in('estado', ['pendiente', 'imprimiendo'])
        .order('creado_en', { ascending: true })
      if (error) throw error
      return (data ?? []) as unknown as OrdenFila[]
    },
    // La oficina deja esta pantalla abierta; además el agente invalida esta
    // consulta cada vez que resuelve una orden, así que se ve en vivo.
    refetchInterval: 15_000,
  })

  // El botón manual es el RESPALDO: sólo cuando el automático está apagado, para
  // que no se pisen (el agente reclamando una orden mientras alguien la imprime
  // a mano sacaría dos juegos). Rearma el documento con la misma función que el
  // agente y sella igual.
  const imprimir = useMutation({
    mutationFn: async (orden: OrdenFila) => {
      const imprimirDoc = window.woodtools?.imprimirDocumento
      if (!imprimirDoc) {
        throw new Error('Esta pantalla imprime sólo desde el programa de escritorio')
      }

      // RECLAMAR la orden atómico antes de imprimir: si el agente automático (o
      // la PC de otra oficina) ya la agarró, el reclamo vuelve vacío y no se
      // imprime, para no sacar dos juegos del mismo papel. A partir de acá la
      // orden es nuestra ('imprimiendo').
      const { data: tomadas, error: errorReclamo } = await supabase.rpc(
        'reclamar_orden_impresion',
        { p_orden_id: orden.id },
      )
      if (errorReclamo) throw errorReclamo
      const tomada = ((tomadas ?? []) as OrdenImpresion[])[0]
      if (!tomada) {
        throw new Error('Esa orden ya se está imprimiendo o se resolvió. Actualizá la lista.')
      }

      const doc = await renderizarOrden(tomada)
      if (!doc) {
        // No había nada que imprimir (rol de un día sin recorrido, etc.): se
        // cierra la orden para que no quede trabada en la cola.
        const { error } = await supabase.rpc('resolver_orden_impresion', {
          p_orden_id: tomada.id,
          p_ok: true,
          p_motivo: null,
        })
        if (error) throw error
        return { vacio: true as const }
      }

      const impresora = await obtenerImpresora()
      const salida = await imprimirDoc(doc.html, impresora, doc.tamano)

      // Cerrar la orden y sellar van juntas del lado de la base
      // (`resolver_orden_impresion`): un corte entre las dos dejaría papel impreso
      // con la nota pendiente. Si NO salió, se libera (la reclamamos, hay que
      // soltarla) y vuelve a 'pendiente' para reintentar.
      if (salida.impreso) {
        const { error } = await supabase.rpc('resolver_orden_impresion', {
          p_orden_id: tomada.id,
          p_ok: true,
          p_motivo: null,
        })
        if (error) throw error
      } else {
        await supabase.rpc('liberar_orden_impresion', {
          p_orden_id: tomada.id,
          p_motivo: salida.motivo ?? null,
        })
      }
      return salida
    },
    onMutate: (orden) => setTrabajando(orden.id),
    onSettled: () => setTrabajando(null),
    onSuccess: (salida, orden) => {
      void cliente.invalidateQueries({ queryKey: ['cola-impresion'] })
      if ('vacio' in salida) {
        setMensaje(`${describir(orden)}: no había nada para imprimir, se sacó de la cola.`)
        return
      }
      if (salida.impreso) {
        setMensaje(`${describir(orden)}: impreso.`)
      } else if (salida.via === 'ipp') {
        setMensaje(
          `La mandé a la impresora${salida.direccion ? ` (${salida.direccion})` : ''} pero no me confirmó` +
            `${salida.motivo ? `: ${salida.motivo}` : ''}. Fijate si salió el papel antes de reintentar. Sigue pendiente.`,
        )
      } else {
        setMensaje(`No salió: ${salida.motivo ?? 'se canceló'}. Sigue pendiente y queda para reintentar.`)
      }
    },
    onError: (e: Error) => setMensaje(`No se pudo imprimir: ${e.message}`),
  })

  // Las que quedaron FALLIDAS (un pedido que no salió tras varios intentos): no
  // se pierden, se muestran acá para que la oficina vea el motivo y reintente.
  const { data: falladas } = useQuery({
    queryKey: ['cola-impresion-falladas'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ordenes_impresion')
        .select(
          'id, tipo, estado, con_rol_de_visita, motivo_fallo, creado_en, nota_id, pedida_por, parametros,' +
            ' nota:notas_pedido(numero, vendedor_numero, tipo_nota, cliente_codigo, cliente_nombre),' +
            ' pedida:perfiles!ordenes_impresion_pedida_por_fkey(nombre_completo, codigo_vendedor)',
        )
        .eq('estado', 'fallida')
        .order('creado_en', { ascending: false })
        .limit(50)
      if (error) throw error
      return (data ?? []) as unknown as OrdenFila[]
    },
    refetchInterval: 30_000,
  })

  const reintentar = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('reencolar_orden_impresion', { p_orden_id: id })
      if (error) throw error
    },
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: ['cola-impresion'] })
      void cliente.invalidateQueries({ queryKey: ['cola-impresion-falladas'] })
      setMensaje('Volvió a la cola para reintentar.')
    },
    onError: (e: Error) => setMensaje(e.message),
  })

  const pendientes = ordenes ?? []
  const conFallo = falladas ?? []

  return (
    <section className="panel">
      <header className="encabezado-pagina">
        <h1>Cola de impresión</h1>
        <p>
          Lo que los vendedores mandaron a imprimir desde el celular: notas de pedido, rol de visita y
          cobranzas. El papel sale directo a la impresora de la oficina, sin diálogo y con el mismo
          tamaño siempre.
        </p>
      </header>

      {/* El automático y lo que está pasando ahora. */}
      <div className="tarjeta" style={{ marginBottom: 14, display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center', justifyContent: 'space-between' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}>
          <input
            type="checkbox"
            checked={agente.automatico}
            disabled={!puedeImprimir}
            onChange={(e) => agente.ponerAutomatico(e.target.checked)}
          />
          Imprimir automático (la PC saca la cola sola)
        </label>
        <div style={{ color: 'var(--tinta-suave)', fontSize: 14 }}>
          {!puedeImprimir
            ? 'Abierto fuera del programa de escritorio: se ve la cola pero no imprime.'
            : agente.imprimiendo
              ? `🖨 Imprimiendo: ${agente.imprimiendo}`
              : agente.automatico
                ? 'En espera de pedidos…'
                : 'Automático apagado: imprimí a mano con el botón de cada fila.'}
          {agente.ultimoError ? (
            <span style={{ color: 'var(--rojo-accion)', marginLeft: 10 }}>⚠ {agente.ultimoError}</span>
          ) : null}
        </div>
      </div>

      {mensaje ? <p className="aviso">{mensaje}</p> : null}

      <h2>Esperando ({pendientes.length})</h2>

      {fallo ? (
        <p className="vacio" style={{ color: 'var(--rojo-accion)' }}>
          No pudimos traer la cola: {(fallo as Error).message}. Nadie confirmó que esté vacía.
        </p>
      ) : isLoading ? (
        <p className="vacio">Buscando…</p>
      ) : pendientes.length === 0 ? (
        <p className="vacio">No hay nada esperando para imprimir.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Qué</th>
              <th>De quién</th>
              <th>Estado</th>
              <th>Hace</th>
              <th style={{ width: 150 }} />
            </tr>
          </thead>
          <tbody>
            {pendientes.map((o) => (
              <tr key={o.id}>
                <td>
                  <strong>{describir(o)}</strong>
                  {o.tipo === 'nota' ? (
                    <>
                      <br />
                      <small style={{ color: 'var(--tinta-tenue)' }}>
                        {o.nota?.cliente_nombre ?? 'cliente'}
                        {o.nota?.tipo_nota === 'factura' ? ' · Factura' : ' · Presupuesto'}
                        {o.con_rol_de_visita ? ' · con rol de visita' : ''}
                      </small>
                    </>
                  ) : null}
                </td>
                <td>{o.pedida?.nombre_completo ?? '—'}</td>
                <td>
                  {o.estado === 'imprimiendo' ? (
                    <span className="pastilla azul">Imprimiendo</span>
                  ) : (
                    <span className="pastilla gris">En cola</span>
                  )}
                  {o.motivo_fallo ? (
                    <>
                      <br />
                      <small style={{ color: 'var(--rojo-accion)' }}>{o.motivo_fallo}</small>
                    </>
                  ) : null}
                </td>
                <td>{haceCuanto(o.creado_en)}</td>
                <td>
                  <button
                    className="chico primario"
                    disabled={
                      soloLectura ||
                      !puedeImprimir ||
                      agente.automatico ||
                      o.estado === 'imprimiendo' ||
                      trabajando === o.id
                    }
                    title={
                      agente.automatico
                        ? 'Apagá el automático para imprimir a mano'
                        : o.estado === 'imprimiendo'
                          ? 'Ya se está imprimiendo'
                          : undefined
                    }
                    onClick={() => imprimir.mutate(o)}
                  >
                    {trabajando === o.id ? 'Imprimiendo…' : 'Imprimir'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Las fallidas: no desaparecen, quedan acá con el motivo y un botón para
          volver a mandarlas a la cola. */}
      {conFallo.length > 0 ? (
        <>
          <h2 style={{ marginTop: 26, color: 'var(--rojo-accion)' }}>Falladas ({conFallo.length})</h2>
          <p style={{ color: 'var(--tinta-suave)', fontSize: 14, marginTop: -8 }}>
            No salieron tras varios intentos. No se perdieron: mirá el motivo y reintentá.
          </p>
          <table>
            <thead>
              <tr>
                <th>Qué</th>
                <th>De quién</th>
                <th>Motivo</th>
                <th>Hace</th>
                <th style={{ width: 130 }} />
              </tr>
            </thead>
            <tbody>
              {conFallo.map((o) => (
                <tr key={o.id}>
                  <td>
                    <strong>{describir(o)}</strong>
                  </td>
                  <td>{o.pedida?.nombre_completo ?? '—'}</td>
                  <td>
                    <small style={{ color: 'var(--rojo-accion)' }}>
                      {o.motivo_fallo ?? 'No confirmó la impresora'}
                    </small>
                  </td>
                  <td>{haceCuanto(o.creado_en)}</td>
                  <td>
                    <button
                      className="chico"
                      disabled={soloLectura || reintentar.isPending}
                      onClick={() => reintentar.mutate(o.id)}
                    >
                      ↻ Reintentar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
    </section>
  )
}

interface OrdenFila extends OrdenImpresion {
  motivo_fallo: string | null
  nota: {
    numero: number | null
    /** Va adelante del número: la nota 81 del vendedor 2 es la `02-0081`. */
    vendedor_numero: string | null
    tipo_nota: string
    cliente_codigo: string | null
    cliente_nombre: string | null
  } | null
  pedida: { nombre_completo: string; codigo_vendedor: string | null } | null
}

/**
 * Qué es la orden, en una línea. La nota se nombra por su número (o por el
 * cliente si todavía no la numeró Administración); el rol y las cobranzas por su
 * fecha (lo arma `describirOrden`).
 */
function describir(o: OrdenFila): string {
  if (o.tipo === 'nota') {
    if (o.nota?.numero) return `Nota N° ${numeroDeNotaImpreso(o.nota.numero, o.nota.vendedor_numero)}`
    return `Nota sin numerar · ${o.nota?.cliente_nombre ?? 'cliente nuevo'}`
  }
  return describirOrden(o)
}

function haceCuanto(iso: string): string {
  const minutos = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (minutos < 1) return 'recién'
  if (minutos < 60) return `${minutos} min`
  const horas = Math.round(minutos / 60)
  return horas < 24 ? `${horas} h` : `${Math.round(horas / 24)} d`
}
