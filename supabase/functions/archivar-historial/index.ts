import { createClient } from 'jsr:@supabase/supabase-js@2'
import ExcelJS from 'npm:exceljs@4.4.0'

import {
  autenticar,
  claveSecreta,
  cors,
  manejarError,
  responder,
  RespuestaError,
  URL_SUPABASE,
} from '../_compartido/comun.ts'

/**
 * Archivado del historial a los 90 días.
 *
 * Genera un Excel con la planilla completa del período, lo sube al bucket
 * privado `archivos-historial` (sólo administradores) y recién entonces
 * habilita la poda. La función `podar_historial` en Postgres se niega a borrar
 * si no encuentra el respaldo, así que el orden no se puede invertir por error.
 *
 * Se usa `exceljs` y no `xlsx`: la última versión de SheetJS publicada en npm
 * (0.18.5) está abandonada y arrastra CVE-2023-30533, y el CDN oficial de
 * SheetJS no es alcanzable con el especificador `npm:` de Deno.
 */

const BUCKET = 'archivos-historial'
const PAGINA = 1000

interface Fila {
  fecha: string
  vendedor: string
  codigo: string | null
  nro: number
  hora: string | null
  cliente_nro: string | null
  razon_social: string
  direccion: string | null
  codigo_postal: string | null
  visitado: boolean | null
  vendio: boolean | null
  cobro: boolean | null
  retiro_afilado: boolean | null
  entrego: boolean | null
  motivo_no_visita: string | null
  contacto: string | null
  observacion: string | null
  estado_parada: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const admin = createClient(URL_SUPABASE, claveSecreta(), {
      auth: { persistSession: false },
    })

    const llamador = await autenticar(req, admin as never)
    if (llamador.rol !== 'admin') {
      throw new RespuestaError('Sólo un administrador puede archivar el historial', 403)
    }

    const cuerpo = await req.json().catch(() => ({}))
    const retencion = Number(cuerpo.retencion_dias ?? 90)

    // Las fechas se calculan acá, en JavaScript. Mandarle expresiones tipo
    // "::date + interval" a PostgREST devuelve error 22007.
    const hasta: string =
      cuerpo.hasta ?? new Date(Date.now() - retencion * 86_400_000).toISOString().slice(0, 10)
    const desde: string = cuerpo.desde ?? '2000-01-01'

    // ── Lectura paginada ─────────────────────────────────────────────────────
    // Sin paginar, PostgREST corta en 1000 filas sin avisar y el Excel saldría
    // truncado en silencio.
    const filas: Fila[] = []
    for (let pagina = 0; ; pagina += 1) {
      const { data, error: errLectura } = await admin
        .from('vista_rol_de_visita')
        .select('*')
        .gte('fecha', desde)
        .lte('fecha', hasta)
        .order('fecha', { ascending: true })
        .order('codigo', { ascending: true })
        .order('nro', { ascending: true })
        .range(pagina * PAGINA, (pagina + 1) * PAGINA - 1)
        .returns<Fila[]>()

      if (errLectura) throw new RespuestaError(`Error leyendo el historial: ${errLectura.message}`, 500)
      if (!data || data.length === 0) break

      filas.push(...data)
      if (data.length < PAGINA) break
    }

    if (filas.length === 0) {
      return responder({ archivado: false, mensaje: 'No hay historial para archivar en ese período.' })
    }

    // ── Excel ────────────────────────────────────────────────────────────────
    const libro = new ExcelJS.Workbook()
    libro.creator = 'WoodTools · Rol de Visita'
    libro.created = new Date()

    const hoja = libro.addWorksheet('Rol de Visita', {
      views: [{ state: 'frozen', ySplit: 1 }],
    })

    hoja.columns = [
      { header: 'FECHA', key: 'fecha', width: 12 },
      { header: 'VENDEDOR', key: 'vendedor', width: 24 },
      { header: 'CÓDIGO', key: 'codigo', width: 10 },
      { header: 'Nº', key: 'nro', width: 6 },
      { header: 'HORA', key: 'hora', width: 10 },
      { header: 'CLIENTE Nº', key: 'cliente_nro', width: 12 },
      { header: 'RAZÓN SOCIAL O NOMBRE', key: 'razon_social', width: 34 },
      { header: 'DIRECCIÓN', key: 'direccion', width: 40 },
      { header: 'CP', key: 'codigo_postal', width: 10 },
      { header: 'VENDIÓ', key: 'vendio', width: 9 },
      { header: 'COBRÓ', key: 'cobro', width: 9 },
      { header: 'RET. AFIL.', key: 'retiro_afilado', width: 11 },
      { header: 'ENTREGÓ', key: 'entrego', width: 10 },
      { header: 'ATENDIDO / CONTACTO', key: 'contacto', width: 24 },
      { header: 'RESULTADO (OBSERVACIONES)', key: 'observacion', width: 60 },
      { header: 'ESTADO', key: 'estado_parada', width: 14 },
      { header: 'MOTIVO NO VISITA', key: 'motivo_no_visita', width: 20 },
    ]

    const encabezado = hoja.getRow(1)
    encabezado.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 }
    encabezado.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFB30F0F' } }
    encabezado.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
    encabezado.height = 30

    const tilde = (v: boolean | null) => (v ? 'X' : '')

    for (const f of filas) {
      hoja.addRow({
        fecha: f.fecha,
        vendedor: f.vendedor,
        codigo: f.codigo ?? '',
        nro: f.nro,
        hora: f.hora ? new Date(f.hora).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : '',
        cliente_nro: f.cliente_nro ?? '',
        razon_social: f.razon_social,
        direccion: f.direccion ?? '',
        codigo_postal: f.codigo_postal ?? '',
        vendio: tilde(f.vendio),
        cobro: tilde(f.cobro),
        retiro_afilado: tilde(f.retiro_afilado),
        entrego: tilde(f.entrego),
        contacto: f.contacto ?? '',
        observacion: f.observacion ?? '',
        estado_parada: f.estado_parada,
        motivo_no_visita: f.motivo_no_visita ?? '',
      })
    }

    hoja.autoFilter = { from: 'A1', to: { row: 1, column: hoja.columns.length } }
    hoja.getColumn('observacion').alignment = { wrapText: true, vertical: 'top' }

    const buffer = await libro.xlsx.writeBuffer()

    // ── Subida al bucket privado ─────────────────────────────────────────────
    const ruta = `rol-de-visita/${desde}_a_${hasta}.xlsx`
    const { error: errSubida } = await admin.storage
      .from(BUCKET)
      .upload(ruta, new Uint8Array(buffer), {
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        upsert: true,
      })

    if (errSubida) throw new RespuestaError(`No se pudo guardar el Excel: ${errSubida.message}`, 500)

    await admin.from('archivos_historial').insert({
      desde,
      hasta,
      ruta_storage: ruta,
      filas: filas.length,
      generado_por: llamador.id,
    })

    // El enlace de descarga vence en 15 minutos.
    const { data: firmada } = await admin.storage.from(BUCKET).createSignedUrl(ruta, 900)

    return responder({
      archivado: true,
      filas: filas.length,
      desde,
      hasta,
      ruta,
      url_descarga: firmada?.signedUrl ?? null,
      siguiente_paso:
        'El respaldo quedó guardado. Para liberar espacio, ejecutá podar_historial(' + hasta + ').',
    })
  } catch (e) {
    return manejarError(e)
  }
})
