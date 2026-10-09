import { compararVersiones, espaciado } from '@woodtools/compartido'
import { useQuery } from '@tanstack/react-query'
import { Text, View } from 'react-native'

import { BotonMenu } from '../componentes/Botones'
import { BarraPanel, Pantalla, Panel } from '../componentes/Pantalla'
import { Encabezado } from '../componentes/Encabezado'
import { usarSesion, VERSION_APP } from '../nucleo/sesion'
import { obtenerResumenDeHoy } from '../servicios/jornada'
import { notasPendientes as listarNotasPendientes } from '../servicios/notasPedido'
import { usarPermisos } from '../servicios/permisos'
import type { PropsPantalla } from '../navegacion/tipos'
import { hojaDeTema } from '../nucleo/tema'

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
  const estilos = usarEstilos()
  const perfil = usarSesion((s) => s.perfil)
  // Qué opciones ve este rol. La oficina lo configura desde el panel; admin ve
  // todo. Cada botón de abajo se esconde si el rol no tiene su función.
  const { puedeVer } = usarPermisos()

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
      <Encabezado />

      <Panel contentStyle={estilos.contenido}>
        <BarraPanel />

        <Text style={estilos.titulo} accessibilityRole="header">
          MENÚ
        </Text>

        {puedeVer('visitas') ? (
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
        ) : null}

        {puedeVer('notas_pedido') ? (
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
        ) : null}

        {puedeVer('calendario') ? (
          <BotonMenu
            titulo="CALENDARIO DE VISITAS"
            subtitulo="La semana entera: a quién ver cada día"
            alTocar={() => navigation.navigate('CalendarioVisitas')}
          />
        ) : null}

        {puedeVer('lista_semanal') ? (
          <BotonMenu
            titulo="LISTA SEMANAL"
            subtitulo="A quién visitás cada día, fijo"
            alTocar={() => navigation.navigate('ListaSemanal')}
          />
        ) : null}

        {/*
          El mapa existe desde hace rato: vive adentro de VISITAS → VER
          RECORRIDO. Este botón, en cambio, llevaba a la pantalla "En
          preparación", así que el que buscaba el mapa por su nombre concluía
          que todavía no estaba hecho.
        */}
        {puedeVer('mapa_recorrido') ? (
          <BotonMenu
            titulo="MAPA DE VISITAS"
            subtitulo="El recorrido de hoy sobre el mapa"
            alTocar={() => navigation.navigate('Recorrido')}
          />
        ) : null}

        {/*
          "MAPA" aparece SÓLO en los APK que tienen la clave de Google Maps.

          La pantalla usa react-native-maps (Google Maps). Sin la clave —que va
          DENTRO del APK, no viaja por aire— la vista nativa del mapa CONGELA la
          app. Los APK viejos (interno hasta la 1.0.8) salieron sin la clave, así
          que el botón tiene que quedar oculto ahí, aunque el código llegue por
          OTA. El amarre no puede ser la clave del manifiesto —el OTA la
          reescribe con la del `.env` de quien publica— sino la VERSIÓN NATIVA
          del APK, que el OTA no puede falsear: de la 1.0.9 en adelante todos los
          APK se compilan con la clave (ver eas.json), así que ésa es la línea.
        */}
        {compararVersiones(VERSION_APP, '1.0.9') >= 0 && puedeVer('mapa_clientes') ? (
          <BotonMenu
            titulo="MAPA"
            subtitulo="Todos los clientes ubicados, alrededor tuyo"
            alTocar={() => navigation.navigate('MapaClientes')}
          />
        ) : null}

        {puedeVer('clientes_hoy') ? (
          <BotonMenu
            titulo="CLIENTES DE HOY"
            subtitulo="A quién te toca visitar, para armar el recorrido"
            alTocar={() => navigation.navigate('ClientesDelDia')}
          />
        ) : null}

        {puedeVer('proximas_visitas') ? (
          <BotonMenu
            titulo="PRÓXIMAS VISITAS"
            subtitulo="Lo agendado para los próximos días"
            alTocar={() => navigation.navigate('CalendarioEnvios')}
          />
        ) : null}

        {/* Cobranzas y todo lo demás ya no se gatean a mano acá: lo decide la
            matriz de permisos del panel (Cobranzas arranca admin-only). La ruta
            también se gatea, ver Navegacion. */}
        {puedeVer('cobranzas') ? (
          <BotonMenu
            titulo="HISTORIAL DE COBRANZAS"
            subtitulo="Lo que cobraste hoy, y la planilla para rendir"
            alTocar={() => navigation.navigate('Cobranzas')}
          />
        ) : null}

        {puedeVer('comunicacion_interna') ? (
          <BotonMenu
            titulo="COMUNICACIÓN INTERNA"
            subtitulo="Los teléfonos de la oficina, a un toque"
            alTocar={() => navigation.navigate('ComunicacionInterna')}
          />
        ) : null}

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

const usarEstilos = hojaDeTema((t) => ({
  contenido: {
    gap: espaciado.md,
  },
  titulo: {
    fontFamily: t.tipografia.familia.titulo,
    fontSize: t.tipografia.tamano.xl,
    color: t.colores.tinta,
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
    fontFamily: t.tipografia.familia.liviana,
    fontSize: t.tipografia.tamano.micro,
    color: t.colores.tintaTenue,
  },
}))
