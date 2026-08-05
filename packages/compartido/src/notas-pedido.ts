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
  venta: [],
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
    'descripcion', 'cantidad_dientes', 'dientes_rotos',
    'precio_por_diente', 'precio_total',
  ],
  fresa: [
    'cantidad', 'diametro_exterior', 'ancho_corte', 'codigos_computo',
    'descripcion', 'cantidad_dientes', 'dientes_rotos',
    'precio_por_diente', 'precio_total',
  ],
  cabezal: [
    'cantidad', 'diametro_exterior', 'ancho_corte', 'codigos_computo',
    'descripcion', 'cantidad_dientes', 'dientes_rotos',
    'precio_por_diente', 'precio_total',
  ],
  incisor: [
    'cantidad', 'diametro_exterior', 'ancho_corte', 'codigos_computo',
    'descripcion', 'cantidad_dientes', 'afilado_reparacion',
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
// Formularios
// ─────────────────────────────────────────────────────────────────────────────

/** Encabezado de la nota: los datos del cliente. */
export interface FormularioNotaEncabezado {
  cliente_id: string | null
  cliente_codigo: string
  cliente_nombre: string
  cliente_cuit: string
  vendedor: string
  zona: string
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
  zona: '',
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

  // Comunes de servicio
  cantidad: string
  descripcion: string
  cantidad_dientes: string
  codigos_computo: string[]
  precio_por_diente: string
  precio_total: string

  // Medidas
  diametro_exterior: string
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
}

export const ITEM_VACIO: FormularioItemNota = {
  servicio: 'afilado',
  herramienta: null,
  codigo_herramienta: '',
  unidades: '',
  promocion: false,
  promocion_detalle: '',
  precio: '',
  cantidad: '',
  descripcion: '',
  cantidad_dientes: '',
  codigos_computo: [],
  precio_por_diente: '',
  precio_total: '',
  diametro_exterior: '',
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
}

// ─────────────────────────────────────────────────────────────────────────────
// Validación
// ─────────────────────────────────────────────────────────────────────────────

const ETIQUETA_CAMPO: Record<CampoItem, string> = {
  cantidad: 'la cantidad',
  diametro_exterior: 'el diámetro exterior',
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
  afilado_reparacion: '',
  codigos_computo: 'el código de cómputo',
  precio_por_diente: 'el precio por diente',
  precio_total: 'el precio total',
}

/** Los Si/No tienen "no" por defecto: nunca están "sin completar". */
const NO_OBLIGATORIOS: CampoItem[] = ['dientes_rotos', 'afilado_reparacion']

function esNumeroValido(v: string): boolean {
  if (!v.trim()) return false
  const n = Number(v.replace(',', '.'))
  return Number.isFinite(n) && n > 0
}

const CAMPOS_NUMERICOS = new Set<CampoItem>([
  'cantidad', 'diametro_exterior', 'diametro', 'ancho_corte', 'largo', 'ancho',
  'largo_util', 'espesor', 'paso', 'cantidad_dientes', 'precio_por_diente',
  'precio_total',
])

export function validarItemNota(
  item: FormularioItemNota,
): ResultadoValidacion<string> {
  const errores: Record<string, string> = {}

  if (item.servicio === 'venta') {
    if (!item.codigo_herramienta.trim()) {
      errores.codigo_herramienta = 'Ingresá el código de la herramienta'
    }
    if (!esNumeroValido(item.unidades)) {
      errores.unidades = 'Ingresá cuántas unidades'
    }
    if (!esNumeroValido(item.precio)) {
      errores.precio = 'Ingresá el precio'
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
    return [item.codigo_herramienta || 'Sin código', unidades > 0 ? `× ${unidades}` : null]
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

/** Lo que se factura por la nota entera: la suma de todos sus renglones. */
export function totalDeRenglones(items: FormularioItemNota[]): number {
  return items.reduce((suma, i) => suma + aNumero(i.precio_total || i.precio), 0)
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

export function validarEncabezadoNota(
  enc: FormularioNotaEncabezado,
  extra: {
    servicios: TipoServicio[]
    tipoNota: TipoNotaPedido | null
    fechaEntrega: string | null
  },
): ResultadoValidacion<CampoEncabezado> {
  const errores: Partial<Record<CampoEncabezado, string>> = {}

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

/**
 * Precio total de un renglón de afilado: precio por diente × cantidad de
 * dientes. Es la cuenta que pidieron y la que evita que el vendedor la haga a
 * mano en la calle.
 */
export function calcularTotalPorDientes(
  precioPorDiente: number,
  cantidadDientes: number,
): number {
  if (!Number.isFinite(precioPorDiente) || !Number.isFinite(cantidadDientes)) return 0
  return Math.round(precioPorDiente * cantidadDientes * 100) / 100
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
