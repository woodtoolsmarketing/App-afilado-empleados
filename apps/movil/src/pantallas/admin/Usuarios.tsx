import {
  espaciado,
  ETIQUETA_ESTADO_USUARIO,
  ETIQUETA_ROL,
  formatearFechaCorta,
  formatearHora,
  radios,
  TOQUE_MINIMO,
  type Paleta,
  type Perfil,
  type RolUsuario,
} from '@woodtools/compartido'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Image } from 'expo-image'
import { useState } from 'react'
import { Alert, Modal, Pressable, Share, Text, View } from 'react-native'

import { BotonMenu, BotonPrincipal, BotonSecundario } from '../../componentes/Botones'
import { Aviso, Pastilla, Vacio } from '../../componentes/Estado'
import { Campo, Desplegable, type ItemDesplegable } from '../../componentes/Formulario'
import { Encabezado } from '../../componentes/Encabezado'
import { BarraPanel, Pantalla, Panel, TituloPanel } from '../../componentes/Pantalla'
import type { PropsPantalla } from '../../navegacion/tipos'
import { hojaDeTema, usarTema } from '../../nucleo/tema'
import {
  autorizarDispositivo,
  cambiarEstadoUsuario,
  crearUsuario,
  eliminarDispositivo,
  guardarCodigoVendedor,
  guardarZonasVendedor,
  habilitarPedidoContrasena,
  listarDispositivos,
  listarPedidosContrasena,
  listarPerfiles,
  MINUTOS_HABILITADO,
  rehabilitarUsuario,
  resolverAlta,
  ultimasConexiones,
  type CredencialProvisoria,
  type DispositivoConDueno,
  type PedidoContrasena,
  type UltimaConexion,
} from '../../servicios/administracion'
import { elegirFotosDeGaleria, sacarFotoConCamara } from '../../servicios/adjuntosReporte'
import { conMensajeDeSenal } from '../../nucleo/loUltimoQueSupimos'

/**
 * "USUARIOS" — el panel de la oficina, en el teléfono de un administrador.
 *
 * Son los dos candados que separan "tener la contraseña" de "poder usar la
 * app": el alta del usuario y la habilitación del teléfono. Los dos se resuelven
 * desde acá, además de los pedidos de contraseña olvidada y el ABM de estados.
 *
 * Todo pasa por `servicios/administracion`: las RLS, las RPC y las edge
 * functions ya gatean por `perfiles.rol`, así que un admin logueado en el
 * teléfono pasa los mismos controles que en la PC.
 *
 * ── Decisiones de UX propias del teléfono ──────────────────────────────────
 *  · El "+ Nuevo usuario" y el motivo de rechazo abren en Modal, porque
 *    `Alert.prompt` no existe en Android.
 *  · La contraseña provisoria (la devuelven crear y rehabilitar) se muestra UNA
 *    vez y se comparte con `Share.share`, ya que no hay portapapeles.
 *  · Las acciones irreversibles (baja, eliminar teléfono, sacar de suspensión)
 *    confirman con `Alert`.
 */

const ITEMS_ROL: ItemDesplegable<RolUsuario>[] = [
  { valor: 'vendedor', etiqueta: 'Vendedor', descripcion: 'Usa la app del celular y ve sólo lo suyo' },
  { valor: 'supervisor', etiqueta: 'Supervisor', descripcion: 'Ve a todos los vendedores en vivo' },
  {
    valor: 'administracion',
    etiqueta: 'Administración',
    descripcion: 'Ve las notas, asigna códigos de cliente y completa precios',
  },
  { valor: 'admin', etiqueta: 'Administrador', descripcion: 'Control total, incluidas las altas' },
]

export function PantallaUsuarios({ navigation }: PropsPantalla<'AdminUsuarios'>) {
  const estilos = usarEstilos()
  const { colores } = usarTema()
  const cliente = useQueryClient()

  const [mensaje, setMensaje] = useState<string | null>(null)
  const [credencial, setCredencial] = useState<CredencialProvisoria | null>(null)
  const [altaAbierta, setAltaAbierta] = useState(false)
  const [errorAlta, setErrorAlta] = useState<string | null>(null)
  const [rechazoDe, setRechazoDe] = useState<Perfil | null>(null)
  const [motivoRechazo, setMotivoRechazo] = useState('')

  // ── Datos ─────────────────────────────────────────────────────────────────
  const {
    data: perfiles = [],
    isLoading: cargandoPerfiles,
    error: falloPerfiles,
    refetch: recargarPerfiles,
  } = useQuery({ queryKey: ['admin-perfiles'], queryFn: listarPerfiles })
  const { data: conexiones = [] } = useQuery({
    queryKey: ['admin-conexiones'],
    queryFn: ultimasConexiones,
    refetchInterval: 60_000,
  })
  const {
    data: dispositivos = [],
    isLoading: cargandoDispositivos,
    error: falloDispositivos,
    refetch: recargarDispositivos,
  } = useQuery({ queryKey: ['admin-dispositivos'], queryFn: listarDispositivos })
  const {
    data: pedidos = [],
    isLoading: cargandoPedidos,
    error: falloPedidos,
    refetch: recargarPedidos,
  } = useQuery({
    queryKey: ['admin-pedidos-contrasena'],
    queryFn: listarPedidosContrasena,
    refetchInterval: 30_000,
  })

  const conexionDe = new Map<string, UltimaConexion>(conexiones.map((c) => [c.perfil_id, c]))

  const pendientes = perfiles.filter((p) => p.estado === 'pendiente')
  const resto = perfiles.filter((p) => p.estado !== 'pendiente')
  const telefonosPendientes = dispositivos.filter((d) => !d.autorizado)
  const resetsPendientes = pedidos.filter((p) => p.estado === 'pendiente')
  const resetsResueltos = pedidos.filter((p) => p.estado !== 'pendiente')

  function invalidar() {
    void cliente.invalidateQueries()
  }
  function fallo(prefijo: string) {
    // conMensajeDeSenal traduce el "Network request failed" a castellano; cualquier
    // otro error (un rechazo del servidor) pasa tal cual.
    return (e: Error) => Alert.alert('No se pudo completar', `${prefijo}: ${conMensajeDeSenal(e).message}`)
  }

  // ── Mutaciones ──────────────────────────────────────────────────────────────
  const resolver = useMutation({
    mutationFn: resolverAlta,
    onSuccess: (_d, v) => {
      setMensaje(v.aprobar ? 'Usuario aprobado. Ya puede entrar a la app.' : 'Solicitud rechazada.')
      invalidar()
    },
    onError: fallo('No se pudo resolver el alta'),
  })

  const cambiarEstado = useMutation({
    mutationFn: (v: { perfilId: string; estado: Perfil['estado'] }) =>
      cambiarEstadoUsuario(v.perfilId, v.estado),
    onSuccess: () => {
      setMensaje('Estado actualizado.')
      invalidar()
    },
    onError: fallo('No se pudo actualizar el estado'),
  })

  const rehabilitar = useMutation({
    mutationFn: rehabilitarUsuario,
    onSuccess: (data) => {
      setCredencial(data)
      setMensaje('Cuenta rehabilitada. Anotá la contraseña provisoria: no se vuelve a mostrar.')
      invalidar()
    },
    onError: fallo('No se pudo rehabilitar'),
  })

  const guardarCodigo = useMutation({
    mutationFn: (v: { perfilId: string; codigo: string }) => guardarCodigoVendedor(v.perfilId, v.codigo),
    onSuccess: () => {
      setMensaje('Número de vendedor actualizado. Sale en las notas nuevas.')
      invalidar()
    },
    onError: fallo('No se pudo guardar el número'),
  })

  const guardarZonas = useMutation({
    mutationFn: (v: { perfilId: string; zonas: string[] }) => guardarZonasVendedor(v.perfilId, v.zonas),
    onSuccess: () => {
      setMensaje('Zonas actualizadas.')
      invalidar()
    },
    onError: fallo('No se pudieron guardar las zonas'),
  })

  const autorizar = useMutation({
    mutationFn: (id: string) => autorizarDispositivo(id, true),
    onSuccess: () => {
      setMensaje('Teléfono habilitado.')
      invalidar()
    },
    onError: fallo('No se pudo habilitar el teléfono'),
  })

  const eliminar = useMutation({
    mutationFn: eliminarDispositivo,
    onSuccess: () => {
      setMensaje('Teléfono eliminado.')
      invalidar()
    },
    onError: fallo('No se pudo eliminar el teléfono'),
  })

  const habilitarPedido = useMutation({
    mutationFn: habilitarPedidoContrasena,
    onSuccess: () => {
      setMensaje(
        `Habilitado. El vendedor tiene ${MINUTOS_HABILITADO} minutos para elegir su contraseña nueva desde la app.`,
      )
      invalidar()
    },
    onError: fallo('No se pudo habilitar el pedido'),
  })

  const crear = useMutation({
    mutationFn: crearUsuario,
    onSuccess: (data) => {
      setCredencial(data)
      setMensaje('Usuario creado. Anotá la contraseña provisoria: no se vuelve a mostrar.')
      setAltaAbierta(false)
      setErrorAlta(null)
      invalidar()
    },
    onError: (e: Error) => setErrorAlta(e.message),
  })

  function abrirAlta() {
    setErrorAlta(null)
    setMensaje(null)
    setAltaAbierta(true)
  }

  function abrirRechazo(perfil: Perfil) {
    setMotivoRechazo('')
    setRechazoDe(perfil)
  }
  function confirmarRechazo() {
    if (!rechazoDe) return
    resolver.mutate({ perfilId: rechazoDe.id, aprobar: false, motivo: motivoRechazo.trim() || null })
    setRechazoDe(null)
  }

  return (
    <Pantalla>
      <Encabezado />

      <Panel contentStyle={estilos.contenido}>
        <BarraPanel alVolver={() => navigation.goBack()} />
        <TituloPanel>USUARIOS</TituloPanel>
        <Text style={estilos.ayuda}>
          Dá de alta empleados, asigná el código de vendedor y habilitá los teléfonos.
        </Text>

        <BotonMenu titulo="+ NUEVO USUARIO" alTocar={abrirAlta} />

        {mensaje ? (
          <Aviso tono="exito" titulo="Listo">
            {mensaje}
          </Aviso>
        ) : null}

        {credencial ? (
          <TarjetaCredencial
            credencial={credencial}
            alCerrar={() => {
              setCredencial(null)
              // La contraseña provisoria no tiene por qué quedar en la caché de
              // la mutación después de cerrar la tarjeta.
              crear.reset()
              rehabilitar.reset()
            }}
          />
        ) : null}

        {/* ── 1 · Esperando aprobación ──────────────────────────────────────── */}
        <Text style={estilos.seccionTitulo}>
          ESPERANDO APROBACIÓN{cargandoPerfiles || falloPerfiles ? '' : ` (${pendientes.length})`}
        </Text>
        {cargandoPerfiles ? (
          <Text style={estilos.cargando}>Cargando…</Text>
        ) : falloPerfiles ? (
          <SeccionError alReintentar={() => void recargarPerfiles()} />
        ) : pendientes.length === 0 ? (
          <Text style={estilos.vacioTexto}>No hay solicitudes pendientes.</Text>
        ) : (
          pendientes.map((p) => (
            <FilaPendiente
              key={p.id}
              perfil={p}
              aprobando={resolver.isPending}
              onAprobar={(datos) =>
                resolver.mutate({ perfilId: p.id, aprobar: true, rol: datos.rol, codigo: datos.codigo })
              }
              onRechazar={() => abrirRechazo(p)}
            />
          ))
        )}

        {/* ── 2 · Teléfonos por habilitar ───────────────────────────────────── */}
        <Text style={estilos.seccionTitulo}>
          TELÉFONOS POR HABILITAR{cargandoDispositivos || falloDispositivos ? '' : ` (${telefonosPendientes.length})`}
        </Text>
        {cargandoDispositivos ? (
          <Text style={estilos.cargando}>Cargando…</Text>
        ) : falloDispositivos ? (
          <SeccionError
            titulo="No pudimos traer los teléfonos"
            detalle="Nadie confirmó que no haya ninguno esperando. Revisá la conexión y volvé a intentar."
            alReintentar={() => void recargarDispositivos()}
          />
        ) : telefonosPendientes.length === 0 ? (
          <Text style={estilos.vacioTexto}>Todos los teléfonos registrados están habilitados.</Text>
        ) : (
          telefonosPendientes.map((d) => (
            <FilaTelefono
              key={d.id}
              dispositivo={d}
              habilitando={autorizar.isPending}
              eliminando={eliminar.isPending}
              onHabilitar={() => autorizar.mutate(d.id)}
              onEliminar={() => eliminar.mutate(d.id)}
            />
          ))
        )}

        {/* ── 3 · Contraseñas olvidadas ─────────────────────────────────────── */}
        <Text style={estilos.seccionTitulo}>
          CONTRASEÑAS OLVIDADAS{cargandoPedidos || (falloPedidos && pedidos.length === 0) ? '' : ` (${resetsPendientes.length})`}
        </Text>
        <Text style={estilos.seccionAyuda}>
          Cuando alguien pide restablecer la contraseña, aparece acá. Al habilitarlo tiene{' '}
          {MINUTOS_HABILITADO} minutos para elegir una nueva desde la app; no se dicta ninguna
          provisoria.
        </Text>
        {cargandoPedidos ? (
          <Text style={estilos.cargando}>Cargando…</Text>
        ) : falloPedidos && pedidos.length === 0 ? (
          // Sólo mostramos el error si NO hay datos cacheados: como esta consulta
          // se repite sola cada 30 s, un bache transitorio no tiene por qué tapar
          // los pedidos que ya trajimos.
          <SeccionError alReintentar={() => void recargarPedidos()} />
        ) : resetsPendientes.length === 0 ? (
          <Text style={estilos.vacioTexto}>No hay pedidos esperando.</Text>
        ) : (
          resetsPendientes.map((p) => (
            <View key={p.id} style={estilos.fila}>
              <Text style={estilos.filaNombre}>{p.usuario}</Text>
              <Text style={estilos.filaSub}>
                Pidió desde {p.origen === 'panel' ? 'el panel' : 'el celular'}
                {p.dispositivo_desc ? ` · ${p.dispositivo_desc}` : ''}
              </Text>
              <Text style={estilos.filaSub}>
                {formatearFechaCorta(p.creado_en)} · {formatearHora(p.creado_en)}
              </Text>
              <BotonPrincipal
                titulo="PERMITIR CAMBIO"
                style={estilos.botonAncho}
                cargando={habilitarPedido.isPending}
                alTocar={() => habilitarPedido.mutate(p.id)}
              />
            </View>
          ))
        )}
        {resetsResueltos.length > 0 ? (
          <View style={estilos.resueltos}>
            <Text style={estilos.seccionAyuda}>Últimos resueltos</Text>
            {resetsResueltos.map((p) => (
              <View key={p.id} style={estilos.filaResuelto}>
                <Text style={estilos.filaSub}>
                  <Text style={estilos.resueltoUsuario}>{p.usuario}</Text> · {textoPedidoResuelto(p)}
                </Text>
                <Text style={estilos.filaTenue}>
                  {formatearFechaCorta(p.usada_en ?? p.habilitado_en ?? p.creado_en)} ·{' '}
                  {formatearHora(p.usada_en ?? p.habilitado_en ?? p.creado_en)}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        {/* ── 4 · Todos los usuarios ────────────────────────────────────────── */}
        <Text style={estilos.seccionTitulo}>
          TODOS LOS USUARIOS{cargandoPerfiles || falloPerfiles ? '' : ` (${resto.length})`}
        </Text>
        {cargandoPerfiles ? (
          <Text style={estilos.cargando}>Cargando…</Text>
        ) : falloPerfiles ? (
          <SeccionError alReintentar={() => void recargarPerfiles()} />
        ) : resto.length === 0 ? (
          <Vacio titulo="Todavía no hay usuarios" icono="👥" />
        ) : (
          resto.map((p) => (
            <FilaUsuario
              key={p.id}
              perfil={p}
              conexion={conexionDe.get(p.id)}
              colores={colores}
              guardandoCodigo={guardarCodigo.isPending}
              guardandoZonas={guardarZonas.isPending}
              procesandoEstado={cambiarEstado.isPending}
              rehabilitando={rehabilitar.isPending}
              onGuardarCodigo={(codigo) => guardarCodigo.mutate({ perfilId: p.id, codigo })}
              onGuardarZonas={(zonas) => guardarZonas.mutate({ perfilId: p.id, zonas })}
              onSuspender={() => cambiarEstado.mutate({ perfilId: p.id, estado: 'suspendido' })}
              onReactivar={() => cambiarEstado.mutate({ perfilId: p.id, estado: 'aprobado' })}
              onRehabilitar={() => rehabilitar.mutate(p.id)}
              onBaja={() => cambiarEstado.mutate({ perfilId: p.id, estado: 'baja' })}
            />
          ))
        )}
      </Panel>

      {/* ── Modal: nuevo usuario ─────────────────────────────────────────────
          Se monta y se desmonta con `altaAbierta` (no sólo se togglea `visible`)
          para que cada alta arranque en blanco: montado siempre, el estado del
          formulario —incluida la foto elegida— sobrevivía al cierre y se colaba
          en el usuario siguiente. Es el mismo patrón que el formulario de
          clientes, que ya nace limpio por montarse condicionalmente. */}
      {altaAbierta ? (
        <ModalAlta
          visible
          enviando={crear.isPending}
          error={errorAlta}
          alCerrar={() => {
            if (crear.isPending) return
            setAltaAbierta(false)
          }}
          alEnviar={(payload) => {
            setErrorAlta(null)
            crear.mutate(payload)
          }}
        />
      ) : null}

      {/* ── Modal: motivo de rechazo (Alert.prompt no existe en Android) ─────── */}
      <Modal
        visible={!!rechazoDe}
        transparent
        animationType="fade"
        onRequestClose={() => setRechazoDe(null)}
      >
        <Pressable style={estilos.velo} onPress={() => setRechazoDe(null)}>
          <Pressable style={estilos.hoja} onPress={(e) => e.stopPropagation()}>
            <Text style={estilos.hojaTitulo}>Rechazar solicitud</Text>
            <Text style={estilos.filaSub}>{rechazoDe?.nombre_completo}</Text>
            <Campo
              etiqueta="MOTIVO"
              value={motivoRechazo}
              onChangeText={setMotivoRechazo}
              placeholder="Lo va a ver el usuario"
              multiline
              numberOfLines={3}
              ayuda="Podés dejarlo vacío, pero conviene explicar por qué."
              autoCapitalize="sentences"
            />
            <BotonSecundario
              titulo="RECHAZAR SOLICITUD"
              style={estilos.botonPeligro}
              alTocar={confirmarRechazo}
            />
            <BotonSecundario titulo="Cancelar" alTocar={() => setRechazoDe(null)} />
          </Pressable>
        </Pressable>
      </Modal>
    </Pantalla>
  )
}

/**
 * "No pudimos traerlo" + Reintentar, para una sección que falló al cargar.
 *
 * Sin esto, una consulta caída (sin señal) dejaba la sección diciendo "no hay
 * nada", que es afirmar algo falso. Nunca muestra el error crudo —sería inglés
 * de Supabase—: un texto fijo que dice qué hacer, como el resto de la app.
 */
function SeccionError({
  titulo,
  detalle,
  alReintentar,
}: {
  titulo?: string
  detalle?: string
  alReintentar: () => void
}) {
  return (
    <>
      <Aviso tono="error" titulo={titulo ?? 'No pudimos traerlo'}>
        {detalle ?? 'Revisá la conexión y volvé a intentar.'}
      </Aviso>
      <BotonSecundario titulo="↻  Reintentar" alTocar={alReintentar} />
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Contraseña provisoria — se ve UNA vez
// ─────────────────────────────────────────────────────────────────────────────

function TarjetaCredencial({
  credencial,
  alCerrar,
}: {
  credencial: CredencialProvisoria
  alCerrar: () => void
}) {
  const estilos = usarEstilos()

  function compartir() {
    const lineas = [`Usuario: ${credencial.usuario}`]
    if (credencial.email) lineas.push(`Correo: ${credencial.email}`)
    lineas.push(`Contraseña provisoria: ${credencial.contrasena_provisoria}`)
    void Share.share({ message: lineas.join('\n') }).catch(() => undefined)
  }

  return (
    <View style={estilos.credencial}>
      <Text style={estilos.credencialTitulo}>Contraseña provisoria de {credencial.usuario}</Text>

      <View style={estilos.credencialFila}>
        <Text style={estilos.credencialRotulo}>Usuario</Text>
        <Text style={estilos.mono}>{credencial.usuario}</Text>
      </View>
      {credencial.email ? (
        <View style={estilos.credencialFila}>
          <Text style={estilos.credencialRotulo}>Correo</Text>
          <Text style={estilos.mono}>{credencial.email}</Text>
        </View>
      ) : null}
      <View style={estilos.credencialFila}>
        <Text style={estilos.credencialRotulo}>Contraseña</Text>
        <Text style={estilos.monoGrande}>{credencial.contrasena_provisoria}</Text>
      </View>

      <Aviso tono="atencion" titulo="Anotala ahora: no se vuelve a mostrar">
        Dásela al vendedor. Al entrar, la app le va a pedir que la cambie por una suya.
      </Aviso>

      <BotonPrincipal titulo="COMPARTIR" style={estilos.botonAncho} alTocar={compartir} />
      <BotonSecundario titulo="Listo" alTocar={alCerrar} />
    </View>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// 1 · Alta pendiente
// ─────────────────────────────────────────────────────────────────────────────

function FilaPendiente({
  perfil,
  aprobando,
  onAprobar,
  onRechazar,
}: {
  perfil: Perfil
  aprobando: boolean
  onAprobar: (datos: { rol: RolUsuario; codigo: string }) => void
  onRechazar: () => void
}) {
  const estilos = usarEstilos()
  const [rol, setRol] = useState<RolUsuario>('vendedor')
  const [codigo, setCodigo] = useState(perfil.codigo_vendedor ?? '')

  // Sin código de vendedor la planilla del rol de visita queda sin la columna
  // "Codigo", así que se exige antes de aprobar.
  const faltaCodigo = rol === 'vendedor' && !codigo.trim()

  return (
    <View style={estilos.fila}>
      <Text style={estilos.filaNombre}>{perfil.nombre_completo}</Text>
      <Text style={estilos.filaSub}>
        {perfil.email}
        {perfil.usuario ? ` · ${perfil.usuario}` : ''}
      </Text>
      <Text style={estilos.filaTenue}>Solicitó el {formatearFechaCorta(perfil.creado_en)}</Text>

      <Desplegable<RolUsuario>
        etiqueta="APROBAR COMO"
        valor={rol}
        items={ITEMS_ROL}
        alCambiar={setRol}
      />
      <Campo
        etiqueta="CÓDIGO DE VENDEDOR"
        value={codigo}
        onChangeText={(t) => setCodigo(t.replace(/\D/g, '').slice(0, 4))}
        keyboardType="number-pad"
        placeholder="7"
        obligatorio={rol === 'vendedor'}
        error={faltaCodigo ? 'Asigná el código de vendedor' : null}
      />

      <BotonPrincipal
        titulo="APROBAR"
        style={estilos.botonAncho}
        deshabilitado={faltaCodigo || aprobando}
        cargando={aprobando}
        alTocar={() => onAprobar({ rol, codigo: codigo.trim() })}
      />
      <BotonSecundario titulo="RECHAZAR" style={estilos.botonPeligro} alTocar={onRechazar} />
    </View>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// 2 · Teléfono por habilitar
// ─────────────────────────────────────────────────────────────────────────────

function FilaTelefono({
  dispositivo,
  habilitando,
  eliminando,
  onHabilitar,
  onEliminar,
}: {
  dispositivo: DispositivoConDueno
  habilitando: boolean
  eliminando: boolean
  onHabilitar: () => void
  onEliminar: () => void
}) {
  const estilos = usarEstilos()
  const d = dispositivo
  const equipo = [d.fabricante, d.modelo].filter(Boolean).join(' ')

  function confirmarEliminar() {
    Alert.alert(
      'Eliminar teléfono',
      `¿Eliminar este teléfono de ${d.perfiles?.nombre_completo ?? 'este vendedor'}? Si el equipo sigue instalado, va a volver a aparecer acá al reabrir la app.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Eliminar', style: 'destructive', onPress: onEliminar },
      ],
    )
  }

  return (
    <View style={estilos.fila}>
      <Text style={estilos.filaNombre}>
        {d.perfiles?.nombre_completo ?? '—'}
        {d.perfiles?.codigo_vendedor ? ` (#${d.perfiles.codigo_vendedor})` : ''}
      </Text>
      <Text style={estilos.filaSub}>{equipo || 'Equipo desconocido'}</Text>
      <Text style={estilos.filaTenue}>
        {d.version_so ?? ''}
        {d.version_app ? `${d.version_so ? ' · ' : ''}App ${d.version_app}` : ''}
      </Text>
      {/* El vendedor ve estos 8 caracteres en su pantalla de espera. */}
      <View style={estilos.codigoEquipo}>
        <Text style={estilos.mono}>{d.instalacion_id.slice(0, 8).toUpperCase()}</Text>
      </View>

      <BotonPrincipal
        titulo="HABILITAR"
        style={estilos.botonAncho}
        cargando={habilitando}
        alTocar={onHabilitar}
      />
      <BotonSecundario
        titulo="ELIMINAR"
        style={estilos.botonPeligro}
        deshabilitado={eliminando}
        alTocar={confirmarEliminar}
      />
    </View>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// 4 · Usuario existente
// ─────────────────────────────────────────────────────────────────────────────

function FilaUsuario({
  perfil,
  conexion,
  colores,
  guardandoCodigo,
  guardandoZonas,
  procesandoEstado,
  rehabilitando,
  onGuardarCodigo,
  onGuardarZonas,
  onSuspender,
  onReactivar,
  onRehabilitar,
  onBaja,
}: {
  perfil: Perfil
  conexion?: UltimaConexion
  colores: Paleta
  guardandoCodigo: boolean
  guardandoZonas: boolean
  procesandoEstado: boolean
  rehabilitando: boolean
  onGuardarCodigo: (codigo: string) => void
  onGuardarZonas: (zonas: string[]) => void
  onSuspender: () => void
  onReactivar: () => void
  onRehabilitar: () => void
  onBaja: () => void
}) {
  const estilos = usarEstilos()

  // `guardado` se deriva del prop en cada dibujado (no es estado): así, tras
  // guardar e invalidar, el botón "Guardar" desaparece solo. Sólo el texto que
  // se está tipeando vive en estado.
  const codigoGuardado = perfil.codigo_vendedor ?? ''
  const [codigoTexto, setCodigoTexto] = useState(codigoGuardado)
  const cambioCodigo = codigoTexto.trim() !== codigoGuardado

  const zonasGuardadas = (perfil.zonas ?? []).join(', ')
  const [zonasTexto, setZonasTexto] = useState(zonasGuardadas)
  const zonas = zonasTexto
    .split(/[,\s]+/)
    .map((z) => z.trim())
    .filter(Boolean)
  const cambioZonas = zonas.join(', ') !== zonasGuardadas

  const ultima = conexion?.ultima_conexion

  function confirmarRehabilitar() {
    Alert.alert(
      'Reactivar cuenta',
      `Reactivar a ${perfil.nombre_completo}: se le genera una contraseña provisoria nueva (la anterior deja de servir) y la va a tener que cambiar al entrar. ¿Seguir?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Reactivar', onPress: onRehabilitar },
      ],
    )
  }
  function confirmarBaja() {
    Alert.alert('Dar de baja', `¿Dar de baja definitiva a ${perfil.nombre_completo}?`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Dar de baja', style: 'destructive', onPress: onBaja },
    ])
  }

  return (
    <View style={estilos.fila}>
      <Text style={estilos.filaNombre}>{perfil.nombre_completo}</Text>
      <Text style={estilos.filaSub}>
        {perfil.usuario ? `${perfil.usuario} · ` : ''}
        {perfil.email}
      </Text>

      <View style={estilos.filaMeta}>
        <Text style={estilos.metaRol}>{ETIQUETA_ROL[perfil.rol]}</Text>
        <Pastilla
          texto={ETIQUETA_ESTADO_USUARIO[perfil.estado]}
          color={colorEstado(perfil.estado, colores)}
        />
      </View>
      <Text style={estilos.filaTenue}>
        Última conexión:{' '}
        {ultima ? `${formatearFechaCorta(ultima)} · ${formatearHora(ultima)}` : 'Nunca'}
        {conexion?.de_donde ? ` · ${conexion.de_donde}` : ''}
      </Text>

      {/* Código de vendedor, editable en el lugar. */}
      <View style={estilos.editor}>
        <Campo
          etiqueta="CÓDIGO"
          contenedorStyle={estilos.editorCampo}
          value={codigoTexto}
          onChangeText={(t) => setCodigoTexto(t.replace(/\D/g, '').slice(0, 4))}
          keyboardType="number-pad"
          placeholder="—"
        />
        {cambioCodigo ? (
          <BotonSecundario
            titulo="Guardar"
            style={estilos.botonGuardar}
            cargando={guardandoCodigo}
            alTocar={() => onGuardarCodigo(codigoTexto)}
          />
        ) : null}
      </View>

      {/* Zonas a cargo, como en la planilla: "107, 121". */}
      <View style={estilos.editor}>
        <Campo
          etiqueta="ZONAS A CARGO"
          contenedorStyle={estilos.editorCampo}
          value={zonasTexto}
          onChangeText={setZonasTexto}
          placeholder="107, 121"
          keyboardType="numbers-and-punctuation"
        />
        {cambioZonas ? (
          <BotonSecundario
            titulo="Guardar"
            style={estilos.botonGuardar}
            cargando={guardandoZonas}
            alTocar={() => onGuardarZonas(zonas)}
          />
        ) : null}
      </View>

      {/* Acciones según el estado. Sacar de suspensión rota la contraseña
          (rehabilitar); reactivar una baja/rechazo NO. */}
      {perfil.estado === 'aprobado' ? (
        <BotonSecundario titulo="SUSPENDER" deshabilitado={procesandoEstado} alTocar={onSuspender} />
      ) : perfil.estado === 'suspendido' ? (
        <BotonPrincipal
          titulo="REACTIVAR"
          style={estilos.botonAncho}
          cargando={rehabilitando}
          alTocar={confirmarRehabilitar}
        />
      ) : (
        <BotonPrincipal
          titulo="REACTIVAR"
          style={estilos.botonAncho}
          cargando={procesandoEstado}
          alTocar={onReactivar}
        />
      )}
      <BotonSecundario
        titulo="DAR DE BAJA"
        style={estilos.botonPeligro}
        deshabilitado={perfil.estado === 'baja' || procesandoEstado}
        alTocar={confirmarBaja}
      />
    </View>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// 5 · Modal de alta
// ─────────────────────────────────────────────────────────────────────────────

interface PayloadAlta {
  nombre_completo: string
  usuario: string
  email: string
  telefono: string
  rol: RolUsuario
  codigo_vendedor: string
  zonas: string[]
  fotoUri?: string | null
}

function ModalAlta({
  visible,
  enviando,
  error,
  alCerrar,
  alEnviar,
}: {
  visible: boolean
  enviando: boolean
  error: string | null
  alCerrar: () => void
  alEnviar: (payload: PayloadAlta) => void
}) {
  const estilos = usarEstilos()
  const [nombre, setNombre] = useState('')
  const [usuario, setUsuario] = useState('')
  const [email, setEmail] = useState('')
  const [telefono, setTelefono] = useState('')
  const [rol, setRol] = useState<RolUsuario>('vendedor')
  const [codigo, setCodigo] = useState('')
  const [zonas, setZonas] = useState('')
  const [fotoUri, setFotoUri] = useState<string | null>(null)
  const [errorLocal, setErrorLocal] = useState<string | null>(null)

  const usuarioEfectivo = usuario.trim() || sugerirUsuario(nombre)
  const emailEfectivo = email.trim() || (usuarioEfectivo ? `${usuarioEfectivo}@woodtools.com.ar` : '')

  function limpiar() {
    setNombre('')
    setUsuario('')
    setEmail('')
    setTelefono('')
    setRol('vendedor')
    setCodigo('')
    setZonas('')
    setFotoUri(null)
    setErrorLocal(null)
  }

  function cerrar() {
    if (enviando) return
    limpiar()
    alCerrar()
  }

  async function sacarFoto() {
    const r = await sacarFotoConCamara()
    if (!r.ok) {
      Alert.alert('No se pudo usar la cámara', r.motivo)
      return
    }
    if (r.uris[0]) setFotoUri(r.uris[0])
  }
  async function elegirFoto() {
    const r = await elegirFotosDeGaleria(1)
    if (!r.ok) {
      Alert.alert('No se pudo abrir la galería', r.motivo)
      return
    }
    if (r.uris[0]) setFotoUri(r.uris[0])
  }

  function enviar() {
    setErrorLocal(null)
    if (!nombre.trim()) {
      setErrorLocal('Falta el nombre y apellido.')
      return
    }
    if (!/^[a-z0-9._-]{3,}$/.test(usuarioEfectivo)) {
      setErrorLocal('El nombre de usuario tiene que ser de al menos 3 letras, sin espacios ni acentos.')
      return
    }
    alEnviar({
      nombre_completo: nombre.trim(),
      usuario: usuarioEfectivo,
      email: emailEfectivo,
      telefono: telefono.trim(),
      rol,
      codigo_vendedor: codigo.trim(),
      zonas: zonas
        .split(/[,\s]+/)
        .map((z) => z.trim())
        .filter(Boolean),
      fotoUri,
    })
  }

  const avisoError = errorLocal ?? error

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={cerrar}>
      <Pantalla>
        <Panel contentStyle={estilos.contenido}>
          <BarraPanel alVolver={cerrar} />
          <TituloPanel>NUEVO USUARIO</TituloPanel>

          {avisoError ? (
            <Aviso tono="error" titulo="No se pudo crear">
              {avisoError}
            </Aviso>
          ) : null}

          <Campo
            etiqueta="NOMBRE Y APELLIDO"
            obligatorio
            value={nombre}
            onChangeText={setNombre}
            placeholder="Ana Sosa"
            autoCapitalize="words"
          />
          <Campo
            etiqueta="NOMBRE DE USUARIO"
            value={usuario}
            onChangeText={(t) => setUsuario(t.toLowerCase())}
            placeholder={sugerirUsuario(nombre) || 'asosa'}
            autoCapitalize="none"
            ayuda={`Con esto entra a la app. Vacío, usamos "${usuarioEfectivo || '—'}".`}
          />
          <Campo
            etiqueta="CORREO DE LA CUENTA"
            value={email}
            onChangeText={setEmail}
            placeholder={emailEfectivo || 'asosa@woodtools.com.ar'}
            keyboardType="email-address"
            autoCapitalize="none"
            ayuda={`También sirve para entrar. Vacío, se arma solo: "${emailEfectivo || '—'}".`}
          />
          <Campo
            etiqueta="TELÉFONO"
            value={telefono}
            onChangeText={setTelefono}
            keyboardType="phone-pad"
            placeholder="11 5555 5555"
          />
          <Desplegable<RolUsuario> etiqueta="ROL" valor={rol} items={ITEMS_ROL} alCambiar={setRol} />
          <Campo
            etiqueta="CÓDIGO DE VENDEDOR"
            value={codigo}
            onChangeText={(t) => setCodigo(t.replace(/\D/g, '').slice(0, 4))}
            keyboardType="number-pad"
            placeholder="7"
            ayuda="El que sale impreso en la nota de pedido y en el rol de visita."
          />
          <Campo
            etiqueta="ZONAS A CARGO"
            value={zonas}
            onChangeText={setZonas}
            placeholder="107, 121"
            keyboardType="numbers-and-punctuation"
            ayuda="Con esto la nota completa sola el número de vendedor cuando quien la carga no tiene uno."
          />

          {/* Foto opcional. */}
          <Text style={estilos.editorEtiqueta}>FOTO (OPCIONAL)</Text>
          {fotoUri ? (
            <View style={estilos.fotoFila}>
              <Image source={{ uri: fotoUri }} style={estilos.fotoPreview} contentFit="cover" />
              <BotonSecundario
                titulo="Quitar foto"
                style={estilos.fotoBoton}
                alTocar={() => setFotoUri(null)}
              />
            </View>
          ) : (
            <View style={estilos.fotoFila}>
              <BotonSecundario titulo="📷 Cámara" style={estilos.fotoBoton} alTocar={() => void sacarFoto()} />
              <BotonSecundario titulo="🖼️ Galería" style={estilos.fotoBoton} alTocar={() => void elegirFoto()} />
            </View>
          )}

          <BotonMenu titulo="CREAR USUARIO" cargando={enviando} alTocar={enviar} />
          <BotonSecundario titulo="Cancelar" deshabilitado={enviando} alTocar={cerrar} />
        </Panel>
      </Pantalla>
    </Modal>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** El color del relleno de la pastilla de estado. La letra la elige la pastilla. */
function colorEstado(estado: Perfil['estado'], colores: Paleta): string {
  switch (estado) {
    case 'aprobado':
      return colores.verde
    case 'pendiente':
      return colores.ambar
    case 'rechazado':
    case 'baja':
      return colores.rojoAccion
    default:
      return colores.tintaTenue
  }
}

/** El texto del estado de un pedido de contraseña ya resuelto. */
function textoPedidoResuelto(p: PedidoContrasena): string {
  if (p.estado === 'usada') return 'Ya la cambió'
  if (p.estado === 'habilitado') {
    const vencido = p.vence_en ? new Date(p.vence_en).getTime() < Date.now() : false
    return vencido ? 'Habilitado (vencido)' : 'Habilitado · esperando que la cambie'
  }
  return 'Cancelado'
}

/** Mismo criterio que el servidor: "Ana Sosa" → "asosa". */
function sugerirUsuario(nombre: string): string {
  const partes = nombre
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
  if (partes.length === 0) return ''
  if (partes.length === 1) return partes[0]
  return `${partes[0][0]}${partes[partes.length - 1]}`
}

const usarEstilos = hojaDeTema((t) => ({
  contenido: { gap: espaciado.md },

  ayuda: {
    fontFamily: t.tipografia.familia.cuerpo,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.tintaSuave,
  },

  seccionTitulo: {
    fontFamily: t.tipografia.familia.subtitulo,
    fontSize: t.tipografia.tamano.base,
    color: t.colores.tinta,
    letterSpacing: 0.6,
    marginTop: espaciado.sm,
  },
  seccionAyuda: {
    fontFamily: t.tipografia.familia.liviana,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.tintaSuave,
  },
  cargando: {
    fontFamily: t.tipografia.familia.cuerpo,
    fontSize: t.tipografia.tamano.sm,
    color: t.colores.tintaSuave,
  },
  vacioTexto: {
    fontFamily: t.tipografia.familia.liviana,
    fontSize: t.tipografia.tamano.sm,
    color: t.colores.tintaTenue,
    paddingVertical: espaciado.xs,
  },

  // ── Fila tipo tarjeta ──
  fila: {
    backgroundColor: t.colores.campoBlanco,
    borderWidth: 1.5,
    borderColor: t.colores.borde,
    borderRadius: radios.sm,
    padding: espaciado.md,
    gap: espaciado.sm,
  },
  filaNombre: {
    fontFamily: t.tipografia.familia.subtitulo,
    fontSize: t.tipografia.tamano.base,
    color: t.colores.tinta,
  },
  filaSub: {
    fontFamily: t.tipografia.familia.cuerpo,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.tintaSuave,
  },
  filaTenue: {
    fontFamily: t.tipografia.familia.liviana,
    fontSize: t.tipografia.tamano.micro,
    color: t.colores.tintaTenue,
  },
  filaMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: espaciado.sm,
  },
  metaRol: {
    fontFamily: t.tipografia.familia.fuerte,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.tinta,
  },

  codigoEquipo: {
    alignSelf: 'flex-start',
    backgroundColor: t.colores.panelClaro,
    borderWidth: 1.5,
    borderColor: t.colores.borde,
    borderRadius: radios.sm,
    paddingHorizontal: espaciado.sm,
    paddingVertical: 3,
  },
  mono: {
    fontFamily: t.tipografia.familia.subtitulo,
    fontSize: t.tipografia.tamano.base,
    color: t.colores.tinta,
    letterSpacing: 1.5,
  },
  monoGrande: {
    fontFamily: t.tipografia.familia.titulo,
    fontSize: t.tipografia.tamano.lg,
    color: t.colores.tinta,
    letterSpacing: 2,
  },

  // ── Editor código / zonas ──
  editor: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: espaciado.sm,
  },
  editorCampo: {
    flex: 1,
  },
  editorEtiqueta: {
    fontFamily: t.tipografia.familia.cuerpo,
    fontSize: t.tipografia.tamano.base,
    color: t.colores.tinta,
  },
  botonGuardar: {
    paddingHorizontal: espaciado.md,
  },

  // ── Botones de acción ──
  botonAncho: {
    minWidth: 0,
    alignSelf: 'stretch',
  },
  botonPeligro: {
    borderColor: t.colores.rojoAccion,
  },

  // ── Pedidos resueltos ──
  resueltos: {
    gap: espaciado.xs,
    marginTop: espaciado.xs,
  },
  filaResuelto: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: espaciado.sm,
    paddingVertical: espaciado.xs,
    paddingHorizontal: espaciado.sm,
    borderRadius: radios.sm,
    backgroundColor: t.colores.panelClaro,
  },
  resueltoUsuario: {
    fontFamily: t.tipografia.familia.fuerte,
    color: t.colores.tinta,
  },

  // ── Credencial provisoria ──
  credencial: {
    backgroundColor: t.colores.campoBlanco,
    borderWidth: 2.5,
    borderColor: t.colores.borde,
    borderRadius: radios.sm,
    padding: espaciado.base,
    gap: espaciado.sm,
  },
  credencialTitulo: {
    fontFamily: t.tipografia.familia.subtitulo,
    fontSize: t.tipografia.tamano.lg,
    color: t.colores.tinta,
  },
  credencialFila: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: espaciado.md,
  },
  credencialRotulo: {
    fontFamily: t.tipografia.familia.cuerpo,
    fontSize: t.tipografia.tamano.sm,
    color: t.colores.tintaSuave,
  },

  // ── Foto ──
  fotoFila: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaciado.sm,
  },
  fotoBoton: {
    flex: 1,
  },
  fotoPreview: {
    width: 64,
    height: 64,
    borderRadius: radios.sm,
    borderWidth: 2,
    borderColor: t.colores.borde,
    backgroundColor: t.colores.panelOscuro,
  },

  // ── Modal de rechazo ──
  velo: {
    flex: 1,
    backgroundColor: t.colores.velo,
    justifyContent: 'flex-end',
  },
  hoja: {
    backgroundColor: t.colores.panelClaro,
    borderTopWidth: 3,
    borderColor: t.colores.borde,
    borderTopLeftRadius: radios.lg,
    borderTopRightRadius: radios.lg,
    padding: espaciado.base,
    gap: espaciado.sm,
  },
  hojaTitulo: {
    fontFamily: t.tipografia.familia.subtitulo,
    fontSize: t.tipografia.tamano.lg,
    color: t.colores.tinta,
  },
}))
