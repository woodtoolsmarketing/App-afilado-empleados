/**
 * Capa de datos del probador.
 *
 * Cada función de acá es la contraparte de una de `apps/movil/src/servicios/`.
 * Se llaman las MISMAS tablas, las mismas RPC y las mismas Edge Functions: si
 * el probador anda y la app no, el problema está en la app; si el probador no
 * anda, el problema está en el backend. Ése es todo el punto de esta pieza.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  agruparParaNotas,
  agujeroDelRenglon,
  aNumero,
  avisoDeNotasHermanas,
  avisosDeAgujero,
  CONDICIONES_CON_DETALLE,
  FAMILIA_CATALOGO,
  MEDIDA_PARA_CODIGO,
  reconocerHerramienta,
  totalDelRenglon,
  type CondicionVenta,
  type FormularioItemNota,
  type FormularioNotaEncabezado,
  type GrupoNota,
  type Herramienta,
  type TipoNotaPedido,
  type TipoServicio,
} from '@woodtools/compartido'

declare const CONFIG: {
  url: string
  anonKey: string
  dominioUsuario: string
  /** Lo fija el build y no cambia entre reconstrucciones. Ver construir.mjs. */
  instalacionId: string
}

export const supabase: SupabaseClient = createClient(CONFIG.url, CONFIG.anonKey, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'woodtools.probador' },
})

export const DOMINIO_USUARIO = CONFIG.dominioUsuario

/** Igual que `normalizarUsuario` de la app: "asosa" → "asosa@woodtools.com.ar". */
export function normalizarUsuario(usuario: string): string {
  const limpio = usuario.trim().toLowerCase()
  return limpio.includes('@') ? limpio : `${limpio}@${DOMINIO_USUARIO}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Dispositivo
//
// El navegador es un dispositivo más y pasa por el mismo candado que el
// teléfono: se registra sin autorizar y un admin lo habilita desde el panel.
// Eso hace que el probador sirva justamente para probar ese circuito.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * El ID lo fija el build, no el navegador.
 *
 * Antes se generaba al azar y se guardaba en `localStorage`. Desde un `file://`
 * eso se pierde solo, y cada pérdida creaba un dispositivo nuevo que había que
 * volver a autorizar: se autorizaba una PC que dejaba de existir al rato.
 */
export function instalacionId(): string {
  return CONFIG.instalacionId
}

export interface EstadoAutorizacion {
  autorizado: boolean
  recienRegistrado: boolean
  instalacion_id: string
}

export async function registrarYVerificarDispositivo(perfilId: string): Promise<EstadoAutorizacion> {
  const id = instalacionId()
  const datos = {
    instalacion_id: id,
    fabricante: 'Navegador',
    modelo: `Probador · ${navigator.platform || 'PC'}`,
    version_so: navigator.userAgent.slice(0, 80),
    version_app: 'probador',
  }

  const { data: existente } = await supabase
    .from('dispositivos')
    .select('id, autorizado')
    .eq('perfil_id', perfilId)
    .eq('instalacion_id', id)
    .maybeSingle()

  if (existente) {
    await supabase
      .from('dispositivos')
      .update({ ultimo_visto_en: new Date().toISOString() })
      .eq('id', existente.id)
    return { autorizado: existente.autorizado, recienRegistrado: false, instalacion_id: id }
  }

  await supabase
    .from('dispositivos')
    .insert({ perfil_id: perfilId, ...datos, autorizado: false, ultimo_visto_en: new Date().toISOString() })

  return { autorizado: false, recienRegistrado: true, instalacion_id: id }
}

// ─────────────────────────────────────────────────────────────────────────────
// Diagnóstico del backend
//
// Lo primero que hace falta saber al conectarse: qué está puesto y qué no.
// Sin esto, un "no aparece nada" puede ser la migración sin aplicar, el hook
// sin activar o simplemente que no hay datos, y no hay forma de distinguirlos.
// ─────────────────────────────────────────────────────────────────────────────

export interface Chequeo {
  clave: string
  titulo: string
  estado: 'ok' | 'falta' | 'error' | 'aviso'
  detalle: string
}

/**
 * RLS negando el acceso NO es una falla: es el backend haciendo su trabajo.
 * Sin sesión, la mitad de estos chequeos no puede leer nada, y reportarlos en
 * rojo mandaría a buscar un problema que no existe.
 */
function esFaltaDeSesion(error: unknown): boolean {
  const e = error as { message?: string; code?: string } | null
  // 42501 es "insufficient_privilege" de Postgres: RLS negando, no una falla.
  if (e?.code === '42501' || e?.code === 'PGRST301') return true
  const m = (e?.message ?? String(error)).toLowerCase()
  return (
    m.includes('permission denied') ||
    m.includes('jwt') ||
    m.includes('row-level security') ||
    m.includes('not authorized')
  )
}

/** Un PostgrestError puede traer el mensaje vacío y todo el detalle en otros campos. */
function describirError(error: unknown): string {
  const e = error as { message?: string; details?: string; hint?: string; code?: string } | null
  const texto = [e?.message, e?.details, e?.hint].filter(Boolean).join(' · ')
  if (texto) return texto
  if (e?.code) return `Código ${e.code}`
  // Una consulta `head: true` que falla vuelve con el objeto vacío: el estado
  // HTTP se pierde por el camino y `String(error)` da "[object Object]".
  try {
    const json = JSON.stringify(error)
    return json && json !== '{}' ? json : 'El servidor rechazó la consulta y no devolvió detalle.'
  } catch {
    return 'El servidor rechazó la consulta y no devolvió detalle.'
  }
}

async function chequear(
  clave: string,
  titulo: string,
  fn: () => Promise<Chequeo>,
): Promise<Chequeo> {
  try {
    return await fn()
  } catch (e) {
    return esFaltaDeSesion(e)
      ? { clave, titulo, estado: 'aviso', detalle: 'No se puede ver sin iniciar sesión.' }
      : { clave, titulo, estado: 'error', detalle: describirError(e) }
  }
}

export async function haySesion(): Promise<boolean> {
  const { data } = await supabase.auth.getSession()
  return !!data.session
}

export interface ConfigImpresora {
  ip: string
  puerto: number
  ruta: string
}

/**
 * Los tres desenlaces se distinguen a propósito. Una lectura negada por RLS
 * devuelve `data: null`, igual que una fila sin IP: tratarlas como lo mismo
 * hacía que el diagnóstico dijera "sin IP cargada" con la IP cargada.
 */
export type LecturaImpresora =
  | { estado: 'ok'; cfg: ConfigImpresora }
  | { estado: 'sin_ip' }
  | { estado: 'sin_permiso' }
  | { estado: 'error'; detalle: string }

/** La misma fila que lee `obtenerImpresora()` de la app. */
export async function configuracionImpresora(): Promise<LecturaImpresora> {
  const { data, error } = await supabase
    .from('configuracion')
    .select('valor')
    .eq('clave', 'impresora_oficina')
    .maybeSingle()

  if (error) {
    return esFaltaDeSesion(error)
      ? { estado: 'sin_permiso' }
      : { estado: 'error', detalle: describirError(error) }
  }
  // Sin sesión, RLS filtra la fila en vez de dar error: no hay fila, no hay permiso.
  if (!data) return { estado: 'sin_permiso' }

  const cfg = data.valor as { ip?: string; puerto?: number; ruta?: string } | null
  if (!cfg?.ip) return { estado: 'sin_ip' }
  return { estado: 'ok', cfg: { ip: cfg.ip, puerto: cfg.puerto ?? 631, ruta: cfg.ruta ?? '/ipp/print' } }
}

/**
 * ¿Contesta algo en esa IP y ese puerto?
 *
 * Con `no-cors` no se puede leer la respuesta —la impresora no manda cabeceras
 * CORS— pero sí se distingue "contestó algo" de "no hay nadie": lo primero
 * resuelve, lo segundo tira error de red. Alcanza para saber si la IP está bien
 * cargada, que es lo único que este chequeo promete.
 */
export async function alcanzaImpresora(cfg: ConfigImpresora): Promise<boolean> {
  const control = new AbortController()
  const reloj = setTimeout(() => control.abort(), 3000)
  try {
    await fetch(`http://${cfg.ip}:${cfg.puerto}${cfg.ruta}`, {
      method: 'HEAD',
      mode: 'no-cors',
      signal: control.signal,
    })
    return true
  } catch {
    return false
  } finally {
    clearTimeout(reloj)
  }
}

export async function diagnosticar(): Promise<Chequeo[]> {
  const pruebas: Array<Promise<Chequeo>> = [
    chequear('conexion', 'Conexión con Supabase', async () => {
      const { error } = await supabase.from('configuracion').select('clave').limit(1)
      // Que Postgres conteste "permission denied" prueba que llegamos: hubo ida
      // y vuelta, y del otro lado había una base con RLS puesto.
      const llego = !error || esFaltaDeSesion(error)
      return {
        clave: 'conexion',
        titulo: 'Conexión con Supabase',
        estado: llego ? 'ok' : 'error',
        detalle: llego ? CONFIG.url : describirError(error),
      }
    }),

    chequear('catalogo', 'Catálogo de precios', async () => {
      const { count, error } = await supabase
        .from('catalogo_articulos')
        .select('codigo', { count: 'exact', head: true })
      if (error) throw error
      const n = count ?? 0
      return {
        clave: 'catalogo',
        titulo: 'Catálogo de precios',
        estado: n > 0 ? 'ok' : 'falta',
        detalle:
          n > 0
            ? `${n} artículos cargados`
            : 'Vacío. Falta correr `npx supabase db push` para cargar los 1.315 códigos.',
      }
    }),

    chequear('impresora', 'Impresora de la oficina', async () => {
      const lectura = await configuracionImpresora()
      const base = { clave: 'impresora', titulo: 'Impresora de la oficina' } as const
      switch (lectura.estado) {
        case 'ok':
          return { ...base, estado: 'ok', detalle: `${lectura.cfg.ip}:${lectura.cfg.puerto}${lectura.cfg.ruta}` }
        case 'sin_ip':
          return { ...base, estado: 'falta', detalle: 'Sin IP cargada. La app va a caer al diálogo del sistema.' }
        case 'sin_permiso':
          return { ...base, estado: 'aviso', detalle: 'No se puede ver sin iniciar sesión.' }
        default:
          return { ...base, estado: 'error', detalle: lectura.detalle }
      }
    }),

    chequear('alcance', '¿Se alcanza la impresora?', async () => {
      const base = { clave: 'alcance', titulo: '¿Se alcanza la impresora?' } as const
      const lectura = await configuracionImpresora()
      if (lectura.estado !== 'ok') {
        return {
          ...base,
          estado: 'aviso',
          detalle:
            lectura.estado === 'sin_permiso'
              ? 'Hay que iniciar sesión para leer la IP y poder probarla.'
              : 'No hay IP cargada para probar.',
        }
      }
      const { cfg } = lectura
      const alcanzada = await alcanzaImpresora(cfg)
      return {
        ...base,
        estado: alcanzada ? 'ok' : 'aviso',
        detalle: alcanzada
          ? `Algo contesta en ${cfg.ip}:${cfg.puerto} desde esta PC.`
          : `Sin respuesta de ${cfg.ip}:${cfg.puerto}. Puede ser la impresora apagada, ` +
            'estar en otra red, o el navegador bloqueando el acceso a la red local desde un ' +
            'archivo abierto con doble clic. El teléfono no tiene esa última restricción.',
      }
    }),

    chequear('cotizacion', 'Cotización del dólar', async () => {
      // Las Edge Functions autentican primero: sin sesión no hay nada que probar.
      if (!(await haySesion())) {
        return {
          clave: 'cotizacion',
          titulo: 'Cotización del dólar',
          estado: 'aviso',
          detalle: 'No se puede probar sin iniciar sesión.',
        }
      }
      const { data, error } = await supabase.functions.invoke('cotizacion-dolar', { body: {} })
      if (error) throw error
      const c = data as { venta?: number; fecha?: string }
      return {
        clave: 'cotizacion',
        titulo: 'Cotización del dólar',
        estado: c?.venta ? 'ok' : 'falta',
        detalle: c?.venta ? `$ ${c.venta} · ${c.fecha}` : 'La Edge Function no devolvió cotización.',
      }
    }),

    chequear('usuarios', 'Usuarios habilitados', async () => {
      // `perfiles` está detrás de RLS: sin sesión no hay nada que contar, y el
      // error que devuelve una consulta `head` viene sin mensaje.
      if (!(await haySesion())) {
        return {
          clave: 'usuarios',
          titulo: 'Usuarios habilitados',
          estado: 'aviso',
          detalle: 'No se puede ver sin iniciar sesión.',
        }
      }
      const { count, error } = await supabase
        .from('perfiles')
        .select('id', { count: 'exact', head: true })
        .eq('estado', 'aprobado')
      if (error) throw error
      const n = count ?? 0
      return {
        clave: 'usuarios',
        titulo: 'Usuarios habilitados',
        estado: n > 0 ? 'ok' : 'falta',
        detalle: n > 0 ? `${n} con el alta aprobada` : 'Ninguno. Hay que crear el primer administrador.',
      }
    }),
  ]

  return Promise.all(pruebas)
}

// ─────────────────────────────────────────────────────────────────────────────
// Perfil y jornada
// ─────────────────────────────────────────────────────────────────────────────

export async function obtenerPerfil(usuarioId: string) {
  const { data, error } = await supabase.from('perfiles').select('*').eq('id', usuarioId).maybeSingle()
  if (error) throw error
  return data as Record<string, any> | null
}

function hoyISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export interface JornadaCompleta {
  jornada: Record<string, any>
  paradas: Array<Record<string, any>>
}

export async function jornadaDeHoy(vendedorId: string): Promise<JornadaCompleta | null> {
  const { data: jornada } = await supabase
    .from('roles_visita')
    .select('*')
    .eq('vendedor_id', vendedorId)
    .eq('fecha', hoyISO())
    .maybeSingle()

  if (!jornada) return null

  const { data: paradas } = await supabase
    .from('paradas')
    .select(
      `*, cliente:clientes ( id, codigo, razon_social, contacto_nombre, telefono ),
       direccion:direcciones ( * ), visita:visitas ( * )`,
    )
    .eq('rol_visita_id', (jornada as Record<string, any>).id)
    .order('orden', { ascending: true })

  return {
    jornada: jornada as Record<string, any>,
    paradas: (paradas ?? []).map((p: Record<string, any>) => ({
      ...p,
      visita: Array.isArray(p.visita) ? (p.visita[0] ?? null) : p.visita,
    })),
  }
}

export async function historialVisitas(desde: string, hasta: string) {
  const { data, error } = await supabase.rpc('historial_visitas', { p_desde: desde, p_hasta: hasta })
  if (error) throw error
  return (data ?? []) as Array<Record<string, any>>
}

// ─────────────────────────────────────────────────────────────────────────────
// Notas de pedido — mismas llamadas que apps/movil/src/servicios/notasPedido.ts
// ─────────────────────────────────────────────────────────────────────────────

export async function obtenerCotizacion(fecha?: string) {
  const { data, error } = await supabase.functions.invoke('cotizacion-dolar', {
    body: fecha ? { fecha } : {},
  })
  if (error) throw new Error('No pudimos obtener la cotización del dólar.')
  return data as { fecha: string; venta: number; aproximada?: boolean }
}

export interface ArticuloCatalogo {
  codigo: string
  descripcion: string
  medida: string | null
  precio: number
  moneda: 'ARS' | 'USD' | null
  precio_pesos: number | null
  familia: string | null
  sin_precio: boolean
}

/** El mismo buscador del catálogo que usa la app para cotizar una venta. */
export async function buscarArticulos(texto: string): Promise<ArticuloCatalogo[]> {
  const { data, error } = await supabase.rpc('buscar_articulos', { p_texto: texto })
  if (error) throw error
  return (data ?? []) as ArticuloCatalogo[]
}

export async function buscarClientes(texto: string) {
  const { data, error } = await supabase.rpc('buscar_clientes', { p_texto: texto })
  if (error) throw error
  return (data ?? []) as Array<Record<string, any>>
}

export interface CodigoComputo {
  codigo: string
  descripcion: string
  precio: number
  moneda: 'ARS' | 'USD' | null
  precio_pesos: number | null
  rango_min: number
  rango_max: number | null
  amplitud: number
}

/**
 * Reconoce en la lista de precios la herramienta que trajo el cliente y
 * devuelve su agujero de fábrica. Ver la versión de la app: misma lógica.
 */
export async function agujeroDeFabrica(item: FormularioItemNota): Promise<string | null> {
  const diametro = item.diametro_exterior.trim()
  if (!item.herramienta || !diametro) return null

  const candidatos = await buscarArticulos(`D=${diametro.replace(',', '.')}`)
  const coincidencia = reconocerHerramienta(candidatos, {
    diametro_exterior: diametro,
    ancho_corte: item.ancho_corte,
    dientes: item.cantidad_dientes,
  })
  return coincidencia?.caracteristicas.diametro_interior ?? null
}

export async function resolverCodigoDeItem(
  item: FormularioItemNota,
  /** Se pisa para buscar el código de REPARACIÓN de los dientes rotos. */
  servicio: TipoServicio = item.servicio,
): Promise<CodigoComputo[] | null> {
  if (!item.herramienta) return null
  const campo = MEDIDA_PARA_CODIGO[item.herramienta]
  if (!campo) return null

  const medida = aNumero((item as unknown as Record<string, string>)[campo] ?? '')
  if (!medida) return null

  const { data, error } = await supabase.rpc('buscar_codigo_computo', {
    p_familia: FAMILIA_CATALOGO[item.herramienta as Herramienta],
    p_medida: medida,
    p_dimension: item.herramienta === 'mecha' ? 'diametro' : 'ancho_corte',
    // Sin esto, a una sierra para AFILAR le salían códigos de REPARACIÓN, y
    // hasta de otra herramienta: la familia sola no alcanza para elegir.
    p_servicio: servicio,
    p_herramienta: item.herramienta,
  })
  if (error) throw error
  return (data ?? []) as CodigoComputo[]
}

export async function notasPendientes() {
  const { data, error } = await supabase
    .from('notas_pedido')
    .select('id, numero, tipo_nota, estado, cliente_codigo, cliente_nombre, total, creado_en, servicios')
    .in('estado', ['pendiente', 'pendiente_cliente'])
    .order('creado_en', { ascending: false })
  if (error) throw error
  return (data ?? []) as Array<Record<string, any>>
}

export async function historialNotas(desde: string, hasta: string) {
  const { data, error } = await supabase.rpc('historial_notas_pedido', {
    p_desde: desde,
    p_hasta: hasta,
  })
  if (error) throw error
  return (data ?? []) as Array<{ fecha: string; cantidad: number; detalle: Array<Record<string, any>> }>
}

export async function obtenerNota(id: string) {
  const { data, error } = await supabase
    .from('notas_pedido')
    .select(
      '*, items:notas_pedido_items(*), vendedor:perfiles!notas_pedido_vendedor_id_fkey(nombre_completo, codigo_vendedor)',
    )
    .eq('id', id)
    .single()
  if (error) throw error
  return data as Record<string, any>
}

export async function marcarImpresas(ids: string[]) {
  if (!ids.length) return
  await supabase
    .from('notas_pedido')
    .update({ estado: 'impresa', impresa_en: new Date().toISOString() })
    .in('id', ids)
}

export interface DatosNuevaNota {
  encabezado: FormularioNotaEncabezado
  servicios: TipoServicio[]
  tipoNota: TipoNotaPedido
  fechaEntrega: string
  items: FormularioItemNota[]
  tipoCambio: number
  cotizacionFecha: string
  /** Renglones de observación, uno por línea de la columna "Observaciones". */
  observaciones?: string[]
  condicionVenta: CondicionVenta
  /** Los días del cheque, o el texto de "Otro". Vacío en el resto. */
  condicionVentaDetalle?: string
}

export interface NotaCreada {
  id: string
  numero: number | null
  estado: string
  grupo: GrupoNota
  total: number
}

/**
 * Copia fiel de `crearNotaPedido`, incluida la regla del número pendiente y el
 * reparto en varias notas según cómo se factura cada cosa.
 */
export async function crearNotaPedido(datos: DatosNuevaNota): Promise<NotaCreada[]> {
  const { data: sesion } = await supabase.auth.getSession()
  const vendedorId = sesion.session?.user.id
  if (!vendedorId) throw new Error('No hay sesión')

  const enc = datos.encabezado
  const esPendienteCliente = !enc.cliente_id || enc.cliente_provisorio
  const grupos = agruparParaNotas(datos.items, datos.tipoCambio)
  if (grupos.length === 0) throw new Error('La nota necesita al menos un renglón')
  const observaciones = (datos.observaciones ?? []).filter((o) => o.trim())

  // El agujero distinto del de fábrica va a la descripción general.
  const descripcionGeneral = [
    enc.descripcion_herramienta.trim(),
    ...avisosDeAgujero(datos.items),
  ]
    .filter(Boolean)
    .join('\n')

  const creadas: NotaCreada[] = []

  try {
    for (const g of grupos) {
      const { data: nota, error } = await supabase
        .from('notas_pedido')
        .insert({
          vendedor_id: vendedorId,
          cliente_id: enc.cliente_id,
          cliente_codigo: enc.cliente_codigo || null,
          cliente_nombre: enc.cliente_nombre,
          cliente_cuit: enc.cliente_cuit || null,
          zona: enc.zona || null,
          datos_cliente: enc.datos_cliente || null,
          datos_cliente_origen: enc.datos_cliente_origen,
          descripcion_herramienta: descripcionGeneral || null,
          descripcion_herramienta_origen: enc.descripcion_herramienta_origen,
          vendedor_numero: enc.vendedor_numero.trim() || null,
          servicios: g.servicios,
          tipo_nota: datos.tipoNota,
          estado: esPendienteCliente ? 'pendiente_cliente' : 'pendiente',
          fecha_entrega: datos.fechaEntrega,
          // El afilado se cobra en pesos: su nota sale sin tipo de cambio.
          // Con renglones en dólares va igual, que es lo único que permite
          // convertir el total.
          tipo_cambio: g.llevaTipoDeCambio || g.tieneDolares ? datos.tipoCambio : null,
          cotizacion_fecha:
            g.llevaTipoDeCambio || g.tieneDolares ? datos.cotizacionFecha : null,
          total: g.total || null,
          observaciones,
          condicion_venta: datos.condicionVenta,
          // La base sólo acepta detalle en las dos que lo piden.
          condicion_venta_detalle: CONDICIONES_CON_DETALLE.includes(datos.condicionVenta)
            ? (datos.condicionVentaDetalle ?? '').trim()
            : null,
        })
        .select('id, numero, estado')
        .single()

      if (error) throw error
      const notaId = (nota as Record<string, any>).id as string

      const items = g.items.map((i, orden) => ({
        nota_id: notaId,
        orden: orden + 1,
        servicio: i.servicio,
        herramienta: i.herramienta,
        codigo_herramienta: i.codigo_herramienta || null,
        descripcion: i.descripcion || null,
        cantidad: Math.max(1, Math.round(aNumero(i.cantidad || i.unidades)) || 1),
        cantidad_dientes: aNumero(i.cantidad_dientes) || null,
        precio_unitario: aNumero(i.precio_por_diente || i.precio) || null,
        precio_total: totalDelRenglon(i) || null,
        moneda: i.servicio === 'venta' ? i.moneda : 'ARS',
        codigos_computo: i.codigos_computo,
        promocion: i.promocion,
        dientes_rotos: i.dientes_rotos,
        detalle: Object.fromEntries(
          Object.entries({
            diametro_exterior: i.diametro_exterior,
            diametro_interior: agujeroDelRenglon(i).medida,
            diametro_interior_catalogo: i.diametro_interior_catalogo,
            ajuste_agujero: agujeroDelRenglon(i).ajuste,
            diametro: i.diametro,
            ancho_corte: i.ancho_corte,
            largo: i.largo,
            ancho: i.ancho,
            largo_util: i.largo_util,
            espesor: i.espesor,
            paso: i.paso,
            tipo_mecha: i.tipo_mecha,
            mano: i.mano,
            promocion_detalle: i.promocion_detalle,
            afilado_reparacion: i.afilado_reparacion,
            origen_fresa: i.origen_fresa,
            dientes_rotos_cantidad: i.dientes_rotos
              ? aNumero(i.dientes_rotos_cantidad) || null
              : null,
            reparar_dientes: i.dientes_rotos ? i.reparar_dientes : null,
            codigo_reparacion: i.codigo_reparacion,
            precio_reparacion_unitario: aNumero(i.precio_reparacion_por_diente) || null,
          }).filter(([, v]) => v !== '' && v !== null && v !== undefined),
        ),
      }))

      const { error: errItems } = await supabase.from('notas_pedido_items').insert(items)
      if (errItems) {
        await supabase.from('notas_pedido').delete().eq('id', notaId)
        throw errItems
      }

      creadas.push({
        ...(nota as { id: string; numero: number | null; estado: string }),
        grupo: g.grupo,
        total: g.total,
      })
    }

    // "Va con nota de pedido 000011, 000012". Recién acá se puede: el número
    // lo asigna la base al insertar.
    if (creadas.length > 1) {
      const numeros = creadas.map((n) => n.numero)
      await Promise.all(
        creadas.map(async (n) => {
          const av = avisoDeNotasHermanas(numeros, n.numero)
          if (!av) return
          await supabase
            .from('notas_pedido')
            .update({ observaciones: [...observaciones, av] })
            .eq('id', n.id)
        }),
      )
    }
  } catch (e) {
    // Media venta cargada es peor que nada: se deshace la tanda entera.
    if (creadas.length > 0) {
      await supabase.from('notas_pedido').delete().in('id', creadas.map((n) => n.id))
    }
    throw e
  }

  return creadas
}

export async function crearClienteProvisorio(params: {
  razon_social: string
  documento: string
  direccion: string
  codigo_postal: string
  telefonos: string
  email: string
  nombre_fantasia: string
}) {
  const { data, error } = await supabase.rpc('crear_cliente_provisorio', {
    p_razon_social: params.razon_social,
    p_documento: params.documento || null,
    p_direccion_formateada: params.direccion || null,
    p_codigo_postal: params.codigo_postal || null,
    p_telefonos: params.telefonos || null,
    p_email: params.email || null,
    p_nombre_fantasia: params.nombre_fantasia || null,
  })
  if (error) throw error
  return data as Record<string, any>
}
