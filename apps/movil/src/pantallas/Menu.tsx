import { colores, espaciado, tipografia } from '@woodtools/compartido'
import { useQuery } from '@tanstack/react-query'
import { StyleSheet, Text, View } from 'react-native'

import { BotonMenu } from '../componentes/Botones'
import { BarraPanel, Pantalla, Panel } from '../componentes/Pantalla'
import { Encabezado } from '../componentes/Encabezado'
import { usarSesion } from '../nucleo/sesion'
import { obtenerResumenDeHoy } from '../servicios/jornada'
import { notasPendientes as listarNotasPendientes } from '../servicios/notasPedido'
import type { PropsPantalla } from '../navegacion/tipos'

/**
 * Menú principal.
 *
 * Decisión de diseño: se sacó el botón "CONTINUAR" del mockup. Con una lista de
 * botones grandes, exigir "elegir y después confirmar" duplica los toques sin
 * aportar nada — y en la calle, con una mano, cada toque cuenta. Cada opción
 * entra directo.
 *
 * Las opciones que todavía no están implementadas se muestran igual, atenuadas
 * y con la leyenda de cuándo se habilitan, para que el vendedor sepa que la app
 * va a crecer y no piense que algo se rompió.
 */
export function PantallaMenu({ navigation }: PropsPantalla<'Menu'>) {
  const perfil = usarSesion((s) => s.perfil)

  const { data: resumen } = useQuery({
    queryKey: ['resumen-hoy', perfil?.id],
    queryFn: () => obtenerResumenDeHoy(perfil!.id),
    enabled: !!perfil,
    refetchOnWindowFocus: true,
  })

  const pendientes = resumen ? resumen.total_paradas - resumen.visitadas - resumen.no_visitadas : null

  const { data: notas } = useQuery({
    queryKey: ['notas-pendientes'],
    queryFn: listarNotasPendientes,
    enabled: !!perfil,
  })
  const notasPendientes = notas?.length

  return (
    <Pantalla>
      <Encabezado alAbrirMenu={() => navigation.navigate('Configuracion')} />

      <Panel contentStyle={estilos.contenido}>
        <BarraPanel />

        <Text style={estilos.titulo} accessibilityRole="header">
          MENÚ
        </Text>

        <BotonMenu
          titulo="VISITAS"
          subtitulo={
            pendientes === null
              ? undefined
              : pendientes > 0
                ? `${pendientes} destino${pendientes === 1 ? '' : 's'} pendiente${pendientes === 1 ? '' : 's'} hoy`
                : 'Sin destinos pendientes hoy'
          }
          alTocar={() => navigation.navigate('Visitas')}
        />

        <BotonMenu
          titulo="NOTAS DE PEDIDO"
          subtitulo={
            notasPendientes === undefined
              ? undefined
              : notasPendientes > 0
                ? `${notasPendientes} pendiente${notasPendientes === 1 ? '' : 's'}`
                : 'Sin notas pendientes'
          }
          alTocar={() => navigation.navigate('NotasPedido')}
        />

        <BotonMenu
          titulo="CALENDARIO DE VISITAS"
          subtitulo="Se habilita en el próximo paso"
          alTocar={() => navigation.navigate('EnPreparacion', { modulo: 'Calendario de visitas' })}
          style={estilos.futuro}
        />

        {/*
          El mapa existe desde hace rato: vive adentro de VISITAS → VER
          RECORRIDO. Este botón, en cambio, llevaba a la pantalla "En
          preparación", así que el que buscaba el mapa por su nombre concluía
          que todavía no estaba hecho.
        */}
        <BotonMenu
          titulo="MAPA DE VISITAS"
          subtitulo="El recorrido de hoy sobre el mapa"
          alTocar={() => navigation.navigate('Recorrido')}
        />

        <BotonMenu
          titulo="COMUNICACIÓN INTERNA"
          subtitulo="Se habilita en el próximo paso"
          alTocar={() => navigation.navigate('EnPreparacion', { modulo: 'Comunicación interna' })}
          style={estilos.futuro}
        />

        <BotonMenu
          titulo="CONFIGURACIÓN"
          alTocar={() => navigation.navigate('Configuracion')}
        />

        <View style={estilos.pie}>
          <Text style={estilos.pieTexto}>WoodTools S.R.L. · Uso interno</Text>
        </View>
      </Panel>
    </Pantalla>
  )
}

const estilos = StyleSheet.create({
  contenido: {
    gap: espaciado.md,
  },
  titulo: {
    fontFamily: tipografia.familia.titulo,
    fontSize: tipografia.tamano.xl,
    color: colores.tinta,
    textAlign: 'center',
    letterSpacing: 1,
    marginBottom: espaciado.xs,
  },
  futuro: {
    opacity: 0.62,
  },
  pie: {
    alignItems: 'center',
    paddingTop: espaciado.base,
  },
  pieTexto: {
    fontFamily: tipografia.familia.liviana,
    fontSize: tipografia.tamano.micro,
    color: colores.tintaTenue,
  },
})
