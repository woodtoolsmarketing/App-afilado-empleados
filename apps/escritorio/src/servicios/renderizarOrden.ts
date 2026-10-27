import {
  fechaLocalISO,
  formatearFechaCorta,
  formatearPesos,
  generarDocumentoImpresion,
  generarDocumentoPlanillasCobranzas,
  notaImprimibleDesdeFila,
  entregasDePedidoPorParada,
  resumenesDePedidoPorParada,
  rolImprimibleDesdeFilas,
  type NotaEntrega,
  type NotaSuelta,
  type OpcionesImpresion,
  type ParadaCompleta,
  type PlanillaCobranzasParaImprimir,
  type RenglonCobranza,
  type RolDeVisitaParaImprimir,
} from '@woodtools/compartido'

import { supabase } from '../nucleo/supabase'

/**
 * Arma el documento a imprimir de una orden de la cola, sea del tipo que sea.
 *
 * Es el ÚNICO lugar que sabe cómo se dibuja cada cosa, para que el agente
 * automático y el botón manual de la cola impriman exactamente lo mismo. El
 * papel siempre lo arma esta máquina (Chromium a tamaño fijo), nunca el
 * teléfono: así la nota entra en la hoja igual todas las veces, sin el ajuste de
 * letra del equipo del vendedor en el medio.
 *
 * Devuelve null cuando no hay nada que imprimir (un rol de un día sin recorrido,
 * una rendición sin cobros): el agente cierra la orden sin mandar papel.
 */

/** Lo que devuelve `tomar_siguiente_orden` (la fila entera de ordenes_impresion). */
export interface OrdenImpresion {
  id: string
  tipo: 'nota' | 'rol' | 'cobranzas'
  nota_id: string | null
  pedida_por: string
  con_rol_de_visita: boolean
  parametros: { fecha?: string } | null
  estado: string
  creado_en: string
}

export interface DocumentoARenderizar {
  html: string
  tamano?: 'A4' | 'A5'
}

export async function renderizarOrden(orden: OrdenImpresion): Promise<DocumentoARenderizar | null> {
  if (orden.tipo === 'rol') return renderizarRol(orden)
  if (orden.tipo === 'cobranzas') return renderizarCobranzas(orden)
  return renderizarNota(orden)
}

/** Una descripción corta de la orden, para el estado en vivo y los mensajes. */
export function describirOrden(orden: OrdenImpresion): string {
  if (orden.tipo === 'rol') {
    return `Rol de visita del ${formatearFechaCorta(`${orden.parametros?.fecha}T12:00:00`)}`
  }
  if (orden.tipo === 'cobranzas') {
    return `Cobranzas del ${formatearFechaCorta(`${orden.parametros?.fecha}T12:00:00`)}`
  }
  return 'Nota de pedido'
}

// ─────────────────────────────────────────────────────────────────────────────
// Nota de pedido (opcionalmente con el rol del día)
// ─────────────────────────────────────────────────────────────────────────────

async function renderizarNota(orden: OrdenImpresion): Promise<DocumentoARenderizar | null> {
  if (!orden.nota_id) return null

  const { data: nota, error } = await supabase
    .from('notas_pedido')
    .select(
      '*, items:notas_pedido_items(*),' +
        ' vendedor:perfiles!notas_pedido_vendedor_id_fkey(nombre_completo, codigo_vendedor),' +
        ' direccion:direcciones!notas_pedido_direccion_id_fkey(etiqueta, principal)',
    )
    .eq('id', orden.nota_id)
    .single()
  if (error) throw error

  const fila = nota as unknown as Record<string, unknown>
  const imprimible = notaImprimibleDesdeFila(fila)
  // El logo va en las DOS copias de una factura, como el talonario preimpreso.
  const conLogo = fila.tipo_nota === 'factura'
  const copias: OpcionesImpresion[] = [
    { copia: 'original', conLogo },
    { copia: 'duplicado', conLogo },
  ]

  // El rol del día, si el vendedor lo pidió al encolar. La jornada es la del DÍA
  // EN QUE SE PIDIÓ (no la de hoy): si el pedido entró ayer y se imprime hoy, lo
  // que corresponde es el recorrido que produjo esa nota. Que no esté no frena
  // la nota: sale igual sin el rol.
  let rolDeVisita: RolDeVisitaParaImprimir | null = null
  if (orden.con_rol_de_visita) {
    try {
      rolDeVisita = await rolDeVisitaDe(orden.pedida_por, fechaLocalISO(new Date(orden.creado_en)))
    } catch {
      rolDeVisita = null
    }
  }

  // Sin `escalaDeLetra`: en la PC el navegador no le aplica el tamaño de letra
  // del sistema, así que no hay nada que descontar.
  const html = generarDocumentoImpresion(
    copias.map((o) => ({ nota: imprimible, opciones: o })),
    rolDeVisita ? { rolDeVisita } : undefined,
  )
  return { html }
}

// ─────────────────────────────────────────────────────────────────────────────
// Rol de visita suelto
// ─────────────────────────────────────────────────────────────────────────────

async function renderizarRol(orden: OrdenImpresion): Promise<DocumentoARenderizar | null> {
  const fecha = orden.parametros?.fecha
  if (!fecha) return null
  const rol = await rolDeVisitaDe(orden.pedida_por, fecha)
  if (!rol) return null
  return { html: generarDocumentoImpresion([], { rolDeVisita: rol }) }
}

/**
 * El rol de visita de un vendedor en una fecha, listo para imprimir.
 *
 * Mismo armado que hacía la cola para la nota (antes `rolDeVisitaDeLaOrden`),
 * pero por (vendedor, fecha) para que sirva también al rol suelto. Devuelve null
 * cuando ese día no hubo recorrido.
 */
async function rolDeVisitaDe(
  vendedorId: string,
  fecha: string,
): Promise<RolDeVisitaParaImprimir | null> {
  // OJO: se LANZA el error (no se traga). Si no, un fallo transitorio de la base
  // devuelve data:null y el rol se trataría como "no hubo recorrido" → la orden
  // se cerraría como impresa SIN salir en papel. Lanzando, el agente reintenta.
  const { data: jornada, error: errorJornada } = await supabase
    .from('roles_visita')
    .select('id, fecha, observaciones_jornada')
    .eq('vendedor_id', vendedorId)
    .eq('fecha', fecha)
    .maybeSingle<{ id: string; fecha: string; observaciones_jornada: string | null }>()
  if (errorJornada) throw errorJornada
  if (!jornada) return null

  const { data: paradas, error: errorParadas } = await supabase
    .from('paradas')
    .select('*, cliente:clientes ( * ), direccion:direcciones ( * ), visita:visitas ( * )')
    .eq('rol_visita_id', jornada.id)
    .order('orden')
  if (errorParadas) throw errorParadas
  if (!paradas || paradas.length === 0) return null

  // `visita` viene como arreglo por la relación uno-a-uno de PostgREST.
  const completas = (paradas as Array<Record<string, unknown>>).map((p) => ({
    ...p,
    visita: Array.isArray(p.visita) ? (p.visita[0] ?? null) : p.visita,
  })) as ParadaCompleta[]

  const { data: perfil } = await supabase
    .from('perfiles')
    .select('nombre_completo, codigo_vendedor')
    .eq('id', vendedorId)
    .maybeSingle<{ nombre_completo: string; codigo_vendedor: string | null }>()

  // Las notas de ese día, para rearmar el resumen del pedido con la cantidad al
  // día ("3× 300x96") aunque la visita se haya registrado con una app vieja.
  const desde = new Date(`${jornada.fecha}T00:00:00`)
  const hasta = new Date(desde)
  hasta.setDate(hasta.getDate() + 1)
  const { data: notasSueltas } = await supabase
    .from('notas_pedido')
    .select(
      'parada_id, cliente_id, direccion_id, creado_en, items:notas_pedido_items ( servicio, herramienta, cantidad, cantidad_dientes, detalle )',
    )
    .eq('vendedor_id', vendedorId)
    .neq('estado', 'anulada')
    .gte('creado_en', desde.toISOString())
    .lt('creado_en', hasta.toISOString())

  const resumenes = resumenesDePedidoPorParada(
    completas.map((p) => ({ id: p.id, cliente_id: p.cliente_id, direccion_id: p.direccion_id })),
    (notasSueltas ?? []) as unknown as NotaSuelta[],
  )

  // "Entregué": lo que hay que entregarle al cliente ese día (notas con
  // fecha_entrega = el día del rol). La oficina ve las de cualquier vendedor
  // (RLS puede_ver_todo), igual que el botón "Imprimir" del panel. Si la consulta
  // falla no se frena el impreso: el rol sale sin el bloque (como el resumen).
  const clienteIds = [
    ...new Set(completas.map((p) => p.cliente_id).filter(Boolean)),
  ] as string[]
  let entregas: NotaEntrega[] = []
  if (clienteIds.length > 0) {
    const { data } = await supabase
      .from('notas_pedido')
      .select(
        'id, numero, parada_id, cliente_id, direccion_id, cliente_codigo, fecha_entrega, entregada_en, items:notas_pedido_items ( servicio, herramienta, cantidad, cantidad_dientes, detalle )',
      )
      .eq('fecha_entrega', jornada.fecha)
      .in('estado', ['impresa', 'entregada'])
      .in('cliente_id', clienteIds)
    entregas = (data ?? []) as unknown as NotaEntrega[]
  }
  const entregasPorParada = entregasDePedidoPorParada(
    completas.map((p) => ({ id: p.id, cliente_id: p.cliente_id, direccion_id: p.direccion_id })),
    entregas,
  )

  return rolImprimibleDesdeFilas(
    jornada,
    completas,
    { nombre: perfil?.nombre_completo ?? '', codigo: perfil?.codigo_vendedor ?? null },
    resumenes,
    { entregasPorParada },
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Cobranzas sueltas (la rendición de un día)
// ─────────────────────────────────────────────────────────────────────────────

interface CobranzaFila {
  cliente_codigo: string | null
  cliente_nombre: string
  tipo_comprobante: string
  total: number | string
  cheque: number | string
  efectivo: number | string
  comentarios: string | null
  perfiles: { codigo_vendedor: string | null } | null
}

/** numeric de Postgres puede venir como string; se normaliza antes de sumar. */
const n = (v: number | string | null | undefined): number => {
  const x = typeof v === 'string' ? Number(v) : (v ?? 0)
  return Number.isFinite(x) ? x : 0
}

/** Misma planilla que arma la página de cobranzas: un comprobante de un vendedor en un día. */
function armarPlanilla(
  cobros: CobranzaFila[],
  esPresupuesto: boolean,
  fecha: string,
): PlanillaCobranzasParaImprimir {
  const renglones: RenglonCobranza[] = cobros.map((c) => ({
    cliente_codigo: c.cliente_codigo ?? '',
    cliente_nombre: c.cliente_nombre,
    total: formatearPesos(n(c.total)),
    // Un cero se deja en blanco: una columna de ceros se lee como si hubiera pasado algo.
    cheque: n(c.cheque) > 0 ? formatearPesos(n(c.cheque)) : '',
    efectivo: n(c.efectivo) > 0 ? formatearPesos(n(c.efectivo)) : '',
    comentarios: c.comentarios ?? '',
  }))
  return {
    vendedor_numero: cobros[0]?.perfiles?.codigo_vendedor ?? '',
    esPresupuesto,
    fecha: formatearFechaCorta(`${fecha}T12:00:00`),
    cobros: renglones,
    total_general: formatearPesos(cobros.reduce((s, c) => s + n(c.total), 0)),
  }
}

async function renderizarCobranzas(orden: OrdenImpresion): Promise<DocumentoARenderizar | null> {
  const fecha = orden.parametros?.fecha
  if (!fecha) return null

  const { data, error } = await supabase
    .from('cobranzas')
    .select(
      'cliente_codigo, cliente_nombre, tipo_comprobante, total, cheque, efectivo, comentarios,' +
        ' perfiles:vendedor_id ( codigo_vendedor )',
    )
    .eq('vendedor_id', orden.pedida_por)
    .eq('fecha', fecha)
    .order('creado_en')
  if (error) throw error

  const cobros = (data ?? []) as unknown as CobranzaFila[]
  if (cobros.length === 0) return null

  const facturas = cobros.filter((c) => c.tipo_comprobante === 'factura')
  const presupuestos = cobros.filter((c) => c.tipo_comprobante === 'presupuesto')
  const planillas: PlanillaCobranzasParaImprimir[] = []
  if (facturas.length > 0) planillas.push(armarPlanilla(facturas, false, fecha))
  if (presupuestos.length > 0) planillas.push(armarPlanilla(presupuestos, true, fecha))
  if (planillas.length === 0) return null

  return { html: generarDocumentoPlanillasCobranzas(planillas), tamano: 'A4' }
}
