import type { AdjuntoReporte } from '@woodtools/compartido'
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio'
import * as FileSystem from 'expo-file-system'
import * as ImagePicker from 'expo-image-picker'
import { useCallback, useEffect, useRef, useState } from 'react'

import { supabase } from '../nucleo/supabase'
import { DURACION_MAXIMA_MS, MIME_AUDIO } from './transcripcion'

/**
 * Opciones de grabación del reporte: el preset estándar, sin tocar.
 *
 * ─── Por qué NO se usan las opciones custom del dictado ──────────────────────
 *
 * El dictado fuerza AAC 16 kHz mono 32 kbps para achicar el archivo. En varios
 * Samsung (probado en un A16) eso prepara la grabadora pero `record()` NO
 * arranca: el estado nunca pasa a "grabando" y en el log no aparece un solo
 * `MediaRecorder.start()`. El preset `HIGH_QUALITY` —m4a/AAC a 44,1 kHz— sí
 * arranca en esos equipos. Pesa más, pero un audio de 90 s son ~1,5 MB, muy por
 * debajo del tope de la función de transcripción, y Gemini acepta mp4 igual.
 */
const OPCIONES_REPORTE = RecordingPresets.HIGH_QUALITY

/**
 * Adjuntos del reporte de problema: fotos y un audio.
 *
 * ─── Por qué acá y no en `transcripcion.ts` ──────────────────────────────────
 *
 * El dictado de las notas transcribe y TIRA el audio: lo único que importa es
 * el texto. Acá es al revés y a la vez: el audio se guarda para escuchar Y se
 * transcribe para leer. Son dos usos del mismo archivo, así que el grabador de
 * acá conserva la grabación en vez de borrarla, y la subida + transcripción se
 * hacen recién al enviar el reporte.
 *
 * Las claves (Gemini, la de Storage) nunca viajan en la app: el audio se pasa a
 * la Edge Function `transcribir-audio`, y la subida usa la sesión del vendedor
 * contra el bucket `reportes-adjuntos`, que sólo lo deja escribir en su carpeta.
 */

const BUCKET = 'reportes-adjuntos'

/** Cuántas fotos como mucho: un reporte no es un álbum. */
export const MAX_FOTOS = 4

// ─────────────────────────────────────────────────────────────────────────────
// Elegir fotos (cámara o galería)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Se comprime a 0.6: una foto de pantalla o de un cartel se lee perfecto, y sin
 * esto un teléfono moderno sube 4–8 MB por foto sobre datos móviles al pedo.
 */
const CALIDAD = 0.6

export type ResultadoFoto =
  | { ok: true; uris: string[] }
  | { ok: false; motivo: string }

export async function sacarFotoConCamara(): Promise<ResultadoFoto> {
  const permiso = await ImagePicker.requestCameraPermissionsAsync()
  if (!permiso.granted) {
    return { ok: false, motivo: 'Necesitamos permiso para usar la cámara. Podés elegir una foto de la galería.' }
  }
  const res = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: CALIDAD })
  if (res.canceled) return { ok: true, uris: [] }
  return { ok: true, uris: res.assets.map((a) => a.uri) }
}

export async function elegirFotosDeGaleria(cuposLibres: number): Promise<ResultadoFoto> {
  const permiso = await ImagePicker.requestMediaLibraryPermissionsAsync()
  if (!permiso.granted) {
    return { ok: false, motivo: 'Necesitamos permiso para ver tus fotos. Podés sacar una con la cámara.' }
  }
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: CALIDAD,
    allowsMultipleSelection: true,
    selectionLimit: Math.max(1, cuposLibres),
  })
  if (res.canceled) return { ok: true, uris: [] }
  return { ok: true, uris: res.assets.map((a) => a.uri) }
}

// ─────────────────────────────────────────────────────────────────────────────
// Grabar un audio (conservando el archivo)
// ─────────────────────────────────────────────────────────────────────────────

export interface EstadoGrabacion {
  grabando: boolean
  duracionMs: number
  /** El archivo grabado, listo para adjuntar. `null` hasta que se detiene. */
  uri: string | null
  error: string | null
  permisoDenegado: boolean
  comenzar: () => Promise<void>
  /** Detiene y devuelve el `uri` del archivo grabado (o null si quedó vacío). */
  detener: () => Promise<string | null>
  descartar: () => Promise<void>
}

export function usarGrabacionReporte(): EstadoGrabacion {
  const grabador = useAudioRecorder(OPCIONES_REPORTE)
  const estadoGrabador = useAudioRecorderState(grabador, 250)

  const [uri, setUri] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [permisoDenegado, setPermisoDenegado] = useState(false)
  const activo = useRef(true)

  const detener = useCallback(async (): Promise<string | null> => {
    try {
      if (grabador.isRecording) await grabador.stop()
    } catch {
      // Ya estaba frenado.
    }
    const u = grabador.uri ?? null
    if (u) setUri(u)
    return u
  }, [grabador])

  // Corta sola al llegar al máximo, igual que el dictado: un audio no es un
  // monólogo. El archivo queda guardado para adjuntar lo que se alcanzó a decir.
  useEffect(() => {
    if (!estadoGrabador.isRecording) return
    if (estadoGrabador.durationMillis < DURACION_MAXIMA_MS) return
    void detener()
    setError(`El audio llegó al máximo de ${DURACION_MAXIMA_MS / 1000} segundos y se cortó.`)
  }, [estadoGrabador.isRecording, estadoGrabador.durationMillis, detener])

  const comenzar = useCallback(async () => {
    setError(null)
    try {
      const permiso = await AudioModule.requestRecordingPermissionsAsync()
      if (!permiso.granted) {
        setPermisoDenegado(true)
        setError('Necesitamos permiso para usar el micrófono. Podés escribir el detalle a mano.')
        return
      }
      setPermisoDenegado(false)

      // Empezar de nuevo descarta lo anterior.
      if (uri) {
        await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined)
        setUri(null)
      }

      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true })
      await grabador.prepareToRecordAsync()
      grabador.record()

      /**
       * Reintentar `record()` hasta que ARRANQUE de verdad.
       *
       * En varios Samsung (probado en un A16), `prepareToRecordAsync()` resuelve
       * su promesa ANTES de que la grabadora nativa esté lista, y el `record()`
       * que sigue cae en el vacío: el estado nunca pasa a "grabando" y no se graba
       * nada. La preparación nativa termina ~1 segundo después. Por eso no alcanza
       * con esperar: hay que volver a pedir `record()` cuando la grabadora ya está
       * lista. Se reintenta cada 150 ms hasta 3 s; apenas `isRecording` es true,
       * listo.
       */
      let arranco = false
      for (let i = 0; i < 20; i += 1) {
        await new Promise((r) => setTimeout(r, 150))
        if (!activo.current) return
        if (grabador.isRecording) {
          arranco = true
          break
        }
        // Todavía no arrancó: la grabadora recién ahora puede estar preparada del
        // lado nativo, así que se vuelve a pedir. Si ya estuviera grabando, el
        // chequeo de arriba lo habría tomado.
        try {
          grabador.record()
        } catch {
          // Ignorar: un record() de más no rompe nada; el estado manda.
        }
      }
      if (!arranco) {
        setError('El micrófono no llegó a arrancar. Probá de nuevo o escribí el detalle a mano.')
      }
    } catch (e) {
      setError('No pudimos abrir el micrófono. Escribí el detalle a mano.')
      console.warn('[reporte-audio] error al iniciar', e)
    }
  }, [grabador, uri])

  const descartar = useCallback(async () => {
    try {
      if (grabador.isRecording) await grabador.stop()
    } catch {
      // Ya estaba frenado.
    }
    if (uri) await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined)
    setUri(null)
    setError(null)
  }, [grabador, uri])

  // Al desmontarse, corta lo que esté grabando (el archivo lo limpia el envío o
  // el descarte; no se borra acá porque puede estar en pleno uso).
  useEffect(
    () => () => {
      activo.current = false
      try {
        if (grabador.isRecording) void grabador.stop()
      } catch {
        // Ya estaba frenado.
      }
    },
    [grabador],
  )

  return {
    grabando: estadoGrabador.isRecording,
    duracionMs: estadoGrabador.durationMillis ?? 0,
    uri,
    error,
    permisoDenegado,
    comenzar,
    detener,
    descartar,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Subir a Storage y transcribir
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Base64 → bytes, sin dependencias.
 *
 * `supabase-js` sube bien un `Uint8Array`; en React Native pasarle el `uri` o un
 * Blob es lo que falla silencioso (sube 0 bytes). `atob` existe global desde
 * React Native 0.74, así que no hace falta traer `base64-arraybuffer`.
 */
function base64ABytes(base64: string): Uint8Array {
  const binario = atob(base64)
  const bytes = new Uint8Array(binario.length)
  for (let i = 0; i < binario.length; i += 1) bytes[i] = binario.charCodeAt(i)
  return bytes
}

async function subirArchivo(
  carpeta: string,
  bytes: Uint8Array,
  extension: string,
  contentType: string,
): Promise<string> {
  const ruta = `${carpeta}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`
  const { error } = await supabase.storage.from(BUCKET).upload(ruta, bytes, { contentType, upsert: false })
  if (error) throw error
  return ruta
}

function extensionDe(uri: string, porDefecto: string): string {
  const limpio = uri.split('?')[0]
  const punto = limpio.lastIndexOf('.')
  const ext = punto >= 0 ? limpio.slice(punto + 1).toLowerCase() : ''
  return /^[a-z0-9]{1,5}$/.test(ext) ? ext : porDefecto
}

function tipoDeFoto(ext: string): string {
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  if (ext === 'png') return 'image/png'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'heic' || ext === 'heif') return 'image/heic'
  return 'application/octet-stream'
}

/**
 * Sube las fotos y el audio del reporte y, si hay audio, lo transcribe.
 *
 * Devuelve lo que la RPC necesita: la lista de adjuntos (rutas dentro del
 * bucket) y la transcripción del audio. Si la transcripción falla, el audio
 * igual queda adjunto —Marketing lo escucha— y la transcripción va vacía: no
 * se pierde el reporte por eso.
 */
export async function subirAdjuntosDelReporte(
  vendedorId: string,
  fotos: string[],
  audioUri: string | null,
): Promise<{ adjuntos: AdjuntoReporte[]; transcripcion: string | null }> {
  const adjuntos: AdjuntoReporte[] = []

  for (const foto of fotos) {
    const base64 = await FileSystem.readAsStringAsync(foto, { encoding: FileSystem.EncodingType.Base64 })
    const ext = extensionDe(foto, 'jpg')
    const ruta = await subirArchivo(vendedorId, base64ABytes(base64), ext, tipoDeFoto(ext))
    adjuntos.push({ tipo: 'foto', ruta })
  }

  let transcripcion: string | null = null
  if (audioUri) {
    const base64 = await FileSystem.readAsStringAsync(audioUri, { encoding: FileSystem.EncodingType.Base64 })
    const ruta = await subirArchivo(vendedorId, base64ABytes(base64), 'm4a', MIME_AUDIO)
    adjuntos.push({ tipo: 'audio', ruta })

    // La transcripción es un extra: si falla, el audio queda igual. Por eso no
    // tira, sólo deja la transcripción en null.
    try {
      const { data, error } = await supabase.functions.invoke('transcribir-audio', {
        body: { audioBase64: base64, mimeType: MIME_AUDIO },
      })
      if (!error && data?.transcripcion) transcripcion = data.transcripcion as string
    } catch {
      // El audio ya quedó adjunto; la transcripción se puede rehacer después.
    }
  }

  return { adjuntos, transcripcion }
}
