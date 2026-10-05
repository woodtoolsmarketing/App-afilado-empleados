import {
  espaciado,
  fechaLocalISO,
  FORMULARIO_DESTINO_EXISTENTE_VACIO,
  FORMULARIO_DESTINO_NUEVO_VACIO,
  radios,
  validarDestinoExistente,
  validarDestinoNuevo,
  type CampoDestinoExistente,
  type CampoDestinoNuevo,
  type ClienteBuscado,
  type FormularioDestinoExistente,
  type FormularioDestinoNuevo,
  type PrioridadParada,
  type SucursalCliente,
} from '@woodtools/compartido'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as Crypto from 'expo-crypto'
import { useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  View,
} from 'react-native'

import { BotonMenu, BotonSecundario } from '../componentes/Botones'
import { Campo, Desplegable } from '../componentes/Formulario'
import { Aviso, Pastilla } from '../componentes/Estado'
import { Encabezado } from '../componentes/Encabezado'
import { usarListaSemanalRapida } from '../componentes/ListaSemanalRapida'
import { BarraPanel, Pantalla, Panel, TituloPanel } from '../componentes/Pantalla'
import { usarSesion } from '../nucleo/sesion'
import {
  agregarParada,
  asegurarJornadaDe,
  asegurarJornadaDeHoy,
  clienteYaEnRecorrido,
  SucursalDuplicadaError,
} from '../servicios/jornada'
import {
  agregarDestinoClienteNuevo,
  agregarDestinoExistente,
  buscarClientes,
  direccionesDeCliente,
  ESPERA_TECLEO,
  LIMITE_CLIENTES,
  ubicarCliente,
} from '../servicios/clientes'
import { proponerCambioDireccion } from '../servicios/cambiosDireccion'
import {
  detallarDireccion,
  sugerirDirecciones,
  ubicacionComoDireccion,
  type DireccionResuelta,
  type SugerenciaDireccion,
} from '../servicios/mapas'
import {
  permisoDeUbicacionPuntual,
  prioridadPorCercania,
  ubicacionActual,
} from '../servicios/ubicacion'
import type { PropsPantalla } from '../navegacion/tipos'
import { hojaDeTema, usarTema } from '../nucleo/tema'

/**
 * "AGREGAR NUEVO DESTINO"
 *
 * Dos caminos, porque son dos situaciones distintas:
 *
 *  · **Cliente existente** — ya está en el padrón. Se lo busca por código o por
 *    razón social (cualquiera de los dos completa al otro) y la dirección viene
 *    sola de su ficha. El vendedor no retipea nada que la empresa ya sabe.
 *
 *  · **Cliente nuevo** — todavía no existe. Hay que cargar el nombre y la
 *    dirección. El cliente se crea como *provisorio*, con un código automático,
 *    para que la oficina lo complete después sin frenar la visita de hoy.
 */
export function PantallaAgregarDestino({ navigation, route }: PropsPantalla<'AgregarDestino'>) {
  const modo = route.params?.modo

  if (!modo) {
    return (
      <Selector
        alElegir={(m) => navigation.setParams({ modo: m })}
        alVolver={() => navigation.goBack()}
      />
    )
  }

  return modo === 'existente' ? (
    <FormularioExistente navigation={navigation} route={route} />
  ) : (
    <FormularioNuevo navigation={navigation} route={route} />
  )
}

const NOMBRES_DIA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']

/**
 * "jueves 12", para avisar en qué día real queda el destino.
 *
 * La barra de arriba ya cambia para mostrar la fecha correcta cuando se
 * agenda para otro día, pero el cartel de éxito es lo último que el vendedor
 * lee antes de volver a lo suyo: si no dice el día, un destino para el
 * jueves queda anotado como si fuera del recorrido de hoy.
 */
function nombrarDia(fechaISO: string): string {
  const d = new Date(`${fechaISO}T12:00:00`)
  return `${NOMBRES_DIA[d.getDay()]} ${d.getDate()}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 1 — elegir el camino
// ─────────────────────────────────────────────────────────────────────────────

function Selector({
  alElegir,
  alVolver,
}: {
  alElegir: (modo: 'existente' | 'nuevo') => void
  alVolver: () => void
}) {
  const estilos = usarEstilos()
  return (
    <Pantalla>
      <Encabezado />
      <Panel contentStyle={estilos.contenido}>
        <BarraPanel alVolver={alVolver} />
        <TituloPanel>{'AGREGAR NUEVO\nDESTINO'}</TituloPanel>

        <Text style={estilos.pregunta}>¿A quién vas a visitar?</Text>

        <BotonMenu
          titulo="CLIENTE EXISTENTE"
          subtitulo="Buscalo por código o razón social"
          alTocar={() => alElegir('existente')}
        />

        <BotonMenu
          titulo="CLIENTE NUEVO"
          subtitulo="Cargá el nombre y la dirección"
          alTocar={() => alElegir('nuevo')}
        />
      </Panel>
    </Pantalla>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Cliente existente
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Los errores que TODAVÍA valen para agregar un destino.
 *
 * `validarDestinoExistente` devuelve dos reglas, y hoy sólo una sigue siendo
 * cierta:
 *
 *  · "Elegí un cliente de la lista" — sí, sin cliente no hay nada que agregar.
 *  · "Ubicá el cliente en el mapa" — ya no. Un cliente sin coordenadas entra
 *    igual al recorrido: la parada queda SIN UBICAR, la base la manda al final
 *    y el vendedor guarda el punto cuando llega. Era justo el bloqueo del que
 *    se queja: "hasta que no llego yo al cliente no me permite cargarlo".
 *
 * El descarte se hace acá y no borrando la regla del paquete compartido porque
 * ese paquete lo comparte el panel de escritorio, que da de alta las paradas
 * por otro camino. Esta pantalla es la que cambió de opinión, así que es la que
 * se hace cargo; si algún día el validador se actualiza, esto sigue dando lo
 * mismo (con cliente elegido no queda ningún error en pie).
 */
function erroresDeDestino(
  form: FormularioDestinoExistente,
): Partial<Record<CampoDestinoExistente, string>> {
  if (form.cliente) return {}
  return validarDestinoExistente(form).errores
}

function FormularioExistente({ navigation, route }: PropsPantalla<'AgregarDestino'>) {
  const { colores } = usarTema()
  const estilos = usarEstilos()
  const perfil = usarSesion((s) => s.perfil)
  const cliente = useQueryClient()
  const lista = usarListaSemanalRapida()

  /**
   * Si `fecha` viene seteada y no es la de hoy, el destino se agenda para
   * OTRO día. Sin esto la barra de arriba marcaba hoy igual —el default de
   * `BarraPanel` es `new Date()`— y el cartel de éxito no lo mencionaba, así
   * que un destino cargado para el jueves parecía uno más del recorrido de
   * hoy.
   */
  const fechaAgenda = route.params?.fecha
  const esOtroDia = !!fechaAgenda && fechaAgenda !== fechaLocalISO(new Date())

  /*
   * El formulario arranca con lo que se vino a buscar ya escrito.
   *
   * Va en el campo que corresponde: si son todos dígitos es un código de
   * cliente, si no es la razón social. Escribirlo en el campo equivocado sería
   * peor que no escribirlo, porque el vendedor tendría que borrarlo primero.
   */
  const aBuscar = (route.params?.buscarA ?? '').trim()
  const [form, setForm] = useState<FormularioDestinoExistente>(() =>
    aBuscar
      ? {
          ...FORMULARIO_DESTINO_EXISTENTE_VACIO,
          ...(/^\d+$/.test(aBuscar) ? { codigo: aBuscar } : { razon_social: aBuscar }),
        }
      : FORMULARIO_DESTINO_EXISTENTE_VACIO,
  )
  const [errores, setErrores] = useState<Partial<Record<CampoDestinoExistente, string>>>({})
  const [intentado, setIntentado] = useState(false)

  /**
   * El buscador puede arrancar escrito.
   *
   * Lo usa el calendario de visitas cuando ofrece "UBICARLO EN EL MAPA" sobre
   * un cliente que el plan sugiere y todavía no tiene dirección: ese cliente ya
   * está nombrado en la pantalla de la que se viene, y hacérselo tipear de
   * nuevo al vendedor sería pedirle que busque lo que acaba de señalar.
   */
  const [consulta, setConsulta] = useState(aBuscar)
  const [resultados, setResultados] = useState<ClienteBuscado[]>([])
  const [buscando, setBuscando] = useState(false)
  const [falloBusqueda, setFalloBusqueda] = useState<string | null>(null)
  /**
   * Qué texto se preguntó de verdad. Sin esto el cartel de "ningún cliente
   * coincide" salía en el mismo render en que se tipea la segunda letra, antes
   * de que la consulta hubiera salido siquiera.
   */
  const [consultaBuscada, setConsultaBuscada] = useState('')
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null)

  /**
   * Quién manda sobre la lista: sólo la última búsqueda puede dibujar.
   *
   * Es el mismo arreglo que el del encabezado de la nota. Tipear un código son
   * varias búsquedas —una por cada pausa entre teclas—, vuelven en cualquier
   * orden, y la vieja repintaba encima de la nueva o volvía a abrir la lista
   * arriba del cliente que el vendedor ya había elegido.
   */
  const vigente = useRef(0)

  // Una sola búsqueda alimenta los dos campos: la función `buscar_clientes` de
  // Postgres mira código y razón social a la vez.
  async function buscar(texto: string) {
    const mia = ++vigente.current
    setBuscando(true)
    setFalloBusqueda(null)
    try {
      const encontrados = await buscarClientes(texto)
      if (mia !== vigente.current) return
      setResultados(encontrados)
      setConsultaBuscada(texto)
    } catch (e) {
      // "No encontramos ese cliente" y "no pudimos preguntar" son cosas
      // distintas, y confundirlas es caro: el vendedor termina cargando de
      // nuevo un cliente que ya existe, y la oficina se queda con dos fichas
      // del mismo taller.
      if (mia !== vigente.current) return
      setResultados([])
      setFalloBusqueda((e as Error).message)
    } finally {
      if (mia === vigente.current) setBuscando(false)
    }
  }

  useEffect(() => {
    if (temporizador.current) clearTimeout(temporizador.current)

    if (consulta.trim().length < 2) {
      vigente.current++
      setResultados([])
      setBuscando(false)
      setFalloBusqueda(null)
      setConsultaBuscada('')
      return
    }

    temporizador.current = setTimeout(() => void buscar(consulta.trim()), ESPERA_TECLEO)

    return () => {
      if (temporizador.current) clearTimeout(temporizador.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consulta])

  /** Buscar YA: es lo que hace la tecla "Listo" del teclado. */
  function buscarYa() {
    if (temporizador.current) clearTimeout(temporizador.current)
    const texto = consulta.trim()
    if (texto.length < 2) return
    void buscar(texto)
  }

  /**
   * Sobre el estado anterior, no sobre la copia del render.
   *
   * Mismo criterio que en GENERAR NUEVO CLIENTE: entre que se toca una
   * sugerencia y que Google contesta pasan segundos, y con `{ ...form }` la
   * respuesta se arma con el formulario de antes de tocarla.
   */
  function actualizar(cambios: Partial<FormularioDestinoExistente>) {
    setForm((previo) => {
      const nuevo = { ...previo, ...cambios }
      if (intentado) setErrores(erroresDeDestino(nuevo))
      return nuevo
    })
  }

  /**
   * Al tipear en cualquiera de los dos campos se invalida la selección previa.
   * Sólo si el texto cambió de verdad: soltar el cliente cuando no lo tocaron
   * es lo que hacía que se perdiera después de haberlo elegido bien.
   */
  function alTipear(campo: 'codigo' | 'razon_social', texto: string) {
    if (texto === form[campo]) return
    setConsulta(texto)
    actualizar({ [campo]: texto, cliente: null } as Partial<FormularioDestinoExistente>)
  }

  function elegirCliente(c: ClienteBuscado) {
    // Lo que esté viajando ya no puede reabrir la lista sobre el elegido.
    vigente.current++
    if (temporizador.current) clearTimeout(temporizador.current)
    setBuscando(false)
    setResultados([])
    // El aviso de "no pudimos preguntar" no puede sobrevivir a la elección:
    // quedaba contradiciendo al cliente que ya está en pantalla.
    setFalloBusqueda(null)
    setConsulta('')
    // Acá está el "que uno complete al otro": se llenan los dos campos.
    actualizar({ codigo: c.codigo, razon_social: c.razon_social, cliente: c })
  }

  /**
   * El cliente elegido, en una variable propia.
   *
   * No es cosmético: `form.cliente` es una propiedad, y TypeScript le suelta el
   * chequeo apenas se lo usa adentro de una función que corre más tarde —el
   * `alUbicar` del ubicador, el `mutationFn` del alta—. Ahí es donde antes
   * aparecían los `!`, que es prometer que nunca es null en un lugar donde el
   * compilador ya no puede verificarlo. Una constante local no tiene ese
   * problema: lo que se chequeó una vez vale adentro también.
   */
  const elegido = form.cliente

  /**
   * El cliente elegido no tiene punto en el mapa.
   *
   * Se mira `direccion_id` y no `lat` porque es exactamente el dato que decide
   * el camino del alta: sin fila en `direcciones` la parada entra SIN UBICAR.
   * En el padrón los dos vienen siempre juntos —una dirección guardada tiene
   * coordenadas, es lo que exige la tabla—, así que no hay caso en que
   * discrepen; lo que cambia es de cuál se habla.
   */
  const sinUbicar = elegido !== null && elegido.direccion_id === null

  /**
   * Las sucursales (direcciones) del cliente, para elegir a cuál se va.
   *
   * La mayoría tiene una sola —la principal— y no se pregunta nada. El selector
   * aparece recién cuando hay dos o más (lugares de entrega cargados desde el
   * panel). Un cliente sin ubicar no tiene ninguna, así que tampoco se consulta.
   */
  const { data: sucursales = [] } = useQuery({
    queryKey: ['sucursales', elegido?.cliente_id],
    queryFn: () => direccionesDeCliente(elegido!.cliente_id),
    enabled: !!elegido?.cliente_id && !sinUbicar,
    staleTime: 60_000,
  })

  /** Apunta el destino a otra sucursal: le pisa la dirección al cliente elegido. */
  function elegirSucursal(s: SucursalCliente) {
    if (!elegido) return
    actualizar({
      cliente: {
        ...elegido,
        direccion_id: s.id,
        direccion: s.direccion_formateada,
        codigo_postal: s.codigo_postal,
        lat: s.lat,
        lng: s.lng,
        localidad: s.localidad,
        provincia: s.provincia,
      },
    })
  }

  /**
   * "Para ESTE cliente ya dije que sí, es otra sucursal".
   *
   * El aviso de sucursal corta el alta con un `SucursalDuplicadaError`; cuando
   * el vendedor confirma, se anota acá el cliente confirmado y se vuelve a
   * disparar el alta, que esta vez pasa de largo el chequeo.
   *
   * Guarda el `cliente_id`, no un booleano, a propósito: si fuera un `true`
   * suelto y el reintento fallara por otra cosa (se cortó la señal), el flag
   * quedaría prendido y el PRÓXIMO cliente duplicado se agregaría sin preguntar.
   * Atado al id, sólo saltea el aviso del cliente que efectivamente se confirmó.
   * Es un ref y no un estado porque no dibuja nada.
   */
  const confirmadoParaCliente = useRef<string | null>(null)

  /**
   * Candado sincrónico contra el doble-toque.
   *
   * `guardar.isPending` no alcanza: es estado de React y recién vale `true` en
   * el próximo render, así que dos toques disparados en el mismo tick lo ven en
   * `false` los dos y entran los dos. Antes la base atajaba ese doble-agregado
   * con el índice único de cliente por jornada; desde que se sacó —para permitir
   * las sucursales— hace falta cerrar la ventana acá. Un ref cambia en el acto.
   */
  const enviando = useRef(false)

  const guardar = useMutation({
    mutationFn: async () => {
      if (!perfil) throw new Error('No hay sesión')
      if (!elegido) throw new Error('Elegí un cliente de la lista para agregarlo.')

      /*
       * ¿Ya está en el recorrido de ese día? Preguntar si es otra sucursal.
       *
       * Hay clientes que son un solo código y varios locales; el mismo cliente
       * puede entrar más de una vez. Pero la mayoría de las veces agregar dos
       * veces al mismo es un error, así que se avisa y se deja que el vendedor
       * decida.
       *
       * Corre también agendando para OTRO día. Este camino con `fecha` inserta
       * derecho por `agregar_parada` (no reusa como `agendar_visita`), así que
       * desde que no hay índice único de cliente por jornada, si el aviso no
       * corriera acá el duplicado a futuro entraría sin que nada lo frene.
       */
      // La clave lleva la sucursal: confirmar "es otra sucursal" para un local no
      // saltea el aviso de OTRO local del mismo cliente.
      const claveDestino = `${elegido.cliente_id}|${elegido.direccion_id ?? ''}`
      if (
        confirmadoParaCliente.current !== claveDestino &&
        elegido.cliente_id &&
        (await clienteYaEnRecorrido(
          perfil.id,
          elegido.cliente_id,
          route.params?.fecha,
          elegido.direccion_id,
        ))
      ) {
        throw new SucursalDuplicadaError(elegido.razon_social)
      }

      // Con fecha, el destino entra en la jornada de ESE día: es una visita
      // agendada, no una del recorrido de hoy.
      const jornada = route.params?.fecha
        ? await asegurarJornadaDe(perfil.id, route.params.fecha)
        : await asegurarJornadaDeHoy(perfil.id)

      /*
       * La prioridad la decide la distancia, y para medirla hacen falta las dos
       * coordenadas del cliente. Sin ellas no hay contra qué medir: entra
       * 'baja'. Agendando para otro día tampoco sirve la cercanía de ahora, que
       * no dice nada del orden de una jornada que todavía no empezó.
       */
      const prioridad: PrioridadParada =
        esOtroDia || elegido.lat === null || elegido.lng === null
          ? 'baja'
          : await prioridadPorCercania(elegido.lat, elegido.lng)

      // El camino de siempre: el cliente ya tiene su punto en el mapa.
      if (elegido.direccion_id) {
        return agregarDestinoExistente({ rolVisitaId: jornada.id, cliente: elegido, prioridad })
      }

      /*
       * Sin dirección la parada entra igual, SIN UBICAR.
       *
       * Va derecho por `agregarParada` —que acepta `direccionId: null`— y no
       * por `agregarDestinoExistente`, que sigue pidiendo la dirección porque
       * es la que sirve al otro camino. La base manda sola al final estas
       * paradas, sin mirar la prioridad que le pidamos, así que acá no hay nada
       * que ordenar: la prioridad viaja igual para que la parada quede
       * coherente si algún día se la ubica.
       */
      // El duplicado ya se manejó arriba con el aviso de sucursal, y la base ya
      // no tiene índice único de cliente por jornada, así que este alta no
      // choca: si el vendedor llegó hasta acá, es porque va.
      return await agregarParada({
        rolVisitaId: jornada.id,
        direccionId: null,
        prioridad,
        clienteId: elegido.cliente_id,
      })
    },
    onSuccess: async (parada) => {
      confirmadoParaCliente.current = null
      await cliente.invalidateQueries()
      /*
       * Tres mensajes, no uno.
       *
       * La variante "próximo destino: estás cerca" sólo tiene sentido para el
       * recorrido de HOY. Agendando para otro día la cercanía de ahora no dice
       * nada del orden de esa jornada futura, y "estás cerca" + "es para el
       * jueves" se contradicen: ahí va el mensaje neutro de posición.
       *
       * Y la parada que entró sin ubicar tiene que decir las dos cosas que el
       * vendedor no puede adivinar: que quedó última —la base las manda al
       * final siempre— y que la ubicación se guarda cuando llegue. Sin eso, ver
       * el destino al fondo de la lista parece un error de la app.
       */
      const mensaje = sinUbicar
        ? `${form.razon_social} entró al recorrido en la posición Nº ${parada.orden}, al final.\n\nComo todavía no está marcado en el mapa va último. Cuando llegues, guardás la ubicación desde la parada y queda cargada para siempre.`
        : parada.prioridad === 'alta' && !esOtroDia
          ? `${form.razon_social} queda como próximo destino (Nº ${parada.orden}): estás cerca.`
          : `${form.razon_social} se agregó al recorrido en la posición Nº ${parada.orden}.`

      Alert.alert(
        'Destino agregado',
        // Sin esta línea, un destino agendado para otro día no se distingue
        // del recorrido de hoy hasta que el vendedor lo va a buscar y no está.
        esOtroDia && fechaAgenda
          ? `${mensaje}\n\nQueda agendado para el ${nombrarDia(fechaAgenda)}.`
          : mensaje,
        [{ text: 'Listo', onPress: () => navigation.navigate(route.params?.volverA ?? 'Recorrido') }],
      )
    },
    onError: (e: Error) => {
      // No es un error: el cliente ya está en la lista y hay que preguntar si
      // es otra sucursal. Si el vendedor confirma, se agrega igual.
      if (e instanceof SucursalDuplicadaError) {
        Alert.alert(
          'Ya está en tu recorrido',
          `${e.razonSocial} ya está en tu recorrido ${esOtroDia ? 'de ese día' : 'de hoy'}.\n\n¿Es otra sucursal? Si es el mismo local, no hace falta agregarlo de nuevo.`,
          [
            { text: 'No, cancelar', style: 'cancel' },
            {
              text: 'Sí, es otra sucursal',
              onPress: () => {
                confirmadoParaCliente.current = elegido
                  ? `${elegido.cliente_id}|${elegido.direccion_id ?? ''}`
                  : null
                guardar.mutate()
              },
            },
          ],
        )
        return
      }
      Alert.alert('No pudimos agregar el destino', e.message)
    },
    onSettled: () => {
      // La mutación terminó (bien, mal, o cortada por el aviso de sucursal): se
      // libera el candado del doble-toque. Un reintento por "es otra sucursal"
      // sale del Alert, que no es toqueteable dos veces, así que no lo necesita.
      enviando.current = false
    },
  })

  function alAgregar() {
    // Ya se agregó, o está en vuelo: un segundo toque (rápido, o volviendo con
    // Atrás a esta pantalla que queda montada) crearía un destino duplicado.
    if (enviando.current || guardar.isPending || guardar.isSuccess) return
    setIntentado(true)
    const nuevos = erroresDeDestino(form)
    setErrores(nuevos)
    if (Object.keys(nuevos).length === 0) {
      enviando.current = true
      guardar.mutate()
    }
  }

  return (
    <Pantalla>
      <Encabezado />

      <KeyboardAvoidingView
        style={estilos.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Panel contentStyle={estilos.contenido}>
          <BarraPanel
            alVolver={() => navigation.setParams({ modo: undefined })}
            // Sin esto la barra marcaba siempre hoy, aunque se estuviera
            // agendando para otro día.
            fecha={fechaAgenda ? new Date(`${fechaAgenda}T12:00:00`) : undefined}
          />

          <TituloPanel>{'CLIENTE\nEXISTENTE'}</TituloPanel>

          <Campo
            etiqueta="CÓDIGO DE CLIENTE"
            value={form.codigo}
            onChangeText={(t) => alTipear('codigo', t)}
            placeholder="Ej. 1003"
            autoCapitalize="characters"
            contenedorStyle={estilos.campoCorto}
            returnKeyType="search"
            blurOnSubmit={false}
            onSubmitEditing={buscarYa}
            accesorio={buscando ? <ActivityIndicator size="small" color={colores.rojo} /> : undefined}
          />

          <Text style={estilos.separadorO}>— o —</Text>

          <Campo
            etiqueta="NOMBRE O RAZÓN SOCIAL"
            value={form.razon_social}
            onChangeText={(t) => alTipear('razon_social', t)}
            placeholder="Ej. Maderera del Oeste"
            autoCapitalize="words"
            returnKeyType="search"
            blurOnSubmit={false}
            onSubmitEditing={buscarYa}
            error={errores.cliente}
          />

          {resultados.length > 0 ? (
            <View style={estilos.sugerencias}>
              {resultados.map((c) => (
                <View key={c.cliente_id} style={estilos.sugerenciaFilaExterna}>
                  {/* Tocar el cliente lo elige como destino, igual que antes. */}
                  <Pressable
                    onPress={() => elegirCliente(c)}
                    accessibilityRole="button"
                    accessibilityLabel={`${c.codigo}, ${c.razon_social}`}
                    style={({ pressed }) => [
                      estilos.sugerencia,
                      estilos.sugerenciaInfo,
                      pressed && estilos.sugerenciaTocada,
                    ]}
                  >
                    <View style={estilos.sugerenciaFila}>
                      <Text style={estilos.sugerenciaCodigo}>{c.codigo}</Text>
                      {c.provisorio ? <Pastilla texto="PROVISORIO" color={colores.ambarOscuro} /> : null}
                      {/*
                        Antes decía "SIN DIRECCIÓN" y quedaba justo arriba de la
                        dirección del cliente, que sí estaba escrita. Lo que falta
                        no es el domicilio: son las coordenadas.

                        Sigue siendo la misma pastilla, pero ya no es un cartel de
                        "no se puede": ahora es un dato —dónde va a quedar en la
                        lista— y quién lo dice es la nota de abajo, una sola vez
                        para toda la búsqueda en vez de repetirla en cada fila.
                      */}
                      {c.lat === null ? (
                        <Pastilla
                          texto={c.direccion ? 'SIN UBICAR' : 'SIN DIRECCIÓN'}
                          color={colores.rojoAccion}
                        />
                      ) : null}
                    </View>
                    <Text style={estilos.sugerenciaPrincipal} numberOfLines={1}>
                      {c.razon_social}
                    </Text>
                    {c.direccion ? (
                      <Text style={estilos.sugerenciaSecundaria} numberOfLines={1}>
                        {c.direccion}
                      </Text>
                    ) : null}
                    {/* Ahora se puede buscar por teléfono: si no se muestra, el
                        cliente que enganchó por su número parece un resultado al
                        azar. */}
                    {c.telefono ? (
                      <Text style={estilos.sugerenciaSecundaria} numberOfLines={1}>
                        Tel {c.telefono}
                      </Text>
                    ) : null}
                  </Pressable>

                  {/* Atajo: sumarlo a la lista semanal sin elegirlo como destino. */}
                  <Pressable
                    onPress={() => lista.abrir(c.cliente_id, c.razon_social)}
                    accessibilityRole="button"
                    accessibilityLabel={`Agregar ${c.razon_social} a mi lista semanal`}
                    style={({ pressed }) => [estilos.aLista, pressed && estilos.sugerenciaTocada]}
                  >
                    <Text style={estilos.aListaIcono}>📋</Text>
                    <Text style={estilos.aListaTexto}>LISTA</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          ) : null}

          {/*
            Qué quiere decir la pastilla roja, dicho una sola vez.
            Es lo que la convierte en un dato: el vendedor ve SIN UBICAR sobre
            el cliente que quiere y, si nadie le aclara, asume lo de siempre
            —que no lo va a poder agregar— y se va a cargarlo como cliente
            nuevo. Sale sólo si en la lista hay alguno así: la aclaración no
            tiene por qué estorbar a las búsquedas donde no viene al caso.
          */}
          {resultados.some((c) => c.lat === null) ? (
            <Text style={estilos.notaLista}>
              Los que dicen SIN UBICAR entran igual al recorrido: van al final y la ubicación se
              guarda cuando llegás.
            </Text>
          ) : null}

          {/* La búsqueda falló: no sabemos si el cliente existe o no. */}
          {falloBusqueda && !buscando ? (
            <Aviso tono="atencion" titulo="No pudimos buscar">
              {falloBusqueda}
              {'\n\n'}Revisá la señal y escribí de nuevo. No lo cargues como cliente nuevo hasta
              poder buscarlo: si ya existe, quedarían dos fichas del mismo taller.
            </Aviso>
          ) : null}

          {/* La lista quedó cortada: hay más de los que entran. Sin esto el
              vendedor ve que su cliente no está y lo carga de nuevo. */}
          {resultados.length >= LIMITE_CLIENTES ? (
            <Aviso tono="atencion">
              {`Hay más de ${LIMITE_CLIENTES} que coinciden. Escribí un poco más —otro dígito del código, o más letras del nombre— para achicar la lista.`}
            </Aviso>
          ) : null}

          {/* La búsqueda respondió bien y vino vacía: ahí sí no existe. */}

          {!falloBusqueda &&
          consulta.trim().length >= 2 &&
          !buscando &&
          consultaBuscada === consulta.trim() &&
          resultados.length === 0 ? (
            <Aviso tono="atencion" titulo="Sin resultados">
              No encontramos ese cliente. Si es la primera vez que lo visitás, cargalo como cliente
              nuevo.
              <BotonSecundario
                titulo={`CARGAR "${consulta.trim()}" COMO CLIENTE NUEVO`}
                alTocar={() =>
                  navigation.navigate('AgregarDestino', {
                    modo: 'nuevo',
                    volverA: route.params?.volverA,
                    fecha: route.params?.fecha,
                    // Mismo criterio que separa código de razón social al
                    // arrancar el formulario (línea de `aBuscar` más arriba):
                    // si es todo dígitos es un código mal tipeado, no un
                    // nombre, y no tiene sentido cargarlo como razón social.
                    buscarA: /^\d+$/.test(consulta.trim()) ? undefined : consulta.trim(),
                  })
                }
              />
            </Aviso>
          ) : null}

          {/*
            Varias sucursales: elegí a cuál vas. La parada y la navegación
            apuntan a ésa. Con una sola dirección no se pregunta nada (ni
            aparece): el selector sale recién cuando hay lugares de entrega
            cargados además de la principal.
          */}
          {elegido && sucursales.length >= 2 ? (
            <Desplegable<string>
              etiqueta="¿A QUÉ SUCURSAL?"
              valor={elegido.direccion_id}
              items={sucursales.map((s) => ({
                valor: s.id,
                etiqueta: s.principal ? 'Principal' : s.etiqueta,
                descripcion: s.direccion_formateada,
              }))}
              alCambiar={(id) => {
                const s = sucursales.find((x) => x.id === id)
                if (s) elegirSucursal(s)
              }}
            />
          ) : null}

          {/* La ubicación se completa sola desde la ficha del cliente. */}
          {elegido ? (
            <View style={estilos.fichaCliente}>
              <View style={estilos.fichaEncabezado}>
                <Text style={estilos.fichaTitulo}>UBICACIÓN DEL CLIENTE</Text>
                {/* La misma pastilla que en la lista de arriba, con el mismo
                    criterio: un solo símbolo para el vendedor, acá, en la
                    búsqueda y en el recorrido. */}
                {sinUbicar ? (
                  <Pastilla
                    texto={elegido.direccion ? 'SIN UBICAR' : 'SIN DIRECCIÓN'}
                    color={colores.rojoAccion}
                  />
                ) : null}
              </View>
              <Text style={estilos.fichaDireccion}>
                {elegido.direccion ?? 'Sin dirección cargada'}
              </Text>
              {elegido.codigo_postal ? (
                <Text style={estilos.fichaDato}>CP {elegido.codigo_postal}</Text>
              ) : null}
              {elegido.contacto_nombre ? (
                <Text style={estilos.fichaDato}>Contacto: {elegido.contacto_nombre}</Text>
              ) : null}
            </View>
          ) : null}

          {/*
            Las dos cosas que el vendedor no puede adivinar, dichas ANTES de que
            toque el botón: dónde va a quedar la parada y cuándo se resuelve el
            mapa. Sin esto, agregar un cliente sin ubicar se siente como agregar
            algo a medio hacer, y el vendedor vuelve a frenarse solo —que es
            justo lo que veníamos a sacar—.
          */}
          {sinUbicar ? (
            <Aviso tono="info" titulo="Se agrega igual">
              Este cliente todavía no está marcado en el mapa, así que entra AL FINAL del recorrido.
              Cuando llegues, guardás la ubicación desde la parada y queda cargada para siempre.
            </Aviso>
          ) : null}

          {/*
            El botón de agregar va ARRIBA del ubicador, y ese es el cambio.

            Antes, al cliente sin coordenadas el ubicador se le abría solo acá en
            el medio y había que resolverlo para llegar al botón: un peaje. Lo
            que pidió el vendedor es poder dejarlo en la lista en dos toques y
            arreglar el mapa cuando llega. Así que primero lo que vino a hacer, y
            abajo —chico, cerrado— el camino de ubicarlo ahora para el que quiera
            hacerlo igual.
          */}
          <BotonMenu
            titulo={'AGREGAR AL\nRECORRIDO'}
            alTocar={alAgregar}
            cargando={guardar.isPending}
            deshabilitado={guardar.isSuccess}
          />

          {/*
            Dos situaciones, un mismo componente. O el cliente nunca se ubicó
            —el padrón del Gestión trae el domicilio en texto y sin
            coordenadas— o la ficha dice una cosa y el local está en otra. El
            que sabe cuál de las dos es, es el que está parado en la puerta.

            La `key` es por cliente porque el bloque se queda montado cuando el
            vendedor busca otro: sin ella se arrastraban al cliente siguiente la
            dirección tipeada y el "ubicar o corregir" del anterior.
          */}
          {elegido ? (
            <UbicarCliente
              key={elegido.cliente_id}
              cliente={elegido}
              arrancaAbierto={route.params?.abrirUbicador === true}
              alUbicar={(ubicada) =>
                actualizar({
                  cliente: {
                    ...elegido,
                    direccion_id: ubicada.direccion_id,
                    direccion: ubicada.direccion_formateada,
                    codigo_postal: ubicada.codigo_postal ?? elegido.codigo_postal,
                    lat: ubicada.lat,
                    lng: ubicada.lng,
                    localidad: ubicada.localidad ?? elegido.localidad,
                  },
                })
              }
            />
          ) : null}
        </Panel>
      </KeyboardAvoidingView>

      {lista.modal}
    </Pantalla>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Ubicar en el mapa a un cliente del padrón
// ─────────────────────────────────────────────────────────────────────────────

interface ClienteUbicado {
  direccion_id: string
  direccion_formateada: string
  codigo_postal: string | null
  lat: number
  lng: number
  localidad: string | null
}

/**
 * Poner al cliente en el mapa, o corregir dónde está.
 *
 * Cubre dos situaciones que para el vendedor son la misma pregunta —"¿dónde
 * queda este cliente?"— y que para la app son dos cosas distintas:
 *
 *  · **Nunca se ubicó.** Es el caso de los que vinieron del Gestión: calle,
 *    localidad y CP en texto, cero coordenadas. Ubicarlo le escribe la
 *    dirección a la ficha del cliente, así que queda para todos y para siempre,
 *    no sólo para el recorrido de hoy.
 *
 *  · **Está ubicado pero mal.** La ficha dice una cosa y el local está en otra.
 *    Eso NO se pisa desde la calle: se manda como propuesta a la oficina.
 *
 * Los dos arrancan CERRADOS, y ese es el cambio. Antes, al que nunca se había
 * ubicado el bloque se le abría solo y en rojo, porque sin coordenadas la
 * parada no entraba al recorrido y no había nada que decidir. Ahora entra igual
 * —sin ubicar, al final de la lista—, así que marcarlo en el mapa dejó de ser
 * un peaje y pasó a ser una opción; y una opción no se abre sola encima de lo
 * que el vendedor vino a hacer.
 *
 * Dos formas de resolverlo, porque las dos hacen falta en la calle. El buscador
 * de Google sirve cuando el vendedor sabe la dirección; el GPS sirve cuando está
 * parado en la puerta de un lugar que no figura en ningún mapa —un aserradero
 * sobre una ruta, un galpón en un camino de tierra—, que es justo donde el
 * buscador no lo va a ayudar.
 */
function UbicarCliente({
  cliente,
  alUbicar,
  arrancaAbierto = false,
}: {
  cliente: ClienteBuscado
  alUbicar: (ubicada: ClienteUbicado) => void
  /** Lo manda quien llegó acá tocando "UBICAR" y no "agregar". */
  arrancaAbierto?: boolean
}) {
  const { colores } = usarTema()
  const estilos = usarEstilos()

  /**
   * A qué vino este bloque: a ubicar por primera vez, o a corregir.
   *
   * Se decide al montar y no se recalcula, porque el dato del que sale —las
   * coordenadas del cliente— cambia justo en el momento en que se guarda: el
   * formulario de arriba mete el punto nuevo en la ficha y `cliente.lat` deja
   * de ser null. Leyéndolo en cada render, el cartel verde de "Ubicación
   * guardada" se daba vuelta solo y terminaba diciendo "Corrección enviada"
   * sobre un cliente que se acababa de ubicar por primera vez.
   *
   * Que sea por cliente lo garantiza la `key` de arriba: elegir otro cliente
   * monta un bloque nuevo.
   */
  const faltaUbicar = useRef(cliente.lat === null).current

  /**
   * Cerrado al arrancar, falte ubicarlo o no.
   *
   * Abrirlo solo era la forma de obligar: mientras el destino no entraba sin
   * coordenadas, había que resolver el mapa para poder seguir. Ya no hay nada
   * que resolver antes, así que el que lo quiera abrir lo abre.
   *
   * La excepción es quien llegó acá tocando "UBICAR" o "UBICARLO EN EL MAPA"
   * —desde el calendario o desde clientes del día—. Ése ya dijo a qué vino, y
   * hacerle buscar un bloque plegado al pie de la pantalla es contestarle otra
   * cosa. Ahí llega abierto.
   */
  const [abierto, setAbierto] = useState(arrancaAbierto)

  const sugerido = [cliente.direccion, cliente.localidad].filter(Boolean).join(', ')
  const [texto, setTexto] = useState(sugerido)
  const [sugerencias, setSugerencias] = useState<SugerenciaDireccion[]>([])
  const [buscando, setBuscando] = useState(false)
  const [confirmada, setConfirmada] = useState<string | null>(null)
  const [fallo, setFallo] = useState<string | null>(null)

  const sesion = useRef(Crypto.randomUUID())
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Con el texto precargado no se dispara sola la búsqueda: sería una llamada a
  // Google por cada cliente que el vendedor mira de paso. Espera a que toque
  // "BUSCAR" o a que edite el texto.
  const [activa, setActiva] = useState(false)

  useEffect(() => {
    if (!activa || confirmada) return
    if (temporizador.current) clearTimeout(temporizador.current)

    if (texto.trim().length < 4) {
      setSugerencias([])
      return
    }

    temporizador.current = setTimeout(async () => {
      setBuscando(true)
      setFallo(null)
      try {
        const encontradas = await sugerirDirecciones(texto, sesion.current)
        setSugerencias(encontradas)
        if (encontradas.length === 0) {
          setFallo('Google no encontró esa dirección. Probá escribirla de otra forma.')
        }
      } catch (e) {
        setSugerencias([])
        setFallo((e as Error).message)
      } finally {
        setBuscando(false)
      }
    }, 350)

    return () => {
      if (temporizador.current) clearTimeout(temporizador.current)
    }
  }, [texto, activa, confirmada])

  /**
   * Guarda la dirección resuelta, venga del buscador o del GPS.
   *
   * Un cliente que nunca se ubicó (sin coordenadas) se ubica DIRECTO: no hay
   * nada que pisar, la ficha estaba vacía y alguien tenía que llenarla. Pero
   * corregir una dirección que YA estaba cargada no la pisa —eso lo decide la
   * oficina—: se manda como PROPUESTA (queda en "Cambios de dirección" del
   * panel). El form local sí toma la coordenada nueva, así el recorrido de este
   * vendedor ya lo lleva ahí, sin esperar a la oficina.
   */
  async function guardarUbicacion(d: DireccionResuelta): Promise<ClienteUbicado> {
    if (faltaUbicar) {
      const fila = await ubicarCliente({ clienteId: cliente.cliente_id, direccion: d })
      return {
        direccion_id: fila.direccion_id,
        direccion_formateada: d.direccion_formateada,
        codigo_postal: d.codigo_postal,
        lat: fila.lat,
        lng: fila.lng,
        localidad: fila.localidad,
      }
    }

    await proponerCambioDireccion({
      clienteId: cliente.cliente_id,
      direccionId: cliente.direccion_id,
      direccion: d.direccion_formateada,
      lat: d.lat,
      lng: d.lng,
    })
    return {
      direccion_id: cliente.direccion_id ?? '',
      direccion_formateada: d.direccion_formateada,
      codigo_postal: d.codigo_postal,
      lat: d.lat,
      lng: d.lng,
      localidad: d.localidad,
    }
  }

  function alGuardar(ubicada: ClienteUbicado) {
    setSugerencias([])
    setConfirmada(ubicada.direccion_formateada)
    alUbicar(ubicada)
    if (!faltaUbicar) {
      Alert.alert(
        'Corrección enviada',
        'La dirección no se cambia sola: la oficina la revisa y la aplica. Tu recorrido ya te lleva a la ubicación nueva.',
      )
    }
  }

  const desdeBuscador = useMutation<ClienteUbicado, Error, SugerenciaDireccion>({
    mutationFn: async (s) => {
      const d = await detallarDireccion(s.place_id, sesion.current)
      sesion.current = Crypto.randomUUID()
      return guardarUbicacion(d)
    },
    onSuccess: alGuardar,
    onError: (e) => Alert.alert('No pudimos ubicar al cliente', e.message),
  })

  const desdeGps = useMutation<ClienteUbicado, Error, void>({
    mutationFn: async () => {
      if (!(await permisoDeUbicacionPuntual())) {
        throw new Error(
          'Necesitamos permiso de ubicación para usar dónde estás. Podés activarlo en los ajustes del teléfono.',
        )
      }
      const coords = await ubicacionActual()
      const d = await ubicacionComoDireccion({ lat: coords.lat, lng: coords.lng })
      return guardarUbicacion(d)
    },
    onSuccess: alGuardar,
    onError: (e) => Alert.alert('No pudimos usar tu ubicación', e.message),
  })

  const trabajando = desdeBuscador.isPending || desdeGps.isPending

  if (confirmada) {
    return (
      <Aviso tono="exito" titulo={faltaUbicar ? 'Ubicación guardada' : 'Corrección enviada'}>
        {confirmada}
        {'\n\n'}
        {faltaUbicar
          ? 'Queda en la ficha del cliente: la próxima vez ya va a estar. Y el destino ya no entra al final: entra en el lugar que le toca en la ruta.'
          : 'La oficina la revisa y la aplica. Tu recorrido ya te lleva ahí.'}
      </Aviso>
    )
  }

  /*
   * Cerrado: sólo el acceso, sin ocupar pantalla.
   *
   * Es el camino secundario de las dos situaciones, y por eso el texto cambia:
   * al que nunca se ubicó se le ofrece ubicarlo ahora (no se le reclama), y al
   * que ya está ubicado se le ofrece corregirlo.
   */
  if (!abierto) {
    return (
      <Pressable
        onPress={() => {
          setAbierto(true)
          setActiva(false)
        }}
        accessibilityRole="button"
        accessibilityLabel={
          faltaUbicar
            ? 'Ubicar ahora este cliente en el mapa'
            : 'Corregir la ubicación de este cliente'
        }
        style={({ pressed }) => [estilos.corregir, pressed && estilos.sugerenciaTocada]}
      >
        <Text style={estilos.corregirTexto}>
          {faltaUbicar
            ? '¿Sabés dónde queda? UBICARLO AHORA EN EL MAPA'
            : '¿La dirección está mal? CORREGIR UBICACIÓN'}
        </Text>
      </Pressable>
    )
  }

  return (
    <View style={estilos.ubicar}>
      <Text style={estilos.fichaTitulo}>
        {faltaUbicar ? 'UBICARLO EN EL MAPA' : 'CORREGIR LA UBICACIÓN'}
      </Text>
      {/*
        El arranque cambia según lo que haya en la ficha, porque son dos
        situaciones distintas y decirle "tiene el domicilio escrito" al que no
        lo tiene es mentirle en la cara. Lo que sigue es igual para los dos: que
        esto ya no es obligatorio, y qué se gana haciéndolo igual.
      */}
      <Text style={estilos.ubicarAyuda}>
        {faltaUbicar
          ? `${
              cliente.direccion
                ? 'Este cliente tiene el domicilio escrito pero nunca se lo marcó en el mapa.'
                : 'De este cliente no tenemos ni el domicilio escrito.'
            } No hace falta resolverlo ahora —podés agregarlo igual y guardar la ubicación cuando llegues—, pero si ya sabés dónde queda, marcándolo acá te queda la navegación hasta la puerta y la dirección cargada para siempre.`
          : 'Esto NO cambia la dirección para todos: manda una corrección a la oficina, que la revisa y la aplica. Tu recorrido ya te lleva al punto nuevo.'}
      </Text>

      <Campo
        etiqueta="DIRECCIÓN"
        value={texto}
        onChangeText={(t) => {
          setTexto(t)
          setActiva(true)
          setFallo(null)
        }}
        placeholder="Calle, número, localidad"
        autoCapitalize="words"
        accesorio={buscando ? <ActivityIndicator size="small" color={colores.rojo} /> : undefined}
      />

      {!activa ? <BotonMenu titulo="BUSCAR EN GOOGLE" alTocar={() => setActiva(true)} /> : null}

      {sugerencias.length > 0 ? (
        <View style={estilos.sugerencias}>
          {sugerencias.map((s) => (
            <Pressable
              key={s.place_id}
              onPress={() => desdeBuscador.mutate(s)}
              disabled={trabajando}
              accessibilityRole="button"
              accessibilityLabel={s.texto}
              style={({ pressed }) => [estilos.sugerencia, pressed && estilos.sugerenciaTocada]}
            >
              <Text style={estilos.sugerenciaPrincipal} numberOfLines={1}>
                {s.principal || s.texto}
              </Text>
              {s.secundario ? (
                <Text style={estilos.sugerenciaSecundaria} numberOfLines={1}>
                  {s.secundario}
                </Text>
              ) : null}
            </Pressable>
          ))}
        </View>
      ) : null}

      <Text style={estilos.separadorO}>— o —</Text>

      {/*
        Para los clientes que no figuran en ningún mapa: un aserradero sobre una
        ruta, un galpón en un camino de tierra. Ahí el buscador no ayuda y estar
        parado en la puerta es el único dato bueno que hay.
      */}
      <BotonMenu
        titulo="UTILIZAR MI UBICACIÓN ACTUAL"
        subtitulo="Guarda el punto donde estás parado ahora"
        alTocar={() => desdeGps.mutate()}
        cargando={desdeGps.isPending}
        deshabilitado={trabajando}
      />

      {desdeBuscador.isPending ? (
        <Aviso tono="info" titulo="Guardando la ubicación">
          Un segundo.
        </Aviso>
      ) : null}

      {fallo && !buscando ? (
        <Aviso tono="atencion" titulo="No pudimos buscar la dirección">
          {fallo}
        </Aviso>
      ) : null}

      {/*
        La salida existe para los dos casos, y antes sólo la tenía la
        corrección: al que le faltaba ubicar no se le daba forma de cerrar el
        bloque porque no se lo dejaba seguir sin resolverlo. Ahora que ubicarlo
        es opcional, arrepentirse tiene que costar un toque.
      */}
      <Pressable onPress={() => setAbierto(false)} accessibilityRole="button">
        <Text style={estilos.cancelar}>
          {faltaUbicar ? 'Ahora no: lo ubico cuando llegue' : 'Dejarla como está'}
        </Text>
      </Pressable>
    </View>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Cliente nuevo
// ─────────────────────────────────────────────────────────────────────────────

function FormularioNuevo({ navigation, route }: PropsPantalla<'AgregarDestino'>) {
  const { colores } = usarTema()
  const estilos = usarEstilos()
  const perfil = usarSesion((s) => s.perfil)
  const cliente = useQueryClient()

  /**
   * Si `fecha` viene seteada y no es la de hoy, el destino se agenda para
   * OTRO día. Mismo criterio que en CLIENTE EXISTENTE: la barra tiene que
   * mostrarlo y el cartel de éxito tiene que decirlo.
   */
  const fechaAgenda = route.params?.fecha
  const esOtroDia = !!fechaAgenda && fechaAgenda !== fechaLocalISO(new Date())

  /**
   * Puede arrancar con la razón social ya escrita: es lo que usa "Sin
   * resultados" de CLIENTE EXISTENTE cuando el vendedor busca a alguien que
   * no está en el padrón y decide cargarlo de cero, para no hacerle retipear
   * lo que ya había puesto.
   */
  const [form, setForm] = useState<FormularioDestinoNuevo>(() => {
    const nombreInicial = (route.params?.buscarA ?? '').trim()
    return nombreInicial
      ? { ...FORMULARIO_DESTINO_NUEVO_VACIO, razon_social: nombreInicial }
      : FORMULARIO_DESTINO_NUEVO_VACIO
  })
  const [errores, setErrores] = useState<Partial<Record<CampoDestinoNuevo, string>>>({})
  const [intentado, setIntentado] = useState(false)

  const [texto, setTexto] = useState('')
  const [sugerencias, setSugerencias] = useState<SugerenciaDireccion[]>([])
  const [buscando, setBuscando] = useState(false)
  const [elegida, setElegida] = useState(false)

  // Un token de sesión por búsqueda: Google cobra el autocompletado y el
  // detalle como una sola operación si comparten token.
  const sesion = useRef(Crypto.randomUUID())
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (elegida) return
    if (temporizador.current) clearTimeout(temporizador.current)

    if (texto.trim().length < 4) {
      setSugerencias([])
      return
    }

    temporizador.current = setTimeout(async () => {
      setBuscando(true)
      try {
        setSugerencias(await sugerirDirecciones(texto, sesion.current))
      } catch {
        setSugerencias([])
      } finally {
        setBuscando(false)
      }
    }, 350)

    return () => {
      if (temporizador.current) clearTimeout(temporizador.current)
    }
  }, [texto, elegida])

  /**
   * Sobre el estado anterior, no sobre la copia del render.
   *
   * Es el mismo error que ya se corrigió en GENERAR NUEVO CLIENTE, y acá pega
   * en el mismo momento: entre que el vendedor toca una sugerencia de
   * dirección y que Google contesta pasan segundos, y en esos segundos sigue
   * tipeando el teléfono, el contacto y la prioridad. Con `{ ...form }` la
   * respuesta se armaba con el formulario de ANTES de tocar la sugerencia, así
   * que todo lo escrito en el medio se borraba solo.
   */
  function actualizar(cambios: Partial<FormularioDestinoNuevo>) {
    setForm((previo) => {
      const nuevo = { ...previo, ...cambios }
      if (intentado) setErrores(validarDestinoNuevo(nuevo).errores)
      return nuevo
    })
  }

  async function elegirSugerencia(s: SugerenciaDireccion) {
    setElegida(true)
    setSugerencias([])
    setTexto(s.texto)
    setBuscando(true)

    try {
      const d = await detallarDireccion(s.place_id, sesion.current)
      sesion.current = Crypto.randomUUID()

      actualizar({
        direccion_formateada: d.direccion_formateada,
        codigo_postal: d.codigo_postal ?? '',
        lat: d.lat,
        lng: d.lng,
        google_place_id: d.google_place_id,
        localidad: d.localidad,
        provincia: d.provincia,
      })
    } catch (e) {
      Alert.alert('No pudimos leer esa dirección', (e as Error).message)
      setElegida(false)
    } finally {
      setBuscando(false)
    }
  }

  const guardar = useMutation({
    mutationFn: async () => {
      if (!perfil) throw new Error('No hay sesión')
      // Con fecha, el destino entra en la jornada de ESE día: es una visita
      // agendada, no una del recorrido de hoy.
      const jornada = route.params?.fecha
        ? await asegurarJornadaDe(perfil.id, route.params.fecha)
        : await asegurarJornadaDeHoy(perfil.id)
      // El cliente nuevo se acaba de ubicar en el mapa, así que hay contra qué
      // medir: si el vendedor está encima, el destino se clava adelante.
      return agregarDestinoClienteNuevo({
        rolVisitaId: jornada.id,
        // Para otro día no vale la cercanía de ahora (ver arriba): entra 'baja'.
        form: {
          ...form,
          prioridad: esOtroDia ? 'baja' : await prioridadPorCercania(form.lat!, form.lng!),
        },
      })
    },
    onSuccess: async (parada) => {
      await cliente.invalidateQueries()
      Alert.alert(
        'Cliente y destino creados',
        `${form.razon_social} quedó en la posición Nº ${parada.orden}.\n\nSe cargó como cliente provisorio: la oficina le va a completar el código y los datos que falten.` +
          // Sin esto, un destino agendado para otro día no se distingue del
          // recorrido de hoy hasta que el vendedor lo va a buscar y no está.
          (esOtroDia ? `\n\nQueda agendado para el ${nombrarDia(fechaAgenda!)}.` : ''),
        [{ text: 'Listo', onPress: () => navigation.navigate(route.params?.volverA ?? 'Recorrido') }],
      )
    },
    onError: (e: Error) => Alert.alert('No pudimos crear el cliente', e.message),
  })

  function alAgregar() {
    // Ya se agregó: un segundo toque (volviendo con Atrás a esta pantalla, que
    // queda montada) crearía un destino/cliente duplicado.
    if (guardar.isPending || guardar.isSuccess) return
    setIntentado(true)
    const { valido, errores: nuevos } = validarDestinoNuevo(form)
    setErrores(nuevos)
    if (valido) guardar.mutate()
  }

  return (
    <Pantalla>
      <Encabezado />

      <KeyboardAvoidingView
        style={estilos.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Panel contentStyle={estilos.contenido}>
          <BarraPanel
            alVolver={() => navigation.setParams({ modo: undefined })}
            // Sin esto la barra marcaba siempre hoy, aunque se estuviera
            // agendando para otro día.
            fecha={fechaAgenda ? new Date(`${fechaAgenda}T12:00:00`) : undefined}
          />

          <TituloPanel>{'CLIENTE\nNUEVO'}</TituloPanel>

          <Campo
            etiqueta="NOMBRE O RAZÓN SOCIAL"
            obligatorio
            value={form.razon_social}
            onChangeText={(t) => actualizar({ razon_social: t })}
            placeholder="Cómo figura o cómo lo conocen"
            error={errores.razon_social}
            autoCapitalize="words"
          />

          <Campo
            etiqueta="DIRECCIÓN"
            obligatorio
            value={texto}
            onChangeText={(t) => {
              setTexto(t)
              setElegida(false)
              if (form.lat !== null) {
                // Editar el texto invalida las coordenadas que ya teníamos.
                actualizar({ lat: null, lng: null, google_place_id: null, direccion_formateada: t })
              }
            }}
            placeholder="Calle, número, localidad"
            error={errores.direccion}
            ayuda="Elegí una de las sugerencias de Google para que se cargue el mapa y el CP."
            autoCapitalize="words"
            accesorio={buscando ? <ActivityIndicator size="small" color={colores.rojo} /> : undefined}
          />

          {sugerencias.length > 0 ? (
            <View style={estilos.sugerencias}>
              {sugerencias.map((s) => (
                <Pressable
                  key={s.place_id}
                  onPress={() => elegirSugerencia(s)}
                  accessibilityRole="button"
                  accessibilityLabel={s.texto}
                  style={({ pressed }) => [estilos.sugerencia, pressed && estilos.sugerenciaTocada]}
                >
                  <Text style={estilos.sugerenciaPrincipal} numberOfLines={1}>
                    {s.principal || s.texto}
                  </Text>
                  {s.secundario ? (
                    <Text style={estilos.sugerenciaSecundaria} numberOfLines={1}>
                      {s.secundario}
                    </Text>
                  ) : null}
                </Pressable>
              ))}
            </View>
          ) : null}

          {form.lat !== null ? (
            <Aviso tono="exito" titulo="Dirección confirmada">
              {form.direccion_formateada}
            </Aviso>
          ) : null}

          <Campo
            etiqueta="CP"
            obligatorio
            value={form.codigo_postal}
            onChangeText={(t) => actualizar({ codigo_postal: t })}
            placeholder="1704"
            error={errores.codigo_postal}
            autoCapitalize="characters"
            maxLength={8}
            contenedorStyle={estilos.campoCorto}
            ayuda={form.lat !== null ? 'Lo completó Google. Podés corregirlo si hace falta.' : undefined}
          />

          <Campo
            etiqueta="Teléfono (opcional)"
            value={form.telefono}
            onChangeText={(t) => actualizar({ telefono: t })}
            placeholder="11 4444 5555"
            keyboardType="phone-pad"
          />

          <Campo
            etiqueta="Contacto (opcional)"
            value={form.contacto_nombre}
            onChangeText={(t) => actualizar({ contacto_nombre: t })}
            placeholder="Con quién se habló"
            autoCapitalize="words"
          />

          <Aviso tono="info">
            El cliente se guarda como provisorio con un código automático. La oficina completa
            después el código real y los datos fiscales.
          </Aviso>

          <BotonMenu
            titulo={'AGREGAR AL\nRECORRIDO'}
            alTocar={alAgregar}
            cargando={guardar.isPending}
            deshabilitado={guardar.isSuccess}
          />
        </Panel>
      </KeyboardAvoidingView>
    </Pantalla>
  )
}

const usarEstilos = hojaDeTema((t) => ({
  flex: { flex: 1 },
  contenido: { gap: espaciado.md },
  campoCorto: { maxWidth: 220 },

  pregunta: {
    fontFamily: t.tipografia.familia.cuerpo,
    fontSize: t.tipografia.tamano.base,
    color: t.colores.tintaSuave,
    textAlign: 'center',
    marginBottom: espaciado.xs,
  },

  separadorO: {
    fontFamily: t.tipografia.familia.cuerpo,
    fontSize: t.tipografia.tamano.sm,
    color: t.colores.tintaTenue,
    textAlign: 'center',
    marginVertical: -espaciado.xs,
  },

  sugerencias: {
    borderWidth: 2,
    borderColor: t.colores.borde,
    borderRadius: radios.sm,
    backgroundColor: t.colores.campoBlanco,
    overflow: 'hidden',
  },
  // La fila entera: el cliente (que se elige tocándolo) y, al costado, el
  // atajo para sumarlo a la lista semanal. El separador de abajo NO va acá: la
  // línea la ponen sus dos hijos (el cliente y el botón), así también queda
  // bien en las OTRAS listas que comparten `sugerencia` —las sugerencias de
  // dirección de Google—, que no van envueltas en esta fila.
  sugerenciaFilaExterna: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  sugerenciaInfo: { flex: 1 },
  sugerencia: {
    paddingHorizontal: espaciado.md,
    paddingVertical: espaciado.md,
    borderBottomWidth: 1,
    borderBottomColor: t.colores.panelOscuro,
    minHeight: 60,
    justifyContent: 'center',
    gap: 2,
  },
  sugerenciaTocada: { backgroundColor: t.colores.panelClaro },
  aLista: {
    width: 66,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    borderLeftWidth: 1,
    borderLeftColor: t.colores.panelOscuro,
    // Para que la línea divisoria cruce toda la fila, no sólo la parte del
    // cliente (el botón es el otro hijo de `sugerenciaFilaExterna`).
    borderBottomWidth: 1,
    borderBottomColor: t.colores.panelOscuro,
  },
  aListaIcono: { fontSize: t.tipografia.tamano.base },
  aListaTexto: {
    fontFamily: t.tipografia.familia.subtitulo,
    fontSize: t.tipografia.tamano.micro,
    color: t.colores.rojo,
    letterSpacing: 0.5,
  },
  sugerenciaFila: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaciado.sm,
    flexWrap: 'wrap',
  },
  sugerenciaCodigo: {
    fontFamily: t.tipografia.familia.subtitulo,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.rojo,
  },
  sugerenciaPrincipal: {
    fontFamily: t.tipografia.familia.fuerte,
    fontSize: t.tipografia.tamano.sm,
    color: t.colores.tinta,
  },
  sugerenciaSecundaria: {
    fontFamily: t.tipografia.familia.liviana,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.tintaSuave,
  },

  // La nota que explica la pastilla SIN UBICAR de la lista de resultados.
  // Va suelta debajo del recuadro, no adentro: es sobre la lista entera.
  notaLista: {
    fontFamily: t.tipografia.familia.cuerpo,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.tintaSuave,
    marginTop: -espaciado.xs,
  },

  fichaCliente: {
    backgroundColor: t.colores.campoBlanco,
    borderWidth: 2,
    borderColor: t.colores.borde,
    borderRadius: radios.sm,
    padding: espaciado.md,
    gap: 3,
  },
  // El título y la pastilla SIN UBICAR en un renglón. Envuelve porque en los
  // teléfonos angostos "UBICACIÓN DEL CLIENTE" más la pastilla no entran.
  fichaEncabezado: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaciado.sm,
    flexWrap: 'wrap',
  },

  /*
   * El borde dejó de ser rojo.
   *
   * Era rojo —y había un `ubicarCorreccion` que lo volvía neutro para la
   * corrección— porque ubicar al cliente era lo que faltaba para poder seguir:
   * una alarma. Ya no falta nada, el destino entra igual, así que el bloque es
   * una opción más del panel y se viste como tal. Lo rojo, la pastilla SIN
   * UBICAR, queda donde sí dice algo: en la lista y en la ficha.
   */
  ubicar: {
    backgroundColor: t.colores.panelClaro,
    borderWidth: 2,
    borderColor: t.colores.borde,
    borderRadius: radios.sm,
    padding: espaciado.md,
    gap: espaciado.sm,
  },
  ubicarAyuda: {
    fontFamily: t.tipografia.familia.cuerpo,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.tintaSuave,
  },

  corregir: {
    paddingVertical: espaciado.sm,
    paddingHorizontal: espaciado.md,
    borderWidth: 1,
    borderColor: t.colores.panelOscuro,
    borderRadius: radios.sm,
    alignItems: 'center',
  },
  corregirTexto: {
    fontFamily: t.tipografia.familia.cuerpo,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.tintaSuave,
  },
  cancelar: {
    fontFamily: t.tipografia.familia.cuerpo,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.tintaSuave,
    textAlign: 'center',
    textDecorationLine: 'underline',
    paddingVertical: espaciado.xs,
  },
  fichaTitulo: {
    fontFamily: t.tipografia.familia.subtitulo,
    fontSize: t.tipografia.tamano.micro,
    color: t.colores.rojo,
    letterSpacing: 0.8,
  },
  fichaDireccion: {
    fontFamily: t.tipografia.familia.cuerpo,
    fontSize: t.tipografia.tamano.sm,
    color: t.colores.tinta,
  },
  fichaDato: {
    fontFamily: t.tipografia.familia.liviana,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.tintaSuave,
  },
}))
