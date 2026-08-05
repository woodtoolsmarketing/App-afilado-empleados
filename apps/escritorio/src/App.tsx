import { useQuery } from '@tanstack/react-query'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'

import { supabase } from './nucleo/supabase'
import { usarSesion } from './nucleo/sesion'
import { PaginaArticulosAConfirmar } from './paginas/ArticulosAConfirmar'
import { PaginaClientes } from './paginas/Clientes'
import { PaginaIngreso } from './paginas/Ingreso'
import { PaginaMapaEnVivo } from './paginas/MapaEnVivo'
import { PaginaNotasPedido } from './paginas/NotasPedido'
import { PaginaRolesDeVisita } from './paginas/RolesDeVisita'
import { PaginaTablero } from './paginas/Tablero'
import { PaginaUsuarios } from './paginas/Usuarios'

export function App() {
  const sesion = usarSesion()

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
          <Route path="/roles" element={<PaginaRolesDeVisita soloLectura={!sesion.esAdmin} />} />
          <Route path="/mapa" element={<PaginaMapaEnVivo />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
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

  const enlaces = [
    { a: '/', icono: '▦', texto: 'Tablero' },
    { a: '/mapa', icono: '◉', texto: 'Mapa en vivo' },
    { a: '/notas', icono: '🧾', texto: 'Notas de pedido', globo: sinCliente },
    { a: '/roles', icono: '▤', texto: 'Roles de visita' },
    { a: '/clientes', icono: '☰', texto: 'Clientes' },
    { a: '/usuarios', icono: '◍', texto: 'Usuarios', globo: pendientes },
    { a: '/a-confirmar', icono: '⚠', texto: 'A confirmar', globo: aConfirmar },
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
