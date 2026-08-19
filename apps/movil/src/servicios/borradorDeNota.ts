import type {
  CondicionVenta,
  FormularioItemNota,
  FormularioNotaEncabezado,
  TipoNotaPedido,
  TipoServicio,
} from '@woodtools/compartido'

import { cacheLocal } from '../nucleo/supabase'

/**
 * La nota a medio cargar, guardada en el teléfono.
 *
 * ─── Qué problema resuelve, y no es el que parece ────────────────────────────
 *
 * Esto NO es para trabajar sin señal. Es para que no se pierda el trabajo, que
 * es algo que pasa **hoy, con señal y todo**.
 *
 * Mientras se carga una nota, todo vive en la memoria de la pantalla y en
 * ningún otro lado: el encabezado, los doce renglones, las observaciones. Si
 * entra una llamada y Android se queda con la memoria, si el vendedor toca
 * atrás sin querer, si se le apaga el teléfono — se perdió la carga entera y
 * hay que empezar de nuevo con el cliente enfrente.
 *
 * En el código ya estaba reconocido a medias: hay un guardián que avisa antes
 * de salir de la pantalla, pero **sólo cuando se está corrigiendo una nota**,
 * con el comentario "creando, lo que se pierde es un formulario en blanco". Eso
 * era cierto cuando el formulario tenía cuatro campos. Con doce renglones de
 * sierra circular, cada uno con sus medidas, ya no lo es.
 *
 * ─── Por qué es además el cimiento de lo que viene ───────────────────────────
 *
 * Una cola para subir notas cargadas sin señal necesita exactamente esto: el
 * formulario entero convertido a JSON y devuelto a la pantalla intacto. Hacerlo
 * acá primero —con la app online, sin tocar el talonario y sin riesgo de
 * duplicar un comprobante— deja probado lo difícil. Lo que faltará después es
 * decidir cuándo mandarlo.
 *
 * ─── Qué NO se guarda ────────────────────────────────────────────────────────
 *
 * Sólo lo que el vendedor cargó. Nada de lo que la pantalla puede volver a
 * calcular o a pedir: el paso en el que iba, cuál renglón estaba abierto, los
 * errores de validación, la cotización del dólar. Guardar eso sería guardar
 * basura que después hay que mantener sincronizada con la pantalla.
 *
 * Y NO se guarda mientras se corrige una nota ya creada: ahí lo que hay en la
 * pantalla salió del servidor, y un borrador viejo encima de una nota real es
 * peor que no tener borrador.
 */

const CLAVE = 'borrador_nota_pedido'

/**
 * Cuánto vale un borrador antes de ser un estorbo.
 *
 * Un día. Al vendedor le sirve para recuperar lo de hace un rato, no lo del
 * martes pasado: una nota de hace tres días tiene precios viejos y un cliente
 * que ya se fue. Ofrecérsela sería ofrecerle un problema.
 */
const VENCE_A_LAS_HORAS = 24

export interface BorradorDeNota {
  encabezado: FormularioNotaEncabezado
  servicios: TipoServicio[]
  tipoNota: TipoNotaPedido | null
  condicionVenta: CondicionVenta | null
  condicionDetalle: string
  /** ISO, o null si todavía no se eligió. */
  fechaEntrega: string | null
  items: FormularioItemNota[]
  observaciones: string[]
  /** Cuándo se guardó, para poder decir "hace 20 minutos" y para que caduque. */
  guardadoEn: number
}

/** Lo que la pantalla manda a guardar: lo mismo, sin la marca de tiempo. */
export type BorradorParaGuardar = Omit<BorradorDeNota, 'guardadoEn'>

/**
 * ¿Hay algo que valga la pena guardar?
 *
 * Un formulario recién abierto ya tiene un renglón vacío y el nombre del
 * vendedor puesto: guardar eso dejaría un borrador que al día siguiente le
 * ofrece al vendedor "recuperar" una nota en blanco, y lo entrena a decir que
 * no. Se guarda cuando hay algo del cliente o algo cargado en un renglón.
 */
export function valeLaPenaGuardar(b: BorradorParaGuardar): boolean {
  const enc = b.encabezado
  const hayCliente = !!(
    enc.cliente_id ||
    enc.cliente_codigo.trim() ||
    enc.cliente_nombre.trim() ||
    enc.datos_cliente.trim() ||
    enc.descripcion_herramienta.trim()
  )
  const hayRenglon = b.items.some(
    (i) => i.herramienta || i.descripcion?.trim() || i.codigo_herramienta?.trim(),
  )
  return hayCliente || hayRenglon
}

export async function guardarBorrador(b: BorradorParaGuardar): Promise<void> {
  try {
    const paquete: BorradorDeNota = { ...b, guardadoEn: Date.now() }
    await cacheLocal.setItem(CLAVE, JSON.stringify(paquete))
  } catch {
    // Que no se pueda guardar el borrador no puede romper la carga: es una red
    // de seguridad, no parte del camino.
  }
}

export async function leerBorrador(): Promise<BorradorDeNota | null> {
  try {
    const crudo = await cacheLocal.getItem(CLAVE)
    if (!crudo) return null

    const b = JSON.parse(crudo) as BorradorDeNota
    if (!b || typeof b.guardadoEn !== 'number' || !Array.isArray(b.items)) return null
    if (Date.now() - b.guardadoEn > VENCE_A_LAS_HORAS * 60 * 60 * 1000) {
      await olvidarBorrador()
      return null
    }
    return b
  } catch {
    return null
  }
}

export async function olvidarBorrador(): Promise<void> {
  await cacheLocal.removeItem(CLAVE).catch(() => undefined)
}

/** "hace 20 minutos", "hace 3 horas". Para que el vendedor sepa qué le ofrecen. */
export function haceCuanto(guardadoEn: number): string {
  const minutos = Math.max(1, Math.round((Date.now() - guardadoEn) / 60000))
  if (minutos < 60) return `hace ${minutos} minuto${minutos === 1 ? '' : 's'}`
  const horas = Math.round(minutos / 60)
  return `hace ${horas} hora${horas === 1 ? '' : 's'}`
}
