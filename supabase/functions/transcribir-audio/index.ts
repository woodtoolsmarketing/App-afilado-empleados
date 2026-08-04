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
 * Transcripción del dictado de observaciones (el micrófono del formulario).
 *
 * La clave de Gemini vive únicamente acá: el teléfono manda el audio ya
 * codificado en base64 y recibe el texto. Así la clave nunca viaja en el APK,
 * donde sería trivial de extraer (Hermes no ofusca strings).
 *
 * Notas de implementación:
 *  · Se usa la Interactions API (`/v1beta/interactions`), no el viejo
 *    `generateContent`, que quedó como legacy.
 *  · La respuesta cambió en mayo de 2026: el texto está en
 *    `steps[].content[].text`, ya no en `outputs[]`.
 *  · `store: false` — son notas de voz de empleados; no queremos que queden
 *    guardadas 55 días en la infraestructura de Google.
 *  · `thinking_level: minimal` — transcribir no necesita razonamiento, y el
 *    razonamiento se cobra y agrega latencia.
 */

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions'
const MODELO = Deno.env.get('GEMINI_MODELO') ?? 'gemini-3.5-flash-lite'

const INSTRUCCION = `Sos un motor de transcripción para una empresa de herramientas de carpintería en Argentina.
Devolvés ÚNICAMENTE la transcripción literal del audio, en español rioplatense (voseo: vos, tenés, querés, decime).
Reglas estrictas:
- No traduzcas, no resumas, no corrijas la gramática.
- No agregues comillas, ni prefijos como "Transcripción:", ni comentarios, ni descripciones del ruido de fondo.
- Respetá la puntuación natural y los nombres propios.
- Vocabulario del rubro que puede aparecer: afilado, sierra, disco, fresa, cuchilla, widia, pastilla, cinta, plaqueta, machimbre, melamina, MDF, tupí, escuadradora.
- Si el audio está vacío, en silencio o es ininteligible, devolvé exactamente: [inaudible]`

/** Formatos que la documentación de Gemini lista explícitamente. */
const MIME_PERMITIDOS = new Set([
  'audio/wav',
  'audio/mp3',
  'audio/aiff',
  'audio/aac',
  'audio/ogg',
  'audio/flac',
  // No figura en la lista del Gemini API pero sí en la de Firebase AI Logic,
  // que usa el mismo backend. Es lo que produce expo-audio en Android/iOS.
  'audio/mp4',
])

/** Tope defensivo: ~7 MB de base64 ≈ 5 MB de audio, muy por encima de 60 s. */
const MAX_BASE64 = 7_000_000

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const admin = createClient(URL_SUPABASE, claveSecreta(), {
      auth: { persistSession: false },
    })

    // Autenticar SIEMPRE primero. Chequear la configuración antes le contaría
    // a cualquiera que tenga la clave publicable qué secretos están cargados.
    await autenticar(req, admin as never)

    const clave = Deno.env.get('GEMINI_API_KEY')
    if (!clave) throw new RespuestaError('Falta configurar GEMINI_API_KEY', 500)

    const { audioBase64, mimeType = 'audio/mp4' } = await req.json()

    if (!audioBase64 || typeof audioBase64 !== 'string') {
      throw new RespuestaError('Falta el audio', 400)
    }
    if (audioBase64.length > MAX_BASE64) {
      throw new RespuestaError('El audio es demasiado largo. Grabá menos de un minuto.', 413)
    }
    if (!MIME_PERMITIDOS.has(mimeType)) {
      throw new RespuestaError(`Formato de audio no soportado: ${mimeType}`, 415)
    }

    const respuesta = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: {
        'x-goog-api-key': clave,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODELO,
        store: false,
        system_instruction: INSTRUCCION,
        generation_config: { thinking_level: 'minimal', temperature: 0 },
        response_format: {
          type: 'text',
          mime_type: 'application/json',
          schema: {
            type: 'object',
            properties: { transcripcion: { type: 'string' } },
            required: ['transcripcion'],
          },
        },
        input: [
          { type: 'text', text: 'Transcribí este audio.' },
          { type: 'audio', data: audioBase64, mime_type: mimeType },
        ],
      }),
    })

    if (!respuesta.ok) {
      const detalle = await respuesta.text()
      console.error('[transcribir-audio] Gemini respondió', respuesta.status, detalle)
      throw new RespuestaError('No pudimos transcribir el audio. Escribí la observación a mano.', 502)
    }

    const datos = await respuesta.json()

    // Formato vigente desde mayo 2026: steps[] → content[] → text.
    const crudo: string = (datos.steps ?? [])
      .filter((paso: { type?: string }) => paso.type === 'model_output')
      .flatMap((paso: { content?: unknown[] }) => paso.content ?? [])
      .filter((c: { type?: string }) => c.type === 'text')
      .map((c: { text?: string }) => c.text ?? '')
      .join('')

    let transcripcion = crudo.trim()
    try {
      const parseada = JSON.parse(crudo)
      if (typeof parseada?.transcripcion === 'string') transcripcion = parseada.transcripcion.trim()
    } catch {
      // El modelo devolvió texto plano en vez del JSON: nos sirve igual.
    }

    if (!transcripcion || transcripcion === '[inaudible]') {
      return responder({
        transcripcion: '',
        aviso: 'No se entendió el audio. Probá grabar de nuevo o escribí la observación.',
      })
    }

    return responder({ transcripcion })
  } catch (e) {
    return manejarError(e)
  }
})
