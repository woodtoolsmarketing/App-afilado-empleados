import { colores, espaciado, radios, tipografia } from '@woodtools/compartido'
import Constants from 'expo-constants'
import * as Updates from 'expo-updates'
import { useEffect, useState } from 'react'
import { Alert, StyleSheet, Text, View } from 'react-native'

import { BotonMenu, BotonSecundario } from '../componentes/Botones'
import { Aviso } from '../componentes/Estado'
import { Encabezado } from '../componentes/Encabezado'
import { BarraPanel, Pantalla, Panel, TituloPanel } from '../componentes/Pantalla'
import { obtenerInstalacionId } from '../nucleo/dispositivo'
import { etiquetaVendedor, usarSesion } from '../nucleo/sesion'
import { obtenerJornadaDeHoy } from '../servicios/jornada'
import {
  detenerSeguimiento,
  iniciarSeguimiento,
  seguimientoActivo,
} from '../servicios/ubicacion'
import type { PropsPantalla } from '../navegacion/tipos'

/** Configuración: datos de la cuenta, estado del seguimiento y actualizaciones. */
export function PantallaConfiguracion({ navigation }: PropsPantalla<'Configuracion'>) {
  const { perfil, cerrarSesion } = usarSesion()
  const [instalacion, setInstalacion] = useState('')
  const [siguiendo, setSiguiendo] = useState(false)
  const [buscandoUpdate, setBuscandoUpdate] = useState(false)
  const [cambiandoSeguimiento, setCambiandoSeguimiento] = useState(false)
  /** Id de la jornada de hoy si está abierta. Es lo que permite reanudar. */
  const [jornadaAbierta, setJornadaAbierta] = useState<string | null>(null)

  useEffect(() => {
    void obtenerInstalacionId().then((id) => setInstalacion(id.slice(0, 8).toUpperCase()))
    void seguimientoActivo().then(setSiguiendo)
    if (perfil) {
      void obtenerJornadaDeHoy(perfil.id)
        .then((d) =>
          setJornadaAbierta(
            d?.jornada && d.jornada.estado !== 'finalizado' ? d.jornada.id : null,
          ),
        )
        .catch(() => setJornadaAbierta(null))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perfil?.id])

  async function buscarActualizacion() {
    setBuscandoUpdate(true)
    try {
      const resultado = await Updates.checkForUpdateAsync()
      if (!resultado.isAvailable) {
        Alert.alert('Todo al día', 'Estás usando la última versión de la app.')
        return
      }
      await Updates.fetchUpdateAsync()
      Alert.alert('Actualización lista', 'La app se va a reiniciar para aplicarla.', [
        { text: 'Reiniciar', onPress: () => void Updates.reloadAsync() },
      ])
    } catch {
      Alert.alert(
        'No pudimos buscar actualizaciones',
        'Revisá la conexión. Si el problema sigue, avisá a la oficina.',
      )
    } finally {
      setBuscandoUpdate(false)
    }
  }

  return (
    <Pantalla>
      <Encabezado alAbrirMenu={() => navigation.navigate('Menu')} />

      <Panel contentStyle={estilos.contenido}>
        <BarraPanel alVolver={() => navigation.goBack()} />

        <TituloPanel>CONFIGURACIÓN</TituloPanel>

        <View style={estilos.tarjeta}>
          <Text style={estilos.tarjetaTitulo}>TU CUENTA</Text>
          <Dato etiqueta="Nombre" valor={perfil?.nombre_completo ?? '—'} />
          <Dato etiqueta="Rol" valor={etiquetaVendedor(perfil)} />
          <Dato etiqueta="Usuario" valor={perfil?.email ?? '—'} />
          <Dato etiqueta="Teléfono" valor={perfil?.telefono ?? 'Sin cargar'} />
        </View>

        <View style={estilos.tarjeta}>
          <Text style={estilos.tarjetaTitulo}>ESTE TELÉFONO</Text>
          <Dato etiqueta="Código" valor={instalacion} />
          <Dato
            etiqueta="Versión"
            valor={`${Constants.expoConfig?.version ?? '—'} (${Constants.expoConfig?.extra?.variante ?? 'interno'})`}
          />
          <Dato etiqueta="Seguimiento" valor={siguiendo ? 'Activo' : 'Detenido'} />
        </View>

        {siguiendo ? (
          <Aviso tono="atencion" titulo="Seguimiento activo">
            La oficina está viendo tu ubicación. Se corta solo al finalizar el recorrido.
          </Aviso>
        ) : null}

        {/*
          El botón alterna. Antes sólo aparecía con el seguimiento activo, y su
          propia acción lo desmontaba: era una puerta de un solo sentido. El
          cartel prometía "el recorrido sigue abierto", pero no había forma de
          volver a prenderlo sin cerrar la jornada y empezar otra.
        */}
        {jornadaAbierta ? (
          <BotonSecundario
            titulo={siguiendo ? 'Detener el seguimiento' : 'Reanudar el seguimiento'}
            cargando={cambiandoSeguimiento}
            alTocar={() =>
              siguiendo
                ? Alert.alert(
                    'Detener el seguimiento',
                    'La oficina va a dejar de ver tu ubicación. El recorrido sigue abierto y lo podés reanudar desde acá mismo.',
                    [
                      { text: 'Volver', style: 'cancel' },
                      {
                        text: 'Detener',
                        style: 'destructive',
                        onPress: async () => {
                          setCambiandoSeguimiento(true)
                          try {
                            await detenerSeguimiento(perfil?.id)
                            setSiguiendo(false)
                          } finally {
                            setCambiandoSeguimiento(false)
                          }
                        },
                      },
                    ],
                  )
                : void (async () => {
                    setCambiandoSeguimiento(true)
                    try {
                      await iniciarSeguimiento({
                        vendedorId: perfil!.id,
                        rolVisitaId: jornadaAbierta,
                      })
                      setSiguiendo(true)
                    } catch (e) {
                      Alert.alert('No pudimos reanudar el seguimiento', (e as Error).message)
                    } finally {
                      setCambiandoSeguimiento(false)
                    }
                  })()
            }
          />
        ) : null}

        <BotonSecundario
          titulo="Buscar actualizaciones"
          alTocar={buscarActualizacion}
          cargando={buscandoUpdate}
        />

        <BotonMenu
          titulo="CERRAR SESIÓN"
          alTocar={() =>
            Alert.alert('Cerrar sesión', '¿Seguro que querés salir?', [
              { text: 'Volver', style: 'cancel' },
              { text: 'Salir', style: 'destructive', onPress: () => void cerrarSesion() },
            ])
          }
        />

        <Text style={estilos.pie}>
          WoodTools S.R.L. · Aplicación de uso interno.{'\n'}
          Tu ubicación se registra únicamente mientras el recorrido está en curso.
        </Text>
      </Panel>
    </Pantalla>
  )
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <View style={estilos.dato}>
      <Text style={estilos.datoEtiqueta}>{etiqueta}</Text>
      <Text style={estilos.datoValor} numberOfLines={1}>
        {valor}
      </Text>
    </View>
  )
}

const estilos = StyleSheet.create({
  contenido: { gap: espaciado.md },
  tarjeta: {
    backgroundColor: colores.campoBlanco,
    borderWidth: 2,
    borderColor: colores.negro,
    borderRadius: radios.sm,
    padding: espaciado.md,
  },
  tarjetaTitulo: {
    fontFamily: tipografia.familia.subtitulo,
    fontSize: tipografia.tamano.sm,
    color: colores.rojo,
    letterSpacing: 1,
    marginBottom: espaciado.sm,
  },
  dato: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: espaciado.md,
    paddingVertical: espaciado.sm,
    borderBottomWidth: 1,
    borderBottomColor: colores.panelOscuro,
  },
  datoEtiqueta: {
    fontFamily: tipografia.familia.cuerpo,
    fontSize: tipografia.tamano.xs,
    color: colores.tintaSuave,
  },
  datoValor: {
    flexShrink: 1,
    fontFamily: tipografia.familia.fuerte,
    fontSize: tipografia.tamano.sm,
    color: colores.tinta,
  },
  pie: {
    fontFamily: tipografia.familia.liviana,
    fontSize: tipografia.tamano.micro,
    color: colores.tintaTenue,
    textAlign: 'center',
    marginTop: espaciado.base,
    lineHeight: tipografia.tamano.micro * 1.6,
  },
})
