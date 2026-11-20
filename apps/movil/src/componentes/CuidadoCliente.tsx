import { Text, View } from 'react-native'

import { hojaDeTema, usarTema } from '../nucleo/tema'
import { Pastilla } from './Estado'

/**
 * Aviso "Cuidado con este cliente".
 *
 * Se muestra en los clientes marcados `con_alerta` (en el padrón figuran
 * Inhabilitados pero sin el "OK"): el vendedor los sigue viendo y puede operar,
 * pero en AMARILLO con un cartel de peligro, para que vaya con cuidado. La
 * leyenda es fija (así la pidió la oficina).
 */
export const LEYENDA_CUIDADO = 'Cuidado con este cliente'

/** La pastilla ámbar de peligro, para la fila/tarjeta del cliente. */
export function PastillaCuidado() {
  const { colores } = usarTema()
  return <Pastilla texto="⚠ CUIDADO" color={colores.ambar} />
}

/** Fondo ámbar tenue para teñir la fila/tarjeta de un cliente con alerta. */
export function usarFondoCuidado() {
  const { colores } = usarTema()
  return { backgroundColor: colores.ambar + '22', borderColor: colores.ambarOscuro }
}

/**
 * La leyenda chica "⚠ Cuidado con este cliente", para debajo de la fila o en el
 * bloque del cliente ya elegido.
 */
export function LeyendaCuidado() {
  const estilos = usarEstilos()
  return (
    <View style={estilos.fila} accessibilityLiveRegion="polite">
      <Text style={estilos.texto}>⚠ {LEYENDA_CUIDADO}</Text>
    </View>
  )
}

const usarEstilos = hojaDeTema((t) => ({
  fila: {
    marginTop: 4,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
    backgroundColor: t.oscuro ? 'rgba(255,193,94,0.16)' : 'rgba(245,165,36,0.16)',
  },
  texto: {
    color: t.oscuro ? '#FFD79A' : '#6B4708',
    fontSize: 12,
    fontWeight: '700' as const,
  },
}))
