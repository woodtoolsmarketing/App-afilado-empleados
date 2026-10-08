import {
  agruparParaNotas,
  aNumero,
  comoCadena,
  comoTexto,
  descripcionGeneralDeLaNota,
  CONDICIONES_CON_DETALLE,
  aplicarSinCargo,
  ENCABEZADO_VACIO,
  esObservacionDelSistema,
  ESTADOS_EDITABLES,
  FAMILIA_CATALOGO,
  filaDeItem,
  itemDeFila,
  reconocerHerramienta,
  MEDIDA_PARA_CODIGO,
  sinAvisosDeAgujero,
  sinLineaDeServicio,
  resumenDeRenglonesDeVisita,
  ZONAS,
  type BorradorNota,
  type CondicionVenta,
  type CuchillaMaterial,
  type CuchillaTipo,
  type CuchillaTrabajo,
  type EstadoNotaPedido,
  type FormularioItemNota,
  type FormularioNotaEncabezado,
  type GrupoNota,
  type Herramienta,
  type ManoMecha,
  type MaterialMecha,
  type RenglonParaResumen,
  type TipoMecha,
  type TipoNotaPedido,
  type TipoServicio,
} from '@woodtools/compartido'

// `filaDeItem`, `itemDeFila`, `ESTADOS_EDITABLES`, `sePuedeCorregir` y
// `BorradorNota` se mudaron a @woodtools/compartido para que el panel de
// escritorio y el móvil compartan EXACTAMENTE el mismo mapeo. Se reexportan
// para las pantallas que ya las toman de este módulo (DetalleNota,
// NotasPendientes, GenerarNota).
export { ESTADOS_EDITABLES, sePuedeCorregir } from '@woodtools/compartido'
export type { BorradorNota } from '@woodtools/compartido'

import { supabase, tokenDeSesion } from '../nucleo/supabase'
import { ubicacionActual } from './ubicacion'
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
    headers: { Authorization: `Bearer ${await tokenDeSesion()}` },
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
  // Medidas estructuradas del catálogo (del maestro de datos técnicos). Cuando
  // están, el buscador filtra por ellas —exacto y confiable— en vez de parsear
  // la descripción. Nullables: no todo producto trae todas.
  diametro_exterior: number | null
  ancho_corte: number | null
  diametro_interior: number | null
  dientes: number | null
}

export interface CodigoComputo {
  codigo: string
  descripcion: string
  precio: number
  moneda: 'ARS' | 'USD' | null
  precio_pesos: number | null
  // null en los códigos "sin rango" (mecha/cuchilla, y el 8060 de reclamo): no
  // se filtran por medida. El código ya lo trata así (ver `rango_min === null`).
  rango_min: number | null
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
  /**
   * De qué mano es, sacada de la columna y no del texto de la descripción.
   *
   * La lista tiene una errata: `MCIR0670` dice "MECHA CIEGA DER." siendo
   * izquierda —lo dice su propio código, MC**I**R—. Y hay dos que no dicen ni
   * DER ni IZQ, así que el campo quedaba vacío y obligatorio sobre un dato que
   * la base tenía cargado.
   */
  mano: ManoMecha | null
  /**
   * Los filos. Sólo vienen en las integrales, que es donde eligen el precio del
   * afilado: Z=2 son $ 34.423 y Z=4 son $ 47.480.
   */
  cantidad_dientes: number | null
}

/**
 * Los modelos de mecha de un tipo, con su precio.
 *
 * Los clasifica `catalogo_medidas.subrubro`, que es el sub-rubro del Gestión y
 * ya tiene las 166 filas repartidas. Antes se adivinaba por el prefijo del
 * código —MB bisagra, MC ciega, MP pasante— y con cuatro reglas de texto para
 * once sub-rubros quedaban 42 códigos sin tipo y cuatro tipos sin un solo
 * modelo.
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
 * Uno de los cuatro códigos de mecanizado del agujero, ya clasificado por
 * herramienta y operación. `precio_pesos` es PLANO por pieza —no por diente ni
 * por milímetro—: la cuenta la hace `totalMecanizado`.
 */
export interface CodigoMecanizado {
  codigo: string
  descripcion: string
  precio: number
  moneda: 'ARS' | 'USD' | null
  precio_pesos: number | null
  a_cotizar: boolean
  herramienta: 'sierra' | 'fresa'
  operacion: 'buje' | 'agrandado'
}

/**
 * Uno de los nueve códigos de afilado de mecha, ya clasificado.
 *
 * `tipos` dice a qué tipos de mecha sirve, y en null quiere decir "a
 * cualquiera": en HSS toda la línea se afila al mismo precio. `dientes` sólo
 * viene en las integrales, que es donde el número de filos cambia el importe.
 *
 * `precio_pesos` es POR MECHA, no por filo ni por milímetro.
 */
export interface CodigoAfiladoMecha {
  codigo: string
  descripcion: string
  precio: number
  moneda: 'ARS' | 'USD' | null
  precio_pesos: number | null
  a_cotizar: boolean
  material: MaterialMecha
  tipos: TipoMecha[] | null
  dientes: number | null
}

/**
 * Los nueve códigos de afilado de mecha.
 *
 * Están en la misma lista que los de cuchilla —el rubro se llama "Afil.Mechas
 * Insertos Cuchillas"— y ninguno tiene rango de medida, así que el buscador por
 * diámetro no los encontraba nunca. Se piden por código.
 */
export async function codigosAfiladoMecha(): Promise<CodigoAfiladoMecha[]> {
  const { data, error } = await supabase.rpc('codigos_afilado_mecha')
  if (error) throw error
  return aplicarSinCargo((data ?? []) as CodigoAfiladoMecha[])
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

/**
 * Los cuatro códigos de mecanizado del agujero, con el precio ya en pesos.
 *
 * No se cotizan por medida: el código sale de la herramienta y la operación
 * (ver `codigoMecanizado` en compartido), y acá sólo se trae la fila con el
 * precio. Espejo de `codigosAfiladoMecha`.
 */
export async function codigosMecanizado(): Promise<CodigoMecanizado[]> {
  const { data, error } = await supabase.rpc('codigos_mecanizado')
  if (error) throw error
  return aplicarSinCargo((data ?? []) as CodigoMecanizado[])
}

/**
 * Cuántos artículos devuelve el buscador. Se exportan porque la pantalla los
 * necesita para saber si la lista quedó cortada y decirlo, en vez de mostrar el
 * tope y hacer creer que ésos son todos los que hay.
 *
 * Con familia se listan más: es un catálogo para mirar, no el resultado de
 * haber tipeado algo. Cuarenta y no doscientos porque la lista se dibuja entera
 * adentro del formulario; pasado ese punto lo que hace falta es escribir dos
 * letras, no seguir bajando.
 */
export const LISTA_POR_FAMILIA = 40
export const LISTA_SUELTA = 20
/**
 * Cuántos artículos trae la PRECARGA de una familia entera.
 *
 * Con familia elegida el buscador ya no consulta el servidor tecla por tecla:
 * baja la familia completa una vez y filtra en el teléfono, así todas las
 * opciones de un mismo código aparecen al instante. Cubre con MUCHO aire a la
 * familia más grande —fresa, 339 de venta (cabezal 232, sierra sin fin 191)—; el
 * tope real lo pone la RPC en 1000. Si una familia igual lo superara, el buscador
 * lo avisa y deja la salida por "toda la lista" (ver `BuscadorArticulo`), así que
 * nunca queda un artículo imposible de encontrar sin decirlo.
 */
export const FAMILIA_COMPLETA = 1000

/**
 * Artículos del catálogo que coinciden con el texto.
 *
 * `familia` la manda el desplegable de QUÉ SE VENDE: con ella la lista queda
 * limitada a esa familia y sin los códigos de servicio —en una venta no se
 * cotiza un afilado— y, sobre todo, se puede pedir con el texto vacío para
 * mostrar lo que hay apenas se elige la herramienta.
 *
 * Sin familia busca en TODO el catálogo, que es lo que hace el botón de "ver
 * toda la lista": hay artículos que se venden y están archivados en otra
 * familia —una muela, un bidón de resinol, un pote de soldadura— y filtrar sin
 * salida los volvería imposibles de cargar.
 */
export async function buscarArticulos(
  texto: string,
  familia?: string | null,
  limite?: number,
): Promise<ArticuloCatalogo[]> {
  const { data, error } = await supabase.rpc('buscar_articulos', {
    p_texto: texto,
    p_limite: limite ?? (familia ? LISTA_POR_FAMILIA : LISTA_SUELTA),
    p_familia: familia ?? null,
  })
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

/**
 * Los códigos de esa herramienta y servicio que NO se cotizan por medida.
 *
 * `medidasDisponibles` no sirve para esto: devuelve los que tienen rango y sólo
 * cae a los otros si no encontró ninguno. En el afilado de sierra hay 27 con
 * rango, así que nunca llegaba al del rascador —que no tiene, porque se cotiza
 * por largo— y el renglón quedaba con "sin código de rascador" sobre un
 * catálogo que lo tiene cargado.
 */
export async function codigosSinRango(
  herramienta: Herramienta,
  servicio?: TipoServicio,
): Promise<CodigoComputo[]> {
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
    /**
     * De qué herramienta es el código: primero lo que diga la columna, y si no
     * dice nada, la familia.
     *
     * Antes exigía la familia SIEMPRE, y `herramienta_sugerida` sólo servía
     * para achicar adentro de ella. El problema es que hay códigos que viven en
     * una familia y son de otra herramienta: los seis del afilado de CUCHILLA
     * están cargados con familia `mecha` porque vienen de esa lista de precios
     * —el rubro se llama "Afil.Mechas Insertos Cuchillas"— y con la familia
     * obligatoria no había forma de que aparecieran del lado de la cuchilla.
     *
     * Resultado: la lista "¿Qué códigos hay para CUCHILLAS?" no tenía UN SOLO
     * servicio. Le ofrecía al vendedor los 143 productos de la familia, y así
     * terminó una nota real con el código de un CABEZAL en el renglón.
     *
     * El cambio es quirúrgico y se puede comprobar: las otras seis herramientas
     * devuelven exactamente lo mismo que antes, porque todos sus códigos
     * marcados ya estaban dentro de su propia familia. La única que gana filas
     * es la cuchilla, y gana justo esos seis.
     *
     * Los que están a cotizar no se esconden: escondidos, la medida "no daba
     * ningún código" y el vendedor no tenía forma de saber que el código
     * existía y que lo único que faltaba era el importe.
     */
    .or(
      `herramienta_sugerida.eq.${herramienta},` +
        `and(familia.eq.${FAMILIA_CATALOGO[herramienta]},herramienta_sugerida.is.null)`,
    )

  consulta = conRango
    ? // Con rango la lista se lee por medida: es la respuesta a "¿y qué medidas
      // hay?", y ordenarla por otra cosa la vuelve ilegible.
      consulta.not('rango_min', 'is', null).order('rango_min', { ascending: true })
    : /**
       * Sin rango, primero los que NOMBRAN el trabajo y la herramienta.
       *
       * El filtro de arriba ya dejó pasar sólo los que coinciden o los que no
       * dicen nada, así que "no es nulo" significa "es de este trabajo sobre
       * esta herramienta", y `nullsFirst: false` los sube.
       *
       * Sin esto la lista salía por código y el primero era el 6005 —"AGREGADO
       * RASCADOR CORTO 45mm", $ 92.153,60—. Importa porque ésta es la lista de
       * respaldo de `resolverCodigoDeItem` cuando la medida no cae en ningún
       * rango: se proponía ese código, con ese precio, como si fuera el
       * rectificado de la sierra.
       */
      consulta
        .is('rango_min', null)
        .order('servicio_sugerido', { ascending: true, nullsFirst: false })
        .order('herramienta_sugerida', { ascending: true, nullsFirst: false })
        .order('codigo', { ascending: true })
        .limit(60)

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

  const porMedida = await buscarCodigoComputo({
    herramienta: item.herramienta,
    medida,
    dimension,
    servicio,
  })
  if (porMedida.length > 0 || servicio !== 'rectificado') return porMedida

  /**
   * El rectificado no se cotiza por medida.
   *
   * Medido contra el catálogo: de 55 códigos de afilado, 27 tienen rango de
   * ancho de corte; de rectificado hay UNO solo —8025, RECTIFICADO DE LATERAL
   * S.C.— y no tiene rango ninguno. Buscarlo por medida no devuelve nada y
   * nunca va a devolver nada.
   *
   * Sin este respaldo, contestar "sí, repararlos" dejaba el renglón sin código
   * y sin precio, con el vendedor mirando "no hay código para esa medida" sobre
   * una medida que está perfecta.
   *
   * Va sólo para el rectificado y no para todos: en el afilado, que sí se
   * cotiza por rango, una medida que no cae en ninguno es un dato para revisar
   * —y la pantalla lo dice—, no algo para tapar con un código cualquiera.
   */
  return medidasDisponibles(item.herramienta, servicio)
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
  /** La parada del rol de visita desde la que se generó, si fue desde una. */
  paradaId?: string | null
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
      // A qué sucursal del cliente va el pedido (null = la principal o sin elegir).
      direccion_id: enc.direccion_id,
      zona: enc.zona || null,
      datos_cliente: enc.datos_cliente || null,
      datos_cliente_origen: enc.datos_cliente_origen,
      // Con los renglones DE ESTA nota, no con todos los de la carga: cuando
      // se parte en dos comprobantes, cada uno anuncia lo suyo.
      descripcion_herramienta:
        descripcionGeneralDeLaNota(enc.descripcion_herramienta, g.items) || null,
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
      parada_id: datos.paradaId ?? null,
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

  /**
   * Dónde estaba el vendedor al emitir la nota.
   *
   * Va después de crear y no adentro de `crear_notas_pedido` por dos motivos.
   * Uno: leer el GPS puede tardar, y una nota cargada no puede quedarse sin
   * mandar esperando un satélite. Dos: si esto falla —sin señal, permiso
   * denegado, adentro de un galpón— la nota TIENE que existir igual. El dato es
   * para saber dónde se hizo, no un requisito para hacerla.
   *
   * Por eso todo el bloque está tragado a propósito: nunca puede voltear una
   * nota que el servidor ya aceptó.
   */
  void (async () => {
    try {
      const pos = await ubicacionActual()
      await supabase.from('notas_pedido_ubicacion').insert(
        filas.map((f) => ({
          nota_id: f.nota_id,
          lat: pos.lat,
          lng: pos.lng,
          precision_m: pos.precision,
        })),
      )
    } catch {
      // Sin ubicación la nota queda igual; el veredicto dirá "sin dato".
    }
  })()

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
// Corregir una nota que todavía no se imprimió
//
// El corte es la impresión, no el tiempo: mientras la nota no haya salido en
// papel, lo que dice todavía no llegó a nadie y equivocarse de cliente o de
// medida se arregla. Una vez impresa es un comprobante que la fábrica tiene en
// la mano, y ahí ya no.
//
// La regla vive en las políticas de la tabla —sólo `pendiente` y
// `pendiente_cliente`—; acá sólo se traduce entre las filas de la base y el
// formulario, que son dos formas distintas de escribir lo mismo.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Trae una nota y la devuelve como estaba en el formulario.
 *
 * Lo único que no vuelve son las tres respuestas del afilado de cuchillas
 * —plana o de dorso, HSS o metal duro, afilar o perfilar—: no se guardan
 * porque su único efecto es elegir el código, y el código sí vuelve. El
 * renglón queda completo y cotizado igual.
 */
export async function notaParaCorregir(id: string): Promise<BorradorNota> {
  const nota = (await obtenerNota(id)) as Record<string, any>

  const zonaCodigo = comoCadena(nota.zona)
  // El código de zona no es único —el 121 está dos veces— así que se toma la
  // primera. El selector necesita un id; lo que se imprime es el código, que
  // en las dos es el mismo.
  const zona = ZONAS.find((z) => z.codigo === zonaCodigo)

  const todas: string[] = Array.isArray(nota.observaciones) ? nota.observaciones : []

  const filas: Array<Record<string, unknown>> = Array.isArray(nota.items) ? nota.items : []
  const items = filas
    .slice()
    .sort((a, b) => Number(a.orden ?? 0) - Number(b.orden ?? 0))
    .map(itemDeFila)

  return {
    notaId: id,
    numero: nota.numero ?? null,
    estado: nota.estado as EstadoNotaPedido,
    encabezado: {
      ...ENCABEZADO_VACIO,
      cliente_id: nota.cliente_id ?? null,
      cliente_codigo: comoCadena(nota.cliente_codigo),
      cliente_nombre: comoCadena(nota.cliente_nombre),
      cliente_cuit: comoCadena(nota.cliente_cuit),
      direccion_id: nota.direccion_id ?? null,
      vendedor: comoCadena(nota.vendedor?.nombre_completo),
      vendedor_numero: comoCadena(nota.vendedor_numero),
      zona: zonaCodigo,
      zona_id: zona?.id ?? '',
      datos_cliente: comoCadena(nota.datos_cliente),
      datos_cliente_origen: nota.datos_cliente_origen === 'voz' ? 'voz' : 'texto',
      // Sin lo que le pega la app al guardar —la línea del servicio y los
      // avisos de agujero—: si volvieran al campo como texto del vendedor, al
      // guardar se agregarían de nuevo y cada corrección dejaría una línea más.
      descripcion_herramienta: sinLineaDeServicio(
        sinAvisosDeAgujero(nota.descripcion_herramienta),
      ),
      descripcion_herramienta_origen:
        nota.descripcion_herramienta_origen === 'voz' ? 'voz' : 'texto',
      cliente_nuevo: false,
      cliente_provisorio: nota.estado === 'pendiente_cliente' && !!nota.cliente_id,
    },
    servicios: Array.isArray(nota.servicios) ? (nota.servicios as TipoServicio[]) : [],
    tipoNota: (nota.tipo_nota as TipoNotaPedido | null) ?? null,
    fechaEntrega: nota.fecha_entrega ?? null,
    condicionVenta: (nota.condicion_venta as CondicionVenta | null) ?? null,
    condicionDetalle: comoCadena(nota.condicion_venta_detalle),
    observaciones: todas.filter((o) => !esObservacionDelSistema(o)),
    observacionesDelSistema: todas.filter(esObservacionDelSistema),
    items,
    tipoCambio: comoTexto(nota.tipo_cambio),
    cotizacionFecha: nota.cotizacion_fecha ?? null,
  }
}

export interface DatosCorreccionNota extends DatosNuevaNota {
  notaId: string
  /** Las que escribió el servidor, para devolverlas tal cual. */
  observacionesDelSistema?: string[]
}

/**
 * Guarda la corrección de una nota que todavía no se imprimió.
 *
 * **Una nota es un comprobante y un comprobante no se parte al medio.** Si la
 * corrección mezcla cosas que se facturan por separado —un afilado y una venta,
 * una sierra sin fin— eso serían dos notas y esta ya tiene un número asignado.
 * Se avisa y no se guarda nada, que es mejor que guardar la mitad.
 */
export async function corregirNotaPedido(datos: DatosCorreccionNota): Promise<void> {
  const grupos = agruparParaNotas(datos.items, datos.tipoCambio)
  if (grupos.length === 0) throw new Error('La nota necesita al menos un renglón')
  if (grupos.length > 1) {
    throw new Error(
      'Lo que quedó cargado tendría que salir en dos notas distintas (el afilado y la venta no van en el mismo comprobante). Sacá de esta nota lo que no corresponda y cargalo aparte.',
    )
  }

  const g = grupos[0]
  const enc = datos.encabezado

  const descripcionGeneral = descripcionGeneralDeLaNota(
    enc.descripcion_herramienta,
    datos.items,
  )

  const observaciones = [
    ...(datos.observaciones ?? []).filter((o) => o.trim()),
    ...(datos.observacionesDelSistema ?? []),
  ]

  const { error } = await supabase.rpc('actualizar_nota_pedido', {
    p_nota_id: datos.notaId,
    p_nota: {
      cliente_id: enc.cliente_id,
      cliente_codigo: enc.cliente_codigo || null,
      cliente_nombre: enc.cliente_nombre,
      cliente_cuit: enc.cliente_cuit || null,
      // A qué sucursal del cliente va el pedido (null = la principal o sin elegir).
      direccion_id: enc.direccion_id,
      zona: enc.zona || null,
      datos_cliente: enc.datos_cliente || null,
      datos_cliente_origen: enc.datos_cliente_origen,
      descripcion_herramienta: descripcionGeneral || null,
      descripcion_herramienta_origen: enc.descripcion_herramienta_origen,
      vendedor_numero: enc.vendedor_numero.trim() || null,
      servicios: g.servicios,
      tipo_nota: datos.tipoNota,
      fecha_entrega: datos.fechaEntrega,
      tipo_cambio: g.llevaTipoDeCambio || g.tieneDolares ? datos.tipoCambio : null,
      cotizacion_fecha: g.llevaTipoDeCambio || g.tieneDolares ? datos.cotizacionFecha : null,
      total: g.total || null,
      observaciones,
      condicion_venta: datos.condicionVenta,
      condicion_venta_detalle: CONDICIONES_CON_DETALLE.includes(datos.condicionVenta)
        ? (datos.condicionVentaDetalle ?? '').trim()
        : null,
    },
    p_items: g.items.map((i, orden) => filaDeItem(i, orden + 1)),
  })

  if (error) throw error
}

// ─────────────────────────────────────────────────────────────────────────────
// Consulta
// ─────────────────────────────────────────────────────────────────────────────

export interface NotaResumen {
  id: string
  numero: number | null
  /**
   * El número de vendedor de la nota.
   *
   * No es un dato decorativo de la lista: el número de nota lo lleva adelante
   * —`02-0081`— así que sin esto la lista escribiría un número distinto del
   * que dice la hoja impresa. Ver `numeroDeNotaImpreso`.
   */
  vendedor_numero: string | null
  tipo_nota: TipoNotaPedido | null
  estado: string
  cliente_codigo: string | null
  cliente_nombre: string
  total: number | null
  creado_en: string
  servicios: TipoServicio[]
  /** Cuándo salió por la impresora. Null en las que siguen pendientes. */
  impresa_en?: string | null
}

const COLUMNAS_RESUMEN =
  'id, numero, vendedor_numero, tipo_nota, estado, cliente_codigo, cliente_nombre, total, creado_en, servicios, impresa_en'

export async function notasPendientes(): Promise<NotaResumen[]> {
  // Sólo las del usuario logueado. La RLS deja ver todo a quien `puede_ver_todo()`
  // (admin, supervisor, administración), así que sin este filtro un admin vería
  // —y al "imprimir todas" sellaría— las notas pendientes de otros vendedores.
  // Estas pantallas dicen "tus notas": la oficina gestiona lo de todos desde el panel.
  const { data: sesion } = await supabase.auth.getSession()
  const vendedorId = sesion.session?.user.id
  if (!vendedorId) throw new Error('No hay sesión')

  const { data, error } = await supabase
    .from('notas_pedido')
    .select(COLUMNAS_RESUMEN)
    .eq('vendedor_id', vendedorId)
    .in('estado', ESTADOS_EDITABLES)
    .order('creado_en', { ascending: false })

  if (error) throw error
  return (data ?? []) as NotaResumen[]
}

/**
 * Las que ya salieron en papel.
 *
 * Van en su propia lista y no se pueden corregir: la fábrica ya tiene ese
 * comprobante en la mano, y cambiarlo por atrás dejaría dos versiones de la
 * misma nota dando vueltas. Se puede mirar y volver a imprimir.
 *
 * Se traen las últimas cien: es una lista para buscar la de esta semana, no un
 * archivo histórico. Para eso está HISTORIAL DE NOTAS, que va por fecha.
 */
export async function notasImpresas(): Promise<NotaResumen[]> {
  // Sólo las propias, por lo mismo que `notasPendientes`: sin el filtro, la lista
  // de un admin se llena de notas ajenas (la RLS se las deja ver).
  const { data: sesion } = await supabase.auth.getSession()
  const vendedorId = sesion.session?.user.id
  if (!vendedorId) throw new Error('No hay sesión')

  const { data, error } = await supabase
    .from('notas_pedido')
    .select(COLUMNAS_RESUMEN)
    .eq('vendedor_id', vendedorId)
    .in('estado', ['impresa', 'entregada'])
    .order('creado_en', { ascending: false })
    .limit(100)

  if (error) throw error
  return (data ?? []) as NotaResumen[]
}

export interface DiaNotas {
  fecha: string
  cantidad: number
  detalle: Array<{
    nota_id: string
    numero: number | null
    /** Va adelante del número de nota. Lo agrega `historial_notas_pedido`. */
    vendedor_numero: string | null
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

  // Si estas notas tenían una orden viva en la cola de la oficina, se cancela:
  // ya salieron en papel acá, y si no la PC de la oficina las imprimía de nuevo
  // (doble juego). La RLS `ordenes_impresion_cancelar_propia` sólo deja cancelar
  // las pendientes propias. Best-effort: que fallar la cancelación NO rompa el
  // sellado, que es lo que importa.
  try {
    await supabase
      .from('ordenes_impresion')
      .update({ estado: 'cancelada' })
      .in('nota_id', ids)
      .eq('estado', 'pendiente')
  } catch {
    // La orden queda viva; la doble impresión es un riesgo menor que trabar el
    // sellado. La oficina puede descartarla desde la Cola de impresión.
  }
}

/**
 * Manda la nota a la impresora de la oficina en vez de imprimirla acá.
 *
 * ─── Para qué existe ─────────────────────────────────────────────────────────
 *
 * Imprimir desde el teléfono sale distinto en cada teléfono: el PDF lo arma un
 * WebView al que Android le aplica el ajuste de letra del equipo, así que la
 * misma nota entra en una hoja o se desborda según cómo tenga la pantalla el
 * vendedor. Y además hace falta que haya una impresora cerca que conteste.
 *
 * Encolando, el papel lo saca siempre la misma máquina. El vendedor toca el
 * botón en la calle y la nota lo está esperando impresa en la oficina.
 *
 * La orden es un PEDIDO: la nota no se sella acá. Se sella cuando la PC
 * confirma que el papel salió —lo hace `resolver_orden_impresion`—, así una
 * impresora trabada no deja la nota marcada como impresa y sin poder corregir.
 *
 * Si ya hay una orden esperando para esta nota, la base la rechaza por el
 * índice único y se contesta que ya estaba encolada. Tocar dos veces —porque no
 * pasó nada visible— no saca dos juegos de papel.
 */
export async function encolarImpresion(
  notaId: string,
  opciones?: { conRolDeVisita?: boolean },
): Promise<{ encolada: boolean; motivo?: string }> {
  const { data: sesion } = await supabase.auth.getSession()
  const quien = sesion.session?.user.id
  if (!quien) return { encolada: false, motivo: 'No hay sesión abierta.' }

  // Una nota anulada no se encola: la pantalla ya oculta el botón, pero acá se
  // frena también la carrera —Administración la anula entre que se abrió el
  // detalle y se tocó "mandar a la oficina"— y cualquier otro llamador.
  const { data: filaNota } = await supabase
    .from('notas_pedido')
    .select('estado')
    .eq('id', notaId)
    .single()
  if (filaNota?.estado === 'anulada') {
    return { encolada: false, motivo: 'La nota fue anulada por Administración.' }
  }

  const { error } = await supabase.from('ordenes_impresion').insert({
    nota_id: notaId,
    pedida_por: quien,
    con_rol_de_visita: opciones?.conRolDeVisita === true,
  })

  if (!error) return { encolada: true }

  // 23505 es el índice único: ya hay una orden viva para esta nota.
  if (error.code === '23505') {
    return { encolada: false, motivo: 'Esta nota ya está en la cola de la oficina.' }
  }
  throw error
}

/**
 * Qué se vendió o se mandó a taller en una parada, a grandes rasgos.
 *
 * Devuelve frases cortas como "Venta de sierras" o "Afilado de fresas", que son
 * las que la observación de la visita usa para contar qué pasó sin obligar al
 * vendedor a redactarlo.
 *
 * Agrupa por servicio y herramienta a propósito: la observación del rol de
 * visita se lee de un vistazo, y "afilado de 4 sierras de 96 dientes, 2 fresas
 * de 8 filos y 1 mecha pasante" no es un vistazo. El detalle fino ya está en la
 * nota de pedido, que es donde corresponde buscarlo.
 */
export async function resumenDeNotasDeLaParada(paradaId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('notas_pedido')
    .select('items:notas_pedido_items(servicio, herramienta, cantidad, detalle)')
    .eq('parada_id', paradaId)

  if (error) throw error

  // Todos los renglones de todas las notas hechas DESDE esta parada, en orden.
  // El formato ("[servicio] [herramienta]" para los servicios, con cantidad y
  // medidas en la venta) vive en compartido, para probarlo aparte y para que
  // diga lo mismo en cualquier pantalla que lo use.
  const filas = (data ?? []) as Array<{ items: RenglonParaResumen[] | null }>
  const renglones = filas.flatMap((n) => n.items ?? [])
  return resumenDeRenglonesDeVisita(renglones)
}

/** Un precio acordado con el cliente, que pisa el de la lista. */
export interface PrecioEspecial {
  codigo: string
  precio: number
  moneda: string
}

/**
 * Los precios que este cliente tiene acordados para estos códigos.
 *
 * Se preguntan sólo los códigos que el renglón tiene en la mano, no la tabla
 * entera: son datos comerciales sensibles y no hay motivo para que el teléfono
 * se baje lo que le cobramos a los demás.
 *
 * Devuelve vacío cuando no hay cliente todavía —una nota se empieza a cargar
 * antes de elegirlo— o cuando ese cliente no tiene ninguno, que es el caso de
 * casi todos.
 */
export async function preciosEspecialesDe(
  clienteId: string | null,
  codigos: string[],
): Promise<PrecioEspecial[]> {
  if (!clienteId || codigos.length === 0) return []

  const { data, error } = await supabase.rpc('precios_especiales_de', {
    p_cliente_id: clienteId,
    p_codigos: codigos,
  })
  if (error) throw error
  return (data ?? []) as PrecioEspecial[]
}
