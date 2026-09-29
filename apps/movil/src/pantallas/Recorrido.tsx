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
  const paradas = useMemo(() => data?.paradas ?? [], [data])

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
        ) : !jornada ? (
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
        ) : (
          <>
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

            {paradas.map((p) => (
              <FilaParada
                key={p.id}
                parada={p}
                alTocar={() => {
                  if (p.estado !== 'pendiente' && p.estado !== 'en_camino') return
                  yaPreguntado.current = p.id
                  navigation.navigate('DestinoVisitado', { paradaId: p.id })
                }}
              />
            ))}

            {/* "Ordenar por cercanía" se ofrece ANTES de arrancar, no en curso.
                Ya iniciado, reordenar reasignaría en silencio el destino que se
                está manejando —una prioridad alta lejana puede clavarse
                adelante— y "PRÓXIMO DESTINO" pasaría a apuntar a otro cliente.
                Se cuenta por paradas SIN resolver: con dos ya visitadas el
                servidor no tendría nada que ordenar. */}
            {!enCurso &&
            !finalizada &&
            paradas.filter((p) => p.estado === 'pendiente' || p.estado === 'en_camino').length >= 2 ? (
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
          </>
        )}
      </Panel>

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

function FilaParada({ parada, alTocar }: { parada: ParadaCompleta; alTocar?: () => void }) {
  const { colores } = usarTema()
  const estilos = usarEstilos()
  const resuelta = parada.estado === 'visitada' || parada.estado === 'no_visitada'
  // Una parada sin ubicar es una parada normal a la que le falta un dato, no
  // una parada rota: misma fila, mismo número, mismo toque para cargar la
  // visita. Lo único que cambia es una pastilla más y de dónde sale el
  // domicilio. Por eso NO se le baja la opacidad ni se la deshabilita: hacerlo
  // le diría al vendedor "esto no cuenta", justo lo contrario de lo que pasa.
  const sinUbicar = parada.direccion === null

  return (
    <Pressable
      onPress={alTocar}
      disabled={!alTocar}
      style={({ pressed }) => [estilos.fila, pressed && alTocar && estilos.filaPresionada]}
      accessibilityRole={alTocar ? 'button' : 'text'}
      accessibilityLabel={`Destino ${parada.orden}, ${parada.cliente?.razon_social ?? 'sin cliente'}, ${ETIQUETA_ESTADO_PARADA[parada.estado]}${sinUbicar ? ', sin ubicar' : ''}`}
    >
      <View style={[estilos.numero, { backgroundColor: colorDeEstado(parada.estado, colores) }]}>
        <Text style={estilos.numeroTexto}>{parada.orden}</Text>
      </View>

      <View style={estilos.filaTextos}>
        <Text style={estilos.filaCliente} numberOfLines={1}>
          {parada.cliente?.razon_social ?? parada.razon_social_snapshot ?? 'Destino sin cliente'}
        </Text>
        <Text style={estilos.filaDireccion} numberOfLines={2}>
          {domicilioDe(parada) ?? 'Sin domicilio cargado'}
        </Text>

        <View style={estilos.filaPastillas}>
          <Pastilla
            texto={ETIQUETA_ESTADO_PARADA[parada.estado]}
            color={colorDeEstado(parada.estado, colores)}
          />
          {/* Primero de las opcionales: es el dato que le cambia lo que va a
              hacer al llegar (guardar la ubicación), y en una fila angosta las
              pastillas se van cayendo al renglón de abajo por orden. */}
          {sinUbicar ? <Pastilla texto="SIN UBICAR" color={colores.rojoAccion} /> : null}
          {parada.prioridad !== 'baja' ? (
            <Pastilla
              texto={ETIQUETA_PRIORIDAD[parada.prioridad]}
              color={
                parada.prioridad === 'alta' ? colores.prioridadAlta : colores.prioridadMedia
              }
            />
          ) : null}
          {parada.origen === 'agregada_en_ruta' ? (
            <Pastilla texto="AGREGADO" color={colores.tintaSuave} />
          ) : null}
        </View>
      </View>

      {resuelta ? <Text style={estilos.tildeFila}>✓</Text> : null}
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

const usarEstilos = hojaDeTema((t) => ({
  contenido: { gap: espaciado.md },

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

  fila: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaciado.md,
    backgroundColor: t.colores.panelClaro,
    borderWidth: 1.5,
    borderColor: t.colores.borde,
    borderRadius: radios.sm,
    padding: espaciado.sm,
    minHeight: 76,
  },
  filaPresionada: { opacity: 0.7 },
  numero: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: t.colores.borde,
  },
  numeroTexto: {
    fontFamily: t.tipografia.familia.titulo,
    fontSize: t.tipografia.tamano.base,
    color: t.colores.blanco,
  },
  filaTextos: { flex: 1, gap: 2 },
  filaCliente: {
    fontFamily: t.tipografia.familia.fuerte,
    fontSize: t.tipografia.tamano.sm,
    color: t.colores.tinta,
  },
  filaDireccion: {
    fontFamily: t.tipografia.familia.liviana,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.tintaSuave,
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
  accionTexto: {
    fontFamily: t.tipografia.familia.fuerte,
    fontSize: t.tipografia.tamano.sm,
    color: t.colores.tinta,
    letterSpacing: 0.5,
  },
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
}))
