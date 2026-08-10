import { colores, espaciado, radios, tipografia } from '@woodtools/compartido'
import { Image } from 'expo-image'
import { useRef, useState } from 'react'
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput } from 'react-native'

import { BotonPrincipal, BotonSecundario } from '../componentes/Botones'
import { Campo } from '../componentes/Formulario'
import { Aviso } from '../componentes/Estado'
import { Pantalla } from '../componentes/Pantalla'
import { usarSesion } from '../nucleo/sesion'

/**
 * Cambio obligatorio de la contraseña provisoria.
 *
 * La cuenta se dio de alta desde el panel y la contraseña la generó el
 * servidor: el administrador la vio una vez para poder pasarla. Mientras siga
 * siendo esa, hay dos personas que pueden entrar con este usuario, y todo lo
 * que la app registra —las visitas, las notas, la ubicación— queda firmado con
 * él. Por eso no es un recordatorio que se puede postergar: es una pantalla de
 * la que no se sale sin cambiarla.
 *
 * La única salida es cerrar sesión, que deja las cosas como estaban.
 */

/** Lo mismo que pide el login. Subirlo acá dejaría cuentas que no pueden entrar. */
const LARGO_MINIMO = 6

export function PantallaCambiarContrasena() {
  const { perfil, cambiarContrasena, cerrarSesion } = usarSesion()

  const [nueva, setNueva] = useState('')
  const [repetida, setRepetida] = useState('')
  const [ver, setVer] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  const refRepetida = useRef<TextInput>(null)

  async function guardar() {
    setError(null)

    if (nueva.length < LARGO_MINIMO) {
      setError(`La contraseña tiene que tener al menos ${LARGO_MINIMO} caracteres.`)
      return
    }
    if (nueva !== repetida) {
      setError('Las dos contraseñas no son iguales.')
      return
    }

    setGuardando(true)
    try {
      await cambiarContrasena(nueva)
    } catch (e) {
      setError(
        e instanceof Error && e.message
          ? e.message
          : 'No pudimos cambiarla. Revisá tu conexión y probá de nuevo.',
      )
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Pantalla>
      <KeyboardAvoidingView
        style={estilos.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={estilos.contenido}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Image
            source={require('../../assets/logo-woodtools.png')}
            style={estilos.logo}
            contentFit="contain"
            accessibilityLabel="WoodTools S.R.L."
          />

          <Text style={estilos.titulo} accessibilityRole="header">
            ELEGÍ TU CONTRASEÑA
          </Text>

          <Aviso tono="atencion" titulo="Ésta es la última vez que la ves">
            La contraseña con la que entraste te la dio la oficina, así que la conoce alguien más.
            Poné una tuya: desde ahora, lo que hagas en la app queda a tu nombre.
          </Aviso>

          {error ? (
            <Aviso tono="error" titulo="No pudimos cambiarla">
              {error}
            </Aviso>
          ) : null}

          <Campo
            etiqueta="Contraseña nueva"
            sobreRojo
            obligatorio
            value={nueva}
            onChangeText={setNueva}
            secureTextEntry={!ver}
            autoCapitalize="none"
            autoComplete="new-password"
            textContentType="newPassword"
            returnKeyType="next"
            onSubmitEditing={() => refRepetida.current?.focus()}
            editable={!guardando}
            ayuda={`Al menos ${LARGO_MINIMO} caracteres.`}
          />

          <Campo
            ref={refRepetida}
            etiqueta="Repetila"
            sobreRojo
            obligatorio
            value={repetida}
            onChangeText={setRepetida}
            secureTextEntry={!ver}
            autoCapitalize="none"
            autoComplete="new-password"
            textContentType="newPassword"
            returnKeyType="go"
            onSubmitEditing={guardar}
            editable={!guardando}
          />

          <BotonSecundario
            titulo={ver ? 'Ocultar las contraseñas' : 'Ver lo que escribo'}
            alTocar={() => setVer((v) => !v)}
          />

          <BotonPrincipal
            titulo="GUARDAR Y ENTRAR"
            alTocar={guardar}
            cargando={guardando}
            style={estilos.boton}
          />

          <Text style={estilos.pie}>
            {perfil?.usuario ? `Entrando como ${perfil.usuario}. ` : ''}
            Si no eras vos, cerrá sesión.
          </Text>

          <BotonSecundario titulo="Cerrar sesión" alTocar={() => void cerrarSesion()} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Pantalla>
  )
}

const estilos = StyleSheet.create({
  flex: { flex: 1 },
  contenido: {
    flexGrow: 1,
    paddingHorizontal: espaciado.lg,
    paddingTop: espaciado.xl,
    paddingBottom: espaciado.xxl,
    gap: espaciado.base,
  },
  logo: {
    width: '65%',
    height: 100,
    alignSelf: 'center',
    backgroundColor: colores.blanco,
    borderRadius: radios.base,
    marginBottom: espaciado.sm,
  },
  titulo: {
    fontFamily: tipografia.familia.titulo,
    fontSize: tipografia.tamano.xl,
    color: colores.negro,
    textAlign: 'center',
    letterSpacing: 0.5,
  },
  boton: {
    marginTop: espaciado.sm,
    minWidth: 260,
  },
  pie: {
    fontFamily: tipografia.familia.liviana,
    fontSize: tipografia.tamano.micro,
    color: 'rgba(255,255,255,0.75)',
    textAlign: 'center',
    marginTop: espaciado.md,
  },
})
