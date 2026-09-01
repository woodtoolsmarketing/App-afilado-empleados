import {
  espaciado,
  ETIQUETA_MOTIVO_NO_VISITA,
  observacionSugerida,
  FORMULARIO_VISITA_VACIO,
  radios,
  validarFormularioVisita,
  type CampoVisita,
  type FormularioVisita,
  type MotivoNoVisita,
  todaviaNoLeToca,
} from '@woodtools/compartido'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  View,
} from 'react-native'

import { BotonMenu, BotonesSiNo, BotonSecundario } from '../componentes/Botones'
import { Campo, Casilla, Desplegable, MensajeError } from '../componentes/Formulario'
import { Aviso, Cargando } from '../componentes/Estado'
import { Encabezado } from '../componentes/Encabezado'
import { BarraPanel, Pantalla, Panel, TituloPanel } from '../componentes/Pantalla'
import { usarSesion } from '../nucleo/sesion'
import { finalizarRecorrido, obtenerJornadaDeHoy, registrarVisita } from '../servicios/jornada'
import {
  guardarBorradorDeVisita,
  olvidarBorradorDeVisita,
  tomarBorradorDeVisita,
} from '../servicios/borradorDeVisita'
import { resumenDeNotasDeLaParada } from '../servicios/notasPedido'
import { navegarHacia } from '../servicios/mapas'
import { detenerSeguimiento, ubicacionActual } from '../servicios/ubicacion'
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

export function PantallaDestinoVisitado({ navigation, route }: PropsPantalla<'DestinoVisitado'>) {
  const { colores } = usarTema()
  const estilos = usarEstilos()
  const { paradaId } = route.params
  const perfil = usarSesion((s) => s.perfil)
  const cliente = useQueryClient()
  const dictado = usarDictado()

  // Si se fue a hacer la nota de pedido y volvió, lo cargado sigue estando.
  const recuperado = useRef(tomarBorradorDeVisita(paradaId)).current
  const [form, setForm] = useState<FormularioVisita>(recuperado?.form ?? FORMULARIO_VISITA_VACIO)
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
    form.motivo_no_visita,
    form.volver_a_las,
    form.contacto_nombre,
    resumenDeNotas,
  ])

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
      // Guardada de verdad: el borrador ya no tiene nada que recuperar.
      olvidarBorradorDeVisita(paradaId)
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
              alTocar={() => {
                guardarBorradorDeVisita(paradaId, form, escritaAMano.current)
                navigation.navigate('GenerarNota', { paradaId })
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
