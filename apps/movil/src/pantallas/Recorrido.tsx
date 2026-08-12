import {
  colores,
  espaciado,
  ETIQUETA_ESTADO_PARADA,
  ETIQUETA_PRIORIDAD,
  formatearDistancia,
  formatearDuracion,
  radios,
  tipografia,
  type EstadoParada,
  type ParadaCompleta,
} from '@woodtools/compartido'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native'
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
  ubicacionActual,
} from '../servicios/ubicacion'
import type { PropsPantalla } from '../navegacion/tipos'

/**
 * "ESTE ES TU RECORRIDO DEL DÍA DE HOY"
 *
 * Mapa con el trazado completo arriba y la lista ordenada de destinos abajo.
 * Desde acá se arranca el recorrido, se navega al próximo destino y se carga
 * el parte de cada visita.
 */
export function PantallaRecorrido({ navigation, route }: PropsPantalla<'Recorrido'>) {
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
  const finalizada = jornada?.estado === 'finalizado'

  const proxima = useMemo(
    () => paradas.find((p) => p.estado === 'en_camino') ?? paradas.find((p) => p.estado === 'pendiente'),
    [paradas],
  )

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

      // Se optimiza con la ubicación real de arranque antes de largar.
      try {
        await optimizarRecorrido(jornada.id, { lat: pos.lat, lng: pos.lng })
      } catch {
        setAvisoRuta(
          'No pudimos consultar el tránsito de Google. El recorrido queda ordenado por cercanía.',
        )
      }

      await iniciarRecorrido(jornada.id, pos.lat, pos.lng)
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
      <Encabezado alAbrirMenu={() => navigation.navigate('Configuracion')} />

      <Panel contentStyle={estilos.contenido}>
        <BarraPanel alVolver={() => navigation.goBack()} />

        {isLoading ? (
          <Cargando texto="Armando tu recorrido…" />
        ) : error || !jornada ? (
          <Vacio
            titulo="No hay recorrido para hoy"
            detalle="La oficina todavía no cargó tus destinos. Podés agregar uno a mano."
            icono="🗺️"
          />
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
                    pinColor={colorDeEstado(p.estado)}
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
  const resuelta = parada.estado === 'visitada' || parada.estado === 'no_visitada'

  return (
    <Pressable
      onPress={alTocar}
      disabled={!alTocar}
      style={({ pressed }) => [estilos.fila, pressed && alTocar && estilos.filaPresionada]}
      accessibilityRole={alTocar ? 'button' : 'text'}
      accessibilityLabel={`Destino ${parada.orden}, ${parada.cliente?.razon_social ?? 'sin cliente'}, ${ETIQUETA_ESTADO_PARADA[parada.estado]}`}
    >
      <View style={[estilos.numero, { backgroundColor: colorDeEstado(parada.estado) }]}>
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
            color={colorDeEstado(parada.estado)}
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

function colorDeEstado(estado: EstadoParada): string {
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

const estilos = StyleSheet.create({
  contenido: { gap: espaciado.md },

  marcoMapa: {
    height: 300,
    borderWidth: 2.5,
    borderColor: colores.negro,
    borderRadius: radios.sm,
    overflow: 'hidden',
  },
  mapa: { flex: 1 },

  resumenRuta: {
    fontFamily: tipografia.familia.cuerpo,
    fontSize: tipografia.tamano.xs,
    color: colores.tintaSuave,
    textAlign: 'center',
  },

  proxima: {
    backgroundColor: colores.campoBlanco,
    borderWidth: 2.5,
    borderColor: colores.negro,
    borderRadius: radios.sm,
    padding: espaciado.md,
    gap: espaciado.xs,
  },
  proximaEtiqueta: {
    fontFamily: tipografia.familia.subtitulo,
    fontSize: tipografia.tamano.micro,
    color: colores.rojo,
    letterSpacing: 1,
  },
  proximaCliente: {
    fontFamily: tipografia.familia.subtitulo,
    fontSize: tipografia.tamano.lg,
    color: colores.tinta,
  },
  proximaDireccion: {
    fontFamily: tipografia.familia.cuerpo,
    fontSize: tipografia.tamano.xs,
    color: colores.tintaSuave,
  },
  proximaBotones: {
    flexDirection: 'row',
    gap: espaciado.sm,
    marginTop: espaciado.sm,
  },
  mitad: { flex: 1, minWidth: 0 },

  subtitulo: {
    fontFamily: tipografia.familia.subtitulo,
    fontSize: tipografia.tamano.sm,
    color: colores.tintaSuave,
    letterSpacing: 1,
    marginTop: espaciado.sm,
  },

  fila: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaciado.md,
    backgroundColor: colores.panelClaro,
    borderWidth: 1.5,
    borderColor: colores.negro,
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
    borderColor: colores.negro,
  },
  numeroTexto: {
    fontFamily: tipografia.familia.titulo,
    fontSize: tipografia.tamano.base,
    color: colores.blanco,
  },
  filaTextos: { flex: 1, gap: 2 },
  filaCliente: {
    fontFamily: tipografia.familia.fuerte,
    fontSize: tipografia.tamano.sm,
    color: colores.tinta,
  },
  filaDireccion: {
    fontFamily: tipografia.familia.liviana,
    fontSize: tipografia.tamano.xs,
    color: colores.tintaSuave,
  },
  filaPastillas: {
    flexDirection: 'row',
    gap: espaciado.xs,
    flexWrap: 'wrap',
    marginTop: 2,
  },
  tildeFila: {
    fontFamily: tipografia.familia.titulo,
    fontSize: 22,
    color: colores.verdeOscuro,
  },
})
