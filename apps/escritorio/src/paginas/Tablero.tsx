import { formatearDistancia, formatearDuracion, type ResumenJornada } from '@woodtools/compartido'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'

import { supabase } from '../nucleo/supabase'

/** Tablero del día: cómo viene la jornada y quién está usando la app. */
export function PaginaTablero() {
  const hoy = new Date().toISOString().slice(0, 10)

  const { data: jornadas } = useQuery({
    queryKey: ['jornadas-hoy', hoy],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vista_resumen_jornada')
        .select('*, perfiles:vendedor_id ( nombre_completo, codigo_vendedor )')
        .eq('fecha', hoy)
      if (error) throw error
      return data as Array<
        ResumenJornada & { perfiles: { nombre_completo: string; codigo_vendedor: string | null } | null }
      >
    },
    refetchInterval: 20_000,
  })

  const { data: enRecorrido } = useQuery({
    queryKey: ['en-recorrido'],
    queryFn: async () => {
      const { count } = await supabase
        .from('posiciones_actuales')
        .select('vendedor_id', { count: 'exact', head: true })
        .eq('en_recorrido', true)
      return count ?? 0
    },
    refetchInterval: 15_000,
  })

  const { data: sesiones } = useQuery({
    queryKey: ['sesiones-recientes'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('perfiles')
        .select('id, nombre_completo, codigo_vendedor, ultimo_acceso_en, rol')
        .eq('rol', 'vendedor')
        .eq('estado', 'aprobado')
        .order('ultimo_acceso_en', { ascending: false, nullsFirst: false })
      if (error) throw error
      return data
    },
    refetchInterval: 60_000,
  })

  const total = (jornadas ?? []).reduce((a, j) => a + Number(j.total_paradas), 0)
  const visitadas = (jornadas ?? []).reduce((a, j) => a + Number(j.visitadas), 0)
  const noVisitadas = (jornadas ?? []).reduce((a, j) => a + Number(j.no_visitadas), 0)
  const ventas = (jornadas ?? []).reduce((a, j) => a + Number(j.con_venta), 0)

  return (
    <>
      <header className="encabezado-pagina">
        <div>
          <h1>Tablero del día</h1>
          <p>{new Date().toLocaleDateString('es-AR', { dateStyle: 'full' })}</p>
        </div>
        <Link to="/mapa">
          <button className="rojo">Ver mapa en vivo</button>
        </Link>
      </header>

      <div className="rejilla" style={{ marginBottom: 18 }}>
        <Indicador valor={jornadas?.length ?? 0} etiqueta="Vendedores con rol de visita" />
        <Indicador valor={enRecorrido ?? 0} etiqueta="En recorrido ahora" color="var(--verde-oscuro)" />
        <Indicador valor={total} etiqueta="Destinos del día" />
        <Indicador valor={visitadas} etiqueta="Visitados" color="var(--verde-oscuro)" />
        <Indicador valor={noVisitadas} etiqueta="No concretados" color="var(--rojo-accion)" />
        <Indicador valor={ventas} etiqueta="Con venta" />
      </div>

      <section className="tarjeta">
        <h2>Jornadas de hoy</h2>

        {!jornadas || jornadas.length === 0 ? (
          <p className="vacio">
            Todavía no hay roles de visita para hoy. Armalos desde <Link to="/roles">Roles de visita</Link>.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Vendedor</th>
                <th>Estado</th>
                <th>Avance</th>
                <th>Vendió</th>
                <th>Cobró</th>
                <th>Ret. afilado</th>
                <th>Entregó</th>
                <th>Recorrido</th>
              </tr>
            </thead>
            <tbody>
              {jornadas.map((j) => (
                <tr key={j.rol_visita_id}>
                  <td>
                    {j.perfiles?.nombre_completo ?? '—'}
                    {j.perfiles?.codigo_vendedor ? ` (#${j.perfiles.codigo_vendedor})` : ''}
                  </td>
                  <td>
                    <span className={`pastilla ${j.estado === 'en_curso' ? 'verde' : j.estado === 'finalizado' ? 'gris' : 'ambar'}`}>
                      {j.estado === 'en_curso'
                        ? 'En recorrido'
                        : j.estado === 'finalizado'
                          ? 'Finalizado'
                          : 'Planificado'}
                    </span>
                  </td>
                  <td>
                    {j.visitadas + j.no_visitadas} / {j.total_paradas}
                  </td>
                  <td>{j.con_venta}</td>
                  <td>{j.con_cobro}</td>
                  <td>{j.con_retiro_afilado}</td>
                  <td>{j.con_entrega}</td>
                  <td>
                    {j.distancia_total_m
                      ? `${formatearDistancia(j.distancia_total_m)} · ${formatearDuracion(j.duracion_total_seg)}`
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="tarjeta">
        <h2>¿Están entrando a la app?</h2>

        <table>
          <thead>
            <tr>
              <th>Vendedor</th>
              <th>Último acceso</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {(sesiones ?? []).map((v) => {
              const dias = v.ultimo_acceso_en
                ? Math.floor((Date.now() - new Date(v.ultimo_acceso_en).getTime()) / 86_400_000)
                : null

              return (
                <tr key={v.id}>
                  <td>
                    {v.nombre_completo}
                    {v.codigo_vendedor ? ` (#${v.codigo_vendedor})` : ''}
                  </td>
                  <td>
                    {v.ultimo_acceso_en
                      ? new Date(v.ultimo_acceso_en).toLocaleString('es-AR', {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        })
                      : 'Nunca entró'}
                  </td>
                  <td>
                    {dias === null ? (
                      <span className="pastilla roja">Sin usar</span>
                    ) : dias === 0 ? (
                      <span className="pastilla verde">Hoy</span>
                    ) : dias <= 3 ? (
                      <span className="pastilla azul">Hace {dias} día{dias === 1 ? '' : 's'}</span>
                    ) : (
                      <span className="pastilla ambar">Hace {dias} días</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>
    </>
  )
}

function Indicador({ valor, etiqueta, color }: { valor: number; etiqueta: string; color?: string }) {
  return (
    <div className="indicador">
      <div className="valor" style={color ? { color } : undefined}>
        {valor}
      </div>
      <div className="etiqueta">{etiqueta}</div>
    </div>
  )
}
