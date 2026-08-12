import {
  colores,
  espaciado,
  ETIQUETA_MOTIVO_NO_VISITA,
  FORMULARIO_VISITA_VACIO,
  radios,
  tipografia,
  validarFormularioVisita,
  type CampoVisita,
  type FormularioVisita,
  type MotivoNoVisita,
} from '@woodtools/compartido'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
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

import { BotonMenu, BotonesSiNo } from '../componentes/Botones'
import { Campo, Casilla, Desplegable, MensajeError } from '../componentes/Formulario'
import { Aviso, Cargando } from '../componentes/Estado'
import { Encabezado } from '../componentes/Encabezado'
import { BarraPanel, Pantalla, Panel, TituloPanel } from '../componentes/Pantalla'
import { usarSesion } from '../nucleo/sesion'
import { finalizarRecorrido, obtenerJornadaDeHoy, registrarVisita } from '../servicios/jornada'
import { navegarHacia } from '../servicios/mapas'
import { detenerSeguimiento, ubicacionActual } from '../servicios/ubicacion'
import { usarDictado, DURACION_MAXIMA_MS } from '../servicios/transcripcion'
import type { PropsPantalla } from '../navegacion/tipos'

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
export function PantallaDestinoVisitado({ navigation, route }: PropsPantalla<'DestinoVisitado'>) {
  const { paradaId } = route.params
  const perfil = usarSesion((s) => s.perfil)
  const cliente = useQueryClient()
  const dictado = usarDictado()

  const [form, setForm] = useState<FormularioVisita>(FORMULARIO_VISITA_VACIO)
  const [errores, setErrores] = useState<Partial<Record<CampoVisita, string>>>({})
  const [intentado, setIntentado] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['jornada-hoy', perfil?.id],
    queryFn: () => obtenerJornadaDeHoy(perfil!.id),
    enabled: !!perfil,
  })

  const parada = data?.paradas.find((p) => p.id === paradaId)
  const restantes = useMemo(
    () =>
      (data?.paradas ?? []).filter(
        (p) => p.id !== paradaId && (p.estado === 'pendiente' || p.estado === 'en_camino'),
      ),
    [data, paradaId],
  )
  const esUltima = restantes.length === 0
  const siguiente = restantes[0]

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
      await cliente.invalidateQueries()

      if (esUltima) {
        Alert.alert(
          'Visita registrada',
          'Era tu último destino del día. ¿Cerramos la jornada?\n\nUna vez cerrada no se le pueden agregar más destinos.',
          [
            {
              text: 'Seguir abierta',
              style: 'cancel',
              onPress: () => navigation.navigate('Visitas'),
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
        { text: 'Ver recorrido', onPress: () => navigation.navigate('Recorrido') },
        {
          text: 'Navegar',
          onPress: () => {
            navigation.navigate('Recorrido')
            if (siguiente) {
              void navegarHacia({
                lat: siguiente.direccion.lat,
                lng: siguiente.direccion.lng,
              }).catch(() => undefined)
            }
          },
        },
      ])
    },
    onError: (e: Error) => Alert.alert('No pudimos guardar la visita', e.message),
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
        await detenerSeguimiento(perfil?.id).catch(() => undefined)
      }
    },
    onSuccess: async () => {
      await cliente.invalidateQueries()
      Alert.alert('Recorrido finalizado', 'Cerraste la jornada de hoy. Buen trabajo.')
      navigation.navigate('Visitas')
    },
    onError: (e: Error) => {
      Alert.alert(
        'No pudimos cerrar la jornada',
        `${e.message}\n\nEl seguimiento ya se apagó. La visita quedó registrada; cerrá la jornada desde VER RECORRIDO cuando tengas señal.`,
      )
      navigation.navigate('Visitas')
    },
  })

  function alGuardar() {
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
        <Encabezado alAbrirMenu={() => navigation.navigate('Configuracion')} />
        <Panel>
          <Cargando />
        </Panel>
      </Pantalla>
    )
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

          <TituloPanel>¿DESTINO VISITADO?</TituloPanel>

          {parada ? (
            <View style={estilos.ficha}>
              <Text style={estilos.fichaCliente}>
                {parada.orden}. {parada.cliente?.razon_social ?? parada.razon_social_snapshot}
              </Text>
              <Text style={estilos.fichaDireccion}>{parada.direccion.direccion_formateada}</Text>
              {parada.cliente?.codigo ? (
                <Text style={estilos.fichaCodigo}>Cliente Nº {parada.cliente.codigo}</Text>
              ) : null}
            </View>
          ) : null}

          <BotonesSiNo
            valor={form.visitado}
            alCambiar={(v) =>
              actualizar({
                visitado: v,
                // Cambiar de respuesta limpia lo que ya no aplica.
                ...(v
                  ? { motivo_no_visita: null }
                  : { vendio: false, cobro: false, retiro_afilado: false, entrego: false }),
              })
            }
            error={!!errores.visitado}
          />
          <MensajeError>{errores.visitado}</MensajeError>

          {/* ── SÍ: tipo de visita ─────────────────────────────────────────── */}
          {form.visitado === true ? (
            <View style={estilos.bloque}>
              <Text style={estilos.bloqueTitulo}>TIPO DE VISITA</Text>

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

              <MensajeError>{errores.tipo_visita}</MensajeError>

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
                ]}
                alCambiar={(v) => actualizar({ motivo_no_visita: v })}
                error={errores.motivo_no_visita}
              />
            </View>
          ) : null}

          {/* ── Observación ────────────────────────────────────────────────── */}
          <View style={estilos.bloque}>
            <Text style={estilos.bloqueTitulo}>OBSERVACIÓN</Text>

            <Campo
              value={form.observacion}
              onChangeText={(t) => actualizar({ observacion: t })}
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
                : `Quedan ${restantes.length} destino${restantes.length === 1 ? '' : 's'}`
            }
            alTocar={alGuardar}
            cargando={guardar.isPending}
          />
        </Panel>
      </KeyboardAvoidingView>
    </Pantalla>
  )
}

function nombreDe(parada?: { cliente?: { razon_social: string } | null; razon_social_snapshot?: string | null }) {
  return parada?.cliente?.razon_social ?? parada?.razon_social_snapshot ?? 'el siguiente destino'
}

const estilos = StyleSheet.create({
  flex: { flex: 1 },
  contenido: { gap: espaciado.md },

  ficha: {
    backgroundColor: colores.campoBlanco,
    borderWidth: 2,
    borderColor: colores.negro,
    borderRadius: radios.sm,
    padding: espaciado.md,
    gap: 2,
  },
  fichaCliente: {
    fontFamily: tipografia.familia.subtitulo,
    fontSize: tipografia.tamano.base,
    color: colores.tinta,
  },
  fichaDireccion: {
    fontFamily: tipografia.familia.cuerpo,
    fontSize: tipografia.tamano.xs,
    color: colores.tintaSuave,
  },
  fichaCodigo: {
    fontFamily: tipografia.familia.liviana,
    fontSize: tipografia.tamano.micro,
    color: colores.tintaTenue,
  },

  bloque: { gap: espaciado.sm },
  bloqueTitulo: {
    fontFamily: tipografia.familia.subtitulo,
    fontSize: tipografia.tamano.base,
    color: colores.tinta,
    letterSpacing: 0.8,
  },

  microfono: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: colores.rojo,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colores.negro,
  },
  microfonoActivo: { backgroundColor: colores.rojoAccion },
  microfonoPresionado: { opacity: 0.75 },
  microfonoIcono: { fontSize: 20 },
})
