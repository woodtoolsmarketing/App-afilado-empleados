import {
  A4_ALTO_PT,
  A4_ANCHO_PT,
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
import { PixelRatio } from 'react-native'

import { supabase } from '../nucleo/supabase'
import {
  buscarEnLaRed,
  contestaIpp,
  ESPERA_IMPRESION_MS,
  estadoDeRed,
  fetchConLimite,
  peticionImprimir,
  PUERTO_IPP,
  recordarImpresora,
  respuestaIppCorrecta,
  ultimaImpresora,
} from './ipp'
import { obtenerJornadaDeHoy } from './jornada'
import { obtenerNota } from './notasPedido'

/**
 * Impresión inalámbrica.
 *
 * Tres caminos, y el orden importa:
 *
 *  1. **Directo por IPP a la impresora de la oficina.** Es lo que pidieron: el
 *     celular en la misma red manda el trabajo y sale por la impresora, sin
 *     diálogos ni pasos intermedios. Sirve para el caso real — el vendedor
 *     llega, toca "imprimir" y las notas ya lo están esperando.
 *
 *  2. **Buscarla en la red**, si la dirección conocida no contesta. El router
 *     reparte las direcciones por DHCP y la de la impresora puede cambiar sola;
 *     que eso obligue a llamar a la oficina sería absurdo.
 *
 *  3. **Diálogo del sistema**, si nada de lo anterior anduvo. Android descubre
 *     impresoras de red por su cuenta, así que sigue siendo inalámbrico; sólo
 *     pide un toque más.
 *
 * El PDF se genera igual en los tres casos, así que lo que sale por la
 * impresora es idéntico a lo que se exporta.
 */

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

/**
 * A qué dirección mandarle el trabajo, ahora.
 *
 * Prueba, en orden: la que este teléfono usó la última vez con éxito, la que
 * tiene cargada la oficina, y —si ninguna contesta— la busca en la red. La
 * primera está primero porque si ayer la impresora estaba en .152, hoy sigue
 * estando ahí, y probar eso cuesta medio segundo contra los ocho de un barrido.
 *
 * Devuelve null cuando no hay forma: sin wifi, o con la impresora apagada.
 */
async function ubicarImpresora(
  configurada: ConfiguracionImpresora | null,
  alAvisar?: (mensaje: string) => void,
): Promise<{ impresora: ConfiguracionImpresora; descubierta: boolean } | null> {
  const red = await estadoDeRed()

  // Con datos móviles no hay red local que valga: una IP 192.168.x.x no lleva a
  // ningún lado y el intento sólo agrega demora.
  if (!red.enWifi) return null

  const puerto = configurada?.puerto ?? PUERTO_IPP
  const ruta = configurada?.ruta ?? '/ipp/print'

  // La de la oficina va PRIMERO. La que este teléfono recordó de un barrido
  // anterior queda de respaldo: si alguna vez la impresora estuvo en otra
  // dirección y volvió a la de siempre, empezar por la recordada sería probar
  // la vieja antes que la buena.
  const candidatas = [configurada?.ip, await ultimaImpresora()].filter(
    (ip, i, todas): ip is string => !!ip && todas.indexOf(ip) === i,
  )

  // Hasta acá no se decía nada, y probar dos candidatas cuesta casi dos
  // segundos con la impresora apagada: el vendedor tocaba IMPRIMIR y la
  // pantalla se quedaba quieta sin explicación.
  if (candidatas.length > 0) alAvisar?.('Probando la impresora de siempre…')

  for (const ip of candidatas) {
    if (await contestaIpp(ip, puerto, ruta)) {
      return { impresora: { ip, puerto, ruta }, descubierta: false }
    }
  }

  if (!red.ip) return null

  /**
   * El barrido con su avance.
   *
   * Son 253 direcciones de a 24 por tanda, casi un segundo cada una: unos diez
   * segundos mirando un cartel fijo que decía "Buscando la impresora en la
   * red…" sin moverse nunca. Diez segundos sin señales de vida es tiempo de
   * sobra para creer que la app se colgó y matarla —justo antes de que
   * encuentre la impresora—.
   *
   * `buscarEnLaRed` ya avisaba el avance por `alAvanzar`; lo que faltaba era
   * escucharlo.
   */
  alAvisar?.(
    candidatas.length > 0
      ? 'No contestó. Buscando la impresora en la red…'
      : 'Buscando la impresora en la red…',
  )
  const encontrada = await buscarEnLaRed({
    ipDelTelefono: red.ip,
    puerto,
    ruta,
    ipConocida: candidatas[0] ?? null,
    alAvanzar: (revisadas, total) =>
      alAvisar?.(`Buscando la impresora en la red… ${revisadas} de ${total} direcciones`),
  })

  if (!encontrada) return null

  await recordarImpresora(encontrada)
  return { impresora: { ip: encontrada, puerto, ruta }, descubierta: true }
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
  const cuerpoPeticion = peticionImprimir(uri, usuario, binario)

  // IPP viaja sobre HTTP: el esquema ipp:// es el mismo host y puerto.
  //
  // El fetch de React Native manda cuerpos binarios sin problema, pero sus
  // tipos sólo declaran string / FormData / Blob. El cast es por la definición
  // de tipos, no por el comportamiento.
  const respuesta = await fetchConLimite(
    `http://${impresora.ip}:${impresora.puerto}${impresora.ruta}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/ipp' },
      body: cuerpoPeticion as unknown as BodyInit,
    },
    ESPERA_IMPRESION_MS,
  )

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
  /**
   * ¿Sabemos que el papel salió?
   *
   * Sólo por IPP, que responde con el estado del trabajo. El diálogo del
   * sistema de Android vuelve apenas se abre —no cuando el usuario imprime o
   * cancela—, así que por esa vía no hay forma de saberlo, y marcar las notas
   * como impresas ahí las sacaba de la cola aunque el vendedor hubiera
   * cancelado. Con `false`, la pantalla pregunta en vez de asumir.
   */
  confirmado: boolean
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
  /** Para contar qué está pasando cuando hay que buscar la impresora. */
  alAvisar?: (mensaje: string) => void
  /**
   * Abre el diálogo de impresión de Android en vez de fallar.
   *
   * Es la salida de emergencia y va apagada: la impresión la hace la app
   * contra la impresora de la oficina, sin mandar al vendedor a otra pantalla.
   * Sólo se prende cuando lo pide él, desde el botón que aparece si el intento
   * directo no salió.
   */
  usarDialogoDelSistema?: boolean
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

  // El tamaño de letra del teléfono le llega al WebView que arma el PDF, y
  // agranda las letras sin agrandar las cajas en milímetros. Pasándole cuánto
  // agranda, la plantilla lo descuenta y la hoja sale igual en todos lados.
  const html = generarDocumentoImpresion(paginas, {
    rolDeVisita: rolDeVisita ?? undefined,
    escalaDeLetra: PixelRatio.getFontScale(),
  })
  // El tamaño de hoja va explícito: sin esto `expo-print` arma el PDF en hoja
  // Carta —su default— y la impresora lo achica para meterlo en una A4.
  const { uri } = await Print.printToFileAsync({
    html,
    base64: false,
    width: A4_ANCHO_PT,
    height: A4_ALTO_PT,
  })

  if (params.comoPdf) {
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' })
    }
    // Un PDF guardado no es una nota impresa: no se marca nada.
    return { mensaje: 'PDF generado', uri, via: 'pdf', advertencia, confirmado: false }
  }

  const cuantas = `${notas.length} nota${notas.length === 1 ? '' : 's'}`
  const conRol = rolDeVisita ? ' y el rol de visita' : ''

  const configurada = await obtenerImpresora()
  const ubicada = await ubicarImpresora(configurada, params.alAvisar)

  if (ubicada) {
    try {
      await imprimirPorIpp(
        ubicada.impresora,
        uri,
        sesionActual.session?.user.email ?? 'woodtools',
      )
      const donde = ubicada.descubierta
        ? `la impresora, que hoy está en ${ubicada.impresora.ip}`
        : `la impresora ${ubicada.impresora.ip}`
      return {
        mensaje: `Se ${notas.length === 1 ? 'envió' : 'enviaron'} ${cuantas}${conRol} a ${donde}.`,
        uri,
        via: 'ipp',
        confirmado: true,
        advertencia: ubicada.descubierta
          ? [advertencia, `La IP cargada en la oficina quedó vieja: ahora es ${ubicada.impresora.ip}.`]
              .filter(Boolean)
              .join(' ')
          : advertencia,
      }
    } catch (e) {
      // La impresora contestó pero rechazó el trabajo: sin papel, en pausa,
      // con la bandeja abierta. Ese mensaje es más útil que cualquier cosa que
      // podamos deducir después, así que sube tal cual.
      console.warn('[impresion] la impresora rechazó el trabajo', e)
      if (!params.usarDialogoDelSistema) {
        throw new Error(
          e instanceof Error && e.message
            ? `${e.message} (${ubicada.impresora.ip})`
            : `No pudimos imprimir en ${ubicada.impresora.ip}.`,
        )
      }
    }
  }

  // ── No se pudo imprimir directo ─────────────────────────────────────────
  //
  // Acá terminaba abriendo el diálogo de impresión de Android. Eso sacaba al
  // vendedor de la app —otra pantalla, otra lista de impresoras, otro toque— y
  // hacía difícil distinguir "no llegué a la impresora" de "elegiste mal en el
  // diálogo". La impresión es de la app: si no salió, lo dice y se puede
  // reintentar sin irse a ningún lado.
  //
  // El diálogo del sistema queda como salida explícita, no automática: la
  // pantalla lo ofrece como un botón aparte.
  const red = await estadoDeRed()

  if (!params.usarDialogoDelSistema) {
    const donde = configurada ? ` en ${configurada.ip}` : ''
    throw new Error(
      !red.conectado
        ? 'El teléfono no tiene conexión. Conectate al wifi de la oficina y volvé a intentar.'
        : !red.enWifi
          ? 'Estás con datos móviles. La impresora de la oficina está en la red local: conectate a ese wifi y volvé a intentar.'
          : configurada
            ? `No pudimos alcanzar la impresora${donde}, y tampoco la encontramos en esta red. Fijate que esté encendida y en el mismo wifi.`
            : 'No hay ninguna impresora cargada. Pedile a la oficina que cargue la IP en el panel.',
    )
  }

  await Print.printAsync({ uri })
  return {
    mensaje:
      'Se abrió el diálogo de impresión de Android. Cuando termine, confirmá si salió el papel.',
    uri,
    via: 'sistema',
    advertencia,
    confirmado: false,
  }
}

export { ESTILOS_NOTA_PEDIDO }
