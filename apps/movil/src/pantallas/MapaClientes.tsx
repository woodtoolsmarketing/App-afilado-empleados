import { espaciado, radios, type ClienteBuscado } from '@woodtools/compartido'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as Location from 'expo-location'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Keyboard,
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
import {
  agregarClienteAlRecorrido,
  clienteYaEnRecorrido,
  SucursalDuplicadaError,
} from '../servicios/jornada'
import { usarSesion } from '../nucleo/sesion'
import {
  buscarClientes,
  ESPERA_TECLEO,
  fichaClienteParaEditar,
  LIMITE_CLIENTES,
  modificarDatosCliente,
} from '../servicios/clientes'
import { navegarHacia } from '../servicios/mapas'
import type { PropsPantalla } from '../navegacion/tipos'

/**
 * Mapa de clientes.
 *
 * El vendedor abre el mapa centrado en dónde está y ve a los clientes alrededor.
 *
 * ─── Quién NO está en este mapa ─────────────────────────────────────────────
 *
 * Los que no tienen punto. `clientes_en_mapa` sale de `direcciones`, y cuatro de
 * cada diez clientes activos no tienen ninguna fila ahí: son casi diez mil pines
 * sobre un padrón de dieciséis mil y medio. Un cliente sin coordenadas no puede
 * tener pin —dibujarlo en cualquier lado sería peor que no dibujarlo—, así que
 * esta pantalla no lo muestra y no hay nada que agregarle para que lo muestre.
 *
 * Lo que sí cambió es que no estar acá dejó de ser una condena: al cliente sin
 * ubicar se lo agrega al recorrido desde el buscador (AGREGAR DESTINO), entra al
 * final de la lista, y el punto se guarda al llegar. Por eso el contador de
 * abajo dice "ubicados" y no "clientes" a secas: el número de pines nunca fue el
 * tamaño de la cartera, y ahora que faltar del mapa no impide trabajar, dejarlo
 * ambiguo sería hacerle creer que el cliente que no encuentra no existe.
 *
 * Son casi diez mil pines, así que:
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
  const perfil = usarSesion((s) => s.perfil)
  const mapa = useRef<MapView>(null)
  /**
   * Candado sincrónico contra el doble-toque en "PRÓXIMO DESTINO"/"COLA".
   *
   * `agregar.isPending` recién vale `true` en el próximo render, así que dos
   * toques en el mismo tick pasan los dos. Sin el índice único de la base (que
   * se sacó para permitir sucursales) haría dos paradas iguales por error. Un
   * ref cambia en el acto.
   */
  const enviandoMapa = useRef(false)
  const [region, setRegion] = useState<Region>(REGION_INICIAL)
  const [racimos, setRacimos] = useState<
    Array<Supercluster.PointFeature<PropiedadesPin> | Supercluster.ClusterFeature<Supercluster.AnyProps>>
  >([])

  // El cliente tocado (abre el menú de acciones) y, si eligió modificar, la ficha.
  const [tocado, setTocado] = useState<PinTocado | null>(null)
  const [editando, setEditando] = useState<PinTocado | null>(null)
  const [form, setForm] = useState({ razon_social: '', nombre_fantasia: '', direccion: '' })
  const [errorEdicion, setErrorEdicion] = useState<string | null>(null)

  // ── Buscador de clientes (nombre / razón social / número) ───────────────────
  // Un solo campo que busca por lo que sea (reusa la búsqueda difusa de
  // buscar_clientes). Al elegir uno, se centra el mapa en su pin y se abre el
  // menú de acciones.
  const [consulta, setConsulta] = useState('')
  const [resultados, setResultados] = useState<ClienteBuscado[]>([])
  const [buscando, setBuscando] = useState(false)
  // Anti-carrera: si la medida cambia mientras una búsqueda está en vuelo, la
  // respuesta vieja no debe pisar la nueva.
  const vigente = useRef(0)
  const temporizadorBusqueda = useRef<ReturnType<typeof setTimeout> | null>(null)

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

  // Busca mientras se tipea (con una espera, para no consultar en cada tecla).
  useEffect(() => {
    if (temporizadorBusqueda.current) clearTimeout(temporizadorBusqueda.current)
    const texto = consulta.trim()
    if (texto.length < 2) {
      setResultados([])
      setBuscando(false)
      return
    }
    setBuscando(true)
    const miTurno = ++vigente.current
    temporizadorBusqueda.current = setTimeout(async () => {
      try {
        const r = await buscarClientes(texto)
        if (miTurno === vigente.current) setResultados(r)
      } catch {
        if (miTurno === vigente.current) setResultados([])
      } finally {
        if (miTurno === vigente.current) setBuscando(false)
      }
    }, ESPERA_TECLEO)
    return () => {
      if (temporizadorBusqueda.current) clearTimeout(temporizadorBusqueda.current)
    }
  }, [consulta])

  /**
   * Ir al cliente elegido del buscador: centrar el mapa en su pin y abrir el
   * menú de acciones. Un cliente SIN UBICAR (sin coordenadas) no tiene pin, así
   * que no se puede centrar: se avisa.
   */
  function irAlCliente(c: ClienteBuscado) {
    Keyboard.dismiss()
    vigente.current++
    setResultados([])
    setConsulta('')
    if (c.lat === null || c.lng === null) {
      Alert.alert(
        'Ese cliente no está en el mapa',
        `${c.razon_social} todavía no tiene una ubicación cargada, así que no aparece como pin. Se lo puede ubicar desde AGREGAR DESTINO.`,
      )
      return
    }
    // Delta chico: el racimo que lo contenía se abre y el pin queda individual.
    mapa.current?.animateToRegion(
      { latitude: c.lat, longitude: c.lng, latitudeDelta: 0.01, longitudeDelta: 0.01 },
      400,
    )
    setTocado({
      id: c.cliente_id,
      codigo: c.codigo,
      razon_social: c.razon_social,
      lat: c.lat,
      lng: c.lng,
    })
  }

  // ── Acciones del pin ────────────────────────────────────────────────────────

  /**
   * Agregar al recorrido el cliente del pin.
   *
   * Acá no hace falta contemplar la parada SIN UBICAR, y conviene dejar escrito
   * por qué para que nadie la agregue "por las dudas": todo lo que tiene pin
   * tiene coordenadas —es la única forma de dibujarlo—, así que
   * `agregar_cliente_al_recorrido` siempre le va a encontrar la dirección
   * principal y la parada nunca va a nacer sin ubicar desde esta pantalla. Es
   * también por eso que más abajo se usa `navegarHacia` con el punto del pin y
   * no `buscarEnMapsPorTexto`: el destino es un hecho, no una conjetura.
   *
   * El error tampoco necesita nada especial. El único cartel que este menú podía
   * sacar por falta de ubicación era "Ese cliente todavía no está ubicado en el
   * mapa" (23514), y esa función dejó de tirarlo. Quedan los dos que sí siguen
   * pasando y que la base redacta sola: ya está en el recorrido de hoy, y cuenta
   * no habilitada.
   */
  const agregar = useMutation({
    mutationFn: async (v: { cliente: PinTocado; prioridad: 'alta' | 'baja'; confirmado?: boolean }) => {
      // ¿Ya está en el recorrido de hoy? Preguntar si es otra sucursal antes de
      // agregarlo de nuevo (hay clientes con un código y varios locales).
      if (!v.confirmado && perfil && (await clienteYaEnRecorrido(perfil.id, v.cliente.id))) {
        throw new SucursalDuplicadaError(v.cliente.razon_social)
      }
      return agregarClienteAlRecorrido({ clienteId: v.cliente.id, prioridad: v.prioridad })
    },
    onSuccess: async (_parada, v) => {
      setTocado(null)
      // Refrescar la jornada: sin esto, el Recorrido y el Menú que quedaron
      // montados seguían mostrando la lista vieja (igual que en AgregarDestino).
      await cliente.invalidateQueries()
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
    onError: (e: Error, v) => {
      // El cliente ya está en la lista: preguntar si es otra sucursal. Si el
      // vendedor confirma, se reintenta el alta con `confirmado`, que la agrega.
      if (e instanceof SucursalDuplicadaError) {
        Alert.alert(
          'Ya está en tu recorrido',
          `${e.razonSocial} ya está en tu recorrido de hoy.\n\n¿Es otra sucursal? Si es el mismo local, no hace falta agregarlo de nuevo.`,
          [
            { text: 'No, cancelar', style: 'cancel' },
            {
              text: 'Sí, es otra sucursal',
              onPress: () => agregar.mutate({ ...v, confirmado: true }),
            },
          ],
        )
        return
      }
      Alert.alert('No se pudo agregar', e.message)
    },
    onSettled: () => {
      // Terminó (bien, mal, o cortado por el aviso de sucursal): se libera el
      // candado del doble-toque. El reintento por "es otra sucursal" sale del
      // Alert, que no se toquetea dos veces.
      enviandoMapa.current = false
    },
  })

  /**
   * Arranca el alta desde el menú del pin, con el candado sincrónico puesto.
   * Los botones llaman acá y no a `agregar.mutate` directo para cerrar la
   * ventana del doble-toque (ver `enviandoMapa`).
   */
  function iniciarAgregar(prioridad: 'alta' | 'baja') {
    if (enviandoMapa.current || agregar.isPending || !tocado) return
    enviandoMapa.current = true
    agregar.mutate({ cliente: tocado, prioridad })
  }

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
            {/* "ubicados", no "clientes": son los que tienen punto, que son
                bastantes menos que los de la cartera. Ver el encabezado. */}
            <Text style={estilos.contadorTexto}>
              {puntos.length.toLocaleString('es-AR')} clientes ubicados
            </Text>
          </View>
        )}

        {/* Buscador: un solo campo que acepta nombre, razón social o número de
            cliente. Flota sobre el mapa (zIndex + elevation para Android). */}
        <View style={estilos.buscador} pointerEvents="box-none">
          <Campo
            placeholder="Buscar por nombre o número de cliente"
            value={consulta}
            onChangeText={setConsulta}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            accesorio={buscando ? <ActivityIndicator size="small" /> : undefined}
          />
          {resultados.length > 0 ? (
            <ScrollView
              style={estilos.resultados}
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled
            >
              {resultados.map((c) => (
                <Pressable
                  key={c.cliente_id}
                  onPress={() => irAlCliente(c)}
                  accessibilityRole="button"
                  style={({ pressed }) => [estilos.resultado, pressed && estilos.resultadoTocado]}
                >
                  <View style={estilos.resultadoFila}>
                    <Text style={estilos.resultadoCodigo}>{c.codigo || 'Sin código'}</Text>
                    {c.lat === null ? <Text style={estilos.sinUbicar}>SIN UBICAR</Text> : null}
                  </View>
                  <Text style={estilos.resultadoNombre} numberOfLines={1}>
                    {c.razon_social}
                  </Text>
                  {c.direccion ? (
                    <Text style={estilos.resultadoDireccion} numberOfLines={1}>
                      {c.direccion}
                    </Text>
                  ) : null}
                </Pressable>
              ))}
              {resultados.length >= LIMITE_CLIENTES ? (
                <Text style={estilos.resultadoAyuda}>
                  Son muchos: mostramos los primeros {LIMITE_CLIENTES}. Escribí un poco más.
                </Text>
              ) : null}
            </ScrollView>
          ) : null}
        </View>
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
                alTocar={() => iniciarAgregar('alta')}
                cargando={agregar.isPending && agregar.variables?.prioridad === 'alta'}
                deshabilitado={ocupado}
              />
              <BotonMenu
                titulo="AGREGAR A LA COLA DE VIAJES"
                subtitulo="Al final del recorrido de hoy"
                alTocar={() => iniciarAgregar('baja')}
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
    // Debajo del buscador, que ocupa la franja de arriba, para no taparse con él.
    position: 'absolute' as const,
    top: 74,
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

  // ── Buscador flotante ─────────────────────────────────────────────────────
  // Franja de arriba del mapa. zIndex + elevation para que quede por encima de
  // los pines (Android ordena por elevation, no por orden de dibujo).
  buscador: {
    position: 'absolute' as const,
    top: 10,
    left: 10,
    right: 10,
    zIndex: 20,
    elevation: 8,
  },
  resultados: {
    marginTop: 6,
    maxHeight: 300,
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: t.colores.negro,
    borderRadius: 8,
    overflow: 'hidden' as const,
  },
  resultado: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ddd',
  },
  resultadoTocado: { backgroundColor: '#f0e9df' },
  resultadoFila: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
  },
  resultadoCodigo: { fontSize: 12, fontWeight: '700' as const, color: '#555' },
  sinUbicar: {
    fontSize: 10,
    fontWeight: '800' as const,
    color: '#fff',
    backgroundColor: t.colores.rojo,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden' as const,
  },
  resultadoNombre: { fontSize: 14, fontWeight: '600' as const, color: '#111', marginTop: 2 },
  resultadoDireccion: { fontSize: 12, color: '#666', marginTop: 1 },
  resultadoAyuda: {
    fontSize: 11,
    color: '#666',
    fontStyle: 'italic' as const,
    paddingHorizontal: 12,
    paddingVertical: 8,
    textAlign: 'center' as const,
  },
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
