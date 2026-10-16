import Constants from 'expo-constants'
import * as Device from 'expo-device'
import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'

import { obtenerInstalacionId } from '../nucleo/dispositivo'
import { supabase } from '../nucleo/supabase'

/**
 * Notificaciones push del teléfono.
 *
 * Hoy se usan para un solo aviso: cuando la oficina le agrega un destino al
 * recorrido del vendedor, para que lo vea aunque no tenga la app abierta. El
 * envío lo hace la Edge Function `enviar-push` con el token que acá se guarda.
 *
 * El token de push a Android pasa por FCM (Google). Si el proyecto todavía no
 * tiene FCM configurado —o el vendedor no da el permiso, o no hay señal—, esto
 * no arma nada y la app sigue igual: el push es un agregado, no un requisito.
 */

// Con la app ABIERTA, mostrar igual la notificación (banner + sonido); si no,
// una notificación que llega mientras el vendedor está en la app pasa muda.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
})

/** El canal de Android. El nombre es el que ve el vendedor en los ajustes del SO. */
export const CANAL_RECORRIDO = 'recorrido'

/**
 * Pide permiso de notificaciones, toma el token de push de este teléfono y lo
 * guarda en `dispositivos.push_token` (del perfil + instalación actuales). Todo
 * best-effort y tragado: se llama después de registrar el dispositivo en el login.
 */
export async function registrarPushDeEsteTelefono(perfilId: string): Promise<void> {
  try {
    // En un emulador no hay push: evitamos el error y seguimos.
    if (!Device.isDevice) return

    // Android exige un canal para que la notificación suene y aparezca.
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(CANAL_RECORRIDO, {
        name: 'Recorrido',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
      })
    }

    const previo = await Notifications.getPermissionsAsync()
    let concedido = previo.granted
    if (!concedido && previo.canAskAgain) {
      concedido = (await Notifications.requestPermissionsAsync()).granted
    }
    if (!concedido) return

    const projectId = (
      Constants.expoConfig?.extra?.eas as { projectId?: string } | undefined
    )?.projectId
    if (!projectId) return

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId })
    if (!token) return

    const instalacionId = await obtenerInstalacionId()
    await supabase
      .from('dispositivos')
      .update({ push_token: token })
      .eq('perfil_id', perfilId)
      .eq('instalacion_id', instalacionId)
  } catch {
    /* sin permiso / sin FCM / sin señal: el push no se arma, la app sigue */
  }
}
