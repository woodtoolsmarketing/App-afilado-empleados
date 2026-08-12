import { colores } from '@woodtools/compartido'
import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native'

import { Campo, type PropsCampo } from './Formulario'
import { Aviso } from './Estado'
import { DURACION_MAXIMA_MS, usarDictado } from '../servicios/transcripcion'

/**
 * Campo de texto con micrófono.
 *
 * Encapsula el ciclo grabar → transcribir → agregar al texto, que se repite en
 * "Datos del cliente", "Descripción general de la herramienta" y la observación
 * de la visita. Lo dictado se **suma** a lo que ya había escrito en vez de
 * pisarlo: el vendedor arranca tipeando y termina hablando, o al revés.
 */
export function CampoDictado({
  valor,
  alCambiar,
  alCambiarOrigen,
  ...props
}: Omit<PropsCampo, 'value' | 'onChangeText' | 'accesorio'> & {
  valor: string
  alCambiar: (texto: string) => void
  /** Deja registro de si el texto se escribió o se dictó. */
  alCambiarOrigen?: (origen: 'texto' | 'voz') => void
}) {
  const dictado = usarDictado()

  async function alTocarMicrofono() {
    // Grabando, o con audio esperando que lo pasen a texto: en los dos casos
    // el micrófono transcribe. Arrancar una grabación nueva encima tiraría lo
    // que el vendedor ya dijo.
    if (dictado.grabando || dictado.audioPendiente) {
      const texto = await dictado.detenerYTranscribir()
      if (texto) {
        const separador = valor.trim() ? ' ' : ''
        alCambiar(`${valor.trim()}${separador}${texto}`)
        alCambiarOrigen?.('voz')
      }
      return
    }
    await dictado.comenzar()
  }

  return (
    <>
      <Campo
        {...props}
        value={valor}
        onChangeText={(t) => {
          alCambiar(t)
          alCambiarOrigen?.('texto')
        }}
        multiline
        numberOfLines={4}
        accesorio={
          <Pressable
            onPress={alTocarMicrofono}
            disabled={dictado.transcribiendo}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={
              dictado.grabando ? 'Detener grabación y transcribir' : 'Dictar con el micrófono'
            }
            style={({ pressed }) => [
              estilos.microfono,
              dictado.grabando && estilos.grabando,
              pressed && estilos.presionado,
            ]}
          >
            {dictado.transcribiendo ? (
              <ActivityIndicator size="small" color={colores.blanco} />
            ) : (
              <Text style={estilos.icono}>{dictado.grabando ? '⏹' : '🎤'}</Text>
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
    </>
  )
}

const estilos = StyleSheet.create({
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
  grabando: { backgroundColor: colores.rojoAccion },
  presionado: { opacity: 0.75 },
  icono: { fontSize: 20 },
})
