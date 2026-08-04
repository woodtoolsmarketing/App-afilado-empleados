import { colores, espaciado, radios, tipografia } from '@woodtools/compartido'
import { Image } from 'expo-image'
import { useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'

import { BotonPrincipal, BotonSecundario } from '../componentes/Botones'
import { Pantalla } from '../componentes/Pantalla'
import { obtenerInstalacionId } from '../nucleo/dispositivo'
import { usarSesion, type EstadoAcceso } from '../nucleo/sesion'

/**
 * Pantalla de espera.
 *
 * Cubre los estados en los que el usuario se autenticó bien pero todavía no
 * puede entrar: falta que un administrador apruebe la cuenta o habilite el
 * teléfono. Es una pantalla y no un cartel de error porque acá el vendedor no
 * tiene nada que corregir: tiene que esperar, y saber a quién avisarle.
 */
export function PantallaEstadoCuenta() {
  const { estado, perfil, cerrarSesion, refrescarPerfil } = usarSesion()
  const [instalacion, setInstalacion] = useState('')
  const [verificando, setVerificando] = useState(false)

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
}

const estilos = StyleSheet.create({
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
    backgroundColor: colores.blanco,
    borderRadius: radios.base,
    marginBottom: espaciado.sm,
  },
  icono: { fontSize: 54 },
  titulo: {
    fontFamily: tipografia.familia.titulo,
    fontSize: tipografia.tamano.xxl,
    color: colores.blanco,
    textAlign: 'center',
    lineHeight: tipografia.tamano.xxl * tipografia.interlineado.ajustado,
  },
  texto: {
    fontFamily: tipografia.familia.cuerpo,
    fontSize: tipografia.tamano.sm,
    color: 'rgba(255,255,255,0.92)',
    textAlign: 'center',
    lineHeight: tipografia.tamano.sm * tipografia.interlineado.holgado,
  },
  ficha: {
    backgroundColor: 'rgba(0,0,0,0.22)',
    borderRadius: radios.sm,
    padding: espaciado.md,
    gap: espaciado.xs,
    alignSelf: 'stretch',
  },
  fichaLinea: {
    fontFamily: tipografia.familia.cuerpo,
    fontSize: tipografia.tamano.xs,
    color: colores.blanco,
  },
  fichaEtiqueta: { fontFamily: tipografia.familia.subtitulo },
  salir: { alignSelf: 'stretch', marginTop: espaciado.md },
})
