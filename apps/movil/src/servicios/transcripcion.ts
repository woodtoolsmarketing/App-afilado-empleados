import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
  type RecordingOptions,
} from 'expo-audio'
import * as FileSystem from 'expo-file-system'
import { useCallback, useEffect, useRef, useState } from 'react'

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

/**
 * Quién tiene el micrófono.
 *
 * El teléfono tiene uno solo, pero cada campo con micrófono arma su propio
 * grabador. En la pantalla de la nota hay dos, pegados: "Datos del cliente" y
 * "Descripción general de la herramienta". Nada impedía abrir los dos a la vez,
 * y ahí el segundo se montaba sobre el primero: en Android uno de los dos
 * terminaba sin audio, o con el audio cortado, **sin un solo cartel**. El
 * vendedor hablaba treinta segundos y el texto no aparecía nunca.
 *
 * Ahora hay un dueño por vez. El que llega segundo no arranca y se lo dice, en
 * lugar de robarle el micrófono al primero: la grabación en curso es trabajo
 * que ya se hizo, y la que todavía no empezó no es nada.
 */
let duenoDelMicrofono: symbol | null = null

function liberarMicrofono(quien: symbol) {
  if (duenoDelMicrofono === quien) duenoDelMicrofono = null
}

export interface EstadoDictado {
  grabando: boolean
  transcribiendo: boolean
  duracionMs: number
  error: string | null
  permisoDenegado: boolean
  /**
   * Hay audio grabado esperando que lo pasen a texto: o se cortó por llegar
   * al máximo, o la transcripción falló y se conservó para reintentar. La
   * pantalla lo usa para que el micrófono reintente en vez de grabar encima.
   */
  audioPendiente: boolean
  comenzar: () => Promise<void>
  detenerYTranscribir: () => Promise<string | null>
  cancelar: () => Promise<void>
}

export function usarDictado(): EstadoDictado {
  const grabador = useAudioRecorder(OPCIONES_GRABACION)
  const estadoGrabador = useAudioRecorderState(grabador, 250)

  /** Identidad de este campo, para saber si el micrófono es suyo. */
  const identidad = useRef<symbol>(Symbol('dictado')).current

  const [transcribiendo, setTranscribiendo] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [permisoDenegado, setPermisoDenegado] = useState(false)
  const [audioPendiente, setAudioPendiente] = useState(false)

  /**
   * Corta sola si el vendedor se olvida el micrófono abierto.
   *
   * Antes hacía `grabador.stop()` a secas y ahí terminaba: el audio de los 90
   * segundos quedaba en el teléfono sin subir, el botón volvía a 🎤 y no
   * aparecía ningún cartel. El vendedor había hablado un minuto y medio para
   * nada y no tenía forma de saberlo.
   *
   * Ahora avisa. La transcripción de lo grabado la dispara la pantalla, que es
   * la que sabe dónde va el texto; acá sólo se deja la marca de que se cortó.
   */
  useEffect(() => {
    if (!estadoGrabador.isRecording) return
    if (estadoGrabador.durationMillis < DURACION_MAXIMA_MS) return
    void grabador.stop()
    // El audio queda esperando que lo pasen a texto, pero el micrófono ya está
    // libre: otro campo puede usarlo.
    liberarMicrofono(identidad)
    setAudioPendiente(true)
    setError(
      `La grabación llegó al máximo de ${DURACION_MAXIMA_MS / 1000} segundos y se cortó. Tocá el micrófono para pasar a texto lo que alcanzaste a decir.`,
    )
  }, [estadoGrabador.isRecording, estadoGrabador.durationMillis, grabador, identidad])

  const comenzar = useCallback(async () => {
    setError(null)

    // Un micrófono por vez. El que ya está grabando tiene trabajo hecho
    // adentro; el que recién arranca todavía no tiene nada que perder.
    if (duenoDelMicrofono !== null && duenoDelMicrofono !== identidad) {
      setError(
        'Ya hay una grabación en curso en otro campo de esta pantalla. Terminá esa primero y después dictá acá.',
      )
      return
    }

    setAudioPendiente(false)
    try {
      const permiso = await AudioModule.requestRecordingPermissionsAsync()
      if (!permiso.granted) {
        setPermisoDenegado(true)
        setError('Necesitamos permiso para usar el micrófono. Podés escribir la observación a mano.')
        return
      }
      setPermisoDenegado(false)

      duenoDelMicrofono = identidad

      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true })
      await grabador.prepareToRecordAsync()
      grabador.record()

      /**
       * Comprobar que efectivamente arrancó.
       *
       * `record()` no devuelve nada y no tira error: puede preparar bien, no
       * grabar, y dejar la pantalla exactamente igual que antes. Eso fue lo que
       * pasó al dictar con un recorrido en curso —el registro del sistema
       * mostraba `MediaRecorder: prepare` correcto y la app nunca pasaba a
       * "grabando", sin un solo cartel.
       *
       * Medio segundo alcanza: el estado se relee cada 250 ms.
       */
      await new Promise((r) => setTimeout(r, 600))
      if (!grabador.isRecording) {
        // No arrancó: soltar el micrófono, o el otro campo queda bloqueado por
        // una grabación que no existe.
        liberarMicrofono(identidad)
        setError(
          'El micrófono no llegó a arrancar. Si estás con el recorrido en curso, probá finalizarlo y volver a intentar, o escribí la observación a mano.',
        )
        console.warn('[dictado] prepare ok pero isRecording quedó en false')
      }
    } catch (e) {
      liberarMicrofono(identidad)
      setError('No pudimos abrir el micrófono. Escribí la observación a mano.')
      console.warn('[dictado] error al iniciar', e)
    }
  }, [grabador, identidad])

  const cancelar = useCallback(async () => {
    try {
      if (grabador.isRecording) await grabador.stop()
    } catch {
      // Nada que hacer: el usuario canceló.
    }
    liberarMicrofono(identidad)
    setError(null)
    setAudioPendiente(false)
  }, [grabador, identidad])

  /**
   * Al desmontarse, suelta lo que tenga.
   *
   * Sin esto, salir de la nota con el micrófono abierto dejaba el dueño puesto
   * para siempre: el próximo campo de dictado de la sesión decía "ya hay una
   * grabación en curso" señalando una pantalla que ya no existe.
   */
  useEffect(
    () => () => {
      if (duenoDelMicrofono === identidad) {
        try {
          void grabador.stop()
        } catch {
          // Ya estaba frenado.
        }
        duenoDelMicrofono = null
      }
    },
    [grabador, identidad],
  )

  const detenerYTranscribir = useCallback(async (): Promise<string | null> => {
    try {
      // Puede venir ya frenada por el corte de los 90 segundos, o por un
      // reintento después de que falló la transcripción. Parar dos veces tira
      // error en expo-audio y ese error terminaba tapando el motivo real.
      if (estadoGrabador.isRecording) await grabador.stop()
      // Frenado: el micrófono queda libre aunque todavía falte transcribir.
      liberarMicrofono(identidad)
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

      if (errFuncion) {
        // El audio NO se borra: es lo único que el vendedor ya dijo y no puede
        // volver a decir igual. Queda para reintentar cuando haya señal.
        setAudioPendiente(true)
        setError(
          'No pudimos pasar el audio a texto. Lo guardamos: tocá el micrófono para reintentar, o escribí la observación a mano.',
        )
        return null
      }

      if (data?.aviso) {
        setError(data.aviso)
        return null
      }

      // Recién ahora el archivo temporal no hace falta.
      await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined)
      setAudioPendiente(false)

      return (data?.transcripcion as string) ?? null
    } catch (e) {
      console.warn('[dictado] error al transcribir', e)
      setError('No pudimos transcribir el audio. Escribí la observación a mano.')
      return null
    } finally {
      setTranscribiendo(false)
    }
  }, [grabador, estadoGrabador.isRecording, identidad])

  return {
    grabando: estadoGrabador.isRecording,
    transcribiendo,
    duracionMs: estadoGrabador.durationMillis ?? 0,
    error,
    permisoDenegado,
    audioPendiente,
    comenzar,
    detenerYTranscribir,
    cancelar,
  }
}
