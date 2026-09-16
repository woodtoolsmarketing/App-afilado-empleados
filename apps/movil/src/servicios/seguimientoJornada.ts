import { enHorarioDeSeguimiento, type Perfil } from '@woodtools/compartido'
import * as Location from 'expo-location'
import { useEffect, useRef } from 'react'
import { AppState } from 'react-native'

import {
  detenerSeguimiento,
  horarioDeSeguimiento,
  iniciarSeguimientoDeJornada,
  modoSeguimiento,
  pedirPermisosUbicacion,
  seguimientoPausadoHoy,
} from './ubicacion'

/**
 * Seguimiento de jornada: mantiene la ubicación del vendedor visible en el mapa
 * en vivo del panel durante el horario laboral (por defecto lunes a viernes de
 * 8 a 17), sin que tenga que iniciar un recorrido. Fuera de esa franja se apaga.
 *
 * ── La realidad de Android ──────────────────────────────────────────────────
 *
 * No se puede prender el GPS en segundo plano a una hora fija si la app no está
 * corriendo, y las optimizaciones de batería matan los servicios. Así que esto
 * rastrea mientras el vendedor tiene la app abierta/activa: arranca al entrar
 * dentro del horario y sigue con la pantalla apagada (servicio en primer plano)
 * hasta que la tarea detecta que salió del horario y se apaga sola.
 *
 * ── Convivencia con el recorrido ────────────────────────────────────────────
 *
 * El recorrido es un seguimiento aparte, explícito, que además guarda la traza
 * y no se apaga por horario. Este hook no lo toca: sólo maneja el seguimiento de
 * jornada. Si un recorrido termina en pleno horario, este hook lo reanuda como
 * jornada en el próximo chequeo.
 *
 * Rastrea a cualquier usuario habilitado de la app (los que la usan en la calle
 * son los vendedores; la oficina trabaja desde el panel, no desde el celular).
 */
export function usarSeguimientoDeJornada(perfil: Perfil | null, habilitado: boolean) {
  const pidioPermiso = useRef(false)

  useEffect(() => {
    const seRastrea = habilitado && !!perfil
    let vivo = true

    async function reconciliar() {
      if (!vivo || !seRastrea || !perfil) return

      const horario = await horarioDeSeguimiento()
      const dentro = enHorarioDeSeguimiento(new Date(), horario)
      const modo = await modoSeguimiento()

      if (!dentro) {
        // Fuera de horario apagamos SÓLO la jornada; un recorrido sigue.
        if (modo === 'jornada') await detenerSeguimiento(perfil.id)
        return
      }

      // Dentro de horario: si ya rastrea (jornada o recorrido) no hay nada que hacer.
      if (modo) return
      if (await seguimientoPausadoHoy()) return

      // Hace falta permiso de ubicación. Si ya está, arranca; si no, se pide una
      // sola vez por sesión (el resto de la app también lo pide al iniciar un
      // recorrido, así que en general ya viene concedido).
      const fondo = await Location.getBackgroundPermissionsAsync().catch(() => null)
      if (!fondo?.granted) {
        if (pidioPermiso.current) return
        pidioPermiso.current = true
        const r = await pedirPermisosUbicacion()
        if (!r.concedido) return
      }

      if (!vivo) return
      await iniciarSeguimientoDeJornada(perfil.id).catch(() => undefined)
    }

    // Si no hay usuario habilitado y quedó una jornada corriendo (p. ej. se
    // cerró la sesión), se corta.
    if (!seRastrea) {
      void (async () => {
        if ((await modoSeguimiento()) === 'jornada') await detenerSeguimiento(perfil?.id)
      })()
      return () => {
        vivo = false
      }
    }

    void reconciliar()

    const sub = AppState.addEventListener('change', (estado) => {
      if (estado === 'active') void reconciliar()
    })
    // Un chequeo periódico para agarrar el borde de las 17 con la app adelante.
    const reloj = setInterval(() => void reconciliar(), 60_000)

    return () => {
      vivo = false
      sub.remove()
      clearInterval(reloj)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [habilitado, perfil?.id, perfil?.rol])
}
