import {
  colores,
  DESCRIPCION_PRIORIDAD,
  espaciado,
  ETIQUETA_PRIORIDAD,
  FORMULARIO_DESTINO_EXISTENTE_VACIO,
  FORMULARIO_DESTINO_NUEVO_VACIO,
  radios,
  tipografia,
  validarDestinoExistente,
  validarDestinoNuevo,
  type CampoDestinoExistente,
  type CampoDestinoNuevo,
  type ClienteBuscado,
  type FormularioDestinoExistente,
  type FormularioDestinoNuevo,
  type PrioridadParada,
} from '@woodtools/compartido'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import * as Crypto from 'expo-crypto'
import { useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'

import { BotonMenu } from '../componentes/Botones'
import { Campo, Desplegable } from '../componentes/Formulario'
import { Aviso, Pastilla } from '../componentes/Estado'
import { Encabezado } from '../componentes/Encabezado'
import { BarraPanel, Pantalla, Panel, TituloPanel } from '../componentes/Pantalla'
import { usarSesion } from '../nucleo/sesion'
import { asegurarJornadaDe, asegurarJornadaDeHoy } from '../servicios/jornada'
import {
  agregarDestinoClienteNuevo,
  agregarDestinoExistente,
  buscarClientes,
  ESPERA_TECLEO,
  ubicarCliente,
} from '../servicios/clientes'
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
        alAbrirMenu={() => navigation.navigate('Configuracion')}
      />
    )
  }

  return modo === 'existente' ? (
    <FormularioExistente navigation={navigation} route={route} />
  ) : (
    <FormularioNuevo navigation={navigation} route={route} />
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 1 — elegir el camino
// ─────────────────────────────────────────────────────────────────────────────

function Selector({
  alElegir,
  alVolver,
  alAbrirMenu,
}: {
  alElegir: (modo: 'existente' | 'nuevo') => void
  alVolver: () => void
  alAbrirMenu: () => void
}) {
  return (
    <Pantalla>
      <Encabezado alAbrirMenu={alAbrirMenu} />
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

function FormularioExistente({ navigation, route }: PropsPantalla<'AgregarDestino'>) {
  const perfil = usarSesion((s) => s.perfil)
  const cliente = useQueryClient()

  const [form, setForm] = useState<FormularioDestinoExistente>(FORMULARIO_DESTINO_EXISTENTE_VACIO)
  const [errores, setErrores] = useState<Partial<Record<CampoDestinoExistente, string>>>({})
  const [intentado, setIntentado] = useState(false)

  const [consulta, setConsulta] = useState('')
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
      if (intentado) setErrores(validarDestinoExistente(nuevo).errores)
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

  const guardar = useMutation({
    mutationFn: async () => {
      if (!perfil) throw new Error('No hay sesión')
      // Con fecha, el destino entra en la jornada de ESE día: es una visita
      // agendada, no una del recorrido de hoy.
      const jornada = route.params?.fecha
        ? await asegurarJornadaDe(perfil.id, route.params.fecha)
        : await asegurarJornadaDeHoy(perfil.id)
      return agregarDestinoExistente({
        rolVisitaId: jornada.id,
        cliente: form.cliente!,
        // Sin coordenadas del cliente no hay con qué medir: entra al recorrido
        // como uno más y la optimización lo ubica. (Igual no llegaría acá: el
        // alta rechaza a los clientes sin ubicar.)
        prioridad:
          form.cliente!.lat !== null && form.cliente!.lng !== null
            ? await prioridadPorCercania(form.cliente!.lat, form.cliente!.lng)
            : 'baja',
      })
    },
    onSuccess: async (parada) => {
      await cliente.invalidateQueries()
      Alert.alert(
        'Destino agregado',
        parada.prioridad === 'alta'
          ? `${form.razon_social} queda como próximo destino (Nº ${parada.orden}): estás cerca.`
          : `${form.razon_social} se agregó al recorrido en la posición Nº ${parada.orden}.`,
        [{ text: 'Listo', onPress: () => navigation.navigate(route.params?.volverA ?? 'Recorrido') }],
      )
    },
    onError: (e: Error) => Alert.alert('No pudimos agregar el destino', e.message),
  })

  function alAgregar() {
    setIntentado(true)
    const { valido, errores: nuevos } = validarDestinoExistente(form)
    setErrores(nuevos)
    if (valido) guardar.mutate()
  }

  return (
    <Pantalla>
      <Encabezado alAbrirMenu={() => navigation.navigate('Configuracion')} />

      <KeyboardAvoidingView
        style={estilos.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Panel contentStyle={estilos.contenido}>
          <BarraPanel alVolver={() => navigation.setParams({ modo: undefined })} />

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
                <Pressable
                  key={c.cliente_id}
                  onPress={() => elegirCliente(c)}
                  accessibilityRole="button"
                  accessibilityLabel={`${c.codigo}, ${c.razon_social}`}
                  style={({ pressed }) => [estilos.sugerencia, pressed && estilos.sugerenciaTocada]}
                >
                  <View style={estilos.sugerenciaFila}>
                    <Text style={estilos.sugerenciaCodigo}>{c.codigo}</Text>
                    {c.provisorio ? <Pastilla texto="PROVISORIO" color={colores.ambarOscuro} /> : null}
                    {/*
                      Antes decía "SIN DIRECCIÓN" y quedaba justo arriba de la
                      dirección del cliente, que sí estaba escrita. Lo que falta
                      no es el domicilio: son las coordenadas.
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
                </Pressable>
              ))}
            </View>
          ) : null}

          {/* La búsqueda falló: no sabemos si el cliente existe o no. */}
          {falloBusqueda && !buscando ? (
            <Aviso tono="atencion" titulo="No pudimos buscar">
              {falloBusqueda}
              {'\n\n'}Revisá la señal y escribí de nuevo. No lo cargues como cliente nuevo hasta
              poder buscarlo: si ya existe, quedarían dos fichas del mismo taller.
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
            </Aviso>
          ) : null}

          {/* La ubicación se completa sola desde la ficha del cliente. */}
          {form.cliente ? (
            <View style={estilos.fichaCliente}>
              <Text style={estilos.fichaTitulo}>UBICACIÓN DEL CLIENTE</Text>
              <Text style={estilos.fichaDireccion}>
                {form.cliente.direccion ?? 'Sin dirección cargada'}
              </Text>
              {form.cliente.codigo_postal ? (
                <Text style={estilos.fichaDato}>CP {form.cliente.codigo_postal}</Text>
              ) : null}
              {form.cliente.contacto_nombre ? (
                <Text style={estilos.fichaDato}>Contacto: {form.cliente.contacto_nombre}</Text>
              ) : null}
            </View>
          ) : null}

          {/*
            Dos situaciones, un mismo componente. O el cliente nunca se ubicó
            —el padrón del Gestión trae el domicilio en texto y sin
            coordenadas— o la ficha dice una cosa y el local está en otra. El
            que sabe cuál de las dos es, es el que está parado en la puerta.
          */}
          {form.cliente ? (
            <UbicarCliente
              cliente={form.cliente}
              alUbicar={(ubicada) =>
                actualizar({
                  cliente: {
                    ...form.cliente!,
                    direccion_id: ubicada.direccion_id,
                    direccion: ubicada.direccion_formateada,
                    codigo_postal: ubicada.codigo_postal ?? form.cliente!.codigo_postal,
                    lat: ubicada.lat,
                    lng: ubicada.lng,
                    localidad: ubicada.localidad ?? form.cliente!.localidad,
                  },
                })
              }
            />
          ) : null}


          <BotonMenu
            titulo={'AGREGAR AL\nRECORRIDO'}
            alTocar={alAgregar}
            cargando={guardar.isPending}
          />
        </Panel>
      </KeyboardAvoidingView>
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
 * queda este cliente?"— y que para la app eran mundos distintos:
 *
 *  · **Nunca se ubicó.** Es el caso de los que vinieron del Gestión: calle,
 *    localidad y CP en texto, cero coordenadas. Como el recorrido se arma sobre
 *    `direcciones`, y esa tabla exige lat/lng porque alimenta el mapa y el
 *    optimizador, sin este paso no podían ser un destino. El bloque arranca
 *    abierto y en rojo, porque hasta que no se resuelva no se puede seguir.
 *
 *  · **Está ubicado pero mal.** La ficha dice una cosa y el local está en otra.
 *    Acá el bloque arranca cerrado: es una corrección, no un trámite, y no tiene
 *    por qué estorbar al que sólo quiere agregar el destino y seguir.
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
}: {
  cliente: ClienteBuscado
  alUbicar: (ubicada: ClienteUbicado) => void
}) {
  const faltaUbicar = cliente.lat === null

  // Si falta, no hay nada que decidir: se abre solo. Si ya está ubicado, el
  // vendedor tiene que pedir corregirlo.
  const [abierto, setAbierto] = useState(faltaUbicar)

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

  /** Guarda la dirección resuelta, venga del buscador o del GPS. */
  async function guardarUbicacion(d: DireccionResuelta): Promise<ClienteUbicado> {
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

  function alGuardar(ubicada: ClienteUbicado) {
    setSugerencias([])
    setConfirmada(ubicada.direccion_formateada)
    alUbicar(ubicada)
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
      <Aviso tono="exito" titulo="Ubicación guardada">
        {confirmada}
        {'\n\n'}Queda en la ficha del cliente: la próxima vez ya va a estar.
      </Aviso>
    )
  }

  // Ya ubicado y sin pedido de corregir: sólo el acceso, sin ocupar pantalla.
  if (!abierto) {
    return (
      <Pressable
        onPress={() => {
          setAbierto(true)
          setActiva(false)
        }}
        accessibilityRole="button"
        accessibilityLabel="Corregir la ubicación de este cliente"
        style={({ pressed }) => [estilos.corregir, pressed && estilos.sugerenciaTocada]}
      >
        <Text style={estilos.corregirTexto}>¿La dirección está mal? CORREGIR UBICACIÓN</Text>
      </Pressable>
    )
  }

  return (
    <View style={[estilos.ubicar, !faltaUbicar && estilos.ubicarCorreccion]}>
      <Text style={estilos.fichaTitulo}>
        {faltaUbicar ? 'FALTA UBICARLO EN EL MAPA' : 'CORREGIR LA UBICACIÓN'}
      </Text>
      <Text style={estilos.ubicarAyuda}>
        {faltaUbicar
          ? 'Este cliente tiene el domicilio escrito pero nunca se lo marcó en el mapa, y sin eso no entra al recorrido.'
          : 'Lo que cargues acá reemplaza la dirección que tiene hoy, para todos.'}
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

      {!faltaUbicar ? (
        <Pressable onPress={() => setAbierto(false)} accessibilityRole="button">
          <Text style={estilos.cancelar}>Dejarla como está</Text>
        </Pressable>
      ) : null}
    </View>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Cliente nuevo
// ─────────────────────────────────────────────────────────────────────────────

function FormularioNuevo({ navigation, route }: PropsPantalla<'AgregarDestino'>) {
  const perfil = usarSesion((s) => s.perfil)
  const cliente = useQueryClient()

  const [form, setForm] = useState<FormularioDestinoNuevo>(FORMULARIO_DESTINO_NUEVO_VACIO)
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
        form: { ...form, prioridad: await prioridadPorCercania(form.lat!, form.lng!) },
      })
    },
    onSuccess: async (parada) => {
      await cliente.invalidateQueries()
      Alert.alert(
        'Cliente y destino creados',
        `${form.razon_social} quedó en la posición Nº ${parada.orden}.\n\nSe cargó como cliente provisorio: la oficina le va a completar el código y los datos que falten.`,
        [{ text: 'Listo', onPress: () => navigation.navigate(route.params?.volverA ?? 'Recorrido') }],
      )
    },
    onError: (e: Error) => Alert.alert('No pudimos crear el cliente', e.message),
  })

  function alAgregar() {
    setIntentado(true)
    const { valido, errores: nuevos } = validarDestinoNuevo(form)
    setErrores(nuevos)
    if (valido) guardar.mutate()
  }

  return (
    <Pantalla>
      <Encabezado alAbrirMenu={() => navigation.navigate('Configuracion')} />

      <KeyboardAvoidingView
        style={estilos.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Panel contentStyle={estilos.contenido}>
          <BarraPanel alVolver={() => navigation.setParams({ modo: undefined })} />

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
          />
        </Panel>
      </KeyboardAvoidingView>
    </Pantalla>
  )
}

const ITEMS_PRIORIDAD = (['alta', 'media', 'baja'] as const).map((p) => ({
  valor: p,
  etiqueta: ETIQUETA_PRIORIDAD[p],
  descripcion: DESCRIPCION_PRIORIDAD[p],
}))

const estilos = StyleSheet.create({
  flex: { flex: 1 },
  contenido: { gap: espaciado.md },
  campoCorto: { maxWidth: 220 },

  pregunta: {
    fontFamily: tipografia.familia.cuerpo,
    fontSize: tipografia.tamano.base,
    color: colores.tintaSuave,
    textAlign: 'center',
    marginBottom: espaciado.xs,
  },

  separadorO: {
    fontFamily: tipografia.familia.cuerpo,
    fontSize: tipografia.tamano.sm,
    color: colores.tintaTenue,
    textAlign: 'center',
    marginVertical: -espaciado.xs,
  },

  sugerencias: {
    borderWidth: 2,
    borderColor: colores.negro,
    borderRadius: radios.sm,
    backgroundColor: colores.campoBlanco,
    overflow: 'hidden',
  },
  sugerencia: {
    paddingHorizontal: espaciado.md,
    paddingVertical: espaciado.md,
    borderBottomWidth: 1,
    borderBottomColor: colores.panelOscuro,
    minHeight: 60,
    justifyContent: 'center',
    gap: 2,
  },
  sugerenciaTocada: { backgroundColor: colores.panelClaro },
  sugerenciaFila: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaciado.sm,
    flexWrap: 'wrap',
  },
  sugerenciaCodigo: {
    fontFamily: tipografia.familia.subtitulo,
    fontSize: tipografia.tamano.xs,
    color: colores.rojo,
  },
  sugerenciaPrincipal: {
    fontFamily: tipografia.familia.fuerte,
    fontSize: tipografia.tamano.sm,
    color: colores.tinta,
  },
  sugerenciaSecundaria: {
    fontFamily: tipografia.familia.liviana,
    fontSize: tipografia.tamano.xs,
    color: colores.tintaSuave,
  },

  fichaCliente: {
    backgroundColor: colores.campoBlanco,
    borderWidth: 2,
    borderColor: colores.negro,
    borderRadius: radios.sm,
    padding: espaciado.md,
    gap: 3,
  },

  ubicar: {
    backgroundColor: colores.panelClaro,
    borderWidth: 2,
    borderColor: colores.rojoAccion,
    borderRadius: radios.sm,
    padding: espaciado.md,
    gap: espaciado.sm,
  },
  // La corrección de algo que ya está bien no tiene por qué gritar como la
  // falta de algo imprescindible: mismo bloque, borde neutro.
  ubicarCorreccion: { borderColor: colores.negro },
  ubicarAyuda: {
    fontFamily: tipografia.familia.cuerpo,
    fontSize: tipografia.tamano.xs,
    color: colores.tintaSuave,
  },

  corregir: {
    paddingVertical: espaciado.sm,
    paddingHorizontal: espaciado.md,
    borderWidth: 1,
    borderColor: colores.panelOscuro,
    borderRadius: radios.sm,
    alignItems: 'center',
  },
  corregirTexto: {
    fontFamily: tipografia.familia.cuerpo,
    fontSize: tipografia.tamano.xs,
    color: colores.tintaSuave,
  },
  cancelar: {
    fontFamily: tipografia.familia.cuerpo,
    fontSize: tipografia.tamano.xs,
    color: colores.tintaSuave,
    textAlign: 'center',
    textDecorationLine: 'underline',
    paddingVertical: espaciado.xs,
  },
  fichaTitulo: {
    fontFamily: tipografia.familia.subtitulo,
    fontSize: tipografia.tamano.micro,
    color: colores.rojo,
    letterSpacing: 0.8,
  },
  fichaDireccion: {
    fontFamily: tipografia.familia.cuerpo,
    fontSize: tipografia.tamano.sm,
    color: colores.tinta,
  },
  fichaDato: {
    fontFamily: tipografia.familia.liviana,
    fontSize: tipografia.tamano.xs,
    color: colores.tintaSuave,
  },
})
