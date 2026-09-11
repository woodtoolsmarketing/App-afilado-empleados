import {
  CONTACTOS_INTERNOS,
  enlaceLlamada,
  enlaceWhatsapp,
  espaciado,
  radios,
  TOQUE_MINIMO,
} from '@woodtools/compartido'
import { Image } from 'expo-image'
import * as Updates from 'expo-updates'
import { useEffect, useState } from 'react'
import { Alert, Linking, Pressable, Text, View } from 'react-native'

import { BotonPrincipal, BotonSecundario } from '../componentes/Botones'
import { Pantalla } from '../componentes/Pantalla'
import { obtenerInstalacionId } from '../nucleo/dispositivo'
import { usarSesion, VERSION_APP, type EstadoAcceso } from '../nucleo/sesion'
import { hojaDeTema } from '../nucleo/tema'

/**
 * Pantalla de espera.
 *
 * Cubre los estados en los que el usuario se autenticó bien pero todavía no
 * puede entrar: falta que un administrador apruebe la cuenta o habilite el
 * teléfono. Es una pantalla y no un cartel de error porque acá el vendedor no
 * tiene nada que corregir: tiene que esperar, y saber a quién avisarle.
 */
export function PantallaEstadoCuenta() {
  const estilos = usarEstilos()
  const { estado, perfil, cerrarSesion, refrescarPerfil } = usarSesion()
  const [instalacion, setInstalacion] = useState('')
  const [verificando, setVerificando] = useState(false)
  const [avisoActualizacion, setAvisoActualizacion] = useState<string | null>(null)

  /**
   * Baja la actualización por aire, si hay.
   *
   * Cubre el caso normal —un cambio de código, que viaja por OTA— y no el otro:
   * si lo que cambió es nativo (un permiso, una librería) no hay nada que
   * bajar y hace falta el instalador nuevo. Se dice cuál de los dos es en vez
   * de dejar al vendedor tocando un botón que no hace nada.
   */
  async function buscarActualizacion() {
    setVerificando(true)
    setAvisoActualizacion(null)
    try {
      if (!Updates.isEnabled) {
        setAvisoActualizacion(
          'Esta versión no recibe actualizaciones por aire. Pedile a la oficina el instalador nuevo.',
        )
        return
      }

      const resultado = await Updates.checkForUpdateAsync()
      if (!resultado.isAvailable) {
        setAvisoActualizacion(
          'No hay ninguna actualización por aire. Lo que cambió necesita el instalador nuevo: pedíselo a la oficina.',
        )
        return
      }

      setAvisoActualizacion('Bajando la actualización…')
      await Updates.fetchUpdateAsync()
      await Updates.reloadAsync()
    } catch {
      setAvisoActualizacion('No pudimos buscarla. Revisá tu conexión y probá de nuevo.')
    } finally {
      setVerificando(false)
    }
  }

  useEffect(() => {
    void obtenerInstalacionId().then((id) => setInstalacion(id.slice(0, 8).toUpperCase()))
  }, [])

  // Reintenta solo cada 20 s: el vendedor entra apenas el admin lo aprueba,
  // sin tener que cerrar y volver a abrir la app.
  useEffect(() => {
    if (estado !== 'pendiente' && estado !== 'dispositivo_no_autorizado') return
    const id = setInterval(() => void refrescarPerfil(), 20_000)
    return () => clearInterval(id)
  }, [estado, refrescarPerfil])

  const contenido = CONTENIDOS[estado] ?? ESPERANDO_APROBACION

  /*
   * A quién se avisa.
   *
   * Administración es quien aprueba las cuentas y habilita los teléfonos
   * desde el panel: es a quien corresponde escribirle en cualquiera de estos
   * estados. Si ese rol no estuviera cargado el día de mañana, cualquiera de
   * los cinco de la oficina llega igual a la misma gente.
   */
  const contactoOficina =
    CONTACTOS_INTERNOS.find((c) => c.rol === 'Administración') ?? CONTACTOS_INTERNOS[0]

  /*
   * El mensaje viene con el nombre puesto —del otro lado no saben quién
   * escribe, como en Comunicación Interna— y, si lo que falta es habilitar
   * el teléfono, con el código ya adentro: es el único dato de esta pantalla
   * que el vendedor tendría que dictar letra por letra.
   */
  const saludo = perfil ? `Hola, soy ${perfil.nombre_completo}. ` : ''
  const mensajeWhatsapp =
    estado === 'dispositivo_no_autorizado'
      ? `${saludo}Necesito que habiliten este teléfono, código ${instalacion}.`
      : saludo

  async function abrirContacto(url: string, queFalta: string) {
    try {
      await Linking.openURL(url)
    } catch {
      // No se pregunta antes con `canOpenURL`: Android 11+ contesta que no a
      // esto aunque la app esté instalada, y el botón quedaría muerto en
      // teléfonos donde WhatsApp anda perfecto.
      Alert.alert('No pudimos abrir eso', queFalta)
    }
  }

  return (
    <Pantalla>
      <View style={estilos.centro}>
        <Image
          source={require('../../assets/logo-woodtools.png')}
          style={estilos.logo}
          contentFit="contain"
          accessibilityLabel="WoodTools S.R.L."
        />

        <Text style={estilos.icono}>{contenido.icono}</Text>
        <Text style={estilos.titulo} accessibilityRole="header">
          {contenido.titulo}
        </Text>
        <Text style={estilos.texto}>{contenido.texto}</Text>

        {perfil ? (
          <View style={estilos.ficha}>
            <Text style={estilos.fichaLinea}>
              <Text style={estilos.fichaEtiqueta}>Usuario: </Text>
              {perfil.email}
            </Text>
            {perfil.motivo_rechazo ? (
              <Text style={estilos.fichaLinea}>
                <Text style={estilos.fichaEtiqueta}>Motivo: </Text>
                {perfil.motivo_rechazo}
              </Text>
            ) : null}
            {estado === 'dispositivo_no_autorizado' ? (
              <Text style={estilos.fichaLinea}>
                <Text style={estilos.fichaEtiqueta}>Código del teléfono: </Text>
                {instalacion}
              </Text>
            ) : null}
          </View>
        ) : null}

        {perfil ? (
          <View style={estilos.contacto}>
            <Pressable
              onPress={() =>
                void abrirContacto(
                  enlaceWhatsapp(contactoOficina, mensajeWhatsapp),
                  'Parece que este teléfono no tiene WhatsApp instalado. Probá con el botón de llamar.',
                )
              }
              accessibilityRole="button"
              accessibilityLabel={`Escribirle por WhatsApp a ${contactoOficina.nombre}`}
              style={({ pressed }) => [
                estilos.botonContacto,
                estilos.whatsapp,
                pressed && estilos.contactoTocado,
              ]}
            >
              <Text style={estilos.iconoContacto}>💬</Text>
              <Text style={estilos.textoContacto}>WhatsApp</Text>
            </Pressable>

            <Pressable
              onPress={() =>
                void abrirContacto(
                  enlaceLlamada(contactoOficina),
                  `No se pudo abrir el teléfono. El número de ${contactoOficina.nombre} es ${contactoOficina.legible}.`,
                )
              }
              accessibilityRole="button"
              accessibilityLabel={`Llamar a ${contactoOficina.nombre}`}
              style={({ pressed }) => [
                estilos.botonContacto,
                estilos.llamar,
                pressed && estilos.contactoTocado,
              ]}
            >
              <Text style={estilos.iconoContacto}>📞</Text>
              <Text style={estilos.textoContacto}>Llamar</Text>
            </Pressable>
          </View>
        ) : null}

        {estado === 'pendiente' || estado === 'dispositivo_no_autorizado' ? (
          <BotonPrincipal
            titulo="YA ME HABILITARON"
            alTocar={async () => {
              setVerificando(true)
              await refrescarPerfil()
              setVerificando(false)
            }}
            cargando={verificando}
          />
        ) : null}

        {estado === 'version_vieja' ? (
          <>
            <BotonPrincipal
              titulo="BUSCAR ACTUALIZACIÓN"
              alTocar={buscarActualizacion}
              cargando={verificando}
            />
            {avisoActualizacion ? (
              <Text style={estilos.texto}>{avisoActualizacion}</Text>
            ) : null}
            <Text style={estilos.fichaLinea}>Versión instalada: {VERSION_APP}</Text>
          </>
        ) : null}

        <BotonSecundario titulo="Cerrar sesión" alTocar={() => void cerrarSesion()} style={estilos.salir} />
      </View>
    </Pantalla>
  )
}

interface Contenido {
  icono: string
  titulo: string
  texto: string
}

/**
 * Respaldo para cualquier estado que llegue acá sin entrada propia. Es el más
 * conservador de los mensajes: "esperá a que te habiliten" nunca es engañoso.
 */
const ESPERANDO_APROBACION: Contenido = {
  icono: '⏳',
  titulo: 'TU CUENTA ESTÁ\nEN REVISIÓN',
  texto:
    'Un administrador tiene que aprobar tu acceso antes de que puedas usar la app. Avisale a la oficina y en cuanto te habiliten entrás sin hacer nada más.',
}

const CONTENIDOS: Partial<Record<EstadoAcceso, Contenido>> = {
  pendiente: ESPERANDO_APROBACION,
  dispositivo_no_autorizado: {
    icono: '📵',
    titulo: 'TELÉFONO NO\nHABILITADO',
    texto:
      'Tu cuenta está aprobada, pero este teléfono todavía no. Pasale a la oficina el código que ves abajo para que lo habiliten.',
  },
  rechazado: {
    icono: '🚫',
    titulo: 'ACCESO RECHAZADO',
    texto: 'Un administrador rechazó tu solicitud. Si creés que es un error, hablá con la oficina.',
  },
  suspendido: {
    icono: '⛔',
    titulo: 'CUENTA SUSPENDIDA',
    texto: 'Tu cuenta está suspendida o dada de baja. Hablá con la oficina para reactivarla.',
  },
  version_vieja: {
    icono: '⭮',
    titulo: 'HAY QUE\nACTUALIZAR',
    texto:
      'Esta versión de la app quedó vieja para lo que la oficina está usando ahora. Tocá "Buscar actualización": si hay una por aire, se baja sola en unos segundos. Si no, pedí el instalador nuevo.',
  },
}

const usarEstilos = hojaDeTema((t) => ({
  centro: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: espaciado.lg,
    gap: espaciado.base,
  },
  logo: {
    width: 200,
    height: 78,
    backgroundColor: t.colores.blanco,
    borderRadius: radios.base,
    marginBottom: espaciado.sm,
  },
  icono: { fontSize: 54 },
  titulo: {
    fontFamily: t.tipografia.familia.titulo,
    fontSize: t.tipografia.tamano.xxl,
    color: t.colores.blanco,
    textAlign: 'center',
    lineHeight: t.tipografia.tamano.xxl * t.tipografia.interlineado.ajustado,
  },
  texto: {
    fontFamily: t.tipografia.familia.cuerpo,
    fontSize: t.tipografia.tamano.sm,
    color: 'rgba(255,255,255,0.92)',
    textAlign: 'center',
    lineHeight: t.tipografia.tamano.sm * t.tipografia.interlineado.holgado,
  },
  ficha: {
    /*
     * Un velo negro sobre el rojo de la marca recorta la ficha; sobre el fondo
     * oscuro no recorta nada —negro al 22 % sobre negro— y los tres renglones
     * quedaban flotando sueltos. Con el borde se leen como una caja en los dos
     * temas sin cambiar el aspecto del claro.
     */
    backgroundColor: 'rgba(0,0,0,0.22)',
    borderWidth: t.oscuro ? 1.5 : 0,
    borderColor: t.colores.borde,
    borderRadius: radios.sm,
    padding: espaciado.md,
    gap: espaciado.xs,
    alignSelf: 'stretch',
  },
  fichaLinea: {
    fontFamily: t.tipografia.familia.cuerpo,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.blanco,
  },
  fichaEtiqueta: { fontFamily: t.tipografia.familia.subtitulo },

  contacto: {
    flexDirection: 'row',
    gap: espaciado.sm,
    alignSelf: 'stretch',
  },
  botonContacto: {
    flex: 1,
    flexDirection: 'row',
    gap: espaciado.xs,
    minHeight: TOQUE_MINIMO,
    borderRadius: radios.sm,
    borderWidth: 2,
    borderColor: t.colores.borde,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Mismos dos colores que en Comunicación Interna: se reconocen por el color
  // antes de leer nada.
  whatsapp: { backgroundColor: '#25D366' },
  llamar: { backgroundColor: '#0B4F8A' },
  contactoTocado: { opacity: 0.75 },
  iconoContacto: { fontSize: 20 },
  textoContacto: {
    fontFamily: t.tipografia.familia.fuerte,
    fontSize: t.tipografia.tamano.sm,
    color: t.colores.blanco,
  },

  salir: { alignSelf: 'stretch', marginTop: espaciado.md },
}))
