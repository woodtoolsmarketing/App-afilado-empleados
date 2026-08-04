import { colores, espaciado, tipografia } from '@woodtools/compartido'
import { StyleSheet, Text } from 'react-native'

import { BotonPrincipal } from '../componentes/Botones'
import { Encabezado } from '../componentes/Encabezado'
import { BarraPanel, Pantalla, Panel, TituloPanel } from '../componentes/Pantalla'
import type { PropsPantalla } from '../navegacion/tipos'

/**
 * Módulos del menú que se implementan en pasos posteriores.
 *
 * Se muestran igual, con la leyenda de que están por venir: es preferible a
 * ocultarlos, porque el vendedor ve desde el día uno hacia dónde va la app y no
 * interpreta que algo se rompió.
 */
export function PantallaEnPreparacion({ navigation, route }: PropsPantalla<'EnPreparacion'>) {
  return (
    <Pantalla>
      <Encabezado alAbrirMenu={() => navigation.navigate('Configuracion')} />

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

const estilos = StyleSheet.create({
  contenido: { gap: espaciado.base, paddingTop: espaciado.xl },
  icono: { fontSize: 56, textAlign: 'center' },
  texto: {
    fontFamily: tipografia.familia.cuerpo,
    fontSize: tipografia.tamano.sm,
    color: colores.tintaSuave,
    textAlign: 'center',
    lineHeight: tipografia.tamano.sm * tipografia.interlineado.holgado,
    paddingHorizontal: espaciado.md,
  },
})
