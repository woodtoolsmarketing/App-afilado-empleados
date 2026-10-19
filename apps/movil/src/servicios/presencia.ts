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

/**
 * El módulo de biometría se carga en diferido, y esto NO es una optimización.
 *
 * `expo-local-authentication` hace `requireNativeModule('ExpoLocalAuthentication')`
 * en el cuerpo del módulo, no adentro de una función. Importado arriba, un
 * teléfono que todavía no tiene el APK nuevo revienta al CARGAR el bundle —no al
 * usar la huella— y la app queda inutilizable hasta reinstalarla.
 *
 * Y ese teléfono existe: el OTA viaja por runtime, pero basta con que alguien
 * publique a un runtime viejo para bloquear a toda la calle de una. Con la carga
 * diferida el peor caso es que la biométrica no esté disponible y no se pida,
 * que es exactamente lo que ya pasa en un equipo sin huella configurada.
 */
type ModuloBiometria = typeof import('expo-local-authentication')
let biometria: ModuloBiometria | null | undefined

async function moduloBiometria(): Promise<ModuloBiometria | null> {
  if (biometria !== undefined) return biometria
  try {
    biometria = await import('expo-local-authentication')
  } catch {
    biometria = null
  }
  return biometria
}

/** Si este teléfono puede pedir huella, cara o PIN. */
export async function puedeDesbloquear(): Promise<boolean> {
  try {
    const modulo = await moduloBiometria()
    if (!modulo) return false
    const [hardware, registrado] = await Promise.all([
      modulo.hasHardwareAsync(),
      modulo.isEnrolledAsync(),
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
    const modulo = await moduloBiometria()
    if (!modulo) return false
    const r = await modulo.authenticateAsync({
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
  /** Que el desbloqueo automático salte una sola vez por candado, no en cada dibujado. */
  const pedidoAuto = useRef(false)
  /**
   * Que haya UN solo diálogo de desbloqueo a la vez.
   *
   * El auto-prompt y un toque del botón pueden caer casi juntos; dos
   * `authenticateAsync` encimados tiran "Authentication is already in progress"
   * y uno de los dos queda sin resolver. Un ref —síncrono, a diferencia del
   * estado— corta la segunda llamada antes de abrir el segundo diálogo.
   */
  const enCurso = useRef(false)
  /**
   * La capacidad biométrica del teléfono (hardware + huella/PIN enrolado),
   * cacheada. Se calcula una vez al arrancar y casi nunca cambia en runtime.
   *
   * Sirve para decidir el re-bloqueo al volver de segundo plano SIN esperar a
   * las llamadas nativas (`hasHardwareAsync` + `isEnrolledAsync`). Si ese chequeo
   * se difiere —como estaba—, la última pantalla que quedó montada (que puede
   * tener datos del cliente, p.ej. Cobranzas) queda A LA VISTA el tiempo del
   * round-trip nativo antes de que tape el candado. Con el valor cacheado el
   * `setBloqueado(true)` cae en el MISMO tick del resume. `null` = aún no se supo.
   */
  const puedeRef = useRef<boolean | null>(null)
  /**
   * El bloqueo "al arrancar" es una sola vez por sesión de la app, no cada vez
   * que `habilitado` vuelve a ser true.
   *
   * Cambiar de cuenta hace pasar `estado` por 'cargando', así que `habilitado`
   * cae a false y vuelve a true. Sin esta guarda, ese vaivén volvía a pedir la
   * huella en cada cambio de cuenta —justo lo que "cambio instantáneo" evita—.
   * El desbloqueo del teléfono ya se hizo al abrir la app; volver a pedirlo por
   * cambiar de usuario es un toque de más. El bloqueo por volver del segundo
   * plano (abajo) sigue funcionando igual.
   */
  const yaBloqueoAlArrancar = useRef(false)

  const desbloquear = useCallback(async () => {
    if (enCurso.current) return false
    enCurso.current = true
    setVerificando(true)
    try {
      const ok = await pedirDesbloqueo()
      if (ok) {
        setBloqueado(false)
        void fichar()
      }
      return ok
    } finally {
      enCurso.current = false
      setVerificando(false)
    }
  }, [])

  useEffect(() => {
    if (!habilitado) {
      setBloqueado(false)
      return
    }

    let vivo = true

    // Al arrancar con sesión abierta se pide la llave una vez —pero de verdad
    // una vez por sesión de app, no en cada cambio de cuenta (ver arriba).
    void (async () => {
      if (yaBloqueoAlArrancar.current) return
      yaBloqueoAlArrancar.current = true
      const puede = await puedeDesbloquear()
      puedeRef.current = puede
      if (puede) {
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

      // Al volver al frente, cualquier diálogo de desbloqueo que estuviera
      // abierto ya no está en pantalla. El caso que traba la app: el vendedor
      // manda la app al fondo con la huella abierta (o le entra una llamada) y
      // en varios Android `authenticateAsync` queda sin resolver —ni éxito ni
      // error—, así que el `finally` que baja `verificando` nunca corre y el
      // botón DESBLOQUEAR queda girando y deshabilitado para siempre. Limpiar
      // las banderas acá destraba ese caso: no dispara ningún diálogo (no hay
      // riesgo de bucle), sólo devuelve el botón a estado usable.
      enCurso.current = false
      setVerificando(false)

      const desde = seFueAlFondo.current
      seFueAlFondo.current = null
      void fichar()

      if (desde && Date.now() - desde > MINUTOS_HASTA_BLOQUEAR * 60_000) {
        // El candado tiene que taparse en el MISMO frame del resume, no tras un
        // await: si no, la pantalla que quedó montada (Cobranzas, una ficha, una
        // nota con datos del cliente) asoma el tiempo del round-trip nativo. Por
        // eso se usa la capacidad biométrica CACHEADA y se decide sincrónico.
        if (puedeRef.current === true) {
          setBloqueado(true)
        } else if (puedeRef.current === null) {
          // Caso de borde (el arranque todavía no resolvió): se cae al async.
          void puedeDesbloquear().then((puede) => {
            puedeRef.current = puede
            if (puede && vivo) setBloqueado(true)
          })
        }
        // `false` = sin biometría configurada: no se bloquea (igual que antes).
      }
    })

    return () => {
      vivo = false
      sub.remove()
    }
  }, [habilitado])

  /**
   * El diálogo de huella/cara/PIN salta solo apenas se pone el candado.
   *
   * El vendedor ya desbloqueó el teléfono para llegar hasta acá; obligarlo a
   * tocar "DESBLOQUEAR" antes de que aparezca el diálogo nativo es un toque de
   * más que se repite muchas veces en una jornada de doce horas. Si cancela o
   * falla, el candado sigue puesto y el botón queda como reintento. Una sola vez
   * por candado (`pedidoAuto`), para no reabrir el diálogo en cada render.
   */
  useEffect(() => {
    if (!bloqueado) {
      pedidoAuto.current = false
      return
    }
    if (pedidoAuto.current) return
    pedidoAuto.current = true
    void desbloquear()
  }, [bloqueado, desbloquear])

  return { bloqueado, verificando, desbloquear }
}
