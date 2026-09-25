import { Audio } from 'expo-av'
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
 * ─── Por qué expo-av y no expo-audio ─────────────────────────────────────────
 *
 * `expo-audio` NO graba en varios Samsung (probado en un A16): prepara la
 * grabadora pero `record()` no arranca nunca —`isRecording` queda en false y en
 * el log no aparece un solo `MediaRecorder.start()`—. Es un bug abierto sin fix
 * (expo/expo#37925), y dejaba mudo tanto el dictado como el audio del reporte.
 * `expo-av` (`Audio.Recording`) es el grabador maduro de Expo: su `startAsync()`
 * es AWAITABLE, o sea que resuelve cuando la grabación arrancó de verdad, que es
 * justo lo que a `expo-audio` le faltaba. Anda en Android/Samsung sin vueltas.
 *
 * Sobre el formato: m4a/AAC mono a 44,1 kHz, 64 kbps. Gemini remuestrea a mono
 * 16 kHz igual, así que no vale la pena grabar en estéreo/alta; 90 s pesan
 * ~720 KB, muy por debajo del tope de la función.
 */

/** Más allá de esto la observación deja de ser una nota y pasa a ser un monólogo. */
export const DURACION_MAXIMA_MS = 90_000

/** `audio/m4a` no está registrado en IANA; el tipo correcto para el contenedor MP4 es `audio/mp4`. */
export const MIME_AUDIO = 'audio/mp4'

/** Opciones de grabación de expo-av: m4a/AAC mono 44,1 kHz 64 kbps, en las tres plataformas. */
export const OPCIONES_AV: Audio.RecordingOptions = {
  isMeteringEnabled: false,
  android: {
    extension: '.m4a',
    outputFormat: Audio.AndroidOutputFormat.MPEG_4,
    audioEncoder: Audio.AndroidAudioEncoder.AAC,
    sampleRate: 44_100,
    numberOfChannels: 1,
    bitRate: 64_000,
  },
  ios: {
    extension: '.m4a',
    outputFormat: Audio.IOSOutputFormat.MPEG4AAC,
    audioQuality: Audio.IOSAudioQuality.MEDIUM,
    sampleRate: 44_100,
    numberOfChannels: 1,
    bitRate: 64_000,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: {
    mimeType: 'audio/webm',
    bitsPerSecond: 128_000,
  },
}

/**
 * Quién tiene el micrófono.
 *
 * El teléfono tiene uno solo, pero cada campo con micrófono arma su propio
 * grabador. En la pantalla de la nota hay dos, pegados: "Datos del cliente" y
 * "Descripción general de la herramienta". Nada impedía abrir los dos a la vez,
 * y ahí el segundo se montaba sobre el primero: en Android uno de los dos
 * terminaba sin audio, o con el audio cortado, **sin un solo cartel**.
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
  const grabacionRef = useRef<Audio.Recording | null>(null)
  /** El audio grabado que todavía no se transcribió (corte a 90 s o reintento). */
  const uriPendiente = useRef<string | null>(null)
  /** Identidad de este campo, para saber si el micrófono es suyo. */
  const identidad = useRef<symbol>(Symbol('dictado')).current

  const [grabando, setGrabando] = useState(false)
  const [duracionMs, setDuracionMs] = useState(0)
  const [transcribiendo, setTranscribiendo] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [permisoDenegado, setPermisoDenegado] = useState(false)
  const [audioPendiente, setAudioPendiente] = useState(false)

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

    // Empezar de nuevo descarta un audio pendiente anterior.
    if (uriPendiente.current) {
      await FileSystem.deleteAsync(uriPendiente.current, { idempotent: true }).catch(() => undefined)
      uriPendiente.current = null
    }
    setAudioPendiente(false)

    try {
      const permiso = await Audio.requestPermissionsAsync()
      if (!permiso.granted) {
        setPermisoDenegado(true)
        setError('Necesitamos permiso para usar el micrófono. Podés escribir la observación a mano.')
        return
      }
      setPermisoDenegado(false)

      duenoDelMicrofono = identidad

      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true })

      const rec = new Audio.Recording()
      rec.setProgressUpdateInterval(250)
      rec.setOnRecordingStatusUpdate((estado) => {
        setGrabando(estado.isRecording)
        setDuracionMs(estado.durationMillis ?? 0)

        // Corta sola al llegar al máximo. El audio queda pendiente para pasarlo
        // a texto, y el micrófono se libera.
        if (estado.isRecording && (estado.durationMillis ?? 0) >= DURACION_MAXIMA_MS) {
          void (async () => {
            try {
              await rec.stopAndUnloadAsync()
            } catch {
              // Ya estaba frenado.
            }
            if (grabacionRef.current === rec) grabacionRef.current = null
            liberarMicrofono(identidad)
            setGrabando(false)
            uriPendiente.current = rec.getURI() ?? null
            setAudioPendiente(true)
            setError(
              `La grabación llegó al máximo de ${DURACION_MAXIMA_MS / 1000} segundos y se cortó. Tocá el micrófono para pasar a texto lo que alcanzaste a decir.`,
            )
          })()
        }
      })

      // `startAsync()` es awaitable: resuelve cuando la grabación arrancó.
      await rec.prepareToRecordAsync(OPCIONES_AV)
      await rec.startAsync()
      grabacionRef.current = rec
    } catch (e) {
      liberarMicrofono(identidad)
      setError('No pudimos abrir el micrófono. Escribí la observación a mano.')
      console.warn('[dictado] error al iniciar', e)
    }
  }, [identidad])

  const cancelar = useCallback(async () => {
    const rec = grabacionRef.current
    if (rec) {
      try {
        await rec.stopAndUnloadAsync()
      } catch {
        // Ya estaba frenado.
      }
      grabacionRef.current = null
    }
    if (uriPendiente.current) {
      await FileSystem.deleteAsync(uriPendiente.current, { idempotent: true }).catch(() => undefined)
      uriPendiente.current = null
    }
    liberarMicrofono(identidad)
    setGrabando(false)
    setError(null)
    setAudioPendiente(false)
  }, [identidad])

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
        const rec = grabacionRef.current
        if (rec) {
          try {
            void rec.stopAndUnloadAsync()
          } catch {
            // Ya estaba frenado.
          }
        }
        duenoDelMicrofono = null
      }
    },
    [identidad],
  )

  const detenerYTranscribir = useCallback(async (): Promise<string | null> => {
    try {
      // El uri puede venir de la grabación en curso, o de un audio pendiente
      // (cortado a los 90 s, o un reintento después de que falló la subida).
      let uri = uriPendiente.current
      const rec = grabacionRef.current
      if (rec) {
        try {
          await rec.stopAndUnloadAsync()
        } catch {
          // Ya estaba frenado.
        }
        uri = rec.getURI() ?? uri
        grabacionRef.current = null
      }
      liberarMicrofono(identidad)
      setGrabando(false)

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
        body: { audioBase64, mimeType: MIME_AUDIO },
      })

      if (errFuncion) {
        // El audio NO se borra: es lo único que el vendedor ya dijo y no puede
        // volver a decir igual. Queda para reintentar cuando haya señal.
        uriPendiente.current = uri
        setAudioPendiente(true)
        setError(
          'No pudimos pasar el audio a texto. Lo guardamos: tocá el micrófono para reintentar, o escribí la observación a mano.',
        )
        return null
      }

      if (data?.aviso) {
        // El backend entendió el audio pero no sacó texto ("probá grabar de
        // nuevo"): reenviar los mismos bytes daría el mismo veredicto, así que
        // este audio se descarta como en el éxito y el próximo toque graba uno
        // nuevo, en vez de quedar el micrófono trabado reenviando lo mismo.
        await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined)
        uriPendiente.current = null
        setAudioPendiente(false)
        setError(data.aviso)
        return null
      }

      // Recién ahora el archivo temporal no hace falta.
      await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined)
      uriPendiente.current = null
      setAudioPendiente(false)

      return (data?.transcripcion as string) ?? null
    } catch (e) {
      console.warn('[dictado] error al transcribir', e)
      setError('No pudimos transcribir el audio. Escribí la observación a mano.')
      return null
    } finally {
      setTranscribiendo(false)
    }
  }, [identidad])

  return {
    grabando,
    transcribiendo,
    duracionMs,
    error,
    permisoDenegado,
    audioPendiente,
    comenzar,
    detenerYTranscribir,
    cancelar,
  }
}
