import { Modal, Text, View } from 'react-native'

import { usarDescargaApk } from '../nucleo/descargaApk'
import { hojaDeTema } from '../nucleo/tema'
import { BotonPrincipal, BotonSecundario } from './Botones'

/**
 * El modal de "bajando la actualización", montado una sola vez en la raíz.
 *
 * Se muestra solo cuando el store `usarDescargaApk` está bajando o falló. Mientras
 * baja no se puede cerrar (cortar a medias deja un APK corrupto). Al terminar, el
 * instalador de Android toma el control y el store se vuelve a 'idle'.
 */
export function DescargaDeApk() {
  const estado = usarDescargaApk((s) => s.estado)
  const progreso = usarDescargaApk((s) => s.progreso)
  const error = usarDescargaApk((s) => s.error)
  const apk = usarDescargaApk((s) => s.apk)
  const iniciar = usarDescargaApk((s) => s.iniciar)
  const cerrar = usarDescargaApk((s) => s.cerrar)
  const estilos = usarEstilos()

  const pct = Math.max(0, Math.min(100, Math.round(progreso * 100)))

  return (
    <Modal transparent visible={estado !== 'idle'} animationType="fade" onRequestClose={cerrar}>
      <View style={estilos.velo}>
        <View style={estilos.tarjeta}>
          {estado === 'bajando' ? (
            <>
              <Text style={estilos.titulo}>Bajando la actualización…</Text>
              <Text style={estilos.pct}>{pct}%</Text>
              <View style={estilos.barra}>
                <View style={[estilos.barraLlena, { width: `${pct}%` }]} />
              </View>
              <Text style={estilos.ayuda}>
                No cierres la app. Cuando termine, Android te va a pedir confirmar la instalación.
              </Text>
            </>
          ) : estado === 'error' ? (
            <>
              <Text style={estilos.titulo}>No se pudo actualizar</Text>
              <Text style={estilos.ayuda}>{error}</Text>
              <View style={estilos.botones}>
                {apk ? <BotonPrincipal titulo="Reintentar" alTocar={() => iniciar(apk)} /> : null}
                <BotonSecundario titulo="Cerrar" alTocar={cerrar} />
              </View>
            </>
          ) : null}
        </View>
      </View>
    </Modal>
  )
}

const usarEstilos = hojaDeTema((t) => ({
  velo: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    padding: 24,
  },
  tarjeta: {
    width: '100%' as const,
    maxWidth: 420,
    backgroundColor: t.colores.panel,
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: t.colores.borde,
  },
  titulo: {
    color: t.colores.tinta,
    fontSize: 18,
    fontWeight: '700' as const,
    textAlign: 'center' as const,
  },
  pct: {
    color: t.colores.rojo,
    fontSize: 34,
    fontWeight: '800' as const,
    textAlign: 'center' as const,
    marginVertical: 8,
  },
  barra: {
    height: 12,
    borderRadius: 6,
    backgroundColor: t.colores.campo,
    overflow: 'hidden' as const,
  },
  barraLlena: {
    height: '100%' as const,
    backgroundColor: t.colores.rojo,
  },
  ayuda: {
    color: t.colores.tintaSuave,
    fontSize: 14,
    textAlign: 'center' as const,
    marginTop: 12,
  },
  botones: {
    marginTop: 16,
    gap: 10,
  },
}))
