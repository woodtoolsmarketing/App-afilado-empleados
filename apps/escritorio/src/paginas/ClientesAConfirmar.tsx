import { type Cliente, type Direccion, type Perfil } from '@woodtools/compartido'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'

import { supabase, tokenDeSesion } from '../nucleo/supabase'

type ClienteConDirecciones = Cliente & { direcciones: Direccion[] }

// La ficha trae más columnas que el tipo base; acá se usan las del flujo de
// confirmación/rechazo. El id de perfil es el mismo uuid que guardan vendedor_id,
// creado_por, confirmado_por y rechazado_por.
type ClienteHistorial = Cliente & {
  creado_por: string | null
  confirmado_en: string | null
  confirmado_por: string | null
  rechazado_en: string | null
  rechazado_por: string | null
  motivo_rechazo: string | null
}

type Perfilito = Pick<Perfil, 'id' | 'nombre_completo' | 'codigo_vendedor'>
type Pestania = 'pendientes' | 'confirmados' | 'rechazados'

/**
 * Cuántas filas se traen por pestaña de historial. Es también el tope que corta
 * PostgREST, así que si alguna vez se llega se avisa en vez de recortar en
 * silencio. Hoy son un puñado; falta muchísimo para esto.
 */
const LIMITE = 1000

/**
 * Aviso push al teléfono del vendedor (best-effort), con el mismo patrón que
 * "agregar destino" (RolesDeVisita): Authorization explícito con tokenDeSesion,
 * y si el vendedor no tiene token o falla el envío NO frena la confirmación ni
 * el rechazo. `vendedorId` nulo = no se avisa (enviar-push igual lo toleraría).
 */
async function avisarAlVendedor(
  vendedorId: string | null | undefined,
  titulo: string,
  cuerpo: string,
  datos: Record<string, unknown>,
): Promise<void> {
  if (!vendedorId) return
  try {
    await supabase.functions.invoke('enviar-push', {
      headers: { Authorization: `Bearer ${await tokenDeSesion()}` },
      body: { vendedorId, titulo, cuerpo, datos },
    })
  } catch {
    // best-effort: si no tiene token o falla el envío, no frena nada
  }
}

function fechaHora(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })
}

/** Busca en código, razón social y nombre de fantasía, sin distinguir mayúsculas. */
function coincide(c: ClienteHistorial, termino: string): boolean {
  const t = termino.trim().toLowerCase()
  if (!t) return true
  return [c.codigo, c.razon_social, c.nombre_fantasia]
    .filter(Boolean)
    .some((s) => (s as string).toLowerCase().includes(t))
}

/**
 * "Clientes a confirmar" — con su historial.
 *
 * Los clientes que un vendedor carga desde la calle nacen provisorios: existen
 * con un código automático `P-000123` pero NO aparecen en el buscador del
 * vendedor hasta que la oficina los confirma. La pestaña **A confirmar** es esa
 * cola: la oficina ve lo que cargó el vendedor, le asigna el código definitivo y
 * confirma (o rechaza con un motivo). Las pestañas **Confirmados** y **Rechazados**
 * son el historial de lo ya resuelto, cada una con su buscador.
 *
 * `soloLectura` (todos menos administración/admin) sólo mira: no puede confirmar
 * ni rechazar. El historial lo ve igual.
 */
export function PaginaClientesAConfirmar({ soloLectura }: { soloLectura: boolean }) {
  const [pestania, setPestania] = useState<Pestania>('pendientes')

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

  // Todos los perfiles, para poner el nombre de quién cargó / confirmó / rechazó.
  const { data: perfiles } = useQuery({
    queryKey: ['vendedores'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('perfiles')
        .select('id, nombre_completo, codigo_vendedor')
        .order('nombre_completo')
      if (error) throw error
      return data as Perfilito[]
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

  const { data: confirmados } = useQuery({
    queryKey: ['historial-clientes', 'confirmados'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clientes')
        .select('*')
        .not('confirmado_en', 'is', null)
        .order('confirmado_en', { ascending: false })
        .limit(LIMITE)
      if (error) throw error
      return data as ClienteHistorial[]
    },
  })

  const { data: rechazados } = useQuery({
    queryKey: ['historial-clientes', 'rechazados'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clientes')
        .select('*')
        .not('rechazado_en', 'is', null)
        // Si después de un rechazo el cliente se reactivó y se confirmó, su estado
        // final es "confirmado": va en esa pestaña, no acá. Así las dos no se pisan.
        .is('confirmado_en', null)
        .order('rechazado_en', { ascending: false })
        .limit(LIMITE)
      if (error) throw error
      return data as ClienteHistorial[]
    },
  })

  function notasDe(clienteId: string): string[] {
    return (notasEsperando ?? []).filter((n) => n.cliente_id === clienteId).map((n) => n.id)
  }
  const nombreDe = (id: string | null): string =>
    (id && perfiles?.find((p) => p.id === id)?.nombre_completo) || '—'

  return (
    <div>
      <header className="encabezado-pagina">
        <div>
          <h1>Clientes a confirmar</h1>
          <p className="subtitulo">
            Clientes que cargaron los vendedores desde la calle. Revisá los datos y confirmá (con el
            código definitivo) o rechazá. En <strong>Confirmados</strong> y <strong>Rechazados</strong>{' '}
            queda el historial de lo ya resuelto, con su buscador.
          </p>
        </div>
      </header>

      <div className="tarjeta" style={{ display: 'flex', gap: 8, padding: 10, flexWrap: 'wrap' }}>
        <button
          className={pestania === 'pendientes' ? 'primario' : ''}
          onClick={() => setPestania('pendientes')}
        >
          A confirmar{provisorios ? ` (${provisorios.length})` : ''}
        </button>
        <button
          className={pestania === 'confirmados' ? 'primario' : ''}
          onClick={() => setPestania('confirmados')}
        >
          ✓ Confirmados{confirmados ? ` (${confirmados.length})` : ''}
        </button>
        <button
          className={pestania === 'rechazados' ? 'primario' : ''}
          onClick={() => setPestania('rechazados')}
        >
          ✕ Rechazados{rechazados ? ` (${rechazados.length})` : ''}
        </button>
      </div>

      {pestania === 'pendientes' ? (
        isLoading ? (
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
              vendedor={perfiles?.find((p) => p.id === c.vendedor_id)?.nombre_completo ?? 'Sin asignar'}
              notasPendientes={notasDe(c.id)}
              soloLectura={soloLectura}
            />
          ))
        )
      ) : pestania === 'confirmados' ? (
        <TablaConfirmados clientes={confirmados ?? []} cargando={!confirmados} nombreDe={nombreDe} />
      ) : (
        <TablaRechazados clientes={rechazados ?? []} cargando={!rechazados} nombreDe={nombreDe} />
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

      return cod
    },
    onSuccess: async (cod) => {
      await query.invalidateQueries()
      // Aviso al vendedor que lo cargó: su cliente quedó dado de alta, con el
      // código nuevo. Best-effort (ver avisarAlVendedor).
      void avisarAlVendedor(
        cliente.vendedor_id,
        'Cliente dado de alta',
        `La oficina confirmó a ${cliente.razon_social}. Código ${cod}.`,
        { tipo: 'cliente_confirmado', clienteId: cliente.id, codigo: cod },
      )
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
      // Aviso al vendedor con el MOTIVO, para que sepa por qué y lo rehaga.
      const etiqueta = motivo === 'cliente_ya_existe' ? 'El cliente ya existe' : 'Datos erróneos'
      const texto = detalle.trim() ? `${etiqueta} — ${detalle.trim()}` : etiqueta
      void avisarAlVendedor(
        cliente.vendedor_id,
        'Cliente rechazado',
        `${cliente.razon_social}: ${texto}`,
        { tipo: 'cliente_rechazado', clienteId: cliente.id },
      )
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

// ── Historial ────────────────────────────────────────────────────────────────

/** Celda de razón social con el nombre de fantasía debajo, como en Clientes. */
function RazonSocial({ cliente }: { cliente: ClienteHistorial }) {
  return (
    <>
      {cliente.razon_social}
      {cliente.nombre_fantasia && (
        <>
          <br />
          <small style={{ color: 'var(--tinta-tenue)' }}>{cliente.nombre_fantasia}</small>
        </>
      )}
    </>
  )
}

function Buscador({
  valor,
  alCambiar,
  que,
}: {
  valor: string
  alCambiar: (v: string) => void
  que: string
}) {
  return (
    <div className="tarjeta">
      <input
        placeholder={`Buscar ${que} por código o razón social…`}
        value={valor}
        onChange={(e) => alCambiar(e.target.value)}
        aria-label={`Buscar clientes ${que}`}
      />
    </div>
  )
}

function TablaConfirmados({
  clientes,
  cargando,
  nombreDe,
}: {
  clientes: ClienteHistorial[]
  cargando: boolean
  nombreDe: (id: string | null) => string
}) {
  const [busqueda, setBusqueda] = useState('')
  const filtrados = clientes.filter((c) => coincide(c, busqueda))

  return (
    <>
      <Buscador valor={busqueda} alCambiar={setBusqueda} que="confirmados" />
      <section className="tarjeta">
        {cargando ? (
          <p>Cargando…</p>
        ) : filtrados.length === 0 ? (
          <p className="vacio">
            {busqueda ? 'No hay confirmados que coincidan.' : 'Todavía no hay clientes confirmados.'}
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Cliente Nº</th>
                <th>Razón social</th>
                <th>Lo cargó</th>
                <th>Confirmado</th>
                <th>Confirmó</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map((c) => (
                <tr key={c.id}>
                  <td>
                    <code>{c.codigo}</code>
                  </td>
                  <td>
                    <RazonSocial cliente={c} />
                  </td>
                  <td>{nombreDe(c.creado_por ?? c.vendedor_id)}</td>
                  <td>{fechaHora(c.confirmado_en)}</td>
                  <td>{nombreDe(c.confirmado_por)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      {clientes.length >= LIMITE && (
        <p className="aviso atencion" style={{ marginTop: 8 }}>
          Mostrando los {LIMITE} más recientes; hay más en el historial.
        </p>
      )}
    </>
  )
}

function TablaRechazados({
  clientes,
  cargando,
  nombreDe,
}: {
  clientes: ClienteHistorial[]
  cargando: boolean
  nombreDe: (id: string | null) => string
}) {
  const [busqueda, setBusqueda] = useState('')
  const filtrados = clientes.filter((c) => coincide(c, busqueda))

  return (
    <>
      <Buscador valor={busqueda} alCambiar={setBusqueda} que="rechazados" />
      <section className="tarjeta">
        {cargando ? (
          <p>Cargando…</p>
        ) : filtrados.length === 0 ? (
          <p className="vacio">
            {busqueda ? 'No hay rechazados que coincidan.' : 'Todavía no hay clientes rechazados.'}
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Código prov.</th>
                <th>Razón social</th>
                <th>Lo cargó</th>
                <th>Motivo del rechazo</th>
                <th>Rechazado</th>
                <th>Rechazó</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map((c) => (
                <tr key={c.id}>
                  <td>
                    <code>{c.codigo}</code>
                  </td>
                  <td>
                    <RazonSocial cliente={c} />
                  </td>
                  <td>{nombreDe(c.creado_por ?? c.vendedor_id)}</td>
                  <td>
                    <span className="pastilla ambar">{c.motivo_rechazo ?? '—'}</span>
                  </td>
                  <td>{fechaHora(c.rechazado_en)}</td>
                  <td>{nombreDe(c.rechazado_por)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      {clientes.length >= LIMITE && (
        <p className="aviso atencion" style={{ marginTop: 8 }}>
          Mostrando los {LIMITE} más recientes; hay más en el historial.
        </p>
      )}
    </>
  )
}
