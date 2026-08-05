import { colores, espaciado, tipografia } from '@woodtools/compartido'
import { useQuery } from '@tanstack/react-query'
import { StyleSheet, Text } from 'react-native'

import { BotonMenu } from '../componentes/Botones'
import { Encabezado } from '../componentes/Encabezado'
import { BarraPanel, Pantalla, Panel, TituloPanel } from '../componentes/Pantalla'
import { notasPendientes } from '../servicios/notasPedido'
import type { PropsPantalla } from '../navegacion/tipos'

/**
 * "NOTAS DE PEDIDO PENDIENTES: 7"
 *
 * Menú del módulo. El contador de pendientes es el dato que el vendedor mira
 * primero, así que va en el título y no escondido adentro de una opción.
 */
export function PantallaNotasPedido({ navigation }: PropsPantalla<'NotasPedido'>) {
  const { data: pendientes } = useQuery({
    queryKey: ['notas-pendientes'],
    queryFn: notasPendientes,
    refetchOnWindowFocus: true,
  })

  const cantidad = pendientes?.length ?? 0

  return (
    <Pantalla>
      <Encabezado alAbrirMenu={() => navigation.navigate('Configuracion')} />

      <Panel contentStyle={estilos.contenido}>
        <BarraPanel alVolver={() => navigation.goBack()} />

        <TituloPanel destacado={String(cantidad)}>NOTAS DE PEDIDO PENDIENTES:</TituloPanel>

        <BotonMenu
          titulo={'GENERAR NUEVA NOTA\nDE PEDIDO'}
          alTocar={() => navigation.navigate('GenerarNota')}
        />

        <BotonMenu
          titulo={'VER NOTAS DE PEDIDO\nPENDIENTES'}
          subtitulo={cantidad === 0 ? 'No tenés notas pendientes' : undefined}
          alTocar={() => navigation.navigate('NotasPendientes')}
          deshabilitado={cantidad === 0}
        />

        <BotonMenu
          titulo={'IMPRIMIR NOTAS DE\nPEDIDO PENDIENTES'}
          subtitulo={cantidad > 0 ? `${cantidad} nota${cantidad === 1 ? '' : 's'} y el rol de visita` : undefined}
          alTocar={() => navigation.navigate('NotasPendientes')}
          deshabilitado={cantidad === 0}
        />

        <BotonMenu
          titulo={'HISTORIAL DE NOTAS DE\nPEDIDO'}
          alTocar={() => navigation.navigate('HistorialNotas')}
        />

        <Text style={estilos.pie}>
          Las notas de clientes nuevos quedan sin número hasta que Administración les asigne el
          código de cliente.
        </Text>
      </Panel>
    </Pantalla>
  )
}

const estilos = StyleSheet.create({
  contenido: { gap: espaciado.md },
  pie: {
    fontFamily: tipografia.familia.liviana,
    fontSize: tipografia.tamano.micro,
    color: colores.tintaTenue,
    textAlign: 'center',
    marginTop: espaciado.base,
    lineHeight: tipografia.tamano.micro * 1.6,
  },
})
