import { espaciado, radios, validarLogin, type CampoLogin } from '@woodtools/compartido'
import { Image } from 'expo-image'
import { useEffect, useRef, useState } from 'react'
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native'

import { BotonPrincipal } from '../componentes/Botones'
import { Campo } from '../componentes/Formulario'
import { Aviso } from '../componentes/Estado'
import { Pantalla } from '../componentes/Pantalla'
import { usarSesion } from '../nucleo/sesion'
import { hojaDeTema } from '../nucleo/tema'

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
  const estilos = usarEstilos()
  const { iniciarSesion, procesando, errorAcceso, usuarioRecordado, recuperarContrasena } =
    usarSesion()

  const [usuario, setUsuario] = useState('')
  const [contrasena, setContrasena] = useState('')
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

    await iniciarSesion(usuario, contrasena)
  }

  /**
   * La contraseña la restablece la oficina.
   *
   * Antes esto mandaba un correo de recuperación de Supabase con un enlace a
   * `woodtoolsvisitas://recuperar`. El esquema abre la app, pero no hay ninguna
   * pantalla ni ninguna ruta que atienda ese enlace, y el cliente está creado
   * con `detectSessionInUrl: false`, así que el token no se consume nunca. El
   * vendedor hacía todo bien, la app le confirmaba éxito dos veces, tocaba el
   * enlace del correo y volvía a la misma pantalla de login.
   *
   * Terminaba llamando a la oficina igual, que es justo lo que el botón
   * prometía evitar. Mejor decirlo de entrada que hacerle perder el viaje.
   *
   * Cuando exista la pantalla que atienda el enlace, esto vuelve a ser un envío
   * de correo de verdad.
   */
  function alRecuperar() {
    Alert.alert(
      '¿Olvidaste la contraseña?',
      'Pedile a la oficina que te la restablezca desde el panel. Te van a dar una contraseña provisoria y la app te va a pedir que elijas una nueva al entrar.',
      [{ text: 'Entendido' }],
    )
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
            etiqueta="Usuario o email"
            ayuda="Con cualquiera de los dos entrás."
            sobreRojo
            obligatorio
            value={usuario}
            onChangeText={setUsuario}
            error={errores.usuario}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="username"
            textContentType="username"
            keyboardType="email-address"
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

          {/* Acá estaba "Recordar mi cuenta por 30 días". La sesión ya no
              vence: lo que protege la app es el desbloqueo del teléfono, que es
              más seguro que una contraseña que hay que tipear seguido en la
              calle —esas terminan escritas en un papel adentro de la funda—. */}

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

const usarEstilos = hojaDeTema((t) => ({
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
    backgroundColor: t.colores.blanco,
    borderRadius: radios.base,
    marginBottom: espaciado.sm,
  },
  titulo: {
    fontFamily: t.tipografia.familia.titulo,
    fontSize: t.tipografia.tamano.display,
    /*
     * Negro sobre el rojo de la marca, blanco sobre el fondo oscuro.
     *
     * El título va sobre el fondo de la pantalla, no sobre el panel. En el
     * tema claro ese fondo es el rojo #B30F0F y el negro se recorta contra él;
     * en el oscuro el fondo es casi negro y el título se volvía una mancha con
     * el halo blanco alrededor y ninguna letra adentro.
     */
    color: t.oscuro ? t.colores.blanco : t.colores.negro,
    textAlign: 'center',
    letterSpacing: 0.5,
    marginBottom: espaciado.sm,
    // El halo blanco existe para despegar el negro del rojo. Con la letra ya
    // blanca no separa nada: sería un blanco alrededor de un blanco.
    textShadowColor: t.oscuro ? 'transparent' : 'rgba(255,255,255,0.35)',
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
    fontFamily: t.tipografia.familia.cuerpo,
    fontSize: t.tipografia.tamano.sm,
    color: t.colores.blanco,
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
    borderColor: t.colores.borde,
    borderRadius: radios.sm,
    backgroundColor: t.colores.campo,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordarMarcada: {
    backgroundColor: t.colores.verde,
  },
  recordarTilde: {
    fontFamily: t.tipografia.familia.titulo,
    fontSize: 20,
    lineHeight: 24,
    color: t.colores.negro,
  },
  recordarTexto: {
    flex: 1,
    fontFamily: t.tipografia.familia.cuerpo,
    fontSize: t.tipografia.tamano.base,
    color: t.colores.blanco,
  },
  boton: {
    marginTop: espaciado.sm,
    minWidth: 260,
  },
  pie: {
    fontFamily: t.tipografia.familia.liviana,
    fontSize: t.tipografia.tamano.micro,
    color: 'rgba(255,255,255,0.75)',
    textAlign: 'center',
    marginTop: espaciado.lg,
  },
}))
