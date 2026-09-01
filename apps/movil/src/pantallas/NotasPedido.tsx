import { espaciado } from '@woodtools/compartido'
import { useQuery } from '@tanstack/react-query'
import { Text } from 'react-native'

import { BotonMenu, BotonSecundario } from '../componentes/Botones'
import { Aviso } from '../componentes/Estado'
import { Encabezado } from '../componentes/Encabezado'
import { BarraPanel, Pantalla, Panel, TituloPanel } from '../componentes/Pantalla'
import { notasPendientes } from '../servicios/notasPedido'
import type { PropsPantalla } from '../navegacion/tipos'
import { hojaDeTema } from '../nucleo/tema'

/**
 * "NOTAS DE PEDIDO PENDIENTES: 7"
 *
 * Menú del módulo. El contador de pendientes es el dato que el vendedor mira
 * primero, así que va en el título y no escondido adentro de una opción.
 */
export function PantallaNotasPedido({ navigation }: PropsPantalla<'NotasPedido'>) {
  const estilos = usarEstilos()
  const {
    data: pendientes,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['notas-pendientes'],
    queryFn: notasPendientes,
    refetchOnWindowFocus: true,
  })

  const cantidad = pendientes?.length ?? 0
  /**
   * "Todavía no llegó" y "falló la consulta" no son cero.
   *
   * Con `pendientes?.length ?? 0` los tres casos se veían iguales: el título
   * decía 0, los dos botones quedaban en gris y el vendedor concluía que sus
   * notas se habían perdido. Mientras no sepamos, no se afirma nada ni se
   * traba nada: la pantalla siguiente tiene su propio estado de error.
   */
  const sabemos = !isLoading && !error

  return (
    <Pantalla>
      <Encabezado />

      <Panel contentStyle={estilos.contenido}>
        <BarraPanel alVolver={() => navigation.goBack()} />

        <TituloPanel destacado={sabemos ? String(cantidad) : '—'}>
          NOTAS DE PEDIDO PENDIENTES:
        </TituloPanel>

        {error ? (
          <Aviso tono="atencion" titulo="No pudimos consultar tus notas pendientes">
            Revisá la señal. Tus notas están guardadas: esto es sólo que no pudimos contarlas.
          </Aviso>
        ) : null}

        {error ? <BotonSecundario titulo="↻  Reintentar" alTocar={() => void refetch()} /> : null}

        <BotonMenu
          titulo={'GENERAR NUEVA NOTA\nDE PEDIDO'}
          alTocar={() => navigation.navigate('GenerarNota')}
        />

        <BotonMenu
          titulo={'VER NOTAS DE PEDIDO\nPENDIENTES'}
          subtitulo={
            sabemos && cantidad === 0 ? 'No tenés notas pendientes' : 'Se pueden corregir'
          }
          alTocar={() => navigation.navigate('NotasPendientes')}
          deshabilitado={sabemos && cantidad === 0}
        />

        {/* Las que ya salieron en papel van aparte. Es el corte que decide si
            una nota todavía se puede tocar: mientras no se imprimió, lo que
            dice no llegó a nadie. */}
        <BotonMenu
          titulo={'NOTAS DE PEDIDO\nIMPRESAS'}
          subtitulo="Se miran y se reimprimen; no se editan"
          alTocar={() => navigation.navigate('NotasImpresas')}
        />

        <BotonMenu
          titulo={'IMPRIMIR NOTAS DE\nPEDIDO PENDIENTES'}
          subtitulo={cantidad > 0 ? `${cantidad} nota${cantidad === 1 ? '' : 's'} y el rol de visita` : undefined}
          alTocar={() => navigation.navigate('NotasPendientes')}
          deshabilitado={sabemos && cantidad === 0}
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

const usarEstilos = hojaDeTema((t) => ({
  contenido: { gap: espaciado.md },
  pie: {
    fontFamily: t.tipografia.familia.liviana,
    fontSize: t.tipografia.tamano.micro,
    color: t.colores.tintaTenue,
    textAlign: 'center',
    marginTop: espaciado.base,
    lineHeight: t.tipografia.tamano.micro * 1.6,
  },
}))
