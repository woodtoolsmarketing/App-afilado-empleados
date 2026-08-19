import { useEffect } from 'react'

import { supabase } from './supabase'

/**
 * Publicar en qué dirección está este panel, para que los teléfonos lo
 * encuentren.
 *
 * ─── Por qué se publica en vez de configurarse ───────────────────────────────
 *
 * La dirección de esta PC en la red la reparte el router, y cambia sola. Ya
 * pasó con la impresora —está anotado en el servicio de impresión de la app,
 * que por eso la busca barriendo la red antes de rendirse— y no hay motivo para
 * suponer que con la PC no va a pasar.
 *
 * Un campo de configuración que alguien completa a mano funciona hasta el día
 * que el router reparte otro número, y ese día nadie relaciona una cosa con la
 * otra: el vendedor toca "Buscar actualizaciones", no pasa nada, y no hay a
 * quién preguntarle. Publicándola el panel al arrancar, el número siempre es el
 * de ahora.
 *
 * Se reescribe cada diez minutos porque el panel puede quedar abierto días y la
 * dirección puede cambiarle abajo sin que nadie lo cierre.
 *
 * Sólo lo hace el admin: la política de `configuracion` deja escribir nada más
 * que a ese rol. Si lo intenta otro, falla y no pasa nada — es un agregado, no
 * puede romper el panel.
 */
const CADA = 10 * 60 * 1000

export function usarPublicarDireccionDelPanel(esAdmin: boolean): void {
  useEffect(() => {
    if (!esAdmin) return

    let vivo = true

    async function publicar() {
      try {
        const datos = await window.woodtools?.instaladores?.()
        if (!vivo || !datos?.direccion) return

        // `http://192.168.1.198:8756` -> { ip, puerto }
        const url = new URL(datos.direccion)

        await supabase.from('configuracion').upsert(
          {
            clave: 'panel_oficina',
            valor: { ip: url.hostname, puerto: Number(url.port) || 8756 },
          },
          { onConflict: 'clave' },
        )
      } catch {
        // Que no se pueda publicar la dirección no puede tumbar el panel: lo
        // único que se pierde es que el teléfono tenga que ir a mirarla a la
        // pantalla de actualizaciones, que es lo que hacía antes de esto.
      }
    }

    void publicar()
    const reloj = setInterval(() => void publicar(), CADA)

    return () => {
      vivo = false
      clearInterval(reloj)
    }
  }, [esAdmin])
}
