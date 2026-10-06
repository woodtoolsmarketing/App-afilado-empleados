import http from 'node:http'

/**
 * Hablar IPP con la impresora de la oficina, desde el proceso principal.
 *
 * ─── Por qué esto vive acá y no se reusa el del teléfono ─────────────────────
 *
 * El mismo protocolo ya está armado en `apps/movil/src/servicios/ipp.ts`, pero
 * aquél corre en React Native —`fetch` de RN, `expo-network`, `AsyncStorage`— y
 * éste corre en Node, sin navegador. La **codificación IPP es un formato de
 * bytes sobre HTTP y no cambia**: las dos versiones arman exactamente los mismos
 * bytes, y si se toca una hay que tocar la otra. Lo que cambia es el transporte:
 * acá `http` de Node.
 *
 * A diferencia del teléfono, acá NO se barre la red buscando la impresora. El
 * teléfono lo hace porque el vendedor está parado frente a la impresora y ve si
 * sale el papel; en la oficina la nota se manda y el operador se va, así que
 * mandarla "a la primera que conteste IPP" podría sellarla como impresa habiendo
 * salido por otro aparato. Se usa la IP cargada y nada más: si no contesta, el
 * handler cae al diálogo del sistema.
 *
 * ─── Por qué no lo hace el renderer ──────────────────────────────────────────
 *
 * Un `fetch` del navegador a `http://ip:631/ipp/print` con `Content-Type:
 * application/ipp` dispara un preflight CORS que una impresora no contesta, y el
 * navegador corta el pedido sin siquiera mandarlo. El proceso principal no tiene
 * CORS: manda el POST y listo.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Codificación IPP (idéntica, byte por byte, a la del teléfono)
//
// IPP es binario sobre HTTP: cabecera de versión y operación, después los
// atributos agrupados por tipo, y al final el documento.
// ─────────────────────────────────────────────────────────────────────────────

const ETIQUETA_OPERACION = 0x01
/** El grupo de atributos DEL TRABAJO: `media`, escala. Fuera de él la impresora los descarta. */
const ETIQUETA_TRABAJO = 0x02
const FIN_ATRIBUTOS = 0x03

const TIPO_CHARSET = 0x47
const TIPO_IDIOMA = 0x48
const TIPO_URI = 0x45
const TIPO_NOMBRE = 0x42
const TIPO_MIME = 0x49
/** `keyword`: valores de un vocabulario cerrado, como el nombre de un papel. */
const TIPO_PALABRA = 0x44

const OPERACION_IMPRIMIR = 0x0002
const OPERACION_ATRIBUTOS = 0x000b

/**
 * El papel, con el nombre normalizado del PWG. Sin esto la impresora usa el
 * suyo por defecto —en muchas, Carta de fábrica—, y la nota, que es A4, sale
 * corrida: recortada arriba y con blanco abajo.
 */
const PAPEL_A4 = 'iso_a4_210x297mm'

export const PUERTO_IPP = 631
export const RUTA_IPP = '/ipp/print'

/** A la impresora: si está en la red, contesta en decenas de ms. */
const ESPERA_IMPRESION_MS = 6_000

export interface Impresora {
  ip: string
  puerto: number
  ruta: string
}

function bytes(valor: string): number[] {
  return Array.from(Buffer.from(valor, 'utf8'))
}

function atributo(tipo: number, nombre: string, valor: string): number[] {
  const n = bytes(nombre)
  const v = bytes(valor)
  return [
    tipo,
    (n.length >> 8) & 0xff, n.length & 0xff, ...n,
    (v.length >> 8) & 0xff, v.length & 0xff, ...v,
  ]
}

function peticion(
  operacion: number,
  uriImpresora: string,
  extra: number[],
  documento?: Buffer,
  /** Atributos del trabajo. Van en su propio grupo o no se aplican. */
  trabajo: number[] = [],
): Buffer {
  const cabecera = [
    0x02, 0x00, // IPP 2.0
    (operacion >> 8) & 0xff, operacion & 0xff,
    0x00, 0x00, 0x00, 0x01, // id de la petición
  ]

  const atributos = [
    ETIQUETA_OPERACION,
    ...atributo(TIPO_CHARSET, 'attributes-charset', 'utf-8'),
    ...atributo(TIPO_IDIOMA, 'attributes-natural-language', 'es-ar'),
    ...atributo(TIPO_URI, 'printer-uri', uriImpresora),
    ...extra,
    ...(trabajo.length > 0 ? [ETIQUETA_TRABAJO, ...trabajo] : []),
    FIN_ATRIBUTOS,
  ]

  return Buffer.concat([
    Buffer.from(cabecera),
    Buffer.from(atributos),
    documento ?? Buffer.alloc(0),
  ])
}

function peticionImprimir(uriImpresora: string, usuario: string, documento: Buffer): Buffer {
  return peticion(
    OPERACION_IMPRIMIR,
    uriImpresora,
    [
      ...atributo(TIPO_NOMBRE, 'requesting-user-name', usuario),
      ...atributo(TIPO_NOMBRE, 'job-name', 'WoodTools - Cola de impresión'),
      ...atributo(TIPO_MIME, 'document-format', 'application/pdf'),
    ],
    documento,
    // La nota entra exacta en una A4: `print-scaling: none` es "imprimila tal
    // cual, punto por punto". Una impresora que no lo entienda lo ignora y queda
    // como antes; IPP manda reportarlo como no soportado, no rechazar el trabajo.
    [
      ...atributo(TIPO_PALABRA, 'media', PAPEL_A4),
      ...atributo(TIPO_PALABRA, 'print-scaling', 'none'),
    ],
  )
}

/** "¿Estás ahí?" en IPP. No imprime: pide los atributos de la impresora. */
function peticionAtributos(uriImpresora: string): Buffer {
  return peticion(OPERACION_ATRIBUTOS, uriImpresora, [])
}

/** Lee el status-code de la respuesta IPP (bytes 2 y 3). 0x0000–0x00ff = OK. */
function respuestaIppCorrecta(cuerpo: Buffer): boolean {
  if (cuerpo.length < 4) return false
  const estado = (cuerpo[2] << 8) | cuerpo[3]
  return estado <= 0x00ff
}

// ─────────────────────────────────────────────────────────────────────────────
// Transporte y red
// ─────────────────────────────────────────────────────────────────────────────

function uriDe(imp: Impresora): string {
  return `ipp://${imp.ip}:${imp.puerto}${imp.ruta}`
}

/** POST de un cuerpo IPP con límite de tiempo. Devuelve la respuesta cruda. */
function postIpp(imp: Impresora, cuerpo: Buffer, ms: number): Promise<Buffer> {
  return new Promise((resolver, rechazar) => {
    const pedido = http.request(
      {
        host: imp.ip,
        port: imp.puerto,
        path: imp.ruta,
        method: 'POST',
        headers: {
          'Content-Type': 'application/ipp',
          'Content-Length': cuerpo.length,
        },
      },
      (respuesta) => {
        if ((respuesta.statusCode ?? 0) >= 400) {
          respuesta.resume()
          rechazar(new Error(`La impresora respondió ${respuesta.statusCode}`))
          return
        }
        const trozos: Buffer[] = []
        respuesta.on('data', (d: Buffer) => trozos.push(d))
        respuesta.on('end', () => resolver(Buffer.concat(trozos)))
      },
    )
    // Un POST a una IP de la red local que no existe se queda colgado hasta que
    // el sistema se cansa —más de un minuto—; el límite lo corta antes.
    pedido.setTimeout(ms, () => pedido.destroy(new Error('La impresora no contestó a tiempo')))
    pedido.on('error', rechazar)
    pedido.end(cuerpo)
  })
}

/**
 * ¿Hay una impresora IPP viva en esa dirección? No imprime nada: pide los
 * atributos de la impresora.
 *
 * Es el chequeo que separa "la impresora no está" de "la impresora está pero
 * rechazó el trabajo": si contesta, el handler le manda el trabajo y confía en
 * lo que IPP responda; si no contesta, cae al diálogo sin haber mandado nada.
 */
export async function contestaIpp(imp: Impresora, ms = ESPERA_IMPRESION_MS): Promise<boolean> {
  try {
    const cuerpo = await postIpp(imp, peticionAtributos(uriDe(imp)), ms)
    // Que conteste HTTP no alcanza: cualquier cosa puede escuchar en el 631. Lo
    // que confirma que es una impresora es que la respuesta sea IPP.
    return respuestaIppCorrecta(cuerpo)
  } catch {
    return false
  }
}

/** Manda el PDF a la impresora. Lanza si la impresora rechaza el trabajo. */
export async function imprimirPorIpp(imp: Impresora, pdf: Buffer, usuario: string): Promise<void> {
  const cuerpo = await postIpp(imp, peticionImprimir(uriDe(imp), usuario, pdf), ESPERA_IMPRESION_MS)
  if (!respuestaIppCorrecta(cuerpo)) {
    throw new Error('La impresora rechazó el trabajo. Fijate si tiene papel o está en pausa.')
  }
}
