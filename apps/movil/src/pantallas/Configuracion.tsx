import {
  espaciado,
  MOTIVO_NO_SE_ACTUALIZO,
  radios,
  TOQUE_MINIMO,
} from '@woodtools/compartido'
import Constants from 'expo-constants'
import * as Updates from 'expo-updates'
import { useEffect, useState } from 'react'
import { Alert, BackHandler, Pressable, Text, View } from 'react-native'

import { BotonMenu, BotonSecundario } from '../componentes/Botones'
import { Deslizador } from '../componentes/Deslizador'
import { Aviso } from '../componentes/Estado'
import { Encabezado } from '../componentes/Encabezado'
import { Casilla, Opcion } from '../componentes/Formulario'
import { BarraPanel, Pantalla, Panel, TituloPanel } from '../componentes/Pantalla'
import { obtenerInstalacionId } from '../nucleo/dispositivo'
import { etiquetaVendedor, usarSesion } from '../nucleo/sesion'
import { buscarApkNuevo } from '../servicios/actualizacionApk'
import { ofrecerApk } from '../servicios/avisoDeApk'
import { obtenerJornadaDeHoy } from '../servicios/jornada'
import {
  detenerSeguimiento,
  iniciarSeguimiento,
  seguimientoActivo,
} from '../servicios/ubicacion'
import type { PropsPantalla, SeccionDeConfiguracion } from '../navegacion/tipos'
import {
  hojaDeTema,
  LETRA_NORMAL,
  multiplicadorDeLetra,
  PASO_DE_LA_BARRA,
  usarAjustesDeTema,
} from '../nucleo/tema'

/**
 * "CONFIGURACIÓN"
 *
 * Una portada con las cuatro cosas que se pueden cambiar, y adentro de cada
 * una lo suyo. Es la forma del mockup, y es la correcta por una razón que se
 * ve al entrar: el tamaño de la letra y el tema se tocan una vez en la vida,
 * las actualizaciones cada tanto, y los datos de la cuenta se miran. Ponerlo
 * todo en una sola tirada obliga a pasar por delante de las cuatro para llegar
 * a la que se vino a buscar.
 *
 * `route.params.seccion` abre directo en una de ellas. Es lo que usa "BUSCAR
 * ACTUALIZACIÓN" del menú de las tres rayas.
 */
export function PantallaConfiguracion({ navigation, route }: PropsPantalla<'Configuracion'>) {
  const estilos = usarEstilos()
  const { perfil, cerrarSesion } = usarSesion()
  const [seccion, setSeccion] = useState<SeccionDeConfiguracion | null>(
    route.params?.seccion ?? null,
  )

  // Se leen acá para poder contarlo en la portada: sin esto, para saber qué
  // tema tiene puesto hay que entrar a mirar.
  const temaPuesto = usarAjustesDeTema((s) => s.modo)
  const porcentajeLetra = usarAjustesDeTema((s) => s.porcentajeLetra)
  const letraDelCelular = usarAjustesDeTema((s) => s.letraDelCelular)

  function resumenDelTamano(): string {
    if (letraDelCelular) return 'El que tiene puesto el celular'
    if (porcentajeLetra === LETRA_NORMAL) return 'Normal'
    const cuanto = Math.round(multiplicadorDeLetra(porcentajeLetra) * 100)
    return porcentajeLetra > LETRA_NORMAL
      ? `Más grande (${cuanto} %)`
      : `Más chica (${cuanto} %)`
  }
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
      /**
       * Las dos, siempre, antes de contestar nada.
       *
       * Esto decía consultarlas por separado y no lo hacía: si lo de aire volvía
       * con algo, salía el cartel de reiniciar y se volvía sin haber mirado
       * nunca el instalador. Y las dos aparecen juntas justo en el caso que más
       * importa —el teléfono atrasado de APK, al que igual se le publica código
       * para su versión vieja para no dejarlo afuera—, así que el cartel de
       * reiniciar tapaba al instalador todas las veces.
       */
      const aire = await buscarPorAire()
      const apk = await buscarApkNuevo()

      /**
       * El instalador va primero, aunque haya algo por aire.
       *
       * Reiniciar deja el teléfono andando pero atrasado igual; instalar lo pone
       * al día del todo, incluido lo que se acaba de bajar por aire. Y lo bajado
       * no se pierde por no reiniciar ahora: se aplica solo la próxima vez que
       * la app arranque de cero.
       */
      if (apk.estado === 'hay') {
        ofrecerApk(apk.apk)
        return
      }

      if (apk.estado === 'sin-donde-bajarlo') {
        avisarSinDondeBajarlo(apk.nueva, apk.actual, apk.notas)
        return
      }

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

  /**
   * El "Atrás" de adentro de una sección vuelve a la portada, no a la pantalla
   * anterior. Si saliera de Configuración, el que entró a mirar el tamaño de
   * la letra tendría que volver a entrar para mirar el tema.
   */
  function volver() {
    if (seccion) setSeccion(null)
    else navigation.goBack()
  }

  /**
   * Y el botón de atrás del teléfono hace lo mismo.
   *
   * Sin esto son dos "atrás" distintos en la misma pantalla: el de arriba
   * vuelve a la portada y el de abajo se va de Configuración. El vendedor usa
   * el de abajo —es el que tiene el pulgar al lado— y termina afuera sin
   * entender por qué.
   */
  /**
   * Volver a entrar pidiendo una sección tiene que llevar a esa sección.
   *
   * `useState` sólo mira el parámetro la primera vez. Y hay un camino que pasa
   * dos veces: estando en CONFIGURACIÓN se abren las tres rayas y se toca
   * "BUSCAR ACTUALIZACIÓN". React Navigation no vuelve a montar la pantalla
   * —ya está en la pila—, sólo le cambia los parámetros, así que sin esto el
   * vendedor tocaba la opción y se quedaba mirando la portada.
   */
  useEffect(() => {
    if (route.params?.seccion) setSeccion(route.params.seccion)
  }, [route.params?.seccion])

  useEffect(() => {
    if (!seccion) return
    const suscripcion = BackHandler.addEventListener('hardwareBackPress', () => {
      setSeccion(null)
      return true
    })
    return () => suscripcion.remove()
  }, [seccion])

  return (
    <Pantalla>
      <Encabezado />

      <Panel contentStyle={estilos.contenido} subirAlTopeCuando={seccion ?? 'portada'}>
        <BarraPanel alVolver={volver} />

        <TituloPanel>CONFIGURACIÓN</TituloPanel>

        {seccion === 'tamano' ? (
          <SeccionTamano />
        ) : seccion === 'tema' ? (
          <SeccionTema />
        ) : seccion === 'actualizaciones' ? (
          <SeccionActualizaciones
            buscando={buscandoUpdate}
            alBuscar={buscarActualizacion}
            alReportar={() =>
              navigation.navigate('ReportarProblema', {
                motivo: MOTIVO_NO_SE_ACTUALIZO,
                pantalla: 'Configuración · Actualizaciones',
              })
            }
          />
        ) : (
          <>
            {/* ── La portada del mockup ─────────────────────────────── */}
            <BotonMenu
              titulo="TAMAÑO DE LA LETRA"
              subtitulo={resumenDelTamano()}
              alTocar={() => setSeccion('tamano')}
            />
            <BotonMenu
              titulo="TEMA OSCURO/CLARO"
              subtitulo={temaPuesto === 'oscuro' ? 'Oscuro' : 'Claro'}
              alTocar={() => setSeccion('tema')}
            />
            <BotonMenu
              titulo="REPORTAR UN PROBLEMA"
              subtitulo="Le llega a Marketing con la versión de tu app"
              alTocar={() =>
                navigation.navigate('ReportarProblema', { pantalla: 'Configuración' })
              }
            />
            <BotonMenu
              titulo="ACTUALIZACIONES"
              subtitulo={`Versión ${Constants.expoConfig?.version ?? '—'}`}
              alTocar={() => setSeccion('actualizaciones')}
            />

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
              Tu ubicación se registra mientras el recorrido está en curso, y una vez al marcar tu
              entrada y otra al marcar tu salida. Fuera de eso, no.
            </Text>
          </>
        )}
      </Panel>
    </Pantalla>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// El tamaño de la letra
// ─────────────────────────────────────────────────────────────────────────────

/**
 * La barra del mockup, con la casilla que faltaba: "usar el tamaño del
 * celular".
 *
 * ─── Qué hace la casilla ────────────────────────────────────────────────────
 *
 * Tildada, la app no toca nada y la letra sale del tamaño que el vendedor puso
 * en los ajustes de Android. Es lo que corresponde por defecto: el que ve mal
 * ya le agrandó la letra a TODO el teléfono, y una app que ignora eso es una
 * app que le hace repetir el trabajo.
 *
 * Destildada manda la barra, y el 50 es el tamaño con el que se dibujó la app.
 *
 * ─── Por qué mover la barra destilda sola ───────────────────────────────────
 *
 * Porque si no, mover la barra no haría nada visible y el vendedor concluiría
 * que está rota. Obligarlo a destildar primero es un paso previo para la única
 * acción de la pantalla.
 */
function SeccionTamano() {
  const estilos = usarEstilos()
  const porcentaje = usarAjustesDeTema((s) => s.porcentajeLetra)
  const delCelular = usarAjustesDeTema((s) => s.letraDelCelular)
  const ponerPorcentaje = usarAjustesDeTema((s) => s.ponerPorcentajeLetra)
  const ponerDelCelular = usarAjustesDeTema((s) => s.ponerLetraDelCelular)

  return (
    <View style={estilos.seccion}>
      <Text style={estilos.seccionTitulo}>TAMAÑO DE LA LETRA</Text>

      <Deslizador
        valor={porcentaje}
        minimo={0}
        maximo={100}
        paso={PASO_DE_LA_BARRA}
        accessibilityLabel="Tamaño de la letra"
        alCambiar={(v) => {
          if (delCelular) ponerDelCelular(false)
          ponerPorcentaje(v)
        }}
      />

      {/*
        Con la casilla tildada, la barra sigue mostrando dónde quedó lo último
        que se eligió, pero no es lo que manda. Decir "50" ahí sería mentir: la
        letra que se está viendo es la del celular. Se dice cuál es la que
        manda, y la barra queda como lo que es: la elección guardada, esperando
        a que se la destilde.
      */}
      <Text style={estilos.valorBarra}>
        {delCelular ? 'Lo decide el celular' : String(porcentaje)}
      </Text>

      {/*
        `compacta` no es un capricho de tamaño: sin ella el rótulo se cortaba en
        "USAR EL TAMAÑO DEL CEL…" y la casilla dejaba de explicar qué hace.
      */}
      <Casilla
        etiqueta="USAR EL TAMAÑO DEL CELULAR"
        valor={delCelular}
        alCambiar={ponerDelCelular}
        compacta
      />

      {/*
        La prueba se hace acá y con las letras de verdad de la app: elegir un
        número a ciegas y descubrir el resultado tres pantallas después es lo
        que hace que nadie toque esto dos veces.
      */}
      <View style={estilos.muestra}>
        <Text style={estilos.muestraTitulo}>ASÍ SE VA A VER</Text>
        <Text style={estilos.muestraGrande}>NOTA DE PEDIDO</Text>
        <Text style={estilos.muestraNormal}>3149 · AGLOLAM S.A.</Text>
        <Text style={estilos.muestraChica}>
          Sierra circular Ø 300 · 96 dientes · afilado 8001 · $ 248,85 por diente
        </Text>
      </View>

      <Aviso tono="info" titulo="Se guarda en este teléfono">
        El tamaño es de este aparato, no de tu cuenta: si mañana usás otro, ese otro tiene su
        propia pantalla y su propio ajuste.
      </Aviso>
    </View>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// El tema
// ─────────────────────────────────────────────────────────────────────────────

function SeccionTema() {
  const estilos = usarEstilos()
  const modo = usarAjustesDeTema((s) => s.modo)
  const ponerModo = usarAjustesDeTema((s) => s.ponerModo)

  return (
    <View style={estilos.seccion}>
      <Text style={estilos.seccionTitulo}>TEMA OSCURO/CLARO</Text>

      {/*
        Cambia al instante, sin confirmar y sin reiniciar. Es la única forma de
        elegir un tema: se elige mirando.
      */}
      <Opcion
        etiqueta="TEMA OSCURO  🌙"
        descripcion="Fondo oscuro y letra clara. Para el galpón y para la noche."
        seleccionada={modo === 'oscuro'}
        alSeleccionar={() => ponerModo('oscuro')}
      />

      <Opcion
        etiqueta="TEMA CLARO  ☀"
        descripcion="El de siempre: fondo rojo de la marca y panel gris."
        seleccionada={modo === 'claro'}
        alSeleccionar={() => ponerModo('claro')}
      />

      <Aviso tono="info" titulo="Al sol se ve mejor el claro">
        El tema oscuro gasta menos batería y cansa menos la vista adentro, pero a pleno sol el
        claro se lee bastante mejor.
      </Aviso>
    </View>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Actualizaciones
// ─────────────────────────────────────────────────────────────────────────────

function SeccionActualizaciones({
  buscando,
  alBuscar,
  alReportar,
}: {
  buscando: boolean
  alBuscar: () => void
  alReportar: () => void
}) {
  const estilos = usarEstilos()

  return (
    <View style={estilos.seccion}>
      <Text style={estilos.seccionTitulo}>ACTUALIZACIONES</Text>

      <Text style={estilos.version}>
        Versión actual: {Constants.expoConfig?.version ?? '—'}
      </Text>
      <Text style={estilos.versionDetalle}>{comoSeActualizaEsteTelefono()}</Text>

      <BotonMenu titulo="BUSCAR ACTUALIZACIONES" alTocar={alBuscar} cargando={buscando} />

      {/*
        El enlace del mockup.
        No abre una pantalla de ayuda: abre el reporte de problema con el motivo
        ya elegido. El que lo toca ya dijo cuál es su problema, y volver a
        preguntárselo sería no haberlo escuchado. Del otro lado, Marketing
        recibe el reporte con la versión que ESTÁ CORRIENDO —no la que dice el
        APK—, que es lo único con lo que se puede contestar por qué no se
        actualizó.
      */}
      <Pressable
        onPress={alReportar}
        accessibilityRole="button"
        style={({ pressed }) => [estilos.enlace, pressed && estilos.enlaceTocado]}
      >
        <Text style={estilos.enlaceTexto}>¿No se te actualizó?</Text>
      </Pressable>
    </View>
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
  const estilos = usarEstilos()
  return (
    <View style={estilos.dato}>
      <Text style={estilos.datoEtiqueta}>{etiqueta}</Text>
      <Text style={estilos.datoValor} numberOfLines={1}>
        {valor}
      </Text>
    </View>
  )
}

const usarEstilos = hojaDeTema((t) => ({
  contenido: { gap: espaciado.md },

  seccion: { gap: espaciado.md },
  seccionTitulo: {
    fontFamily: t.tipografia.familia.subtitulo,
    fontSize: t.tipografia.tamano.lg,
    color: t.colores.tinta,
    textAlign: 'center',
    letterSpacing: 0.8,
  },
  valorBarra: {
    fontFamily: t.tipografia.familia.cuerpo,
    fontSize: t.tipografia.tamano.sm,
    color: t.colores.tintaSuave,
    textAlign: 'center',
    marginTop: -espaciado.sm,
  },

  muestra: {
    backgroundColor: t.colores.campoBlanco,
    borderWidth: 2,
    borderColor: t.colores.borde,
    borderRadius: radios.sm,
    padding: espaciado.md,
    gap: espaciado.xs,
  },
  muestraTitulo: {
    fontFamily: t.tipografia.familia.cuerpo,
    fontSize: t.tipografia.tamano.micro,
    color: t.colores.tintaTenue,
    letterSpacing: 1,
  },
  muestraGrande: {
    fontFamily: t.tipografia.familia.titulo,
    fontSize: t.tipografia.tamano.xl,
    color: t.colores.tinta,
  },
  muestraNormal: {
    fontFamily: t.tipografia.familia.fuerte,
    fontSize: t.tipografia.tamano.base,
    color: t.colores.tinta,
  },
  muestraChica: {
    fontFamily: t.tipografia.familia.liviana,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.tintaSuave,
    lineHeight: t.tipografia.tamano.xs * t.tipografia.interlineado.normal,
  },

  version: {
    fontFamily: t.tipografia.familia.fuerte,
    fontSize: t.tipografia.tamano.base,
    color: t.colores.tinta,
    textAlign: 'center',
  },
  versionDetalle: {
    fontFamily: t.tipografia.familia.liviana,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.tintaSuave,
    textAlign: 'center',
    marginTop: -espaciado.sm,
  },
  enlace: {
    minHeight: TOQUE_MINIMO,
    alignItems: 'center',
    justifyContent: 'center',
  },
  enlaceTocado: { opacity: 0.6 },
  enlaceTexto: {
    fontFamily: t.tipografia.familia.cuerpo,
    fontSize: t.tipografia.tamano.base,
    color: t.colores.tinta,
    textDecorationLine: 'underline',
  },
  tarjeta: {
    backgroundColor: t.colores.campoBlanco,
    borderWidth: 2,
    borderColor: t.colores.borde,
    borderRadius: radios.sm,
    padding: espaciado.md,
  },
  tarjetaTitulo: {
    fontFamily: t.tipografia.familia.subtitulo,
    fontSize: t.tipografia.tamano.sm,
    color: t.colores.rojo,
    letterSpacing: 1,
    marginBottom: espaciado.sm,
  },
  dato: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: espaciado.md,
    paddingVertical: espaciado.sm,
    borderBottomWidth: 1,
    borderBottomColor: t.colores.panelOscuro,
  },
  datoEtiqueta: {
    fontFamily: t.tipografia.familia.cuerpo,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.tintaSuave,
  },
  datoValor: {
    flexShrink: 1,
    fontFamily: t.tipografia.familia.fuerte,
    fontSize: t.tipografia.tamano.sm,
    color: t.colores.tinta,
  },
  pie: {
    fontFamily: t.tipografia.familia.liviana,
    fontSize: t.tipografia.tamano.micro,
    color: t.colores.tintaTenue,
    textAlign: 'center',
    marginTop: espaciado.base,
    lineHeight: t.tipografia.tamano.micro * 1.6,
  },
}))
