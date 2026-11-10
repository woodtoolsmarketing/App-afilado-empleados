import {
  distanciaEnMetros,
  espaciado,
  estaUbicada,
  ETIQUETA_ESTADO_PARADA,
  ETIQUETA_PRIORIDAD,
  formatearDistancia,
  formatearDuracion,
  radios,
  todaviaNoLeToca,
  TOQUE_MINIMO,
  type EstadoParada,
  type Paleta,
  type ParadaCompleta,
} from '@woodtools/compartido'
import { useFocusEffect } from '@react-navigation/native'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, AppState, Modal, Pressable, Text, View } from 'react-native'
import DraggableFlatList, {
  ScaleDecorator,
  type RenderItemParams,
} from 'react-native-draggable-flatlist'
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps'

import { BotonMenu, BotonPrincipal, BotonSecundario } from '../componentes/Botones'
import { Aviso, Cargando, Pastilla, Vacio } from '../componentes/Estado'
import { Encabezado } from '../componentes/Encabezado'
import { BarraPanel, Pantalla, Panel, TituloPanel } from '../componentes/Pantalla'
import { usarSesion } from '../nucleo/sesion'
import {
  finalizarRecorrido,
  iniciarRecorrido,
  obtenerJornadaDeHoy,
  quitarParadaDelRecorrido,
  reactivarParada,
  reordenarParadas,
  type JornadaCompleta,
} from '../servicios/jornada'
import { misCambiosPendientes, type CambioPendiente } from '../servicios/cambiosDireccion'
import {
  buscarEnMapsPorTexto,
  decodificarPolilinea,
  navegarHacia,
  optimizarRecorrido,
  previsualizarRecorrido,
} from '../servicios/mapas'
import {
  detenerSeguimiento,
  iniciarSeguimiento,
  pedirPermisosUbicacion,
  radioDeLlegadaM,
  ubicacionActual,
} from '../servicios/ubicacion'
import type { PropsPantalla } from '../navegacion/tipos'
import { hojaDeTema, usarTema } from '../nucleo/tema'

/**
 * "ESTE ES TU RECORRIDO DEL DÍA DE HOY"
 *
 * Mapa con el trazado completo arriba y la lista ordenada de destinos abajo.
 * Desde acá se arranca el recorrido, se navega al próximo destino y se carga
 * el parte de cada visita.
 */
export function PantallaRecorrido({ navigation, route }: PropsPantalla<'Recorrido'>) {
  const { colores } = usarTema()
  const estilos = usarEstilos()
  const perfil = usarSesion((s) => s.perfil)
  const cliente = useQueryClient()
  const mapa = useRef<MapView>(null)
  // Dos carteles separados a propósito: el de la JORNADA (permiso de ubicación,
  // tránsito) es una advertencia que tiene que quedar mientras dure el
  // recorrido; el de MAPS (tope de destinos, no se pudo abrir) es puntual del
  // último toque a Google Maps. Compartir un solo estado hacía que el segundo
  // pisara al primero.
  const [avisoJornada, setAvisoJornada] = useState<string | null>(null)
  const [avisoMaps, setAvisoMaps] = useState<string | null>(null)
  // La ventana que pregunta CÓMO arrancar: con Google Maps o guiado por la app.
  const [eligiendoModo, setEligiendoModo] = useState(false)
  // El id de la parada cuya hoja de "mover" está abierta, o null.
  const debeIniciar = route.params?.iniciar === true

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['jornada-hoy', perfil?.id],
    queryFn: () => obtenerJornadaDeHoy(perfil!.id),
    enabled: !!perfil,
  })

  const jornada = data?.jornada

  // Cambios de dirección que este vendedor propuso y la oficina no aplicó: la
  // navegación al destino los prefiere, así va al punto nuevo y no al viejo.
  const { data: cambiosPendientes } = useQuery({
    queryKey: ['mis-cambios-direccion'],
    queryFn: misCambiosPendientes,
    staleTime: 60_000,
  })
  // Las omitidas no se muestran: quitar un destino lo marca 'omitida' y, al
  // filtrarlo acá, desaparece de la lista y del mapa en el acto. Sigue existiendo
  // en la base (para el historial), pero del recorrido de hoy se fue.
  const paradas = useMemo(
    () => (data?.paradas ?? []).filter((p) => p.estado !== 'omitida'),
    [data],
  )

  /**
   * Las que SÍ tienen punto en el mapa.
   *
   * Un destino puede estar en el recorrido sin estar ubicado: el vendedor
   * agrega un cliente que ya sabe dónde queda, sale, y recién cuando llega
   * guarda la ubicación. Para la LISTA eso no cambia nada —está, tiene número y
   * se visita igual—, pero para el MAPA sí: sin lat/lng no hay pin que dibujar,
   * no hay a qué encuadrar la cámara y no hay región inicial. Todo lo que mira
   * el mapa usa esta lista; todo lo que mira el recorrido usa `paradas`.
   *
   * Va por `estaUbicada` y no por `p.direccion !== null` porque ese filtro
   * además ESTRECHA el tipo: de acá para abajo `p.direccion.lat` es un dato, no
   * un `!` que miente el día que alguien cambie el filtro.
   */
  const paradasUbicadas = useMemo(() => paradas.filter(estaUbicada), [paradas])
  const enCurso = jornada?.estado === 'en_curso'

  // Las que todavía hay que visitar, en orden: sobre estas opera el
  // reordenamiento a mano. Las resueltas conservan su lugar y no se mueven.
  const abiertas = useMemo(
    () => paradas.filter((p) => p.estado === 'pendiente' || p.estado === 'en_camino'),
    [paradas],
  )

  // El radio lo decide la oficina, no la app. Se cachea todo el día: no cambia
  // en el medio de un recorrido y no vale una consulta por cada vez que el
  // teléfono vuelve del bolsillo.
  const { data: radioDeLlegada = 150 } = useQuery({
    queryKey: ['radio-de-llegada'],
    queryFn: radioDeLlegadaM,
    staleTime: 12 * 60 * 60 * 1000,
  })
  const finalizada = jornada?.estado === 'finalizado'

  /**
   * El próximo destino: el primero sin resolver, por orden de recorrido.
   *
   * Antes buscaba primero el que estuviera 'en_camino' y recién después el
   * primer 'pendiente'. Eso rompía la prioridad por cercanía: un destino
   * agregado estando cerca entra con orden 1 y corre a los demás, pero nace
   * 'pendiente', así que "PRÓXIMO DESTINO", "Navegar" y "LLEGUÉ" seguían
   * apuntando al que ya estaba 'en_camino'. La lista mostraba al nuevo como
   * Nº 1 y al viejo como Nº 2 con la pastilla "En camino" —los dos números
   * contradiciéndose— y el mapa mandaba al cliente lejano en vez de al que
   * estaba a tres cuadras, que es justo lo que la prioridad alta prometía.
   *
   * `paradas` ya viene ordenado por `orden` desde el servicio, así que el
   * primero sin resolver es el que corresponde.
   */
  const proxima = useMemo(
    () =>
      // Las diferidas que todavía no vencieron quedan afuera: si el vendedor
      // dijo "vuelvo a las 16:30", a las 14:00 no es el próximo destino. Es la
      // misma regla que aplica `registrar_visita` para promover a 'en_camino'.
      paradas.find(
        (p) =>
          (p.estado === 'en_camino' || p.estado === 'pendiente') && !todaviaNoLeToca(p),
      ) ?? paradas.find((p) => p.estado === 'en_camino'),
    [paradas],
  )

  /**
   * Con qué se va al próximo destino: un punto, o un domicilio escrito.
   *
   * Una parada sin ubicar no tiene a dónde navegar, pero casi siempre tiene el
   * domicilio de texto que vino del sistema de gestión, y el vendedor ya sabe
   * más o menos dónde queda. Se resuelven acá arriba —y no adentro del JSX—
   * porque de esto dependen dos cosas distintas: qué renglón de domicilio se
   * muestra y qué botón se ofrece al lado de LLEGUÉ.
   *
   * Si el vendedor propuso corregir esta dirección, manda el punto propuesto
   * (hasta que la oficina lo aplique). Se exigen las DOS coordenadas propuestas:
   * antes se tomaba cada una por separado con `??`, así que una propuesta a
   * medio geocodificar mezclaba la latitud nueva con la longitud vieja y
   * mandaba al vendedor a un punto que no existe en ningún lado.
   */
  const cambioDeLaProxima = proxima?.cliente?.id
    ? cambiosPendientes?.[proxima.cliente.id]
    : undefined
  const puntoDeLaProxima = proxima ? puntoDeNavegacion(proxima, cambioDeLaProxima) : null
  const domicilioDeLaProxima = proxima ? domicilioDe(proxima) : null

  /**
   * Llegó al cliente: se le ofrece cargar el parte sin que lo busque.
   *
   * ── Cuándo se fija ────────────────────────────────────────────────────────
   *
   * Al entrar a esta pantalla y cada vez que la app vuelve al frente. NO con la
   * app cerrada: eso sería una geocerca en segundo plano, con permiso nuevo,
   * notificación permanente y batería, y para un vendedor que abre la app al
   * bajarse del auto no cambia nada.
   *
   * ── Por qué pregunta en vez de saltar ─────────────────────────────────────
   *
   * Porque el radio es de 150 metros y en una cuadra entran varios clientes.
   * Saltar solo a un formulario de otro cliente, en el medio de la calle, es
   * peor que no saltar: se completa sin mirar y queda un parte cargado al que
   * no era. Se pregunta una vez por destino y no se vuelve a insistir.
   */
  const yaPreguntado = useRef<string | null>(null)

  const ofrecerCargarLaVisita = useCallback(async (sigueVigente: () => boolean) => {
    // Sin coordenadas del destino no hay contra qué medir la distancia, así que
    // una parada SIN UBICAR nunca dispara este aviso. No es una limitación a
    // arreglar: es la única respuesta honesta. Ahí el que sabe que llegó es el
    // vendedor, y para eso está el botón LLEGUÉ —que sigue andando igual y es,
    // justamente, donde va a guardar dónde queda el cliente.
    if (!proxima?.direccion || !enCurso) return
    if (yaPreguntado.current === proxima.id) return
    // Sólo con el recorrido a la vista. Este aviso también corre al volver
    // a la app —de Google Maps, típicamente—, y el recorrido sigue montado
    // debajo de la visita que el vendedor está cargando: "Cargar la visita"
    // desde ahí lo sacaba de lo que estaba haciendo.
    if (!navigation.isFocused()) return

    let donde: { lat: number; lng: number } | null = null
    try {
      donde = await ubicacionActual()
    } catch {
      // Sin señal no se ofrece nada y no se avisa: el vendedor está trabajando.
      return
    }

    const metros = distanciaEnMetros(donde, {
      lat: proxima.direccion.lat,
      lng: proxima.direccion.lng,
    })
    // El GPS tarda: en el medio pudo haber entrado a otra pantalla, la app
    // pudo irse al fondo, o el candado pudo desmontar la navegación (ahí
    // isFocused() sigue dando true, por eso además `sigueVigente`).
    if (metros > radioDeLlegada) return
    if (!sigueVigente() || !navigation.isFocused() || AppState.currentState !== 'active') return

    yaPreguntado.current = proxima.id
    Alert.alert(
      'Llegaste',
      `Estás a ${formatearDistancia(metros)} de ${proxima.cliente?.razon_social ?? 'este destino'}. ¿Cargamos la visita?`,
      [
        { text: 'Todavía no', style: 'cancel' },
        {
          text: 'Cargar la visita',
          onPress: () => navigation.navigate('DestinoVisitado', { paradaId: proxima.id }),
        },
      ],
    )
  }, [proxima, enCurso, radioDeLlegada, navigation])

  // Al enfocarse —no sólo al montarse— y cada vez que la app vuelve al frente
  // con el recorrido a la vista. Sin el disparo por foco, un aviso que se
  // salteó por tener otra pantalla encima no se volvía a ofrecer al volver al
  // recorrido. `vigente` corta lo que quede en vuelo cuando se pierde el foco
  // o se desmonta la pantalla.
  useFocusEffect(
    useCallback(() => {
      let vigente = true
      const sigueVigente = () => vigente
      void ofrecerCargarLaVisita(sigueVigente)
      const sub = AppState.addEventListener('change', (estado) => {
        if (estado === 'active') void ofrecerCargarLaVisita(sigueVigente)
      })
      return () => {
        vigente = false
        sub.remove()
      }
    }, [ofrecerCargarLaVisita]),
  )

  const trazado = useMemo(
    () => (jornada?.polilinea ? decodificarPolilinea(jornada.polilinea) : []),
    [jornada?.polilinea],
  )

  // ── Iniciar recorrido ──────────────────────────────────────────────────────
  const arrancar = useMutation({
    mutationFn: async ({ irAGoogleMaps }: { irAGoogleMaps: boolean }) => {
      if (!jornada || !perfil) throw new Error('Todavía no cargó la jornada')

      // Cada arranque empieza con los dos carteles limpios. Los avisos de la
      // jornada (tránsito, permiso) son varios y se juntan en una lista para
      // mostrarlos de una en `avisoJornada`.
      setAvisoJornada(null)
      setAvisoMaps(null)
      const avisos: string[] = []

      const permiso = await pedirPermisosUbicacion()
      if (!permiso.concedido) throw new Error(permiso.motivo)

      const pos = await ubicacionActual()

      /**
       * Primero se larga, y RECIÉN DESPUÉS se optimiza.
       *
       * El orden importa porque las dos cosas escriben `orden`:
       * `iniciar_recorrido` reordena por cercanía en línea recta, y
       * `optimizar_recorrido` por lo que dice Google mirando el tránsito. Al
       * revés, la optimización se perdía sin que nadie la viera: la lista
       * "DESTINOS DEL DÍA" quedaba numerada por cercanía mientras la
       * polilínea azul del mapa y el resumen de km y minutos eran de la
       * secuencia de Google. Dos rutas distintas en la misma pantalla, y las
       * paradas de prioridad media perdían su adelanto.
       *
       * Es el mismo orden que ya usa CLIENTES DE HOY.
       */
      await iniciarRecorrido(jornada.id, pos.lat, pos.lng)

      // El orden óptimo recién calculado: es la secuencia de IDs que hay que
      // pasarle a Google Maps para que reciba la MEJOR ruta y no una cualquiera.
      let ordenOptimo: string[] | null = null
      try {
        const r = await optimizarRecorrido(jornada.id, { lat: pos.lat, lng: pos.lng })
        ordenOptimo = r.orden ?? null
      } catch {
        avisos.push(
          'No pudimos consultar el tránsito de Google. El recorrido queda ordenado por cercanía.',
        )
      }
      await iniciarSeguimiento({ vendedorId: perfil.id, rolVisitaId: jornada.id })

      if (!permiso.segundoPlano) {
        avisos.push(
          'Diste permiso de ubicación sólo con la app abierta. Si apagás la pantalla, la oficina va a dejar de verte.',
        )
      }
      if (avisos.length) setAvisoJornada(avisos.join('\n\n'))

      // "IR A GOOGLE MAPS": se abre el recorrido completo, ya optimizado, en la
      // app de Google Maps para manejar. Se arranca igual la jornada y el
      // seguimiento —de eso vive la oficina—; esto sólo cambia con qué se navega.
      //
      // Todo lo de abrir Maps va envuelto: la jornada YA arrancó y el
      // seguimiento está prendido, así que si falla releer o abrir el mapa se
      // degrada a un aviso, no se tira por la borda un arranque que sí funcionó.
      if (irAGoogleMaps) {
        try {
          let enOrden: ParadaCompleta[]
          if (ordenOptimo) {
            // Reordeno las paradas locales según el orden que devolvió la
            // optimización (las coordenadas no cambian, sólo la secuencia).
            enOrden = ordenOptimo
              .map((id) => paradas.find((p) => p.id === id))
              .filter(Boolean) as ParadaCompleta[]
          } else {
            // Sin optimización, releo la jornada para tomar el orden por
            // cercanía que `iniciarRecorrido` acaba de escribir en el servidor:
            // el `paradas` del closure todavía tiene el orden previo al arranque,
            // y abrir Maps con ése dejaría la app y el mapa con dos secuencias.
            let base = paradas
            try {
              const fresca = await obtenerJornadaDeHoy(perfil.id)
              if (fresca?.paradas) base = fresca.paradas
            } catch {
              // Sin relectura usamos lo que hay: peor el orden que ningún mapa.
            }
            enOrden = base.filter(
              (p) => p.estado === 'pendiente' || p.estado === 'en_camino',
            )
          }
          // Cuántos quedan afuera del enlace por no tener punto. Se cuenta ACÁ
          // y no del resultado: `previsualizarRecorrido` devuelve `total` ya
          // filtrado a las ubicadas, así que desde afuera las que descartó son
          // invisibles.
          const sinUbicar = enOrden.length - enOrden.filter(estaUbicada).length

          const maps = await previsualizarRecorrido(
            { lat: pos.lat, lng: pos.lng },
            enOrden,
            { navegar: true },
          )
          // Un recorrido entero sin ubicar no tiene ruta que abrir: Maps se
          // queda cerrado y, sin este cartel, el vendedor toca IR A GOOGLE MAPS
          // y no pasa absolutamente nada. La jornada SÍ arrancó —eso es lo que
          // mira la oficina—, así que lo que hay que decirle es cómo seguir.
          if (!maps.abierto) {
            setAvisoMaps(
              'Ninguno de tus destinos tiene la ubicación guardada todavía, así que no hay ruta para abrir en Google Maps. ' +
                'El recorrido igual arrancó: seguí la lista de acá abajo y, al llegar a cada cliente, tocá LLEGUÉ y después ESTOY ACÁ para guardar dónde queda.',
            )
          }
          return { maps, sinUbicar }
        } catch {
          // La jornada ya arrancó y el seguimiento está prendido; sólo falló
          // abrir Maps. Va al cartel de Maps, sin pisar el de la jornada.
          setAvisoMaps(
            'No pudimos abrir Google Maps. Seguí el recorrido desde la app, o tocá VER RECORRIDO EN GOOGLE MAPS para reintentar.',
          )
          return { maps: null, sinUbicar: 0 }
        }
      }

      return { maps: null, sinUbicar: 0 }
    },
    onSuccess: (r) => {
      void cliente.invalidateQueries({ queryKey: ['jornada-hoy'] })
      void cliente.invalidateQueries({ queryKey: ['resumen-hoy'] })
      // El techo de destinos por enlace lo pone Google, no nosotros: mejor
      // avisar que abrir un mapa al que le faltan paradas sin decir nada. Va en
      // su propio cartel (avisoMaps), así no pisa el de permiso/tránsito de la
      // jornada, y manda a un botón que sí existe con la jornada en curso.
      //
      // Los dos motivos van juntos en UN cartel, igual que en `abrirMaps`: dos
      // `setAvisoMaps` seguidos se pisan y el vendedor se entera de uno solo.
      const motivos: string[] = []

      if (r?.maps?.abierto && r.maps.incluidas < r.maps.total) {
        motivos.push(
          `Google Maps abre hasta ${r.maps.incluidas} destinos por vez y tu recorrido tiene ${r.maps.total}. ` +
            'Cuando llegues al último, tocá VER RECORRIDO EN GOOGLE MAPS para seguir con el resto.',
        )
      }

      // Y los que Maps ni siquiera vio. Sin esto, el vendedor abre el trazado
      // con 4 de sus 6 destinos y los otros dos desaparecen sin dejar rastro.
      if (r?.maps?.abierto && r.sinUbicar > 0) {
        motivos.push(
          r.sinUbicar === 1
            ? 'Queda 1 destino sin ubicar: no entra en el mapa, pero está en la lista con su domicilio. Ubicalo cuando llegues.'
            : `Quedan ${r.sinUbicar} destinos sin ubicar: no entran en el mapa, pero están en la lista con su domicilio. Los ubicás cuando llegues.`,
        )
      }

      if (motivos.length > 0) setAvisoMaps(motivos.join('\n\n'))
    },
    onError: (e: Error) => Alert.alert('No pudimos iniciar el recorrido', e.message),
  })

  /**
   * "VER RECORRIDO EN GOOGLE MAPS", con la jornada ya en curso.
   *
   * Reabre en Maps lo que FALTA visitar, en el orden que muestra la lista
   * (ya optimizado). Sirve para retomar tras cerrar Maps y, sobre todo, para
   * seguir con el resto cuando el recorrido no entró entero en un solo enlace:
   * es el botón al que apunta el aviso del tope de destinos.
   */
  const abrirMaps = useMutation({
    mutationFn: async () => {
      const pendientes = paradas.filter(
        (p) => p.estado === 'pendiente' || p.estado === 'en_camino',
      )
      if (pendientes.length === 0) throw new Error('No te quedan destinos por visitar.')

      // Las sin ubicar no entran en un enlace de Maps: no hay punto que mandar.
      // `previsualizarRecorrido` ya las descarta, pero si las descarta a TODAS
      // no abre nada y se queda callado —para el vendedor, un botón muerto—.
      // Acá se corta antes y se dice por qué, que es lo que le permite decidir.
      const conPunto = pendientes.filter(estaUbicada)
      if (conPunto.length === 0) {
        throw new Error(
          'Los destinos que te quedan todavía no tienen la ubicación guardada, así que no hay ruta que abrir. ' +
            'Andá igual con el domicilio de la lista y, cuando llegues, tocá LLEGUÉ y después ESTOY ACÁ para guardar dónde queda.',
        )
      }

      const pos = await ubicacionActual()
      const maps = await previsualizarRecorrido(pos, conPunto, { navegar: true })
      return { maps, sinUbicar: pendientes.length - conPunto.length }
    },
    onSuccess: ({ maps, sinUbicar }) => {
      // Al cartel de Maps (su propio estado): no pisa el aviso de permiso de la
      // jornada, y al reemplazarse no se apilan avisos si se toca varias veces.
      // Los dos motivos se juntan en un solo cartel por la misma razón: el
      // segundo `setAvisoMaps` pisaría al primero y el vendedor se enteraría de
      // una sola de las dos cosas que le faltan al mapa que acaba de abrir.
      const motivos: string[] = []
      if (maps.abierto && maps.incluidas < maps.total) {
        motivos.push(
          `Google Maps abre hasta ${maps.incluidas} destinos por vez y te quedan ${maps.total}. ` +
            'Al llegar al último, tocá de nuevo VER RECORRIDO EN GOOGLE MAPS para el resto.',
        )
      }
      if (sinUbicar > 0) {
        motivos.push(
          sinUbicar === 1
            ? 'Queda 1 destino sin ubicar: no entra en el mapa, pero está en la lista con su domicilio. Ubicalo cuando llegues.'
            : `Quedan ${sinUbicar} destinos sin ubicar: no entran en el mapa, pero están en la lista con su domicilio. Los ubicás cuando llegues.`,
        )
      }
      if (motivos.length) setAvisoMaps(motivos.join('\n\n'))
    },
    onError: (e: Error) => Alert.alert('No pudimos abrir Google Maps', e.message),
  })

  /**
   * "Ordenar por cercanía", a mano, sin arrancar el recorrido.
   *
   * Es el mismo botón que la oficina tiene en el panel: reordena los destinos
   * por tiempo real de manejo (Google) y, si no hay tránsito, por cercanía
   * (PostGIS). Sirve para replanificar en la calle —cuando se agrega o se
   * difiere un destino— sin tener que finalizar y volver a iniciar. La edge
   * function deja al vendedor optimizar SU propia jornada, así que no hace
   * falta nada del lado de la oficina.
   *
   * Se le pasa la ubicación actual como origen cuando el GPS la da; si no, la
   * optimización usa el origen que tenga guardado la jornada o el vendedor.
   */
  const ordenar = useMutation({
    mutationFn: async () => {
      if (!jornada) throw new Error('Todavía no cargó la jornada')
      let origen: { lat: number; lng: number } | undefined
      try {
        const pos = await ubicacionActual()
        origen = { lat: pos.lat, lng: pos.lng }
      } catch {
        // Sin GPS igual se puede ordenar: la edge function cae al origen guardado.
      }
      return optimizarRecorrido(jornada.id, origen)
    },
    onSuccess: (r) => {
      void cliente.invalidateQueries({ queryKey: ['jornada-hoy'] })

      /*
       * El festejo se gana, no se da por hecho.
       *
       * Con todos los destinos sin ubicar no hay nada contra qué medir: la
       * función devuelve `optimizado: false` y explica por qué. Decir "Ordené
       * los destinos por cercanía y tiempo de manejo" igual es prometer un
       * trabajo que no se hizo — y el vendedor se queda tranquilo con una lista
       * que quedó exactamente como estaba.
       */
      if (!r.optimizado) {
        Alert.alert(
          'No había nada que ordenar',
          r.mensaje ??
            'Tus destinos todavía no tienen la ubicación guardada, así que no hay distancias con qué compararlos. La lista quedó como estaba.',
        )
        return
      }

      Alert.alert('Recorrido ordenado', 'Ordené los destinos por cercanía y tiempo de manejo.')
    },
    onError: (e: Error) => Alert.alert('No pudimos ordenar el recorrido', e.message),
  })

  /**
   * Reordenar los destinos ARRASTRÁNDOLOS en la propia lista del recorrido (#4).
   *
   * Opera sólo sobre las abiertas —las resueltas no se mueven, no se arrastran—.
   * Se puede antes de arrancar y también en curso: a diferencia de "Ordenar por
   * cercanía" (automático), es una decisión explícita del vendedor. El orden se
   * guarda solo al soltar (update optimista).
   */
  const mover = useMutation({
    mutationFn: (nuevoOrden: string[]) => {
      if (!jornada) throw new Error('Todavía no cargó la jornada')
      return reordenarParadas(jornada.id, nuevoOrden)
    },
    // Update optimista: la lista se acomoda en el acto, sin esperar a la base
    // —que en la calle puede tardar—. Si la base rechaza, se vuelve atrás.
    onMutate: async (nuevoOrden) => {
      await cliente.cancelQueries({ queryKey: ['jornada-hoy', perfil?.id] })
      const previo = cliente.getQueryData<JornadaCompleta>(['jornada-hoy', perfil?.id])
      if (previo) {
        cliente.setQueryData(['jornada-hoy', perfil?.id], reordenarEnCache(previo, nuevoOrden))
      }
      return { previo }
    },
    onError: (e: Error, _n, ctx) => {
      if (ctx?.previo) cliente.setQueryData(['jornada-hoy', perfil?.id], ctx.previo)
      Alert.alert('No pudimos cambiar el orden', e.message)
    },
    onSettled: () => cliente.invalidateQueries({ queryKey: ['jornada-hoy', perfil?.id] }),
  })

  /**
   * Al soltar el arrastre: toma el nuevo orden de las ABIERTAS y lo guarda. El
   * `data` que da draggable-flatlist es la lista entera reordenada; de ahí se
   * filtran las abiertas en su orden nuevo. Si no cambió nada (se soltó en el
   * mismo lugar) no se dispara ninguna escritura.
   */
  const reordenarPorArrastre = useCallback(
    ({ data }: { data: ParadaCompleta[] }) => {
      const nuevo = data
        .filter((p) => p.estado === 'pendiente' || p.estado === 'en_camino')
        .map((p) => p.id)
      const actual = abiertas.map((p) => p.id)
      const cambio =
        nuevo.length !== actual.length || nuevo.some((id, i) => id !== actual[i])
      if (cambio) mover.mutate(nuevo)
    },
    [abiertas, mover],
  )

  /**
   * "Viajar" a ESTE destino: abre Google Maps navegando directo a ese cliente.
   * Con punto, navegación paso a paso; sin punto pero con domicilio escrito, se
   * busca ese domicilio en Maps; sin ninguno de los dos, se avisa.
   */
  const viajarA = useCallback((p: ParadaCompleta) => {
    if (estaUbicada(p)) {
      void navegarHacia({ lat: p.direccion.lat, lng: p.direccion.lng }).catch(() => undefined)
      return
    }
    const domicilio = (p.direccion_snapshot ?? '').trim()
    if (domicilio) {
      void buscarEnMapsPorTexto(domicilio).catch(() => undefined)
      return
    }
    Alert.alert(
      'Ese destino todavía no está en el mapa',
      'No tenemos ni el punto ni el domicilio escrito, así que no hay a dónde llevarte. Cuando llegues, cargá la visita y tocá ESTOY ACÁ para guardar dónde queda.',
    )
  }, [])

  /**
   * Quitar un destino del recorrido del día.
   *
   * Lo marca 'omitida' (`quitar_de_la_agenda`), que es lo que ya hace el
   * calendario: no se borra la fila —el historial la conserva— pero sale de la
   * lista y del mapa de hoy. Update optimista para que desaparezca en el acto; si
   * la base rechaza, vuelve. Sólo las abiertas se pueden quitar.
   */
  const quitar = useMutation({
    mutationFn: (paradaId: string) => {
      if (!jornada) throw new Error('Todavía no cargó la jornada')
      return quitarParadaDelRecorrido(paradaId)
    },
    onMutate: async (paradaId) => {
      await cliente.cancelQueries({ queryKey: ['jornada-hoy', perfil?.id] })
      const previo = cliente.getQueryData<JornadaCompleta>(['jornada-hoy', perfil?.id])
      if (previo) {
        // Se marca omitida y se renumera en el acto, igual que el servidor, para
        // que las que quedan arranquen en 1 sin esperar a la relectura.
        cliente.setQueryData(['jornada-hoy', perfil?.id], quitarEnCache(previo, paradaId))
      }
      return { previo }
    },
    onError: (e: Error, _id, ctx) => {
      if (ctx?.previo) cliente.setQueryData(['jornada-hoy', perfil?.id], ctx.previo)
      Alert.alert('No pudimos quitar el destino', e.message)
    },
    onSettled: () => cliente.invalidateQueries({ queryKey: ['jornada-hoy', perfil?.id] }),
  })

  const pedirQuitar = useCallback(
    (p: ParadaCompleta) => {
      const nombre = p.cliente?.razon_social ?? p.razon_social_snapshot ?? 'este destino'
      Alert.alert(
        'Quitar del recorrido',
        `¿Sacar a ${nombre} del recorrido de hoy? No lo vas a visitar y desaparece de la lista.`,
        [
          { text: 'Volver', style: 'cancel' },
          { text: 'Quitar', style: 'destructive', onPress: () => quitar.mutate(p.id) },
        ],
      )
    },
    [quitar],
  )

  // ── Volver a visitar una "no visitada" ─────────────────────────────────────
  // Una parada marcada "no visité" (cliente ausente / dirección errónea) queda
  // terminal. Esto la devuelve a 'pendiente' —borrando ese parte— para
  // registrar la visita de verdad, sin tener que re-agregar al cliente (que
  // dejaba un duplicado en el recorrido).
  const reactivar = useMutation({
    mutationFn: (paradaId: string) => reactivarParada(paradaId),
    onError: (e: Error) => Alert.alert('No pudimos reabrir el destino', e.message),
    onSuccess: (_d, paradaId) => {
      void cliente.invalidateQueries({ queryKey: ['jornada-hoy', perfil?.id] })
      // Ya está 'pendiente': se abre el parte para cargarla en el acto.
      yaPreguntado.current = paradaId
      navigation.navigate('DestinoVisitado', { paradaId })
    },
  })

  const pedirReactivar = useCallback(
    (p: ParadaCompleta) => {
      const nombre = p.cliente?.razon_social ?? p.razon_social_snapshot ?? 'este destino'
      Alert.alert(
        'Volver a visitar',
        `${nombre} figura como "No visitada". ¿La reabrís para registrar la visita?`,
        [
          { text: 'No', style: 'cancel' },
          { text: 'Volver a visitar', onPress: () => reactivar.mutate(p.id) },
        ],
      )
    },
    [reactivar],
  )

  // Llegó desde "INICIAR RECORRIDO": se pregunta cómo arrancar.
  useEffect(() => {
    if (debeIniciar && jornada && !enCurso && !finalizada && !arrancar.isPending) {
      setEligiendoModo(true)
      navigation.setParams({ iniciar: false })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debeIniciar, jornada?.id, enCurso, finalizada])

  // Cierra la ventana y arranca del modo elegido.
  const elegirModo = useCallback(
    (irAGoogleMaps: boolean) => {
      setEligiendoModo(false)
      arrancar.mutate({ irAGoogleMaps })
    },
    [arrancar],
  )

  /**
   * Cerrar la jornada.
   *
   * El seguimiento se corta en el `finally`, no después de la escritura. Antes
   * iba detrás de `finalizarRecorrido`, así que si la base no contestaba —y el
   * vendedor suele terminar el día adentro de un galpón, justo donde no hay
   * señal— el GPS quedaba prendido: la notificación seguía en la barra y la
   * oficina lo veía "en recorrido" mientras cenaba en su casa.
   *
   * Apagar el seguimiento aunque falle el cierre es lo correcto: el vendedor
   * tocó "finalizar", y esa es su decisión sobre su propia ubicación. El cierre
   * de la jornada se puede reintentar; una noche de rastreo no se deshace.
   */
  const cerrar = useMutation({
    mutationFn: async () => {
      if (!jornada) throw new Error('No hay una jornada abierta para cerrar.')
      try {
        await finalizarRecorrido(jornada.id)
      } finally {
        await detenerSeguimiento(perfil?.id).catch(() => undefined)
      }
    },
    onSuccess: () => {
      void cliente.invalidateQueries()
      Alert.alert('Recorrido finalizado', 'Se cerró la jornada de hoy.')
      navigation.navigate('Visitas')
    },
    onError: (e: Error) =>
      Alert.alert(
        'No pudimos cerrar la jornada',
        `${e.message}\n\nEl seguimiento de ubicación ya se apagó. Cuando tengas señal, volvé a tocar FINALIZAR RECORRIDO para que la oficina lo registre.`,
      ),
  })

  /**
   * Encuadra el mapa sobre todas las paradas.
   *
   * Se llama desde dos lados a propósito. El efecto cubre el caso de que
   * cambien las paradas con el mapa ya montado; `onMapReady` cubre el de que
   * las paradas ya estuvieran cuando el mapa recién aparece. Sin lo segundo,
   * `fitToCoordinates` se le pedía al lado nativo antes de que estuviera listo,
   * la llamada se perdía sin avisar y la cámara se quedaba en `initialRegion`:
   * centrada en el primer destino con 0,25° de lado. Con una jornada que cruza
   * el conurbano, eso deja a la mitad de los pines fuera de pantalla y parece
   * que el mapa no los dibujó.
   */
  const encuadrar = useCallback(() => {
    // Encuadra sobre las ubicadas: a las otras no hay dónde apuntar la cámara.
    if (paradasUbicadas.length === 0 || !mapa.current) return
    mapa.current.fitToCoordinates(
      paradasUbicadas.map((p) => ({ latitude: p.direccion.lat, longitude: p.direccion.lng })),
      { edgePadding: { top: 60, right: 60, bottom: 60, left: 60 }, animated: true },
    )
  }, [paradasUbicadas])

  useEffect(encuadrar, [encuadrar])

  return (
    <Pantalla>
      <Encabezado />

      {isLoading || error || !jornada ? (
        // Estados simples (sin lista que arrastrar): un panel con scroll normal.
        <Panel contentStyle={estilos.contenido}>
          <BarraPanel alVolver={() => navigation.goBack()} />

          {isLoading ? (
            <Cargando texto="Armando tu recorrido…" />
          ) : error ? (
            /* No es lo mismo "no hay recorrido" que "no pude preguntarlo". Con la
               misma rama para los dos, un vendedor sin señal veía desaparecer sus
               destinos y creía que la oficina se los había borrado. */
            <>
              <Vacio
                titulo="No pudimos traer tu recorrido"
                detalle="Revisá la señal. Tus destinos están guardados: esto es sólo que no pudimos consultarlos."
                icono="📡"
              />
              <BotonSecundario titulo="↻  Reintentar" alTocar={() => void refetch()} />
            </>
          ) : (
            <>
              <Vacio
                titulo="No hay recorrido para hoy"
                detalle="La oficina todavía no cargó tus destinos. Podés agregar uno a mano."
                icono="🗺️"
              />
              <BotonMenu
                titulo={'AGREGAR\nNUEVO DESTINO'}
                alTocar={() => navigation.navigate('AgregarDestino', { volverA: 'Recorrido' })}
              />
            </>
          )}
        </Panel>
      ) : (
        // Jornada cargada: la lista de destinos es arrastrable EN EL LUGAR. El
        // mapa, los avisos y el próximo destino van de cabecera; los botones, de
        // pie. El Panel no scrollea (`desplazable={false}`): el que scrollea es la
        // DraggableFlatList, que necesita ser el único scroll para que el arrastre
        // y el auto-scroll anden bien.
        <Panel desplazable={false} contentStyle={estilos.marcoLista}>
          <BarraPanel alVolver={() => navigation.goBack()} />
          {/* La lista va en un View con altura acotada (flex:1): sin eso, la
              FlatList no sabe cuánto mide y no dibuja ni scrollea. */}
          <View style={estilos.marcoLista}>
          <DraggableFlatList
            data={paradas}
            keyExtractor={(p) => p.id}
            onDragEnd={reordenarPorArrastre}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={estilos.listaContenido}
            ItemSeparatorComponent={Separador}
            ListHeaderComponent={
              <View style={estilos.cabecera}>
                <TituloPanel>{'ESTE ES TU RECORRIDO\nDEL DÍA DE HOY'}</TituloPanel>

                {avisoJornada ? <Aviso tono="atencion">{avisoJornada}</Aviso> : null}
                {avisoMaps ? <Aviso tono="info">{avisoMaps}</Aviso> : null}

            {/*
              Sin paradas no se monta el mapa. Antes se montaba igual y caía al
              centro de Buenos Aires, sin un pin y sin un cartel: para el
              vendedor era indistinguible de un mapa roto.

              Y hay un segundo caso, que es nuevo: SÍ hay destinos, pero ninguno
              está ubicado todavía. El mapa tampoco se monta —no hay región
              inicial ni pines— pero la lista de abajo sí se dibuja entera, así
              que el cartel tiene que decir exactamente eso: que los destinos
              están, que no se perdió nada, y que la ubicación se guarda al
              llegar. Si dijera "no hay destinos" estaría mintiendo.
            */}
            {paradas.length === 0 ? (
              <Vacio
                titulo="Todavía no hay destinos"
                detalle="La oficina no te cargó ninguno para hoy. Podés agregar los que quieras a mano."
                icono="📍"
              />
            ) : paradasUbicadas.length === 0 ? (
              <Vacio
                titulo="Todavía no hay nada que dibujar en el mapa"
                detalle="Tus destinos están en la lista de acá abajo, con el domicilio de cada uno, pero ninguno tiene la ubicación guardada. Andá igual: cuando llegues, tocá LLEGUÉ y ahí guardás dónde queda."
                icono="📍"
              />
            ) : (
            <View style={estilos.marcoMapa}>
              <MapView
                ref={mapa}
                provider={PROVIDER_GOOGLE}
                style={estilos.mapa}
                showsUserLocation
                showsMyLocationButton
                toolbarEnabled={false}
                onMapReady={encuadrar}
                initialRegion={{
                  latitude: paradasUbicadas[0].direccion.lat,
                  longitude: paradasUbicadas[0].direccion.lng,
                  latitudeDelta: 0.25,
                  longitudeDelta: 0.25,
                }}
              >
                {trazado.length > 0 ? (
                  <Polyline coordinates={trazado} strokeWidth={5} strokeColor={colores.azul} />
                ) : null}

                {/* Un pin por cada parada UBICADA. Las que no lo están no se
                    dibujan —no hay coordenada que dibujar— y se las ve en la
                    lista, con su pastilla SIN UBICAR. El número del pin sigue
                    siendo el `orden` real, así que el mapa puede saltar del 3 al
                    5: el 4 existe, está en la lista, y todavía no tiene lugar
                    acá arriba. */}
                {paradasUbicadas.map((p) => (
                  <Marker
                    key={p.id}
                    coordinate={{ latitude: p.direccion.lat, longitude: p.direccion.lng }}
                    title={`${p.orden}. ${p.cliente?.razon_social ?? p.razon_social_snapshot ?? 'Destino'}`}
                    description={p.direccion.direccion_formateada}
                    pinColor={colorDeEstado(p.estado, colores)}
                  />
                ))}
              </MapView>
            </View>
            )}

            {jornada.distancia_total_m ? (
              <Text style={estilos.resumenRuta}>
                {formatearDistancia(jornada.distancia_total_m)} ·{' '}
                {formatearDuracion(jornada.duracion_total_seg)} · {paradas.length} destinos
              </Text>
            ) : null}

            {/* Navegación tramo a tramo: Google Maps no acepta 13 paradas en un
                solo enlace, y así la ruta se recalcula con el tránsito real. */}
            {enCurso && proxima ? (
              <View style={estilos.proxima}>
                <Text style={estilos.proximaEtiqueta}>PRÓXIMO DESTINO</Text>
                <Text style={estilos.proximaCliente}>
                  {proxima.orden}. {proxima.cliente?.razon_social ?? proxima.razon_social_snapshot}
                </Text>
                <Text style={estilos.proximaDireccion}>
                  {domicilioDeLaProxima ?? 'Sin domicilio cargado'}
                </Text>
                {contactoDe(proxima) ? (
                  <Text style={estilos.proximaContacto}>👤 {contactoDe(proxima)}</Text>
                ) : null}

                {/* La misma pastilla que en la lista, a propósito: el vendedor
                    aprende un solo símbolo y lo reconoce donde le aparezca. */}
                {!proxima.direccion ? (
                  <View style={estilos.proximaPastillas}>
                    <Pastilla texto="SIN UBICAR" color={colores.rojoAccion} />
                  </View>
                ) : null}

                <View style={estilos.proximaBotones}>
                  {/*
                    Dos botones distintos porque son dos cosas distintas, y
                    llamarlas igual sería mentirle al que maneja.

                    Con coordenadas se NAVEGA: Google arranca la guía por voz
                    hacia un punto que alguien confirmó. Sin coordenadas lo único
                    que hay es el domicilio escrito que vino del sistema de
                    gestión, y eso es una conjetura, no un dato: puede haber dos
                    calles con ese nombre, puede faltarle la altura, puede estar
                    escrito de una forma que Google entienda como otro lado. Por
                    eso se BUSCA —Maps muestra los resultados y el vendedor elige
                    cuál es— en vez de arrancar a navegar solo hacia el primero
                    que aparezca sin decir que eligió.

                    El botón no se esconde: el vendedor sabe dónde queda el
                    cliente, y la idea es ayudarlo a llegar, no hacerle de puerta.
                    Sólo desaparece si no hay NI punto NI domicilio escrito, que
                    ahí sí no hay nada que abrir.
                  */}
                  {puntoDeLaProxima ? (
                    <BotonSecundario
                      titulo="🧭 Navegar"
                      alTocar={() => {
                        navegarHacia(puntoDeLaProxima).catch((e: Error) =>
                          Alert.alert('Google Maps', e.message),
                        )
                      }}
                      style={estilos.mitad}
                    />
                  ) : domicilioDeLaProxima ? (
                    <BotonSecundario
                      titulo="🔎 Buscar en Maps"
                      alTocar={() => {
                        buscarEnMapsPorTexto(domicilioDeLaProxima).catch((e: Error) =>
                          Alert.alert('Google Maps', e.message),
                        )
                      }}
                      style={estilos.mitad}
                    />
                  ) : null}
                  <BotonPrincipal
                    titulo="LLEGUÉ"
                    alTocar={() => {
                      // Ya fue a cargarla: al volver al recorrido no se le
                      // pregunta "¿Cargamos la visita?" por la misma parada.
                      yaPreguntado.current = proxima.id
                      navigation.navigate('DestinoVisitado', { paradaId: proxima.id })
                    }}
                    style={estilos.mitad}
                  />
                </View>
              </View>
            ) : null}

            {enCurso ? (
              <BotonSecundario
                titulo="🗺️  Ver recorrido en Google Maps"
                alTocar={() => abrirMaps.mutate()}
                cargando={abrirMaps.isPending}
              />
            ) : null}

                {paradas.length > 0 ? (
                  <Text style={estilos.subtitulo}>DESTINOS DEL DÍA</Text>
                ) : null}
                {!finalizada && abiertas.length >= 1 ? (
                  <Text style={estilos.hintReordenar}>
                    Mantené apretado un destino y arrastralo para moverlo. Tocalo para cargar la
                    visita.
                  </Text>
                ) : null}
              </View>
            }
            renderItem={({ item: p, drag, isActive }: RenderItemParams<ParadaCompleta>) => {
              const abierta = p.estado === 'pendiente' || p.estado === 'en_camino'
              return (
                <ScaleDecorator>
                  <FilaParada
                    parada={p}
                    drag={drag}
                    isActive={isActive}
                    arrastrable={!finalizada && abierta}
                    alTocar={
                      // Pendiente / en camino: cargar la visita. VISITADA: reabrir
                      // el parte para corregirlo. No visitada / omitida: no por acá.
                      ['pendiente', 'en_camino', 'visitada'].includes(p.estado)
                        ? () => {
                            yaPreguntado.current = p.id
                            navigation.navigate('DestinoVisitado', { paradaId: p.id })
                          }
                        : undefined
                    }
                    alViajar={!finalizada && abierta ? () => viajarA(p) : undefined}
                    alEliminar={!finalizada && abierta ? () => pedirQuitar(p) : undefined}
                    alReactivar={
                      !finalizada && p.estado === 'no_visitada' ? () => pedirReactivar(p) : undefined
                    }
                    alEditar={
                      p.cliente?.provisorio
                        ? () => navigation.navigate('EditarProspecto', { clienteId: p.cliente!.id })
                        : undefined
                    }
                  />
                </ScaleDecorator>
              )
            }}

            ListFooterComponent={
              <View style={estilos.pie}>
                {/* "Ordenar por cercanía" se ofrece ANTES de arrancar, no en curso:
                    ya iniciado, reordenar reasignaría en silencio el destino que se
                    está manejando. */}
                {!enCurso && !finalizada && abiertas.length >= 2 ? (
                  <BotonSecundario
                    titulo="🧭  Ordenar por cercanía"
                    alTocar={() => ordenar.mutate()}
                    cargando={ordenar.isPending}
                    deshabilitado={arrancar.isPending}
                  />
                ) : null}

                <BotonMenu
                  titulo={'AGREGAR\nNUEVO DESTINO'}
                  alTocar={() => navigation.navigate('AgregarDestino', { volverA: 'Recorrido' })}
                />

                {!enCurso && !finalizada ? (
                  <BotonPrincipal
                    titulo="INICIAR RECORRIDO"
                    alTocar={() => setEligiendoModo(true)}
                    cargando={arrancar.isPending}
                    deshabilitado={ordenar.isPending}
                  />
                ) : null}

                {enCurso ? (
                  <BotonMenu
                    titulo="FINALIZAR RECORRIDO"
                    subtitulo="Se corta el seguimiento de ubicación"
                    alTocar={() =>
                      Alert.alert(
                        'Finalizar recorrido',
                        paradas.some((p) => p.estado === 'pendiente' || p.estado === 'en_camino')
                          ? 'Todavía te quedan destinos sin visitar. Se van a marcar como "sin visitar". ¿Cerramos igual?'
                          : '¿Cerramos la jornada de hoy?',
                        [
                          { text: 'Volver', style: 'cancel' },
                          { text: 'Finalizar', style: 'destructive', onPress: () => cerrar.mutate() },
                        ],
                      )
                    }
                    cargando={cerrar.isPending}
                  />
                ) : null}

                <BotonSecundario titulo="Actualizar" alTocar={() => void refetch()} />
              </View>
            }
          />
          </View>
        </Panel>
      )}

      <ModalInicioRecorrido
        visible={eligiendoModo}
        alElegir={elegirModo}
        alCerrar={() => setEligiendoModo(false)}
      />
    </Pantalla>
  )
}

/**
 * "¿CÓMO QUERÉS HACER EL RECORRIDO?"
 *
 * La ventana que sale al tocar INICIAR RECORRIDO. Es un modal propio y no un
 * `Alert.alert`: los dos caminos necesitan un renglón de explicación abajo del
 * título, y un Alert no lo da. Los dos arrancan la jornada y el seguimiento por
 * igual —de eso vive la oficina—; lo único que cambia es con qué se navega.
 */
function ModalInicioRecorrido({
  visible,
  alElegir,
  alCerrar,
}: {
  visible: boolean
  alElegir: (irAGoogleMaps: boolean) => void
  alCerrar: () => void
}) {
  const estilos = usarEstilos()

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={alCerrar}>
      <Pressable style={estilos.velo} onPress={alCerrar} accessibilityLabel="Cerrar">
        <Pressable style={estilos.hoja} onPress={() => undefined}>
          <Text style={estilos.hojaTitulo}>¿CÓMO QUERÉS HACER EL RECORRIDO?</Text>
          <Text style={estilos.hojaNota}>
            En los dos casos arranca la jornada y la oficina ve tu ubicación mientras dure.
          </Text>

          <Pressable
            onPress={() => alElegir(true)}
            accessibilityRole="button"
            accessibilityLabel="Ir a Google Maps"
            style={({ pressed }) => [estilos.accion, pressed && estilos.accionTocada]}
          >
            <Text style={estilos.accionTexto}>IR A GOOGLE MAPS</Text>
            <Text style={estilos.accionDetalle}>Abre el recorrido completo para manejar</Text>
          </Pressable>

          <Pressable
            onPress={() => alElegir(false)}
            accessibilityRole="button"
            accessibilityLabel="Seguir mi propio recorrido"
            style={({ pressed }) => [estilos.accion, pressed && estilos.accionTocada]}
          >
            <Text style={estilos.accionTexto}>SEGUIR MI PROPIO RECORRIDO</Text>
            <Text style={estilos.accionDetalle}>Te guío destino por destino desde la app</Text>
          </Pressable>

          <Pressable
            onPress={alCerrar}
            accessibilityRole="button"
            style={({ pressed }) => [estilos.cancelar, pressed && estilos.accionTocada]}
          >
            <Text style={estilos.cancelarTexto}>VOLVER</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

/**
 * Aplica un reordenamiento de las abiertas sobre la jornada cacheada, para que la
 * lista se mueva en el acto (update optimista) antes de que conteste la base.
 *
 * Replica lo que hace `reordenar_paradas` del lado del servidor: las resueltas no
 * se tocan, las abiertas toman piso+1..piso+N según `nuevoOrden`, y se ordena
 * todo por `orden` como viene del servicio. El "piso" es el último orden ya usado
 * por una resuelta, no cuántas hay.
 */
function reordenarEnCache(jc: JornadaCompleta, nuevoOrden: string[]): JornadaCompleta {
  const piso = jc.paradas
    .filter((p) => p.estado !== 'pendiente' && p.estado !== 'en_camino')
    .reduce((max, p) => Math.max(max, p.orden), 0)
  const ordenPorId = new Map(nuevoOrden.map((id, i) => [id, piso + i + 1]))
  const paradas = jc.paradas
    .map((p) => {
      const nuevo = ordenPorId.get(p.id)
      return nuevo === undefined ? p : { ...p, orden: nuevo }
    })
    .sort((a, b) => a.orden - b.orden)
  return { ...jc, paradas }
}

/**
 * Marca una parada omitida en la jornada cacheada y renumera las que quedan,
 * replicando `quitar_parada_del_recorrido` del servidor para que el update
 * optimista coincida con lo que va a devolver la base.
 *
 * El piso son las RESUELTAS (las omitidas no cuentan); las abiertas toman
 * piso+1.. en su orden, y las omitidas se aparcan por encima. Distinto de
 * `reordenarEnCache`, cuyo piso incluye a las omitidas —justo lo que acá hay que
 * evitar para que la lista no arranque en 2—.
 */
function quitarEnCache(jc: JornadaCompleta, paradaId: string): JornadaCompleta {
  const conOmitida = jc.paradas.map((p) =>
    p.id === paradaId ? { ...p, estado: 'omitida' as EstadoParada } : p,
  )
  const piso = conOmitida
    .filter((p) => p.estado === 'visitada' || p.estado === 'no_visitada')
    .reduce((max, p) => Math.max(max, p.orden), 0)

  const esAbierta = (e: EstadoParada) => e === 'pendiente' || e === 'en_camino'
  const aRenumerar = conOmitida
    .filter((p) => esAbierta(p.estado) || p.estado === 'omitida')
    .sort((a, b) => {
      // Abiertas primero (toman los números bajos), después las omitidas.
      if (esAbierta(a.estado) !== esAbierta(b.estado)) return esAbierta(a.estado) ? -1 : 1
      return a.orden - b.orden
    })
  const ordenPorId = new Map(aRenumerar.map((p, i) => [p.id, piso + i + 1]))

  const paradas = conOmitida
    .map((p) => {
      const nuevo = ordenPorId.get(p.id)
      return nuevo === undefined ? p : { ...p, orden: nuevo }
    })
    .sort((a, b) => a.orden - b.orden)
  return { ...jc, paradas }
}

function FilaParada({
  parada,
  alTocar,
  alViajar,
  alEliminar,
  alReactivar,
  alEditar,
  drag,
  arrastrable,
  isActive,
}: {
  parada: ParadaCompleta
  alTocar?: () => void
  /** Abre Google Maps navegando a ESTE destino. Sólo en destinos abiertos. */
  alViajar?: () => void
  /** Saca el destino del recorrido (lo marca 'omitida'). Sólo en abiertos. */
  alEliminar?: () => void
  /** Reabre una parada "no visitada" para volver a visitarla. */
  alReactivar?: () => void
  /** Editar los datos de un prospecto (cliente provisorio sin código aún). */
  alEditar?: () => void
  /** De react-native-draggable-flatlist: arranca el arrastre al mantener apretado. */
  drag?: () => void
  /** Si esta fila se puede arrastrar (destino abierto y jornada no cerrada). */
  arrastrable?: boolean
  /** Si esta fila es la que se está arrastrando ahora (la "levanta"). */
  isActive?: boolean
}) {
  const { colores } = usarTema()
  const estilos = usarEstilos()
  // Sólo la VISITADA lleva el tilde verde de "hecho". La "no visitada" NO: antes
  // mostraba el mismo ✓ verde que una visita cerrada —al lado de una pastilla
  // roja "No visitada"— y parecía resuelta cuando en realidad hay que volver.
  const visitada = parada.estado === 'visitada'
  // Una parada sin ubicar es una parada normal a la que le falta un dato, no
  // una parada rota: misma fila, mismo número, mismo toque para cargar la
  // visita. Lo único que cambia es una pastilla más y de dónde sale el
  // domicilio. Por eso NO se le baja la opacidad ni se la deshabilita: hacerlo
  // le diría al vendedor "esto no cuenta", justo lo contrario de lo que pasa.
  const sinUbicar = parada.direccion === null

  return (
    <Pressable
      onPress={alTocar}
      // Mantener apretado una fila abierta la levanta para arrastrarla y
      // reordenar el recorrido. Un toque común sigue cargando la visita.
      onLongPress={arrastrable ? drag : undefined}
      delayLongPress={160}
      style={({ pressed }) => [
        estilos.fila,
        pressed && alTocar && estilos.filaPresionada,
        isActive && estilos.filaArrastrando,
      ]}
      accessibilityRole={alTocar ? 'button' : 'text'}
      accessibilityLabel={`Destino ${parada.orden}, ${parada.cliente?.razon_social ?? 'sin cliente'}, ${ETIQUETA_ESTADO_PARADA[parada.estado]}${sinUbicar ? ', sin ubicar' : ''}${arrastrable ? '. Mantené apretado para moverlo.' : ''}`}
    >
      <View style={[estilos.numero, { backgroundColor: colorDeEstado(parada.estado, colores) }]}>
        <Text style={estilos.numeroTexto}>{parada.orden}</Text>
      </View>

      <View style={estilos.filaTextos}>
        <Text style={estilos.filaCliente} numberOfLines={1}>
          {parada.cliente?.razon_social ?? parada.razon_social_snapshot ?? 'Destino sin cliente'}
        </Text>

        {/* Código de cliente + localidad: los dos datos con los que el vendedor
            reconoce y ubica al cliente de un vistazo, destacados juntos. */}
        {codigoDe(parada) || localidadDe(parada) ? (
          <View style={estilos.filaMeta}>
            {codigoDe(parada) ? (
              <Text style={estilos.filaCodigo}>Cód. {codigoDe(parada)}</Text>
            ) : null}
            {localidadDe(parada) ? (
              <Text style={estilos.filaLocalidad} numberOfLines={1}>
                📍 {localidadDe(parada)}
              </Text>
            ) : null}
          </View>
        ) : null}

        {/* El domicilio va de apoyo —gris, una sola línea, sin el código
            postal—: el dato principal es el nombre, el código y la localidad de
            arriba. */}
        {domicilioDe(parada) ? (
          <Text style={estilos.filaDireccion} numberOfLines={1}>
            {sinCodigoPostal(domicilioDe(parada)!)}
          </Text>
        ) : null}

        {contactoDe(parada) ? (
          <Text style={estilos.filaContacto} numberOfLines={1}>
            👤 {contactoDe(parada)}
          </Text>
        ) : null}

        {/* Sólo las pastillas que cambian lo que el vendedor va a hacer al
            llegar. El estado (pendiente / visitada / no visitada) ya se lee en
            el color del número y en el ✓/✗ de la derecha, así que su pastilla
            —y la de "AGREGADO"— salen, para una tarjeta más limpia. */}
        {sinUbicar || parada.prioridad !== 'baja' ? (
          <View style={estilos.filaPastillas}>
            {sinUbicar ? <Pastilla texto="SIN UBICAR" color={colores.rojoAccion} /> : null}
            {parada.prioridad !== 'baja' ? (
              <Pastilla
                texto={ETIQUETA_PRIORIDAD[parada.prioridad]}
                color={
                  parada.prioridad === 'alta' ? colores.prioridadAlta : colores.prioridadMedia
                }
              />
            ) : null}
          </View>
        ) : null}
      </View>

      {/* Acciones a la derecha. El prospecto (cliente provisorio) suma un lápiz
          para corregir sus datos mientras la oficina no le puso el código. */}
      <View style={estilos.filaAcciones}>
        {alEditar ? (
          <Pressable
            onPress={alEditar}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Editar los datos de ${parada.cliente?.razon_social ?? 'el prospecto'}`}
            style={({ pressed }) => [estilos.asaChica, pressed && estilos.asaTocada]}
          >
            <Text style={estilos.asaIconoChico}>✏️</Text>
          </Pressable>
        ) : null}

        {visitada ? (
          <Text style={estilos.tildeFila}>✓</Text>
        ) : alReactivar ? (
          // "No visitada": cruz roja de "no se pudo". Tocarla reabre la parada
          // para volver a visitarla. Es su propio Pressable para no disparar el
          // toque de la fila.
          <Pressable
            onPress={alReactivar}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`No visitada. Tocá para volver a visitar el destino ${parada.orden}`}
            style={({ pressed }) => [estilos.cruzToque, pressed && estilos.asaTocada]}
          >
            <Text style={estilos.cruzNoVisitada}>✗</Text>
          </Pressable>
        ) : alViajar || alEliminar ? (
          // Destino abierto: dos cajas directas —Viajar (ir a ESE cliente) y
          // Eliminar—, cada una su propio Pressable para no disparar el toque de
          // la fila (que carga la visita) ni el arrastre. Reordenar es arrastrando
          // la fila, no un botón.
          <View style={estilos.botonesFila}>
            {alViajar ? (
              <Pressable
                onPress={alViajar}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel={`Viajar a ${parada.cliente?.razon_social ?? 'este destino'}`}
                style={({ pressed }) => [estilos.botonFila, pressed && estilos.asaTocada]}
              >
                <Text style={estilos.botonFilaIcono}>🗺</Text>
              </Pressable>
            ) : null}
            {alEliminar ? (
              <Pressable
                onPress={alEliminar}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel={`Quitar ${parada.cliente?.razon_social ?? 'este destino'} del recorrido`}
                style={({ pressed }) => [
                  estilos.botonFila,
                  estilos.botonFilaBorrar,
                  pressed && estilos.asaTocada,
                ]}
              >
                <Text style={estilos.botonFilaIcono}>🗑</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>
    </Pressable>
  )
}

/**
 * El domicilio que hay para mostrar de un destino, esté ubicado o no.
 *
 * Con dirección confirmada se muestra la formateada por Google, que es la que
 * coincide con el pin del mapa. Sin ella queda `direccion_snapshot`: el
 * domicilio escrito tal cual vino del sistema de gestión ("URQUIZA OESTE
 * PARADA16, GUALEGUAYCHÚ"). No es un punto y no siempre es prolijo, pero es
 * exactamente el dato con el que el vendedor viene ubicando clientes desde
 * antes de que existiera esta app, así que mostrarlo vale muchísimo más que
 * dejar el renglón vacío.
 *
 * Devuelve `null` sólo cuando no hay ninguna de las dos cosas —un cliente que
 * ni siquiera trae el domicilio de texto, 150 de los 6.536 sin ubicar—, y ahí
 * el que llama decide qué escribir en su lugar.
 */
function domicilioDe(parada: ParadaCompleta): string | null {
  return parada.direccion?.direccion_formateada ?? parada.direccion_snapshot ?? null
}

/** El nombre del contacto del cliente ("con quién hablar"), si está cargado. */
function contactoDe(parada: ParadaCompleta): string | null {
  const c = parada.cliente?.contacto_nombre?.trim()
  return c ? c : null
}

/** El código de cliente del Gestión, si el destino es un cliente del padrón. */
function codigoDe(parada: ParadaCompleta): string | null {
  const c = parada.cliente?.codigo?.trim()
  return c ? c : null
}

/**
 * La localidad del cliente, para mostrarla destacada en la tarjeta.
 *
 * Sale de la dirección ubicada si la hay —la que coincide con el pin del mapa—
 * y, si el cliente todavía no está ubicado, del padrón del Gestión, que trae la
 * localidad en texto en la ficha del cliente. Así la localidad aparece también
 * en los miles de clientes sin ubicar.
 */
function localidadDe(parada: ParadaCompleta): string | null {
  const l = (parada.direccion?.localidad ?? parada.cliente?.localidad)?.trim()
  return l ? l : null
}

/**
 * El domicilio sin el código postal.
 *
 * Google devuelve la dirección con el CPA pegado antes de la localidad
 * ("Av. Mitre 4470, B1882 Ezpeleta, …"); en la tarjeta el CP no aporta —el
 * vendedor ubica por calle y localidad— y come lugar. Se saca SÓLO el CPA, que
 * siempre arranca con la letra de la provincia ("B1882", "B1882ABC"). Exigir esa
 * letra es a propósito: el domicilio de texto del Gestión (lo que se muestra en
 * los clientes sin ubicar) puede traer un número de barrio o de altura después
 * de una coma ("…, 1500 Viviendas"), que NO es un código postal y no hay que
 * tocar.
 */
function sinCodigoPostal(domicilio: string): string {
  return domicilio.replace(/,\s*[A-Z]\d{4}[A-Z]{0,3}\s+/g, ', ')
}

/**
 * A qué punto se lo manda: al que él propuso, al oficial, o a ninguno.
 *
 * Se piden las dos coordenadas propuestas juntas. Tomarlas por separado con
 * `??` —como estaba— dejaba pasar una propuesta a medio geocodificar y mezclaba
 * la latitud nueva con la longitud vieja: un punto que no es ni el de antes ni
 * el de ahora, en el medio del campo, y el vendedor manejando hacia ahí.
 *
 * `null` significa que este destino no tiene ubicación de ningún lado, y el que
 * llama tiene que ofrecer otra cosa (buscar el domicilio escrito en Maps), no
 * navegar igual con un punto inventado.
 */
function puntoDeNavegacion(
  parada: ParadaCompleta,
  cambio: CambioPendiente | undefined,
): { lat: number; lng: number } | null {
  if (cambio && cambio.lat_propuesta !== null && cambio.lng_propuesta !== null) {
    return { lat: cambio.lat_propuesta, lng: cambio.lng_propuesta }
  }
  if (parada.direccion) {
    return { lat: parada.direccion.lat, lng: parada.direccion.lng }
  }
  return null
}

/**
 * El color va como parametro y no se pide adentro.
 *
 * Esto no es un componente: es una cuenta. Pedirle el tema aca adentro seria
 * llamar a un gancho de React desde una funcion que se invoca en medio de un
 * `map`, y ahi React deja de poder contar cuantos ganchos tiene el dibujado.
 * Se lo pasa el que dibuja, que si es un componente.
 */
function colorDeEstado(estado: EstadoParada, colores: Paleta): string {
  switch (estado) {
    case 'visitada':
      return colores.estadoVisitada
    case 'no_visitada':
      return colores.estadoNoVisitada
    case 'en_camino':
      return colores.estadoEnCamino
    case 'omitida':
      return colores.estadoOmitida
    default:
      return colores.estadoPendiente
  }
}

/** Separación vertical entre destinos de la lista del recorrido. */
function Separador() {
  const estilos = usarEstilos()
  return <View style={estilos.separador} />
}

const usarEstilos = hojaDeTema((t) => ({
  contenido: { gap: espaciado.md },

  // Lista del recorrido arrastrable EN EL LUGAR (#4): el Panel no scrollea, la
  // que scrollea es la DraggableFlatList. La cabecera (mapa, avisos, próximo) y el
  // pie (botones) llevan su propia separación; entre destinos va `separador`.
  marcoLista: { flex: 1 },
  listaContenido: {
    paddingHorizontal: espaciado.base,
    paddingTop: espaciado.md,
    paddingBottom: espaciado.xl,
  },
  cabecera: { gap: espaciado.md, marginBottom: espaciado.md },
  pie: { gap: espaciado.md, marginTop: espaciado.md },
  separador: { height: espaciado.md },

  // La fila que se está arrastrando se "levanta": borde marcado, fondo claro y
  // sombra, para que se vea cuál se está moviendo.
  filaArrastrando: {
    borderColor: t.colores.tinta,
    backgroundColor: t.colores.campoBlanco,
    elevation: 6,
  },
  // Las dos cajas directas de un destino abierto: Viajar y Eliminar.
  botonesFila: { flexDirection: 'row', gap: espaciado.xs, alignItems: 'center' },
  botonFila: {
    width: 44,
    height: 44,
    borderRadius: radios.sm,
    borderWidth: 2,
    borderColor: t.colores.borde,
    backgroundColor: t.colores.campoBlanco,
    alignItems: 'center',
    justifyContent: 'center',
  },
  botonFilaBorrar: { borderColor: t.colores.rojoAccion },
  botonFilaIcono: { fontSize: t.tipografia.tamano.base },

  marcoMapa: {
    height: 300,
    borderWidth: 2.5,
    borderColor: t.colores.borde,
    borderRadius: radios.sm,
    overflow: 'hidden',
  },
  mapa: { flex: 1 },

  resumenRuta: {
    fontFamily: t.tipografia.familia.cuerpo,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.tintaSuave,
    textAlign: 'center',
  },

  proxima: {
    backgroundColor: t.colores.campoBlanco,
    borderWidth: 2.5,
    borderColor: t.colores.borde,
    borderRadius: radios.sm,
    padding: espaciado.md,
    gap: espaciado.xs,
  },
  proximaEtiqueta: {
    fontFamily: t.tipografia.familia.subtitulo,
    fontSize: t.tipografia.tamano.micro,
    color: t.colores.rojo,
    letterSpacing: 1,
  },
  proximaCliente: {
    fontFamily: t.tipografia.familia.subtitulo,
    fontSize: t.tipografia.tamano.lg,
    color: t.colores.tinta,
  },
  proximaDireccion: {
    fontFamily: t.tipografia.familia.cuerpo,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.tintaSuave,
  },
  proximaContacto: {
    fontFamily: t.tipografia.familia.cuerpo,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.tinta,
  },
  proximaPastillas: {
    flexDirection: 'row',
    gap: espaciado.xs,
    flexWrap: 'wrap',
    marginTop: 2,
  },
  proximaBotones: {
    flexDirection: 'row',
    gap: espaciado.sm,
    marginTop: espaciado.sm,
  },
  mitad: { flex: 1, minWidth: 0 },

  subtitulo: {
    fontFamily: t.tipografia.familia.subtitulo,
    fontSize: t.tipografia.tamano.sm,
    color: t.colores.tintaSuave,
    letterSpacing: 1,
    marginTop: espaciado.sm,
  },
  hintReordenar: {
    fontFamily: t.tipografia.familia.liviana,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.tintaSuave,
    marginTop: -espaciado.xs,
  },

  fila: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaciado.sm,
    backgroundColor: t.colores.panelClaro,
    borderWidth: 1.5,
    borderColor: t.colores.borde,
    borderRadius: radios.sm,
    padding: espaciado.sm,
    // Más baja que antes (76) para que entren más destinos por pantalla y haya
    // menos scroll; con tres renglones de texto sigue entrando cómoda.
    minHeight: 60,
  },
  filaPresionada: { opacity: 0.7 },
  numero: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: t.colores.borde,
  },
  numeroTexto: {
    fontFamily: t.tipografia.familia.titulo,
    fontSize: t.tipografia.tamano.sm,
    color: t.colores.blanco,
  },
  filaTextos: { flex: 1, gap: 1 },
  filaCliente: {
    fontFamily: t.tipografia.familia.fuerte,
    fontSize: t.tipografia.tamano.base,
    color: t.colores.tinta,
  },
  // Renglón destacado con el código y la localidad, los dos datos que el
  // vendedor usa para reconocer y ubicar al cliente de un vistazo.
  filaMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaciado.sm,
    flexWrap: 'wrap',
  },
  filaCodigo: {
    fontFamily: t.tipografia.familia.subtitulo,
    fontSize: t.tipografia.tamano.sm,
    color: t.colores.rojo,
    letterSpacing: 0.3,
  },
  filaLocalidad: {
    fontFamily: t.tipografia.familia.subtitulo,
    fontSize: t.tipografia.tamano.sm,
    color: t.colores.tinta,
    flexShrink: 1,
  },
  filaDireccion: {
    fontFamily: t.tipografia.familia.liviana,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.tintaSuave,
  },
  filaContacto: {
    fontFamily: t.tipografia.familia.cuerpo,
    fontSize: t.tipografia.tamano.sm,
    color: t.colores.tinta,
  },
  filaPastillas: {
    flexDirection: 'row',
    gap: espaciado.xs,
    flexWrap: 'wrap',
    marginTop: 2,
  },
  tildeFila: {
    fontFamily: t.tipografia.familia.titulo,
    fontSize: 22,
    color: t.colores.verdeOscuro,
  },
  // La cruz roja de "no visitada": tocar reabre la parada. Mismo lugar que el ✓
  // de la visitada, con un área de toque cómoda.
  cruzToque: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 44,
    minHeight: 44,
  },
  cruzNoVisitada: {
    fontFamily: t.tipografia.familia.titulo,
    fontSize: 24,
    color: t.colores.rojoAccion,
  },
  asa: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 46,
    minHeight: 46,
    paddingHorizontal: espaciado.xs,
    borderRadius: radios.sm,
    borderWidth: 1.5,
    borderColor: t.colores.borde,
    backgroundColor: t.colores.campoBlanco,
  },
  asaTocada: { opacity: 0.6 },
  asaIcono: {
    fontFamily: t.tipografia.familia.titulo,
    fontSize: 18,
    color: t.colores.tinta,
  },
  asaTexto: {
    fontFamily: t.tipografia.familia.liviana,
    fontSize: t.tipografia.tamano.micro,
    color: t.colores.tintaSuave,
  },
  // Columna de acciones de la derecha: el lápiz del prospecto arriba y el
  // indicador (✓ / ✗ / ⋯) debajo.
  filaAcciones: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: espaciado.xs,
  },
  // Asa compacta sólo-ícono, para el lápiz de editar el prospecto.
  asaChica: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 40,
    minHeight: 40,
    borderRadius: radios.sm,
    borderWidth: 1.5,
    borderColor: t.colores.borde,
    backgroundColor: t.colores.campoBlanco,
  },
  asaIconoChico: { fontSize: 18 },

  // ── Ventana "¿cómo querés hacer el recorrido?" ─────────────────────────────
  velo: {
    flex: 1,
    backgroundColor: t.colores.velo,
    justifyContent: 'flex-end',
  },
  hoja: {
    backgroundColor: t.colores.panel,
    borderTopWidth: 2.5,
    borderTopColor: t.colores.borde,
    borderTopLeftRadius: radios.lg,
    borderTopRightRadius: radios.lg,
    padding: espaciado.base,
    gap: espaciado.sm,
  },
  hojaTitulo: {
    fontFamily: t.tipografia.familia.subtitulo,
    fontSize: t.tipografia.tamano.base,
    color: t.colores.tinta,
    letterSpacing: 0.6,
  },
  hojaNota: {
    fontFamily: t.tipografia.familia.liviana,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.tintaSuave,
  },
  accion: {
    minHeight: TOQUE_MINIMO,
    justifyContent: 'center',
    paddingVertical: espaciado.sm,
    paddingHorizontal: espaciado.md,
    borderRadius: radios.sm,
    borderWidth: 2,
    borderColor: t.colores.borde,
    backgroundColor: t.colores.campoBlanco,
    gap: 2,
  },
  accionTocada: { opacity: 0.7 },
  accionApagada: { opacity: 0.4 },
  accionDestructiva: {
    borderColor: t.colores.rojoAccion,
    backgroundColor: t.colores.panelClaro,
  },
  accionTexto: {
    fontFamily: t.tipografia.familia.fuerte,
    fontSize: t.tipografia.tamano.sm,
    color: t.colores.tinta,
    letterSpacing: 0.5,
  },
  accionTextoDestructivo: { color: t.colores.rojoAccion },
  accionDetalle: {
    fontFamily: t.tipografia.familia.liviana,
    fontSize: t.tipografia.tamano.micro,
    color: t.colores.tintaSuave,
  },
  cancelar: {
    minHeight: TOQUE_MINIMO,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: espaciado.xs,
  },
  cancelarTexto: {
    fontFamily: t.tipografia.familia.subtitulo,
    fontSize: t.tipografia.tamano.sm,
    color: t.colores.tintaSuave,
    letterSpacing: 1,
  },

  // ── Pantalla de reordenar arrastrando (#4) ──────────────────────────────────
  reordenarRaiz: { flex: 1 },
  reordenarMarco: {
    flex: 1,
    paddingHorizontal: espaciado.base,
    paddingTop: espaciado.md,
    paddingBottom: espaciado.md,
    gap: espaciado.md,
  },
  reordenarAyuda: {
    fontFamily: t.tipografia.familia.liviana,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.tintaSuave,
  },
  reordenarLista: { flex: 1 },
  reordenarContenido: { gap: espaciado.sm, paddingVertical: espaciado.sm },
  reordenarFila: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaciado.md,
    backgroundColor: t.colores.panelClaro,
    borderWidth: 1.5,
    borderColor: t.colores.borde,
    borderRadius: radios.sm,
    padding: espaciado.sm,
    minHeight: 60,
  },
  // Mientras se arrastra: se levanta (borde marcado, fondo claro y sombra), para
  // que se vea cuál se está moviendo.
  reordenarFilaActiva: {
    borderColor: t.colores.tinta,
    backgroundColor: t.colores.campoBlanco,
    elevation: 6,
  },
  reordenarNombre: {
    flex: 1,
    fontFamily: t.tipografia.familia.fuerte,
    fontSize: t.tipografia.tamano.sm,
    color: t.colores.tinta,
  },
  reordenarAsa: {
    fontFamily: t.tipografia.familia.titulo,
    fontSize: t.tipografia.tamano.xl,
    color: t.colores.tintaSuave,
    paddingHorizontal: espaciado.xs,
  },
}))
