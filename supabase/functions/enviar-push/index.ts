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
 * Manda una notificación push a los teléfonos de un vendedor.
 *
 * La usa el panel cuando la oficina le agrega un destino al recorrido: busca los
 * tokens de los dispositivos AUTORIZADOS de ese vendedor y los manda por el
 * servicio de Expo (que del otro lado habla con FCM). El vendedor lo ve aunque no
 * tenga la app abierta.
 *
 * Sólo la oficina (admin / administracion / supervisor) puede disparar un push:
 * es quien arma recorridos de otros. El token de servicio lee los dispositivos
 * salteando la RLS.
 */

const EXPO_PUSH = 'https://exp.host/--/api/v2/push/send'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const admin = createClient(URL_SUPABASE, claveSecreta(), {
      auth: { persistSession: false },
    })

    const llamador = await autenticar(req, admin as never)
    if (!['admin', 'administracion', 'supervisor'].includes(llamador.rol)) {
      throw new RespuestaError('Sólo la oficina puede mandar un aviso', 403)
    }

    const { vendedorId, titulo, cuerpo, datos } = await req.json()
    if (!vendedorId || !titulo || !cuerpo) {
      throw new RespuestaError('Faltan datos del aviso (vendedor, título o cuerpo)', 400)
    }

    const { data: disp } = await admin
      .from('dispositivos')
      .select('push_token')
      .eq('perfil_id', vendedorId)
      .eq('autorizado', true)
      .not('push_token', 'is', null)

    const tokens = [
      ...new Set(
        (disp ?? [])
          .map((d: { push_token: string | null }) => d.push_token)
          .filter((t): t is string => !!t),
      ),
    ]

    // Un vendedor sin token (no dio permiso, o su teléfono todavía no lo registró)
    // no es un error: no se le manda nada y el que llamó sigue su camino.
    if (tokens.length === 0) {
      return responder({ enviados: 0, motivo: 'el vendedor no tiene token de push' })
    }

    const mensajes = tokens.map((to) => ({
      to,
      sound: 'default',
      title: titulo,
      body: cuerpo,
      data: datos ?? {},
      channelId: 'recorrido',
      priority: 'high',
    }))

    const r = await fetch(EXPO_PUSH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(mensajes),
    })
    const resultado = await r.json().catch(() => null)

    if (!r.ok) {
      console.error('[enviar-push] Expo respondió', r.status, resultado)
      throw new RespuestaError('No se pudo mandar el aviso', 502)
    }

    return responder({ enviados: tokens.length, resultado })
  } catch (e) {
    return manejarError(e)
  }
})
