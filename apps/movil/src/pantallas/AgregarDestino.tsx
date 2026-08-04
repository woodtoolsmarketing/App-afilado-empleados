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
import { asegurarJornadaDeHoy } from '../servicios/jornada'
import {
  agregarDestinoClienteNuevo,
  agregarDestinoExistente,
  buscarClientes,
} from '../servicios/clientes'
import { detallarDireccion, sugerirDirecciones, type SugerenciaDireccion } from '../servicios/mapas'
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
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Una sola búsqueda alimenta los dos campos: la función `buscar_clientes` de
  // Postgres mira código y razón social a la vez.
  useEffect(() => {
    if (temporizador.current) clearTimeout(temporizador.current)

    if (consulta.trim().length < 2) {
      setResultados([])
      return
    }

    temporizador.current = setTimeout(async () => {
      setBuscando(true)
      try {
        setResultados(await buscarClientes(consulta))
      } catch {
        setResultados([])
      } finally {
        setBuscando(false)
      }
    }, 300)

    return () => {
      if (temporizador.current) clearTimeout(temporizador.current)
    }
  }, [consulta])

  function actualizar(cambios: Partial<FormularioDestinoExistente>) {
    const nuevo = { ...form, ...cambios }
    setForm(nuevo)
    if (intentado) setErrores(validarDestinoExistente(nuevo).errores)
  }

  /** Al tipear en cualquiera de los dos campos se invalida la selección previa. */
  function alTipear(campo: 'codigo' | 'razon_social', texto: string) {
    setConsulta(texto)
    actualizar({ [campo]: texto, cliente: null } as Partial<FormularioDestinoExistente>)
  }

  function elegirCliente(c: ClienteBuscado) {
    setResultados([])
    setConsulta('')
    // Acá está el "que uno complete al otro": se llenan los dos campos.
    actualizar({ codigo: c.codigo, razon_social: c.razon_social, cliente: c })
  }

  const guardar = useMutation({
    mutationFn: async () => {
      if (!perfil) throw new Error('No hay sesión')
      const jornada = await asegurarJornadaDeHoy(perfil.id)
      return agregarDestinoExistente({
        rolVisitaId: jornada.id,
        cliente: form.cliente!,
        prioridad: form.prioridad!,
      })
    },
    onSuccess: async (parada) => {
      await cliente.invalidateQueries()
      Alert.alert(
        'Destino agregado',
        form.prioridad === 'alta'
          ? `${form.razon_social} queda como próximo destino (Nº ${parada.orden}).`
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
            accesorio={buscando ? <ActivityIndicator size="small" color={colores.rojo} /> : undefined}
          />

          <Text style={estilos.separadorO}>— o —</Text>

          <Campo
            etiqueta="NOMBRE O RAZÓN SOCIAL"
            value={form.razon_social}
            onChangeText={(t) => alTipear('razon_social', t)}
            placeholder="Ej. Maderera del Oeste"
            autoCapitalize="words"
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
                    {!c.direccion_id ? <Pastilla texto="SIN DIRECCIÓN" color={colores.rojoAccion} /> : null}
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

          {consulta.trim().length >= 2 && !buscando && resultados.length === 0 ? (
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

          <Desplegable<PrioridadParada>
            etiqueta="PRIORIDAD"
            obligatorio
            marcador="Elegí la prioridad"
            valor={form.prioridad}
            items={ITEMS_PRIORIDAD}
            alCambiar={(v) => actualizar({ prioridad: v })}
            error={errores.prioridad}
          />

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

  function actualizar(cambios: Partial<FormularioDestinoNuevo>) {
    const nuevo = { ...form, ...cambios }
    setForm(nuevo)
    if (intentado) setErrores(validarDestinoNuevo(nuevo).errores)
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
      const jornada = await asegurarJornadaDeHoy(perfil.id)
      return agregarDestinoClienteNuevo({ rolVisitaId: jornada.id, form })
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

          <Desplegable<PrioridadParada>
            etiqueta="PRIORIDAD"
            obligatorio
            marcador="Elegí la prioridad"
            valor={form.prioridad}
            items={ITEMS_PRIORIDAD}
            alCambiar={(v) => actualizar({ prioridad: v })}
            error={errores.prioridad}
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
