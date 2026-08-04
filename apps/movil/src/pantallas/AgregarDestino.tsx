import {
  colores,
  DESCRIPCION_PRIORIDAD,
  espaciado,
  ETIQUETA_PRIORIDAD,
  FORMULARIO_DESTINO_VACIO,
  radios,
  tipografia,
  validarFormularioDestino,
  type CampoDestino,
  type FormularioDestino,
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
import { Aviso } from '../componentes/Estado'
import { Encabezado } from '../componentes/Encabezado'
import { BarraPanel, Pantalla, Panel, TituloPanel } from '../componentes/Pantalla'
import { supabase } from '../nucleo/supabase'
import { usarSesion } from '../nucleo/sesion'
import { agregarParada, asegurarJornadaDeHoy } from '../servicios/jornada'
import { detallarDireccion, sugerirDirecciones, type SugerenciaDireccion } from '../servicios/mapas'
import type { PropsPantalla } from '../navegacion/tipos'

/**
 * "AGREGAR NUEVO DESTINO"
 *
 * La dirección se elige de las sugerencias de Google Places: al seleccionarla
 * se completa solo el código postal y quedan guardadas las coordenadas. Escribir
 * la dirección a mano no alcanza — sin coordenadas no se puede trazar la ruta,
 * y el formulario lo bloquea.
 *
 * La prioridad define dónde entra el destino en el recorrido; la lógica vive en
 * la función `agregar_parada` de Postgres.
 */
export function PantallaAgregarDestino({ navigation, route }: PropsPantalla<'AgregarDestino'>) {
  const perfil = usarSesion((s) => s.perfil)
  const cliente = useQueryClient()

  const [form, setForm] = useState<FormularioDestino>(FORMULARIO_DESTINO_VACIO)
  const [errores, setErrores] = useState<Partial<Record<CampoDestino, string>>>({})
  const [intentado, setIntentado] = useState(false)

  const [texto, setTexto] = useState('')
  const [sugerencias, setSugerencias] = useState<SugerenciaDireccion[]>([])
  const [buscando, setBuscando] = useState(false)
  const [elegida, setElegida] = useState(false)

  // Un token de sesión por búsqueda: Google cobra el autocompletado y el
  // detalle como una sola operación si comparten token.
  const sesion = useRef(Crypto.randomUUID())
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Autocompletado con retardo ─────────────────────────────────────────────
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

  async function elegirSugerencia(s: SugerenciaDireccion) {
    setElegida(true)
    setSugerencias([])
    setTexto(s.texto)
    setBuscando(true)

    try {
      const d = await detallarDireccion(s.place_id, sesion.current)
      // Nuevo token: la sesión de Places terminó con este detalle.
      sesion.current = Crypto.randomUUID()

      const nuevo: FormularioDestino = {
        ...form,
        direccion_formateada: d.direccion_formateada,
        codigo_postal: d.codigo_postal ?? '',
        lat: d.lat,
        lng: d.lng,
        google_place_id: d.google_place_id,
        localidad: d.localidad,
        provincia: d.provincia,
      }
      setForm(nuevo)
      if (intentado) setErrores(validarFormularioDestino(nuevo).errores)
    } catch (e) {
      Alert.alert('No pudimos leer esa dirección', (e as Error).message)
      setElegida(false)
    } finally {
      setBuscando(false)
    }
  }

  function actualizar(cambios: Partial<FormularioDestino>) {
    const nuevo = { ...form, ...cambios }
    setForm(nuevo)
    if (intentado) setErrores(validarFormularioDestino(nuevo).errores)
  }

  const guardar = useMutation({
    mutationFn: async () => {
      if (!perfil) throw new Error('No hay sesión')

      const jornada = await asegurarJornadaDeHoy(perfil.id)

      const { data: direccion, error } = await supabase
        .from('direcciones')
        .insert({
          direccion_formateada: form.direccion_formateada,
          codigo_postal: form.codigo_postal,
          localidad: form.localidad,
          provincia: form.provincia,
          lat: form.lat,
          lng: form.lng,
          google_place_id: form.google_place_id,
          verificada: true,
          etiqueta: 'Destino agregado en ruta',
        })
        .select('id')
        .single()

      if (error) throw error

      return agregarParada({
        rolVisitaId: jornada.id,
        direccionId: direccion.id,
        prioridad: form.prioridad!,
      })
    },
    onSuccess: async (parada) => {
      await cliente.invalidateQueries()
      Alert.alert(
        'Destino agregado',
        form.prioridad === 'alta'
          ? `Queda como próximo destino (Nº ${parada.orden}).`
          : `Se agregó al recorrido en la posición Nº ${parada.orden}.`,
        [{ text: 'Listo', onPress: () => navigation.navigate(route.params?.volverA ?? 'Recorrido') }],
      )
    },
    onError: (e: Error) => Alert.alert('No pudimos agregar el destino', e.message),
  })

  function alAgregar() {
    setIntentado(true)
    const { valido, errores: nuevos } = validarFormularioDestino(form)
    setErrores(nuevos)
    if (!valido) return
    guardar.mutate()
  }

  return (
    <Pantalla>
      <Encabezado alAbrirMenu={() => navigation.navigate('Configuracion')} />

      <KeyboardAvoidingView
        style={estilos.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Panel contentStyle={estilos.contenido}>
          <BarraPanel alVolver={() => navigation.goBack()} />

          <TituloPanel>{'AGREGAR NUEVO\nDESTINO'}</TituloPanel>

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
            keyboardType="default"
            autoCapitalize="characters"
            maxLength={8}
            contenedorStyle={estilos.campoCorto}
            ayuda={form.lat !== null ? 'Lo completó Google. Podés corregirlo si hace falta.' : undefined}
          />

          <Desplegable<PrioridadParada>
            etiqueta="PRIORIDAD"
            obligatorio
            marcador="Elegí la prioridad"
            valor={form.prioridad}
            items={(['alta', 'media', 'baja'] as const).map((p) => ({
              valor: p,
              etiqueta: ETIQUETA_PRIORIDAD[p],
              descripcion: DESCRIPCION_PRIORIDAD[p],
            }))}
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

const estilos = StyleSheet.create({
  flex: { flex: 1 },
  contenido: { gap: espaciado.md },
  campoCorto: { maxWidth: 200 },

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
  },
  sugerenciaTocada: { backgroundColor: colores.panelClaro },
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
})
