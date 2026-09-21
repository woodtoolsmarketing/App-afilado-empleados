import type { Cliente, Direccion, Perfil, RolUsuario } from '@woodtools/compartido'
import * as FileSystem from 'expo-file-system'

import { supabase } from '../nucleo/supabase'

/**
 * Las funciones del panel de la oficina, para el teléfono de un administrador.
 *
 * Es la misma gestión que hace el panel de escritorio —altas de usuarios,
 * habilitación de teléfonos, ABM de la cartera de clientes, auditoría de
 * cambios— pero llamada desde la app. No hace falta nada nuevo del lado del
 * servidor: las RLS, las RPC y las edge functions ya gatean por `perfiles.rol`,
 * así que un admin logueado en el teléfono pasa los mismos controles que en la
 * PC. Lo único que cambia es quién hace la llamada.
 *
 * Toda esta capa se muestra únicamente a las cuentas rol `admin` (ver el menú
 * lateral). Un vendedor no llega acá, y si llegara, la base lo frenaría igual.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Usuarios y teléfonos
// ─────────────────────────────────────────────────────────────────────────────

/** Una conexión reciente, de la vista que junta las cuatro señales de actividad. */
export interface UltimaConexion {
  perfil_id: string
  ultima_conexion: string | null
  de_donde: string | null
  cuantos_aparatos: number | null
}

/** Un teléfono registrado, con quién es su dueño. */
export interface DispositivoConDueno {
  id: string
  instalacion_id: string
  autorizado: boolean
  fabricante: string | null
  modelo: string | null
  version_so: string | null
  version_app: string | null
  perfiles: { nombre_completo: string; codigo_vendedor: string | null } | null
}

/** Un pedido de restablecer contraseña, tal como lo ve la oficina. */
export interface PedidoContrasena {
  id: string
  usuario: string
  estado: 'pendiente' | 'habilitado' | 'usada' | 'cancelada'
  origen: string
  dispositivo_desc: string | null
  habilitado_en: string | null
  vence_en: string | null
  usada_en: string | null
  creado_en: string
}

/** Lo que devuelve crear/rehabilitar: la contraseña provisoria se ve UNA vez. */
export interface CredencialProvisoria {
  usuario: string
  email?: string
  contrasena_provisoria: string
}

/** Cuánto vale la habilitación de un reset antes de vencer. */
export const MINUTOS_HABILITADO = 30

/** Todos los usuarios, con las altas pendientes primero. */
export async function listarPerfiles(): Promise<Perfil[]> {
  const { data, error } = await supabase
    .from('perfiles')
    .select('*')
    .order('estado', { ascending: true })
    .order('creado_en', { ascending: false })
  if (error) throw error
  return (data ?? []) as Perfil[]
}

/**
 * La última conexión de cada uno.
 *
 * `perfiles.ultimo_acceso_en` sola no sirve: se escribe sólo al tipear la
 * contraseña, y la sesión no vence. La vista toma el máximo de las cuatro
 * señales que ya se guardan.
 */
export async function ultimasConexiones(): Promise<UltimaConexion[]> {
  const { data, error } = await supabase
    .from('vista_ultima_conexion')
    .select('perfil_id, ultima_conexion, de_donde, cuantos_aparatos')
  if (error) throw error
  return (data ?? []) as UltimaConexion[]
}

export async function listarDispositivos(): Promise<DispositivoConDueno[]> {
  const { data, error } = await supabase
    .from('dispositivos')
    // El nombre de la clave foránea va explícito: `dispositivos` apunta dos
    // veces a `perfiles` —de quién es y quién lo habilitó—, y sin decir por cuál
    // camino ir, PostgREST rechaza la consulta entera.
    .select('*, perfiles!dispositivos_perfil_id_fkey ( nombre_completo, codigo_vendedor )')
    .order('creado_en', { ascending: false })
  if (error) throw error
  return (data ?? []) as unknown as DispositivoConDueno[]
}

/** Aprueba o rechaza un alta. Con `aprobar` pide rol y código; con rechazo, motivo. */
export async function resolverAlta(params: {
  perfilId: string
  aprobar: boolean
  rol?: RolUsuario
  codigo?: string | null
  motivo?: string | null
}): Promise<void> {
  const { error } = await supabase.rpc('resolver_alta_usuario', {
    p_perfil_id: params.perfilId,
    p_aprobar: params.aprobar,
    p_rol: params.rol ?? 'vendedor',
    p_codigo: params.codigo ?? null,
    p_motivo: params.motivo ?? null,
  })
  if (error) throw error
}

/** Suspender, dar de baja o reactivar (una baja/rechazo) es un UPDATE del estado. */
export async function cambiarEstadoUsuario(perfilId: string, estado: Perfil['estado']): Promise<void> {
  const { error } = await supabase.from('perfiles').update({ estado }).eq('id', perfilId)
  if (error) throw error
}

/**
 * Sacar a alguien de la suspensión REINICIÁNDOLE la contraseña.
 *
 * A diferencia de reactivar una baja/rechazo (UPDATE de estado), acá se le rota
 * la clave a una provisoria nueva y se lo obliga a cambiarla al entrar. Rotar la
 * clave de otro es cosa de administrador de Auth, así que va por la edge
 * function `rehabilitar-usuario` (service_role del lado servidor).
 */
export async function rehabilitarUsuario(perfilId: string): Promise<CredencialProvisoria> {
  const { data, error } = await supabase.functions.invoke('rehabilitar-usuario', {
    body: { perfil_id: perfilId },
  })
  if (error) throw new Error(await mensajeDeErrorDeFuncion(error))
  return data as CredencialProvisoria
}

export async function guardarZonasVendedor(perfilId: string, zonas: string[]): Promise<void> {
  const { error } = await supabase.from('perfiles').update({ zonas }).eq('id', perfilId)
  if (error) throw error
}

export async function guardarCodigoVendedor(perfilId: string, codigo: string): Promise<void> {
  const limpio = codigo.trim()
  const { error } = await supabase
    .from('perfiles')
    .update({ codigo_vendedor: limpio === '' ? null : limpio })
    .eq('id', perfilId)
  if (error) throw error
}

export async function autorizarDispositivo(id: string, autorizado: boolean): Promise<void> {
  const { error } = await supabase
    .from('dispositivos')
    .update({ autorizado, autorizado_en: autorizado ? new Date().toISOString() : null })
    .eq('id', id)
  if (error) throw error
}

/**
 * Elimina el registro de un teléfono. No borra al vendedor: si el equipo sigue
 * instalado, se re-registra como "sin autorizar" al reabrir la app. Sirve para
 * descartar registros de más o equipos reemplazados. La RLS `dispositivos_admin`
 * ya lo permite al admin.
 */
export async function eliminarDispositivo(id: string): Promise<void> {
  const { error } = await supabase.from('dispositivos').delete().eq('id', id)
  if (error) throw error
}

export async function listarPedidosContrasena(): Promise<PedidoContrasena[]> {
  const { data, error } = await supabase
    .from('pedidos_contrasena')
    .select('*')
    .in('estado', ['pendiente', 'habilitado', 'usada'])
    .order('creado_en', { ascending: false })
    .limit(30)
  if (error) throw error
  return (data ?? []) as PedidoContrasena[]
}

/**
 * Habilita un pedido de reset: el vendedor tiene MINUTOS_HABILITADO para elegir
 * su contraseña nueva desde la app. Nadie dicta una provisoria. Sólo se toca lo
 * que sigue `pendiente`, para no pisar lo que otro ya resolvió.
 */
export async function habilitarPedidoContrasena(id: string): Promise<void> {
  const { data: yo } = await supabase.auth.getUser()
  const ahora = Date.now()
  const { error } = await supabase
    .from('pedidos_contrasena')
    .update({
      estado: 'habilitado',
      habilitado_por: yo.user?.id ?? null,
      habilitado_en: new Date(ahora).toISOString(),
      vence_en: new Date(ahora + MINUTOS_HABILITADO * 60_000).toISOString(),
    })
    .eq('id', id)
    .eq('estado', 'pendiente')
  if (error) throw error
}

/** El bucket privado donde vive la foto del vendedor. Sólo el admin escribe. */
const BUCKET_FOTOS = 'fotos-vendedores'

/** 2 MB. Es la foto de un carnet, no una galería. */
const PESO_MAXIMO_FOTO = 2 * 1024 * 1024

/**
 * Crea un empleado.
 *
 * La cuenta la crea el servidor (edge function `crear-usuario`, service_role) y
 * devuelve una contraseña provisoria que se muestra UNA vez. La foto es opcional
 * y va al bucket privado ANTES de crear la cuenta: si la subida falla, no queda
 * un usuario a medio dar de alta. Es el mismo criterio que el alta del panel.
 */
export async function crearUsuario(params: {
  nombre_completo: string
  usuario: string
  email: string
  telefono: string
  rol: RolUsuario
  codigo_vendedor: string
  zonas: string[]
  /** URI local de la foto elegida (cámara o galería). Opcional. */
  fotoUri?: string | null
  dominio?: string
}): Promise<CredencialProvisoria> {
  const foto_url = params.fotoUri ? await subirFotoVendedor(params.usuario, params.fotoUri) : null

  const { data, error } = await supabase.functions.invoke('crear-usuario', {
    body: {
      nombre_completo: params.nombre_completo,
      usuario: params.usuario,
      email: params.email,
      telefono: params.telefono,
      rol: params.rol,
      codigo_vendedor: params.codigo_vendedor,
      zonas: params.zonas,
      foto_url,
      dominio: params.dominio ?? 'woodtools.com.ar',
    },
  })
  if (error) throw new Error(await mensajeDeErrorDeFuncion(error))
  return data as CredencialProvisoria
}

async function subirFotoVendedor(usuario: string, fotoUri: string): Promise<string> {
  const info = await FileSystem.getInfoAsync(fotoUri, { size: true })
  if (info.exists && typeof info.size === 'number' && info.size > PESO_MAXIMO_FOTO) {
    throw new Error('La foto pesa más de 2 MB. Probá con una más chica.')
  }
  const base64 = await FileSystem.readAsStringAsync(fotoUri, {
    encoding: FileSystem.EncodingType.Base64,
  })
  const ext = extensionDe(fotoUri, 'jpg')
  const ruta = `${usuario}-${Date.now()}.${ext}`
  const { error } = await supabase.storage
    .from(BUCKET_FOTOS)
    .upload(ruta, base64ABytes(base64), { contentType: tipoDeFoto(ext), upsert: false })
  if (error) throw new Error(`No pudimos subir la foto: ${error.message}`)
  return ruta
}

// ─────────────────────────────────────────────────────────────────────────────
// Clientes (ABM de la cartera)
// ─────────────────────────────────────────────────────────────────────────────

/** Cuántas filas se traen por consulta. El resto se alcanza buscando. */
const VENTANA_CLIENTES = 200

export type ClienteConDirecciones = Cliente & { direcciones: Direccion[] }

/** El total de la cartera, para el encabezado. */
export async function contarClientes(): Promise<number> {
  const { count, error } = await supabase.from('clientes').select('id', { count: 'exact', head: true })
  if (error) throw error
  return count ?? 0
}

/**
 * Busca en toda la cartera, con las direcciones anidadas.
 *
 * No usa la RPC `buscar_clientes` del vendedor: ésa tiene `where c.activo`
 * clavado adentro y no devuelve las direcciones, y esta pantalla justamente da
 * de baja y de alta —el cliente recién desactivado tiene que seguir apareciendo
 * para poder reactivarlo—. En cambio se copia su criterio contra
 * `clientes.busqueda_plana`: sin acentos, sin puntuación y en cualquier orden.
 */
export async function buscarClientesCartera(termino: string): Promise<ClienteConDirecciones[]> {
  let consulta = supabase
    .from('clientes')
    .select('*, direcciones ( * )')
    .order('razon_social')
    .limit(VENTANA_CLIENTES)

  for (const palabra of palabrasDeBusqueda(termino)) {
    // La palabra ya viene sin comas ni comillas —las borró la normalización—,
    // así que no puede partir el `or` de PostgREST ni colarse como comodín.
    consulta = consulta.or(
      [`busqueda_plana.ilike.%${palabra}%`, `cuit.ilike.%${palabra}%`, `localidad.ilike.%${palabra}%`].join(','),
    )
  }

  const { data, error } = await consulta
  if (error) throw error
  return (data ?? []) as ClienteConDirecciones[]
}

/** Los cargados desde la calle, que esperan código definitivo y ficha completa. */
export async function clientesProvisorios(): Promise<ClienteConDirecciones[]> {
  const { data, error } = await supabase
    .from('clientes')
    .select('*, direcciones ( * )')
    .eq('provisorio', true)
    .eq('activo', true)
    .order('razon_social')
    .limit(50)
  if (error) throw error
  return (data ?? []) as ClienteConDirecciones[]
}

/** Los vendedores a los que se le puede asignar la cartera. */
export async function vendedoresAsignables(): Promise<
  Pick<Perfil, 'id' | 'nombre_completo' | 'codigo_vendedor'>[]
> {
  const { data, error } = await supabase
    .from('perfiles')
    .select('id, nombre_completo, codigo_vendedor')
    .eq('rol', 'vendedor')
    .eq('estado', 'aprobado')
    .order('nombre_completo')
  if (error) throw error
  return (data ?? []) as Pick<Perfil, 'id' | 'nombre_completo' | 'codigo_vendedor'>[]
}

export async function alternarActivoCliente(cliente: Pick<Cliente, 'id' | 'activo'>): Promise<void> {
  const { error } = await supabase.from('clientes').update({ activo: !cliente.activo }).eq('id', cliente.id)
  if (error) throw error
}

/** Los campos de la ficha del cliente que edita el panel. */
export interface DatosCliente {
  codigo: string
  razon_social: string
  nombre_fantasia: string | null
  cuit: string | null
  telefono: string | null
  email: string | null
  contacto_nombre: string | null
  vendedor_id: string | null
  notas: string | null
  provisorio: boolean
}

/** La dirección principal, cuando se carga o corrige. */
export interface DatosDireccionPrincipal {
  direccion_formateada: string
  codigo_postal: string | null
  lat: number
  lng: number
}

/**
 * Crea o edita un cliente y, si se cargó, su dirección principal.
 *
 * Es la misma transacción en dos pasos que el panel: primero la ficha, y con el
 * id resultante, la dirección. `clienteId` en null crea; con id, edita.
 * `direccionPrincipalId` en null inserta la dirección; con id, la actualiza.
 */
export async function guardarCliente(params: {
  clienteId: string | null
  datos: DatosCliente
  direccion?: DatosDireccionPrincipal | null
  direccionPrincipalId?: string | null
}): Promise<void> {
  const { data: guardado, error: errCliente } = params.clienteId
    ? await supabase.from('clientes').update(params.datos).eq('id', params.clienteId).select('id').single()
    : await supabase.from('clientes').insert(params.datos).select('id').single()
  if (errCliente) throw errCliente

  if (params.direccion) {
    const datosDireccion = {
      cliente_id: guardado.id,
      direccion_formateada: params.direccion.direccion_formateada,
      codigo_postal: params.direccion.codigo_postal,
      lat: params.direccion.lat,
      lng: params.direccion.lng,
      principal: true,
      etiqueta: 'Principal',
    }
    const { error: errDireccion } = params.direccionPrincipalId
      ? await supabase.from('direcciones').update(datosDireccion).eq('id', params.direccionPrincipalId)
      : await supabase.from('direcciones').insert(datosDireccion)
    if (errDireccion) throw errDireccion
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Modificaciones de clientes (auditoría, sólo lectura)
// ─────────────────────────────────────────────────────────────────────────────

/** Un cambio a la ficha de un cliente: qué campo, de qué a qué, quién y cuándo. */
export interface FilaModificacion {
  id: string
  modificado_en: string
  campo: string
  valor_anterior: string | null
  valor_nuevo: string | null
  cliente_codigo: string | null
  cliente: { codigo: string; razon_social: string } | null
  autor: { nombre_completo: string; codigo_vendedor: string | null } | null
}

/**
 * El historial de cambios de fichas entre dos fechas (ISO `YYYY-MM-DD`).
 *
 * `hasta` es inclusive: se filtra hasta el día siguiente, exclusivo. Las filas
 * las escribe un trigger, así que caen tanto los cambios del mapa del celular
 * como los del panel. Sólo admin/supervisor pueden leerlas (RLS).
 */
export async function modificacionesEntre(desde: string, hasta: string): Promise<FilaModificacion[]> {
  // Los límites van como instantes locales, no como fechas peladas.
  //
  // `modificado_en` es timestamptz y el servidor corre en UTC: mandar
  // '2026-09-01' hace que Postgres lo lea como medianoche UTC, que en Argentina
  // (UTC-3) son las 21:00 del día anterior. Con eso, la ventana quedaba corrida
  // tres horas: se colaban los cambios de la víspera después de las 21:00 y se
  // perdían los del último día pasadas las 21:00 —justo el cierre de mes que
  // esta pantalla existe para controlar—. Un ISO con la hora local puesta
  // (`...T00:00:00`, sin `Z`) se interpreta en la zona del teléfono, y
  // `toISOString()` lo pasa al instante UTC correcto.
  const desdeInstante = new Date(`${desde}T00:00:00`).toISOString()
  const siguiente = new Date(`${hasta}T00:00:00`)
  siguiente.setDate(siguiente.getDate() + 1)
  const hastaInstante = siguiente.toISOString()

  const { data, error } = await supabase
    .from('clientes_modificaciones')
    .select(
      'id, modificado_en, campo, valor_anterior, valor_nuevo, cliente_codigo, cliente:clientes ( codigo, razon_social ), autor:perfiles ( nombre_completo, codigo_vendedor )',
    )
    .gte('modificado_en', desdeInstante)
    .lt('modificado_en', hastaInstante)
    .order('modificado_en', { ascending: false })
    .limit(5000)
  if (error) throw error
  return (data ?? []) as unknown as FilaModificacion[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Primer día del mes / hoy, en `YYYY-MM-DD` local. */
export function comoISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * El mensaje de error real de una edge function.
 *
 * La capa de funciones dice siempre lo mismo; el motivo va en el cuerpo de la
 * respuesta. Mismo patrón que el panel.
 */
async function mensajeDeErrorDeFuncion(err: unknown): Promise<string> {
  const base = err instanceof Error ? err.message : 'No pudimos completar la operación.'
  try {
    const cuerpo = await (err as { context?: Response }).context?.json()
    if (cuerpo?.error) return cuerpo.error as string
  } catch {
    // Se queda con el genérico.
  }
  return base
}

/**
 * Deja el texto como está guardado en `clientes.busqueda_plana`: minúsculas, sin
 * acentos, sin puntuación. Tiene que dar lo mismo que `interno.normalizar_busqueda`.
 */
function normalizarBusqueda(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Las palabras que hay que exigir, todas, en cualquier orden. */
function palabrasDeBusqueda(texto: string): string[] {
  return normalizarBusqueda(texto).split(' ').filter(Boolean)
}

/** Base64 → bytes. `supabase-js` sube bien un Uint8Array; un Blob en RN sube 0 bytes. */
function base64ABytes(base64: string): Uint8Array {
  const binario = atob(base64)
  const bytes = new Uint8Array(binario.length)
  for (let i = 0; i < binario.length; i += 1) bytes[i] = binario.charCodeAt(i)
  return bytes
}

function extensionDe(uri: string, porDefecto: string): string {
  const limpio = uri.split('?')[0]
  const punto = limpio.lastIndexOf('.')
  const ext = punto >= 0 ? limpio.slice(punto + 1).toLowerCase() : ''
  return /^[a-z0-9]{1,5}$/.test(ext) ? ext : porDefecto
}

function tipoDeFoto(ext: string): string {
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  if (ext === 'png') return 'image/png'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'heic' || ext === 'heif') return 'image/heic'
  return 'application/octet-stream'
}
