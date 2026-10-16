import { useEffect, useRef } from 'react'

/**
 * Una notificación del sistema (toast de Windows) cuando un contador SUBE.
 *
 * El panel ya muestra un globo rojo con el número en el menú, pero el globo sólo
 * se ve si alguien está mirando la pantalla. Esto suma el aviso del sistema —con
 * su sonido— para que la oficina se entere aunque esté en otra ventana: cuando
 * entra un cliente nuevo para confirmar, o un pedido para editar un cliente.
 *
 * Reglas:
 *  · Sólo avisa cuando el número SUBE (llegó algo nuevo), no cuando baja (se
 *    resolvió) ni en cada refresco.
 *  · NO avisa en la primera carga (de `undefined` al número inicial): abrir el
 *    panel con tres pendientes de ayer no es "llegaron tres recién".
 *  · Si el sistema tiene las notificaciones bloqueadas, no pasa nada: el globo
 *    rojo sigue estando.
 *
 * Electron rutea la `Notification` del navegador al sistema operativo; en el panel
 * empaquetado aparece como un toast de Windows (usa el `appId` de la app).
 */
export function usarAvisoDeEscritorio(
  valor: number | undefined,
  titulo: string,
  armarCuerpo: (n: number) => string,
): void {
  const previo = useRef<number | undefined>(undefined)
  // El título y el cuerpo se leen de un ref para que el efecto dependa SÓLO del
  // valor: así no se dispara por una referencia nueva de la función en cada render.
  const textos = useRef({ titulo, armarCuerpo })
  textos.current = { titulo, armarCuerpo }

  useEffect(() => {
    if (valor === undefined) return
    const antes = previo.current
    previo.current = valor
    if (antes === undefined || valor <= antes) return

    try {
      if (typeof Notification !== 'undefined') {
        new Notification(textos.current.titulo, {
          body: textos.current.armarCuerpo(valor),
        })
      }
    } catch {
      /* el SO bloqueó las notificaciones: el globo rojo sigue estando */
    }
  }, [valor])
}
