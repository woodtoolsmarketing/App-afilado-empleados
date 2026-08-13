import {
  agruparParaNotas,
  agujeroDelRenglon,
  aNumero,
  avisosDeAgujero,
  CONDICIONES_CON_DETALLE,
  aplicarSinCargo,
  FAMILIA_CATALOGO,
  reconocerHerramienta,
  MEDIDA_PARA_CODIGO,
  totalDelRenglon,
  type CondicionVenta,
  type CuchillaMaterial,
  type CuchillaTipo,
  type CuchillaTrabajo,
  type FormularioItemNota,
  type FormularioNotaEncabezado,
  type GrupoNota,
  type Herramienta,
  type TipoMecha,
  type TipoNotaPedido,
  type TipoServicio,
} from '@woodtools/compartido'

import { supabase } from '../nucleo/supabase'
import { CLIENTE_A_MANO, VARIANTE } from '../nucleo/variante'

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
  /** La lista trae el código pero todavía no el importe: lo pone el vendedor. */
  a_cotizar?: boolean
}

/**
 * Un modelo de mecha del catálogo.
 *
 * Las mechas no se cotizan por medida como una sierra: la familia entera tiene
 * un solo código con rango, así que buscar por diámetro no devolvía nunca nada.
 * Se eligen por tipo y modelo, que es como están en la lista de precios y como
 * las nombra el cliente.
 */
export interface ModeloMecha {
  codigo: string
  descripcion: string
  medida: string
  precio: number
  moneda: 'ARS' | 'USD' | null
  precio_pesos: number | null
  a_cotizar: boolean
}

/**
 * Los modelos de mecha de un tipo, con su precio.
 *
 * El tipo sale del desplegable del renglón y el prefijo del código lo
 * confirma: MB bisagra, MC ciega, MP pasante, MID integral, MIDN compresión.
 * El reparto lo hace la base, que es la que tiene el catálogo entero.
 */
export async function mechasDelTipo(tipo: TipoMecha): Promise<ModeloMecha[]> {
  const { data, error } = await supabase.rpc('mechas_del_tipo', { p_tipo: tipo })
  if (error) throw error
  return aplicarSinCargo((data ?? []) as ModeloMecha[])
}

/**
 * Uno de los seis códigos de afilado de cuchilla, ya clasificado.
 *
 * `precio_pesos` es por cada 100 mm de cuchilla, no por unidad: la cuenta la
 * hace `totalAfiladoCuchilla`.
 */
export interface CodigoCuchilla {
  codigo: string
  descripcion: string
  precio: number
  moneda: 'ARS' | 'USD' | null
  precio_pesos: number | null
  a_cotizar: boolean
  tipo: CuchillaTipo
  material: CuchillaMaterial
  trabajo: CuchillaTrabajo
}

/**
 * Los seis códigos de afilado de cuchilla.
 *
 * Vienen de la lista de mechas —el rubro es "Afil.Mechas Insertos Cuchillas"—
 * así que están archivados con familia `mecha` y el buscador por medida de la
 * familia `cuchilla` no los encuentra nunca. Se piden por código.
 */
export async function codigosAfiladoCuchilla(): Promise<CodigoCuchilla[]> {
  const { data, error } = await supabase.rpc('codigos_afilado_cuchilla')
  if (error) throw error
  return aplicarSinCargo((data ?? []) as CodigoCuchilla[])
}

export async function buscarArticulos(texto: string): Promise<ArticuloCatalogo[]> {
  const { data, error } = await supabase.rpc('buscar_articulos', { p_texto: texto })
  if (error) throw error
  return aplicarSinCargo((data ?? []) as ArticuloCatalogo[])
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
  // Por acá pasan también los códigos de reparación de dientes rotos, que es
  // donde vive "REP. DTE. DE SIERRA SIN CARGO".
  return aplicarSinCargo((data ?? []) as CodigoComputo[])
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
      'codigo, descripcion, precio, moneda, precio_a_confirmar, rango_min, rango_max, rango_dimension, servicio_sugerido, herramienta_sugerida',
    )
    .eq('familia', FAMILIA_CATALOGO[herramienta])
    // Los que están a cotizar YA NO se esconden. Escondidos, la medida "no
    // daba ningún código" y el vendedor no tenía forma de saber que el código
    // existía y lo único que faltaba era el importe.
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

  /**
   * El precio se calcula, no se descarta.
   *
   * Estaba fijo en `null`, aunque la consulta de arriba trae `precio` y
   * `moneda`. Para las mechas y las cuchillas —que no tienen rango, así que
   * `rango_min` es siempre null— la pantalla dibuja el precio sólo cuando
   * `precio_pesos` no es nulo: nunca lo era, y la lista de códigos salía toda
   * sin precio. El vendedor elegía a ciegas y después tenía que tipear el
   * importe a mano.
   *
   * Los precios en dólares quedan en null a propósito: convertirlos necesita la
   * cotización, que esta función no recibe. Ahí sigue mostrando el código sin
   * importe, que es lo honesto.
   */
  return aplicarSinCargo(
    (data ?? []).map((c) => {
      const fila = c as Record<string, any>
      const enPesos = fila.moneda !== 'USD' && fila.precio !== null && fila.precio !== undefined
      return {
        ...fila,
        precio_pesos: enPesos ? Number(fila.precio) : null,
        amplitud: 0,
        a_cotizar: fila.precio_a_confirmar === true,
      }
    }) as CodigoComputo[],
  )
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
 * Qué vendedor tiene a cargo esa zona.
 *
 * Es el segundo intento para completar el número de vendedor de la nota: el
 * primero es el del que está usando la app. Sirve para cuando quien carga no
 * tiene número propio —la oficina tomando un pedido por teléfono— y el
 * comprobante lo necesita igual.
 *
 * Devuelve null si la zona no está asignada o si la cubre más de un vendedor.
 * Un número inventado en un comprobante no se arregla solo.
 */
export async function vendedorDeZona(codigo: string): Promise<string | null> {
  const limpio = codigo.trim()
  if (!limpio) return null

  const { data, error } = await supabase.rpc('vendedor_de_zona', { codigo: limpio })
  if (error) return null
  return typeof data === 'string' && data.trim() ? data.trim() : null
}

// ─────────────────────────────────────────────────────────────────────────────
// Medidas en cascada
// ─────────────────────────────────────────────────────────────────────────────

/** Un valor que todavía es posible para un campo, y cuántos códigos lo tienen. */
export interface OpcionMedida {
  valor: number | string
  cantidad: number
}

export interface ArticuloConMedidas {
  codigo: string
  descripcion?: string
  marca?: string
  subrubro_nombre?: string
  notas?: string
  precio?: number
  moneda?: 'ARS' | 'USD'
  a_cotizar?: boolean
  [medida: string]: unknown
}

export interface CascadaMedidas {
  /** Cuántos códigos del catálogo siguen encajando con lo elegido. */
  total: number
  /** Por campo del formulario, los valores que siguen dando resultados. */
  opciones: Record<string, OpcionMedida[]>
  articulos: ArticuloConMedidas[]
}

const CASCADA_VACIA: CascadaMedidas = { total: 0, opciones: {}, articulos: [] }

/**
 * Qué medidas siguen siendo posibles, dado lo que el vendedor ya eligió.
 *
 * Las medidas de la herramienta no son libres: una sierra de 300 mm existe con
 * 96 o 72 dientes, no con cualquiera. Hasta ahora el renglón las pedía escritas
 * a mano y no había forma de saberlo, así que se cargaban medidas que no
 * existen y el código de cómputo no aparecía nunca.
 *
 * Esto le pregunta a la base, en una sola ida, tres cosas: cuántas herramientas
 * quedan, qué valores siguen siendo posibles en CADA campo, y cuáles son con su
 * precio. Sin orden fijo: se complete lo que se complete, los demás se achican.
 */
export async function medidasEnCascada(
  herramienta: Herramienta,
  filtros: Record<string, string | number>,
  limite = 20,
): Promise<CascadaMedidas> {
  // Sólo viajan los que tienen algo: un filtro vacío no filtra, y mandarlo
  // haría que la base compare contra null y no devuelva nada.
  const limpios: Record<string, string | number> = {}
  for (const [k, v] of Object.entries(filtros)) {
    const texto = String(v ?? '').trim().replace(',', '.')
    if (texto) limpios[k] = texto
  }

  const { data, error } = await supabase.rpc('medidas_en_cascada', {
    p_herramienta: herramienta,
    p_filtros: limpios,
    p_limite: limite,
  })
  // Que falle la cascada no puede trabar la carga: los campos siguen siendo
  // escribibles y el renglón se completa igual.
  if (error) return CASCADA_VACIA
  return (data as CascadaMedidas | null) ?? CASCADA_VACIA
}

/**
 * Cómo compra habitualmente el cliente.
 *
 * Cada cliente repite casi siempre lo mismo —uno factura y paga a 30 días, otro
 * pide presupuesto y paga al contado— y hasta ahora eso se elegía de cero en
 * cada nota. Esto mira sus últimas doce notas no anuladas y devuelve lo más
 * frecuente, para dejarlo preseleccionado.
 *
 * Devuelve null cuando el cliente no tiene historial: ahí no hay costumbre que
 * respetar y los desplegables arrancan vacíos, como siempre.
 */
export interface TendenciaCliente {
  tipo_nota: TipoNotaPedido | null
  tipo_nota_veces: number
  condicion_venta: CondicionVenta | null
  condicion_detalle: string | null
  condicion_veces: number
  notas_miradas: number
}

export async function tendenciaCliente(clienteId: string): Promise<TendenciaCliente | null> {
  const { data, error } = await supabase.rpc('tendencia_cliente', { p_cliente_id: clienteId })
  // Que falle la tendencia no puede impedir cargar la nota: es una comodidad.
  if (error) return null

  const fila = (Array.isArray(data) ? data[0] : data) as TendenciaCliente | undefined
  if (!fila || !fila.notas_miradas) return null
  return fila
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
  /**
   * Null cuando no hay cotización, que es válido: una nota sin renglones en
   * dólares no la necesita y no la guarda. Sólo se escribe en las notas que
   * llevan tipo de cambio.
   */
  cotizacionFecha: string | null
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

/**
 * La fila de `notas_pedido_items` que corresponde a un renglón del formulario.
 *
 * Sin `nota_id`: la nota todavía no existe cuando esto se arma. Lo completa el
 * servidor, que es el único que sabe con qué id quedó cada nota.
 */
function filaDeItem(i: FormularioItemNota, orden: number) {
  return {
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
        // Sólo se guardan cuando son ciertas: `null` lo descarta el filtro de
        // abajo, y así el detalle no se llena de "sin_cargo: false".
        sin_cargo: i.sin_cargo ? true : null,
        reparacion_sin_cargo: i.reparacion_sin_cargo ? true : null,
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
 *
 * **La numeración la lleva el servidor, no la app.** Va toda la carga en un
 * solo pedido y el talonario entrega los números de un saque: salen seguidos,
 * en el orden exacto en que se crearon las notas, y ningún otro vendedor puede
 * meterse en el medio. Si algo falla, no queda nada a medias ni se pierde un
 * número — el contador vuelve atrás con la transacción.
 */
export async function crearNotaPedido(datos: DatosNuevaNota): Promise<NotaCreada[]> {
  const { data: sesion } = await supabase.auth.getSession()
  const vendedorId = sesion.session?.user.id
  if (!vendedorId) throw new Error('No hay sesión')

  const enc = datos.encabezado
  // Sin cliente, o con uno provisorio: la nota no puede recibir numero. Un
  // codigo automatico "P-000123" no es un codigo de cliente.
  //
  // En la versión de prueba el cliente no sale de la base, así que `cliente_id`
  // siempre viene vacío. Si se aplicara la regla tal cual, TODA nota de la beta
  // quedaría sin número —y sin número no hay comprobante que imprimir, que es
  // justamente lo que se está probando—. Ahí lo que vale es el código que el
  // vendedor escribió: si lo puso, la nota se numera.
  const esPendienteCliente = CLIENTE_A_MANO
    ? !enc.cliente_codigo.trim()
    : !enc.cliente_id || enc.cliente_provisorio

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

  // Toda la carga en un solo pedido. El servidor la mete en una transacción:
  // reserva de una vez los números que hacen falta —seguidos, sin que se meta
  // otro vendedor en el medio—, marca cada nota con su instante exacto de
  // creación y escribe la referencia cruzada entre las hermanas.
  //
  // Antes eran N inserciones sueltas desde el teléfono, y el deshacer también:
  // si fallaba la segunda nota había que borrar la primera con otra llamada,
  // que es justo la que no sale si en ese momento se corta la señal.
  const carga = grupos.map((g) => ({
    nota: {
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
      /**
       * Qué app creó la nota.
       *
       * Ya NO elige talonario: el talonario es uno solo y todas las notas, de
       * todas las apps y todos los vendedores, salen de la misma serie. Queda
       * como registro, y es lo que permite separar las notas de prueba de las
       * de verdad antes de largar la versión definitiva.
       */
      variante: VARIANTE,
      // Cada nota declara sólo los servicios que realmente contiene.
      servicios: g.servicios,
      tipo_nota: datos.tipoNota,
      estado: esPendienteCliente ? 'pendiente_cliente' : 'pendiente',
      fecha_entrega: datos.fechaEntrega,
      // Con renglones en dólares el tipo de cambio va sí o sí, aunque el grupo
      // no lo pidiera: es lo único que permite convertir el total.
      tipo_cambio: g.llevaTipoDeCambio || g.tieneDolares ? datos.tipoCambio : null,
      cotizacion_fecha: g.llevaTipoDeCambio || g.tieneDolares ? datos.cotizacionFecha : null,
      total: g.total || null,
      observaciones,
      condicion_venta: datos.condicionVenta,
      // La base sólo acepta detalle en las dos que lo piden.
      condicion_venta_detalle: CONDICIONES_CON_DETALLE.includes(datos.condicionVenta)
        ? (datos.condicionVentaDetalle ?? '').trim()
        : null,
    },
    items: g.items.map((i, orden) => filaDeItem(i, orden + 1)),
  }))

  const { data, error } = await supabase.rpc('crear_notas_pedido', { p_notas: carga })
  if (error) throw error

  const filas = ((data ?? []) as FilaNotaCreada[])
    .slice()
    .sort((a, b) => a.orden_nota - b.orden_nota)

  if (filas.length !== grupos.length) {
    throw new Error(
      `El servidor guardó ${filas.length} de ${grupos.length} notas. Revisá la lista de pendientes antes de volver a cargarla.`,
    )
  }

  // `orden_nota` es la posición en la que se mandó cada nota, así que vuelve a
  // aparearse con su grupo. El grupo y el total los sabe la app: son los que
  // usó para armar la carga.
  return filas.map((f, i) => ({
    id: f.nota_id,
    numero: f.nota_numero,
    estado: f.nota_estado,
    grupo: grupos[i].grupo,
    total: grupos[i].total,
  }))
}

/** Lo que devuelve `crear_notas_pedido`, una fila por nota. */
interface FilaNotaCreada {
  orden_nota: number
  nota_id: string
  nota_numero: number | null
  nota_estado: string
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

/**
 * Deja registrado que la nota salió por la impresora.
 *
 * El `.eq('estado', 'pendiente')` no es una precaución de más: las notas de un
 * cliente que todavía no tiene código quedan en `pendiente_cliente`, esperando
 * que Administración le asigne el número. Sin ese filtro, imprimir una de ésas
 * la pasaba a `impresa` y la sacaba de la cola de Administración **para
 * siempre**, con el trabajo hecho y sin numerar. Nadie se enteraba: la nota
 * simplemente dejaba de aparecer.
 *
 * Para esas notas se guarda igual la fecha de impresión —es cierto que se
 * imprimió— pero el estado no se toca.
 */
export async function marcarImpresas(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const ahora = new Date().toISOString()

  const { error } = await supabase
    .from('notas_pedido')
    .update({ estado: 'impresa', impresa_en: ahora })
    .in('id', ids)
    .eq('estado', 'pendiente')
  if (error) throw error

  const { error: errorSinNumero } = await supabase
    .from('notas_pedido')
    .update({ impresa_en: ahora })
    .in('id', ids)
    .eq('estado', 'pendiente_cliente')
  if (errorSinNumero) throw errorSinNumero
}
