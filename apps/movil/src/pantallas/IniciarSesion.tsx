import {
  colores,
  espaciado,
  radios,
  tipografia,
  validarLogin,
  type CampoLogin,
} from '@woodtools/compartido'
import { Image } from 'expo-image'
import { useEffect, useRef, useState } from 'react'
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'

import { BotonPrincipal } from '../componentes/Botones'
import { Campo } from '../componentes/Formulario'
import { Aviso } from '../componentes/Estado'
import { Pantalla } from '../componentes/Pantalla'
import { usarSesion } from '../nucleo/sesion'

/**
 * Pantalla de inicio de sesión.
 *
 * Reglas de la consigna:
 *  · Usuario y contraseña son obligatorios: si falta alguno, no deja avanzar y
 *    señala cuál es.
 *  · "Recordar mi cuenta por 30 días" evita volver a pedir el login durante ese
 *    plazo; cumplidos los 30 días se vuelve a pedir.
 *  · El acceso además tiene que estar aprobado por un administrador; eso se
 *    resuelve después del login, en `usarSesion`.
 */
export function PantallaIniciarSesion() {
  const { iniciarSesion, procesando, errorAcceso, usuarioRecordado, recuperarContrasena } =
    usarSesion()

  const [usuario, setUsuario] = useState('')
  const [contrasena, setContrasena] = useState('')
  const [recordar, setRecordar] = useState(true)
  const [verContrasena, setVerContrasena] = useState(false)
  const [errores, setErrores] = useState<Partial<Record<CampoLogin, string>>>({})
  const [intentado, setIntentado] = useState(false)

  const refContrasena = useRef<TextInput>(null)

  useEffect(() => {
    if (usuarioRecordado) setUsuario(usuarioRecordado)
  }, [usuarioRecordado])

  // Una vez que el usuario intentó entrar, los errores se recalculan mientras
  // escribe: así ve desaparecer el mensaje en cuanto corrige el campo.
  useEffect(() => {
    if (!intentado) return
    setErrores(validarLogin(usuario, contrasena).errores)
  }, [usuario, contrasena, intentado])

  async function alEntrar() {
    setIntentado(true)
    const { valido, errores: nuevos } = validarLogin(usuario, contrasena)
    setErrores(nuevos)

    if (!valido) {
      // Lleva el foco al primer campo con problema.
      if (nuevos.contrasena && !nuevos.usuario) refContrasena.current?.focus()
      return
    }

    await iniciarSesion(usuario, contrasena, recordar)
  }

  async function alRecuperar() {
    if (!usuario.trim()) {
      setIntentado(true)
      setErrores({ usuario: 'Escribí tu usuario y volvé a tocar "Olvidé mi contraseña"' })
      return
    }
    try {
      await recuperarContrasena(usuario)
      Alert.alert(
        'Listo',
        'Si el usuario existe, te llega un correo con el enlace para cambiar la contraseña.',
      )
    } catch {
      Alert.alert(
        'No pudimos enviar el correo',
        'Revisá tu conexión o pedile a la oficina que te restablezca la contraseña.',
      )
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
            INICIÁ SESIÓN
          </Text>

          {errorAcceso ? (
            <Aviso tono="error" titulo="No pudimos entrar">
              {errorAcceso}
            </Aviso>
          ) : null}

          <Campo
            etiqueta="Usuario"
            sobreRojo
            obligatorio
            value={usuario}
            onChangeText={setUsuario}
            error={errores.usuario}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="username"
            textContentType="username"
            returnKeyType="next"
            onSubmitEditing={() => refContrasena.current?.focus()}
            editable={!procesando}
          />

          <Campo
            ref={refContrasena}
            etiqueta="Contraseña"
            sobreRojo
            obligatorio
            value={contrasena}
            onChangeText={setContrasena}
            error={errores.contrasena}
            secureTextEntry={!verContrasena}
            autoCapitalize="none"
            autoComplete="current-password"
            textContentType="password"
            returnKeyType="go"
            onSubmitEditing={alEntrar}
            editable={!procesando}
            accesorio={
              <Pressable
                onPress={() => setVerContrasena((v) => !v)}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel={verContrasena ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              >
                <Text style={estilos.verContrasena}>{verContrasena ? '🙈' : '👁'}</Text>
              </Pressable>
            }
          />

          <Pressable
            onPress={alRecuperar}
            hitSlop={12}
            style={estilos.olvide}
            accessibilityRole="link"
          >
            <Text style={estilos.olvideTexto}>Olvidé mi contraseña</Text>
          </Pressable>

          <Pressable
            onPress={() => setRecordar((r) => !r)}
            style={estilos.recordarFila}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: recordar }}
            accessibilityLabel="Recordar mi cuenta por 30 días"
            hitSlop={8}
          >
            <View style={[estilos.recordarCaja, recordar && estilos.recordarMarcada]}>
              {recordar ? <Text style={estilos.recordarTilde}>✓</Text> : null}
            </View>
            <Text style={estilos.recordarTexto}>Recordar mi cuenta por 30 días</Text>
          </Pressable>

          <BotonPrincipal
            titulo="INICIAR SESIÓN"
            alTocar={alEntrar}
            cargando={procesando}
            style={estilos.boton}
          />

          <Text style={estilos.pie}>
            Uso interno de WoodTools S.R.L. El acceso lo habilita un administrador.
          </Text>
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
    height: 110,
    alignSelf: 'center',
    backgroundColor: colores.blanco,
    borderRadius: radios.base,
    marginBottom: espaciado.sm,
  },
  titulo: {
    fontFamily: tipografia.familia.titulo,
    fontSize: tipografia.tamano.display,
    color: colores.negro,
    textAlign: 'center',
    letterSpacing: 0.5,
    marginBottom: espaciado.sm,
    textShadowColor: 'rgba(255,255,255,0.35)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 12,
  },
  verContrasena: {
    fontSize: 20,
  },
  olvide: {
    alignSelf: 'flex-end',
    paddingVertical: espaciado.xs,
  },
  olvideTexto: {
    fontFamily: tipografia.familia.cuerpo,
    fontSize: tipografia.tamano.sm,
    color: colores.blanco,
    textDecorationLine: 'underline',
  },
  recordarFila: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaciado.md,
    paddingVertical: espaciado.md,
  },
  recordarCaja: {
    width: 32,
    height: 32,
    borderWidth: 2.5,
    borderColor: colores.negro,
    borderRadius: radios.sm,
    backgroundColor: colores.campo,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordarMarcada: {
    backgroundColor: colores.verde,
  },
  recordarTilde: {
    fontFamily: tipografia.familia.titulo,
    fontSize: 20,
    lineHeight: 24,
    color: colores.negro,
  },
  recordarTexto: {
    flex: 1,
    fontFamily: tipografia.familia.cuerpo,
    fontSize: tipografia.tamano.base,
    color: colores.blanco,
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
    marginTop: espaciado.lg,
  },
})
