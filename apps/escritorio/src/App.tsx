import { useQuery } from '@tanstack/react-query'
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'

import { supabase } from './nucleo/supabase'
import { usarPublicarDireccionDelPanel } from './nucleo/publicarPanel'
import { ProveedorConsola } from './nucleo/consola'
import { usarSesion } from './nucleo/sesion'
import { PaginaActualizaciones } from './paginas/Actualizaciones'
import { PaginaArticulosAConfirmar } from './paginas/ArticulosAConfirmar'
import { PaginaClientes } from './paginas/Clientes'
import { PaginaColaImpresion } from './paginas/ColaImpresion'
import { PaginaIngreso } from './paginas/Ingreso'
import { PaginaMapaEnVivo } from './paginas/MapaEnVivo'
import { PaginaNotasPedido } from './paginas/NotasPedido'
import { PaginaProblemas } from './paginas/Problemas'
import { PaginaRolMaestro } from './paginas/RolMaestro'
import { PaginaRolesDeVisita } from './paginas/RolesDeVisita'
import { PaginaTablero } from './paginas/Tablero'
import { PaginaUsuarios } from './paginas/Usuarios'

export function App() {
  const sesion = usarSesion()
  // La ruta entra al proveedor porque cambiar de página borra lo que la consola
  // haya destrabado: es la mitad de "cada vez hay que volver a escribirlo".
  const ubicacion = useLocation()

  // Los teléfonos necesitan saber en qué dirección está esta PC para poder
  // bajarse la app nueva. Se publica sola: el router puede cambiarla.
  usarPublicarDireccionDelPanel(sesion.esAdmin)

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

  return (
    <ProveedorConsola rutaActual={ubicacion.pathname}>
    <div className="marco">
      <BarraLateral nombre={sesion.perfil.nombre_completo} rol={sesion.perfil.rol} alSalir={sesion.salir} />

      <main className="contenido">
        <Routes>
          <Route path="/" element={<PaginaTablero />} />
          <Route path="/usuarios" element={<PaginaUsuarios soloLectura={!sesion.esAdmin} />} />
          <Route path="/clientes" element={<PaginaClientes soloLectura={!sesion.esAdmin} />} />
          <Route
            path="/a-confirmar"
            element={<PaginaArticulosAConfirmar soloLectura={!sesion.esAdministracion} />}
          />
          <Route
            path="/notas"
            element={<PaginaNotasPedido soloLectura={!sesion.esAdministracion} />}
          />
          <Route
            path="/cola-impresion"
            element={<PaginaColaImpresion soloLectura={!sesion.esAdministracion} />}
          />
          <Route path="/roles" element={<PaginaRolesDeVisita soloLectura={!sesion.esAdmin} />} />
          <Route path="/rol-maestro" element={<PaginaRolMaestro soloLectura={!sesion.esAdmin} />} />
          <Route path="/mapa" element={<PaginaMapaEnVivo />} />
          <Route path="/problemas" element={<PaginaProblemas soloLectura={!sesion.esAdmin} />} />
          <Route
            path="/actualizaciones"
            element={<PaginaActualizaciones soloLectura={!sesion.esAdmin} />}
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
  alSalir,
}: {
  nombre: string
  rol: string
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
      return (count ?? 0) + (dispositivos ?? 0)
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

  const enlaces = [
    { a: '/', icono: '▦', texto: 'Tablero' },
    { a: '/mapa', icono: '◉', texto: 'Mapa en vivo' },
    { a: '/notas', icono: '🧾', texto: 'Notas de pedido', globo: sinCliente },
    { a: '/cola-impresion', icono: '🖨', texto: 'Cola de impresión', globo: aImprimir },
    { a: '/roles', icono: '▤', texto: 'Roles de visita' },
    { a: '/rol-maestro', icono: '🗓', texto: 'Rol maestro' },
    { a: '/clientes', icono: '☰', texto: 'Clientes' },
    { a: '/usuarios', icono: '◍', texto: 'Usuarios', globo: pendientes },
    { a: '/a-confirmar', icono: '⚠', texto: 'A confirmar', globo: aConfirmar },
    { a: '/problemas', icono: '🛠', texto: 'Problemas', globo: problemas },
    { a: '/actualizaciones', icono: '⭮', texto: 'Actualizaciones' },
  ]

  return (
    <nav className="barra-lateral">
      <div className="marca-lateral">
        WOODTOOLS
        <small>Panel de administración</small>
      </div>

      {enlaces.map((e) => (
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

      <div style={{ marginTop: 'auto', paddingTop: 20 }}>
        <div style={{ fontSize: 12, opacity: 0.8, padding: '0 10px 10px' }}>
          {nombre}
          <br />
          <span style={{ textTransform: 'capitalize' }}>{rol}</span>
        </div>
        <button className="chico" onClick={alSalir} style={{ width: '100%' }}>
          Cerrar sesión
        </button>
      </div>
    </nav>
  )
}
