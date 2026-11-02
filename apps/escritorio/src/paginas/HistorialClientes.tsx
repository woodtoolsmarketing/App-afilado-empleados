import type { Cliente, Perfil } from '@woodtools/compartido'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { supabase } from '../nucleo/supabase'

/**
 * Historial de clientes confirmados y rechazados.
 *
 * Los clientes que cargan los vendedores desde la calle pasan por "Clientes a
 * confirmar". Ahí la oficina los resuelve: los CONFIRMA (les da el código
 * definitivo y quedan de alta) o los RECHAZA (datos erróneos / el cliente ya
 * existía). Antes, una vez resueltos desaparecían de esa cola y no quedaba dónde
 * consultarlos. Esta pantalla los guarda a los dos —cada uno con su buscador— para
 * poder encontrarlos después.
 *
 * La ven administración (por el permiso `panel_clientes_historial`) y los
 * administradores (que ven todo). Es de sólo lectura: es un registro, no una cola.
 */

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
type Pestania = 'confirmados' | 'rechazados'

/**
 * Cuántas filas se traen por pestaña. Es también el tope que corta PostgREST, así
 * que si alguna vez se llega, se avisa en vez de recortar en silencio. Hoy hay un
 * puñado (los clientes de calle resueltos son pocos), falta muchísimo para esto.
 */
const LIMITE = 1000

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

export function PaginaHistorialClientes() {
  const [pestania, setPestania] = useState<Pestania>('confirmados')

  const { data: confirmados, isLoading: cargaConf } = useQuery({
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

  const { data: rechazados, isLoading: cargaRech } = useQuery({
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

  const { data: perfiles } = useQuery({
    queryKey: ['perfiles-nombres'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('perfiles')
        .select('id, nombre_completo, codigo_vendedor')
        .order('nombre_completo')
      if (error) throw error
      return data as Perfilito[]
    },
  })
  const nombreDe = (id: string | null): string =>
    (id && perfiles?.find((p) => p.id === id)?.nombre_completo) || '—'

  return (
    <div>
      <header className="encabezado-pagina">
        <div>
          <h1>Historial de clientes</h1>
          <p className="subtitulo">
            Los clientes que cargaron los vendedores desde la calle y la oficina ya resolvió: los{' '}
            <strong>confirmados</strong> (dados de alta con su código definitivo) y los{' '}
            <strong>rechazados</strong> (con el motivo). Cada uno con su buscador.
          </p>
        </div>
      </header>

      <div className="tarjeta" style={{ display: 'flex', gap: 8, padding: 10 }}>
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

      {pestania === 'confirmados' ? (
        <TablaConfirmados clientes={confirmados ?? []} cargando={cargaConf} nombreDe={nombreDe} />
      ) : (
        <TablaRechazados clientes={rechazados ?? []} cargando={cargaRech} nombreDe={nombreDe} />
      )}
    </div>
  )
}

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
