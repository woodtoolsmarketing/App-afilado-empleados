import {
  ESTILOS_NOTA_PEDIDO,
  ETIQUETA_MOTIVO_NO_VISITA,
  formatearFechaCorta,
  formatearHora,
  generarDocumentoImpresion,
  notaImprimibleDesdeFila,
  type OpcionesImpresion,
  type ParadaCompleta,
  type RenglonRolDeVisita,
  type RolDeVisitaParaImprimir,
} from '@woodtools/compartido'
import * as FileSystem from 'expo-file-system'
import * as Print from 'expo-print'
import * as Sharing from 'expo-sharing'

import { supabase } from '../nucleo/supabase'
import { obtenerJornadaDeHoy } from './jornada'
import { obtenerNota } from './notasPedido'

/**
 * Impresión inalámbrica.
 *
 * Dos caminos, y el orden importa:
 *
 *  1. **Directo por IPP a la impresora de la oficina.** Es lo que pidieron: el
 *     celular en la misma red manda el trabajo a una IP fija y sale por la
 *     impresora, sin diálogos ni pasos intermedios. Sirve para el caso real —
 *     el vendedor llega, toca "imprimir" y las notas ya lo están esperando.
 *
 *  2. **Diálogo del sistema**, si lo anterior falla. Android descubre
 *     impresoras de red por su cuenta, así que sigue siendo inalámbrico; sólo
 *     pide un toque más. Vale como red de contención cuando cambió la IP o la
 *     impresora está apagada.
 *
 * El PDF se genera igual en los dos casos, así que lo que sale por la
 * impresora es idéntico a lo que se exporta.
 */

// Puerto estándar de IPP. El de RAW/JetDirect es el 9100, pero IPP da
// confirmación del trabajo y JetDirect no: si el papel se acabó, con RAW nunca
// nos enteramos.
const PUERTO_IPP = 631

export interface ConfiguracionImpresora {
  ip: string
  puerto: number
  ruta: string
}

export async function obtenerImpresora(): Promise<ConfiguracionImpresora | null> {
  const { data, error } = await supabase
    .from('configuracion')
    .select('valor')
    .eq('clave', 'impresora_oficina')
    .maybeSingle()

  // Devolver null hace caer la impresión al diálogo del sistema, que es lo
  // correcto. Pero "no hay IP" y "no pude leerla" se ven igual desde afuera, y
  // el segundo caso —una cuenta suspendida, por ejemplo— hay que poder verlo.
  if (error) console.warn('[impresion] no pudimos leer la configuración de la impresora', error)

  const cfg = data?.valor as { ip?: string; puerto?: number; ruta?: string } | undefined
  if (!cfg?.ip) return null

  return {
    ip: cfg.ip,
    puerto: cfg.puerto ?? PUERTO_IPP,
    ruta: cfg.ruta ?? '/ipp/print',
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Codificación IPP
//
// IPP es un protocolo binario sobre HTTP. El cuerpo lleva una cabecera de
// versión y operación, después los atributos agrupados por tipo, y al final el
// documento. Se implementa acá lo mínimo para "Print-Job" (0x0002), que es lo
// único que necesitamos.
// ─────────────────────────────────────────────────────────────────────────────

const ETIQUETA_OPERACION = 0x01
const ETIQUETA_TRABAJO = 0x02
const FIN_ATRIBUTOS = 0x03

const TIPO_CHARSET = 0x47
const TIPO_IDIOMA = 0x48
const TIPO_URI = 0x45
const TIPO_NOMBRE = 0x42
const TIPO_MIME = 0x49

function texto(valor: string): number[] {
  return Array.from(new TextEncoder().encode(valor))
}

function atributo(tipo: number, nombre: string, valor: string): number[] {
  const n = texto(nombre)
  const v = texto(valor)
  return [
    tipo,
    (n.length >> 8) & 0xff, n.length & 0xff, ...n,
    (v.length >> 8) & 0xff, v.length & 0xff, ...v,
  ]
}

function armarPeticionIpp(uriImpresora: string, usuario: string, documento: Uint8Array): Uint8Array {
  const cabecera = [
    0x02, 0x00,             // IPP 2.0
    0x00, 0x02,             // Print-Job
    0x00, 0x00, 0x00, 0x01, // id de la petición
  ]

  const atributos = [
    ETIQUETA_OPERACION,
    ...atributo(TIPO_CHARSET, 'attributes-charset', 'utf-8'),
    ...atributo(TIPO_IDIOMA, 'attributes-natural-language', 'es-ar'),
    ...atributo(TIPO_URI, 'printer-uri', uriImpresora),
    ...atributo(TIPO_NOMBRE, 'requesting-user-name', usuario),
    ...atributo(TIPO_NOMBRE, 'job-name', 'WoodTools - Notas de pedido'),
    ...atributo(TIPO_MIME, 'document-format', 'application/pdf'),
    FIN_ATRIBUTOS,
  ]

  const salida = new Uint8Array(cabecera.length + atributos.length + documento.length)
  salida.set(cabecera, 0)
  salida.set(atributos, cabecera.length)
  salida.set(documento, cabecera.length + atributos.length)
  return salida
}

/** Lee el status-code de la respuesta IPP (bytes 2 y 3). 0x0000–0x00ff = OK. */
function respuestaIppCorrecta(cuerpo: Uint8Array): boolean {
  if (cuerpo.length < 4) return false
  const estado = (cuerpo[2] << 8) | cuerpo[3]
  return estado <= 0x00ff
}

async function imprimirPorIpp(
  impresora: ConfiguracionImpresora,
  pdfUri: string,
  usuario: string,
): Promise<void> {
  const base64 = await FileSystem.readAsStringAsync(pdfUri, {
    encoding: FileSystem.EncodingType.Base64,
  })
  const binario = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))

  const uri = `ipp://${impresora.ip}:${impresora.puerto}${impresora.ruta}`
  const peticion = armarPeticionIpp(uri, usuario, binario)

  // IPP viaja sobre HTTP: el esquema ipp:// es el mismo host y puerto.
  //
  // El fetch de React Native manda cuerpos binarios sin problema, pero sus
  // tipos sólo declaran string / FormData / Blob. El cast es por la definición
  // de tipos, no por el comportamiento.
  const respuesta = await fetch(`http://${impresora.ip}:${impresora.puerto}${impresora.ruta}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/ipp' },
    body: peticion as unknown as BodyInit,
  })

  if (!respuesta.ok) {
    throw new Error(`La impresora respondió ${respuesta.status}`)
  }

  const cuerpo = new Uint8Array(await respuesta.arrayBuffer())
  if (!respuestaIppCorrecta(cuerpo)) {
    throw new Error('La impresora rechazó el trabajo. Fijate si tiene papel o está en pausa.')
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Armado del documento
// ─────────────────────────────────────────────────────────────────────────────

// El mapeo de la fila de la base al talonario vive en el paquete compartido:
// lo usan también el panel y el probador, y si cada uno arma el suyo la columna
// de doble uso se interpreta distinto en cada lado.

// ─────────────────────────────────────────────────────────────────────────────
// El rol de visita del día
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Qué se escribe en "RESULTADO (OBSERVACIONES)".
 *
 * Cuando el destino no se visitó, el motivo va adelante: en la planilla de
 * papel un renglón sin ningún tilde de "tipo de visita" y sin explicación no se
 * distingue de uno que quedó sin hacer.
 */
function resultadoDeParada(p: ParadaCompleta): string {
  const v = p.visita
  if (!v) return ''
  if (v.visitado) return v.observacion
  const motivo = v.motivo_no_visita ? ETIQUETA_MOTIVO_NO_VISITA[v.motivo_no_visita] : 'Sin visitar'
  return `NO VISITADO — ${motivo}. ${v.observacion}`
}

function aRolImprimible(
  jornada: { observaciones_jornada: string | null; fecha: string },
  paradas: ParadaCompleta[],
  vendedor: { nombre: string; codigo: string | null },
): RolDeVisitaParaImprimir {
  const renglones: RenglonRolDeVisita[] = paradas.map((p) => ({
    numero: p.orden,
    hora: p.llegada_en ? formatearHora(p.llegada_en) : '',
    cliente_numero: p.cliente?.codigo ?? '',
    razon_social: p.cliente?.razon_social ?? p.razon_social_snapshot ?? '',
    direccion: p.direccion?.direccion_formateada ?? p.direccion_snapshot ?? '',
    vendio: p.visita?.vendio ?? false,
    cobro: p.visita?.cobro ?? false,
    retiro_afilado: p.visita?.retiro_afilado ?? false,
    entrego: p.visita?.entrego ?? false,
    contacto: p.visita?.contacto_nombre ?? p.cliente?.contacto_nombre ?? '',
    resultado: resultadoDeParada(p),
  }))

  return {
    // La fecha viene como `date` de Postgres: al mediodía para que el huso no
    // la corra un día para atrás.
    fecha: formatearFechaCorta(`${jornada.fecha}T12:00:00`),
    vendedor: vendedor.nombre,
    vendedor_numero: vendedor.codigo ?? '',
    paradas: renglones,
    visitadas: paradas.filter((p) => p.visita?.visitado === true).length,
    no_visitadas: paradas.filter((p) => p.visita?.visitado === false).length,
    observaciones_jornada: jornada.observaciones_jornada ?? '',
  }
}

/** Devuelve null cuando el vendedor no armó recorrido hoy: no hay nada que sumar. */
async function rolDeVisitaDeHoy(vendedorId: string): Promise<RolDeVisitaParaImprimir | null> {
  const jornada = await obtenerJornadaDeHoy(vendedorId)
  if (!jornada || jornada.paradas.length === 0) return null

  const { data: perfil } = await supabase
    .from('perfiles')
    .select('nombre_completo, codigo_vendedor')
    .eq('id', vendedorId)
    .maybeSingle()

  return aRolImprimible(jornada.jornada, jornada.paradas, {
    nombre: perfil?.nombre_completo ?? '',
    codigo: perfil?.codigo_vendedor ?? null,
  })
}

export interface ResultadoImpresion {
  mensaje: string
  uri?: string
  via: 'ipp' | 'sistema' | 'pdf'
  /** Lo que se pidió y no se pudo incluir. Se avisa, no se falla. */
  advertencia?: string
}

/**
 * Imprime (o exporta) las notas indicadas.
 *
 * De cada nota salen las dos copias del talonario: el ORIGINAL —con logo si es
 * factura, sin logo si es presupuesto— y el DUPLICADO sin precios para el
 * taller.
 *
 * Con `incluirRolDeVisita` se suma adelante la planilla del día. Es un solo
 * trabajo de impresión: el vendedor toca una vez y se lleva la jornada entera,
 * en vez de imprimir la planilla en la oficina y las notas por separado.
 */
export async function imprimirNotas(params: {
  notaIds: string[]
  incluirRolDeVisita?: boolean
  comoPdf?: boolean
}): Promise<ResultadoImpresion> {
  if (params.notaIds.length === 0) throw new Error('No hay notas para imprimir')

  const { data: sesionActual } = await supabase.auth.getSession()
  const vendedorId = sesionActual.session?.user.id

  const notas = await Promise.all(params.notaIds.map(obtenerNota))

  const paginas = notas.flatMap((n) => {
    const imprimible = notaImprimibleDesdeFila(n as Record<string, any>)
    const conLogo = (n as Record<string, any>).tipo_nota === 'factura'
    // El logo va en las DOS copias de una factura, como en el talonario
    // preimpreso: el original del cliente y el duplicado del taller.
    const opciones: OpcionesImpresion[] = [
      { copia: 'original', conLogo },
      { copia: 'duplicado', conLogo },
    ]
    return opciones.map((o) => ({ nota: imprimible, opciones: o }))
  })

  // Que el rol no salga no puede frenar la impresión de las notas: se avisa y
  // el trabajo sigue. El vendedor está parado frente a la impresora.
  let rolDeVisita: RolDeVisitaParaImprimir | null = null
  let advertencia: string | undefined

  if (params.incluirRolDeVisita) {
    if (!vendedorId) {
      advertencia = 'No pudimos sumar el rol de visita: no hay sesión.'
    } else {
      try {
        rolDeVisita = await rolDeVisitaDeHoy(vendedorId)
        if (!rolDeVisita) {
          advertencia = 'Hoy no armaste recorrido, así que salieron sólo las notas.'
        }
      } catch {
        advertencia = 'No pudimos traer el rol de visita. Salieron sólo las notas.'
      }
    }
  }

  const html = generarDocumentoImpresion(paginas, { rolDeVisita: rolDeVisita ?? undefined })
  const { uri } = await Print.printToFileAsync({ html, base64: false })

  if (params.comoPdf) {
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' })
    }
    return { mensaje: 'PDF generado', uri, via: 'pdf', advertencia }
  }

  const cuantas = `${notas.length} nota${notas.length === 1 ? '' : 's'}`
  const conRol = rolDeVisita ? ' y el rol de visita' : ''
  const impresora = await obtenerImpresora()

  if (impresora) {
    try {
      await imprimirPorIpp(
        impresora,
        uri,
        sesionActual.session?.user.email ?? 'woodtools',
      )
      return {
        mensaje: `Se ${notas.length === 1 ? 'envió' : 'enviaron'} ${cuantas}${conRol} a la impresora ${impresora.ip}.`,
        uri,
        via: 'ipp',
        advertencia,
      }
    } catch (e) {
      console.warn('[impresion] IPP directo falló, se abre el diálogo del sistema', e)
    }
  }

  // Sin IP configurada o con la impresora inalcanzable: Android igual descubre
  // impresoras de red, así que sigue siendo inalámbrico.
  await Print.printAsync({ uri })
  return {
    mensaje: impresora
      ? `No pudimos alcanzar la impresora ${impresora.ip}. Se abrió el diálogo del sistema.`
      : 'Elegí la impresora en el diálogo. Para imprimir directo, cargá la IP en Configuración.',
    uri,
    via: 'sistema',
    advertencia,
  }
}

export { ESTILOS_NOTA_PEDIDO }
