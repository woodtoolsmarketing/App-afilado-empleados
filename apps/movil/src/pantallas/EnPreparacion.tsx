import { espaciado } from '@woodtools/compartido'
import { Text } from 'react-native'

import { BotonPrincipal } from '../componentes/Botones'
import { Encabezado } from '../componentes/Encabezado'
import { BarraPanel, Pantalla, Panel, TituloPanel } from '../componentes/Pantalla'
import type { PropsPantalla } from '../navegacion/tipos'
import { hojaDeTema } from '../nucleo/tema'

/**
 * Módulos del menú que se implementan en pasos posteriores.
 *
 * Se muestran igual, con la leyenda de que están por venir: es preferible a
 * ocultarlos, porque el vendedor ve desde el día uno hacia dónde va la app y no
 * interpreta que algo se rompió.
 */
export function PantallaEnPreparacion({ navigation, route }: PropsPantalla<'EnPreparacion'>) {
  const estilos = usarEstilos()
  return (
    <Pantalla>
      <Encabezado />

      <Panel contentStyle={estilos.contenido}>
        <BarraPanel alVolver={() => navigation.goBack()} />

        <Text style={estilos.icono}>🚧</Text>
        <TituloPanel>{route.params.modulo.toUpperCase()}</TituloPanel>

        <Text style={estilos.texto}>
          Este módulo todavía no está habilitado. Se suma en uno de los próximos pasos, junto con el
          resto de las funciones del menú.
        </Text>

        <BotonPrincipal titulo="VOLVER AL MENÚ" alTocar={() => navigation.navigate('Menu')} />
      </Panel>
    </Pantalla>
  )
}

const usarEstilos = hojaDeTema((t) => ({
  contenido: { gap: espaciado.base, paddingTop: espaciado.xl },
  icono: { fontSize: 56, textAlign: 'center' },
  texto: {
    fontFamily: t.tipografia.familia.cuerpo,
    fontSize: t.tipografia.tamano.sm,
    color: t.colores.tintaSuave,
    textAlign: 'center',
    lineHeight: t.tipografia.tamano.sm * t.tipografia.interlineado.holgado,
    paddingHorizontal: espaciado.md,
  },
}))
