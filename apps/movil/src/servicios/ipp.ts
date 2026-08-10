import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Network from 'expo-network'

/**
 * Hablar con la impresora de la oficina.
 *
 * Acá vive todo lo que es "encontrarla y saber si contesta"; el armado del
 * documento y la decisión de por dónde imprimir están en `impresion.ts`.
 *
 * ─── Qué problema resuelve ───────────────────────────────────────────────────
 *
 * Lo que se pidió es que el vendedor llegue, el teléfono se enganche al wifi de
 * la oficina y pueda imprimir. Sin nada de esto, entre esas dos cosas había tres
 * huecos:
 *
 *  1. **La IP fija.** Está cargada en la base y la asigna el router por DHCP. El
 *     día que la impresora arranque con otra, la app manda el trabajo a una
 *     dirección donde no hay nadie.
 *  2. **La espera.** Un `fetch` contra una IP de la red local que no existe no
 *     falla: se queda esperando hasta que el sistema se cansa, que puede ser
 *     más de un minuto. Con el vendedor parado frente a la impresora.
 *  3. **Los datos móviles.** Fuera de la oficina, la IP local no lleva a ningún
 *     lado, y el intento igual se hacía.
 *
 * Los tres se arreglan igual: tiempo límite corto, mirar primero en qué red
 * estamos, y si la IP conocida no contesta, buscarla en la red.
 */

/**
 * Puerto estándar de IPP. El de RAW/JetDirect es el 9100, pero IPP da
 * confirmación del trabajo y JetDirect no: si el papel se acabó, con RAW nunca
 * nos enteramos.
 */
export const PUERTO_IPP = 631

/**
 * Cuánto se espera a la impresora conocida antes de dar por perdido el intento.
 *
 * Es una impresora en la misma red: si está, contesta en decenas de
 * milisegundos. Seis segundos ya es generoso, y son seis segundos de alguien
 * mirando la pantalla.
 */
const ESPERA_IMPRESION_MS = 6_000

/** Para el barrido, donde se prueban decenas de direcciones a la vez. */
const ESPERA_SONDEO_MS = 900

/** De a cuántas direcciones por vez. Más que esto, Android empieza a cortar. */
const SONDEOS_EN_PARALELO = 24

const CLAVE_ULTIMA_IP = 'woodtools.impresora.ultima_ip'

// ─────────────────────────────────────────────────────────────────────────────
// Codificación IPP
//
// IPP es un protocolo binario sobre HTTP. El cuerpo lleva una cabecera de
// versión y operación, después los atributos agrupados por tipo, y al final el
// documento si la operación lo lleva.
// ─────────────────────────────────────────────────────────────────────────────

const ETIQUETA_OPERACION = 0x01
const FIN_ATRIBUTOS = 0x03

const TIPO_CHARSET = 0x47
const TIPO_IDIOMA = 0x48
const TIPO_URI = 0x45
const TIPO_NOMBRE = 0x42
const TIPO_MIME = 0x49

const OPERACION_IMPRIMIR = 0x0002
const OPERACION_ATRIBUTOS = 0x000b

function bytes(valor: string): number[] {
  return Array.from(new TextEncoder().encode(valor))
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
  documento?: Uint8Array,
): Uint8Array {
  const cabecera = [
    0x02, 0x00,                              // IPP 2.0
    (operacion >> 8) & 0xff, operacion & 0xff,
    0x00, 0x00, 0x00, 0x01,                  // id de la petición
  ]

  const atributos = [
    ETIQUETA_OPERACION,
    ...atributo(TIPO_CHARSET, 'attributes-charset', 'utf-8'),
    ...atributo(TIPO_IDIOMA, 'attributes-natural-language', 'es-ar'),
    ...atributo(TIPO_URI, 'printer-uri', uriImpresora),
    ...extra,
    FIN_ATRIBUTOS,
  ]

  const cuerpo = documento ?? new Uint8Array(0)
  const salida = new Uint8Array(cabecera.length + atributos.length + cuerpo.length)
  salida.set(cabecera, 0)
  salida.set(atributos, cabecera.length)
  salida.set(cuerpo, cabecera.length + atributos.length)
  return salida
}

export function peticionImprimir(
  uriImpresora: string,
  usuario: string,
  documento: Uint8Array,
): Uint8Array {
  return peticion(
    OPERACION_IMPRIMIR,
    uriImpresora,
    [
      ...atributo(TIPO_NOMBRE, 'requesting-user-name', usuario),
      ...atributo(TIPO_NOMBRE, 'job-name', 'WoodTools - Notas de pedido'),
      ...atributo(TIPO_MIME, 'document-format', 'application/pdf'),
    ],
    documento,
  )
}

/** "¿Estás ahí?" en IPP. No imprime nada: pide los datos de la impresora. */
function peticionAtributos(uriImpresora: string): Uint8Array {
  return peticion(OPERACION_ATRIBUTOS, uriImpresora, [])
}

/** Lee el status-code de la respuesta IPP (bytes 2 y 3). 0x0000–0x00ff = OK. */
export function respuestaIppCorrecta(cuerpo: Uint8Array): boolean {
  if (cuerpo.length < 4) return false
  const estado = (cuerpo[2] << 8) | cuerpo[3]
  return estado <= 0x00ff
}

// ─────────────────────────────────────────────────────────────────────────────
// Red
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Un `fetch` que se rinde a tiempo.
 *
 * Sin esto, una IP de la red local que no responde deja la promesa colgada
 * hasta que se agota el tiempo del sistema —más de un minuto— y en el medio no
 * hay nada que mostrar más que un spinner.
 */
export async function fetchConLimite(
  url: string,
  opciones: RequestInit,
  ms: number,
): Promise<Response> {
  const control = new AbortController()
  const reloj = setTimeout(() => control.abort(), ms)
  try {
    return await fetch(url, { ...opciones, signal: control.signal })
  } finally {
    clearTimeout(reloj)
  }
}

export interface EstadoDeRed {
  conectado: boolean
  /** Sólo por wifi se llega a una impresora de la red local. */
  enWifi: boolean
  /** La del teléfono, para saber en qué red está. */
  ip: string | null
}

export async function estadoDeRed(): Promise<EstadoDeRed> {
  try {
    const estado = await Network.getNetworkStateAsync()
    const enWifi = estado.type === Network.NetworkStateType.WIFI
    let ip: string | null = null
    if (enWifi) {
      try {
        ip = await Network.getIpAddressAsync()
      } catch {
        ip = null
      }
    }
    return { conectado: !!estado.isConnected, enWifi, ip }
  } catch {
    // Si no se puede saber, se asume lo optimista y se deja que el intento
    // hable: un permiso que falla no tiene por qué impedir imprimir.
    return { conectado: true, enWifi: true, ip: null }
  }
}

/** ¿Hay una impresora IPP viva en esa dirección? */
export async function contestaIpp(
  ip: string,
  puerto: number,
  ruta: string,
  ms = ESPERA_SONDEO_MS,
): Promise<boolean> {
  try {
    const respuesta = await fetchConLimite(
      `http://${ip}:${puerto}${ruta}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/ipp' },
        body: peticionAtributos(`ipp://${ip}:${puerto}${ruta}`) as unknown as BodyInit,
      },
      ms,
    )
    if (!respuesta.ok) return false
    // Que conteste HTTP no alcanza: cualquier cosa puede estar escuchando en el
    // 631. Lo que confirma que es una impresora es que la respuesta sea IPP.
    const cuerpo = new Uint8Array(await respuesta.arrayBuffer())
    return respuestaIppCorrecta(cuerpo)
  } catch {
    return false
  }
}

/**
 * Busca la impresora en la red del teléfono.
 *
 * Recorre el /24 —las 254 direcciones de una red de oficina típica— probando de
 * a veinticuatro por vez. Empieza por las vecinas de la última dirección
 * conocida: si el router le dio otra a la impresora, casi siempre es una cerca.
 *
 * Devuelve la primera que conteste IPP, o null si no hay ninguna. No es
 * descubrimiento por mDNS —eso necesita código nativo que Expo no trae— pero
 * resuelve el caso real, que es una IP que cambió adentro de la misma red.
 */
export async function buscarEnLaRed(params: {
  ipDelTelefono: string
  puerto: number
  ruta: string
  /** Para empezar a buscar cerca. */
  ipConocida?: string | null
  alAvanzar?: (revisadas: number, total: number) => void
}): Promise<string | null> {
  const partes = params.ipDelTelefono.split('.')
  if (partes.length !== 4) return null
  const prefijo = partes.slice(0, 3).join('.')

  const propio = Number(partes[3])
  const desde = Number(params.ipConocida?.split('.')[3]) || propio

  // Ordenadas por cercanía a la última conocida: 167, 166, 168, 165, 169…
  const finales = Array.from({ length: 254 }, (_, i) => i + 1)
    .filter((n) => n !== propio)
    .sort((a, b) => Math.abs(a - desde) - Math.abs(b - desde))

  for (let i = 0; i < finales.length; i += SONDEOS_EN_PARALELO) {
    const tanda = finales.slice(i, i + SONDEOS_EN_PARALELO)
    const resultados = await Promise.all(
      tanda.map(async (n) => {
        const ip = `${prefijo}.${n}`
        return (await contestaIpp(ip, params.puerto, params.ruta)) ? ip : null
      }),
    )
    params.alAvanzar?.(Math.min(i + SONDEOS_EN_PARALELO, finales.length), finales.length)

    const encontrada = resultados.find(Boolean)
    if (encontrada) return encontrada
  }

  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// Memoria de la última impresora
//
// La IP oficial vive en `configuracion`, y sólo un administrador puede
// cambiarla. Cuando el barrido encuentra la impresora en otra dirección, el
// teléfono se la guarda para él: la próxima vez arranca por ahí y no vuelve a
// barrer. Que la de la base quede desactualizada es algo que arregla la oficina,
// no el vendedor parado frente a la impresora.
// ─────────────────────────────────────────────────────────────────────────────

export async function recordarImpresora(ip: string): Promise<void> {
  try {
    await AsyncStorage.setItem(CLAVE_ULTIMA_IP, ip)
  } catch {
    // Que no se pueda guardar sólo cuesta un barrido más la próxima vez.
  }
}

export async function ultimaImpresora(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(CLAVE_ULTIMA_IP)
  } catch {
    return null
  }
}

export { ESPERA_IMPRESION_MS }
