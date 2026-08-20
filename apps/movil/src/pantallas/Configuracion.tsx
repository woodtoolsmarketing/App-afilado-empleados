import { colores, espaciado, radios, tipografia } from '@woodtools/compartido'
import Constants from 'expo-constants'
import * as Updates from 'expo-updates'
import { useEffect, useState } from 'react'
import { Alert, Linking, StyleSheet, Text, View } from 'react-native'

import { BotonMenu, BotonSecundario } from '../componentes/Botones'
import { Aviso } from '../componentes/Estado'
import { Encabezado } from '../componentes/Encabezado'
import { BarraPanel, Pantalla, Panel, TituloPanel } from '../componentes/Pantalla'
import { obtenerInstalacionId } from '../nucleo/dispositivo'
import { etiquetaVendedor, usarSesion } from '../nucleo/sesion'
import { buscarApkNuevo, type ApkDisponible } from '../servicios/actualizacionApk'
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

  /**
   * Ofrecer bajar la app nueva desde el panel de la oficina.
   *
   * Se abre el navegador y no se instala acá: instalar un APK desde adentro de
   * la app pide un permiso que este proyecto decidió no pedir (ver
   * `actualizacionApk.ts`). El navegador sí lo tiene.
   */
  function ofrecerApk(apk: ApkDisponible) {
    Alert.alert(
      `Hay una versión nueva: ${apk.nueva}`,
      `Tenés la ${apk.actual}. Esta actualización cambia cosas que no viajan por ` +
        `aire, así que hay que instalarla.\n\n` +
        (apk.desde === 'panel'
          ? 'La vas a bajar de la PC de la oficina, así que va a ser rápido.'
          : 'La vas a bajar de internet: con datos móviles puede tardar unos minutos.') +
        (apk.notas ? `\n\nQué trae:\n${apk.notas}` : ''),
      [
        { text: 'Ahora no', style: 'cancel' },
        {
          text: 'Bajar e instalar',
          onPress: () => {
            void Linking.openURL(apk.direccion).catch(() =>
              Alert.alert(
                'No pudimos abrir la página',
                `Probá entrando a mano desde el navegador:\n${apk.direccion}`,
              ),
            )
          },
        },
      ],
    )
  }

  /**
   * "Hay una versión nueva pero no hay de dónde bajarla."
   *
   * Antes este caso salía como "estás usando la última versión", que era falso.
   * No se puede ofrecer un botón —no hay a dónde mandarlo— pero la noticia se
   * da igual: el vendedor tiene que poder enterarse de que está atrasado
   * aunque en ese momento no pueda hacer nada, aunque más no sea para
   * mencionárselo a la oficina.
   */
  function avisarSinDondeBajarlo(nueva: string, actual: string, notas: string | null) {
    Alert.alert(
      `Hay una versión nueva: ${nueva}`,
      [
        `Tenés la ${actual}, pero desde acá no la podemos bajar.`,
        'Para que se pueda, tenés que estar en el wifi de la oficina con la PC del panel prendida. Pasá por ahí y volvé a tocar este botón.',
        'Si no vas a pasar, avisale a la oficina y contale esto.',
        ...(notas ? [`Qué trae:\n${notas}`] : []),
      ].join('\n\n'),
    )
  }

  /**
   * Lo que viaja por aire, contestando también cuando no se puede preguntar.
   *
   * Se separa del resto porque antes era todo una sola cosa, y eso rompía el
   * rescate: `checkForUpdateAsync` RECHAZA —no devuelve "no hay"— cuando este
   * APK se compiló sin actualizaciones por aire, cuando corre en desarrollo, o
   * cuando no se llega al servidor. Como la consulta del instalador estaba
   * adentro del mismo `try` y después, ese rechazo se la saltaba entera: el
   * teléfono que MÁS necesitaba el instalador nuevo era justo el único que no
   * llegaba nunca a preguntar por él, y encima leía "revisá la conexión" con
   * la conexión perfecta.
   */
  async function buscarPorAire(): Promise<
    | { estado: 'lista' }
    | { estado: 'sin-novedades' }
    | { estado: 'apagado' }
    | { estado: 'fallo'; motivo: string }
  > {
    // La misma guardia que ya usa la pantalla de estado de cuenta. Sin ella el
    // módulo rechaza y el error queda disfrazado de problema de red.
    if (!Updates.isEnabled) return { estado: 'apagado' }

    try {
      const resultado = await Updates.checkForUpdateAsync()
      if (!resultado.isAvailable) return { estado: 'sin-novedades' }
      await Updates.fetchUpdateAsync()
      return { estado: 'lista' }
    } catch (e) {
      // Desarrollo y APK sin actualizaciones por aire llegan con este código.
      // No es una falla: es que este teléfono no las tiene, y eso hay que
      // decirlo distinto de "no pudimos consultar".
      const codigo = (e as { code?: string })?.code
      if (codigo === 'ERR_UPDATES_DISABLED') return { estado: 'apagado' }
      return { estado: 'fallo', motivo: codigo || (e as Error)?.message || 'error desconocido' }
    }
  }

  /**
   * El botón. Dos preguntas independientes, y un solo cartel al final.
   *
   * Las dos vías se consultan SIEMPRE y por separado, porque contestan cosas
   * distintas: lo que viaja por aire es JavaScript, y un permiso nuevo o una
   * librería nativa van adentro del APK. Que falle una no puede tapar a la
   * otra, y "todo al día" se dice únicamente cuando las dos contestaron.
   */
  async function buscarActualizacion() {
    setBuscandoUpdate(true)
    try {
      const aire = await buscarPorAire()

      if (aire.estado === 'lista') {
        Alert.alert('Actualización lista', 'La app se va a reiniciar para aplicarla.', [
          {
            text: 'Reiniciar',
            onPress: () => {
              void Updates.reloadAsync().catch(() =>
                Alert.alert(
                  'No se pudo reiniciar sola',
                  'Cerrá la app del todo y volvé a abrirla: la actualización ya está bajada y se aplica al arrancar.',
                ),
              )
            },
          },
        ])
        return
      }

      // Y acá el instalador, ande o no ande lo de arriba.
      const apk = await buscarApkNuevo()

      if (apk.estado === 'hay') {
        ofrecerApk(apk.apk)
        return
      }

      if (apk.estado === 'sin-donde-bajarlo') {
        avisarSinDondeBajarlo(apk.nueva, apk.actual, apk.notas)
        return
      }

      // No apareció nada nuevo. Lo que se dice depende de qué se pudo mirar de
      // verdad: decir "todo al día" sobre una consulta que falló es la forma
      // más segura de que el vendedor se quede con la app vieja tranquilo.
      const version = Constants.expoConfig?.version ?? apk.actual

      if (aire.estado === 'fallo' && apk.estado === 'no-se-pudo') {
        Alert.alert(
          'No pudimos buscar actualizaciones',
          [
            'No pudimos consultar ninguna de las dos vías, así que no sabemos si estás al día.',
            `Revisá la conexión y probá de nuevo. Si sigue igual, avisale a la oficina y decile: ${aire.motivo}.`,
          ].join('\n\n'),
        )
        return
      }

      if (aire.estado === 'fallo') {
        Alert.alert(
          'No pudimos fijarnos del todo',
          [
            `Los cambios que viajan por aire no los pudimos consultar (${aire.motivo}).`,
            `Sí miramos si hay un instalador más nuevo, y no hay: tenés la ${version}.`,
            'Probá de nuevo con mejor señal. Si sigue igual, avisale a la oficina.',
          ].join('\n\n'),
        )
        return
      }

      if (apk.estado === 'no-se-pudo') {
        Alert.alert(
          'No pudimos fijarnos del todo',
          [
            `No hay cambios nuevos por aire, pero no pudimos consultar si hay un instalador más nuevo (${apk.motivo}).`,
            'Probá de nuevo en un rato. Si sigue igual, avisale a la oficina.',
          ].join('\n\n'),
        )
        return
      }

      if (aire.estado === 'apagado') {
        Alert.alert(
          'Esta app no se actualiza sola',
          [
            'Se instaló sin la parte que baja los cambios por aire, así que sólo cambia instalando una versión nueva.',
            `Nos fijamos igual y no hay ninguna más nueva que la tuya: tenés la ${version}.`,
            'Mostrale este cartel a la oficina.',
          ].join('\n\n'),
        )
        return
      }

      Alert.alert('Todo al día', `Estás usando la última versión de la app: la ${version}.`)
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
          <Dato etiqueta="Actualizaciones" valor={comoSeActualizaEsteTelefono()} />
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

/**
 * Cómo se actualiza ESTE teléfono, dicho en la pantalla.
 *
 * Existe porque no había forma de contestarlo. Un APK compilado sin la URL de
 * actualizaciones queda sordo de fábrica —ya pasó, seis versiones seguidas— y
 * desde afuera se ve idéntico a uno sano: la app dice la misma versión, y ni
 * el vendedor ni la oficina tienen cómo saber que ese teléfono no va a recibir
 * nunca nada por aire. Con este renglón se mira el teléfono y se sabe.
 *
 * "De fábrica" contra "bajada" contesta la otra pregunta que no se podía
 * contestar: si la actualización que el vendedor dice haber aplicado se aplicó.
 */
function comoSeActualizaEsteTelefono(): string {
  if (!Updates.isEnabled) return 'Sólo instalando'
  const canal = Updates.channel ?? String(Constants.expoConfig?.extra?.variante ?? '—')
  return `Por aire · ${canal} · ${Updates.isEmbeddedLaunch ? 'de fábrica' : 'bajada'}`
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
