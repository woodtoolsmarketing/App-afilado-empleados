import {
  generarDocumentoImpresion,
  notaImprimibleDesdeFila,
  type OpcionesImpresion,
} from '@woodtools/compartido'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { supabase } from '../nucleo/supabase'

/**
 * Lo que los vendedores mandaron a imprimir a la oficina.
 *
 * ─── Por qué la nota la imprime esta máquina y no el teléfono ────────────────
 *
 * Imprimir desde el celular sale distinto en cada teléfono. El PDF lo arma un
 * WebView de Android al que el sistema le aplica el ajuste de letra del equipo,
 * así que las letras crecen y las cajas en milímetros no: la misma nota entra
 * en una hoja o se desborda según cómo tenga configurada la pantalla el
 * vendedor. Acá el documento lo arma Chromium con el tamaño que pide la
 * plantilla, sin nada del sistema operativo en el medio, y sale igual siempre.
 *
 * La orden es un pedido, no una impresión. La nota se sella recién cuando esta
 * pantalla confirma que el papel salió, y eso lo decide la persona que está
 * mirando la impresora —el diálogo de impresión aparece a propósito—. Si el
 * papel se trabó, se contesta que no salió y la nota sigue pendiente.
 */
export function PaginaColaImpresion({ soloLectura }: { soloLectura: boolean }) {
  const cliente = useQueryClient()
  const [mensaje, setMensaje] = useState<string | null>(null)
  const [trabajando, setTrabajando] = useState<string | null>(null)

  const puedeImprimir = typeof window.woodtools?.imprimirDocumento === 'function'

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
          // El nombre de la clave foránea va explícito: `ordenes_impresion`
          // toca `perfiles` sólo por `pedida_por`, pero si mañana se agrega
          // otra columna que apunte ahí, pedir "perfiles" a secas rompería la
          // consulta entera y en silencio. Ya pasó con `dispositivos`.
          'id, estado, con_rol_de_visita, motivo_fallo, creado_en, nota_id,' +
            ' nota:notas_pedido(numero, tipo_nota, estado, cliente_codigo, cliente_nombre, total),' +
            ' pedida:perfiles!ordenes_impresion_pedida_por_fkey(nombre_completo, codigo_vendedor)',
        )
        .in('estado', ['pendiente', 'imprimiendo'])
        .order('creado_en', { ascending: true })
      if (error) throw error
      return (data ?? []) as unknown as OrdenFila[]
    },
    // La oficina deja esta pantalla abierta: se refresca sola para que el
    // pedido de un vendedor aparezca sin que nadie recargue nada.
    refetchInterval: 15_000,
  })

  const imprimir = useMutation({
    mutationFn: async (orden: OrdenFila) => {
      if (!window.woodtools?.imprimirDocumento) {
        throw new Error('Esta pantalla imprime sólo desde el programa de escritorio')
      }

      // La nota entera, con sus renglones y su vendedor: es lo que necesita la
      // plantilla para armar las dos copias.
      const { data: nota, error } = await supabase
        .from('notas_pedido')
        .select(
          '*, items:notas_pedido_items(*),' +
            ' vendedor:perfiles!notas_pedido_vendedor_id_fkey(nombre_completo, codigo_vendedor)',
        )
        .eq('id', orden.nota_id)
        .single()
      if (error) throw error

      const fila = nota as unknown as Record<string, unknown>
      const imprimible = notaImprimibleDesdeFila(fila)
      // El logo va en las DOS copias de una factura, como en el talonario
      // preimpreso: el original del cliente y el duplicado del taller.
      const conLogo = fila.tipo_nota === 'factura'
      const copias: OpcionesImpresion[] = [
        { copia: 'original', conLogo },
        { copia: 'duplicado', conLogo },
      ]

      // Sin `escalaDeLetra`: en la PC el navegador no le aplica al documento el
      // tamaño de letra del sistema, así que no hay nada que descontar.
      const html = generarDocumentoImpresion(
        copias.map((o) => ({ nota: imprimible, opciones: o })),
      )

      const salida = await window.woodtools.imprimirDocumento(html)

      // Cerrar la orden y sellar la nota van juntas, del lado de la base: si se
      // hicieran por separado, un corte entre las dos dejaría papel impreso con
      // la nota figurando pendiente.
      const { error: falloResolver } = await supabase.rpc('resolver_orden_impresion', {
        p_orden_id: orden.id,
        p_ok: salida.impreso,
        p_motivo: salida.impreso ? null : (salida.motivo ?? 'Cancelada en el diálogo de impresión'),
      })
      if (falloResolver) throw falloResolver

      return salida
    },
    onMutate: (orden) => setTrabajando(orden.id),
    onSettled: () => setTrabajando(null),
    onSuccess: (salida, orden) => {
      setMensaje(
        salida.impreso
          ? `Nota ${etiquetaNota(orden)} impresa. Ya figura como impresa y no se puede corregir.`
          : `No salió: ${salida.motivo ?? 'se canceló'}. La nota sigue pendiente y queda para reintentar.`,
      )
      void cliente.invalidateQueries()
    },
    onError: (e: Error) => setMensaje(`No se pudo imprimir: ${e.message}`),
  })

  const pendientes = ordenes ?? []

  return (
    <section className="panel">
      <header className="encabezado-pagina">
        <h1>Cola de impresión</h1>
        <p>
          Lo que los vendedores mandaron a imprimir desde el celular. El papel sale por la impresora
          de esta PC, con el mismo tamaño siempre.
        </p>
      </header>

      {mensaje ? <p className="aviso">{mensaje}</p> : null}

      {/* El panel abierto en el navegador no puede imprimir: no existe el
          puente con el sistema. Decirlo acá evita que alguien toque el botón
          tres veces esperando que salga algo. */}
      {!puedeImprimir ? (
        <p className="aviso">
          Esta pantalla está abierta fuera del programa de escritorio, así que puede ver la cola pero
          no imprimir. Abrí el panel instalado en la PC de la oficina.
        </p>
      ) : null}

      <h2>Esperando ({pendientes.length})</h2>

      {fallo ? (
        <p className="vacio" style={{ color: 'var(--rojo-accion)' }}>
          No pudimos traer la cola: {(fallo as Error).message}. Nadie confirmó que esté vacía.
        </p>
      ) : isLoading ? (
        <p className="vacio">Buscando…</p>
      ) : pendientes.length === 0 ? (
        <p className="vacio">No hay notas esperando para imprimir.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Nota</th>
              <th>Cliente</th>
              <th>La pidió</th>
              <th>Hace</th>
              <th style={{ width: 150 }} />
            </tr>
          </thead>
          <tbody>
            {pendientes.map((o) => (
              <tr key={o.id}>
                <td>
                  <strong>{etiquetaNota(o)}</strong>
                  <br />
                  <small style={{ color: 'var(--tinta-tenue)' }}>
                    {o.nota?.tipo_nota === 'factura' ? 'Factura' : 'Presupuesto'}
                    {o.con_rol_de_visita ? ' · con rol de visita' : ''}
                  </small>
                </td>
                <td>
                  {o.nota?.cliente_nombre ?? '—'}
                  {o.nota?.cliente_codigo ? (
                    <>
                      <br />
                      <small style={{ color: 'var(--tinta-tenue)' }}>#{o.nota.cliente_codigo}</small>
                    </>
                  ) : null}
                </td>
                <td>{o.pedida?.nombre_completo ?? '—'}</td>
                <td>{haceCuanto(o.creado_en)}</td>
                <td>
                  <button
                    className="chico primario"
                    disabled={soloLectura || !puedeImprimir || trabajando === o.id}
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
    </section>
  )
}

interface OrdenFila {
  id: string
  estado: string
  con_rol_de_visita: boolean
  motivo_fallo: string | null
  creado_en: string
  nota_id: string
  nota: {
    numero: number | null
    tipo_nota: string
    estado: string
    cliente_codigo: string | null
    cliente_nombre: string | null
    total: number | null
  } | null
  pedida: { nombre_completo: string; codigo_vendedor: string | null } | null
}

/** Una nota sin número todavía no la numeró Administración: se la nombra por el cliente. */
function etiquetaNota(o: OrdenFila): string {
  if (o.nota?.numero) return `N° ${String(o.nota.numero).padStart(6, '0')}`
  return `Sin numerar · ${o.nota?.cliente_nombre ?? 'cliente nuevo'}`
}

function haceCuanto(iso: string): string {
  const minutos = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (minutos < 1) return 'recién'
  if (minutos < 60) return `${minutos} min`
  const horas = Math.round(minutos / 60)
  return horas < 24 ? `${horas} h` : `${Math.round(horas / 24)} d`
}
