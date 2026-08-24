import * as LocalAuthentication from 'expo-local-authentication'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState } from 'react-native'

import { supabase } from '../nucleo/supabase'
import { ubicacionActual } from './ubicacion'

/**
 * Presencia: el desbloqueo para entrar, y el fichaje de entrada y salida.
 *
 * ── Por qué el desbloqueo del teléfono y no la contraseña ───────────────────
 *
 * Antes había una regla de 30 días: pasado ese plazo —o al cerrar la app, si no
 * habían tildado "recordarme"— el vendedor tenía que escribir usuario y
 * contraseña otra vez, en la calle, con una mano, con el teclado tapando media
 * pantalla. Una contraseña que hay que tipear seguido termina escrita en un
 * papel adentro de la funda, así que esa regla no protegía: molestaba.
 *
 * Ahora la sesión persiste y lo que la protege es lo que el teléfono ya tiene
 * configurado: huella, cara o PIN. Es la misma llave que abre el resto del
 * equipo, y no hay una segunda que recordar.
 */

/** Cuánto puede estar la app en segundo plano antes de volver a pedir la llave. */
const MINUTOS_HASTA_BLOQUEAR = 15

/** Si este teléfono puede pedir huella, cara o PIN. */
export async function puedeDesbloquear(): Promise<boolean> {
  try {
    const [hardware, registrado] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
    ])
    return hardware && registrado
  } catch {
    return false
  }
}

/**
 * Pide la llave del teléfono.
 *
 * `disableDeviceFallback: false` es lo que hace que valga también el PIN o el
 * patrón: un vendedor con el dedo mojado o con guantes no puede quedarse afuera
 * de su herramienta de trabajo por eso.
 */
export async function pedirDesbloqueo(): Promise<boolean> {
  try {
    const r = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Desbloqueá para entrar a WoodTools',
      cancelLabel: 'Cancelar',
      disableDeviceFallback: false,
    })
    return r.success
  } catch {
    return false
  }
}

/**
 * Deja registrada actividad del vendedor, con dónde está.
 *
 * La primera del día entre las 8 y las 18 queda como hora de entrada; la
 * última, como hora de salida. La decisión la toma el servidor con SU reloj:
 * un fichaje que el teléfono pudiera fechar no sería un fichaje.
 *
 * Todo tragado a propósito. Esto corre en el arranque y cada vez que la app
 * vuelve al frente: si falla —sin señal, sin permiso de ubicación— el vendedor
 * tiene que poder seguir trabajando igual.
 */
export async function fichar(): Promise<void> {
  try {
    let donde: { lat: number; lng: number } | null = null
    try {
      donde = await ubicacionActual()
    } catch {
      // Se ficha igual, sin coordenada. Saber que estuvo vale más que dónde.
    }
    await supabase.rpc('fichar', {
      p_lat: donde?.lat ?? null,
      p_lng: donde?.lng ?? null,
    })
  } catch {
    // Nada que hacer acá: el fichaje no es una función que el vendedor pidió.
  }
}

/**
 * El candado de la app.
 *
 * Devuelve si hay que pedir la llave y con qué reintentar. Se bloquea al
 * arrancar y cuando la app vuelve después de un rato largo en segundo plano —no
 * cada vez que se sale a mirar un mensaje, que sería insoportable en una
 * jornada de doce horas—.
 *
 * Si el teléfono no tiene ninguna llave configurada NO se bloquea. Un equipo
 * sin PIN es un problema, pero dejar al vendedor sin poder trabajar hasta que
 * alguien de sistemas se lo configure es un problema peor y más inmediato.
 */
export function usarCandado(habilitado: boolean) {
  const [bloqueado, setBloqueado] = useState(false)
  const [verificando, setVerificando] = useState(false)
  const seFueAlFondo = useRef<number | null>(null)

  const desbloquear = useCallback(async () => {
    setVerificando(true)
    try {
      const ok = await pedirDesbloqueo()
      if (ok) {
        setBloqueado(false)
        void fichar()
      }
      return ok
    } finally {
      setVerificando(false)
    }
  }, [])

  useEffect(() => {
    if (!habilitado) {
      setBloqueado(false)
      return
    }

    let vivo = true

    // Al arrancar con sesión abierta se pide la llave una vez.
    void (async () => {
      if (await puedeDesbloquear()) {
        if (vivo) setBloqueado(true)
      } else {
        // Sin llave configurada no se bloquea, pero la jornada se registra
        // igual: el fichaje no depende de la biométrica.
        void fichar()
      }
    })()

    const sub = AppState.addEventListener('change', (estado) => {
      if (estado === 'background' || estado === 'inactive') {
        seFueAlFondo.current = Date.now()
        return
      }
      if (estado !== 'active') return

      const desde = seFueAlFondo.current
      seFueAlFondo.current = null
      void fichar()

      if (desde && Date.now() - desde > MINUTOS_HASTA_BLOQUEAR * 60_000) {
        void puedeDesbloquear().then((puede) => {
          if (puede && vivo) setBloqueado(true)
        })
      }
    })

    return () => {
      vivo = false
      sub.remove()
    }
  }, [habilitado])

  return { bloqueado, verificando, desbloquear }
}
