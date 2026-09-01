/**
 * Los problemas que se reportan desde la app.
 *
 * ─── Por qué hay una lista y no un campo libre ───────────────────────────────
 *
 * Porque el campo libre ya existía: era el teléfono. "No me anda" dicho por
 * quince personas son quince llamadas y ningún patrón. Con una lista, el mismo
 * problema contado por quince personas se ve como quince del mismo motivo, y
 * eso es lo que decide qué se arregla primero.
 *
 * La lista sale de los módulos que la app tiene de verdad, no de categorías
 * inventadas: si algo falla, falla entrando, buscando un cliente, cargando una
 * nota, imprimiéndola, en el mapa, en las visitas o en las cobranzas.
 *
 * ─── Por qué igual hay un "Otro" ─────────────────────────────────────────────
 *
 * Porque la lista siempre está incompleta y obligar a encajar el problema en
 * una casilla equivocada es peor que no clasificarlo: se pierde el reporte y
 * además se ensucia la cuenta del motivo que se eligió por descarte.
 *
 * ─── Por qué el valor es texto y no un enum de la base ───────────────────────
 *
 * Para que agregar un motivo sea cambiar este archivo y publicar, y no una
 * migración. Los motivos van a cambiar a medida que se reporten cosas.
 */

export interface MotivoDeProblema {
  /** Lo que se guarda en `reportes_problema.motivo`. */
  valor: string
  /** Lo que se lee en el desplegable. */
  etiqueta: string
  /** Para que el que duda entre dos sepa cuál es. */
  descripcion?: string
}

/**
 * El motivo del enlace "¿No se te actualizó?".
 *
 * Vive acá y no escrito a mano en la pantalla de configuración porque es la
 * misma clave con la que después se cuentan: si en un lado dijera
 * `no_se_actualizo` y en el otro `no-actualiza`, serían dos problemas
 * distintos que en realidad son uno.
 */
export const MOTIVO_NO_SE_ACTUALIZO = 'no_se_actualizo'

export const MOTIVOS_DE_PROBLEMA: MotivoDeProblema[] = [
  {
    valor: 'no_entro',
    etiqueta: 'No puedo entrar a la app',
    descripcion: 'No toma la contraseña, o me saca de la sesión sola.',
  },
  {
    valor: 'cliente',
    etiqueta: 'No encuentro un cliente',
    descripcion: 'Lo busco por código o por nombre y no aparece.',
  },
  {
    valor: 'nota_carga',
    etiqueta: 'Un problema cargando una nota de pedido',
  },
  {
    valor: 'precio',
    etiqueta: 'Un precio o un código está mal',
    descripcion: 'La lista propone otra cosa, o el importe no cierra.',
  },
  {
    valor: 'impresion',
    etiqueta: 'La nota no sale por la impresora',
  },
  {
    valor: 'no_guarda',
    etiqueta: 'Algo que cargué no se guardó',
  },
  {
    valor: 'mapa',
    etiqueta: 'El mapa o el recorrido',
    descripcion: 'No me ubica, no traza la ruta, o marca mal la distancia.',
  },
  {
    valor: 'visitas',
    etiqueta: 'Un problema con las visitas del día',
  },
  {
    valor: 'cobranzas',
    etiqueta: 'Un problema con las cobranzas',
  },
  {
    valor: 'lenta',
    etiqueta: 'La app va lenta o se traba',
  },
  {
    valor: 'se_cierra',
    etiqueta: 'La app se cierra sola',
  },
  {
    valor: MOTIVO_NO_SE_ACTUALIZO,
    etiqueta: 'No se me actualizó la app',
    descripcion: 'Busqué actualizaciones y sigo con la versión vieja.',
  },
  {
    valor: 'otro',
    etiqueta: 'Otro',
    descripcion: 'Contalo con tus palabras en el campo de abajo.',
  },
]

/** El motivo que obliga a escribir de qué se trata. */
export const MOTIVO_OTRO = 'otro'

/** El rótulo de un motivo. Si el motivo es viejo o desconocido, se muestra tal cual. */
export function etiquetaDelMotivo(valor: string): string {
  return MOTIVOS_DE_PROBLEMA.find((m) => m.valor === valor)?.etiqueta ?? valor
}

export type EstadoReporte = 'nuevo' | 'en_revision' | 'resuelto' | 'descartado'

export const ETIQUETA_ESTADO_REPORTE: Record<EstadoReporte, string> = {
  nuevo: 'Nuevo',
  en_revision: 'En revisión',
  resuelto: 'Resuelto',
  descartado: 'Descartado',
}

/** Un problema reportado, tal como vuelve de la base. */
export interface ReporteProblema {
  id: string
  vendedor_id: string
  motivo: string
  detalle: string | null
  cuando_se_da: string | null
  pantalla: string | null
  version_app: string | null
  instalacion: string | null
  modelo: string | null
  estado: EstadoReporte
  respuesta: string | null
  atendido_por: string | null
  atendido_en: string | null
  creado_en: string
  actualizado_en: string
}
