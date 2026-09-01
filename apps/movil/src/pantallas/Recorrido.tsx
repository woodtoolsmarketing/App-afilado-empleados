import {
  distanciaEnMetros,
  espaciado,
  ETIQUETA_ESTADO_PARADA,
  ETIQUETA_PRIORIDAD,
  formatearDistancia,
  formatearDuracion,
  radios,
  todaviaNoLeToca,
  type EstadoParada,
  type Paleta,
  type ParadaCompleta,
} from '@woodtools/compartido'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, AppState, Pressable, Text, View } from 'react-native'
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
import { decodificarPolilinea, navegarHacia, optimizarRecorrido } from '../servicios/mapas'
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
  const [avisoRuta, setAvisoRuta] = useState<string | null>(null)
  const debeIniciar = route.params?.iniciar === true

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['jornada-hoy', perfil?.id],
    queryFn: () => obtenerJornadaDeHoy(perfil!.id),
    enabled: !!perfil,
  })

  const jornada = data?.jornada
  const paradas = useMemo(() => data?.paradas ?? [], [data])
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

  const ofrecerCargarLaVisita = useCallback(async () => {
    if (!proxima?.direccion || !enCurso) return
    if (yaPreguntado.current === proxima.id) return

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
    if (metros > radioDeLlegada) return

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

  useEffect(() => {
    void ofrecerCargarLaVisita()
    const sub = AppState.addEventListener('change', (estado) => {
      if (estado === 'active') void ofrecerCargarLaVisita()
    })
    return () => sub.remove()
  }, [ofrecerCargarLaVisita])

  const trazado = useMemo(
    () => (jornada?.polilinea ? decodificarPolilinea(jornada.polilinea) : []),
    [jornada?.polilinea],
  )

  // ── Iniciar recorrido ──────────────────────────────────────────────────────
  const arrancar = useMutation({
    mutationFn: async () => {
      if (!jornada || !perfil) throw new Error('Todavía no cargó la jornada')

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

      try {
        await optimizarRecorrido(jornada.id, { lat: pos.lat, lng: pos.lng })
      } catch {
        setAvisoRuta(
          'No pudimos consultar el tránsito de Google. El recorrido queda ordenado por cercanía.',
        )
      }
      await iniciarSeguimiento({ vendedorId: perfil.id, rolVisitaId: jornada.id })

      if (!permiso.segundoPlano) {
        setAvisoRuta(
          'Diste permiso de ubicación sólo con la app abierta. Si apagás la pantalla, la oficina va a dejar de verte.',
        )
      }
      return true
    },
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: ['jornada-hoy'] })
      void cliente.invalidateQueries({ queryKey: ['resumen-hoy'] })
    },
    onError: (e: Error) => Alert.alert('No pudimos iniciar el recorrido', e.message),
  })

  // Llegó desde "INICIAR RECORRIDO": arranca sin pedir un toque más.
  useEffect(() => {
    if (debeIniciar && jornada && !enCurso && !finalizada && !arrancar.isPending) {
      arrancar.mutate()
      navigation.setParams({ iniciar: false })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debeIniciar, jornada?.id, enCurso, finalizada])

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
    if (paradas.length === 0 || !mapa.current) return
    mapa.current.fitToCoordinates(
      paradas.map((p) => ({ latitude: p.direccion.lat, longitude: p.direccion.lng })),
      { edgePadding: { top: 60, right: 60, bottom: 60, left: 60 }, animated: true },
    )
  }, [paradas])

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

            {avisoRuta ? <Aviso tono="atencion">{avisoRuta}</Aviso> : null}

            {/*
              Sin paradas no se monta el mapa. Antes se montaba igual y caía al
              centro de Buenos Aires, sin un pin y sin un cartel: para el
              vendedor era indistinguible de un mapa roto.
            */}
            {paradas.length === 0 ? (
              <Vacio
                titulo="Todavía no hay destinos ubicados"
                detalle="Agregá un destino y, si el cliente viene del listado de la oficina, confirmá su dirección para que aparezca en el mapa."
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
                  latitude: paradas[0].direccion.lat,
                  longitude: paradas[0].direccion.lng,
                  latitudeDelta: 0.25,
                  longitudeDelta: 0.25,
                }}
              >
                {trazado.length > 0 ? (
                  <Polyline coordinates={trazado} strokeWidth={5} strokeColor={colores.azul} />
                ) : null}

                {paradas.map((p) => (
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
                  {proxima.direccion.direccion_formateada}
                </Text>

                <View style={estilos.proximaBotones}>
                  <BotonSecundario
                    titulo="🧭 Navegar"
                    alTocar={() =>
                      navegarHacia({
                        lat: proxima.direccion.lat,
                        lng: proxima.direccion.lng,
                      }).catch((e: Error) => Alert.alert('Google Maps', e.message))
                    }
                    style={estilos.mitad}
                  />
                  <BotonPrincipal
                    titulo="LLEGUÉ"
                    alTocar={() =>
                      navigation.navigate('DestinoVisitado', { paradaId: proxima.id })
                    }
                    style={estilos.mitad}
                  />
                </View>
              </View>
            ) : null}

            {paradas.length > 0 ? (
              <Text style={estilos.subtitulo}>DESTINOS DEL DÍA</Text>
            ) : null}

            {paradas.map((p) => (
              <FilaParada
                key={p.id}
                parada={p}
                alTocar={() =>
                  p.estado === 'pendiente' || p.estado === 'en_camino'
                    ? navigation.navigate('DestinoVisitado', { paradaId: p.id })
                    : undefined
                }
              />
            ))}

            <BotonMenu
              titulo={'AGREGAR\nNUEVO DESTINO'}
              alTocar={() => navigation.navigate('AgregarDestino', { volverA: 'Recorrido' })}
            />

            {!enCurso && !finalizada ? (
              <BotonPrincipal
                titulo="INICIAR RECORRIDO"
                alTocar={() => arrancar.mutate()}
                cargando={arrancar.isPending}
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
    </Pantalla>
  )
}

function FilaParada({ parada, alTocar }: { parada: ParadaCompleta; alTocar?: () => void }) {
  const { colores } = usarTema()
  const estilos = usarEstilos()
  const resuelta = parada.estado === 'visitada' || parada.estado === 'no_visitada'

  return (
    <Pressable
      onPress={alTocar}
      disabled={!alTocar}
      style={({ pressed }) => [estilos.fila, pressed && alTocar && estilos.filaPresionada]}
      accessibilityRole={alTocar ? 'button' : 'text'}
      accessibilityLabel={`Destino ${parada.orden}, ${parada.cliente?.razon_social ?? 'sin cliente'}, ${ETIQUETA_ESTADO_PARADA[parada.estado]}`}
    >
      <View style={[estilos.numero, { backgroundColor: colorDeEstado(parada.estado, colores) }]}>
        <Text style={estilos.numeroTexto}>{parada.orden}</Text>
      </View>

      <View style={estilos.filaTextos}>
        <Text style={estilos.filaCliente} numberOfLines={1}>
          {parada.cliente?.razon_social ?? parada.razon_social_snapshot ?? 'Destino sin cliente'}
        </Text>
        <Text style={estilos.filaDireccion} numberOfLines={2}>
          {parada.direccion.direccion_formateada}
        </Text>

        <View style={estilos.filaPastillas}>
          <Pastilla
            texto={ETIQUETA_ESTADO_PARADA[parada.estado]}
            color={colorDeEstado(parada.estado, colores)}
          />
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
}))
