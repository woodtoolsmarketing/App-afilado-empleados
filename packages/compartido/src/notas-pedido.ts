/**
 * Notas de pedido: formularios, catálogos y validaciones.
 *
 * Cada tipo de servicio pide datos distintos, y dentro del afilado cada
 * herramienta pide los suyos. En vez de una tabla de cuarenta columnas casi
 * siempre vacías, el renglón tiene los campos comunes tipados y los propios de
 * cada herramienta en `detalle` (jsonb en la base).
 *
 * Qué campos son obligatorios lo decide `CAMPOS_POR_HERRAMIENTA`, que es la
 * misma fuente que usa el formulario para saber qué dibujar. Así no puede pasar
 * que la pantalla muestre un campo que el validador ignora, ni al revés.
 */

import { aPesos, PRECIO_SIN_CARGO, type Moneda } from './catalogo'
import {
  ETIQUETA_TIPO_SERVICIO,
  type ResultadoValidacion,
  type TipoNotaPedido,
  type TipoServicio,
} from './tipos'
import { CODIGO_POSTAL } from './validaciones'

// ─────────────────────────────────────────────────────────────────────────────
// Herramientas
// ─────────────────────────────────────────────────────────────────────────────

export type Herramienta =
  | 'sierra'
  | 'fresa'
  | 'cabezal'
  | 'incisor'
  | 'sierra_sin_fin'
  | 'mecha'
  | 'cuchilla'

export const ETIQUETA_HERRAMIENTA: Record<Herramienta, string> = {
  sierra: 'SIERRAS',
  fresa: 'FRESAS',
  cabezal: 'CABEZALES',
  incisor: 'INCISORES',
  sierra_sin_fin: 'SIERRA SIN FIN',
  mecha: 'MECHAS',
  cuchilla: 'CUCHILLAS',
}

/** Singular, para los rótulos "CANTIDAD DE [HERRAMIENTA]". */
export const SINGULAR_HERRAMIENTA: Record<Herramienta, string> = {
  sierra: 'SIERRAS',
  fresa: 'FRESAS',
  cabezal: 'CABEZALES',
  incisor: 'INCISORES',
  sierra_sin_fin: 'SIERRAS',
  mecha: 'MECHAS',
  cuchilla: 'CUCHILLAS',
}

/**
 * Rótulo del botón que repite el sub-formulario para cargar otra herramienta
 * igual. Sale del mockup de mechas ("SUMAR OTRA MECHA") y se extiende al resto.
 *
 * Está escrito entero en vez de armarse con un artículo y un sustantivo: son
 * siete casos fijos y resolver el género con código sólo agrega una tabla más.
 */
export const SUMAR_OTRA: Record<Herramienta, string> = {
  sierra: 'SUMAR OTRA SIERRA',
  fresa: 'SUMAR OTRA FRESA',
  cabezal: 'SUMAR OTRO CABEZAL',
  incisor: 'SUMAR OTRO INCISOR',
  sierra_sin_fin: 'SUMAR OTRA SIERRA SIN FIN',
  mecha: 'SUMAR OTRA MECHA',
  cuchilla: 'SUMAR OTRA CUCHILLA',
}

/**
 * Cómo se llama la herramienta en la descripción del renglón.
 *
 * Es lo que la fábrica lee para saber qué le llegó, y lo escribe siempre igual:
 * "S.C." una sierra circular, "SSF" una sierra sin fin. Se completa sola al
 * elegir la herramienta —el vendedor la puede cambiar— porque tipearlo a mano
 * en cada renglón terminaba en "sierra", "Sierra", "s.c." y "SC" para la misma
 * cosa.
 */
export const DESCRIPCION_SERVICIO: Record<Herramienta, string> = {
  sierra: 'S.C.',
  fresa: 'Fresa',
  cabezal: 'Cabezal',
  incisor: 'Incisor',
  sierra_sin_fin: 'SSF',
  mecha: 'Mecha',
  cuchilla: 'Cuchilla',
}

/** Lo mismo, para cuando se vende: la herramienta sale nueva. */
export const DESCRIPCION_VENTA: Record<Herramienta, string> = {
  sierra: 'SC nueva',
  fresa: 'Fresa nueva',
  cabezal: 'Cabezal nuevo',
  incisor: 'Incisor nuevo',
  sierra_sin_fin: 'SSF nueva',
  mecha: 'Mecha nueva',
  cuchilla: 'Cuchilla nueva',
}

/** La descripción que corresponde a esa herramienta en ese servicio. */
export function descripcionSugerida(
  herramienta: Herramienta | null,
  servicio: TipoServicio,
): string {
  if (!herramienta) return ''
  return servicio === 'venta'
    ? DESCRIPCION_VENTA[herramienta]
    : DESCRIPCION_SERVICIO[herramienta]
}

/**
 * ¿La descripción es una de las que ponemos solos?
 *
 * Sirve para saber si se puede reemplazar al cambiar de herramienta: lo que
 * escribió el vendedor no se pisa nunca.
 */
/**
 * Descripciones que pusimos solos en versiones anteriores.
 *
 * Sin esto, una nota a medio cargar cuando se actualiza la app se queda con la
 * descripción vieja para siempre: `esDescripcionSugerida` no la reconocería
 * como nuestra y la trataría como algo que escribió el vendedor.
 */
const DESCRIPCIONES_ANTERIORES = ['S.C. nueva', 'S.C.']

export function esDescripcionSugerida(texto: string): boolean {
  const t = texto.trim()
  if (!t) return true
  return (
    Object.values(DESCRIPCION_SERVICIO).includes(t) ||
    Object.values(DESCRIPCION_VENTA).includes(t) ||
    DESCRIPCIONES_ANTERIORES.includes(t)
  )
}

/** Familia del catálogo de precios contra la que se busca el código de cómputo. */
export const FAMILIA_CATALOGO: Record<Herramienta, string> = {
  sierra: 'afilado_general',
  fresa: 'afilado_general',
  cabezal: 'afilado_general',
  incisor: 'afilado_general',
  sierra_sin_fin: 'sierra_sin_fin',
  mecha: 'mecha',
  cuchilla: 'cuchilla',
}

/**
 * Familia del catálogo donde está el PRODUCTO que se vende.
 *
 * No es la misma que `FAMILIA_CATALOGO`, y la diferencia no es un detalle: al
 * afilar una sierra el precio sale de `afilado_general` —el trabajo—, y al
 * venderla sale de `sierra` —la pieza—. Con la familia equivocada, elegir
 * "SIERRA" en QUÉ SE VENDE le ofrecería al vendedor los códigos de afilado.
 *
 * El incisor no está: no se vende suelto, y por eso tampoco figura en
 * `HERRAMIENTAS_POR_SERVICIO.venta`. Queda igual para que el mapa cubra el tipo
 * entero y nadie tenga que acordarse de este caso al agregar una herramienta.
 */
export const FAMILIA_PRODUCTO: Record<Herramienta, string> = {
  sierra: 'sierra',
  fresa: 'fresa',
  cabezal: 'cabezal',
  incisor: 'sierra',
  sierra_sin_fin: 'sierra_sin_fin',
  mecha: 'mecha',
  cuchilla: 'cuchilla',
}

/** Qué herramientas se ofrecen según el servicio elegido. */
export const HERRAMIENTAS_POR_SERVICIO: Record<TipoServicio, Herramienta[]> = {
  // La venta también pide herramienta, y no por prolijidad: de ella depende en
  // qué nota de pedido cae el artículo. Ver `grupoDeFacturacion`.
  venta: ['sierra', 'fresa', 'cabezal', 'sierra_sin_fin', 'mecha', 'cuchilla'],
  afilado: ['sierra', 'fresa', 'cabezal', 'sierra_sin_fin', 'mecha', 'cuchilla'],
  reparacion: ['sierra', 'fresa', 'cabezal'],
  rectificado: ['sierra', 'fresa', 'cabezal'],
  // Hermanado siempre es sobre incisores: no hay nada que elegir.
  hermanado: ['incisor'],
  // Rebaje sólo aplica a cuchillas.
  rebaje: ['cuchilla'],
  /**
   * El reclamo es sobre un trabajo anterior, así que puede recaer sobre
   * cualquier herramienta que se afile o se venda.
   *
   * Estaba en `[]`, y con la lista vacía el renglón quedaba sin desplegable de
   * herramienta —no se dibujaba ninguno— pero el validador la seguía exigiendo:
   * "Elegí la herramienta", sobre un campo que no existía en la pantalla. Con
   * RECLAMO tildado la nota no se podía crear de ninguna manera.
   */
  reclamo: ['sierra', 'fresa', 'cabezal', 'sierra_sin_fin', 'mecha', 'cuchilla'],
}

// ─────────────────────────────────────────────────────────────────────────────
// Tipos de mecha
// ─────────────────────────────────────────────────────────────────────────────

export type TipoMecha =
  | 'pasante'
  | 'ciega'
  | 'barreno'
  | 'bisagra'
  | 'compresion'
  | 'caja_cerradura'
  | 'integral_widia'
  | 'practiwall'
  | 'plegado'

export const ETIQUETA_TIPO_MECHA: Record<TipoMecha, string> = {
  pasante: 'PASANTE',
  ciega: 'CIEGA',
  barreno: 'BARRENO',
  bisagra: 'BISAGRA',
  compresion: 'COMPRESIÓN',
  caja_cerradura: 'CAJA DE CERRADURA',
  integral_widia: 'INTEGRAL DE WIDIA',
  practiwall: 'PRACTIWALL',
  plegado: 'PLEGADO',
}

/**
 * Sólo estas tres tienen mano: preguntar "¿derecha o izquierda?" en una barreno
 * o una practiwall no significa nada y sólo agrega un campo que el vendedor
 * tiene que completar al pedo.
 */
export const MECHAS_CON_MANO: TipoMecha[] = ['pasante', 'ciega', 'bisagra']

export type ManoMecha = 'derecha' | 'izquierda'

// ─────────────────────────────────────────────────────────────────────────────
// Campos de cada herramienta
// ─────────────────────────────────────────────────────────────────────────────

export type CampoItem =
  | 'cantidad'
  | 'diametro_exterior'
  | 'diametro_interior'
  | 'diametro'
  | 'ancho_corte'
  | 'largo'
  | 'ancho'
  | 'largo_util'
  | 'espesor'
  | 'paso'
  | 'descripcion'
  | 'cantidad_dientes'
  | 'tipo_mecha'
  | 'mano'
  | 'dientes_rotos'
  | 'dientes_rotos_cantidad'
  | 'reparar_dientes'
  | 'rascadores'
  | 'afilado_reparacion'
  | 'codigos_computo'
  | 'precio_por_diente'
  | 'precio_total'

/**
 * Campos que pide cada herramienta, en el orden en que aparecen en pantalla.
 * Sale de los mockups, con una sola alteración deliberada:
 *
 * **`codigos_computo` va inmediatamente después de la medida que lo determina.**
 * En los mockups estaba más abajo, junto a los precios, y en la práctica el
 * vendedor cargaba el ancho de corte y tenía que seguir bajando por descripción
 * y dientes para recién ahí ver los códigos que esa medida había disparado. El
 * ancho de corte es lo único que decide el código: la respuesta tiene que
 * aparecer donde se hace la pregunta.
 *
 * Qué medida manda en cada herramienta está en `MEDIDA_PARA_CODIGO`, y los dos
 * mapas tienen que seguir coincidiendo.
 */
export const CAMPOS_POR_HERRAMIENTA: Record<Herramienta, CampoItem[]> = {
  sierra: [
    'cantidad', 'diametro_exterior', 'ancho_corte', 'codigos_computo',
    'diametro_interior', 'descripcion', 'cantidad_dientes', 'rascadores',
    'dientes_rotos', 'dientes_rotos_cantidad', 'reparar_dientes',
    'precio_por_diente', 'precio_total',
  ],
  fresa: [
    'cantidad', 'diametro_exterior', 'ancho_corte', 'codigos_computo',
    'diametro_interior', 'descripcion', 'cantidad_dientes',
    'dientes_rotos', 'dientes_rotos_cantidad', 'reparar_dientes',
    'precio_por_diente', 'precio_total',
  ],
  cabezal: [
    'cantidad', 'diametro_exterior', 'ancho_corte', 'codigos_computo',
    'diametro_interior', 'descripcion', 'cantidad_dientes',
    'dientes_rotos', 'dientes_rotos_cantidad', 'reparar_dientes',
    'precio_por_diente', 'precio_total',
  ],
  incisor: [
    'cantidad', 'diametro_exterior', 'ancho_corte', 'codigos_computo',
    'diametro_interior', 'descripcion', 'cantidad_dientes', 'afilado_reparacion',
    'precio_por_diente', 'precio_total',
  ],
  sierra_sin_fin: [
    'cantidad', 'ancho', 'codigos_computo', 'paso', 'descripcion', 'espesor',
    'precio_total',
  ],
  mecha: [
    'tipo_mecha', 'cantidad', 'diametro', 'codigos_computo', 'largo_util',
    'mano', 'descripcion', 'precio_total',
  ],
  cuchilla: [
    'cantidad', 'largo', 'ancho', 'codigos_computo', 'descripcion', 'espesor',
    'precio_total',
  ],
}

/**
 * En qué máquina trabaja la herramienta.
 *
 * La lista sale de la que usa la página pública para clasificar el catálogo
 * (`ruta-productos/JS/filtros.js`), abierta en máquinas sueltas: allá una regla
 * devuelve "Tupí, machimbradora o moldurera" porque describe a qué sirve un
 * artículo, y acá hay que elegir UNA, que es la que el cliente tiene en el
 * taller.
 */
export const MAQUINAS: string[] = [
  'Escuadradora',
  'Mesa de banco',
  'Seccionadora',
  'Tupí',
  'Machimbradora',
  'Moldurera',
  'Cepilladora',
  'Centro de perforado',
  'Agujereadora múltiple',
  'Barreno',
  'Pantógrafo o CNC',
  'Ingletadora',
  'Máquina de mano',
  'Trituradora',
  'Máquina múltiple',
]

/**
 * La máquina que se propone según la herramienta.
 *
 * Es el mismo criterio que el `switch (categoria)` con el que cierra
 * `maquinaDeProducto` en la página: cuando no se sabe el modelo exacto, la
 * familia de la herramienta ya dice cuál es la máquina habitual. El vendedor la
 * puede cambiar; la sierra sin fin no propone ninguna porque va en su propia
 * máquina y no hay nada que adivinar.
 */
export const MAQUINA_SUGERIDA: Record<Herramienta, string> = {
  sierra: 'Escuadradora',
  fresa: 'Tupí',
  cabezal: 'Machimbradora',
  incisor: 'Escuadradora',
  mecha: 'Centro de perforado',
  cuchilla: 'Cepilladora',
  sierra_sin_fin: '',
}

/**
 * Las máquinas donde puede ir cada herramienta.
 *
 * Sale de las mismas reglas de `maquinaDeProducto` en la página pública, leídas
 * al revés: si ninguna regla de sierras devuelve nunca un tupí, entonces una
 * sierra no va en un tupí y ofrecerlo es ofrecer un error. Antes el desplegable
 * mostraba las quince máquinas para cualquier herramienta, y una sierra de 300
 * con 96 dientes se podía mandar a una tupí sin que nada dijera nada.
 *
 * Cada lista abre en máquinas sueltas lo que allá es una frase: "Escuadradora,
 * mesa de banco o seccionadora horizontal" son tres opciones acá, porque el
 * cliente tiene una sola en el taller y hay que elegirla.
 *
 * Las de la sierra sin fin quedan todas: va en su propia máquina, que no está
 * en esta lista, así que no hay contra qué filtrar y esconder opciones sería
 * peor que mostrarlas.
 */
export const MAQUINAS_POR_HERRAMIENTA: Record<Herramienta, string[]> = {
  // Escuadradora / mesa de banco / seccionadora es el destino de casi todas.
  // Se suman la múltiple —ahí van las Franzoi y las S.C. de múltiple—, la
  // ingletadora y la máquina de mano, y la trituradora, que también usa discos.
  sierra: [
    'Escuadradora',
    'Mesa de banco',
    'Seccionadora',
    'Máquina múltiple',
    'Ingletadora',
    'Máquina de mano',
    'Trituradora',
  ],
  // El incisor es el disco chico que va DELANTE de la sierra principal, así que
  // vive en las mismas dos máquinas que la acompañan.
  incisor: ['Escuadradora', 'Seccionadora'],
  fresa: ['Tupí', 'Machimbradora', 'Moldurera', 'Pantógrafo o CNC', 'Ingletadora', 'Máquina de mano'],
  cabezal: ['Machimbradora', 'Moldurera', 'Cepilladora', 'Tupí'],
  cuchilla: ['Cepilladora', 'Moldurera', 'Machimbradora', 'Trituradora'],
  mecha: ['Centro de perforado', 'Agujereadora múltiple', 'Barreno', 'Pantógrafo o CNC'],
  sierra_sin_fin: MAQUINAS,
}

/**
 * Las máquinas que se le ofrecen a esta herramienta.
 *
 * Sin herramienta elegida todavía no hay con qué filtrar, y la lista completa
 * es la respuesta honesta.
 */
export function maquinasDeLaHerramienta(herramienta: Herramienta | ''): string[] {
  if (!herramienta) return MAQUINAS
  return MAQUINAS_POR_HERRAMIENTA[herramienta] ?? MAQUINAS
}

/** Contra qué medida se busca el código de cómputo en cada herramienta. */
export const MEDIDA_PARA_CODIGO: Record<Herramienta, CampoItem | null> = {
  sierra: 'ancho_corte',
  fresa: 'ancho_corte',
  cabezal: 'ancho_corte',
  incisor: 'ancho_corte',
  sierra_sin_fin: 'ancho',
  mecha: 'diametro',
  // El largo: es lo que multiplica el precio del afilado, que se cotiza
  // por cada 100 mm. El ancho no interviene en el importe.
  cuchilla: 'largo',
}

// ─────────────────────────────────────────────────────────────────────────────
// Condición de venta
//
// Va en su columna del talonario y hasta ahora salía siempre vacía: no había
// dónde cargarla. Es un dato de cobranza, así que se guarda como opción y no
// como texto libre —"ctdo", "contado", "CONTADO" son tres condiciones distintas
// para cualquier planilla— con un detalle aparte para los dos casos que lo
// necesitan.
// ─────────────────────────────────────────────────────────────────────────────

export type CondicionVenta =
  | 'contado'
  | 'transferencia'
  | 'link_de_pago'
  | 'cheque'
  | 'cuenta_corriente'
  | 'otro'

export const ETIQUETA_CONDICION_VENTA: Record<CondicionVenta, string> = {
  contado: 'Contado',
  transferencia: 'Transferencia bancaria',
  link_de_pago: 'Link de pago',
  cheque: 'Cheque',
  cuenta_corriente: 'Cuenta corriente',
  otro: 'Otro',
}

/** Las que piden algo más: el plazo del cheque y de la cuenta corriente, y el texto de "Otro". */
export const CONDICIONES_CON_DETALLE: CondicionVenta[] = ['cheque', 'cuenta_corriente', 'otro']

/** Las que llevan plazo de pago: un rango de días. */
export const CONDICIONES_CON_PLAZO: CondicionVenta[] = ['cheque', 'cuenta_corriente']

/** Tope de días. Sale de lo que se negocia en la calle. */
export const DIAS_CHEQUE_MAXIMO = 60

/**
 * Desde cuándo puede empezar el plazo, y hasta cuándo puede llegar.
 *
 * Dos listas cerradas y distintas a propósito: el "desde" arranca en 0 —hay
 * cheques que se cobran al día— y el "hasta" no, porque un plazo que termina el
 * mismo día en que empieza no es un plazo.
 */
export const PLAZO_DESDE_DIAS: number[] = [0, 15, 30]
export const PLAZO_HASTA_DIAS: number[] = [15, 30, 45, 60]

/** El plazo guardado, "15-45", partido en sus dos números. */
export function plazoDePago(detalle?: string | null): { desde: number; hasta: number } | null {
  const texto = String(detalle ?? '').trim()
  if (!texto) return null

  const rango = /^(\d{1,2})-(\d{1,2})$/.exec(texto)
  if (rango) {
    const desde = Number(rango[1])
    const hasta = Number(rango[2])
    return desde <= hasta ? { desde, hasta } : null
  }

  // Formato viejo: un número suelto de días de cheque. Se lee como "hasta".
  const suelto = /^(\d{1,2})$/.exec(texto)
  if (suelto) return { desde: 0, hasta: Number(suelto[1]) }

  return null
}

/**
 * Cómo se escribe la condición en la nota impresa.
 *
 * `Cheque de 15 a 45 días`, `Cuenta corriente de 0 a 30 días`,
 * `Otro: retira y paga en fábrica`, `Contado`.
 */
/**
 * Las mismas condiciones, escritas para una columna angosta.
 *
 * Sólo se usan al imprimir. La casilla "Condicion de Venta" del talonario mide
 * 18 % de la tabla y no envuelve —recorta con puntos suspensivos—, así que
 * "Cuenta corriente de 15 a 45 días" no entraba y lo que se perdía era el
 * plazo, que es todo lo que esa casilla tiene para decir. Son abreviaturas
 * corrientes en una factura; en la app se sigue leyendo el nombre completo.
 */
const ETIQUETA_CONDICION_COMPACTA: Partial<Record<CondicionVenta, string>> = {
  cuenta_corriente: 'Cta. cte.',
  transferencia: 'Transf. bancaria',
}

export function describirCondicionVenta(
  condicion: CondicionVenta | null,
  detalle?: string | null,
  opciones?: {
    /** Para el papel: nombres abreviados y el plazo como "15-45 días". */
    compacto?: boolean
  },
): string {
  if (!condicion) return ''
  const texto = String(detalle ?? '').trim()
  const compacto = opciones?.compacto === true

  if (condicion === 'otro') return texto || 'Otro'

  const nombre = compacto
    ? (ETIQUETA_CONDICION_COMPACTA[condicion] ?? ETIQUETA_CONDICION_VENTA[condicion])
    : ETIQUETA_CONDICION_VENTA[condicion]

  if (CONDICIONES_CON_PLAZO.includes(condicion)) {
    const plazo = plazoDePago(texto)
    if (!plazo) return nombre
    return compacto
      ? `${nombre} ${plazo.desde}-${plazo.hasta} días`
      : `${nombre} de ${plazo.desde} a ${plazo.hasta} días`
  }

  return nombre
}

// ─────────────────────────────────────────────────────────────────────────────
// Formularios
// ─────────────────────────────────────────────────────────────────────────────

/** Encabezado de la nota: los datos del cliente. */
/*
 * El IVA salió de la nota de pedido.
 *
 * Vivía acá: la situación del cliente, la alícuota, la excepción de Tierra
 * del Fuego y el cálculo del total con impuesto. El papel decía tres cosas
 * distintas según a quién se le emitiera —el consumidor final lo llevaba
 * sumado adentro sin decirlo, el exento no lo llevaba, y el responsable
 * inscripto veía el neto y el total uno debajo del otro—, y eso obligaba a
 * que una nota de pedido supiera de impuestos para poder imprimir un número.
 *
 * Ahora cotiza el trabajo y nada más: un SUBTOTAL, con los descuentos ya
 * aplicados. El impuesto es cosa de la factura, que sale de otro sistema.
 *
 * La columna `notas_pedido.situacion_iva` queda en la base con lo que se
 * cargó los dos días que esto estuvo activo. No se borra: son nueve notas
 * reales y el dato no le molesta a nadie donde está.
 */

export interface FormularioNotaEncabezado {
  cliente_id: string | null
  cliente_codigo: string
  cliente_nombre: string
  cliente_cuit: string
  vendedor: string
  /**
   * El número que va en "Vendedor Nº". Sale del perfil, pero se puede corregir:
   * hay altas viejas sin código cargado y el comprobante lo necesita igual.
   */
  vendedor_numero: string
  /** El código de zona, que es lo que se imprime en la nota ("107"). */
  zona: string
  /**
   * Cuál de las zonas del catálogo se eligió. No se guarda: existe porque el
   * código no es único —el 121 está dos veces— y el selector tiene que saber
   * cuál de las dos está marcada.
   */
  zona_id: string
  datos_cliente: string
  datos_cliente_origen: 'texto' | 'voz'
  descripcion_herramienta: string
  descripcion_herramienta_origen: 'texto' | 'voz'
  /** true cuando el vendedor tocó "¿Es nuevo cliente?". */
  cliente_nuevo: boolean
  /**
   * true cuando el cliente existe en la base pero todavía es provisorio.
   *
   * La nota igual queda sin número: un código automático `P-000123` no es un
   * código de cliente, y ponerlo en un comprobante sería peor que dejarlo en
   * blanco.
   */
  cliente_provisorio: boolean
  /**
   * La provincia del domicilio del cliente.
   *
   * No se imprime: la necesita el cálculo del IVA, porque "exento" sólo vale en
   * Tierra del Fuego. Sale de la dirección principal cuando el cliente se elige
   * del buscador, y de Google cuando se lo acaba de crear.
   */
  cliente_provincia: string
}

export const ENCABEZADO_VACIO: FormularioNotaEncabezado = {
  cliente_id: null,
  cliente_codigo: '',
  cliente_nombre: '',
  cliente_cuit: '',
  vendedor: '',
  vendedor_numero: '',
  zona: '',
  zona_id: '',
  datos_cliente: '',
  datos_cliente_origen: 'texto',
  descripcion_herramienta: '',
  descripcion_herramienta_origen: 'texto',
  cliente_nuevo: false,
  cliente_provisorio: false,
  cliente_provincia: '',
}

// ─────────────────────────────────────────────────────────────────────────────
// Alta de cliente nuevo desde la nota de pedido
// ─────────────────────────────────────────────────────────────────────────────

export interface FormularioClienteNuevo {
  razon_social: string
  documento: string
  direccion: string
  codigo_postal: string
  /** Varios: el formulario los agrega de a uno con el botón ⊕. */
  telefonos: string[]
  email: string
  nombre_fantasia: string
  lat: number | null
  lng: number | null
  google_place_id: string | null
  localidad: string | null
  provincia: string | null
}

export const CLIENTE_NUEVO_VACIO: FormularioClienteNuevo = {
  razon_social: '',
  documento: '',
  direccion: '',
  codigo_postal: '',
  telefonos: [''],
  email: '',
  nombre_fantasia: '',
  lat: null,
  lng: null,
  google_place_id: null,
  localidad: null,
  provincia: null,
}

export type CampoClienteNuevo =
  | 'razon_social'
  | 'documento'
  | 'direccion'
  | 'codigo_postal'
  | 'email'

/** 7 u 8 dígitos = DNI; 11 = CUIT. */
const SOLO_DIGITOS = /\D/g

export function validarClienteNuevo(
  form: FormularioClienteNuevo,
): ResultadoValidacion<CampoClienteNuevo> {
  const errores: Partial<Record<CampoClienteNuevo, string>> = {}

  const nombre = form.razon_social.trim()
  if (!nombre) errores.razon_social = 'Ingresá el nombre y apellido o la razón social'
  else if (nombre.length < 3) errores.razon_social = 'El nombre es demasiado corto'

  const doc = form.documento.replace(SOLO_DIGITOS, '')
  if (!doc) {
    errores.documento = 'Ingresá el DNI o el CUIT'
  } else if (doc.length !== 7 && doc.length !== 8 && doc.length !== 11) {
    // Es el error más común al tipear: conviene decir qué se esperaba.
    errores.documento = 'Un DNI tiene 7 u 8 dígitos y un CUIT 11'
  }

  if (!form.direccion.trim()) {
    errores.direccion = 'Ingresá la dirección del taller'
  } else if (form.lat === null || form.lng === null) {
    // Sin coordenadas el cliente sirve para la nota, pero no se lo puede meter
    // en un recorrido. Conviene resolverlo ahora y no cuando haga falta.
    errores.direccion = 'Elegí una dirección de la lista de sugerencias'
  }

  if (!form.codigo_postal.trim()) {
    errores.codigo_postal = 'Falta el código postal'
  } else if (!CODIGO_POSTAL.test(form.codigo_postal.trim())) {
    errores.codigo_postal = 'El código postal no parece válido (ej. 1704 o B1704ARQ)'
  }

  const mail = form.email.trim()
  if (mail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) {
    errores.email = 'El correo no tiene un formato válido'
  }

  return { valido: Object.keys(errores).length === 0, errores }
}

/**
 * De dónde viene la fresa que se vende.
 *
 * No es un dato descriptivo: decide en qué nota de pedido cae. Las importadas
 * se cotizan en dólares y van con el resto de la venta; las de producción
 * nacional se facturan en pesos y llevan nota propia.
 */
// ─────────────────────────────────────────────────────────────────────────────
// El afilado de cuchillas
//
// Se cotiza por LARGO, no por unidad suelta ni por diente: la lista dice
// "AF X100 CUCHILLA PLANA HSS", y ese x100 son 100 milímetros de cuchilla. Una
// plana HSS de 640 mm son 6,4 tramos.
//
// Cuál de los seis códigos corresponde lo deciden tres respuestas, y ninguna
// es una medida. El perfilado sólo existe en las de dorso ranurado: una plana
// no se perfila y por eso ese par no tiene código.
// ─────────────────────────────────────────────────────────────────────────────

export type CuchillaTipo = 'plana' | 'dorso_ranurado'
export type CuchillaMaterial = 'hss' | 'md'
export type CuchillaTrabajo = 'afilado' | 'perfilado'

export const ETIQUETA_CUCHILLA_TIPO: Record<CuchillaTipo, string> = {
  plana: 'PLANA',
  dorso_ranurado: 'DORSO RANURADO',
}

export const ETIQUETA_CUCHILLA_MATERIAL: Record<CuchillaMaterial, string> = {
  hss: 'HSS (acero rápido)',
  md: 'M.D. (metal duro)',
}

export const ETIQUETA_CUCHILLA_TRABAJO: Record<CuchillaTrabajo, string> = {
  afilado: 'AFILADO',
  perfilado: 'PERFILADO',
}

/** Los milímetros que cubre el precio de lista de un afilado de cuchilla. */
export const TRAMO_CUCHILLA_MM = 100

/**
 * Lo que cuesta afilar cuchillas, en la moneda del precio de lista.
 *
 * `precioPorTramo` es el de la lista —por cada 100 mm— y el largo dice cuántos
 * tramos entran. No se redondea a tramos enteros: media cuchilla de 50 mm es
 * medio tramo, no uno.
 */
export function totalAfiladoCuchilla(
  precioPorTramo: number,
  largoMm: number,
  unidades: number,
): number {
  if (!Number.isFinite(precioPorTramo) || !Number.isFinite(largoMm)) return 0
  if (precioPorTramo <= 0 || largoMm <= 0) return 0
  const cuantas = Number.isFinite(unidades) && unidades > 0 ? unidades : 1
  return redondear((precioPorTramo * largoMm * cuantas) / TRAMO_CUCHILLA_MM)
}

export type OrigenFresa = 'nacional' | 'importada'

export const ETIQUETA_ORIGEN_FRESA: Record<OrigenFresa, string> = {
  nacional: 'PRODUCCIÓN NACIONAL',
  importada: 'IMPORTADA',
}

/** Un renglón de la nota. Los campos que no apliquen quedan vacíos. */
export interface FormularioItemNota {
  servicio: TipoServicio
  /**
   * El servicio que tenía el renglón antes de que los dientes rotos lo pasaran
   * a RECTIFICADO.
   *
   * Existe para poder volver atrás: si el vendedor destilda "tiene dientes
   * rotos", el renglón recupera el servicio que había elegido. Sin esto no
   * habría forma de distinguir un rectificado que puso la app de uno que el
   * vendedor eligió a propósito, y destildar lo dejaría rectificado para
   * siempre.
   */
  servicio_antes_de_rotos: TipoServicio | null
  /**
   * En qué máquina trabaja la herramienta.
   *
   * Va en la descripción general de la nota —"AFILADO de SIERRAS para
   * ESCUADRADORA"— porque es lo que le dice al taller de qué pieza se trata
   * cuando dos herramientas comparten medidas.
   */
  maquina: string
  /**
   * ¿La operación de este renglón la eligió el vendedor?
   *
   * Cuando la nota lleva una sola operación no hay nada que elegir y esto no se
   * mira. Cuando lleva varias —afilado y venta en la misma visita— el renglón
   * nuevo arrancaba en la primera de la lista y el desplegable aparecía ya
   * resuelto: el vendedor cargaba una venta adentro de un renglón de afilado
   * sin enterarse. `servicio` sigue teniendo un valor siempre —de él dependen
   * los campos que se dibujan— pero mientras esto sea false la pantalla lo
   * muestra sin elegir y el validador lo pide.
   */
  servicio_elegido: boolean
  herramienta: Herramienta | null

  // Venta
  codigo_herramienta: string
  unidades: string
  precio: string
  /** Sólo en la venta de fresas: define en qué nota de pedido cae. */
  origen_fresa: OrigenFresa | null
  /**
   * En qué moneda está `precio`.
   *
   * Media lista de precios está en dólares, y ahí el renglón se cotiza en
   * dólares —precio unitario × unidades, todo en U$S— con el tipo de cambio
   * impreso en la nota para convertir. Convertirlo nosotros a pesos escondería
   * el precio de lista, que es el que el cliente reconoce.
   */
  moneda: Moneda

  // Comunes de servicio
  cantidad: string
  /**
   * Lo que sale impreso en la columna "Descripción" del talonario.
   *
   * Es corta a propósito —"SC nueva", "Fresa"— porque esa columna tiene el
   * ancho que tiene: el renglón del papel entra en una línea. Lo que identifica
   * al artículo con precisión es el código, que va en su propia columna, y las
   * medidas, que van en la técnica.
   */
  descripcion: string
  /**
   * El texto largo de la lista de precios, tal cual viene.
   *
   * No se imprime: sirve para mostrar en pantalla qué se eligió y para leerle
   * las características (diámetro, ancho de corte, dientes). Antes se copiaba
   * a `descripcion` y llenaba el renglón de la nota con una línea de catálogo.
   */
  descripcion_catalogo: string
  cantidad_dientes: string
  codigos_computo: string[]
  precio_por_diente: string
  precio_total: string

  // Medidas
  diametro_exterior: string
  /**
   * El agujero. **Opcional**: la lista de precios ya lo trae, y lo normal es
   * que la herramienta venga con el de fábrica.
   *
   * Se carga sólo cuando difiere, que es justamente el dato que importa: más
   * grande significa que la agrandaron, más chico que lleva buje reductor. Ver
   * `ajusteDeAgujero`.
   */
  diametro_interior: string
  /** El de fábrica, que trae el catálogo. No lo tipea nadie. */
  diametro_interior_catalogo: string
  diametro: string
  ancho_corte: string
  largo: string
  ancho: string
  largo_util: string
  espesor: string
  paso: string

  // Mechas
  tipo_mecha: TipoMecha | null
  mano: ManoMecha | null

  // Si/No con "no" por defecto, como pidieron
  dientes_rotos: boolean
  afilado_reparacion: boolean

  // ── Dientes rotos ─────────────────────────────────────────────────────────
  //
  // Un diente roto no se afila: se descuenta del total a afilar. Y si además
  // se lo repara, esa reparación se cobra aparte, con su propio código de
  // cómputo —el de reparación por ancho de corte— y su propio precio.
  /** Cuántos, en números. Sólo cuenta si `dientes_rotos` está en sí. */
  dientes_rotos_cantidad: string
  /**
   * `null` mientras no lo contesten: es una pregunta que cambia el precio, así
   * que no puede tener un default silencioso.
   */
  reparar_dientes: boolean | null
  /** Código de cómputo de la reparación. Se busca solo por el ancho de corte. */
  codigo_reparacion: string
  precio_reparacion_por_diente: string

  // ── Rascadores ────────────────────────────────────────────────────────────
  //
  // Las sierras de máquina múltiple —las Franzoi entre ellas— llevan, además de
  // los dientes, unos rascadores, y la lista los anuncia juntos: "Z=18+4" son
  // 18 dientes y 4 rascadores. Se afilan los dos pero NO valen lo mismo: el
  // diente sale $ 248,85 y el rascador $ 319,95, cada uno con su código. Meter
  // los 22 al precio del diente cobraría de menos todas las veces.
  //
  // Van en un campo aparte y no adentro del de dientes: "18+4" habría que
  // interpretarlo, y un dedo de más en el signo cambia la cuenta sin avisar.
  /** Cuántos rascadores tiene la pieza. Vacío en las que no llevan. */
  rascadores: string
  /** Código de cómputo del afilado del rascador. Se busca solo. */
  codigo_rascador: string
  precio_rascador_unitario: string

  // ── Trabajos que no se cobran ─────────────────────────────────────────────
  //
  // Se marcan al elegir el código: la lista de precios lo dice en la
  // descripción ("AFILADO S.C. SIN CARGO"). Es una marca y no un precio porque
  // el importe no se multiplica: son $ 0,10 la nota entera, no por diente.
  // ── El afilado de cuchillas ───────────────────────────────────────────────
  //
  // El código no sale de una medida sino de tres respuestas. El largo no
  // elige: multiplica, porque el precio de la lista es por cada 100 mm.
  /** Plana o de dorso ranurado. */
  cuchilla_tipo: CuchillaTipo | null
  /** Acero rápido o metal duro. */
  cuchilla_material: CuchillaMaterial | null
  /** Afilar o perfilar. El perfilado sólo existe en las de dorso ranurado. */
  cuchilla_trabajo: CuchillaTrabajo | null

  /** El trabajo principal del renglón va sin cargo. */
  sin_cargo: boolean
  /** La reparación de los dientes rotos va sin cargo. Se decide aparte. */
  reparacion_sin_cargo: boolean

  // ── Descuento ─────────────────────────────────────────────────────────────
  //
  // Antes esto era otra cosa: una casilla PROMOCIÓN con un texto libre al lado
  // ("llevando 3") que no tocaba ningún precio. Se guardaba, se mostraba como
  // pastilla en el detalle y no llegaba nunca al papel. Ahora es plata.
  //
  // Vale en TODOS los renglones, no sólo en los de venta: un cliente grande
  // negocia el afilado igual que la sierra.
  //
  // Son dos campos y no uno porque la casilla es el interruptor —el desplegable
  // recién aparece cuando la marcan— y porque un porcentaje en cero tiene que
  // poder distinguirse de "no hay descuento".
  /** Si el renglón lleva descuento. */
  promocion: boolean
  /** El porcentaje elegido, como texto: '5', '10' … '65'. Vacío si no hay. */
  descuento: string
}

/**
 * Los descuentos que el vendedor puede elegir: de 5 en 5, hasta 65 %.
 *
 * Es una lista cerrada y no un campo libre a propósito. Un descuento tipeado a
 * mano admite el 7 %, el 12,5 % y el 110 %, y los tres terminan en una nota que
 * la oficina tiene que salir a preguntar. De 5 en 5 también es como se habla:
 * nadie negocia un 13 %.
 *
 * El tope es 65 y no 100: regalar el renglón entero no es un descuento, es un
 * trabajo sin cargo, y para eso el sistema ya tiene su propia marca —que
 * además se imprime distinto y no se multiplica.
 */
export const DESCUENTOS_DISPONIBLES: number[] = Array.from({ length: 13 }, (_, i) => (i + 1) * 5)

/** El máximo que admite el desplegable. Fuera de esto el número no es válido. */
export const DESCUENTO_MAXIMO = DESCUENTOS_DISPONIBLES[DESCUENTOS_DISPONIBLES.length - 1]

/**
 * El porcentaje efectivo de un renglón: 0 si no tiene descuento o es inválido.
 *
 * Se acota acá y no en cada consumidor porque el número viaja como texto desde
 * el formulario y como `numeric` desde la base, y las dos vías pueden traer
 * cualquier cosa. Un descuento que no se pueda creer vale cero: cobrar de más
 * es un reclamo, cobrar de menos por un dato corrupto es una pérdida muda.
 */
export function descuentoDelRenglon(item: FormularioItemNota): number {
  if (!item.promocion) return 0
  const n = aNumero(item.descuento)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.min(n, DESCUENTO_MAXIMO)
}

export const ITEM_VACIO: FormularioItemNota = {
  servicio: 'afilado',
  servicio_antes_de_rotos: null,
  maquina: '',
  servicio_elegido: false,
  herramienta: null,
  codigo_herramienta: '',
  unidades: '',
  precio: '',
  origen_fresa: null,
  moneda: 'ARS',
  cantidad: '',
  descripcion: '',
  descripcion_catalogo: '',
  cantidad_dientes: '',
  codigos_computo: [],
  precio_por_diente: '',
  precio_total: '',
  diametro_exterior: '',
  diametro_interior: '',
  diametro_interior_catalogo: '',
  diametro: '',
  ancho_corte: '',
  largo: '',
  ancho: '',
  largo_util: '',
  espesor: '',
  paso: '',
  tipo_mecha: null,
  mano: null,
  dientes_rotos: false,
  afilado_reparacion: false,
  dientes_rotos_cantidad: '',
  reparar_dientes: null,
  codigo_reparacion: '',
  precio_reparacion_por_diente: '',
  rascadores: '',
  codigo_rascador: '',
  precio_rascador_unitario: '',
  cuchilla_tipo: null,
  cuchilla_material: null,
  cuchilla_trabajo: null,
  sin_cargo: false,
  reparacion_sin_cargo: false,
  promocion: false,
  descuento: '',
}

// ─────────────────────────────────────────────────────────────────────────────
// Validación
// ─────────────────────────────────────────────────────────────────────────────

const ETIQUETA_CAMPO: Record<CampoItem, string> = {
  cantidad: 'la cantidad',
  diametro_exterior: 'el diámetro exterior',
  diametro_interior: 'el diámetro interior',
  diametro: 'el diámetro',
  ancho_corte: 'el ancho de corte',
  largo: 'el largo',
  ancho: 'el ancho',
  largo_util: 'el largo útil',
  espesor: 'el espesor',
  paso: 'el paso',
  descripcion: 'la descripción',
  cantidad_dientes: 'la cantidad de dientes',
  tipo_mecha: 'el tipo de mecha',
  mano: 'si es derecha o izquierda',
  dientes_rotos: '',
  dientes_rotos_cantidad: 'cuántos dientes están rotos',
  reparar_dientes: 'si querés reparar los dientes',
  rascadores: 'cuántos rascadores tiene',
  afilado_reparacion: '',
  codigos_computo: 'el código de cómputo',
  precio_por_diente: 'el precio por diente',
  precio_total: 'el precio total',
}

/**
 * Campos que el validador no exige por sí solos.
 *
 * Los Si/No tienen "no" por defecto, así que nunca están "sin completar". Los
 * dos de dientes rotos sí se exigen, pero condicionalmente —sólo cuando el
 * vendedor marcó que hay dientes rotos— y esa regla está escrita aparte.
 */
const NO_OBLIGATORIOS: CampoItem[] = [
  // La mayoría de las sierras no lleva rascadores: se pregunta por si acaso y
  // vacío quiere decir que no tiene, que es el caso normal.
  'rascadores',
  'dientes_rotos',
  'afilado_reparacion',
  'dientes_rotos_cantidad',
  'reparar_dientes',
  // El agujero lo trae la lista de precios: sólo se carga cuando difiere del
  // de fábrica. Exigirlo sería pedir que copien un dato que ya tenemos.
  'diametro_interior',
]

function esNumeroValido(v: string): boolean {
  if (!v.trim()) return false
  const n = Number(v.replace(',', '.'))
  return Number.isFinite(n) && n > 0
}

const CAMPOS_NUMERICOS = new Set<CampoItem>([
  'cantidad', 'diametro_exterior', 'diametro_interior', 'diametro', 'ancho_corte',
  'largo', 'ancho', 'largo_util', 'espesor', 'paso', 'cantidad_dientes',
  'precio_por_diente', 'precio_total', 'dientes_rotos_cantidad',
])

export interface OpcionesValidacionItem {
  /**
   * La nota lleva más de una operación, así que cuál le toca a este renglón es
   * una pregunta de verdad y hay que contestarla.
   */
  pedirServicio?: boolean
}

export function validarItemNota(
  item: FormularioItemNota,
  opciones: OpcionesValidacionItem = {},
): ResultadoValidacion<string> {
  const errores: Record<string, string> = {}

  // El descuento se controla acá arriba, antes de bifurcar por servicio: vale
  // en la venta y en el afilado por igual, y las dos ramas de abajo terminan en
  // su propio `return`. Puesto en una sola, la otra dejaba pasar un renglón con
  // la casilla marcada y sin porcentaje.
  if (item.promocion && descuentoDelRenglon(item) <= 0) {
    errores.descuento = 'Elegí cuánto descuento lleva'
  }

  // Se pide antes que nada: de la operación dependen la herramienta y los
  // campos, así que marcar errores de campos que todavía no se sabe si
  // corresponden sería mandar a completar cosas al pedo.
  if (opciones.pedirServicio && !item.servicio_elegido) {
    errores.servicio = 'Elegí con qué operación va este renglón'
    return { valido: false, errores }
  }

  if (item.servicio === 'venta') {
    if (!item.herramienta) {
      errores.herramienta = 'Elegí qué se vende'
    }
    // De qué origen es la fresa decide en qué nota de pedido cae: sin eso no
    // se puede armar el comprobante.
    if (item.herramienta === 'fresa' && !item.origen_fresa) {
      errores.origen_fresa = 'Indicá si la fresa es de producción nacional o importada'
    }
    if (!item.codigo_herramienta.trim()) {
      errores.codigo_herramienta = 'Ingresá el código de la herramienta'
    }
    if (!esNumeroValido(item.unidades)) {
      errores.unidades = 'Ingresá cuántas unidades'
    }
    if (!esNumeroValido(item.precio)) {
      errores.precio = 'Ingresá el precio unitario'
    }
    return { valido: Object.keys(errores).length === 0, errores }
  }

  if (!item.herramienta) {
    errores.herramienta = 'Elegí la herramienta'
    return { valido: false, errores }
  }

  // ── Dientes rotos ─────────────────────────────────────────────────────────
  // Se valida aparte porque es condicional: los campos existen siempre pero
  // sólo se exigen cuando el vendedor marcó que hay dientes rotos.
  if (item.dientes_rotos && CAMPOS_POR_HERRAMIENTA[item.herramienta].includes('dientes_rotos')) {
    const rotos = aNumero(item.dientes_rotos_cantidad)
    const totales = aNumero(item.cantidad_dientes) * Math.max(1, aNumero(item.cantidad))

    if (!esNumeroValido(item.dientes_rotos_cantidad)) {
      errores.dientes_rotos_cantidad = 'Ingresá cuántos dientes están rotos'
    } else if (totales > 0 && rotos > totales) {
      // Restar más dientes de los que hay dejaría el renglón en negativo.
      errores.dientes_rotos_cantidad = `No pueden ser más de ${totales}, que es el total de dientes`
    }

    if (item.reparar_dientes === null) {
      errores.reparar_dientes = 'Contestá si querés reparar los dientes'
    }
    /**
     * Reparar los dientes es un trabajo aparte, y sin su código no se puede
     * cobrar: la línea saldría con cantidad y sin precio.
     *
     * Se busca solo apenas contestan que sí; este error es para el caso en que
     * el catálogo no tenga ninguno para esa medida.
     */
    if (item.reparar_dientes === true && !item.codigo_reparacion.trim()) {
      errores.codigo_reparacion =
        'Falta el código de cómputo de la reparación. Completá el ancho de corte para que se busque solo.'
    }
  }

  for (const campo of CAMPOS_POR_HERRAMIENTA[item.herramienta]) {
    if (NO_OBLIGATORIOS.includes(campo)) continue

    // La mano sólo se pide en las mechas que la tienen.
    if (campo === 'mano') {
      const pide = item.tipo_mecha && MECHAS_CON_MANO.includes(item.tipo_mecha)
      if (pide && !item.mano) errores.mano = 'Indicá si es derecha o izquierda'
      continue
    }

    if (campo === 'codigos_computo') {
      if (item.codigos_computo.length === 0) {
        errores.codigos_computo =
          'Falta el código de cómputo. Completá la medida para que se busque solo, o elegilo de la lista.'
      }
      continue
    }

    // El precio total no se tipea: sale de la cuenta. Se valida el resultado y
    // no el casillero, porque el casillero puede estar todavía vacío mientras
    // el formulario termina de calcular y eso no es un error del vendedor.
    if (campo === 'precio_total') {
      if (totalDelRenglon(item) <= 0) {
        errores.precio_total = 'Falta el precio total. Revisá el precio y las cantidades.'
      }
      continue
    }

    const valor = (item as unknown as Record<string, string>)[campo] ?? ''

    if (CAMPOS_NUMERICOS.has(campo)) {
      if (!esNumeroValido(valor)) {
        errores[campo] = `Ingresá ${ETIQUETA_CAMPO[campo]}`
      }
    } else if (!String(valor).trim()) {
      errores[campo] = `Ingresá ${ETIQUETA_CAMPO[campo]}`
    }
  }

  return { valido: Object.keys(errores).length === 0, errores }
}

// ─────────────────────────────────────────────────────────────────────────────
// Varios renglones en una misma nota
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Un renglón en blanco para el mismo servicio.
 *
 * Conserva la herramienta cuando se pidió "sumar otra mecha" y la deja sin
 * elegir cuando se agrega una distinta. Nada más se copia: repetir el diámetro
 * de la mecha anterior sería adivinar, y un valor heredado sin querer es más
 * difícil de ver que uno vacío.
 */
export function renglonNuevo(
  servicio: TipoServicio,
  herramienta: Herramienta | null = null,
  /**
   * true cuando el vendedor dijo con qué operación va este renglón —tocó
   * "AGREGAR RENGLÓN DE VENTA", o la nota lleva una sola operación—. false
   * cuando el servicio es sólo el que había que poner para dibujar algo.
   */
  servicioElegido = false,
): FormularioItemNota {
  return { ...ITEM_VACIO, servicio, herramienta, servicio_elegido: servicioElegido }
}

/**
 * ¿El renglón está todavía en blanco?
 *
 * Se mira todo menos la operación: un renglón recién abierto tiene una puesta
 * —de algo hay que dibujar los campos— pero eso no es una decisión del
 * vendedor.
 *
 * Sirve para saber si hay que volver a preguntarle la operación cuando la nota
 * pasa a llevar más de una. Sin esto, marcar AFILADO y después VENTA dejaba el
 * primer renglón como "ya decidido en afilado", porque durante un instante
 * hubo una sola operación tildada — y marcar de a una es justamente cómo se
 * usa el desplegable.
 */
export function renglonEnBlanco(item: FormularioItemNota): boolean {
  for (const clave of Object.keys(ITEM_VACIO) as Array<keyof FormularioItemNota>) {
    if (clave === 'servicio' || clave === 'servicio_elegido') continue
    const actual = item[clave]
    const vacio = ITEM_VACIO[clave]
    if (Array.isArray(actual)) {
      if (actual.length > 0) return false
      continue
    }
    if (actual !== vacio) return false
  }
  return true
}

/** Cómo se nombra cada medida en el resumen de una línea. */
const ABREVIATURA_MEDIDA: Partial<Record<CampoItem, string>> = {
  diametro_exterior: 'Ø ext',
  diametro: 'Ø',
  ancho_corte: 'corte',
  largo: 'largo',
  ancho: 'ancho',
  largo_util: 'útil',
  espesor: 'esp',
  paso: 'paso',
}

/**
 * Una línea que identifique al renglón en la lista, sin tener que abrirlo.
 * Ej.: `MECHAS · PASANTE · Ø 10 · útil 90 · × 2`.
 */
export function resumenRenglon(item: FormularioItemNota): string {
  if (item.servicio === 'venta') {
    const unidades = aNumero(item.unidades)
    return [
      'VENTA',
      item.herramienta ? ETIQUETA_HERRAMIENTA[item.herramienta] : null,
      item.origen_fresa ? ETIQUETA_ORIGEN_FRESA[item.origen_fresa] : null,
      item.codigo_herramienta || 'Sin código',
      unidades > 0 ? `× ${unidades}` : null,
    ]
      .filter(Boolean)
      .join(' · ')
  }

  if (!item.herramienta) return 'Renglón sin herramienta'

  const partes: string[] = [ETIQUETA_HERRAMIENTA[item.herramienta]]
  if (item.tipo_mecha) partes.push(ETIQUETA_TIPO_MECHA[item.tipo_mecha])

  for (const campo of CAMPOS_POR_HERRAMIENTA[item.herramienta]) {
    const abreviatura = ABREVIATURA_MEDIDA[campo]
    if (!abreviatura) continue
    const valor = (item as unknown as Record<string, string>)[campo]
    if (valor) partes.push(`${abreviatura} ${valor}`)
  }

  const cantidad = aNumero(item.cantidad)
  if (cantidad > 1) partes.push(`× ${cantidad}`)

  return partes.join(' · ')
}

/**
 * Lo que se factura por la nota entera, **en pesos**.
 *
 * `tipoCambio` sólo hace falta cuando hay renglones cotizados en dólares; sin
 * ellos el resultado es el mismo con cualquier valor.
 */
export function totalDeRenglones(items: FormularioItemNota[], tipoCambio = 0): number {
  return redondear(items.reduce((suma, i) => suma + totalDelRenglonEnPesos(i, tipoCambio), 0))
}

/**
 * Cuántos renglones de producto entran en una nota.
 *
 * Es el alto del talonario en papel: la tabla técnica tiene doce filas y cada
 * renglón cargado ocupa una. Pasarse no lo resuelve la impresión —la tabla
 * crece y se estira la hoja— pero deja de ser el comprobante que la fábrica
 * sabe leer, así que el tope se pone donde se carga y no donde se imprime.
 *
 * Si el cliente trae más, van en otra nota.
 */
export const MAXIMO_RENGLONES = 12

/**
 * Cuánto se tarda en devolver el trabajo, cuando nadie dice otra cosa.
 *
 * Una semana es el plazo normal de la casa, y es la fecha que el vendedor
 * terminaba eligiendo a mano en el calendario, nota tras nota. Viene puesta y
 * se cambia con un toque: preseleccionar es ahorrar trabajo, no decidir por el
 * otro.
 */
export const DIAS_ENTREGA_POR_DEFECTO = 7

/** La fecha de entrega que corresponde a una nota cargada hoy. */
export function fechaEntregaPorDefecto(desde: Date = new Date()): Date {
  const fecha = new Date(desde)
  fecha.setDate(fecha.getDate() + DIAS_ENTREGA_POR_DEFECTO)
  return fecha
}

/**
 * Cuánto entra en un renglón de observaciones.
 *
 * Es el ancho de la columna "Observaciones" del talonario: más que esto no se
 * imprime, se corta. Vale más frenarlo donde se escribe que descubrirlo cuando
 * la nota ya salió en papel.
 *
 * Los 60 de antes eran una estimación y nunca entraron: la columna mide 37 %
 * de la tabla —264 px— y sesenta caracteres piden 346. Todo lo que pasaba de
 * los cuarenta y pico se perdía en silencio, con el vendedor creyendo que lo
 * había escrito.
 *
 * Los 46 salen de medir sobre los 266 px que tiene la columna, con la letra que
 * el teléfono usa de verdad: 46 caracteres ocupan 235 px en Arial y la del
 * teléfono mide alrededor de un 4 % más —lo acota la nota 000060 impresa, donde
 * una cuenta de 82 px se cortó contra una casilla de 85—.
 *
 * Los 60 de antes eran una estimación y nunca entraron: pedían 346 px. Lo que
 * sobraba se perdía en silencio, con el vendedor creyendo que lo había escrito.
 *
 * En MAYÚSCULA entran unos 40, así que una observación gritada todavía puede
 * recortarse. No se baja el límite por eso: castigaría a todos por un caso que
 * casi no se da —de 25 observaciones cargadas, una sola está en mayúscula— y el
 * promedio real es de 24 caracteres.
 */
export const OBSERVACION_MAXIMO_CARACTERES = 46

export interface ValidacionRenglones {
  valido: boolean
  /** Índice del primer renglón con problemas, para llevar al vendedor ahí. */
  indice: number
  errores: Record<string, string>
}

/**
 * Valida la nota completa. Devuelve el primer renglón que falla en vez de
 * juntar todos los errores: la pantalla muestra uno por vez, y una lista de
 * problemas de un renglón que no se está viendo no ayuda a nadie.
 */
export function validarRenglones(
  items: FormularioItemNota[],
  opciones: OpcionesValidacionItem = {},
): ValidacionRenglones {
  if (items.length === 0) {
    return {
      valido: false,
      indice: 0,
      errores: { herramienta: 'La nota necesita al menos un renglón' },
    }
  }

  if (items.length > MAXIMO_RENGLONES) {
    return {
      valido: false,
      indice: MAXIMO_RENGLONES,
      errores: {
        herramienta: `La nota entra hasta ${MAXIMO_RENGLONES} renglones y tiene ${items.length}. Sacá ${items.length - MAXIMO_RENGLONES} y armá otra nota con el resto.`,
      },
    }
  }

  for (let i = 0; i < items.length; i++) {
    const { valido, errores } = validarItemNota(items[i], opciones)
    if (!valido) return { valido: false, indice: i, errores: errores as Record<string, string> }
  }

  return { valido: true, indice: 0, errores: {} }
}

export type CampoEncabezado =
  | 'cliente'
  | 'cliente_nombre'
  | 'zona'
  | 'vendedor_numero'
  | 'datos_cliente'
  | 'tipo_nota'
  | 'servicios'
  | 'fecha_entrega'
  | 'condicion_venta'
  | 'condicion_venta_detalle'

/**
 * Las tres páginas en que se carga la nota.
 *
 * El formulario entero no entra en un teléfono y tampoco se completa de una
 * sentada: el vendedor identifica al cliente, después carga lo que trajo, y
 * recién al final acuerda cómo se cobra. Cada página se valida sola —al pasar a
 * la siguiente— y no toda la nota, que es lo que hacía que tocar CONTINUAR en
 * la primera marcara en rojo campos que todavía no se habían mostrado.
 */
export type ParteDeLaNota = 'cliente' | 'operacion' | 'facturacion'

const CAMPOS_DE_LA_PARTE: Record<ParteDeLaNota, CampoEncabezado[]> = {
  cliente: [
    'cliente',
    'cliente_nombre',
    'zona',
    'vendedor_numero',
    'datos_cliente',
    'fecha_entrega',
  ],
  operacion: ['servicios'],
  facturacion: ['tipo_nota', 'condicion_venta', 'condicion_venta_detalle'],
}

export function validarEncabezadoNota(
  enc: FormularioNotaEncabezado,
  extra: {
    servicios: TipoServicio[]
    tipoNota: TipoNotaPedido | null
    fechaEntrega: string | null
    condicionVenta?: CondicionVenta | null
    condicionVentaDetalle?: string
    /** Frente a quién se emite. Sólo se exige en factura. */
    /**
     * La versión de prueba carga el cliente a mano, sin buscarlo en la base.
     * Ahí no se puede exigir un `cliente_id` que no va a existir nunca.
     */
    clienteAMano?: boolean
    /**
     * Qué páginas mirar. Sin esto se miran todas, que es lo que necesita el
     * chequeo final antes de crear la nota.
     */
    partes?: ParteDeLaNota[]
  },
): ResultadoValidacion<CampoEncabezado> {
  const errores: Partial<Record<CampoEncabezado, string>> = {}

  // La condición de venta es cómo se cobra: sin eso la nota no se puede pasar
  // a cobranzas. Las dos que piden detalle lo exigen.
  const detalle = String(extra.condicionVentaDetalle ?? '').trim()
  if (!extra.condicionVenta) {
    errores.condicion_venta = 'Elegí la condición de venta'
  } else if (CONDICIONES_CON_PLAZO.includes(extra.condicionVenta)) {
    // El cheque y la cuenta corriente llevan plazo: desde cuándo y hasta
    // cuándo. Un solo número no alcanza — lo que se negocia es la ventana.
    const plazo = plazoDePago(detalle)
    if (!plazo) {
      errores.condicion_venta_detalle = 'Elegí desde y hasta cuántos días'
    } else if (plazo.hasta > DIAS_CHEQUE_MAXIMO) {
      errores.condicion_venta_detalle = `El plazo llega hasta ${DIAS_CHEQUE_MAXIMO} días`
    } else if (plazo.desde > plazo.hasta) {
      errores.condicion_venta_detalle = 'El "hasta" no puede ser menor que el "de"'
    }
  } else if (extra.condicionVenta === 'otro' && !detalle) {
    errores.condicion_venta_detalle = 'Contá cuál es la condición'
  }

  if (extra.clienteAMano) {
    // Versión de prueba: no hay padrón contra el cual buscar, así que lo único
    // exigible es que el cliente quede identificado. El código no se pide —hay
    // clientes que todavía no lo tienen— pero sin él la nota queda sin número,
    // y eso se avisa en la pantalla, no acá.
    if (!enc.cliente_nombre.trim()) {
      errores.cliente_nombre = 'Ingresá el nombre o la razón social'
    }
  } else {
    // Un cliente nuevo todavía no tiene código: la nota se guarda igual y queda
    // esperando que Administración se lo asigne.
    if (!enc.cliente_nuevo && !enc.cliente_id) {
      errores.cliente = 'Buscá el cliente por código, nombre o CUIT'
    }
    if (enc.cliente_nuevo && !enc.cliente_nombre.trim()) {
      errores.cliente_nombre = 'Ingresá el nombre o la razón social'
    }
  }
  if (!enc.zona.trim()) errores.zona = 'Falta la zona'

  /**
   * El número de vendedor va IMPRESO en el comprobante, y hasta ahora no se
   * exigía.
   *
   * La app lo completa sola —con el del que carga, o con el que tiene a cargo
   * la zona— pero las dos cosas pueden fallar: un administrativo no tiene
   * código propio, y la zona sólo lo resuelve si está asignada a un único
   * vendedor. Cuando fallaban las dos, la nota se creaba igual y salía impresa
   * con "Vendedor Nº ___" en blanco. Pasó de verdad: dos de las diecinueve
   * notas cargadas quedaron así, y en la oficina no hay forma de saber de quién
   * son.
   *
   * El campo se puede escribir a mano, así que exigirlo no traba a nadie: pide
   * el dato que el comprobante necesita, donde se puede resolver.
   */
  if (!enc.vendedor_numero.trim()) {
    errores.vendedor_numero = 'Falta el número de vendedor: va impreso en la nota'
  }
  if (!enc.datos_cliente.trim()) errores.datos_cliente = 'Completá los datos del cliente'
  if (extra.servicios.length === 0) errores.servicios = 'Elegí al menos un tipo de operación'
  if (!extra.tipoNota) errores.tipo_nota = 'Elegí si es factura o presupuesto'
  if (!extra.fechaEntrega) errores.fecha_entrega = 'Elegí la fecha de entrega'

  // Se calculan todos y después se filtra, para que el texto de cada error
  // tenga un solo dueño: repetir las reglas por página es la forma segura de
  // que dos páginas terminen exigiendo cosas distintas del mismo campo.
  if (!extra.partes) return { valido: Object.keys(errores).length === 0, errores }

  const miradas = new Set(extra.partes.flatMap((p) => CAMPOS_DE_LA_PARTE[p]))
  const filtrados: Partial<Record<CampoEncabezado, string>> = {}
  for (const [campo, mensaje] of Object.entries(errores) as Array<[CampoEncabezado, string]>) {
    if (miradas.has(campo)) filtrados[campo] = mensaje
  }

  return { valido: Object.keys(filtrados).length === 0, errores: filtrados }
}

// ─────────────────────────────────────────────────────────────────────────────
// Cálculo
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lee un número escrito de cualquiera de las dos formas que aparecen en la app.
 *
 * El vendedor tipea a la argentina —`1.234,56`, con el punto de miles— pero los
 * valores que vienen del catálogo llegan como `String(6656.65)`, con el punto
 * decimal. Borrar todos los puntos, que era lo que hacía antes, servía para lo
 * primero y **multiplicaba por cien** lo segundo:
 *
 *   `3.2` de ancho de corte → 32 → buscaba el código de una fresa de 30 a 39 mm
 *   `6656.65` de precio     → 665665 → cotizaba cien veces de más
 *
 * Las dos cosas salieron en la misma nota de prueba, así que no es teórico.
 *
 * La regla: si hay coma, la coma manda y los puntos son de miles. Si no hay
 * coma, un único punto seguido de una o dos cifras es decimal; el resto son
 * separadores de miles.
 *
 * Queda una ambigüedad real que no se puede resolver mirando el texto: `1.234`
 * es mil doscientos treinta y cuatro para un argentino y uno coma doscientos
 * treinta y cuatro para el catálogo. Gana la lectura argentina, que es la que
 * el vendedor tipea, salvo que la parte entera sea cero (`0.750` es 0,75).
 */
export function aNumero(v: string): number {
  const texto = String(v ?? '').trim()
  if (!texto) return 0

  let normalizado: string

  if (texto.includes(',')) {
    normalizado = texto.replace(/\./g, '').replace(',', '.')
  } else {
    const partes = texto.split('.')
    const decimales = partes.length === 2 ? partes[1] : ''
    const entero = partes[0]
    const esDecimal =
      partes.length === 2 &&
      decimales.length > 0 &&
      (decimales.length !== 3 || entero === '' || Number(entero) === 0)

    normalizado = esDecimal ? texto : texto.replace(/\./g, '')
  }

  const n = Number(normalizado)
  return Number.isFinite(n) ? n : 0
}

/** Dos decimales, que es como se factura. */
function redondear(n: number): number {
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0
}

/**
 * Precio total de un renglón de afilado: precio por diente × cantidad de
 * dientes. Es la cuenta que pidieron y la que evita que el vendedor la haga a
 * mano en la calle.
 */
export function calcularTotalPorDientes(
  precioPorDiente: number,
  cantidadDientes: number,
  cantidadHerramientas = 1,
): number {
  if (!Number.isFinite(precioPorDiente) || !Number.isFinite(cantidadDientes)) return 0
  // Los dientes son POR herramienta. Dos sierras de 96 dientes son 192 dientes
  // para afilar: sin este factor la nota cobraba la mitad.
  const unidades = Number.isFinite(cantidadHerramientas) && cantidadHerramientas > 0
    ? cantidadHerramientas
    : 1
  return redondear(precioPorDiente * cantidadDientes * unidades)
}

// ─────────────────────────────────────────────────────────────────────────────
// Cómputo del renglón
//
// Un renglón puede dar MÁS DE UNA línea de cómputo. El caso es el de los
// dientes rotos: un diente roto no se afila, así que se descuenta del total a
// afilar, y si además se lo repara esa reparación se cobra aparte, con el
// código de reparación que corresponde al ancho de corte.
//
//   2 sierras de 96 dientes, 5 rotos, con reparación
//     → AFILADO      187 dientes × $ 248,85
//     → REPARACIÓN     5 dientes × $ 1.500,35
//
// Si el cliente NO quiere repararlos, los 5 simplemente no se cobran.
//
// La cuenta vive acá y no en la pantalla porque la usan cuatro lugares —el
// formulario, la vista previa, el alta en la base y la impresión— y ya pasó
// una vez que una copia se quedara atrás y cotizara la mitad.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Qué trabajo es cada línea de cómputo.
 *
 * El rectificado va aparte del afilado aunque los dos se cobren por diente:
 * son casillas distintas en la tabla técnica y rótulos distintos en la
 * comercial. Un renglón puede tener dos —los dientes sanos rectificados y los
 * rotos reparados— y en fábrica hay que poder ver cuál es cuál.
 */
export type ConceptoComputo =
  | 'afilado'
  | 'rectificado'
  | 'reparacion'
  | 'rascador'
  | 'venta'

export interface LineaComputo {
  concepto: ConceptoComputo
  /** Los códigos de cómputo de esta línea, ya unidos por coma. */
  codigo: string
  /** Lo que se computa: dientes en el afilado, unidades en la venta. */
  cantidad: number
  precioUnitario: number
  total: number
  /** La moneda de esta línea. El afilado siempre en pesos. */
  moneda: Moneda
  /**
   * El trabajo no se cobra y el importe es simbólico.
   *
   * La cantidad se sigue informando —la fábrica tiene que saber cuántos
   * dientes se afilaron— pero no multiplica: el total es $ 0,10 y punto.
   */
  sinCargo: boolean
  /**
   * El descuento aplicado a esta línea, en por ciento. 0 si no lleva.
   *
   * `precioUnitario` queda SIN tocar: es el precio de lista, el que el cliente
   * reconoce y el que se imprime. El descuento vive en `total` y se muestra
   * aparte, en su propia columna. Por eso `cantidad × precioUnitario` no da
   * `total` cuando hay descuento — y está bien que no dé: la hoja muestra los
   * tres números para que la cuenta se pueda seguir.
   */
  descuento: number
}

/**
 * Los datos que alimentan la cuenta, sin depender de si vienen del formulario
 * o de una fila de la base. Las dos formas existen y tienen nombres distintos.
 */
export interface DatosComputo {
  concepto: ConceptoComputo
  /** Cuántas herramientas: el factor que multiplica a los dientes. */
  cantidad: number
  /** Dientes POR herramienta. 0 en lo que no se cobra por diente. */
  dientesPorHerramienta: number
  precioUnitario: number
  codigos: string[]
  dientesRotos: number
  /**
   * Si los dientes rotos se reparan, y por lo tanto llevan su propia línea.
   *
   * La reparación es un trabajo aparte sobre los mismos dientes que la línea
   * principal deja afuera: otro código, otro precio y otra cantidad.
   */
  repararDientes: boolean
  /**
   * Los rascadores de la pieza, que se afilan aparte de los dientes.
   *
   * Otro código y otro precio sobre la misma herramienta, igual que la
   * reparación: por eso son su propia línea y no un número que se suma a los
   * dientes.
   */
  rascadores: number
  codigoRascador: string
  precioRascadorUnitario: number
  codigoReparacion: string
  precioReparacionPorDiente: number
  /**
   * Para lo que no se cobra por diente (mechas, cuchillas, sierras sin fin):
   * el precio total que tipeó el vendedor. El unitario se deduce de ahí.
   */
  precioTotalDirecto: number
  /** La moneda del renglón. El afilado siempre es en pesos. */
  moneda: Moneda
  /** El trabajo principal no se cobra. */
  sinCargo?: boolean
  /** La reparación de los rotos no se cobra. Se decide aparte del principal. */
  reparacionSinCargo?: boolean
  /**
   * El descuento del renglón, en por ciento. 0 o ausente si no lleva.
   *
   * Se aplica a TODAS las líneas del renglón —el afilado, los rascadores y la
   * reparación de los rotos—, porque es un descuento sobre el trabajo de esa
   * herramienta, no sobre uno de sus conceptos. Descontar sólo la línea
   * principal dejaría al rascador a precio de lista adentro de una pieza que se
   * negoció con descuento.
   */
  descuentoPorcentaje?: number
}

/**
 * Lo que se cobra por un trabajo sin cargo: **el total, no el unitario**.
 *
 * En realidad es cero. El importe simbólico existe para que el renglón no se
 * confunda con uno al que le falta cargar el precio, y por eso no se
 * multiplica: afilar una sierra de 96 dientes sin cargo son $ 0,10, y afilar
 * cuatro sierras de 96 también.
 */
function totalSinCargo(): number {
  return PRECIO_SIN_CARGO
}

/**
 * Aplica el descuento del renglón a cada línea ya calculada.
 *
 * Va al final y no adentro de cada cuenta para que la aritmética del trabajo
 * —dientes sanos, rascadores, rotos— quede escrita en un solo lugar y el
 * descuento sea lo último que pasa. Es también el orden en que se negocia: se
 * arma el trabajo y recién después se acuerda cuánto se rebaja.
 *
 * Lo que NO se descuenta: las líneas sin cargo. Su total es un importe
 * simbólico de $ 0,10 que no sale de multiplicar nada; rebajarle un 20 %
 * daría $ 0,08, un número que no significa absolutamente nada y que además
 * rompería la regla de que dos sin cargo del mismo código siguen siendo $ 0,10.
 */
function conDescuento(lineas: LineaComputo[], porcentaje: number | undefined): LineaComputo[] {
  const p = Math.min(Math.max(0, porcentaje || 0), DESCUENTO_MAXIMO)
  if (p <= 0) return lineas
  return lineas.map((l) =>
    l.sinCargo ? l : { ...l, descuento: p, total: redondear(l.total * (1 - p / 100)) },
  )
}

export function lineasDeComputo(d: DatosComputo): LineaComputo[] {
  const unidades = Math.max(1, d.cantidad || 1)
  const codigo = d.codigos.filter(Boolean).join(', ')
  const sinCargo = d.sinCargo === true

  // Sin dientes no hay nada que descontar: la línea es una sola y el unitario
  // sale de dividir, que es la única lectura posible de un total tipeado.
  if (!d.dientesPorHerramienta) {
    const total = sinCargo
      ? totalSinCargo()
      : redondear(d.precioTotalDirecto || d.precioUnitario * unidades)
    return conDescuento(
      [
        {
          concepto: d.concepto,
          codigo,
          cantidad: unidades,
          // Sin cargo no hay precio unitario que mostrar: el importe no sale de
          // multiplicar nada, y un "$ 0,03 c/u" sería una cuenta inventada.
          precioUnitario: sinCargo ? 0 : redondear(total / unidades),
          total,
          moneda: sinCargo ? 'ARS' : d.moneda,
          sinCargo,
          descuento: 0,
        },
      ],
      d.descuentoPorcentaje,
    )
  }

  const dientesTotales = d.dientesPorHerramienta * unidades
  const rotos = Math.min(Math.max(0, d.dientesRotos), dientesTotales)
  const aAfilar = dientesTotales - rotos

  /**
   * La línea principal se cobra por los dientes SANOS.
   *
   * Un diente roto no se afila ni se rectifica: se repara, y eso es la segunda
   * línea, con su propio código y su propio precio. Cobrarlo en las dos sería
   * cobrar dos veces el mismo diente.
   *
   * Una sierra de 96 con 6 rotos se afila por 90. Si además piden repararlos,
   * esos 90 pasan a rectificado y los 6 van aparte.
   */
  const cobrados = aAfilar

  const lineas: LineaComputo[] = [
    {
      concepto: d.concepto,
      codigo,
      cantidad: cobrados,
      precioUnitario: sinCargo ? 0 : d.precioUnitario,
      total: sinCargo ? totalSinCargo() : redondear(cobrados * d.precioUnitario),
      moneda: sinCargo ? 'ARS' : d.moneda,
      sinCargo,
      descuento: 0,
    },
  ]

  /**
   * Los rascadores, si los tiene.
   *
   * Van antes de la reparación porque son parte del trabajo normal de la pieza
   * —se afilan siempre que estén—, y la reparación es lo excepcional.
   */
  const rascadores = Math.max(0, d.rascadores || 0)
  if (rascadores > 0) {
    lineas.push({
      concepto: 'rascador',
      codigo: d.codigoRascador,
      cantidad: rascadores,
      precioUnitario: sinCargo ? 0 : d.precioRascadorUnitario,
      total: sinCargo ? totalSinCargo() : redondear(rascadores * d.precioRascadorUnitario),
      // El afilado del rascador se cobra en pesos, como el del diente.
      moneda: 'ARS',
      sinCargo,
      descuento: 0,
    })
  }

  if (rotos > 0 && d.repararDientes) {
    // La reparación puede ir sin cargo aunque el afilado se cobre: es
    // justamente el caso de "REP. DTE. DE SIERRA SIN CARGO", el diente que se
    // rompió en nuestro taller.
    const repSinCargo = d.reparacionSinCargo === true
    lineas.push({
      concepto: 'reparacion',
      codigo: d.codigoReparacion,
      cantidad: rotos,
      precioUnitario: repSinCargo ? 0 : d.precioReparacionPorDiente,
      total: repSinCargo ? totalSinCargo() : redondear(rotos * d.precioReparacionPorDiente),
      // El afilado y su reparación se cobran los dos en pesos.
      moneda: 'ARS',
      sinCargo: repSinCargo,
      descuento: 0,
    })
  }

  return conDescuento(lineas, d.descuentoPorcentaje)
}

/**
 * Junta en una sola fila las líneas que se computan igual.
 *
 * La tabla de CARACTERISTICAS COMERCIALES no discrimina por herramienta: sus
 * columnas son código de cómputo, cantidad y precio. Dos sierras distintas
 * —otro diámetro, otro agujero, otra cantidad de dientes— cuyo ancho de corte
 * cae en el mismo rango comparten el código y el precio por diente, y ahí son
 * la misma línea. Separadas, el mismo código aparecía dos veces y en fábrica
 * había que sumarlas a mano.
 *
 * Lo que las distingue sigue estando: la tabla técnica de arriba conserva un
 * renglón por herramienta, con sus medidas y sus dientes. Esta cuenta es la
 * comercial.
 *
 * **Sólo se juntan las que además comparten precio unitario y moneda.** Si el
 * vendedor pisó el precio de una de las dos, sumarlas daría una fila donde
 * cantidad × unitario no da el total: una nota que no cierra es peor que una
 * con el código repetido. En ese caso quedan separadas a propósito.
 */
export function consolidarLineasDeComputo(lineas: LineaComputo[]): LineaComputo[] {
  const salida: LineaComputo[] = []
  const porClave = new Map<string, LineaComputo>()

  for (const linea of lineas) {
    // Sin código no hay contra qué agrupar: pasa tal cual.
    // El descuento entra en la clave: dos líneas del mismo código con
    // porcentajes distintos no se pueden fusionar, porque la fila resultante
    // tendría que imprimir un solo número en la columna de descuento y
    // cualquiera de los dos sería mentira.
    const clave = linea.codigo
      ? `${linea.concepto}|${linea.codigo}|${linea.moneda}|${linea.precioUnitario}|${linea.sinCargo}|${linea.descuento}`
      : ''

    const previa = clave ? porClave.get(clave) : undefined
    if (!previa) {
      const copia = { ...linea }
      if (clave) porClave.set(clave, copia)
      salida.push(copia)
      continue
    }

    previa.cantidad += linea.cantidad
    // Dos renglones sin cargo que caen en el mismo código siguen siendo $ 0,10:
    // sumarlos daría $ 0,20, que es exactamente la multiplicación que la regla
    // dice que no hay que hacer.
    previa.total = previa.sinCargo ? totalSinCargo() : redondear(previa.total + linea.total)
  }

  return salida
}

/** Adaptador del formulario a la cuenta. */
export function computoDeRenglon(item: FormularioItemNota): DatosComputo {
  const esVenta = item.servicio === 'venta'
  return {
    concepto: esVenta
      ? 'venta'
      : item.servicio === 'reparacion'
        ? 'reparacion'
        : item.servicio === 'rectificado'
          ? 'rectificado'
          : 'afilado',
    cantidad: Math.max(1, Math.round(aNumero(esVenta ? item.unidades : item.cantidad)) || 1),
    dientesPorHerramienta: esVenta ? 0 : aNumero(item.cantidad_dientes),
    precioUnitario: aNumero(esVenta ? item.precio : item.precio_por_diente),
    codigos: esVenta
      ? item.codigo_herramienta
        ? [item.codigo_herramienta]
        : []
      : item.codigos_computo,
    dientesRotos: item.dientes_rotos ? aNumero(item.dientes_rotos_cantidad) : 0,
    /**
     * Con dientes rotos el renglón ENTERO ya es la reparación.
     *
     * El código de cómputo del renglón pasa a ser REP.PARCIAL o REP.TOTAL, así
     * que la línea aparte que antes se sumaba por los rotos cobraría el mismo
     * trabajo dos veces y saldría impreso el código de reparación repetido.
     */
    repararDientes: item.reparar_dientes === true,
    codigoReparacion: item.codigo_reparacion,
    precioReparacionPorDiente: aNumero(item.precio_reparacion_por_diente),
    // Los rascadores son POR HERRAMIENTA, como los dientes: cuatro sierras de
    // 18+4 llevan 16 rascadores.
    rascadores: aNumero(item.rascadores) * Math.max(1, aNumero(item.cantidad) || 1),
    codigoRascador: item.codigo_rascador,
    precioRascadorUnitario: aNumero(item.precio_rascador_unitario),
    // En venta el precio tipeado es UNITARIO, así que no hay total directo:
    // dejarlo acá haría que 3 unidades a $100 se facturaran $100.
    precioTotalDirecto: esVenta ? 0 : aNumero(item.precio_total),
    // El afilado se cobra en pesos siempre; sólo la venta puede ir en dólares.
    moneda: esVenta ? item.moneda : 'ARS',
    sinCargo: item.sin_cargo === true,
    reparacionSinCargo: item.reparacion_sin_cargo === true,
    descuentoPorcentaje: descuentoDelRenglon(item),
  }
}

export function lineasDelRenglon(item: FormularioItemNota): LineaComputo[] {
  return lineasDeComputo(computoDeRenglon(item))
}

/**
 * Lo que se cobra por el renglón, **en su moneda**: afilado + reparación de los
 * rotos, o unidades × precio en la venta.
 */
export function totalDelRenglon(item: FormularioItemNota): number {
  return redondear(lineasDelRenglon(item).reduce((s, l) => s + l.total, 0))
}

/**
 * Lo mismo, pero a precio de LISTA: sin aplicar el descuento del renglón.
 *
 * Existe para que `precio_total` no pueda envenenarse. Ese campo es a la vez
 * una salida —tres `useEffect` lo reescriben con la cuenta hecha— y una
 * ENTRADA: en las mechas, las cuchillas y las sierras sin fin no hay precio por
 * diente y el importe del renglón sale exclusivamente de ahí, por
 * `precioTotalDirecto`.
 *
 * Si se le escribiera el total ya descontado, la próxima vuelta lo tomaría como
 * precio de lista y le descontaría otra vez. Un 20 % aplicado tres renders
 * seguidos no es un 20 %: es un 49 %, y nadie lo vería pasar.
 *
 * La regla, entonces: `precio_unitario` y `precio_total` viven siempre en
 * precio de lista; el descuento vive en su porcentaje y en el total de la nota.
 * Así la nota impresa puede mostrar los tres números y que la cuenta cierre.
 */
export function totalDeListaDelRenglon(item: FormularioItemNota): number {
  return totalDelRenglon({ ...item, promocion: false })
}

/**
 * Lo mismo, pasado a pesos.
 *
 * Existe porque el total de la nota es un solo número y una nota de venta puede
 * mezclar artículos de lista en dólares con otros en pesos. Sumar los dos como
 * si fueran lo mismo daría un total que no es plata de ninguna moneda.
 */
export function totalDelRenglonEnPesos(item: FormularioItemNota, tipoCambio: number): number {
  return redondear(
    lineasDelRenglon(item).reduce((s, l) => s + aPesos(l.total, l.moneda, tipoCambio), 0),
  )
}

/** ¿Hay algún renglón cotizado en dólares? */
export function tieneRenglonesEnDolares(items: FormularioItemNota[]): boolean {
  return items.some((i) => lineasDelRenglon(i).some((l) => l.moneda === 'USD'))
}

/** Dientes que quedan para afilar, ya descontados los rotos. */
export function dientesAAfilar(item: FormularioItemNota): number {
  const unidades = Math.max(1, aNumero(item.cantidad) || 1)
  const totales = aNumero(item.cantidad_dientes) * unidades
  const rotos = item.dientes_rotos ? aNumero(item.dientes_rotos_cantidad) : 0
  return Math.max(0, totales - Math.min(rotos, totales))
}

// ─────────────────────────────────────────────────────────────────────────────
// El agujero de la herramienta
//
// La lista de precios trae el diámetro interior de fábrica (`d=30`). Cuando el
// cliente trae una con otro agujero, eso cambia el trabajo y hay que decirlo en
// la nota:
//
//   · más grande  → alguien se lo AGRANDÓ
//   · más chico   → lleva un BUJE REDUCTOR
//
// Es un dato del taller, no un precio, así que va a la descripción general de
// la herramienta y no a la tabla de cómputo.
// ─────────────────────────────────────────────────────────────────────────────

export type AjusteAgujero = 'agrandado' | 'buje_reductor' | 'de_fabrica'

export const ETIQUETA_AJUSTE_AGUJERO: Record<AjusteAgujero, string> = {
  agrandado: 'agrandado',
  buje_reductor: 'buje reductor',
  de_fabrica: 'de fábrica',
}

export interface AgujeroDelRenglon {
  /** La medida que va a la nota: la cargada, o la de catálogo si no cargaron. */
  medida: string
  ajuste: AjusteAgujero
  /** Sin medida de catálogo no hay con qué comparar. */
  comparable: boolean
}

/**
 * Qué agujero lleva el renglón y si difiere del de fábrica.
 *
 * Sin nada cargado se usa el del catálogo. Cargar la misma medida que el
 * catálogo también sirve —queda escrita— y no es un ajuste.
 *
 * **En una VENTA no hay ajuste posible.** La herramienta sale nueva, con el
 * agujero que trae de fábrica: no hay una pieza del cliente contra la cual
 * comparar. La medida se toma del artículo elegido y se escribe sola; el campo
 * para cargarla a mano es de los renglones de servicio, que es donde el
 * cliente puede traer una con el agujero agrandado o con buje.
 */
export function agujeroDelRenglon(item: FormularioItemNota): AgujeroDelRenglon {
  const catalogo = item.diametro_interior_catalogo.trim()
  const cargado = item.diametro_interior.trim()

  if (item.servicio === 'venta') {
    return { medida: catalogo || cargado, ajuste: 'de_fabrica', comparable: false }
  }

  if (!cargado) {
    return { medida: catalogo, ajuste: 'de_fabrica', comparable: !!catalogo }
  }
  if (!catalogo) {
    // No hay contra qué comparar: se respeta lo cargado y no se inventa ajuste.
    return { medida: cargado, ajuste: 'de_fabrica', comparable: false }
  }

  const a = aNumero(cargado)
  const b = aNumero(catalogo)
  if (!a || !b || Math.abs(a - b) < 0.001) {
    return { medida: cargado, ajuste: 'de_fabrica', comparable: true }
  }
  return {
    medida: cargado,
    ajuste: a > b ? 'agrandado' : 'buje_reductor',
    comparable: true,
  }
}

/**
 * Cómo se nombra cada herramienta DENTRO DE UNA FRASE.
 *
 * Tabla aparte de `ETIQUETA_HERRAMIENTA` a propósito, y no por prolijidad:
 * aquélla está hecha para los títulos de la pantalla, donde "SIERRAS" a secas
 * se entiende porque arriba dice de qué se está hablando. Metida en una frase
 * miente: una nota con sierras circulares y sierras sin fin salía
 * "AFILADO DE SIERRAS Y SIERRA SIN FIN", que se lee como un error de tipeo —y
 * donde "sierras" no quiere decir "todas las sierras" sino justamente las
 * circulares, que es lo que el renglón imprime como "S.C."—.
 *
 * En minúscula porque es dato cargado, no rótulo del formulario: en el
 * talonario la mayúscula sostenida es de la hoja preimpresa.
 */
export const EN_LA_DESCRIPCION: Record<Herramienta, string> = {
  sierra: 'sierras circulares',
  fresa: 'fresas',
  cabezal: 'cabezales',
  incisor: 'incisores',
  sierra_sin_fin: 'sierras sin fin',
  mecha: 'mechas',
  cuchilla: 'cuchillas',
}

/**
 * La preposición de cada servicio.
 *
 * Seis de los siete son un trabajo sobre la pieza y van con "de". El reclamo
 * no: no se le hace un reclamo a la sierra, se reclama POR la sierra. Escrito
 * "RECLAMO de sierras circulares", en el taller se lee como una orden de
 * trabajo más, que es exactamente lo que no es.
 */
const PREPOSICION: Partial<Record<TipoServicio, string>> = { reclamo: 'por' }

/** "sierras circulares", "sierras circulares y fresas", "a, b y c". */
function enumerar(partes: string[]): string {
  if (partes.length <= 1) return partes[0] ?? ''
  return `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}`
}

/**
 * Cuánto puede medir la línea antes de comerse dos renglones del recuadro.
 *
 * El recuadro de la descripción general tiene alto fijo y recorta sin avisar
 * (ver `ALTO_DESCRIPCION_MM` en la plantilla de impresión). A 7,5 pt entran
 * unos 125 caracteres por renglón; con 120 queda margen y la línea nunca pasa
 * de uno.
 */
const LARGO_MAXIMO_LINEA = 120

/**
 * Qué trabajo hay que hacer, y sobre qué. Encabeza la descripción general.
 *
 * Sale de los renglones y no de una casilla aparte: el servicio y la
 * herramienta ya se cargan renglón por renglón, y pedirle al vendedor que los
 * vuelva a escribir en la descripción es pedirle que copie a mano algo que la
 * app ya sabe —y que va a quedar desactualizado en cuanto agregue un renglón—.
 *
 * Va una parte por servicio, porque una misma nota puede llevar más de uno:
 *
 *     AFILADO de sierras circulares y fresas
 *     AFILADO de sierras circulares · VENTA de mechas
 *     RECLAMO por fresas
 *
 * El servicio en mayúscula y la herramienta en minúscula: el servicio es lo
 * único que en fábrica hace falta leer sin acercarse, y la minúscula deja claro
 * que eso es dato cargado y no un rótulo del formulario.
 *
 * Se arma con los renglones DE ESA NOTA, no con todos los de la carga. Cuando
 * la carga se parte en varias notas por grupo de facturación, cada una se lleva
 * los suyos: una nota de afilado que dijera "VENTA de mechas" porque el
 * vendedor cargó mechas en la nota hermana estaría mintiendo sobre lo que
 * fábrica tiene que hacer con esas piezas.
 *
 * Devuelve '' mientras no haya ningún renglón con herramienta elegida: al
 * principio de la carga no hay nada que anunciar, y una línea a medio armar es
 * peor que ninguna.
 */
/**
 * Cómo se anuncia el trabajo de un renglón.
 *
 * Casi siempre es su operación a secas. La excepción es el renglón que además
 * repara sus dientes rotos: ahí son DOS trabajos sobre la misma pieza —los
 * rotos se reparan, los sanos se rectifican— y los dos tienen que estar en la
 * descripción. Es lo primero que se lee en fábrica, y leer sólo RECTIFICADO
 * manda a hacer la mitad del trabajo.
 *
 * Un renglón que ya ES una reparación no se duplica: diría REPARACIÓN Y
 * REPARACIÓN.
 */
function etiquetaDelTrabajo(item: FormularioItemNota): string {
  const propia = ETIQUETA_TIPO_SERVICIO[item.servicio]
  const reparaAparte =
    item.dientes_rotos && item.reparar_dientes === true && item.servicio !== 'reparacion'
  return reparaAparte ? `${ETIQUETA_TIPO_SERVICIO.reparacion} Y ${propia}` : propia
}

export function lineaDeServicio(items: FormularioItemNota[]): string {
  /**
   * Agrupado por lo que ANUNCIA cada renglón, no por su operación.
   *
   * Dos rectificados se juntan en una sola frase, como antes. Pero uno que
   * además repara anuncia otra cosa, así que va en su propio grupo: mezclarlos
   * pondría los dos bajo el mismo rótulo y uno de los dos quedaría mal dicho.
   */
  const porTrabajo = new Map<
    string,
    { servicio: TipoServicio; destinos: Map<string, Herramienta[]> }
  >()

  for (const item of items) {
    if (!item.herramienta) continue
    const etiqueta = etiquetaDelTrabajo(item)
    const grupo = porTrabajo.get(etiqueta) ?? { servicio: item.servicio, destinos: new Map() }
    // En minúscula, como las herramientas: la línea es una frase, no un rótulo.
    const maquina = (item.maquina || '').trim().toLowerCase()
    const suyas = grupo.destinos.get(maquina) ?? []
    if (!suyas.includes(item.herramienta)) suyas.push(item.herramienta)
    grupo.destinos.set(maquina, suyas)
    porTrabajo.set(etiqueta, grupo)
  }

  if (porTrabajo.size === 0) return ''

  const completa = [...porTrabajo]
    .map(([etiqueta, { servicio, destinos }]) => {
      /**
       * Cada herramienta con su destino, no todas las máquinas al final.
       *
       * "sierras circulares para escuadradora y máquina múltiple" se lee como
       * una sierra que sirve para las dos, y son dos sierras distintas que van
       * a máquinas distintas. Emparejadas queda dicho cuál va a dónde, que es
       * lo que en fábrica hay que saber para repartirlas.
       *
       * Cuando el destino cambia pero la herramienta es la misma no se repite
       * —"para escuadradora y para máquina múltiple"—: nombrarla dos veces no
       * agrega nada y come el renglón, que es corto.
       */
      const partes: string[] = []
      let anterior = ''
      for (const [maquina, herramientas] of destinos) {
        const nombres = enumerar(herramientas.map((h) => EN_LA_DESCRIPCION[h]))
        const mismas = nombres === anterior
        anterior = nombres
        // La máquina es un agregado: mientras no la elijan, la línea dice lo
        // esencial igual y no queda un "para" colgado.
        partes.push(
          maquina ? `${mismas ? '' : nombres + ' '}para ${maquina}` : nombres,
        )
      }
      // Con `enumerar` y no con " y " suelto: tres destinos daban "y ... y ..."
      // y se lee como una lista mal escrita.
      return `${etiqueta} ${PREPOSICION[servicio] ?? 'de'} ${enumerar(partes)}`
    })
    .join(' · ')

  if (completa.length <= LARGO_MAXIMO_LINEA) return completa

  // Tres servicios con dos herramientas cada uno no entran en un renglón, y el
  // recuadro no avisa: recorta. Se dejan los trabajos solos, que es el dato
  // que hay que leer de lejos; qué herramienta es cada uno ya está renglón por
  // renglón en la tabla de abajo.
  return [...porTrabajo.keys()].join(' · ')
}

const escaparRegex = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Cómo se reconoce la línea que pone `lineaDeServicio`.
 *
 * Matchea la línea ENTERA, no un prefijo, y se arma con las tablas de verdad
 * —servicios y herramientas— así que no se puede desincronizar.
 *
 * Que sea la línea entera importa: con un reconocedor por prefijo, un vendedor
 * que escribiera "AFILADO de urgencia, el cliente pasa el jueves" perdía
 * también "el cliente pasa el jueves" al reabrir la nota para corregirla, sin
 * que nada avisara. Esa frase empieza igual que la línea automática pero no lo
 * es, y así no matchea.
 */
const LINEA_DE_SERVICIO = (() => {
  const etiquetas = Object.values(ETIQUETA_TIPO_SERVICIO).map(escaparRegex)
  /**
   * También la forma compuesta, "REPARACIÓN Y RECTIFICADO".
   *
   * Va PRIMERO en la alternancia: si "RECTIFICADO" se probara antes, matchearía
   * la mitad de la frase y el reconocedor —que exige la línea entera— diría que
   * no es suya. Esa línea volvería al campo del vendedor y cada corrección de
   * la nota agregaría una copia.
   */
  const compuestas = etiquetas.map(
    (e) => `${escaparRegex(ETIQUETA_TIPO_SERVICIO.reparacion)} Y ${e}`,
  )
  const servicios = [...compuestas, ...etiquetas].join('|')
  const herramientas = Object.values(EN_LA_DESCRIPCION).map(escaparRegex).join('|')
  const lista = `(?:${herramientas})(?:, (?:${herramientas}))*(?: y (?:${herramientas}))?`
  // La máquina también sale de su tabla de verdad, así que sumar una máquina
  // nueva no puede dejar el reconocedor atrás.
  const maquinas = MAQUINAS.map((m) => escaparRegex(m.toLowerCase())).join('|')
  const listaMaquinas = `(?:${maquinas})(?:, (?:${maquinas}))*(?: y (?:${maquinas}))?`
  /**
   * La forma emparejada: "... para escuadradora y para máquina múltiple", y
   * también "... para escuadradora y fresas para tupí".
   *
   * El `(?:${lista} )?` de la repetición es el que hace las dos: con la
   * herramienta cuando cambia, sin ella cuando se repite.
   */
  const parte =
    `(?:${servicios}) (?:de|por) ${lista}(?: para ${listaMaquinas})?` +
    `(?:(?:, | y )(?:${lista} )?para ${listaMaquinas})*`
  // La segunda forma es la corta, la que sale cuando la completa no entra en un
  // renglón: los servicios solos.
  const corta = `(?:${servicios})`
  return new RegExp(`^(?:${parte}(?: · ${parte})*|${corta}(?: · ${corta})+)$`)
})()

/**
 * La descripción general **como la escribió el vendedor**, sin la línea de
 * servicio que le pega la app al guardar.
 *
 * Mismo motivo que `sinAvisosDeAgujero`: al reabrir una nota para corregirla,
 * la línea automática volvía al campo como si fuera texto del vendedor y al
 * guardar se agregaba otra. Cada corrección dejaba una línea más.
 */
export function sinLineaDeServicio(texto: string | null | undefined): string {
  return String(texto ?? '')
    .split('\n')
    .filter((linea) => !LINEA_DE_SERVICIO.test(linea.trim()))
    .join('\n')
    .trim()
}

/**
 * La descripción general que va guardada en la nota, con sus tres partes.
 *
 *  1. **Qué hay que hacer y sobre qué** — "AFILADO de sierras circulares". Lo
 *     arma la app con los renglones; el vendedor ya lo cargó ahí y no tiene por
 *     qué escribirlo dos veces.
 *  2. **Los avisos de agujero.** Dato de taller: si la pieza no trae el agujero
 *     de fábrica, hay que saberlo antes de tocarla.
 *  3. **Lo que agrega el vendedor**, tal cual lo escribió o lo dictó.
 *
 * En ese orden, y el orden es una decisión: el recuadro del papel tiene alto
 * fijo y lo que no entra se recorta en silencio, así que último va lo que menos
 * duele perder. El servicio y el agujero los necesita fábrica para trabajar; el
 * comentario del vendedor es un agregado. Antes el texto del vendedor iba
 * primero y lo que se caía eran los avisos de agujero.
 *
 * Vive acá y no en la app porque la usan los tres caminos que crean notas —la
 * app, la corrección de una nota ya creada y el probador— y ya pasó que una
 * copia quedara atrás.
 *
 * Los `items` son los de ESA nota, no los de toda la carga.
 */
export function descripcionGeneralDeLaNota(
  textoDelVendedor: string,
  items: FormularioItemNota[],
): string {
  return [lineaDeServicio(items), ...avisosDeAgujero(items), textoDelVendedor.trim()]
    .filter(Boolean)
    .join('\n')
}

/**
 * Los avisos de agujero que van a la descripción general de la herramienta.
 * Uno por renglón que difiera, con la herramienta y las dos medidas, para que
 * en el taller se sepa a cuál de las piezas corresponde.
 */
export function avisosDeAgujero(items: FormularioItemNota[]): string[] {
  const avisos: string[] = []
  for (const item of items) {
    // La venta no genera avisos: la herramienta sale con su agujero de fábrica.
    if (item.servicio === 'venta') continue
    const a = agujeroDelRenglon(item)
    if (a.ajuste === 'de_fabrica' || !a.comparable) continue
    const que = item.herramienta ? DESCRIPCION_SERVICIO[item.herramienta] : 'Herramienta'
    const como = a.ajuste === 'agrandado' ? 'con agujero agrandado' : 'con buje reductor'
    avisos.push(
      `${que} ${como}: ${a.medida} mm (de fábrica ${item.diametro_interior_catalogo.trim()} mm)`,
    )
  }
  return avisos
}

/** Cómo empiezan las líneas que agrega `avisosDeAgujero`. */
const LINEA_DE_AGUJERO = /\bcon (agujero agrandado|buje reductor):\s/

/**
 * La descripción general **como la escribió el vendedor**, sin los avisos de
 * agujero que le pegamos al guardar.
 *
 * Hace falta al volver a abrir una nota para corregirla: sin esto, los avisos
 * vuelven al campo como si fueran texto del vendedor y al guardar se agregan de
 * nuevo, así que cada corrección duplicaba la línea.
 */
export function sinAvisosDeAgujero(texto: string | null | undefined): string {
  return String(texto ?? '')
    .split('\n')
    .filter((linea) => !LINEA_DE_AGUJERO.test(linea))
    .join('\n')
    .trim()
}

/**
 * Cómo empieza la observación que escribe el servidor cuando una carga produjo
 * varias notas ("Va con nota de pedido 000011, 000012").
 *
 * No es del vendedor: se aparta al abrir la nota para corregirla y se vuelve a
 * poner al guardar. Si quedara en la lista editable, alcanzaría con borrarla
 * sin querer para que dos notas hermanas dejaran de referenciarse.
 */
export const OBSERVACION_HERMANAS = 'Va con nota de pedido '

export function esObservacionDelSistema(texto: string): boolean {
  return texto.trimStart().startsWith(OBSERVACION_HERMANAS)
}

// ─────────────────────────────────────────────────────────────────────────────
// En qué nota de pedido cae cada renglón
//
// Un mismo cliente puede traer una sierra a afilar y llevarse una fresa: son
// dos comprobantes distintos porque se facturan distinto. El afilado se cobra
// en pesos y la venta se cotiza en dólares, y adentro de la venta hay dos
// cosas que la empresa factura por separado: las sierras sin fin y las fresas
// de producción nacional.
//
// El vendedor carga todo junto, como lo trae el cliente. El reparto en notas
// lo hace la app.
// ─────────────────────────────────────────────────────────────────────────────

export type GrupoNota =
  | 'servicio'
  | 'venta_general'
  | 'venta_sierra_sin_fin'
  | 'venta_fresa_nacional'

export const ETIQUETA_GRUPO_NOTA: Record<GrupoNota, string> = {
  servicio: 'AFILADO Y SERVICIOS',
  venta_general: 'VENTA',
  venta_sierra_sin_fin: 'VENTA · SIERRAS SIN FIN',
  venta_fresa_nacional: 'VENTA · FRESAS NACIONALES',
}

export const DESCRIPCION_GRUPO_NOTA: Record<GrupoNota, string> = {
  servicio: 'Se cobra en pesos. La nota sale sin tipo de cambio.',
  venta_general: 'Productos cotizados en dólares. La nota lleva el tipo de cambio.',
  venta_sierra_sin_fin: 'Van en su propia nota. Cotizadas en dólares.',
  venta_fresa_nacional: 'Van en su propia nota y se facturan en pesos.',
}

/**
 * ¿La nota lleva el tipo de cambio impreso?
 *
 * El afilado se cobra en pesos, así que poner una cotización sólo confunde: el
 * recuadro va vacío. Las fresas de producción nacional también se facturan en
 * pesos, por definición.
 */
export function grupoLlevaTipoDeCambio(grupo: GrupoNota): boolean {
  return grupo === 'venta_general' || grupo === 'venta_sierra_sin_fin'
}

export function grupoDeFacturacion(item: FormularioItemNota): GrupoNota {
  if (item.servicio !== 'venta') return 'servicio'
  if (item.herramienta === 'sierra_sin_fin') return 'venta_sierra_sin_fin'
  if (item.herramienta === 'fresa' && item.origen_fresa === 'nacional') {
    return 'venta_fresa_nacional'
  }
  return 'venta_general'
}

export interface NotaAgrupada {
  grupo: GrupoNota
  items: FormularioItemNota[]
  /** Los servicios que quedan dentro de esta nota, para su encabezado. */
  servicios: TipoServicio[]
  /** En pesos, para poder compararlo entre notas y guardarlo en una columna. */
  total: number
  llevaTipoDeCambio: boolean
  /** true cuando alguno de sus renglones se cotiza en dólares. */
  tieneDolares: boolean
}

/**
 * Reparte los renglones en las notas que correspondan, conservando el orden en
 * que el vendedor los cargó.
 */
export function agruparParaNotas(
  items: FormularioItemNota[],
  tipoCambio = 0,
): NotaAgrupada[] {
  const orden: GrupoNota[] = []
  const porGrupo = new Map<GrupoNota, FormularioItemNota[]>()

  for (const item of items) {
    const grupo = grupoDeFacturacion(item)
    if (!porGrupo.has(grupo)) {
      porGrupo.set(grupo, [])
      orden.push(grupo)
    }
    porGrupo.get(grupo)!.push(item)
  }

  return orden.map((grupo) => {
    const suyos = porGrupo.get(grupo)!
    const servicios: TipoServicio[] = []
    for (const i of suyos) if (!servicios.includes(i.servicio)) servicios.push(i.servicio)
    return {
      grupo,
      items: suyos,
      servicios,
      total: totalDeRenglones(suyos, tipoCambio),
      llevaTipoDeCambio: grupoLlevaTipoDeCambio(grupo),
      tieneDolares: tieneRenglonesEnDolares(suyos),
    }
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Medidas
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Toda medida se escribe con coma decimal, y el punto se acepta como si fuera
 * coma: el vendedor tipea `3.2` o `3,2` según el teclado que le tocó y las dos
 * cosas significan lo mismo. Deja pasar un solo separador.
 */
export function normalizarMedida(texto: string): string {
  const limpio = String(texto ?? '').replace(/[^\d.,]/g, '').replace(/\./g, ',')
  const [entero, ...resto] = limpio.split(',')
  return resto.length ? `${entero},${resto.join('')}` : entero
}

/** "3,2 mm" — con la unidad, que es lo que evita la duda de si son mm o pulgadas. */
export function formatearMedida(valor: string | number | null | undefined): string {
  if (valor === null || valor === undefined || valor === '') return ''
  const n = typeof valor === 'number' ? valor : aNumero(valor)
  if (!Number.isFinite(n) || n === 0) return ''
  return `${n.toLocaleString('es-AR', { maximumFractionDigits: 2 })} mm`
}

/** "de 3 a 4 mm", "hasta 4 mm", "de 130 mm en adelante". */
export function describirRango(
  rangoMin: number | null | undefined,
  rangoMax: number | null | undefined,
): string {
  const min = rangoMin ?? null
  const max = rangoMax ?? null
  if (min === null && max === null) return 'sin rango'
  if (min === null || min === 0) return `hasta ${formatearMedida(max)}`
  if (max === null) return `de ${formatearMedida(min)} en adelante`
  return `de ${formatearMedida(min)} a ${formatearMedida(max)}`
}

// ─────────────────────────────────────────────────────────────────────────────
// El número de vendedor
// ─────────────────────────────────────────────────────────────────────────────

/**
 * El número de vendedor como va impreso en la nota: **sin los ceros de
 * adelante**.
 *
 * El Gestión los guarda rellenados a tres dígitos (`007`, `010`, `100`) y en el
 * talonario se escriben como el número que son. Quitar el relleno no cambia el
 * número: `007` y `7` son el mismo vendedor, y `010` y `100` quedan intactos
 * porque su cero no es relleno.
 *
 * `excepciones` lleva los códigos que conservan el cero de adelante porque en
 * la casa se los nombra así. Va como parámetro y no como una lista acá adentro
 * para que se pueda cambiar sin tocar esta función.
 */
/**
 * Códigos de vendedor que conservan el cero de adelante.
 *
 * PENDIENTE: son los de Valentín y Carlos, que en la casa se nombran con el
 * cero. Hasta saber cuáles son exactamente, la lista va vacía y todos los
 * códigos se imprimen sin relleno. Completar acá y no en la base: es una
 * convención de cómo se los llama, no un dato del vendedor.
 */
export const VENDEDORES_CON_CERO: string[] = []

export function numeroDeVendedorImpreso(
  codigo: string | null | undefined,
  excepciones: string[] = [],
): string {
  const t = String(codigo ?? '').trim()
  if (!t) return ''
  if (excepciones.includes(t)) return t
  // Sólo se sacan ceros de adelante, y nunca todos: "000" queda en "0".
  const sinCeros = t.replace(/^0+(?=\d)/, '')
  return sinCeros || t
}

/*
 * "Va con nota de pedido 000011, 000012" —el aviso que lleva cada nota cuando
 * la carga produjo varias— ya no se arma acá.
 *
 * Lo escribe `crear_notas_pedido` en la misma transacción que las crea, que es
 * el único momento en que los números existen y no puede fallar por separado.
 * Se saca la copia de TypeScript para que el formato tenga un solo dueño: dos
 * versiones de la misma frase terminan divergiendo y nadie se entera hasta que
 * sale distinta en dos comprobantes del mismo cliente.
 */

/** "$ 1.234,56" — formato argentino, que es como se lee la nota. */
export function formatearPesos(valor: number | null | undefined): string {
  if (valor === null || valor === undefined || !Number.isFinite(valor)) return ''
  return `$ ${valor.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** Deja sólo dígitos, coma y punto: el campo de precio no acepta letras. */
export function soloNumeros(texto: string): string {
  return texto.replace(/[^\d.,]/g, '')
}
