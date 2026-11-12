import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { espaciado, radios, TOQUE_MINIMO } from '@woodtools/compartido'
import { Pressable, Text } from 'react-native'

import { hojaDeTema } from '../nucleo/tema'
import type { ParametrosApp } from '../navegacion/tipos'

/**
 * El botón "Reportar un problema" que aparece EN CADA pantalla, con el contexto
 * puesto.
 *
 * ─── Por qué un botón por pantalla y no sólo el del menú ─────────────────────
 *
 * Porque el reporte útil es el que llega con el dato puntual, y ese dato lo
 * tiene la pantalla donde se dio el problema, no el vendedor parado después en
 * el menú tratando de acordarse. El buscador que no encontró al cliente sabe
 * qué código se buscó; la nota sabe con qué cliente se estaba. Este botón abre
 * "Reportar un problema" con el motivo ya elegido (cuando se sabe) y el campo
 * de texto ya escrito con ese contexto (`detalle`), así reportar es tocar y
 * mandar, no volver a contar lo que la app ya sabía.
 *
 * `pantalla` queda guardado en el reporte: no es lo mismo el que reporta desde
 * el buscador que el que reporta desde la impresión. `motivo` se omite a
 * propósito cuando la pantalla cubre varios problemas (la nota de pedido): ahí
 * conviene que el vendedor elija en el desplegable cuál de todos es.
 */
export function BotonReportarProblema({
  pantalla,
  motivo,
  detalle,
  titulo = '⚠ Reportar un problema',
}: {
  /** Desde dónde se reporta. Queda asentado en el reporte. */
  pantalla: string
  /** El motivo de `MOTIVOS_DE_PROBLEMA` a dejar elegido, si la pantalla tiene uno claro. */
  motivo?: string
  /** El contexto con el que arranca escrito el campo de texto. */
  detalle?: string
  /** Para cambiarle el rótulo según la pantalla ("Avisar que no aparece", etc.). */
  titulo?: string
}) {
  const navegacion = useNavigation<NativeStackNavigationProp<ParametrosApp>>()
  const estilos = usarEstilos()

  return (
    <Pressable
      onPress={() => navegacion.navigate('ReportarProblema', { motivo, pantalla, detalle })}
      accessibilityRole="button"
      accessibilityLabel={titulo}
      style={({ pressed }) => [estilos.boton, pressed && estilos.tocado]}
    >
      <Text style={estilos.texto}>{titulo}</Text>
    </Pressable>
  )
}

const usarEstilos = hojaDeTema((t) => ({
  boton: {
    minHeight: TOQUE_MINIMO,
    borderWidth: 2,
    borderColor: t.colores.borde,
    borderRadius: radios.sm,
    backgroundColor: t.colores.panelClaro,
    paddingHorizontal: espaciado.base,
    paddingVertical: espaciado.sm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tocado: { backgroundColor: t.colores.panelOscuro },
  texto: {
    fontFamily: t.tipografia.familia.fuerte,
    fontSize: t.tipografia.tamano.base,
    color: t.colores.tinta,
    textAlign: 'center',
  },
}))
