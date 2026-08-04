import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
  type RecordingOptions,
} from 'expo-audio'
import * as FileSystem from 'expo-file-system'
import { useCallback, useEffect, useState } from 'react'

import { supabase } from '../nucleo/supabase'

/**
 * Dictado por voz de las observaciones.
 *
 * El micrófono del formulario graba, sube el audio a la Edge Function
 * `transcribir-audio` y ésta se lo pasa a Gemini. La clave de Gemini nunca
 * viaja en la app.
 *
 * Sobre el formato: se fuerza AAC dentro de contenedor MP4 a 16 kHz mono y
 * 32 kbps. Gemini remuestrea a 16 Kbps y mezcla a un solo canal de todas
 * formas, así que grabar en 44,1 kHz estéreo a 128 kbps (el preset de alta
 * calidad) sólo multiplica por cuatro los bytes que hay que subir por una red
 * móvil, sin ganar nada de precisión.
 *
 * No se usa `RecordingPresets.LOW_QUALITY`: en Android produce AMR-NB dentro
 * de un .3gp, un formato que Gemini no acepta.
 */

const OPCIONES_GRABACION: RecordingOptions = {
  ...RecordingPresets.HIGH_QUALITY,
  sampleRate: 16_000,
  numberOfChannels: 1,
  bitRate: 32_000,
  android: {
    extension: '.m4a',
    outputFormat: 'mpeg4',
    audioEncoder: 'aac',
  },
}

/** `audio/m4a` no está registrado en IANA; el tipo correcto para el contenedor MP4 es `audio/mp4`. */
const MIME = 'audio/mp4'

/** Más allá de esto la observación deja de ser una nota y pasa a ser un monólogo. */
export const DURACION_MAXIMA_MS = 90_000

export interface EstadoDictado {
  grabando: boolean
  transcribiendo: boolean
  duracionMs: number
  error: string | null
  permisoDenegado: boolean
  comenzar: () => Promise<void>
  detenerYTranscribir: () => Promise<string | null>
  cancelar: () => Promise<void>
}

export function usarDictado(): EstadoDictado {
  const grabador = useAudioRecorder(OPCIONES_GRABACION)
  const estadoGrabador = useAudioRecorderState(grabador, 250)

  const [transcribiendo, setTranscribiendo] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [permisoDenegado, setPermisoDenegado] = useState(false)

  // Corta sola si el vendedor se olvida el micrófono abierto.
  useEffect(() => {
    if (!estadoGrabador.isRecording) return
    if (estadoGrabador.durationMillis < DURACION_MAXIMA_MS) return
    void grabador.stop()
  }, [estadoGrabador.isRecording, estadoGrabador.durationMillis, grabador])

  const comenzar = useCallback(async () => {
    setError(null)
    try {
      const permiso = await AudioModule.requestRecordingPermissionsAsync()
      if (!permiso.granted) {
        setPermisoDenegado(true)
        setError('Necesitamos permiso para usar el micrófono. Podés escribir la observación a mano.')
        return
      }
      setPermisoDenegado(false)

      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true })
      await grabador.prepareToRecordAsync()
      grabador.record()
    } catch (e) {
      setError('No pudimos abrir el micrófono. Escribí la observación a mano.')
      console.warn('[dictado] error al iniciar', e)
    }
  }, [grabador])

  const cancelar = useCallback(async () => {
    try {
      if (grabador.isRecording) await grabador.stop()
    } catch {
      // Nada que hacer: el usuario canceló.
    }
    setError(null)
  }, [grabador])

  const detenerYTranscribir = useCallback(async (): Promise<string | null> => {
    try {
      await grabador.stop()
      const uri = grabador.uri
      if (!uri) {
        setError('La grabación quedó vacía. Probá de nuevo.')
        return null
      }

      setTranscribiendo(true)
      setError(null)

      const audioBase64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      })

      const { data, error: errFuncion } = await supabase.functions.invoke('transcribir-audio', {
        body: { audioBase64, mimeType: MIME },
      })

      // El archivo temporal ya no hace falta.
      await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined)

      if (errFuncion) {
        setError('No pudimos transcribir el audio. Escribí la observación a mano.')
        return null
      }

      if (data?.aviso) {
        setError(data.aviso)
        return null
      }

      return (data?.transcripcion as string) ?? null
    } catch (e) {
      console.warn('[dictado] error al transcribir', e)
      setError('No pudimos transcribir el audio. Escribí la observación a mano.')
      return null
    } finally {
      setTranscribiendo(false)
    }
  }, [grabador])

  return {
    grabando: estadoGrabador.isRecording,
    transcribiendo,
    duracionMs: estadoGrabador.durationMillis ?? 0,
    error,
    permisoDenegado,
    comenzar,
    detenerYTranscribir,
    cancelar,
  }
}
