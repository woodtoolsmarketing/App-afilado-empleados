import {
  agruparParaNotas,
  agujeroDelRenglon,
  aNumero,
  avisoDeNotasHermanas,
  avisosDeAgujero,
  CONDICIONES_CON_DETALLE,
  FAMILIA_CATALOGO,
  reconocerHerramienta,
  MEDIDA_PARA_CODIGO,
  totalDelRenglon,
  type CondicionVenta,
  type FormularioItemNota,
  type FormularioNotaEncabezado,
  type GrupoNota,
  type Herramienta,
  type TipoNotaPedido,
  type TipoServicio,
} from '@woodtools/compartido'

import { supabase } from '../nucleo/supabase'

/**
 * Notas de pedido.
 *
 * El precio y el código de cómputo se resuelven contra el catálogo importado de
 * las listas del Gestión Comercial. El vendedor no tiene que saberse los
 * códigos ni hacer la cuenta del dólar en la calle.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Cotización
// ─────────────────────────────────────────────────────────────────────────────

export interface Cotizacion {
  fecha: string
  compra: number | null
  venta: number
  desde_cache: boolean
  aproximada?: boolean
}

export async function obtenerCotizacion(fecha?: string): Promise<Cotizacion> {
  const { data, error } = await supabase.functions.invoke('cotizacion-dolar', {
    body: fecha ? { fecha } : {},
  })
  if (error) throw new Error('No pudimos obtener la cotización del dólar. Revisá la conexión.')
  return data as Cotizacion
}

// ─────────────────────────────────────────────────────────────────────────────
// Catálogo
// ─────────────────────────────────────────────────────────────────────────────

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

export async function buscarArticulos(texto: string): Promise<ArticuloCatalogo[]> {
  const { data, error } = await supabase.rpc('buscar_articulos', { p_texto: texto })
  if (error) throw error
  return (data ?? []) as ArticuloCatalogo[]
}

/**
 * Códigos de cómputo cuyo rango cubre la medida, del más ajustado al más
 * amplio. Los artículos sin precio no aparecen: los completa Administración.
 */
export async function buscarCodigoComputo(params: {
  herramienta: Herramienta
  medida: number
  dimension?: string
  servicio?: TipoServicio
}): Promise<CodigoComputo[]> {
  const { data, error } = await supabase.rpc('buscar_codigo_computo', {
    p_familia: FAMILIA_CATALOGO[params.herramienta],
    p_medida: params.medida,
    p_dimension: params.dimension ?? 'ancho_corte',
    // Sin esto, a una sierra para AFILAR le salían códigos de REPARACIÓN, y
    // hasta de otra herramienta: la familia sola no alcanza para elegir.
    p_servicio: params.servicio ?? null,
    p_herramienta: params.herramienta,
  })
  if (error) throw error
  return (data ?? []) as CodigoComputo[]
}

/**
 * Todos los rangos que el catálogo tiene cargados para esa herramienta.
 *
 * Es la respuesta a "¿y qué medidas hay?", que el vendedor se pregunta cuando
 * su medida no cae en ninguna. Sin esto, la única salida era probar números
 * hasta que apareciera algo.
 */
export async function medidasDisponibles(
  herramienta: Herramienta,
  servicio?: TipoServicio,
): Promise<CodigoComputo[]> {
  const conRango = await codigosDeLaHerramienta(herramienta, servicio, true)
  if (conRango.length > 0) return conRango

  // ── Las familias que NO se cotizan por medida ────────────────────────────
  //
  // Mechas (0 de 181) y cuchillas (0 de 143) no tienen un solo código con
  // rango: la mecha se cotiza por tipo y cantidad de filos, y la lista de
  // cuchillas es un catálogo de producto, no de servicio.
  //
  // Buscar por diámetro ahí no devuelve nada y nunca va a devolver nada. En vez
  // de dejar al vendedor probando números, se listan los códigos que sí
  // existen para esa herramienta y elige.
  return codigosDeLaHerramienta(herramienta, servicio, false)
}

async function codigosDeLaHerramienta(
  herramienta: Herramienta,
  servicio: TipoServicio | undefined,
  conRango: boolean,
): Promise<CodigoComputo[]> {
  let consulta = supabase
    .from('vista_catalogo_vigente')
    .select(
      'codigo, descripcion, precio, moneda, rango_min, rango_max, rango_dimension, servicio_sugerido, herramienta_sugerida',
    )
    .eq('familia', FAMILIA_CATALOGO[herramienta])
    .eq('precio_a_confirmar', false)
    .or(`herramienta_sugerida.is.null,herramienta_sugerida.eq.${herramienta}`)

  consulta = conRango
    ? consulta.not('rango_min', 'is', null).order('rango_min', { ascending: true })
    : consulta.is('rango_min', null).order('codigo', { ascending: true }).limit(60)

  // Sin servicio no se filtra: se muestran todas las medidas de la herramienta.
  if (servicio) {
    consulta = consulta.or(`servicio_sugerido.is.null,servicio_sugerido.eq.${servicio}`)
  }

  const { data, error } = await consulta
  if (error) throw error
  return (data ?? []).map((c) => ({
    ...(c as Record<string, any>),
    precio_pesos: null,
    amplitud: 0,
  })) as CodigoComputo[]
}

/**
 * Reconoce en la lista de precios la herramienta que trajo el cliente.
 *
 * En un renglón de afilado no hay artículo elegido, pero la pieza está en la
 * lista igual: 122 de las 130 sierras traen `D=` y `d=` en su descripción. Con
 * el diámetro exterior alcanza para encontrarla, y de ahí sale el **agujero de
 * fábrica**, que es contra lo que se compara el que carga el vendedor para
 * saber si fue agrandado o lleva buje reductor.
 *
 * Devuelve null cuando no hay diámetro cargado o cuando la herramienta no está
 * en ninguna lista con sus medidas: mechas, cuchillas y sierras sin fin no las
 * traen, y ahí no hay nada que reconocer.
 */
export async function agujeroDeFabrica(item: FormularioItemNota): Promise<string | null> {
  const diametro = item.diametro_exterior.trim()
  if (!item.herramienta || !diametro) return null

  // Se busca por el texto tal como está escrito en la lista y después se
  // verifica la medida: "D=30" como texto también trae los "D=300".
  const candidatos = await buscarArticulos(`D=${diametro.replace(',', '.')}`)
  const coincidencia = reconocerHerramienta(candidatos, {
    diametro_exterior: diametro,
    ancho_corte: item.ancho_corte,
    dientes: item.cantidad_dientes,
  })
  return coincidencia?.caracteristicas.diametro_interior ?? null
}

/**
 * Resuelve el código de cómputo a partir de la medida que corresponde a cada
 * herramienta (ancho de corte en sierras, ancho en cuchillas, diámetro en
 * mechas). Devuelve null cuando falta la medida, para no buscar en falso.
 */
export async function resolverCodigoDeItem(
  item: FormularioItemNota,
  /**
   * Con qué servicio buscar. Por defecto el del renglón; se pisa para buscar
   * el código de REPARACIÓN de los dientes rotos de una herramienta que vino a
   * afilar, que es otro trabajo y otro precio sobre la misma pieza.
   */
  servicio: TipoServicio = item.servicio,
): Promise<CodigoComputo[] | null> {
  if (!item.herramienta) return null

  const campo = MEDIDA_PARA_CODIGO[item.herramienta]
  if (!campo) return null

  const bruto = (item as unknown as Record<string, string>)[campo] ?? ''
  const medida = aNumero(bruto)
  if (!medida) return null

  // En las mechas la medida es el diámetro; en el resto, un ancho.
  const dimension = item.herramienta === 'mecha' ? 'diametro' : 'ancho_corte'
  return buscarCodigoComputo({
    herramienta: item.herramienta,
    medida,
    dimension,
    servicio,
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Alta de la nota
// ─────────────────────────────────────────────────────────────────────────────

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
  /** En qué nota cayó: afilado, venta, sierras sin fin o fresas nacionales. */
  grupo: GrupoNota
  total: number
}

/** La fila de `notas_pedido_items` que corresponde a un renglón del formulario. */
function filaDeItem(i: FormularioItemNota, notaId: string, orden: number) {
  return {
    nota_id: notaId,
    orden,
    servicio: i.servicio,
    herramienta: i.herramienta,
    codigo_herramienta: i.codigo_herramienta || null,
    descripcion: i.descripcion || null,
    cantidad: Math.max(1, Math.round(aNumero(i.cantidad || i.unidades)) || 1),
    cantidad_dientes: aNumero(i.cantidad_dientes) || null,
    // El unitario es lo que sale de la lista de precios —por diente en el
    // afilado, por unidad en la venta— y el total es la multiplicación.
    precio_unitario: aNumero(i.precio_por_diente || i.precio) || null,
    precio_total: totalDelRenglon(i) || null,
    // En qué moneda están esos dos. El afilado siempre en pesos; la venta,
    // en la de la lista de precios de la que salió el artículo.
    moneda: i.servicio === 'venta' ? i.moneda : 'ARS',
    codigos_computo: i.codigos_computo,
    promocion: i.promocion,
    dientes_rotos: i.dientes_rotos,
    // Las medidas propias de cada herramienta. Se guardan sólo las que tienen
    // valor, para que el detalle no se llene de campos vacíos.
    detalle: Object.fromEntries(
      Object.entries({
        diametro_exterior: i.diametro_exterior,
        // El agujero que lleva la pieza: el cargado, o el de fábrica si no lo
        // cargaron. Va siempre, para que la fábrica no tenga que buscarlo.
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
        // Los dientes rotos y su reparación. La impresión los necesita para
        // separar la línea de afilado de la de reparación.
        dientes_rotos_cantidad: i.dientes_rotos ? aNumero(i.dientes_rotos_cantidad) || null : null,
        reparar_dientes: i.dientes_rotos ? i.reparar_dientes : null,
        codigo_reparacion: i.codigo_reparacion,
        precio_reparacion_unitario: aNumero(i.precio_reparacion_por_diente) || null,
      }).filter(([, v]) => v !== '' && v !== null && v !== undefined),
    ),
  }
}

/**
 * Crea las notas de pedido del cliente.
 *
 * **Devuelve varias**, no una: el afilado y la venta se facturan distinto y no
 * pueden ir en el mismo comprobante, y adentro de la venta las sierras sin fin
 * y las fresas de producción nacional llevan nota propia. El vendedor carga
 * todo junto, como lo trae el cliente; el reparto lo hace `agruparParaNotas`.
 *
 * El tipo de cambio se guarda sólo en las que se cotizan en dólares. En las de
 * afilado queda en null y el recuadro sale vacío: se cobra en pesos.
 *
 * Si el cliente todavía no existe en el sistema, las notas nacen en
 * `pendiente_cliente`: se guardan con el nombre, CUIT, vendedor y zona, pero
 * sin número, hasta que Administración le asigne el código de cliente. El
 * trabajo queda registrado igual — que el alta del cliente esté demorada no
 * puede costarle la venta al vendedor.
 */
export async function crearNotaPedido(datos: DatosNuevaNota): Promise<NotaCreada[]> {
  const { data: sesion } = await supabase.auth.getSession()
  const vendedorId = sesion.session?.user.id
  if (!vendedorId) throw new Error('No hay sesión')

  const enc = datos.encabezado
  // Sin cliente, o con uno provisorio: la nota no puede recibir numero. Un
  // codigo automatico "P-000123" no es un codigo de cliente.
  const esPendienteCliente = !enc.cliente_id || enc.cliente_provisorio

  // El tipo de cambio entra en el agrupado para poder expresar el total de
  // cada nota en pesos aunque sus renglones estén cotizados en dólares.
  const grupos = agruparParaNotas(datos.items, datos.tipoCambio)
  if (grupos.length === 0) throw new Error('La nota necesita al menos un renglón')

  // Las observaciones son de la nota, y acá puede salir más de una. Se repiten
  // en todas: el vendedor las escribió para este cliente, no para un grupo de
  // facturación que la app inventó por atrás.
  const observaciones = (datos.observaciones ?? []).filter((o) => o.trim())

  // El agujero distinto del de fábrica va a la descripción general, que es lo
  // que la fábrica lee antes de tocar la pieza.
  const avisos = avisosDeAgujero(datos.items)
  const descripcionGeneral = [enc.descripcion_herramienta.trim(), ...avisos]
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
          // Cada nota declara sólo los servicios que realmente contiene.
          servicios: g.servicios,
          tipo_nota: datos.tipoNota,
          estado: esPendienteCliente ? 'pendiente_cliente' : 'pendiente',
          fecha_entrega: datos.fechaEntrega,
          // Con renglones en dólares el tipo de cambio va sí o sí, aunque el
          // grupo no lo pidiera: es lo único que permite convertir el total.
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

      const items = g.items.map((i, orden) => filaDeItem(i, nota.id, orden + 1))
      const { error: errItems } = await supabase.from('notas_pedido_items').insert(items)
      if (errItems) {
        // La nota sin renglones no sirve para nada y confundiría en la lista
        // de pendientes: se borra para no dejar basura a medio guardar.
        await supabase.from('notas_pedido').delete().eq('id', nota.id)
        throw errItems
      }

      creadas.push({ ...(nota as Omit<NotaCreada, 'grupo' | 'total'>), grupo: g.grupo, total: g.total })
    }

    // ── "Va con nota de pedido 000011, 000012" ────────────────────────────
    //
    // Recién acá se puede: el número lo asigna la base al insertar, así que
    // hasta que no están todas creadas no hay qué escribir. Sin esto, las tres
    // notas de un mismo cliente llegan a fábrica sin ninguna referencia entre
    // sí y nadie sabe que van juntas.
    if (creadas.length > 1) {
      const numeros = creadas.map((n) => n.numero)
      await Promise.all(
        creadas.map(async (n) => {
          const aviso = avisoDeNotasHermanas(numeros, n.numero)
          if (!aviso) return
          await supabase
            .from('notas_pedido')
            .update({ observaciones: [...observaciones, aviso] })
            .eq('id', n.id)
        }),
      )
    }
  } catch (e) {
    // Un cliente con media venta cargada es peor que uno sin nada: si falla la
    // segunda nota, se deshacen las que ya se habían creado en esta tanda.
    if (creadas.length > 0) {
      await supabase
        .from('notas_pedido')
        .delete()
        .in('id', creadas.map((n) => n.id))
    }
    throw e
  }

  return creadas
}

// ─────────────────────────────────────────────────────────────────────────────
// Consulta
// ─────────────────────────────────────────────────────────────────────────────

export interface NotaResumen {
  id: string
  numero: number | null
  tipo_nota: TipoNotaPedido | null
  estado: string
  cliente_codigo: string | null
  cliente_nombre: string
  total: number | null
  creado_en: string
  servicios: TipoServicio[]
}

export async function notasPendientes(): Promise<NotaResumen[]> {
  const { data, error } = await supabase
    .from('notas_pedido')
    .select('id, numero, tipo_nota, estado, cliente_codigo, cliente_nombre, total, creado_en, servicios')
    .in('estado', ['pendiente', 'pendiente_cliente'])
    .order('creado_en', { ascending: false })

  if (error) throw error
  return (data ?? []) as NotaResumen[]
}

export interface DiaNotas {
  fecha: string
  cantidad: number
  detalle: Array<{
    nota_id: string
    numero: number | null
    tipo_nota: TipoNotaPedido | null
    estado: string
    cliente_codigo: string | null
    cliente_nombre: string
    hora: string
    total: number | null
    servicios: TipoServicio[]
  }>
}

export async function historialNotas(desde?: string, hasta?: string): Promise<DiaNotas[]> {
  const { data, error } = await supabase.rpc('historial_notas_pedido', {
    p_desde: desde ?? null,
    p_hasta: hasta ?? null,
  })
  if (error) throw error
  return (data ?? []) as DiaNotas[]
}

/** Nota completa con sus renglones, para verla o imprimirla. */
export async function obtenerNota(id: string) {
  const { data, error } = await supabase
    .from('notas_pedido')
    .select('*, items:notas_pedido_items(*), vendedor:perfiles!notas_pedido_vendedor_id_fkey(nombre_completo, codigo_vendedor)')
    .eq('id', id)
    .single()

  if (error) throw error
  return data
}

export async function marcarImpresas(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const { error } = await supabase
    .from('notas_pedido')
    .update({ estado: 'impresa', impresa_en: new Date().toISOString() })
    .in('id', ids)
  if (error) throw error
}
