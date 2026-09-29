import { create } from 'zustand'

import { descargarEInstalarApk, type ApkDisponible } from '../servicios/actualizacionApk'

/**
 * El estado de "bajando la actualización", global.
 *
 * Vive en un store —y no en la pantalla que la disparó— porque la descarga
 * arranca desde un Alert (`ofrecerApk`), que puede saltar en cualquier pantalla,
 * y el modal de progreso está montado una sola vez en la raíz. Así el progreso
 * se sigue viendo aunque el vendedor navegue a otro lado mientras baja.
 */
interface EstadoDescargaApk {
  apk: ApkDisponible | null
  estado: 'idle' | 'bajando' | 'error'
  progreso: number
  error: string | null
  iniciar: (apk: ApkDisponible) => void
  cerrar: () => void
}

export const usarDescargaApk = create<EstadoDescargaApk>((set, get) => ({
  apk: null,
  estado: 'idle',
  progreso: 0,
  error: null,

  iniciar: (apk) => {
    if (get().estado === 'bajando') return
    set({ apk, estado: 'bajando', progreso: 0, error: null })
    descargarEInstalarApk(apk, (fraccion) => set({ progreso: fraccion }))
      .then(() => {
        // El instalador de Android tomó el control. Se cierra el modal: si el
        // vendedor cancela la instalación, vuelve a la app sin nada colgado.
        set({ estado: 'idle', apk: null, progreso: 0, error: null })
      })
      .catch((e: Error) => set({ estado: 'error', error: e.message }))
  },

  cerrar: () => {
    // Mientras baja no se cierra: cortar a medias deja un APK corrupto en cache.
    if (get().estado === 'bajando') return
    set({ estado: 'idle', apk: null, progreso: 0, error: null })
  },
}))
