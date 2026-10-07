import { useQuery } from '@tanstack/react-query'
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import type { ClaveFuncionPanel, RolUsuario } from '@woodtools/compartido'

import { supabase } from './nucleo/supabase'
import { usarPermisosPanel } from './nucleo/permisos'
import { usarPublicarDireccionDelPanel } from './nucleo/publicarPanel'
import { ProveedorConsola } from './nucleo/consola'
import { usarSesion } from './nucleo/sesion'
import { PaginaActualizaciones } from './paginas/Actualizaciones'
import { PaginaArticulosAConfirmar } from './paginas/ArticulosAConfirmar'
import { PaginaCambiosDireccion } from './paginas/CambiosDireccion'
import { PaginaClientes } from './paginas/Clientes'
import { PaginaClientesAConfirmar } from './paginas/ClientesAConfirmar'
import { PaginaColaImpresion } from './paginas/ColaImpresion'
import { PaginaIngreso } from './paginas/Ingreso'
import { PaginaMapaClientes } from './paginas/MapaClientes'
import { PaginaMapaEnVivo } from './paginas/MapaEnVivo'
import { PaginaModificacionesClientes } from './paginas/ModificacionesClientes'
import { PaginaNotasPedido } from './paginas/NotasPedido'
import { PaginaProblemas } from './paginas/Problemas'
import { PaginaRolMaestro } from './paginas/RolMaestro'
import { PaginaRolesDeVisita } from './paginas/RolesDeVisita'
import { PaginaTablero } from './paginas/Tablero'
import { PaginaUsuarios } from './paginas/Usuarios'
import { PaginaPermisos } from './paginas/Permisos'

export function App() {
  const sesion = usarSesion()
  // La ruta entra al proveedor porque cambiar de página borra lo que la consola
  // haya destrabado: es la mitad de "cada vez hay que volver a escribirlo".
  const ubicacion = useLocation()

  // Los teléfonos necesitan saber en qué dirección está esta PC para poder
  // bajarse la app nueva. Se publica sola: el router puede cambiarla.
  usarPublicarDireccionDelPanel(sesion.esAdmin)

  // Qué secciones del panel ve este rol. admin ve todo; administración y
  // supervisor, lo que el admin les habilitó en "Permisos". Va antes de los
  // returns de abajo porque un hook no puede quedar del otro lado de un return.
  const permisos = usarPermisosPanel(sesion.perfil?.rol)

  if (sesion.cargando) {
    return (
      <div className="ingreso">
        <div style={{ color: '#fff', fontWeight: 700 }}>Cargando…</div>
      </div>
    )
  }

  if (!sesion.perfil) {
    return <PaginaIngreso error={sesion.error} alIngresar={sesion.recargar} />
  }

  // Gatea una ruta por permiso de panel. Mientras la config no llegó se muestra
  // un cargando (no se rebota: si no, al que SÍ tiene acceso lo mandaba a `/`).
  const gate = (clave: ClaveFuncionPanel, element: ReactNode): ReactNode =>
    !permisos.listo ? (
      <div style={{ padding: 24, color: 'var(--tinta-tenue)' }}>Cargando…</div>
    ) : permisos.puedeVer(clave) ? (
      element
    ) : (
      <Navigate to="/" replace />
    )

  return (
    <ProveedorConsola rutaActual={ubicacion.pathname}>
    <div className="marco">
      <BarraLateral
        nombre={sesion.perfil.nombre_completo}
        rol={sesion.perfil.rol}
        puedeVer={permisos.puedeVer}
        esAdmin={sesion.esAdmin}
        alSalir={sesion.salir}
      />

      <main className="contenido">
        <Routes>
          {/* El Tablero es el landing de cualquiera que entre al panel.
              Administración ve el suyo (sus colas de trabajo); el resto, el del día. */}
          <Route path="/" element={<PaginaTablero rol={sesion.perfil.rol} />} />
          {/* Permisos es sólo de admin: no entra al catálogo configurable. */}
          <Route
            path="/permisos"
            element={sesion.esAdmin ? <PaginaPermisos soloLectura={false} /> : <Navigate to="/" replace />}
          />
          <Route path="/usuarios" element={gate('panel_usuarios', <PaginaUsuarios soloLectura={!sesion.esAdmin} />)} />
          <Route path="/clientes" element={gate('panel_clientes', <PaginaClientes soloLectura={!sesion.esAdmin} />)} />
          <Route
            path="/clientes-a-confirmar"
            element={gate('panel_clientes_a_confirmar', <PaginaClientesAConfirmar soloLectura={!sesion.esAdministracion} />)}
          />
          <Route
            path="/modificaciones"
            element={gate('panel_modificaciones', <PaginaModificacionesClientes />)}
          />
          <Route
            path="/cambios-direccion"
            element={gate('panel_cambios_direccion', <PaginaCambiosDireccion soloLectura={!sesion.esAdministracion} />)}
          />
          <Route
            path="/a-confirmar"
            element={gate('panel_articulos_confirmar', <PaginaArticulosAConfirmar soloLectura={!sesion.esAdministracion} />)}
          />
          <Route
            path="/notas"
            element={gate(
              'panel_notas_pedido',
              <PaginaNotasPedido soloLectura={!sesion.esAdministracion} esAdmin={sesion.esAdmin} />,
            )}
          />
          <Route
            path="/cola-impresion"
            element={gate('panel_cola_impresion', <PaginaColaImpresion soloLectura={!sesion.esAdministracion} />)}
          />
          <Route path="/roles" element={gate('panel_roles_visita', <PaginaRolesDeVisita soloLectura={!sesion.esAdmin} />)} />
          <Route path="/rol-maestro" element={gate('panel_rol_maestro', <PaginaRolMaestro soloLectura={!sesion.esAdmin} />)} />
          <Route path="/mapa" element={gate('panel_mapa_en_vivo', <PaginaMapaEnVivo />)} />
          <Route path="/clientes-mapa" element={gate('panel_mapa_clientes', <PaginaMapaClientes />)} />
          <Route path="/problemas" element={gate('panel_problemas', <PaginaProblemas soloLectura={!sesion.esAdmin} />)} />
          <Route
            path="/actualizaciones"
            element={gate('panel_actualizaciones', <PaginaActualizaciones soloLectura={!sesion.esAdmin} />)}
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
    </ProveedorConsola>
  )
}

function BarraLateral({
  nombre,
  rol,
  puedeVer,
  esAdmin,
  alSalir,
}: {
  nombre: string
  rol: string
  puedeVer: (clave: ClaveFuncionPanel) => boolean
  esAdmin: boolean
  alSalir: () => void
}) {
  // El globo rojo sobre "Usuarios" es lo que hace que las altas pendientes no
  // se queden esperando días: se ven desde cualquier pantalla.
  const { data: pendientes } = useQuery({
    queryKey: ['usuarios-pendientes'],
    queryFn: async () => {
      const { count } = await supabase
        .from('perfiles')
        .select('id', { count: 'exact', head: true })
        .eq('estado', 'pendiente')
      const { count: dispositivos } = await supabase
        .from('dispositivos')
        .select('id', { count: 'exact', head: true })
        .eq('autorizado', false)
      // También los pedidos de contraseña esperando que alguien los habilite:
      // es otra cosa que, si no salta un globo, se queda sin atender con un
      // vendedor afuera de la app.
      const { count: contrasenas } = await supabase
        .from('pedidos_contrasena')
        .select('id', { count: 'exact', head: true })
        .eq('estado', 'pendiente')
      return (count ?? 0) + (dispositivos ?? 0) + (contrasenas ?? 0)
    },
    refetchInterval: 30_000,
  })

  const { data: sinCliente } = useQuery({
    queryKey: ['notas-sin-cliente'],
    queryFn: async () => {
      const { count } = await supabase
        .from('notas_pedido')
        .select('id', { count: 'exact', head: true })
        .eq('estado', 'pendiente_cliente')
      return count ?? 0
    },
    refetchInterval: 30_000,
  })

  const { data: aConfirmar } = useQuery({
    queryKey: ['a-confirmar-total'],
    queryFn: async () => {
      const { count } = await supabase
        .from('catalogo_articulos')
        .select('id', { count: 'exact', head: true })
        .eq('precio_a_confirmar', true)
      return count ?? 0
    },
    refetchInterval: 30_000,
  })

  // Clientes que cargó un vendedor y la oficina todavía no confirmó (código
  // definitivo). Van como globo para que no queden esperando sin que nadie mire.
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

  /**
   * Cuántas notas están esperando el papel.
   *
   * Va como globo en el menú porque la cola no sirve si hay que acordarse de
   * mirarla: el vendedor manda a imprimir desde la calle y necesita que en la
   * oficina alguien lo vea sin que nadie le avise.
   */
  const { data: aImprimir } = useQuery({
    queryKey: ['cola-impresion-total'],
    queryFn: async () => {
      const { count } = await supabase
        .from('ordenes_impresion')
        .select('id', { count: 'exact', head: true })
        .in('estado', ['pendiente', 'imprimiendo'])
      return count ?? 0
    },
    refetchInterval: 15_000,
  })

  /*
   * Cuantos problemas hay sin resolver.
   *
   * Va como globo por lo mismo que las altas pendientes: un reporte que hay que
   * acordarse de ir a mirar es un reporte que se queda dias sin leer, y del
   * otro lado hay alguien parado en la calle esperando.
   */
  const { data: problemas } = useQuery({
    queryKey: ['reportes-abiertos'],
    queryFn: async () => {
      const { count } = await supabase
        .from('reportes_problema')
        .select('id', { count: 'exact', head: true })
        .in('estado', ['nuevo', 'en_revision'])
      return count ?? 0
    },
    refetchInterval: 60_000,
  })

  /*
   * Cuántos cambios de dirección esperan que la oficina los aplique.
   *
   * Va como globo por lo mismo que los reportes: el vendedor corrige la
   * ubicación desde la calle y del otro lado alguien tiene que verlo y aplicarlo
   * a la base, si no la corrección se queda en un pedido que nadie mira.
   */
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

  // Cada enlace sabe a qué permiso de panel pertenece. El Tablero no tiene
  // permiso (lo ve cualquiera que entre); Permisos es `soloAdmin`. El resto se
  // esconde si el rol no lo tiene habilitado (admin ve todo).
  const enlaces: Array<{
    a: string
    icono: string
    texto: string
    globo?: number
    permiso?: ClaveFuncionPanel
    soloAdmin?: boolean
  }> = [
    { a: '/', icono: '▦', texto: 'Tablero' },
    { a: '/mapa', icono: '◉', texto: 'Mapa en vivo', permiso: 'panel_mapa_en_vivo' },
    { a: '/clientes-mapa', icono: '🗺', texto: 'Mapa', permiso: 'panel_mapa_clientes' },
    { a: '/notas', icono: '🧾', texto: 'Notas de pedido', globo: sinCliente, permiso: 'panel_notas_pedido' },
    { a: '/cola-impresion', icono: '🖨', texto: 'Cola de impresión', globo: aImprimir, permiso: 'panel_cola_impresion' },
    { a: '/roles', icono: '▤', texto: 'Roles de visita', permiso: 'panel_roles_visita' },
    { a: '/rol-maestro', icono: '🗓', texto: 'Rol maestro', permiso: 'panel_rol_maestro' },
    { a: '/clientes', icono: '☰', texto: 'Clientes', permiso: 'panel_clientes' },
    { a: '/clientes-a-confirmar', icono: '🆕', texto: 'Clientes a confirmar', globo: clientesAConfirmar, permiso: 'panel_clientes_a_confirmar' },
    { a: '/modificaciones', icono: '✎', texto: 'Modificaciones', permiso: 'panel_modificaciones' },
    { a: '/cambios-direccion', icono: '📍', texto: 'Cambios de dirección', globo: cambiosDir, permiso: 'panel_cambios_direccion' },
    { a: '/usuarios', icono: '◍', texto: 'Usuarios', globo: pendientes, permiso: 'panel_usuarios' },
    { a: '/permisos', icono: '🔒', texto: 'Permisos', soloAdmin: true },
    { a: '/a-confirmar', icono: '⚠', texto: 'A confirmar', globo: aConfirmar, permiso: 'panel_articulos_confirmar' },
    { a: '/problemas', icono: '🛠', texto: 'Problemas', globo: problemas, permiso: 'panel_problemas' },
    { a: '/actualizaciones', icono: '⭮', texto: 'Actualizaciones', permiso: 'panel_actualizaciones' },
  ]

  const visibles = enlaces.filter((e) =>
    e.soloAdmin ? esAdmin : e.permiso ? puedeVer(e.permiso) : true,
  )

  return (
    <nav className="barra-lateral">
      <div className="marca-lateral">
        WOODTOOLS
        <small>Panel de administración</small>
      </div>

      {/*
        Los enlaces scrollean solos (flex:1 + min-height:0). Antes iban sueltos
        dentro de la barra y, con catorce de ellos, empujaban el botón de salir
        abajo del borde: había que scrollear toda la barra para encontrarlo, así
        que parecía que el panel no dejaba cerrar sesión. Ahora el pie queda fijo.
      */}
      <div className="barra-lateral-lista">
        {visibles.map((e) => (
          <NavLink
            key={e.a}
            to={e.a}
            end={e.a === '/'}
            className={({ isActive }) => `enlace-lateral${isActive ? ' activo' : ''}`}
          >
            <span aria-hidden>{e.icono}</span>
            {e.texto}
            {e.globo ? <span className="globo">{e.globo}</span> : null}
          </NavLink>
        ))}
      </div>

      <div className="barra-lateral-pie">
        <div className="barra-lateral-usuario">
          {nombre}
          <br />
          <span style={{ textTransform: 'capitalize' }}>{rol}</span>
        </div>
        <button className="chico boton-salir" onClick={alSalir}>
          <span aria-hidden>⏻</span> Cerrar sesión
        </button>
      </div>
    </nav>
  )
}
