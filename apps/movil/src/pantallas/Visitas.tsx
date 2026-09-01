import { espaciado, formatearDistancia, formatearDuracion } from '@woodtools/compartido'
import { useQuery } from '@tanstack/react-query'
import { Text, View } from 'react-native'

import { BotonMenu } from '../componentes/Botones'
import { Aviso, Cargando } from '../componentes/Estado'
import { Encabezado } from '../componentes/Encabezado'
import { BarraPanel, Pantalla, Panel, TituloPanel } from '../componentes/Pantalla'
import { usarSesion } from '../nucleo/sesion'
import { obtenerResumenDeHoy } from '../servicios/jornada'
import type { PropsPantalla } from '../navegacion/tipos'
import { hojaDeTema, usarTema } from '../nucleo/tema'

/**
 * "TUS VISITAS DE HOY SON: 13"
 *
 * Es el centro de la app. Muestra cuántos destinos quedan y da las cuatro
 * acciones del mockup.
 */
export function PantallaVisitas({ navigation }: PropsPantalla<'Visitas'>) {
  const { colores } = usarTema()
  const estilos = usarEstilos()
  const perfil = usarSesion((s) => s.perfil)

  const {
    data: resumen,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['resumen-hoy', perfil?.id],
    queryFn: () => obtenerResumenDeHoy(perfil!.id),
    enabled: !!perfil,
  })

  const enCurso = resumen?.estado === 'en_curso'
  const finalizada = resumen?.estado === 'finalizado'
  const pendientes = resumen ? resumen.pendientes + resumen.en_camino : 0

  return (
    <Pantalla>
      <Encabezado />

      <Panel contentStyle={estilos.contenido}>
        <BarraPanel alVolver={() => navigation.goBack()} />

        {isLoading ? (
          <Cargando texto="Buscando tus visitas de hoy…" />
        ) : error ? (
          <Aviso tono="error" titulo="No pudimos cargar tus visitas">
            Revisá la conexión y volvé a entrar. Si el problema sigue, avisá a la oficina.
          </Aviso>
        ) : (
          <>
            <TituloPanel destacado={String(resumen?.total_paradas ?? 0)}>
              TUS VISITAS DE HOY SON:
            </TituloPanel>

            {resumen && resumen.total_paradas > 0 ? (
              <View style={estilos.marcadores}>
                <Marcador etiqueta="Pendientes" valor={pendientes} color={colores.estadoPendiente} />
                <Marcador etiqueta="Visitados" valor={resumen.visitadas} color={colores.estadoVisitada} />
                <Marcador etiqueta="Sin visitar" valor={resumen.no_visitadas} color={colores.estadoNoVisitada} />
              </View>
            ) : null}

            {resumen?.distancia_total_m ? (
              <Text style={estilos.estimacion}>
                Recorrido estimado: {formatearDistancia(resumen.distancia_total_m)} ·{' '}
                {formatearDuracion(resumen.duracion_total_seg)}
              </Text>
            ) : null}

            {finalizada ? (
              <Aviso tono="exito" titulo="Recorrido finalizado">
                Cerraste la jornada de hoy. Podés revisar lo cargado desde el historial.
              </Aviso>
            ) : null}

            {resumen && resumen.total_paradas === 0 ? (
              <Aviso tono="atencion" titulo="Todavía no tenés destinos cargados">
                La oficina arma el rol de visita del día. Igual podés agregar un destino a mano.
              </Aviso>
            ) : null}

            <BotonMenu
              titulo={'VER RECORRIDO\nDEL DÍA DE HOY'}
              alTocar={() => navigation.navigate('Recorrido')}
              deshabilitado={!resumen || resumen.total_paradas === 0}
            />

            {/*
              Sin `deshabilitado`: agregar un destino reabre la jornada. Con la
              jornada cerrada, éste y el de Recorrido son los dos únicos accesos
              al alta, así que deshabilitarlos dejaba al vendedor sin forma de
              registrar una visita el resto del día.
            */}
            <BotonMenu
              titulo={'AGREGAR\nNUEVO DESTINO'}
              alTocar={() => navigation.navigate('AgregarDestino', {})}
            />

            <BotonMenu
              titulo={'HISTORIAL DE\nVISITAS'}
              alTocar={() => navigation.navigate('Historial')}
            />

            <BotonMenu
              titulo={enCurso ? 'SEGUIR RECORRIDO' : 'INICIAR RECORRIDO'}
              subtitulo={
                enCurso
                  ? 'El recorrido ya está en curso'
                  : 'La oficina va a ver tu ubicación mientras dure'
              }
              alTocar={() => navigation.navigate('Recorrido', { iniciar: true })}
              deshabilitado={!resumen || resumen.total_paradas === 0 || finalizada}
            />
          </>
        )}
      </Panel>
    </Pantalla>
  )
}

function Marcador({ etiqueta, valor, color }: { etiqueta: string; valor: number; color: string }) {
  const estilos = usarEstilos()
  return (
    <View style={estilos.marcador}>
      <Text style={[estilos.marcadorValor, { color }]}>{valor}</Text>
      <Text style={estilos.marcadorEtiqueta}>{etiqueta}</Text>
    </View>
  )
}

const usarEstilos = hojaDeTema((t) => ({
  contenido: {
    gap: espaciado.md,
  },
  marcadores: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: espaciado.sm,
  },
  marcador: {
    alignItems: 'center',
    minWidth: 84,
  },
  marcadorValor: {
    fontFamily: t.tipografia.familia.titulo,
    fontSize: t.tipografia.tamano.xxl,
  },
  marcadorEtiqueta: {
    fontFamily: t.tipografia.familia.cuerpo,
    fontSize: t.tipografia.tamano.micro,
    color: t.colores.tintaSuave,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  estimacion: {
    fontFamily: t.tipografia.familia.cuerpo,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.tintaSuave,
    textAlign: 'center',
  },
}))
