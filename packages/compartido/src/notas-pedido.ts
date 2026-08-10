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

import { aPesos, type Moneda } from './catalogo'
import type { ResultadoValidacion, TipoNotaPedido, TipoServicio } from './tipos'
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
  reclamo: [],
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
    'diametro_interior', 'descripcion', 'cantidad_dientes',
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

/** Contra qué medida se busca el código de cómputo en cada herramienta. */
export const MEDIDA_PARA_CODIGO: Record<Herramienta, CampoItem | null> = {
  sierra: 'ancho_corte',
  fresa: 'ancho_corte',
  cabezal: 'ancho_corte',
  incisor: 'ancho_corte',
  sierra_sin_fin: 'ancho',
  mecha: 'diametro',
  cuchilla: 'ancho',
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
  cheque: 'Cheque de 0 a 60 días',
  cuenta_corriente: 'Cuenta corriente',
  otro: 'Otro',
}

/** Las dos que piden algo más: los días del cheque y el texto de "Otro". */
export const CONDICIONES_CON_DETALLE: CondicionVenta[] = ['cheque', 'otro']

/** Tope de días del cheque. Sale del nombre de la opción. */
export const DIAS_CHEQUE_MAXIMO = 60

/**
 * Cómo se escribe la condición en la nota impresa.
 * `Cheque a 30 días`, `Otro: retira y paga en fábrica`, `Contado`.
 */
export function describirCondicionVenta(
  condicion: CondicionVenta | null,
  detalle?: string | null,
): string {
  if (!condicion) return ''
  const texto = String(detalle ?? '').trim()
  if (condicion === 'cheque') return texto ? `Cheque a ${texto} días` : 'Cheque'
  if (condicion === 'otro') return texto || 'Otro'
  return ETIQUETA_CONDICION_VENTA[condicion]
}

// ─────────────────────────────────────────────────────────────────────────────
// Formularios
// ─────────────────────────────────────────────────────────────────────────────

/** Encabezado de la nota: los datos del cliente. */
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
export type OrigenFresa = 'nacional' | 'importada'

export const ETIQUETA_ORIGEN_FRESA: Record<OrigenFresa, string> = {
  nacional: 'PRODUCCIÓN NACIONAL',
  importada: 'IMPORTADA',
}

/** Un renglón de la nota. Los campos que no apliquen quedan vacíos. */
export interface FormularioItemNota {
  servicio: TipoServicio
  herramienta: Herramienta | null

  // Venta
  codigo_herramienta: string
  unidades: string
  promocion: boolean
  promocion_detalle: string
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
}

export const ITEM_VACIO: FormularioItemNota = {
  servicio: 'afilado',
  herramienta: null,
  codigo_herramienta: '',
  unidades: '',
  promocion: false,
  promocion_detalle: '',
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

export function validarItemNota(
  item: FormularioItemNota,
): ResultadoValidacion<string> {
  const errores: Record<string, string> = {}

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
    // La promoción sólo se completa si la marcaron; si no, queda en "no".
    if (item.promocion && !item.promocion_detalle.trim()) {
      errores.promocion_detalle = 'Contá cuál es la promoción'
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
): FormularioItemNota {
  return { ...ITEM_VACIO, servicio, herramienta }
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
export function validarRenglones(items: FormularioItemNota[]): ValidacionRenglones {
  if (items.length === 0) {
    return {
      valido: false,
      indice: 0,
      errores: { herramienta: 'La nota necesita al menos un renglón' },
    }
  }

  for (let i = 0; i < items.length; i++) {
    const { valido, errores } = validarItemNota(items[i])
    if (!valido) return { valido: false, indice: i, errores: errores as Record<string, string> }
  }

  return { valido: true, indice: 0, errores: {} }
}

export type CampoEncabezado =
  | 'cliente'
  | 'cliente_nombre'
  | 'zona'
  | 'datos_cliente'
  | 'tipo_nota'
  | 'servicios'
  | 'fecha_entrega'
  | 'condicion_venta'
  | 'condicion_venta_detalle'

export function validarEncabezadoNota(
  enc: FormularioNotaEncabezado,
  extra: {
    servicios: TipoServicio[]
    tipoNota: TipoNotaPedido | null
    fechaEntrega: string | null
    condicionVenta?: CondicionVenta | null
    condicionVentaDetalle?: string
  },
): ResultadoValidacion<CampoEncabezado> {
  const errores: Partial<Record<CampoEncabezado, string>> = {}

  // La condición de venta es cómo se cobra: sin eso la nota no se puede pasar
  // a cobranzas. Las dos que piden detalle lo exigen.
  const detalle = String(extra.condicionVentaDetalle ?? '').trim()
  if (!extra.condicionVenta) {
    errores.condicion_venta = 'Elegí la condición de venta'
  } else if (extra.condicionVenta === 'cheque') {
    const dias = Number(detalle)
    if (!detalle || !/^\d+$/.test(detalle)) {
      errores.condicion_venta_detalle = 'Indicá a cuántos días es el cheque'
    } else if (dias > DIAS_CHEQUE_MAXIMO) {
      errores.condicion_venta_detalle = `El cheque va de 0 a ${DIAS_CHEQUE_MAXIMO} días`
    }
  } else if (extra.condicionVenta === 'otro' && !detalle) {
    errores.condicion_venta_detalle = 'Contá cuál es la condición'
  }

  // Un cliente nuevo todavía no tiene código: la nota se guarda igual y queda
  // esperando que Administración se lo asigne.
  if (!enc.cliente_nuevo && !enc.cliente_id) {
    errores.cliente = 'Buscá el cliente por código, nombre o CUIT'
  }
  if (enc.cliente_nuevo && !enc.cliente_nombre.trim()) {
    errores.cliente_nombre = 'Ingresá el nombre o la razón social'
  }
  if (!enc.zona.trim()) errores.zona = 'Falta la zona'
  if (!enc.datos_cliente.trim()) errores.datos_cliente = 'Completá los datos del cliente'
  if (extra.servicios.length === 0) errores.servicios = 'Elegí al menos un tipo de servicio'
  if (!extra.tipoNota) errores.tipo_nota = 'Elegí si es factura o presupuesto'
  if (!extra.fechaEntrega) errores.fecha_entrega = 'Elegí la fecha de entrega'

  return { valido: Object.keys(errores).length === 0, errores }
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

export type ConceptoComputo = 'afilado' | 'reparacion' | 'venta'

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
  repararDientes: boolean
  codigoReparacion: string
  precioReparacionPorDiente: number
  /**
   * Para lo que no se cobra por diente (mechas, cuchillas, sierras sin fin):
   * el precio total que tipeó el vendedor. El unitario se deduce de ahí.
   */
  precioTotalDirecto: number
  /** La moneda del renglón. El afilado siempre es en pesos. */
  moneda: Moneda
}

export function lineasDeComputo(d: DatosComputo): LineaComputo[] {
  const unidades = Math.max(1, d.cantidad || 1)
  const codigo = d.codigos.filter(Boolean).join(', ')

  // Sin dientes no hay nada que descontar: la línea es una sola y el unitario
  // sale de dividir, que es la única lectura posible de un total tipeado.
  if (!d.dientesPorHerramienta) {
    const total = redondear(d.precioTotalDirecto || d.precioUnitario * unidades)
    return [
      {
        concepto: d.concepto,
        codigo,
        cantidad: unidades,
        precioUnitario: redondear(total / unidades),
        total,
        moneda: d.moneda,
      },
    ]
  }

  const dientesTotales = d.dientesPorHerramienta * unidades
  const rotos = Math.min(Math.max(0, d.dientesRotos), dientesTotales)
  const aAfilar = dientesTotales - rotos

  const lineas: LineaComputo[] = [
    {
      concepto: d.concepto,
      codigo,
      cantidad: aAfilar,
      precioUnitario: d.precioUnitario,
      total: redondear(aAfilar * d.precioUnitario),
      moneda: d.moneda,
    },
  ]

  if (rotos > 0 && d.repararDientes) {
    lineas.push({
      concepto: 'reparacion',
      codigo: d.codigoReparacion,
      cantidad: rotos,
      precioUnitario: d.precioReparacionPorDiente,
      total: redondear(rotos * d.precioReparacionPorDiente),
      // El afilado y su reparación se cobran los dos en pesos.
      moneda: 'ARS',
    })
  }

  return lineas
}

/** Adaptador del formulario a la cuenta. */
export function computoDeRenglon(item: FormularioItemNota): DatosComputo {
  const esVenta = item.servicio === 'venta'
  return {
    concepto: esVenta ? 'venta' : item.servicio === 'reparacion' ? 'reparacion' : 'afilado',
    cantidad: Math.max(1, Math.round(aNumero(esVenta ? item.unidades : item.cantidad)) || 1),
    dientesPorHerramienta: esVenta ? 0 : aNumero(item.cantidad_dientes),
    precioUnitario: aNumero(esVenta ? item.precio : item.precio_por_diente),
    codigos: esVenta
      ? item.codigo_herramienta
        ? [item.codigo_herramienta]
        : []
      : item.codigos_computo,
    dientesRotos: item.dientes_rotos ? aNumero(item.dientes_rotos_cantidad) : 0,
    repararDientes: item.reparar_dientes === true,
    codigoReparacion: item.codigo_reparacion,
    precioReparacionPorDiente: aNumero(item.precio_reparacion_por_diente),
    // En venta el precio tipeado es UNITARIO, así que no hay total directo:
    // dejarlo acá haría que 3 unidades a $100 se facturaran $100.
    precioTotalDirecto: esVenta ? 0 : aNumero(item.precio_total),
    // El afilado se cobra en pesos siempre; sólo la venta puede ir en dólares.
    moneda: esVenta ? item.moneda : 'ARS',
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

/**
 * Cuando una carga produce varias notas, cada una avisa con cuáles va.
 * "Va con nota de pedido 000011, 000012".
 */
export function avisoDeNotasHermanas(
  numeros: Array<number | null>,
  propio: number | null,
): string | null {
  const otras = numeros.filter((n): n is number => n !== null && n !== propio)
  if (otras.length === 0) return null
  const lista = otras.map((n) => String(n).padStart(6, '0')).join(', ')
  return `Va con nota de pedido ${lista}`
}

/** "$ 1.234,56" — formato argentino, que es como se lee la nota. */
export function formatearPesos(valor: number | null | undefined): string {
  if (valor === null || valor === undefined || !Number.isFinite(valor)) return ''
  return `$ ${valor.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** Deja sólo dígitos, coma y punto: el campo de precio no acepta letras. */
export function soloNumeros(texto: string): string {
  return texto.replace(/[^\d.,]/g, '')
}
