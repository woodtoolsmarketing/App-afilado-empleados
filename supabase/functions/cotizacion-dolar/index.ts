import { createClient } from 'jsr:@supabase/supabase-js@2'

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
 * Cotizacion del dolar oficial.
 *
 * Se cachea por dia en la tabla `cotizaciones`. La nota de pedido guarda el
 * valor del dia en que se emitio, no el de hoy: una nota de la semana pasada
 * tiene que poder reimprimirse con el tipo de cambio que se le cotizo al
 * cliente, no con el de la reimpresion.
 *
 * Fuente: dolarapi.com, que publica el oficial del BCRA sin necesidad de clave.
 */

const FUENTE = 'https://dolarapi.com/v1/dolares/oficial'

function hoyArgentina(): string {
  // La cotizacion es por dia habil argentino, no por UTC: a las 22:00 de Buenos
  // Aires en UTC ya es el dia siguiente y se guardaria en la fecha equivocada.
  const ahora = new Date()
  const arg = new Date(ahora.getTime() - 3 * 60 * 60 * 1000)
  return arg.toISOString().slice(0, 10)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const admin = createClient(URL_SUPABASE, claveSecreta(), {
      auth: { persistSession: false },
    })

    await autenticar(req, admin as never)

    const cuerpo = await req.json().catch(() => ({}))
    const fecha: string = cuerpo.fecha ?? hoyArgentina()
    const forzar: boolean = cuerpo.forzar === true

    // 1. Cache del dia.
    if (!forzar) {
      const { data } = await admin
        .from('cotizaciones')
        .select('*')
        .eq('fecha', fecha)
        .maybeSingle()
      if (data) return responder({ ...data, desde_cache: true })
    }

    // Para fechas pasadas no se consulta la API: devolveria el valor de HOY y
    // quedaria guardado con una fecha que no le corresponde.
    if (fecha !== hoyArgentina()) {
      const { data } = await admin
        .from('cotizaciones')
        .select('*')
        .lte('fecha', fecha)
        .order('fecha', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (data) return responder({ ...data, desde_cache: true, aproximada: true })
      throw new RespuestaError(`No hay cotizacion guardada para el ${fecha}`, 404)
    }

    // 2. Consulta a la fuente.
    const respuesta = await fetch(FUENTE, { headers: { Accept: 'application/json' } })
    if (!respuesta.ok) {
      console.error('[cotizacion-dolar]', respuesta.status, await respuesta.text())
      throw new RespuestaError('No pudimos obtener la cotizacion del dolar', 502)
    }

    const datos = await respuesta.json()
    const venta = Number(datos?.venta)
    if (!Number.isFinite(venta) || venta <= 0) {
      throw new RespuestaError('La cotizacion recibida no es valida', 502)
    }

    const fila = {
      fecha,
      compra: Number.isFinite(Number(datos?.compra)) ? Number(datos.compra) : null,
      venta,
      fuente: 'dolarapi',
      obtenido_en: new Date().toISOString(),
    }

    const { error: errGuardar } = await admin
      .from('cotizaciones')
      .upsert(fila, { onConflict: 'fecha' })

    if (errGuardar) console.error('[cotizacion-dolar] no se pudo cachear', errGuardar.message)

    return responder({ ...fila, desde_cache: false })
  } catch (e) {
    return manejarError(e)
  }
})
