import {
  A4_ALTO_PT,
  A4_ANCHO_PT,
  ESTILOS_NOTA_PEDIDO,
  fechaLocalISO,
  formatearFechaCorta,
  formatearPesos,
  generarDocumentoImpresion,
  notaImprimibleDesdeFila,
  entregasDePedidoPorParada,
  resumenesDePedidoPorParada,
  rolImprimibleDesdeFilas,
  type NotaEntrega,
  type NotaSuelta,
  type OpcionesImpresion,
  type PlanillaCobranzasParaImprimir,
  type RenglonCobranza,
  type RolDeVisitaParaImprimir,
} from '@woodtools/compartido'
import * as FileSystem from 'expo-file-system'
import * as Print from 'expo-print'
import { PixelRatio } from 'react-native'

import { supabase } from '../nucleo/supabase'
import { cobranzasDelDia, hoyLocal, marcarCobranzasImpresas, type Cobranza } from './cobranzas'
import {
  buscarEnLaRed,
  contestaIpp,
  ESPERA_IMPRESION_MS,
  ESPERA_SONDEO_DIRECTO_MS,
  estadoDeRed,
  fetchConLimite,
  peticionImprimir,
  PUERTO_IPP,
  recordarImpresora,
  respuestaIppCorrecta,
  ultimaImpresora,
} from './ipp'
import { obtenerJornadaDe } from './jornada'
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
 * Dos caminos, según haya o no una impresora cargada en la oficina:
 *
 *   · CON impresora configurada (el caso normal hoy): esa IP es la ÚNICA
 *     candidata. Se la sondea; si contesta, se imprime ahí. Si no contesta, se
 *     devuelve null SIN barrer la red —barrer podría encontrar una impresora
 *     vieja que quedó prendida (la .167) y mandarle el papel a la equivocada—.
 *   · SIN impresora configurada: se prueba la que este teléfono usó la última
 *     vez con éxito y, si no contesta, se barre la red como descubrimiento.
 *
 * Devuelve null cuando no hay forma de ubicarla: sin wifi, con la configurada
 * apagada/movida de IP, o sin encontrar ninguna en el barrido. El llamador
 * (`entregarDocumento`) traduce ese null en un aviso al vendedor.
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

  // Con impresora cargada en la oficina, es la ÚNICA candidata: no se prueba una
  // IP recordada de un barrido viejo. Esa recordada podía ser una impresora que
  // ya no es la de la oficina (una vieja que quedó prendida), y mandarle el papel
  // ahí imprime en la equivocada —justo el problema de la .167 que aborta—. La
  // recordada sólo se usa como descubrimiento cuando NO hay ninguna configurada.
  const recordada = configurada?.ip ? null : await ultimaImpresora()
  const candidatas = configurada?.ip ? [configurada.ip] : recordada ? [recordada] : []

  // Hasta acá no se decía nada, y sondear las candidatas puede tardar unos
  // segundos con la impresora apagada: el vendedor tocaba IMPRIMIR y la
  // pantalla se quedaba quieta sin explicación.
  if (candidatas.length > 0) alAvisar?.('Probando la impresora de siempre…')

  // A la impresora conocida se la espera con el límite LARGO
  // (`ESPERA_SONDEO_DIRECTO_MS`), no con los 900 ms del barrido: la cargada en
  // la oficina puede tardar más de un segundo en contestar (la HP tarda ~1,2 s),
  // y con el límite corto se la daba por muerta y se mandaba el papel a otra
  // impresora. Son pocas candidatas, así que esperar vale la pena.
  for (const ip of candidatas) {
    if (await contestaIpp(ip, puerto, ruta, ESPERA_SONDEO_DIRECTO_MS)) {
      return { impresora: { ip, puerto, ruta }, descubierta: false }
    }
  }

  // Con una impresora configurada NO se barre la red: aceptar la primera que
  // conteste IPP imprime en cualquier impresora vieja que haya quedado prendida.
  // Si la configurada no contesta, se devuelve null y el llamador avisa que no
  // se la pudo alcanzar (sin adivinar otra IP, para no pegarle a la .167).
  if (configurada?.ip) return null

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
 * El rol de visita de un vendedor en una fecha, listo para imprimir.
 *
 * Devuelve null cuando ese día no armó recorrido: no hay nada que sumar.
 */
async function rolDeVisitaDe(
  vendedorId: string,
  fecha: string,
): Promise<RolDeVisitaParaImprimir | null> {
  const jornada = await obtenerJornadaDe(vendedorId, fecha)
  if (!jornada || jornada.paradas.length === 0) return null

  const { data: perfil } = await supabase
    .from('perfiles')
    .select('nombre_completo, codigo_vendedor')
    .eq('id', vendedorId)
    .maybeSingle()

  // El resumen del pedido con la cantidad al día, rearmado desde las notas: así
  // el conteo ("3× 300x96") sale aunque la visita se haya registrado con una app
  // vieja que lo guardaba sin contar. Si no se pueden traer las notas (sin señal),
  // se degrada solo: el rol sale con el texto congelado de cada visita.
  const notas = await notasDelDiaParaResumen(vendedorId, fecha).catch(() => [])
  const resumenCompleto = resumenesDePedidoPorParada(
    jornada.paradas.map((p) => ({
      id: p.id,
      cliente_id: p.cliente_id,
      direccion_id: p.direccion_id,
    })),
    notas,
  )

  // "Entregué": lo que hay que entregarle al cliente —las pendientes con
  // fecha_entrega ese día o ANTES (se arrastran hasta que se entreguen), más las
  // entregadas ese mismo día—. En el teléfono el vendedor ve SÓLO sus propias
  // notas (RLS), así que salen sus entregas; la oficina las ve todas. Si falla
  // la consulta, el rol sale sin el bloque (no frena la impresión).
  const clienteIds = [
    ...new Set(jornada.paradas.map((p) => p.cliente_id).filter(Boolean)),
  ] as string[]
  let entregas: NotaEntrega[] = []
  if (clienteIds.length > 0) {
    const { data } = await supabase
      .from('notas_pedido')
      .select(
        'id, numero, parada_id, cliente_id, direccion_id, cliente_codigo, fecha_entrega, entregada_en, items:notas_pedido_items ( servicio, herramienta, cantidad, cantidad_dientes, detalle )',
      )
      .or(
        `and(estado.eq.impresa,fecha_entrega.lte.${fecha}),and(estado.eq.entregada,fecha_entrega.eq.${fecha})`,
      )
      .in('cliente_id', clienteIds)
    entregas = (data ?? []) as unknown as NotaEntrega[]
  }
  const entregasPorParada = entregasDePedidoPorParada(
    jornada.paradas.map((p) => ({ id: p.id, cliente_id: p.cliente_id, direccion_id: p.direccion_id })),
    entregas,
  )

  return rolImprimibleDesdeFilas(
    jornada.jornada,
    jornada.paradas,
    {
      nombre: perfil?.nombre_completo ?? '',
      codigo: perfil?.codigo_vendedor ?? null,
    },
    resumenCompleto,
    { entregasPorParada },
  )
}

/**
 * Las notas de ese día del vendedor, con sus renglones, para recalcular el
 * resumen del pedido en el rol. Mismo armado que el panel
 * (`notas-sueltas-rol`): la ventana es el día local (Argentina no tiene horario
 * de verano) y se descartan las anuladas.
 */
async function notasDelDiaParaResumen(vendedorId: string, fecha: string): Promise<NotaSuelta[]> {
  const desde = new Date(`${fecha}T00:00:00`)
  const hasta = new Date(desde)
  hasta.setDate(hasta.getDate() + 1)
  const { data, error } = await supabase
    .from('notas_pedido')
    .select(
      'parada_id, cliente_id, direccion_id, creado_en, items:notas_pedido_items ( servicio, herramienta, cantidad, cantidad_dientes, detalle )',
    )
    .eq('vendedor_id', vendedorId)
    .neq('estado', 'anulada')
    .gte('creado_en', desde.toISOString())
    .lt('creado_en', hasta.toISOString())
  if (error) throw error
  return (data ?? []) as unknown as NotaSuelta[]
}

/** El de hoy: lo usa la impresión del rol solo, desde ROL DE VISITA. */
async function rolDeVisitaDeHoy(vendedorId: string): Promise<RolDeVisitaParaImprimir | null> {
  return rolDeVisitaDe(vendedorId, fechaLocalISO(new Date()))
}

// ─────────────────────────────────────────────────────────────────────────────
// Las cobranzas del día
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Una planilla de cobranzas imprimible, de un comprobante en un día.
 *
 * Mismo armado que el panel (`CobranzasVendedores`): un renglón por cobro, con
 * el cheque y el efectivo en blanco cuando son cero —una columna de ceros se lee
 * como si hubiera pasado algo— y el TOTAL GENERAL abajo. El formato se comparte
 * para que la hoja salida del teléfono sea idéntica a la que arma la oficina.
 */
function armarPlanillaCobros(
  cobros: Cobranza[],
  esPresupuesto: boolean,
  fecha: string,
  vendedorNumero: string,
): PlanillaCobranzasParaImprimir {
  const renglones: RenglonCobranza[] = cobros.map((c) => ({
    cliente_codigo: c.cliente_codigo ?? '',
    cliente_nombre: c.cliente_nombre,
    total: formatearPesos(c.total),
    cheque: c.cheque > 0 ? formatearPesos(c.cheque) : '',
    efectivo: c.efectivo > 0 ? formatearPesos(c.efectivo) : '',
    retenciones: c.retenciones > 0 ? formatearPesos(c.retenciones) : '',
    comentarios: c.comentarios ?? '',
  }))
  // Subtotales por columna para el pie: la suma de cheque, de efectivo y de
  // retenciones. En blanco cuando dan 0 (misma regla que por fila).
  const sumaCheque = cobros.reduce((suma, c) => suma + c.cheque, 0)
  const sumaEfectivo = cobros.reduce((suma, c) => suma + c.efectivo, 0)
  const sumaRetenciones = cobros.reduce((suma, c) => suma + c.retenciones, 0)
  return {
    vendedor_numero: vendedorNumero,
    esPresupuesto,
    fecha: formatearFechaCorta(`${fecha}T12:00:00`),
    cobros: renglones,
    total_general: formatearPesos(cobros.reduce((suma, c) => suma + c.total, 0)),
    total_cheque: sumaCheque > 0 ? formatearPesos(sumaCheque) : '',
    total_efectivo: sumaEfectivo > 0 ? formatearPesos(sumaEfectivo) : '',
    total_retenciones: sumaRetenciones > 0 ? formatearPesos(sumaRetenciones) : '',
  }
}

/**
 * Las planillas de cobranzas de esos días: una por FACTURA y otra por
 * PRESUPUESTO (sólo las que tienen cobros), por cada día y en orden, igual que
 * la oficina las separa en el panel.
 *
 * Devuelve [] cuando no hubo cobros en ninguno de esos días: no hay nada que
 * rendir y no se imprime una hoja vacía, igual que el rol cuando no hay recorrido.
 */
async function planillasDeCobranzasDe(
  dias: string[],
  vendedorNumero: string,
): Promise<PlanillaCobranzasParaImprimir[]> {
  const planillas: PlanillaCobranzasParaImprimir[] = []
  for (const dia of dias) {
    const cobros = await cobranzasDelDia(dia)
    const facturas = cobros.filter((c) => c.tipo_comprobante === 'factura')
    const presupuestos = cobros.filter((c) => c.tipo_comprobante === 'presupuesto')
    if (facturas.length > 0) {
      planillas.push(armarPlanillaCobros(facturas, false, dia, vendedorNumero))
    }
    if (presupuestos.length > 0) {
      planillas.push(armarPlanillaCobros(presupuestos, true, dia, vendedorNumero))
    }
  }
  return planillas
}

/** Une partes en castellano: ["a"]→"a"; ["a","b"]→"a y b"; ["a","b","c"]→"a, b y c". */
function frase(partes: string[]): string {
  if (partes.length <= 1) return partes.join('')
  return `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}`
}

/**
 * Cuánto agranda la letra el sistema, con un cerco.
 *
 * `PixelRatio.getFontScale()` es `Dimensions.get('window').fontScale ||
 * PixelRatio.get()`: si el sistema no informa la escala, devuelve **la
 * densidad de pantalla**, que es otra cosa completamente distinta y en este
 * teléfono vale 2,81. Con ese número la plantilla dibujaría la hoja 2,81 veces
 * más grande y la achicaría otro tanto, y saldría toda la letra diminuta, sin
 * que nada avisara.
 *
 * Hoy en Android no pasa —`Configuration.fontScale` siempre viene cargado— pero
 * el respaldo existe y no cuesta nada taparlo. Fuera del rango que puede tener
 * un ajuste de letra de verdad, se imprime como si no hubiera ajuste: que la
 * hoja salga bien es más importante que compensar un número que no entendemos.
 */
/**
 * Arma el PDF, con un reintento.
 *
 * `printToFileAsync` falla de vez en cuando con "An error occured while writing
 * the PDF data": el WebView que usa `expo-print` se crea suelto, sin pantalla, y
 * a veces se lo llevan puesto antes de que Chromium termine de escribir. Visto
 * en el teléfono: el primer intento falló y el segundo, idéntico, salió bien.
 *
 * Reintentar es gratis y no imprime nada: acá sólo se escribe un archivo en la
 * carpeta temporal de la app. La alternativa era un cartel de error delante de
 * un vendedor parado frente a la impresora, por algo que se arregla solo
 * volviendo a intentar.
 *
 * El tamaño de hoja va explícito: sin eso `expo-print` arma el PDF en hoja
 * Carta —su default— y la impresora lo achica para meterlo en una A4.
 */
async function armarPdf(html: string): Promise<{ uri: string }> {
  const opciones = { html, base64: false, width: A4_ANCHO_PT, height: A4_ALTO_PT }
  try {
    return await Print.printToFileAsync(opciones)
  } catch (e) {
    console.warn('[impresion] falló el primer intento de armar el PDF; se reintenta', e)
    return await Print.printToFileAsync(opciones)
  }
}

function escalaDeLetraDelSistema(): number {
  const escala = PixelRatio.getFontScale()
  if (!Number.isFinite(escala) || escala < 0.5 || escala > 2.5) return 1
  return escala
}

export interface ResultadoImpresion {
  mensaje: string
  uri?: string
  /**
   * Por dónde salió el papel. Hoy sólo queda la impresora de la oficina por
   * IPP: por seguridad se sacaron la exportación a PDF (compartir) y el diálogo
   * de impresión de Android, que permitía "Guardar como PDF" y elegir cualquier
   * impresora/Drive. La impresión directa es la única salida.
   */
  via: 'ipp'
  /** Lo que se pidió y no se pudo incluir. Se avisa, no se falla. */
  advertencia?: string
  /**
   * ¿Sabemos que el papel salió? Sólo por IPP, que responde con el estado del
   * trabajo. Siempre true por este camino.
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
 * Con `incluirRolDeVisita` se suma adelante la planilla del día, y con
 * `incluirCobros` la rendición de lo cobrado. Es un solo trabajo de impresión:
 * el vendedor toca una vez y se lleva la jornada entera —las notas, el rol y lo
 * que cobró— en vez de imprimir cada cosa por separado.
 */
export async function imprimirNotas(params: {
  notaIds: string[]
  incluirRolDeVisita?: boolean
  /**
   * Suma adelante la rendición de cobranzas de esos días, una planilla por
   * comprobante (FACTURA / PRESUPUESTO). Es la misma hoja que la oficina imprime
   * del panel, pero sale del teléfono junto con las notas.
   */
  incluirCobros?: boolean
  /** Para contar qué está pasando cuando hay que buscar la impresora. */
  alAvisar?: (mensaje: string) => void
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

  // Los días en que se hicieron las notas que se imprimen, del más viejo al más
  // nuevo. El rol y la rendición de cobranzas se suman por CADA uno de esos días,
  // no sólo el de hoy: el vendedor que imprime a la noche lo que cargó en varios
  // días se lleva la planilla de cada uno. Los días salen de `creado_en` de cada
  // nota, en hora local.
  const dias = Array.from(
    new Set(
      notas.map((n) => fechaLocalISO(new Date((n as Record<string, any>).creado_en as string))),
    ),
  ).sort()

  // Que un extra —el rol o la rendición— no salga no puede frenar la impresión
  // de las notas: se avisa y el trabajo sigue. El vendedor está parado frente a
  // la impresora. Las advertencias se juntan y se muestran todas juntas.
  const advertencias: string[] = []

  let rolesDeVisita: RolDeVisitaParaImprimir[] = []
  if (params.incluirRolDeVisita) {
    if (!vendedorId) {
      advertencias.push('No pudimos sumar el rol de visita: no hay sesión.')
    } else {
      try {
        const roles = await Promise.all(dias.map((d) => rolDeVisitaDe(vendedorId, d)))
        rolesDeVisita = roles.filter((r): r is RolDeVisitaParaImprimir => r !== null)
        if (rolesDeVisita.length === 0) {
          advertencias.push(
            dias.length <= 1
              ? 'Ese día no tenías recorrido armado, así que salió sin el rol de visita.'
              : 'No encontramos recorrido en esos días, así que salió sin el rol de visita.',
          )
        }
      } catch {
        advertencias.push('No pudimos traer el rol de visita. Salieron las notas sin él.')
      }
    }
  }

  // La rendición de cobranzas de esos días, una planilla por comprobante. Misma
  // hoja que arma la oficina en el panel, pero sale del teléfono con las notas.
  let planillasCobranzas: PlanillaCobranzasParaImprimir[] = []
  if (params.incluirCobros) {
    if (!vendedorId) {
      advertencias.push('No pudimos sumar los cobros: no hay sesión.')
    } else {
      try {
        const { data: perfil } = await supabase
          .from('perfiles')
          .select('codigo_vendedor')
          .eq('id', vendedorId)
          .maybeSingle()
        planillasCobranzas = await planillasDeCobranzasDe(dias, perfil?.codigo_vendedor ?? '')
        if (planillasCobranzas.length === 0) {
          advertencias.push(
            dias.length <= 1
              ? 'Ese día no cargaste cobros, así que salió sin la planilla de cobranzas.'
              : 'No cargaste cobros en esos días, así que salió sin la planilla de cobranzas.',
          )
        }
      } catch {
        advertencias.push('No pudimos traer los cobros del día. Salieron las notas sin ellos.')
      }
    }
  }

  // El tamaño de letra del teléfono le llega al WebView que arma el PDF y
  // agranda las letras sin agrandar las cajas en milímetros. Pasándole cuánto
  // agranda, la plantilla dibuja toda la hoja a esa misma escala y la devuelve
  // a tamaño de papel con un transform. Ver `conMedidasEscaladas`.
  const escalaDeLetra = escalaDeLetraDelSistema()

  // Se deja registrado qué escala vio la app en el momento de imprimir.
  //
  // Sin esto no hay forma de distinguir dos causas que dejan el mismo papel
  // mal impreso: que la app haya leído mal el tamaño de letra del sistema, o
  // que lo haya leído bien y el WebView no respete la compensación. Se
  // averiguaba imprimiendo, que cuesta una hoja por intento; en el registro
  // sale gratis.
  console.warn(
    `[impresion] escala de letra=${escalaDeLetra} · densidad=${PixelRatio.get()} · ` +
      `8.5pt compensado=${(8.5 / escalaDeLetra).toFixed(2)}pt`,
  )

  const html = generarDocumentoImpresion(paginas, {
    rolesDeVisita,
    planillasCobranzas,
    escalaDeLetra,
  })

  // "2 notas, el rol de visita y los cobros del día": las notas siempre, y cada
  // extra sólo si de verdad se sumó alguna hoja.
  const cuantas = `${notas.length} nota${notas.length === 1 ? '' : 's'}`
  const extras: string[] = []
  if (rolesDeVisita.length > 0) {
    extras.push(rolesDeVisita.length === 1 ? 'el rol de visita' : 'los roles de visita')
  }
  if (planillasCobranzas.length > 0) extras.push('los cobros del día')

  const resultado = await entregarDocumento(html, {
    queSalio: frase([cuantas, ...extras]),
    plural: notas.length !== 1,
    nombreDelArchivo: 'notas-de-pedido',
    alAvisar: params.alAvisar,
    advertencia: advertencias.length > 0 ? advertencias.join(' ') : undefined,
  })

  // La rendición salió por la impresora de la oficina (confirmado por IPP): a
  // partir de acá esos cobros quedan cerrados y el vendedor ya no los corrige.
  // Sólo se sella lo CONFIRMADO: el diálogo de Android y el PDF no dicen si el
  // papel salió, y cerrar un cobro que quizá no se imprimió es peor que dejarlo
  // editable. Es lo mejor posible: si falla, el próximo sello lo toma.
  if (resultado.confirmado && planillasCobranzas.length > 0) {
    try {
      await marcarCobranzasImpresas(dias)
    } catch {
      /* no es motivo para desdecir una impresión que sí salió */
    }
  }

  return resultado
}

/**
 * El camino por el que sale cualquier papel de esta app.
 *
 * Vive separado porque lo usan la nota de pedido y la planilla de cobranzas, y
 * porque el orden importa: se intenta la impresora de la oficina, y sólo si
 * falla —y sólo si lo pidieron— se abre el diálogo de Android. Escrito dos
 * veces, la segunda copia terminaría con otro orden o con otro mensaje de
 * error, que es exactamente lo que ya pasó con la lógica de qué páginas lleva
 * un trabajo.
 */
async function entregarDocumento(
  html: string,
  opciones: {
    /** Qué salió, para el mensaje: "2 notas y el rol de visita". */
    queSalio: string
    plural: boolean
    nombreDelArchivo: string
    alAvisar?: (mensaje: string) => void
    advertencia?: string
  },
): Promise<ResultadoImpresion> {
  const { data: sesionActual } = await supabase.auth.getSession()
  const advertencia = opciones.advertencia
  // El PDF se arma igual —es lo que se manda por IPP—, pero ya no se comparte
  // ni se abre en el diálogo del sistema: ésas eran las salidas a "Guardar como
  // PDF" y se cerraron por seguridad.
  const { uri } = await armarPdf(html)

  const configurada = await obtenerImpresora()
  const ubicada = await ubicarImpresora(configurada, opciones.alAvisar)

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
        mensaje: `Se ${opciones.plural ? 'enviaron' : 'envió'} ${opciones.queSalio} a ${donde}.`,
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
      throw new Error(
        e instanceof Error && e.message
          ? `${e.message} (${ubicada.impresora.ip})`
          : `No pudimos imprimir en ${ubicada.impresora.ip}.`,
      )
    }
  }

  // ── No se pudo imprimir directo ─────────────────────────────────────────
  //
  // Antes, acá se abría el diálogo de impresión de Android como salida de
  // emergencia. Se sacó por seguridad: ese diálogo permitía "Guardar como PDF"
  // y elegir cualquier impresora/Drive, que es justo lo que no queremos. Ahora
  // la única salida es la impresora de la oficina: si no se alcanzó, se explica
  // el motivo y se puede reintentar.
  const red = await estadoDeRed()
  const donde = configurada ? ` en ${configurada.ip}` : ''
  throw new Error(
    !red.conectado
      ? 'El teléfono no tiene conexión. Conectate al wifi de la oficina y volvé a intentar.'
      : !red.enWifi
        ? 'Estás con datos móviles. La impresora de la oficina está en la red local: conectate a ese wifi y volvé a intentar.'
        : configurada
          ? `No pudimos alcanzar la impresora de la oficina${donde}. Fijate que esté encendida y en el mismo wifi; si le cambió la dirección, actualizala en el panel.`
          : 'No hay ninguna impresora cargada. Pedile a la oficina que cargue la IP en el panel.',
  )
}

export { ESTILOS_NOTA_PEDIDO }

/**
 * Imprime la planilla del rol de visita del día.
 *
 * Es la misma hoja que arma la oficina en el panel —"Roles de Visita"— pero
 * salida del teléfono: sale sola, sin notas, por el mismo camino que todo el
 * resto (`entregarDocumento`), directo a la impresora de la oficina. Antes
 * también se podía compartir como PDF (WhatsApp); esa salida se cerró por
 * seguridad.
 *
 * Sin recorrido armado hoy no hay planilla: se avisa y no se genera una hoja
 * vacía, igual que la de cobranzas cuando no hay cobros.
 */
export async function imprimirRolDeVisita(params?: {
  alAvisar?: (mensaje: string) => void
}): Promise<ResultadoImpresion> {
  const { data: sesionActual } = await supabase.auth.getSession()
  const vendedorId = sesionActual.session?.user.id
  if (!vendedorId) throw new Error('No hay sesión')

  const rolDeVisita = await rolDeVisitaDeHoy(vendedorId)
  if (!rolDeVisita) {
    throw new Error('Hoy no armaste recorrido, así que no hay planilla para imprimir.')
  }

  const html = generarDocumentoImpresion([], {
    rolDeVisita,
    escalaDeLetra: escalaDeLetraDelSistema(),
  })

  return entregarDocumento(html, {
    queSalio: 'el rol de visita',
    plural: false,
    nombreDelArchivo: `rol-de-visita-${hoyLocal()}`,
    alAvisar: params?.alAvisar,
  })
}

/**
 * Imprime la rendición de cobranzas de un día, sola, directo a la impresora de
 * la oficina (mismo camino que todo el resto: `entregarDocumento`).
 *
 * Es la misma hoja que arma la oficina en el panel —y la que sale pegada a las
 * notas con "SUMAR LOS COBROS DEL DÍA"—, pero salida sola desde el teléfono. La
 * usa el botón de la pantalla COBRANZAS, que sólo ve el vendedor que la oficina
 * habilitó (`perfiles.imprime_cobranzas`); el resto nada más manda la rendición
 * a la cola.
 *
 * Sin cobros ese día no hay planilla: se avisa y no se genera una hoja vacía,
 * igual que el rol sin recorrido.
 *
 * Al confirmarse la impresión (IPP responde que salió), esos cobros quedan
 * sellados como impresos y el vendedor ya no los corrige, igual que cuando la
 * rendición sale pegada a las notas.
 */
export async function imprimirCobranzas(params: {
  fecha: string
  alAvisar?: (mensaje: string) => void
}): Promise<ResultadoImpresion> {
  const { data: sesionActual } = await supabase.auth.getSession()
  const vendedorId = sesionActual.session?.user.id
  if (!vendedorId) throw new Error('No hay sesión')

  const { data: perfil } = await supabase
    .from('perfiles')
    .select('codigo_vendedor')
    .eq('id', vendedorId)
    .maybeSingle()

  const planillasCobranzas = await planillasDeCobranzasDe(
    [params.fecha],
    perfil?.codigo_vendedor ?? '',
  )
  if (planillasCobranzas.length === 0) {
    throw new Error('Ese día no cargaste cobros, así que no hay planilla para imprimir.')
  }

  const html = generarDocumentoImpresion([], {
    planillasCobranzas,
    escalaDeLetra: escalaDeLetraDelSistema(),
  })

  const resultado = await entregarDocumento(html, {
    queSalio: 'la rendición de cobranzas',
    plural: false,
    nombreDelArchivo: `cobranzas-${params.fecha}`,
    alAvisar: params.alAvisar,
  })

  // Confirmada la impresión, esos cobros quedan cerrados (pastilla IMPRESO).
  // Best-effort, como en imprimirNotas: una impresión que sí salió no se desdice
  // porque falle el sello; el próximo lo toma.
  if (resultado.confirmado) {
    try {
      await marcarCobranzasImpresas([params.fecha])
    } catch {
      /* el papel ya salió; el sello se reintenta */
    }
  }

  return resultado
}
