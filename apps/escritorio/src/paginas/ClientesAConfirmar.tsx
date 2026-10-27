import { type Cliente, type Direccion, type Perfil } from '@woodtools/compartido'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'

import { supabase } from '../nucleo/supabase'

type ClienteConDirecciones = Cliente & { direcciones: Direccion[] }

/**
 * "Clientes a confirmar"
 *
 * Los clientes que un vendedor carga desde la calle nacen provisorios: existen
 * con un código automático `P-000123` pero NO aparecen en el buscador del
 * vendedor hasta que la oficina los confirma. Acá la oficina ve TODO lo que
 * cargó el vendedor y le asigna el código definitivo; al confirmarlo, el cliente
 * se da de alta de verdad y las notas que lo estaban esperando reciben su número.
 */
export function PaginaClientesAConfirmar({ soloLectura }: { soloLectura: boolean }) {
  const { data: provisorios, isLoading } = useQuery({
    queryKey: ['clientes-a-confirmar'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clientes')
        .select('*, direcciones ( * )')
        .eq('provisorio', true)
        .eq('activo', true)
        // Los más viejos primero: es una cola, el que espera hace más tiempo va arriba.
        .order('creado_en', { ascending: true })
        .limit(100)
      if (error) throw error
      return data as ClienteConDirecciones[]
    },
  })

  const { data: vendedores } = useQuery({
    queryKey: ['vendedores'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('perfiles')
        .select('id, nombre_completo, codigo_vendedor')
        .order('nombre_completo')
      if (error) throw error
      return data as Pick<Perfil, 'id' | 'nombre_completo' | 'codigo_vendedor'>[]
    },
  })

  // Las notas que están esperando que se complete su cliente, para avisar que al
  // confirmarlo además se les pone el número.
  const { data: notasEsperando } = useQuery({
    queryKey: ['notas-esperando-cliente'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('notas_pedido')
        .select('id, cliente_id')
        .eq('estado', 'pendiente_cliente')
        .limit(500)
      if (error) throw error
      return (data ?? []) as { id: string; cliente_id: string | null }[]
    },
  })

  function notasDe(clienteId: string): string[] {
    return (notasEsperando ?? []).filter((n) => n.cliente_id === clienteId).map((n) => n.id)
  }

  return (
    <div>
      <header className="encabezado-pagina">
        <div>
          <h1>Clientes a confirmar</h1>
          <p className="subtitulo">
            Clientes que cargaron los vendedores desde la calle. Revisá los datos, asigná el código
            definitivo y confirmá: recién ahí el cliente se da de alta y aparece en el sistema.
          </p>
        </div>
      </header>

      {isLoading ? (
        <section className="tarjeta">
          <p>Cargando…</p>
        </section>
      ) : !provisorios || provisorios.length === 0 ? (
        <section className="tarjeta">
          <p className="vacio">No hay clientes esperando confirmación. 🎉</p>
        </section>
      ) : (
        provisorios.map((c) => (
          <TarjetaProvisorio
            key={c.id}
            cliente={c}
            vendedor={
              vendedores?.find((v) => v.id === c.vendedor_id)?.nombre_completo ?? 'Sin asignar'
            }
            notasPendientes={notasDe(c.id)}
            soloLectura={soloLectura}
          />
        ))
      )}
    </div>
  )
}

function TarjetaProvisorio({
  cliente,
  vendedor,
  notasPendientes,
  soloLectura,
}: {
  cliente: ClienteConDirecciones
  vendedor: string
  notasPendientes: string[]
  soloLectura: boolean
}) {
  const query = useQueryClient()
  const [codigo, setCodigo] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Diálogo de rechazo: se abre con "Rechazar", pide un motivo (obligatorio) y
  // un detalle opcional. Rechazar saca al cliente de la cola (activo=false) y
  // guarda el motivo; no se da de alta.
  const [rechazando, setRechazando] = useState(false)
  const [motivo, setMotivo] = useState<'datos_erroneos' | 'cliente_ya_existe' | null>(null)
  const [detalle, setDetalle] = useState('')
  const [errorRechazo, setErrorRechazo] = useState<string | null>(null)

  const principal =
    cliente.direcciones.find((d) => d.principal) ?? cliente.direcciones[0] ?? null

  const confirmar = useMutation({
    mutationFn: async () => {
      const cod = codigo.trim().toUpperCase()
      if (!cod) throw new Error('Escribí el código de cliente nuevo.')
      if (cod.startsWith('P-')) {
        throw new Error('Ese es el código provisorio. Poné el código definitivo (sin "P-").')
      }

      // 1) Darlo de alta: código real + dejar de ser provisorio. Va por un RPC
      //    (no un update directo) para que administración también pueda, sin
      //    abrirle la escritura de toda la tabla de clientes.
      const { error: errCli } = await supabase.rpc('confirmar_cliente_provisorio', {
        p_cliente_id: cliente.id,
        p_codigo: cod,
      })
      if (errCli) throw new Error(errCli.message)

      // 2) Las notas que lo estaban esperando ya pueden recibir su número: el
      //    cliente dejó de ser provisorio, así que `asignar_cliente_a_nota` lo acepta.
      for (const notaId of notasPendientes) {
        const { error: errNota } = await supabase.rpc('asignar_cliente_a_nota', {
          p_nota_id: notaId,
          p_cliente_id: cliente.id,
        })
        if (errNota) throw errNota
      }
    },
    onSuccess: async () => {
      await query.invalidateQueries()
    },
    onError: (e: Error) => setError(e.message),
  })

  const rechazar = useMutation({
    mutationFn: async () => {
      if (!motivo) throw new Error('Elegí un motivo de rechazo.')
      const { error: errRech } = await supabase.rpc('rechazar_cliente_provisorio', {
        p_cliente_id: cliente.id,
        p_motivo: motivo,
        p_detalle: detalle.trim() || null,
      })
      if (errRech) throw new Error(errRech.message)
    },
    onSuccess: async () => {
      setRechazando(false)
      await query.invalidateQueries()
    },
    onError: (e: Error) => setErrorRechazo(e.message),
  })

  function abrirRechazo() {
    setMotivo(null)
    setDetalle('')
    setErrorRechazo(null)
    setRechazando(true)
  }

  return (
    <section className="tarjeta" style={{ borderLeft: '4px solid var(--ambar, #c98a00)' }}>
      <div className="confirmar-grilla">
        {/* ── Datos que cargó el vendedor ──────────────────────────────────── */}
        <div>
          <h2 style={{ margin: '0 0 2px' }}>{cliente.razon_social}</h2>
          {cliente.nombre_fantasia && (
            <p style={{ margin: '0 0 10px', color: 'var(--tinta-tenue)' }}>
              {cliente.nombre_fantasia}
            </p>
          )}

          <dl className="ficha-datos">
            <Dato rotulo="Código provisorio" valor={<code>{cliente.codigo}</code>} />
            <Dato rotulo="DNI / CUIT" valor={cliente.cuit ?? cliente.documento ?? '—'} />
            <Dato rotulo="Contacto" valor={cliente.contacto_nombre ?? '—'} />
            <Dato rotulo="Teléfono" valor={cliente.telefono ?? '—'} />
            <Dato rotulo="Email" valor={cliente.email ?? '—'} />
            <Dato
              rotulo="Dirección de entrega"
              valor={
                principal
                  ? `${principal.direccion_formateada}${
                      principal.codigo_postal ? ` (CP ${principal.codigo_postal})` : ''
                    }`
                  : '— sin ubicar —'
              }
            />
            <Dato rotulo="Dirección fiscal" valor={cliente.direccion_fiscal ?? '—'} />
            <Dato rotulo="Lo cargó" valor={vendedor} />
          </dl>

          {notasPendientes.length > 0 && (
            <p className="aviso atencion" style={{ marginTop: 10 }}>
              Tiene {notasPendientes.length} nota{notasPendientes.length === 1 ? '' : 's'} de pedido
              esperando. Al confirmarlo {notasPendientes.length === 1 ? 'recibe' : 'reciben'} el
              número.
            </p>
          )}
        </div>

        {/* ── Código de cliente nuevo + confirmar ──────────────────────────── */}
        <div className="confirmar-accion">
          <label className="confirmar-rotulo" htmlFor={`cod-${cliente.id}`}>
            Código de cliente nuevo
          </label>
          <input
            id={`cod-${cliente.id}`}
            value={codigo}
            onChange={(e) => {
              setCodigo(e.target.value)
              setError(null)
            }}
            placeholder="Ej. 1048"
            disabled={soloLectura || confirmar.isPending}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !soloLectura) confirmar.mutate()
            }}
          />
          <button
            className="primario"
            disabled={soloLectura || confirmar.isPending}
            onClick={() => confirmar.mutate()}
          >
            {confirmar.isPending ? 'Confirmando…' : 'Confirmar y dar de alta'}
          </button>
          <button
            style={{ marginTop: 8, color: 'var(--rojo-accion)' }}
            disabled={soloLectura || confirmar.isPending || rechazar.isPending}
            onClick={abrirRechazo}
          >
            Rechazar
          </button>
          {soloLectura && (
            <small style={{ color: 'var(--tinta-tenue)' }}>Sólo un administrador puede confirmar o rechazar.</small>
          )}
          {error && <div className="aviso error">{error}</div>}
        </div>
      </div>

      {rechazando && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => !rechazar.isPending && setRechazando(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 16,
          }}
        >
          <div
            className="tarjeta"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 440, width: '100%', margin: 0 }}
          >
            <h2 style={{ marginTop: 0 }}>Rechazar cliente</h2>
            <p style={{ margin: '0 0 14px', color: 'var(--tinta-suave)' }}>
              <strong>{cliente.razon_social}</strong> <code>{cliente.codigo}</code>
            </p>

            <p style={{ margin: '0 0 8px', fontWeight: 700 }}>¿Por qué lo rechazás?</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {(
                [
                  ['datos_erroneos', 'Datos erróneos'],
                  ['cliente_ya_existe', 'El cliente ya existe'],
                ] as const
              ).map(([valor, etiqueta]) => (
                <label
                  key={valor}
                  style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}
                >
                  <input
                    type="radio"
                    name={`motivo-${cliente.id}`}
                    checked={motivo === valor}
                    onChange={() => {
                      setMotivo(valor)
                      setErrorRechazo(null)
                    }}
                    style={{ width: 'auto', minHeight: 0 }}
                  />
                  {etiqueta}
                </label>
              ))}
            </div>

            <label style={{ display: 'block', marginTop: 14 }}>
              <span style={{ color: 'var(--tinta-suave)' }}>Detalle (opcional)</span>
              <textarea
                value={detalle}
                onChange={(e) => setDetalle(e.target.value)}
                rows={2}
                placeholder="Aclaración para la oficina…"
                style={{ marginTop: 4 }}
              />
            </label>

            {notasPendientes.length > 0 && (
              <div className="aviso atencion" style={{ marginTop: 12 }}>
                Tiene {notasPendientes.length} nota{notasPendientes.length === 1 ? '' : 's'} de pedido
                esperando. Al rechazarlo{' '}
                {notasPendientes.length === 1 ? 'esa nota queda' : 'esas notas quedan'} sin cliente:
                hay que resolver{notasPendientes.length === 1 ? 'la' : 'las'} aparte.
              </div>
            )}

            {errorRechazo && (
              <div className="aviso error" style={{ marginTop: 12 }}>
                {errorRechazo}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18 }}>
              <button disabled={rechazar.isPending} onClick={() => setRechazando(false)}>
                Cancelar
              </button>
              <button
                className="peligro"
                disabled={!motivo || rechazar.isPending}
                onClick={() => rechazar.mutate()}
              >
                {rechazar.isPending ? 'Rechazando…' : 'Rechazar cliente'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

function Dato({ rotulo, valor }: { rotulo: string; valor: ReactNode }) {
  return (
    <div className="ficha-dato">
      <dt>{rotulo}</dt>
      <dd>{valor}</dd>
    </div>
  )
}
