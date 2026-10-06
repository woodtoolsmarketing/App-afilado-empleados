import {
  espaciado,
  estaUbicada,
  ETIQUETA_MOTIVO_NO_VISITA,
  observacionSugerida,
  FORMULARIO_VISITA_VACIO,
  radios,
  validarFormularioVisita,
  type CampoVisita,
  type FormularioVisita,
  type MotivoNoVisita,
  type ParadaCompleta,
  todaviaNoLeToca,
} from '@woodtools/compartido'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { StackActions, useFocusEffect } from '@react-navigation/native'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  View,
} from 'react-native'

import { BotonMenu, BotonesSiNo, BotonSecundario } from '../componentes/Botones'
import { Campo, Casilla, Desplegable, MensajeError } from '../componentes/Formulario'
import { Aviso, Cargando, Pastilla } from '../componentes/Estado'
import { Encabezado } from '../componentes/Encabezado'
import { BarraPanel, Pantalla, Panel, TituloPanel } from '../componentes/Pantalla'
import { usarSesion } from '../nucleo/sesion'
import {
  finalizarRecorrido,
  obtenerJornadaDeHoy,
  registrarVisita,
  ubicarParada,
} from '../servicios/jornada'
import {
  guardarBorradorDeVisita,
  olvidarBorradorDeVisita,
  tomarBorradorDeVisita,
} from '../servicios/borradorDeVisita'
import { resumenDeNotasDeLaParada } from '../servicios/notasPedido'
import { misCambiosPendientes } from '../servicios/cambiosDireccion'
import {
  buscarEnMapsPorTexto,
  navegarHacia,
  ubicacionComoDireccion,
  type DireccionResuelta,
} from '../servicios/mapas'
import {
  permisoDeUbicacionPuntual,
  terminarRecorrido,
  ubicacionActual,
} from '../servicios/ubicacion'
import { usarDictado, DURACION_MAXIMA_MS } from '../servicios/transcripcion'
import type { PropsPantalla } from '../navegacion/tipos'
import { hojaDeTema, usarTema } from '../nucleo/tema'

/**
 * Formulario "¿DESTINO VISITADO?".
 *
 * Reglas de la consigna:
 *  · Todos los campos son obligatorios. Si falta alguno, no deja avanzar y
 *    marca exactamente cuál.
 *  · Con "SÍ" hay que marcar al menos un tipo de visita.
 *  · Con "NO" hay que elegir el motivo: "El cliente no estaba" o "Dirección
 *    errónea".
 *  · La observación nunca puede ser un "." ni una sola palabra.
 *  · El micrófono dicta la observación a través de Gemini.
 *
 * El botón de abajo cambia según si quedan destinos: "PRÓXIMO DESTINO" o
 * "FINALIZAR RECORRIDO".
 */
/**
 * Deja el campo de hora en "HH:MM" mientras se tipea.
 *
 * Se pone solo el dos puntos y se cortan los dígitos de más: en el teclado
 * numérico del teléfono no hay dos puntos a mano, y pedirle al vendedor que lo
 * busque en la calle es pedirle que no lo complete.
 */
function soloHora(texto: string): string {
  const d = texto.replace(/\D/g, '').slice(0, 4)
  if (d.length <= 2) return d
  return `${d.slice(0, 2)}:${d.slice(2)}`
}

/**
 * Cuántas letras tiene que tener una dirección para que la base la acepte.
 *
 * No es un número elegido acá: `ubicar_cliente` corta en 5 y levanta excepción.
 * Está escrito para poder preguntarlo ANTES de llamarla, y así decidir si el
 * domicilio de texto alcanza o si hay que resolver el punto con Google. Si
 * alguna vez cambia en la base, cambia acá.
 */
const MINIMO_DIRECCION = 5

export function PantallaDestinoVisitado({ navigation, route }: PropsPantalla<'DestinoVisitado'>) {
  const { colores } = usarTema()
  const estilos = usarEstilos()
  const { paradaId } = route.params
  const perfil = usarSesion((s) => s.perfil)
  const cliente = useQueryClient()
  const dictado = usarDictado()

  // Si se fue a hacer la nota de pedido y volvió, lo cargado sigue estando.
  //
  // Con inicializador de useState y no con `useRef(tomar…())`: el argumento de
  // useRef se evalúa en CADA render. Esta pantalla sigue montada debajo de la
  // nota, y al crearla se invalidan las consultas y se redibuja: cada redibujo
  // consumía el borrador, y la visita llegaba vacía a donde hacía falta.
  const [recuperado] = useState(() => tomarBorradorDeVisita(paradaId))
  const [form, setForm] = useState<FormularioVisita>(recuperado?.form ?? FORMULARIO_VISITA_VACIO)
  const [errores, setErrores] = useState<Partial<Record<CampoVisita, string>>>({})
  const [intentado, setIntentado] = useState(false)

  /**
   * La visita ya quedó registrada: esta pantalla no se vuelve a guardar.
   *
   * Un ref y no el estado de `guardar`, porque tiene que valer aunque la
   * mutación ya haya terminado y aunque la pantalla haya quedado viva en la pila
   * (por ejemplo, debajo de algo que se abrió desde el menú lateral mientras se
   * guardaba). Volver a tocar el botón llamaba de nuevo a registrar_visita, que
   * pisa coordenadas, desvío y hora de salida del registro bueno.
   */
  const registrada = useRef(false)

  // Al volver de la nota se vuelve a ESTA pantalla, que tiene todo en su
  // estado: el borrador guardado al salir ya no hace falta. Si quedara, la
  // próxima vez que se entre a la parada reviviría tildes viejos.
  //
  // Y si se vuelve a una visita que ya se registró, no hay nada que hacer acá:
  // se va derecho al recorrido.
  useFocusEffect(
    useCallback(() => {
      olvidarBorradorDeVisita(paradaId)
      if (registrada.current) navigation.popTo('Recorrido')
    }, [paradaId, navigation]),
  )

  const { data, isLoading } = useQuery({
    queryKey: ['jornada-hoy', perfil?.id],
    queryFn: () => obtenerJornadaDeHoy(perfil!.id),
    enabled: !!perfil,
  })

  const parada = data?.paradas.find((p) => p.id === paradaId)

  /**
   * La misma parada, pero sólo si tiene punto en el mapa.
   *
   * `estaUbicada` no es un `if` disfrazado: estrecha el tipo, así que de acá
   * para abajo `ubicada.direccion.lat` no necesita ningún `!`. Y como es un
   * `const`, el estrechamiento sobrevive adentro de los `onPress` —cosa que
   * `parada.direccion` no hace, porque TypeScript no puede saber que nadie la
   * cambió entre que se dibujó el botón y que el vendedor lo tocó—.
   *
   * `sinUbicar` es el otro lado: la parada existe pero entró al recorrido sin
   * punto, y lo único que hay para mostrar es el domicilio escrito.
   */
  const ubicada = parada && estaUbicada(parada) ? parada : null
  const sinUbicar = !!parada && ubicada === null
  const clienteId = parada?.cliente?.id ?? null

  /** El domicilio de texto que vino del sistema de gestión, si lo hay. */
  const domicilioEscrito = (parada?.direccion_snapshot ?? '').trim()

  // Los cambios de dirección que este vendedor ya propuso y la oficina todavía
  // no aplicó: sirven para mostrar la observación en la ficha y para que
  // "Navegar" al próximo destino vaya al punto nuevo, no al viejo.
  const { data: cambiosPendientes } = useQuery({
    queryKey: ['mis-cambios-direccion'],
    queryFn: misCambiosPendientes,
    staleTime: 60_000,
  })
  const cambioDeEstaParada = parada?.cliente?.id ? cambiosPendientes?.[parada.cliente.id] : undefined
  const restantes = useMemo(
    () =>
      (data?.paradas ?? []).filter(
        (p) => p.id !== paradaId && (p.estado === 'pendiente' || p.estado === 'en_camino'),
      ),
    [data, paradaId],
  )
  /**
   * ¿Es el último destino del día?
   *
   * No alcanza con que no queden otros: si a ESTE lo estamos difiriendo, va a
   * volver a la cola en un rato, así que el día no se termina acá.
   *
   * Sin esta condición la app hacía algo peor que equivocarse en un rótulo.
   * Justo después de que el vendedor cargara "vuelvo a las 16:30" le decía
   * "Era tu último destino del día. ¿Cerramos la jornada?", y cerrar la
   * jornada pasa a 'omitida' todas las paradas pendientes —incluida la que se
   * acababa de comprometer—. El cliente quedaba como "Sin visitar" y el
   * compromiso se perdía sin que nada lo avisara.
   */
  /** Este destino se esta difiriendo: vuelve a la cola mas tarde, hoy mismo. */
  const seDifiere = form.visitado === false && form.motivo_no_visita === 'visitar_mas_tarde'

  const esUltima = restantes.length === 0 && !seDifiere

  /**
   * Qué se vendió o se mandó a taller en esta visita, a grandes rasgos.
   *
   * Sale de las notas de pedido que se generaron DESDE esta parada — el vínculo
   * `notas_pedido.parada_id`, que existe justamente para esto. Una nota cargada
   * en otro momento del día no cuenta: no pasó en esta visita.
   */
  const { data: resumenDeNotas = [] } = useQuery({
    queryKey: ['resumen-notas-parada', paradaId],
    queryFn: () => resumenDeNotasDeLaParada(paradaId),
    enabled: !!paradaId,
  })
  /**
   * A dónde se va después de cerrar ésta.
   *
   * `restantes` cuenta todas —una diferida sigue siendo trabajo del día, así
   * que el "Quedan N destinos" tiene que incluirla—, pero como PRÓXIMO va la
   * primera que ya venció. Sin esto, cerrar un destino a las 14:00 mandaba al
   * que el vendedor había prometido visitar a las 16:30.
   */
  const siguiente = restantes.find((p) => !todaviaNoLeToca(p)) ?? restantes[0]

  /**
   * Sobre el estado anterior, no sobre la copia del render.
   *
   * Importa para el dictado: entre que se toca ⏹ y que vuelve la transcripción
   * pasan varios segundos, y el vendedor sigue escribiendo. Con `{ ...form }`
   * la respuesta se armaba con el formulario de antes de tocar el botón, así
   * que al llegar el texto dictado se borraba todo lo tipeado en el medio.
   */
  function actualizar(cambios: Partial<FormularioVisita>) {
    setForm((previo) => {
      const nuevo = { ...previo, ...cambios }
      // Una vez que intentó guardar, los errores se recalculan en vivo.
      if (intentado) setErrores(validarFormularioVisita(nuevo).errores)
      return nuevo
    })
  }

  /**
   * Si el vendedor ya escribió, la app no vuelve a tocar la observación.
   *
   * Va en un ref y no en el estado a propósito: cambiarlo no tiene que
   * redibujar nada, y sobre todo no tiene que entrar en las dependencias del
   * efecto de abajo, que si no se volvería a disparar justo cuando se acaba de
   * decidir que no debe.
   */
  const escritaAMano = useRef(recuperado?.escritaAMano ?? false)

  /**
   * La observación se escribe sola con lo que el vendedor marcó.
   *
   * Es lo mismo que ya tildó, puesto en palabras: "Se visitó al cliente:
   * vendió y retiró afilado". Sirve porque la observación es obligatoria por
   * partida doble —el validador y un CHECK en la base— y redactar en la calle,
   * con una mano, lo que ya se dijo con tildes es trabajo repetido.
   *
   * Se pisa mientras nadie la haya tocado. Al primer tecleo o al primer
   * dictado, esto se calla para siempre.
   */
  useEffect(() => {
    if (escritaAMano.current) return
    const sugerida = observacionSugerida(form, resumenDeNotas)
    if (sugerida && sugerida !== form.observacion) {
      setForm((previo) => ({ ...previo, observacion: sugerida }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    form.visitado,
    form.vendio,
    form.cobro,
    form.retiro_afilado,
    form.entrego,
    form.sin_pedido,
    form.otras,
    form.otras_detalle,
    form.motivo_no_visita,
    form.volver_a_las,
    form.contacto_nombre,
    resumenDeNotas,
  ])

  /**
   * Lanza el viaje al destino que sigue, tenga o no punto en el mapa.
   *
   * Los dos caminos están los dos porque no son la misma cosa:
   *
   *  · Con coordenadas se abre la navegación paso a paso, que es lo que el
   *    vendedor espera cuando toca "Navegar".
   *  · Sin coordenadas —el destino entró SIN UBICAR— se abre Google Maps
   *    BUSCANDO el domicilio escrito que vino del sistema de gestión. El botón
   *    no se esconde: el vendedor sabe más o menos dónde queda el cliente, y
   *    llegar a la cuadra con el domicilio escrito es muchísimo mejor que
   *    quedarse sin nada. Cuando llegue, la pantalla de la visita le va a
   *    ofrecer guardar el punto de una vez y para siempre.
   *
   * El punto propuesto se toma sólo si están las dos coordenadas. Antes se
   * tomaba cada una por su lado con un `??`, y una corrección a la que le
   * faltara una de las dos armaba un punto mezclado —la latitud de la
   * propuesta con la longitud de la dirección vieja—, que es un lugar en el
   * que no vive nadie.
   */
  function irHacia(destino: ParadaCompleta) {
    const cambio = destino.cliente?.id ? cambiosPendientes?.[destino.cliente.id] : undefined
    const propuesto =
      cambio && cambio.lat_propuesta !== null && cambio.lng_propuesta !== null
        ? { lat: cambio.lat_propuesta, lng: cambio.lng_propuesta }
        : null
    const punto = propuesto ?? destino.direccion

    if (punto) {
      void navegarHacia({ lat: punto.lat, lng: punto.lng }).catch(() => undefined)
      return
    }

    const domicilio = (destino.direccion_snapshot ?? '').trim()
    if (!domicilio) {
      // Ni punto ni domicilio escrito: no hay a dónde mandarlo, y decirlo es
      // mejor que abrir Maps en cualquier lado.
      Alert.alert(
        'Ese destino todavía no está en el mapa',
        'No tenemos ni el punto ni el domicilio escrito, así que no hay a dónde llevarte. Cuando llegues, tocá ESTOY ACÁ y la ubicación queda guardada.',
      )
      return
    }
    void buscarEnMapsPorTexto(domicilio).catch(() => undefined)
  }

  const guardar = useMutation({
    mutationFn: async () => {
      let posicion: { lat: number; lng: number; precision: number | null } | null = null
      try {
        posicion = await ubicacionActual()
      } catch {
        // Sin GPS igual se registra el parte; queda sin coordenadas.
      }

      await registrarVisita({
        ...form,
        visitado: form.visitado!,
        parada_id: paradaId,
        lat: posicion?.lat ?? null,
        lng: posicion?.lng ?? null,
        precision_m: posicion?.precision ?? null,
      })

      // El cierre de la jornada YA NO va acá. Cerrarla sola al registrar el
      // último parte dejaba al vendedor sin nada que hacer el resto del día: con
      // la jornada finalizada no se puede agregar un destino ni reabrirla, así
      // que un cliente que llama a las 16:00 no se podía registrar de ninguna
      // forma. Ahora se pregunta.
    },
    onSuccess: async () => {
      // Guardada de verdad: el borrador ya no tiene nada que recuperar, y esta
      // pantalla no se vuelve a guardar.
      registrada.current = true
      olvidarBorradorDeVisita(paradaId)
      await cliente.invalidateQueries()

      // De acá en adelante se sale con `salirA` (popTo) y no con navigate. En
      // React Navigation 7, navigate apila la pantalla nueva ENCIMA de ésta: la
      // visita ya guardada quedaba abajo con todo tildado, "‹ Atrás" volvía a
      // ella y tocar el botón de nuevo intentaba registrarla otra vez.
      if (esUltima) {
        Alert.alert(
          'Visita registrada',
          'Era tu último destino del día. ¿Cerramos la jornada?\n\nUna vez cerrada no se le pueden agregar más destinos.',
          [
            {
              text: 'Seguir abierta',
              style: 'cancel',
              onPress: () => salirA('Visitas'),
            },
            {
              text: 'Cerrar la jornada',
              onPress: () => cerrarJornada.mutate(),
            },
          ],
        )
        return
      }

      // Encadena con el próximo destino: lanza la navegación y vuelve al mapa.
      Alert.alert('Visita registrada', `Próximo destino: ${nombreDe(siguiente)}`, [
        { text: 'Ver recorrido', onPress: () => salirA('Recorrido') },
        {
          // Si el que sigue no tiene punto, el botón lo dice: lo que se abre es
          // una BÚSQUEDA del domicilio en Maps, no la voz que lo va guiando.
          // Prometer "Navegar" y que no arranque la navegación es peor que
          // llamar a las cosas por su nombre.
          text: siguiente && !estaUbicada(siguiente) ? 'Buscar en Maps' : 'Navegar',
          onPress: () => {
            salirA('Recorrido')
            if (siguiente) irHacia(siguiente)
          },
        },
      ])
    },
    onError: (e: Error) =>
      Alert.alert(
        'No pudimos guardar la visita',
        `${e.message}\n\nRevisá la señal y volvé a tocar el botón. Lo que cargaste sigue en pantalla.`,
      ),
  })

  /**
   * Cierra la jornada, con el mismo cuidado que el botón de la pantalla de
   * recorrido: el seguimiento se apaga aunque la escritura falle.
   */
  const cerrarJornada = useMutation({
    mutationFn: async () => {
      try {
        await finalizarRecorrido(data!.jornada.id)
      } finally {
        // Baja a seguimiento de jornada si todavía es horario laboral; si no,
        // corta del todo.
        await terminarRecorrido(perfil?.id).catch(() => undefined)
      }
    },
    onSuccess: async () => {
      await cliente.invalidateQueries()
      Alert.alert('Recorrido finalizado', 'Cerraste la jornada de hoy. Buen trabajo.')
      salirA('Visitas')
    },
    onError: (e: Error) => {
      Alert.alert(
        'No pudimos cerrar la jornada',
        `${e.message}\n\nEl seguimiento ya se apagó. La visita quedó registrada; cerrá la jornada desde VER RECORRIDO cuando tengas señal.`,
      )
      salirA('Visitas')
    },
  })

  /**
   * La dirección que se acaba de guardar, para confirmárselo en el acto.
   *
   * La ficha de arriba se arregla sola cuando vuelve la consulta —la parada
   * pasa a tener dirección y la pastilla SIN UBICAR desaparece—, pero eso
   * depende de la señal. El vendedor está parado en la puerta del cliente y
   * necesita saber YA si lo que tocó quedó guardado o no.
   */
  const [ubicacionGuardada, setUbicacionGuardada] = useState<string | null>(null)

  /**
   * "ESTOY ACÁ": guarda el punto donde está parado el vendedor.
   *
   * Es la pieza que faltaba de todo esto. El cliente entró al recorrido sin
   * estar en el mapa —el 40 % del padrón no tiene ninguna dirección cargada— y
   * acá, que es el único momento en que alguien de la empresa está físicamente
   * en la puerta, se resuelve de un toque y para siempre: queda en la ficha del
   * cliente, no en el recorrido de hoy.
   *
   * ── Qué se escribe como dirección ──────────────────────────────────────────
   *
   * Primero el domicilio de texto que vino del sistema de gestión
   * (`direccion_snapshot`): es el que la oficina reconoce, el que está en las
   * facturas, y lo tienen 6.386 de los 6.536 clientes sin ubicar. Con ése no
   * hace falta pedirle nada a Google: el punto lo pone el GPS y la dirección ya
   * la teníamos. Una llamada menos es un segundo menos y una cosa menos que
   * puede fallar con media barra de señal.
   *
   * Cuando no hay domicilio escrito —o es tan corto que `ubicar_cliente` lo
   * rechaza, que pide 5 caracteres— recién ahí se geocodifica al revés el punto
   * del GPS, que además trae localidad, provincia y código postal. Es la mejor
   * opción disponible: inventar un texto tipo "Ubicación tomada el 29/9" dejaría
   * la ficha del cliente con una dirección que no sirve para volver.
   *
   * Las coordenadas que se guardan son SIEMPRE las del GPS, nunca las que
   * devuelve Google: si el vendedor está en la puerta del galpón, ahí tiene que
   * caer el pin, aunque Google prefiera el número de la esquina.
   */
  const ubicar = useMutation({
    mutationFn: async (): Promise<string> => {
      if (!(await permisoDeUbicacionPuntual())) {
        throw new Error(
          'Necesitamos permiso de ubicación para guardar dónde estás. Podés activarlo en los ajustes del teléfono.',
        )
      }

      const punto = await ubicacionActual()

      let escrita = domicilioEscrito
      let deGoogle: DireccionResuelta | null = null
      if (escrita.length < MINIMO_DIRECCION) {
        deGoogle = await ubicacionComoDireccion({ lat: punto.lat, lng: punto.lng })
        escrita = deGoogle.direccion_formateada
      }

      await ubicarParada({
        paradaId,
        direccionFormateada: escrita,
        lat: punto.lat,
        lng: punto.lng,
        codigoPostal: deGoogle?.codigo_postal ?? null,
        googlePlaceId: deGoogle?.google_place_id ?? null,
        localidad: deGoogle?.localidad ?? null,
        provincia: deGoogle?.provincia ?? null,
      })

      return escrita
    },
    onSuccess: async (escrita) => {
      setUbicacionGuardada(escrita)
      // La lista del recorrido y el rol del día leen la misma consulta, y el
      // mapa de clientes acaba de ganar un pin que antes no existía.
      await cliente.invalidateQueries({ queryKey: ['jornada-hoy'] })
      await cliente.invalidateQueries({ queryKey: ['clientes-en-mapa'] })
    },
    onError: (e: Error) =>
      Alert.alert(
        'No pudimos guardar la ubicación',
        `${e.message}\n\nProbá otra vez con el cielo a la vista. Igual podés registrar la visita ahora mismo: guardar la ubicación no es obligatorio.`,
      ),
  })

  /**
   * Sale de la visita después de guardarla, sólo si el vendedor sigue en ella.
   *
   * `navigation.popTo` busca a partir de la pantalla ENFOCADA, no de ésta. El
   * guardado tarda (GPS de hasta 12 s, el RPC, refrescar todo), y si en el
   * medio el vendedor abrió otra pantalla —el menú lateral, una nota—, el
   * popTo del Alert la cerraba sin aviso, o reemplazaba la que tuviera
   * delante y dejaba esta visita, ya registrada, viva abajo.
   *
   * Si ya no está a la vista, al vendedor no se lo mueve de donde está, pero
   * esta pantalla se saca igual —sólo ella, por su key—. Si quedaba viva
   * abajo, la pantalla por parada (getId) la volvía a traer la próxima vez
   * que se abría esa parada —una diferida, por ejemplo— y rebotaba al
   * recorrido en vez de dejar cargar la visita nueva.
   */
  function salirA(destino: 'Visitas' | 'Recorrido') {
    if (navigation.isFocused()) {
      navigation.popTo(destino)
      return
    }
    // Si ya no está en la pila, el router no encuentra la key y no hace nada.
    navigation.dispatch({
      ...StackActions.pop(),
      source: route.key,
      target: navigation.getState().key,
    })
  }

  /** Guardando la visita o cerrando la jornada: nada de salir ni de volver a tocar. */
  const ocupado = guardar.isPending || cerrarJornada.isPending

  /**
   * El Atrás del teléfono también queda quieto mientras está `ocupado`.
   *
   * El "‹ Atrás" de la pantalla ya no hacía nada, pero el del teléfono sí:
   * sacaba esta pantalla con el guardado en vuelo. Si fallaba, el aviso decía
   * "lo que cargaste sigue en pantalla" y ya no estaba; si salía bien, la
   * parada seguía "en camino" en el recorrido y se podía abrir y registrar
   * otra vez. Un listener que devuelve true corta el goBack del navegador
   * (React Native los consulta del último registrado al primero).
   *
   * Con un ref y no con usePreventRemove: el cierre de la jornada sale con
   * popTo mientras su mutación todavía figura pendiente, y eso también lo
   * bloquearía, dejando al vendedor encerrado en la visita.
   */
  const ocupadoRef = useRef(false)
  ocupadoRef.current = ocupado
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => ocupadoRef.current)
      return () => sub.remove()
    }, []),
  )

  function alGuardar() {
    if (registrada.current) {
      salirA('Recorrido')
      return
    }
    setIntentado(true)
    const { valido, errores: nuevos } = validarFormularioVisita(form)
    setErrores(nuevos)
    if (!valido) return
    guardar.mutate()
  }

  async function alDictar() {
    // Grabando, o con audio esperando que lo pasen a texto: en los dos casos
    // el micrófono transcribe. Arrancar una grabación nueva encima tiraría lo
    // que el vendedor ya dijo.
    if (dictado.grabando || dictado.audioPendiente) {
      const texto = await dictado.detenerYTranscribir()
      if (texto) {
        escritaAMano.current = true
        // Se pega al final de lo que HAY cuando vuelve la transcripción, no de
        // lo que había cuando se tocó el botón.
        setForm((previo) => {
          const separador = previo.observacion.trim() ? ' ' : ''
          return {
            ...previo,
            observacion: `${previo.observacion.trim()}${separador}${texto}`,
            observacion_origen: 'voz',
          }
        })
      }
      return
    }
    await dictado.comenzar()
  }

  if (isLoading) {
    return (
      <Pantalla>
        <Encabezado />
        <Panel>
          <Cargando />
        </Panel>
      </Pantalla>
    )
  }

  return (
    <Pantalla>
      <Encabezado />

      <KeyboardAvoidingView
        style={estilos.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Panel contentStyle={estilos.contenido}>
          <BarraPanel alVolver={() => !ocupado && navigation.goBack()} />

          <TituloPanel>¿DESTINO VISITADO?</TituloPanel>

          {parada ? (
            <>
              <View style={estilos.ficha}>
                <Text style={estilos.fichaCliente}>
                  {parada.orden}. {parada.cliente?.razon_social ?? parada.razon_social_snapshot}
                </Text>
                {/* Sin punto en el mapa lo que se muestra es el domicilio
                    escrito que vino del sistema de gestión. Es lo que el
                    vendedor ya sabe de memoria y lo que lo trajo hasta acá. */}
                <Text style={estilos.fichaDireccion}>
                  {ubicada
                    ? ubicada.direccion.direccion_formateada
                    : domicilioEscrito || 'Sin domicilio anotado'}
                </Text>
                {parada.cliente?.codigo ? (
                  <Text style={estilos.fichaCodigo}>Cliente Nº {parada.cliente.codigo}</Text>
                ) : null}
                {/* La misma pastilla roja de todo el resto de la app: un solo
                    símbolo para "este destino no está en el mapa todavía". */}
                {sinUbicar ? (
                  <View style={estilos.fichaPastilla}>
                    <Pastilla texto="SIN UBICAR" color={colores.rojoAccion} />
                  </View>
                ) : null}
              </View>

              {cambioDeEstaParada ? (
                <Aviso tono="atencion">
                  Propusiste corregir la dirección a: {cambioDeEstaParada.direccion_propuesta}. Está
                  pendiente de que la oficina la aplique; tu recorrido ya te lleva ahí.
                </Aviso>
              ) : null}

              {/*
                ── "ESTOY ACÁ" ───────────────────────────────────────────────

                Va arriba de todo, antes de las preguntas de la visita, porque
                es lo único que se puede hacer únicamente ACÁ: estando parado en
                la puerta. El parte de la visita se puede completar en cualquier
                lado y en cualquier momento; el punto del cliente, no.

                Es un solo toque a propósito. El vendedor tiene el teléfono en
                una mano y está por tocar el timbre: cualquier pantalla
                intermedia, cualquier confirmación, es una excusa para dejarlo
                para después, y "después" es como este cliente lleva años sin
                estar en el mapa.

                Se pide el cliente porque la ubicación se guarda en SU ficha:
                una parada sin cliente no tiene dónde guardarla y la base la
                rechaza. No pasa en la práctica —una parada sin ubicar siempre
                nace de un cliente—, pero preguntarlo acá evita mostrar un botón
                que sólo puede fallar.
              */}
              {/*
                El aviso de "ya está" se mira primero, y a propósito no mira si
                la parada sigue sin ubicar: apenas vuelve la consulta la parada
                pasa a tener dirección, y si el cartel dependiera de eso se
                borraría solo unos segundos después de que el vendedor lo leyó.
                La confirmación de algo que se hace una sola vez en la vida del
                cliente se queda en pantalla hasta que se cierra la visita.
              */}
              {ubicacionGuardada ? (
                <Aviso tono="exito" titulo="Ubicación guardada">
                  {ubicacionGuardada}
                  {'\n\n'}
                  Quedó en la ficha del cliente: la próxima vez el recorrido ya te trae derecho.
                </Aviso>
              ) : sinUbicar && clienteId ? (
                <View style={estilos.bloqueUbicar}>
                  <BotonMenu
                    titulo="📍 ESTOY ACÁ — GUARDAR LA UBICACIÓN"
                    subtitulo="Guarda el punto donde estás parado ahora"
                    cargando={ubicar.isPending}
                    deshabilitado={ocupado}
                    alTocar={() => ubicar.mutate()}
                  />
                  <Text style={estilos.bloqueUbicarTexto}>
                    Este cliente todavía no está en el mapa. Si tocás el botón parado en la puerta,
                    el punto queda en su ficha para siempre y la próxima vez el recorrido te trae
                    derecho. Podés registrar la visita igual, aunque no lo guardes.
                  </Text>
                </View>
              ) : null}

              {/*
                Corregir la dirección es otra cosa que ubicar al cliente, y por
                eso este botón sale sólo cuando la parada YA tiene punto:
                corregir manda un pedido que la oficina revisa y aplica, mientras
                que un cliente sin dirección no tiene nada que corregir —tiene
                algo que cargar, y eso lo resuelve "ESTOY ACÁ" de arriba, que
                escribe en la ficha en el momento—. Ofrecer el camino largo para
                el caso que tiene uno corto es mandarlo a esperar a la oficina
                por algo que él puede dejar resuelto ahora.
              */}
              {ubicada && clienteId ? (
                <BotonSecundario
                  titulo="📍 La dirección está mal — corregir"
                  alTocar={() =>
                    navigation.navigate('CorregirDireccion', {
                      clienteId,
                      clienteNombre:
                        ubicada.cliente?.razon_social ?? ubicada.razon_social_snapshot ?? 'Cliente',
                      direccionId: ubicada.direccion.id,
                      direccionActual: ubicada.direccion.direccion_formateada,
                      lat: ubicada.direccion.lat,
                      lng: ubicada.direccion.lng,
                    })
                  }
                />
              ) : null}
            </>
          ) : null}

          <BotonesSiNo
            valor={form.visitado}
            alCambiar={(v) =>
              actualizar({
                visitado: v,
                // Cambiar de respuesta limpia lo que ya no aplica.
                ...(v
                  ? { motivo_no_visita: null }
                  : {
                      vendio: false,
                      cobro: false,
                      retiro_afilado: false,
                      entrego: false,
                      sin_pedido: false,
                      otras: false,
                      otras_detalle: '',
                    }),
              })
            }
            error={!!errores.visitado}
          />
          <MensajeError>{errores.visitado}</MensajeError>

          {/* ── SÍ: tipo de visita ─────────────────────────────────────────── */}
          {form.visitado === true ? (
            <View style={estilos.bloque}>
              <Text style={estilos.bloqueTitulo}>TIPO DE VISITA</Text>

              {/*
                Si ya se cargó una nota DESDE esta parada pero no se tildó nada,
                se recuerda. No se auto-tilda: el mapeo servicio→casilla no es
                exacto (un "afilado" puede ser recepción o entrega), así que
                marcar a ciegas contaría algo que no pasó. El vendedor decide;
                esto sólo evita que se olvide y la oficina no cuente la venta.
              */}
              {resumenDeNotas.length > 0 &&
              !form.vendio &&
              !form.cobro &&
              !form.retiro_afilado &&
              !form.entrego ? (
                <Aviso tono="info">
                  {`En esta visita ya cargaste una nota de pedido (${resumenDeNotas.join('; ')}). Marcá acá qué pasó, así la oficina lo cuenta.`}
                </Aviso>
              ) : null}

              <Casilla
                etiqueta="VENDIÓ"
                valor={form.vendio}
                alCambiar={(v) => actualizar({ vendio: v })}
              />
              <Casilla
                etiqueta="COBRÓ"
                valor={form.cobro}
                alCambiar={(v) => actualizar({ cobro: v })}
              />
              <Casilla
                etiqueta="RETIRÓ AFILADO"
                valor={form.retiro_afilado}
                alCambiar={(v) => actualizar({ retiro_afilado: v })}
              />
              <Casilla
                etiqueta="ENTREGÓ"
                valor={form.entrego}
                alCambiar={(v) => actualizar({ entrego: v })}
              />
              <Casilla
                etiqueta="NO TENÍA NADA EL CLIENTE"
                valor={form.sin_pedido}
                alCambiar={(v) => actualizar({ sin_pedido: v })}
              />
              <Casilla
                etiqueta="OTRAS"
                valor={form.otras}
                alCambiar={(v) =>
                  // Destildar "Otras" limpia el detalle: dejarlo escrito con la
                  // casilla apagada guardaría un texto que ya no aplica, y la
                  // base lo rechaza.
                  actualizar(v ? { otras: true } : { otras: false, otras_detalle: '' })
                }
              />

              <MensajeError>{errores.tipo_visita}</MensajeError>

              {/* El detalle sólo aparece con "Otras" marcada: es donde el
                  vendedor cuenta qué pasó cuando no fue ninguna de las de
                  arriba. */}
              {form.otras ? (
                <Campo
                  etiqueta="¿QUÉ PASÓ?"
                  obligatorio
                  value={form.otras_detalle}
                  onChangeText={(t) => actualizar({ otras_detalle: t })}
                  placeholder="Contá qué pasó en la visita"
                  error={errores.otras_detalle}
                  autoCapitalize="sentences"
                />
              ) : null}

              <Campo
                etiqueta="¿Quién te atendió?"
                value={form.contacto_nombre}
                onChangeText={(t) => actualizar({ contacto_nombre: t })}
                placeholder="Nombre del contacto"
                error={errores.contacto_nombre}
                autoCapitalize="words"
              />
            </View>
          ) : null}

          {/* ── NO: motivo ─────────────────────────────────────────────────── */}
          {form.visitado === false ? (
            <View style={estilos.bloque}>
              <Desplegable<MotivoNoVisita>
                etiqueta="¿POR QUÉ NO SE CONCRETÓ?"
                obligatorio
                marcador="Elegí el motivo"
                valor={form.motivo_no_visita}
                items={[
                  { valor: 'cliente_ausente', etiqueta: ETIQUETA_MOTIVO_NO_VISITA.cliente_ausente },
                  { valor: 'direccion_erronea', etiqueta: ETIQUETA_MOTIVO_NO_VISITA.direccion_erronea },
                  {
                    valor: 'visitar_mas_tarde',
                    etiqueta: ETIQUETA_MOTIVO_NO_VISITA.visitar_mas_tarde,
                    descripcion: 'El destino vuelve al recorrido a la hora que digas',
                  },
                ]}
                alCambiar={(v) => actualizar({ motivo_no_visita: v })}
                error={errores.motivo_no_visita}
              />

              {/* Sin hora, "visitar más tarde" no se distingue de "no lo
                  visité": la parada tiene que volver a la cola en algún momento
                  concreto o no vuelve nunca. */}
              {form.motivo_no_visita === 'visitar_mas_tarde' ? (
                <Campo
                  etiqueta="¿A QUÉ HORA VOLVÉS?"
                  obligatorio
                  value={form.volver_a_las}
                  onChangeText={(v) => actualizar({ volver_a_las: soloHora(v) })}
                  placeholder="16:30"
                  keyboardType="number-pad"
                  error={errores.volver_a_las}
                  ayuda="Vuelve a aparecer en el recorrido a esa hora, hoy mismo."
                />
              ) : null}
            </View>
          ) : null}

          {/* Hacer la nota desde acá, sin perder lo cargado. La visita queda
              guardada en memoria y vuelve completa al regresar; la nota queda
              atada a esta parada, que es lo que después alimenta la
              observación y el "la hizo en el lugar". */}
          {form.visitado === true ? (
            <BotonSecundario
              titulo="📝 HACER LA NOTA DE PEDIDO"
              deshabilitado={ocupado}
              alTocar={() => {
                guardarBorradorDeVisita(paradaId, form, escritaAMano.current)
                navigation.navigate('GenerarNota', {
                  paradaId,
                  clienteCodigo: parada?.cliente?.codigo ?? undefined,
                })
              }}
            />
          ) : null}

          {/* ── Observación ────────────────────────────────────────────────── */}
          <View style={estilos.bloque}>
            <Text style={estilos.bloqueTitulo}>OBSERVACIÓN</Text>

            <Campo
              value={form.observacion}
              onChangeText={(t) => {
                // A partir del primer tecleo la app deja de escribirla: lo que
                // el vendedor puso no se pisa nunca.
                escritaAMano.current = true
                actualizar({ observacion: t })
              }}
              placeholder="Contá qué pasó en la visita: qué se habló, qué quedó pendiente, cuándo volver…"
              multiline
              numberOfLines={6}
              error={errores.observacion}
              ayuda="Escribí al menos una frase. Un punto o una sola palabra no alcanzan."
              accesorio={
                <Pressable
                  onPress={alDictar}
                  disabled={dictado.transcribiendo}
                  hitSlop={12}
                  accessibilityRole="button"
                  accessibilityLabel={
                    dictado.grabando ? 'Detener grabación y transcribir' : 'Dictar la observación'
                  }
                  style={({ pressed }) => [
                    estilos.microfono,
                    dictado.grabando && estilos.microfonoActivo,
                    pressed && estilos.microfonoPresionado,
                  ]}
                >
                  {dictado.transcribiendo ? (
                    <ActivityIndicator size="small" color={colores.blanco} />
                  ) : (
                    <Text style={estilos.microfonoIcono}>{dictado.grabando ? '⏹' : '🎤'}</Text>
                  )}
                </Pressable>
              }
            />

            {dictado.grabando ? (
              <Aviso tono="info">
                {`Grabando… ${Math.floor(dictado.duracionMs / 1000)}s de ${DURACION_MAXIMA_MS / 1000}s. Tocá el cuadrado para terminar.`}
              </Aviso>
            ) : null}

            {dictado.transcribiendo ? <Aviso tono="info">Pasando el audio a texto…</Aviso> : null}
            {dictado.error ? <Aviso tono="atencion">{dictado.error}</Aviso> : null}
          </View>

          {intentado && Object.keys(errores).length > 0 ? (
            <Aviso tono="error" titulo="Faltan datos">
              {`Revisá ${Object.keys(errores).length === 1 ? 'el campo marcado' : 'los campos marcados'} en rojo antes de continuar.`}
            </Aviso>
          ) : null}

          <BotonMenu
            titulo={esUltima ? 'FINALIZAR RECORRIDO' : 'PRÓXIMO DESTINO'}
            subtitulo={
              esUltima
                ? 'Es el último destino del día'
                : seDifiere
                  ? // El que se difiere sigue siendo trabajo del dia: cuenta.
                    // Sin esto el boton decia "Quedan 0 destinos" justo despues
                    // de comprometer una vuelta, que es lo contrario de lo que
                    // pasa.
                    `Volvés a las ${form.volver_a_las || 'la hora que pusiste'}${
                      restantes.length > 0
                        ? `, y quedan ${restantes.length} más`
                        : ''
                    }`
                  : `Quedan ${restantes.length} destino${restantes.length === 1 ? '' : 's'}`
            }
            alTocar={alGuardar}
            cargando={ocupado}
          />
        </Panel>
      </KeyboardAvoidingView>
    </Pantalla>
  )
}

function nombreDe(parada?: { cliente?: { razon_social: string } | null; razon_social_snapshot?: string | null }) {
  return parada?.cliente?.razon_social ?? parada?.razon_social_snapshot ?? 'el siguiente destino'
}

const usarEstilos = hojaDeTema((t) => ({
  flex: { flex: 1 },
  contenido: { gap: espaciado.md },

  ficha: {
    backgroundColor: t.colores.campoBlanco,
    borderWidth: 2,
    borderColor: t.colores.borde,
    borderRadius: radios.sm,
    padding: espaciado.md,
    gap: 2,
  },
  fichaCliente: {
    fontFamily: t.tipografia.familia.subtitulo,
    fontSize: t.tipografia.tamano.base,
    color: t.colores.tinta,
  },
  fichaDireccion: {
    fontFamily: t.tipografia.familia.cuerpo,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.tintaSuave,
  },
  fichaCodigo: {
    fontFamily: t.tipografia.familia.liviana,
    fontSize: t.tipografia.tamano.micro,
    color: t.colores.tintaTenue,
  },
  // La fila existe para que la pastilla ocupe lo que mide y no todo el ancho
  // de la ficha: un rectángulo rojo de punta a punta parece un error, no una
  // etiqueta.
  fichaPastilla: { flexDirection: 'row', marginTop: espaciado.xs },

  /*
   * El recuadro de "ESTOY ACÁ".
   *
   * Lleva el mismo rojo que la pastilla SIN UBICAR de la ficha de arriba, para
   * que se lea como lo que es: la respuesta a ese cartel, no una opción más de
   * la pantalla.
   */
  bloqueUbicar: {
    backgroundColor: t.colores.campoBlanco,
    borderWidth: 2,
    borderColor: t.colores.rojoAccion,
    borderRadius: radios.sm,
    padding: espaciado.md,
    gap: espaciado.sm,
  },
  bloqueUbicarTexto: {
    fontFamily: t.tipografia.familia.cuerpo,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.tintaSuave,
    lineHeight: 18,
  },

  bloque: { gap: espaciado.sm },
  bloqueTitulo: {
    fontFamily: t.tipografia.familia.subtitulo,
    fontSize: t.tipografia.tamano.base,
    color: t.colores.tinta,
    letterSpacing: 0.8,
  },

  microfono: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: t.colores.rojoSolido,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: t.colores.borde,
  },
  microfonoActivo: { backgroundColor: t.colores.rojoAccion },
  microfonoPresionado: { opacity: 0.75 },
  microfonoIcono: { fontSize: 20 },
}))
