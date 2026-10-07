import {
  fechaLocalISO,
  formatearDistancia,
  formatearDuracion,
  type ClaveFuncionPanel,
  type ResumenJornada,
  type RolUsuario,
} from '@woodtools/compartido'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'

import { supabase } from '../nucleo/supabase'

/**
 * El Tablero depende del rol. Administración ve SU tablero —las colas de trabajo
 * de la oficina—; admin y supervisor ven el del día (cómo viene la jornada y
 * quién usa la app). Es un router sin hooks propios para que cada tablero tenga
 * los suyos sin romper la cuenta de hooks.
 */
export function PaginaTablero({
  rol,
  puedeVer,
}: {
  rol: RolUsuario
  puedeVer: (clave: ClaveFuncionPanel) => boolean
}) {
  return rol === 'administracion' ? <TableroAdministracion /> : <TableroDelDia puedeVer={puedeVer} />
}

/** Tablero del día: cómo viene la jornada y quién está usando la app. */
function TableroDelDia({ puedeVer }: { puedeVer: (clave: ClaveFuncionPanel) => boolean }) {
  /**
   * En el calendario de acá, no en UTC.
   *
   * `toISOString()` adelanta el día a partir de las 21:00 en Argentina, así que
   * a esa hora el tablero pedía las jornadas de MAÑANA y mostraba "todavía no
   * hay roles de visita para hoy" con la oficina llena de trabajo hecho. El
   * celular arma la jornada con la fecha local, así que además los dos lados
   * dejaban de hablar del mismo día.
   */
  const hoy = fechaLocalISO(new Date())

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

  /*
   * La última conexión, no el último login.
   *
   * Antes esto leía `perfiles.ultimo_acceso_en`, que se escribe SÓLO cuando
   * alguien tipea la contraseña. Como la sesión de la app no vence, el vendedor
   * la tipea una vez y no vuelve a pasar por ahí: la tabla decía "Nunca entró"
   * de gente que había abierto la app el día anterior.
   *
   * `vista_ultima_conexion` toma el máximo entre las cuatro señales que la app
   * ya venía guardando. Ver la migración 20260902115441.
   */
  const { data: sesiones } = useQuery({
    queryKey: ['ultima-conexion'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vista_ultima_conexion')
        .select('perfil_id, nombre_completo, codigo_vendedor, ultima_conexion, de_donde, aperturas_hoy')
        .eq('rol', 'vendedor')
        .eq('estado', 'aprobado')
        .order('ultima_conexion', { ascending: false, nullsFirst: false })
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
        {/* Sólo si el rol puede abrir el mapa en vivo: si no, el botón rebotaría. */}
        {puedeVer('panel_mapa_en_vivo') ? (
          <Link to="/mapa">
            <button className="rojo">Ver mapa en vivo</button>
          </Link>
        ) : null}
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
            Todavía no hay roles de visita para hoy.
            {puedeVer('panel_roles_visita') ? (
              <>
                {' '}
                Armalos desde <Link to="/roles">Roles de visita</Link>.
              </>
            ) : null}
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
              <th>Última conexión</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {(sesiones ?? []).map((v) => {
              const dias = v.ultima_conexion
                ? Math.floor((Date.now() - new Date(v.ultima_conexion).getTime()) / 86_400_000)
                : null

              return (
                <tr key={v.perfil_id}>
                  <td>
                    {v.nombre_completo}
                    {v.codigo_vendedor ? ` (#${v.codigo_vendedor})` : ''}
                  </td>
                  <td>
                    {v.ultima_conexion ? (
                      <>
                        {new Date(v.ultima_conexion).toLocaleString('es-AR', {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        })}
                        {/* De dónde salió el dato. Sin esto, "hace 3 días" no
                            distingue al que abrió la app del que sólo tipeó la
                            contraseña esa vez y nunca más. */}
                        {v.de_donde ? (
                          <>
                            <br />
                            <small style={{ color: 'var(--tinta-tenue)' }}>
                              {v.de_donde}
                              {v.aperturas_hoy
                                ? ` · ${v.aperturas_hoy} apertura${v.aperturas_hoy === 1 ? '' : 's'} hoy`
                                : ''}
                            </small>
                          </>
                        ) : null}
                      </>
                    ) : (
                      'Nunca entró'
                    )}
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

/**
 * Tablero de administración: las colas de trabajo de la oficina en vez de las
 * métricas del recorrido. Cada número es un link a su lista.
 */
function TableroAdministracion() {
  const { data: clientesAConfirmar } = useQuery({
    queryKey: ['clientes-a-confirmar-total'],
    queryFn: async () => {
      const { count } = await supabase
        .from('clientes')
        .select('id', { count: 'exact', head: true })
        .eq('provisorio', true)
        .eq('activo', true)
      return count ?? 0
    },
    refetchInterval: 30_000,
  })

  const { data: cambiosDir } = useQuery({
    queryKey: ['cambios-direccion-pendientes'],
    queryFn: async () => {
      const { count } = await supabase
        .from('cambios_direccion')
        .select('id', { count: 'exact', head: true })
        .eq('estado', 'pendiente')
      return count ?? 0
    },
    refetchInterval: 30_000,
  })

  // `clientes_modificaciones` es un log (no tiene "pendiente"): lo útil es cuántos
  // datos de clientes se cambiaron HOY, desde la medianoche local.
  const { data: modificacionesHoy } = useQuery({
    queryKey: ['modificaciones-hoy'],
    queryFn: async () => {
      const inicio = new Date()
      inicio.setHours(0, 0, 0, 0)
      const { count } = await supabase
        .from('clientes_modificaciones')
        .select('id', { count: 'exact', head: true })
        .gte('modificado_en', inicio.toISOString())
      return count ?? 0
    },
    refetchInterval: 60_000,
  })

  return (
    <>
      <header className="encabezado-pagina">
        <div>
          <h1>Tablero</h1>
          <p>{new Date().toLocaleDateString('es-AR', { dateStyle: 'full' })}</p>
        </div>
      </header>

      <div className="rejilla" style={{ marginBottom: 18 }}>
        <TarjetaTablero
          a="/clientes-a-confirmar"
          valor={clientesAConfirmar ?? 0}
          etiqueta="Clientes a confirmar"
          color={clientesAConfirmar ? 'var(--rojo-accion)' : undefined}
        />
        <TarjetaTablero
          a="/cambios-direccion"
          valor={cambiosDir ?? 0}
          etiqueta="Cambios de dirección pendientes"
          color={cambiosDir ? 'var(--rojo-accion)' : undefined}
        />
        <TarjetaTablero
          a="/modificaciones"
          valor={modificacionesHoy ?? 0}
          etiqueta="Modificaciones de clientes hoy"
        />
      </div>

      <section className="tarjeta">
        <h2>Tu trabajo</h2>
        <p className="vacio">
          Desde acá confirmás los clientes nuevos que cargan los vendedores, aplicás los cambios de
          dirección que proponen y seguís las notas de pedido. Tocá cada número para ir a su lista.
        </p>
      </section>
    </>
  )
}

/** Un indicador del tablero que lleva a su lista al tocarlo. */
function TarjetaTablero({
  a,
  valor,
  etiqueta,
  color,
}: {
  a: string
  valor: number
  etiqueta: string
  color?: string
}) {
  return (
    <Link to={a} className="indicador" style={{ textDecoration: 'none', color: 'inherit' }}>
      <div className="valor" style={color ? { color } : undefined}>
        {valor}
      </div>
      <div className="etiqueta">{etiqueta}</div>
    </Link>
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
