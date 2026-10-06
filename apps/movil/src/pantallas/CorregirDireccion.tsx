import { useMutation } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { Alert, StyleSheet, Text, View } from 'react-native'
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps'

import { BotonPrincipal, BotonSecundario } from '../componentes/Botones'
import { Aviso } from '../componentes/Estado'
import { Campo } from '../componentes/Formulario'
import { Encabezado } from '../componentes/Encabezado'
import { BarraPanel, Pantalla, Panel, TituloPanel } from '../componentes/Pantalla'
import type { PropsPantalla } from '../navegacion/tipos'
import { hojaDeTema, usarTema } from '../nucleo/tema'
import { proponerCambioDireccion } from '../servicios/cambiosDireccion'
import { navegarHacia, ubicacionComoDireccion } from '../servicios/mapas'
import { ubicacionActual } from '../servicios/ubicacion'

/** Un punto de partida cualquiera (Obelisco) cuando no hay coordenada ni GPS todavía. */
const CENTRO_POR_DEFECTO = { latitude: -34.6037, longitude: -58.3816 }

/**
 * Corregir la dirección/ubicación de un cliente, desde la calle.
 *
 * El vendedor está parado en el cliente y ve que la dirección registrada está
 * mal. Marca dónde está de verdad (el pin) y, si quiere, corrige el texto. Eso
 * NO pisa la dirección oficial: manda un pedido que la oficina revisa y aplica
 * desde el panel. Mientras tanto, el recorrido de ESTE vendedor ya lo lleva al
 * punto nuevo (lo resuelve la app con `misCambiosPendientes`).
 */
export function PantallaCorregirDireccion({ navigation, route }: PropsPantalla<'CorregirDireccion'>) {
  const { clienteId, clienteNombre, direccionId, direccionActual, lat, lng } = route.params
  const estilos = usarEstilos()
  const mapaRef = useRef<MapView>(null)

  const [direccion, setDireccion] = useState(direccionActual)
  const [motivo, setMotivo] = useState('')
  const [punto, setPunto] = useState<{ lat: number; lng: number } | null>(
    lat != null && lng != null ? { lat, lng } : null,
  )
  const [buscandoGps, setBuscandoGps] = useState(false)
  const [resolviendo, setResolviendo] = useState(false)

  const regionInicial = {
    latitude: lat ?? CENTRO_POR_DEFECTO.latitude,
    longitude: lng ?? CENTRO_POR_DEFECTO.longitude,
    latitudeDelta: 0.008,
    longitudeDelta: 0.008,
  }

  /**
   * Fija el pin Y resuelve la dirección de esa coordenada en Google.
   *
   * El bug que había: al mover el pin o usar el GPS sólo se guardaba la
   * coordenada, y el texto quedaba igual que la dirección vieja. Así la oficina
   * veía "propuesta = actual". Ahora el texto pasa a ser el domicilio que Google
   * da para el punto marcado. El vendedor puede corregirlo a mano después (lo
   * último que marque o escriba es lo que se envía).
   */
  async function fijarPunto(lat: number, lng: number) {
    setPunto({ lat, lng })
    setResolviendo(true)
    try {
      const d = await ubicacionComoDireccion({ lat, lng })
      setDireccion(d.direccion_formateada)
    } catch {
      // Google no resolvió: dejamos el pin y el texto que haya; la oficina lo ve.
    } finally {
      setResolviendo(false)
    }
  }

  function moverPin(coord: { latitude: number; longitude: number }) {
    void fijarPunto(coord.latitude, coord.longitude)
  }

  async function usarMiUbicacion() {
    setBuscandoGps(true)
    try {
      const u = await ubicacionActual()
      mapaRef.current?.animateToRegion(
        { latitude: u.lat, longitude: u.lng, latitudeDelta: 0.004, longitudeDelta: 0.004 },
        400,
      )
      await fijarPunto(u.lat, u.lng)
    } catch {
      Alert.alert('No pudimos tomar tu ubicación', 'Revisá que el GPS esté prendido y probá de nuevo.')
    } finally {
      setBuscandoGps(false)
    }
  }

  const enviar = useMutation({
    mutationFn: () =>
      proponerCambioDireccion({
        clienteId,
        direccionId,
        direccion: direccion.trim(),
        lat: punto?.lat ?? null,
        lng: punto?.lng ?? null,
        motivo: motivo.trim() || null,
      }),
    onSuccess: () => {
      Alert.alert(
        'Corrección enviada',
        'La oficina la va a revisar y aplicar. Mientras tanto, tu recorrido te lleva a la ubicación nueva.',
        [{ text: 'Listo', onPress: () => navigation.goBack() }],
      )
    },
    onError: (e: Error) => Alert.alert('No se pudo enviar', e.message),
  })

  return (
    <Pantalla>
      <Encabezado />
      <Panel>
        <BarraPanel alVolver={() => navigation.goBack()} />
        <TituloPanel>CORREGIR LA DIRECCIÓN</TituloPanel>

        <Text style={estilos.cliente}>{clienteNombre}</Text>

        <Aviso tono="info">
          Marcá en el mapa dónde está el cliente de verdad. No cambia la dirección para todos: la
          oficina la revisa y la aplica. A vos el recorrido ya te lleva ahí.
        </Aviso>

        <View style={estilos.mapaCaja}>
          <MapView
            ref={mapaRef}
            provider={PROVIDER_GOOGLE}
            style={StyleSheet.absoluteFill}
            initialRegion={regionInicial}
            onPress={(e) => moverPin(e.nativeEvent.coordinate)}
          >
            {punto ? (
              <Marker
                draggable
                coordinate={{ latitude: punto.lat, longitude: punto.lng }}
                onDragEnd={(e) => moverPin(e.nativeEvent.coordinate)}
              />
            ) : null}
          </MapView>
        </View>
        <Text style={estilos.ayuda}>Tocá el mapa o arrastrá el pin para marcar el lugar exacto.</Text>

        <BotonSecundario
          titulo="📍 Usar mi ubicación actual"
          alTocar={usarMiUbicacion}
          cargando={buscandoGps}
        />

        <Campo
          etiqueta="DIRECCIÓN"
          value={direccion}
          onChangeText={setDireccion}
          placeholder="Calle y número, localidad"
          multiline
          ayuda={
            resolviendo
              ? 'Buscando en Google la dirección del punto…'
              : 'Se completa sola con lo que Google ve en el pin. Corregila si hace falta.'
          }
        />
        <Campo
          etiqueta="POR QUÉ (OPCIONAL)"
          value={motivo}
          onChangeText={setMotivo}
          placeholder="Ej: el portón es azul, la registrada está a 2 cuadras"
          multiline
        />

        {!punto ? (
          <Aviso tono="atencion">
            Sin marcar el punto en el mapa, la oficina va a tener que ubicarlo a mano. Mejor marcalo.
          </Aviso>
        ) : null}

        <BotonPrincipal
          titulo="ENVIAR LA CORRECCIÓN"
          alTocar={() => {
            if (direccion.trim().length < 5) {
              Alert.alert('Falta la dirección', 'Escribí la dirección nueva.')
              return
            }
            enviar.mutate()
          }}
          cargando={enviar.isPending}
        />

        {punto ? (
          <BotonSecundario
            titulo="Cómo llego (probar)"
            alTocar={() => void navegarHacia({ lat: punto.lat, lng: punto.lng }).catch(() => undefined)}
          />
        ) : null}
      </Panel>
    </Pantalla>
  )
}

const usarEstilos = hojaDeTema((t) => ({
  cliente: {
    color: t.colores.tinta,
    fontSize: 18,
    fontWeight: '700' as const,
    textAlign: 'center' as const,
    marginBottom: 10,
  },
  mapaCaja: {
    height: 260,
    borderRadius: 12,
    overflow: 'hidden' as const,
    marginTop: 12,
    borderWidth: 1,
    borderColor: t.colores.borde,
  },
  ayuda: {
    color: t.colores.tintaSuave,
    fontSize: 13,
    textAlign: 'center' as const,
    marginTop: 6,
    marginBottom: 4,
  },
}))
