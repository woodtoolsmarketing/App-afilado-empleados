import { espaciado, radios } from '@woodtools/compartido'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as Location from 'expo-location'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import MapView, { Marker, PROVIDER_GOOGLE, type Region } from 'react-native-maps'
import Supercluster from 'supercluster'

import { BotonMenu, BotonPrincipal, BotonSecundario } from '../componentes/Botones'
import { Campo, MensajeError } from '../componentes/Formulario'
import { Encabezado } from '../componentes/Encabezado'
import { Pantalla } from '../componentes/Pantalla'
import { supabase } from '../nucleo/supabase'
import { hojaDeTema } from '../nucleo/tema'
import { agregarClienteAlRecorrido } from '../servicios/jornada'
import { fichaClienteParaEditar, modificarDatosCliente } from '../servicios/clientes'
import { navegarHacia } from '../servicios/mapas'
import type { PropsPantalla } from '../navegacion/tipos'

/**
 * Mapa de clientes.
 *
 * El vendedor abre el mapa centrado en dónde está y ve a los clientes alrededor.
 * Son casi diez mil en todo el país, así que:
 *
 *  · Van AGRUPADOS en racimos (supercluster): de lejos, un círculo con la
 *    cantidad; al acercarse, se abren en pines individuales. Tocar un racimo
 *    acerca la cámara hasta abrirlo.
 *  · Sólo se dibujan los que caen en pantalla. Pintar diez mil marcadores de
 *    react-native-maps colgaría el teléfono; supercluster devuelve nada más lo
 *    del recuadro visible, que son unas pocas decenas.
 *
 * Cada pin individual lleva encima un recuadro con la razón social y el código.
 * Como recién aparecen cuando el racimo se abrió —o sea, cuando quedan pocos en
 * pantalla—, los carteles no se pisan.
 *
 * Tocar un pin abre un menú con tres acciones: agregarlo como próximo destino,
 * ponerlo en la cola de viajes, o modificar sus datos.
 *
 * Los datos llegan del RPC `clientes_en_mapa` en un solo `jsonb`: PostgREST
 * corta en 1.000 filas y son casi diez mil, así que un SELECT normal traería
 * una fracción sin avisar.
 */

interface ClienteMapa {
  id: string
  codigo: string
  razon_social: string
  lat: number
  lng: number
}

type PropiedadesPin = { id: string; codigo: string; razon_social: string }

/** El cliente que el vendedor tocó en el mapa, con lo que hace falta para actuar. */
interface PinTocado {
  id: string
  codigo: string
  razon_social: string
  lat: number
  lng: number
}

/**
 * Referencia estable para "todavía no hay clientes". Si en su lugar se usara un
 * `[]` nuevo en cada render (p. ej. `data ?? []`), el `useMemo` del índice —que
 * depende de este arreglo— se recalcularía siempre, el `useEffect([indice])`
 * dispararía en cada render y el hilo JS entraría en un bucle infinito que
 * congela la app. Ver el uso más abajo.
 */
const SIN_PUNTOS: ClienteMapa[] = []

/** Punto de partida si todavía no sabemos dónde está el vendedor (AMBA). */
const REGION_INICIAL: Region = {
  latitude: -34.61,
  longitude: -58.42,
  latitudeDelta: 0.5,
  longitudeDelta: 0.5,
}

/** El zoom de un mapa se deduce de cuánto abarca a lo ancho. */
function zoomDeRegion(r: Region): number {
  return Math.max(0, Math.min(20, Math.round(Math.log2(360 / r.longitudeDelta))))
}

export function PantallaMapaClientes({ navigation }: PropsPantalla<'MapaClientes'>) {
  const estilos = usarEstilos()
  const cliente = useQueryClient()
  const mapa = useRef<MapView>(null)
  const [region, setRegion] = useState<Region>(REGION_INICIAL)
  const [racimos, setRacimos] = useState<
    Array<Supercluster.PointFeature<PropiedadesPin> | Supercluster.ClusterFeature<Supercluster.AnyProps>>
  >([])

  // El cliente tocado (abre el menú de acciones) y, si eligió modificar, la ficha.
  const [tocado, setTocado] = useState<PinTocado | null>(null)
  const [editando, setEditando] = useState<PinTocado | null>(null)
  const [form, setForm] = useState({ razon_social: '', nombre_fantasia: '', direccion: '' })
  const [errorEdicion, setErrorEdicion] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['clientes-en-mapa'],
    queryFn: async (): Promise<ClienteMapa[]> => {
      const { data, error } = await supabase.rpc('clientes_en_mapa')
      if (error) throw error
      return (data ?? []) as ClienteMapa[]
    },
    staleTime: 5 * 60 * 1000,
  })
  // `data` de react-query es una referencia estable entre renders; mientras
  // carga es `undefined`, y ahí usamos SIEMPRE el mismo `[]` (no uno nuevo) para
  // no romper el `useMemo` de abajo y no caer en el bucle infinito de renders.
  const puntos = data ?? SIN_PUNTOS

  const indice = useMemo(() => {
    const s = new Supercluster<PropiedadesPin>({ radius: 60, maxZoom: 18 })
    s.load(
      puntos.map((p) => ({
        type: 'Feature' as const,
        properties: { id: p.id, codigo: p.codigo, razon_social: p.razon_social },
        geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] },
      })),
    )
    return s
  }, [puntos])

  function recalcular(r: Region) {
    const limites: [number, number, number, number] = [
      r.longitude - r.longitudeDelta / 2,
      r.latitude - r.latitudeDelta / 2,
      r.longitude + r.longitudeDelta / 2,
      r.latitude + r.latitudeDelta / 2,
    ]
    setRacimos(indice.getClusters(limites, zoomDeRegion(r)))
  }

  // Cuando llegan (o cambian) los clientes, se recalcula para la vista actual.
  useEffect(() => {
    recalcular(region)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indice])

  // Centrar en la ubicación del vendedor al entrar. Si no da permiso o no hay
  // señal, se queda en la región inicial y el mapa igual sirve.
  useEffect(() => {
    let vivo = true
    void (async () => {
      try {
        const { granted } = await Location.requestForegroundPermissionsAsync()
        if (!granted || !vivo) return
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
        if (!vivo) return
        const r: Region = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          latitudeDelta: 0.15,
          longitudeDelta: 0.15,
        }
        setRegion(r)
        mapa.current?.animateToRegion(r, 500)
      } catch {
        // Sin ubicación: se queda donde estaba.
      }
    })()
    return () => {
      vivo = false
    }
  }, [])

  // ── Acciones del pin ────────────────────────────────────────────────────────

  const agregar = useMutation({
    mutationFn: (v: { cliente: PinTocado; prioridad: 'alta' | 'baja' }) =>
      agregarClienteAlRecorrido({ clienteId: v.cliente.id, prioridad: v.prioridad }),
    onSuccess: async (_parada, v) => {
      setTocado(null)
      if (v.prioridad === 'alta') {
        // Próximo destino: lo dejó como próxima parada y ahora abre Google Maps
        // para ir directo hasta la dirección del cliente.
        try {
          await navegarHacia({ lat: v.cliente.lat, lng: v.cliente.lng })
        } catch (e) {
          Alert.alert(
            'Quedó como próximo destino',
            `${v.cliente.razon_social} quedó primero en tu recorrido, pero no pudimos abrir Google Maps: ${(e as Error).message}`,
          )
        }
      } else {
        // Cola de viajes: sólo se agrega al final; se viaja después con todo el
        // recorrido desde MAPA DE VISITAS.
        Alert.alert(
          'Agregado a la cola de viajes',
          `${v.cliente.razon_social} quedó al final de tu recorrido de hoy.`,
          [
            { text: 'Seguir en el mapa' },
            { text: 'Ir a MAPA DE VISITAS', onPress: () => navigation.navigate('Recorrido') },
          ],
        )
      }
    },
    onError: (e: Error) => Alert.alert('No se pudo agregar', e.message),
  })

  const abrirEdicion = useMutation({
    mutationFn: (c: PinTocado) => fichaClienteParaEditar(c.id),
    onSuccess: (ficha, c) => {
      setForm({
        razon_social: ficha?.razon_social ?? c.razon_social,
        nombre_fantasia: ficha?.nombre_fantasia ?? '',
        direccion: ficha?.direccion_formateada ?? '',
      })
      setErrorEdicion(null)
      setTocado(null)
      setEditando(c)
    },
    onError: (e: Error) => Alert.alert('No pudimos abrir la ficha', e.message),
  })

  const guardarEdicion = useMutation({
    mutationFn: () =>
      modificarDatosCliente({
        clienteId: editando!.id,
        razonSocial: form.razon_social,
        nombreFantasia: form.nombre_fantasia || null,
        direccion: form.direccion || null,
      }),
    onSuccess: async () => {
      // La razón social pudo cambiar: el cartel del pin sale de esta consulta.
      await cliente.invalidateQueries({ queryKey: ['clientes-en-mapa'] })
      const razon = form.razon_social
      setEditando(null)
      Alert.alert('Datos actualizados', `Se guardaron los cambios de ${razon}.`)
    },
    onError: (e: Error) => setErrorEdicion(e.message),
  })

  function validarYGuardar() {
    if (form.razon_social.trim().length < 3) {
      setErrorEdicion('Escribí el nombre o la razón social del cliente.')
      return
    }
    setErrorEdicion(null)
    guardarEdicion.mutate()
  }

  const ocupado = agregar.isPending || abrirEdicion.isPending

  return (
    <Pantalla>
      <Encabezado alAbrirMenu={() => navigation.navigate('Menu')} />

      <View style={estilos.marco}>
        <MapView
          ref={mapa}
          provider={PROVIDER_GOOGLE}
          style={estilos.mapa}
          showsUserLocation
          showsMyLocationButton
          toolbarEnabled={false}
          initialRegion={REGION_INICIAL}
          onRegionChangeComplete={(r) => {
            setRegion(r)
            recalcular(r)
          }}
        >
          {racimos.map((f) => {
            const [lng, lat] = f.geometry.coordinates
            const esRacimo = 'cluster' in f.properties && f.properties.cluster

            if (esRacimo) {
              const cantidad = (f.properties as Supercluster.ClusterProperties).point_count
              const clusterId = (f.properties as Supercluster.ClusterProperties).cluster_id
              return (
                <Marker
                  key={`c${clusterId}`}
                  coordinate={{ latitude: lat, longitude: lng }}
                  onPress={() => {
                    const z = Math.min(indice.getClusterExpansionZoom(clusterId), 18)
                    const delta = 360 / Math.pow(2, z)
                    mapa.current?.animateToRegion(
                      { latitude: lat, longitude: lng, latitudeDelta: delta, longitudeDelta: delta },
                      350,
                    )
                  }}
                >
                  <View style={[estilos.racimo, cantidad > 100 ? estilos.racimoGrande : null]}>
                    <Text style={estilos.racimoTexto}>{cantidad}</Text>
                  </View>
                </Marker>
              )
            }

            const p = f.properties as PropiedadesPin
            return (
              <Marker
                key={p.id}
                coordinate={{ latitude: lat, longitude: lng }}
                anchor={{ x: 0.5, y: 1 }}
                tracksViewChanges={false}
                onPress={() =>
                  setTocado({ id: p.id, codigo: p.codigo, razon_social: p.razon_social, lat, lng })
                }
              >
                <View style={estilos.pinColumna}>
                  <View style={estilos.cartel}>
                    <Text style={estilos.cartelNombre} numberOfLines={1}>
                      {p.razon_social}
                    </Text>
                    <Text style={estilos.cartelCodigo}>Código: {p.codigo}</Text>
                  </View>
                  <View style={estilos.pin} />
                </View>
              </Marker>
            )
          })}
        </MapView>

        {isLoading ? (
          <View style={estilos.cargando} pointerEvents="none">
            <ActivityIndicator />
            <Text style={estilos.cargandoTexto}>Cargando los clientes…</Text>
          </View>
        ) : (
          <View style={estilos.contador} pointerEvents="none">
            <Text style={estilos.contadorTexto}>{puntos.length.toLocaleString('es-AR')} clientes</Text>
          </View>
        )}
      </View>

      {/* ── Menú de acciones al tocar un pin ─────────────────────────────────── */}
      <Modal
        visible={!!tocado}
        transparent
        animationType="fade"
        onRequestClose={() => setTocado(null)}
      >
        <Pressable style={estilos.velo} onPress={() => !ocupado && setTocado(null)}>
          <Pressable style={estilos.hoja} onPress={(e) => e.stopPropagation()}>
            <Text style={estilos.hojaTitulo} numberOfLines={2}>
              {tocado?.razon_social}
            </Text>
            <Text style={estilos.hojaSub}>Código: {tocado?.codigo}</Text>

            <View style={estilos.acciones}>
              <BotonMenu
                titulo="PRÓXIMO DESTINO"
                subtitulo="Te lleva ahora por Google Maps"
                alTocar={() => tocado && agregar.mutate({ cliente: tocado, prioridad: 'alta' })}
                cargando={agregar.isPending && agregar.variables?.prioridad === 'alta'}
                deshabilitado={ocupado}
              />
              <BotonMenu
                titulo="AGREGAR A LA COLA DE VIAJES"
                subtitulo="Al final del recorrido de hoy"
                alTocar={() => tocado && agregar.mutate({ cliente: tocado, prioridad: 'baja' })}
                cargando={agregar.isPending && agregar.variables?.prioridad === 'baja'}
                deshabilitado={ocupado}
              />
              <BotonMenu
                titulo="MODIFICAR DATOS"
                subtitulo="Nombre, razón social o dirección"
                alTocar={() => tocado && abrirEdicion.mutate(tocado)}
                cargando={abrirEdicion.isPending}
                deshabilitado={ocupado}
              />
            </View>

            <BotonSecundario
              titulo="Cerrar"
              alTocar={() => setTocado(null)}
              deshabilitado={ocupado}
              style={estilos.cerrar}
            />
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── Modificar los datos del cliente ──────────────────────────────────── */}
      <Modal
        visible={!!editando}
        transparent
        animationType="fade"
        onRequestClose={() => setEditando(null)}
      >
        <KeyboardAvoidingView
          style={estilos.veloCentro}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setEditando(null)} />
          <View style={estilos.tarjeta}>
            <ScrollView
              contentContainerStyle={estilos.tarjetaContenido}
              keyboardShouldPersistTaps="handled"
              bounces={false}
            >
              <Text style={estilos.hojaTitulo}>Modificar datos</Text>
              <Text style={estilos.hojaSub}>Código: {editando?.codigo}</Text>

              <Campo
                etiqueta="Razón social"
                obligatorio
                value={form.razon_social}
                onChangeText={(t) => setForm((f) => ({ ...f, razon_social: t }))}
                autoCapitalize="words"
              />
              <Campo
                etiqueta="Nombre de fantasía"
                value={form.nombre_fantasia}
                onChangeText={(t) => setForm((f) => ({ ...f, nombre_fantasia: t }))}
                placeholder="Cómo lo conocen en la zona"
                autoCapitalize="words"
              />
              <Campo
                etiqueta="Dirección"
                value={form.direccion}
                onChangeText={(t) => setForm((f) => ({ ...f, direccion: t }))}
                placeholder="Calle, número, localidad"
                autoCapitalize="words"
                ayuda="Corrige el texto de la dirección. El punto en el mapa no se mueve."
              />

              <MensajeError>{errorEdicion}</MensajeError>

              <View style={estilos.filaBotones}>
                <BotonSecundario
                  titulo="Cancelar"
                  alTocar={() => setEditando(null)}
                  deshabilitado={guardarEdicion.isPending}
                  style={estilos.botonMitad}
                />
                <BotonPrincipal
                  titulo="Guardar"
                  alTocar={validarYGuardar}
                  cargando={guardarEdicion.isPending}
                  style={estilos.botonMitad}
                />
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </Pantalla>
  )
}

const usarEstilos = hojaDeTema((t) => ({
  marco: {
    flex: 1,
    margin: 12,
    borderWidth: 2.5,
    borderColor: t.colores.negro,
    borderRadius: 8,
    overflow: 'hidden' as const,
  },
  mapa: { flex: 1 },
  racimo: {
    minWidth: 40,
    height: 40,
    paddingHorizontal: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(179,15,15,0.9)',
    borderWidth: 2,
    borderColor: '#fff',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  racimoGrande: { minWidth: 52, height: 52, borderRadius: 26 },
  racimoTexto: { color: '#fff', fontWeight: '800' as const, fontSize: 14 },
  pinColumna: { alignItems: 'center' as const },
  cartel: {
    backgroundColor: '#fff',
    borderColor: t.colores.negro,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 3,
    maxWidth: 180,
    marginBottom: 2,
  },
  cartelNombre: { fontSize: 11, fontWeight: '700' as const, color: '#111' },
  cartelCodigo: { fontSize: 10, color: '#555' },
  pin: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: t.colores.rojo,
    borderWidth: 2,
    borderColor: '#fff',
  },
  cargando: {
    position: 'absolute' as const,
    top: 12,
    alignSelf: 'center' as const,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    backgroundColor: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  cargandoTexto: { fontSize: 13, color: '#111' },
  contador: {
    position: 'absolute' as const,
    bottom: 12,
    left: 12,
    backgroundColor: 'rgba(255,255,255,0.9)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  },
  contadorTexto: { fontSize: 12, color: '#111', fontWeight: '600' as const },

  // ── Menú de acciones (hoja inferior) ──────────────────────────────────────
  velo: {
    flex: 1,
    backgroundColor: t.colores.velo,
    justifyContent: 'flex-end' as const,
  },
  hoja: {
    backgroundColor: t.colores.panelClaro,
    borderTopWidth: 3,
    borderColor: t.colores.borde,
    borderTopLeftRadius: radios.lg,
    borderTopRightRadius: radios.lg,
    padding: espaciado.base,
    gap: espaciado.sm,
  },
  hojaTitulo: {
    fontFamily: t.tipografia.familia.subtitulo,
    fontSize: t.tipografia.tamano.lg,
    color: t.colores.tinta,
    textAlign: 'center' as const,
  },
  hojaSub: {
    fontFamily: t.tipografia.familia.liviana,
    fontSize: t.tipografia.tamano.sm,
    color: t.colores.tintaSuave,
    textAlign: 'center' as const,
    marginBottom: espaciado.xs,
  },
  acciones: { gap: espaciado.sm },
  cerrar: { marginTop: espaciado.xs },

  // ── Formulario de edición (tarjeta centrada) ──────────────────────────────
  veloCentro: {
    flex: 1,
    backgroundColor: t.colores.velo,
    justifyContent: 'center' as const,
    padding: espaciado.base,
  },
  tarjeta: {
    backgroundColor: t.colores.panelClaro,
    borderWidth: 3,
    borderColor: t.colores.borde,
    borderRadius: radios.lg,
    maxHeight: '86%' as const,
  },
  tarjetaContenido: {
    padding: espaciado.base,
    gap: espaciado.sm,
  },
  filaBotones: {
    flexDirection: 'row' as const,
    gap: espaciado.sm,
    marginTop: espaciado.sm,
  },
  botonMitad: { flex: 1, minWidth: 0 },
}))
