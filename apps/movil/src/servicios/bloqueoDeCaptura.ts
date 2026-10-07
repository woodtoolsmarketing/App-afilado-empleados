import { useEffect } from 'react'

import { usarSesion } from '../nucleo/sesion'

/**
 * Bloqueo de capturas de pantalla.
 *
 * El vendedor y administración manejan datos de clientes (precios, cuentas,
 * domicilios) que no tienen por qué salir del teléfono en una foto. Mientras una
 * de esas cuentas tiene la sesión abierta, se le pone FLAG_SECURE a la ventana:
 * la captura sale en negro y la app tampoco aparece en la vista de apps
 * recientes. Admin y supervisor quedan afuera —sacan capturas para reportar un
 * problema o documentar algo— y antes de entrar (login/cargando) no se bloquea,
 * porque todavía no hay datos de nadie en pantalla.
 *
 * ── Por qué el módulo se carga en diferido ──────────────────────────────────
 *
 * Igual que la biometría (ver `presencia.ts`): `expo-screen-capture` resuelve su
 * módulo nativo al cargar. Importado arriba, un teléfono que todavía no tiene el
 * APK con este módulo —si el bundle le llegara por un OTA a un runtime viejo—
 * reventaría al CARGAR, no al sacar la captura, y la app quedaría inservible.
 * Con la carga diferida el peor caso es que el bloqueo no esté disponible y no
 * se aplique, que es inofensivo. Este cambio viaja por APK nuevo (1.4.0), no por
 * OTA, justamente por eso.
 */

/** Los roles a los que se les bloquea la captura. */
const ROLES_BLOQUEADOS: ReadonlySet<string> = new Set(['vendedor', 'administracion'])

type ModuloCaptura = typeof import('expo-screen-capture')
let captura: ModuloCaptura | null | undefined

async function moduloCaptura(): Promise<ModuloCaptura | null> {
  if (captura !== undefined) return captura
  try {
    captura = await import('expo-screen-capture')
  } catch {
    captura = null
  }
  return captura
}

/**
 * Prende o apaga el bloqueo según el rol de la sesión.
 *
 * No recibe "habilitado": el rol sólo existe con la cuenta ya habilitada, así
 * que durante el login/cargando `rol` es `undefined` y no se bloquea. Al cambiar
 * de cuenta o cerrar sesión, el rol cambia y el efecto se vuelve a correr.
 */
export function usarBloqueoDeCaptura(): void {
  const rol = usarSesion((s) => s.perfil?.rol)
  const bloquear = rol ? ROLES_BLOQUEADOS.has(rol) : false

  useEffect(() => {
    let vivo = true
    void (async () => {
      const modulo = await moduloCaptura()
      if (!modulo || !vivo) return
      try {
        if (bloquear) await modulo.preventScreenCaptureAsync()
        else await modulo.allowScreenCaptureAsync()
      } catch {
        // Sin el módulo nativo (teléfono sin este APK) no hay nada que hacer.
      }
    })()
    return () => {
      vivo = false
    }
  }, [bloquear])
}
