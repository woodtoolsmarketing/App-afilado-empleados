import { espaciado, radios } from '@woodtools/compartido'
import { StyleSheet, View } from 'react-native'
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps'

import { hojaDeTema } from '../nucleo/tema'

/**
 * Un mapa chico, de sólo lectura, con el pin de la ubicación del cliente.
 *
 * Es para que el vendedor VEA dónde cae el cliente apenas lo busca —al agregarlo
 * como próximo destino, al hacer la nota, etc.—, sin tener que abrir el mapa
 * grande. No se edita acá: corregir la ubicación sigue yendo por "Corregir
 * dirección". Se dibuja SÓLO cuando el cliente tiene coordenadas; al que no está
 * ubicado lo sigue manejando la pastilla "SIN UBICAR" de cada pantalla.
 *
 * `pointerEvents="none"`: es una foto del lugar, no un mapa para manejar. Así no
 * pelea con el scroll de la pantalla (el mapa se come los gestos de arrastre si
 * queda interactivo adentro de un ScrollView).
 */
export function MapaUbicacionCliente({
  lat,
  lng,
  titulo,
  alto = 170,
}: {
  lat: number
  lng: number
  titulo?: string
  alto?: number
}) {
  const estilos = usarEstilos()
  return (
    <View style={[estilos.caja, { height: alto }]}>
      <MapView
        provider={PROVIDER_GOOGLE}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
        initialRegion={{ latitude: lat, longitude: lng, latitudeDelta: 0.006, longitudeDelta: 0.006 }}
      >
        <Marker coordinate={{ latitude: lat, longitude: lng }} title={titulo} />
      </MapView>
    </View>
  )
}

const usarEstilos = hojaDeTema((t) => ({
  caja: {
    borderRadius: radios.sm,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: t.colores.borde,
    marginTop: espaciado.xs,
  },
}))
