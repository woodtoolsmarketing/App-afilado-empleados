import { espaciado, radios, validarLogin, type CampoLogin } from '@woodtools/compartido'
import { Image } from 'expo-image'
import { useEffect, useRef, useState } from 'react'
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native'

import { BotonPrincipal, BotonSecundario } from '../componentes/Botones'
import { Campo } from '../componentes/Formulario'
import { Aviso } from '../componentes/Estado'
import { Pantalla } from '../componentes/Pantalla'
import { usarSesion } from '../nucleo/sesion'
import { hojaDeTema } from '../nucleo/tema'
import {
  completarRestablecer,
  olvidarPedido,
  pedidoGuardado,
  pedirRestablecer,
  type PedidoGuardado,
} from '../servicios/restablecerContrasena'

/** Lo mismo que exige la pantalla de cambio y la función del servidor. */
const LARGO_MINIMO = 6

/**
 * Pantalla de inicio de sesión.
 *
 * Reglas de la consigna:
 *  · Usuario y contraseña son obligatorios: si falta alguno, no deja avanzar y
 *    señala cuál es.
 *  · El acceso además tiene que estar aprobado por un administrador; eso se
 *    resuelve después del login, en `usarSesion`.
 *
 * Además atiende el olvido de contraseña sin salir de acá: es un trámite que
 * pasa ANTES de tener sesión, así que vive en esta pantalla y no en la máquina
 * de estados de `usarSesion`. Ver `servicios/restablecerContrasena.ts`.
 */
export function PantallaIniciarSesion() {
  const estilos = usarEstilos()
  const { iniciarSesion, procesando, errorAcceso, usuarioRecordado, agregandoCuenta, cancelarAgregarCuenta } =
    usarSesion()

  const [usuario, setUsuario] = useState('')
  const [contrasena, setContrasena] = useState('')
  const [verContrasena, setVerContrasena] = useState(false)
  const [errores, setErrores] = useState<Partial<Record<CampoLogin, string>>>({})
  const [intentado, setIntentado] = useState(false)

  /** El pedido de restablecimiento en curso. Si hay uno, se muestra ese panel. */
  const [pedido, setPedido] = useState<PedidoGuardado | null>(null)
  const [pidiendo, setPidiendo] = useState(false)
  const [avisoRecuperar, setAvisoRecuperar] = useState<string | null>(null)

  const refContrasena = useRef<TextInput>(null)

  useEffect(() => {
    // Agregando OTRA cuenta se arranca en blanco: prellenar con el usuario de la
    // cuenta que ya está abierta sería justo el que no se quiere volver a poner.
    if (agregandoCuenta) return
    if (usuarioRecordado) {
      setUsuario(usuarioRecordado)
      refContrasena.current?.focus()
    }
  }, [usuarioRecordado, agregandoCuenta])

  // Si el vendedor ya había pedido el restablecimiento y cerró la app mientras
  // esperaba, al volver retoma el pedido donde lo dejó.
  useEffect(() => {
    void pedidoGuardado().then(setPedido)
  }, [])

  useEffect(() => {
    if (!intentado) return
    setErrores(validarLogin(usuario, contrasena).errores)
  }, [usuario, contrasena, intentado])

  async function alEntrar() {
    setIntentado(true)
    const { valido, errores: nuevos } = validarLogin(usuario, contrasena)
    setErrores(nuevos)

    if (!valido) {
      if (nuevos.contrasena && !nuevos.usuario) refContrasena.current?.focus()
      return
    }

    await iniciarSesion(usuario, contrasena)
  }

  /**
   * Pide a la oficina que le restablezcan la contraseña.
   *
   * Antes esto mostraba un cartel muerto ("llamá a la oficina") porque no había
   * a dónde mandar el pedido. Ahora crea uno de verdad: la oficina lo ve en el
   * panel, lo habilita, y recién ahí el vendedor elige su clave nueva —sin que
   * nadie le dicte ninguna provisoria—.
   */
  async function alRecuperar() {
    setAvisoRecuperar(null)
    if (!usuario.trim()) {
      setAvisoRecuperar('Escribí primero tu usuario arriba y después tocá acá.')
      return
    }

    setPidiendo(true)
    try {
      await pedirRestablecer(usuario)
      setPedido(await pedidoGuardado())
    } catch (e) {
      setAvisoRecuperar(e instanceof Error ? e.message : 'No pudimos registrar el pedido.')
    } finally {
      setPidiendo(false)
    }
  }

  // ── Panel de "elegí tu contraseña nueva" ─────────────────────────────────
  if (pedido) {
    return (
      <PantallaElegirNueva
        usuario={pedido.usuario}
        alCancelar={async () => {
          await olvidarPedido()
          setPedido(null)
        }}
        alListo={async () => {
          await olvidarPedido()
          setPedido(null)
          setUsuario(pedido.usuario)
          setContrasena('')
          setIntentado(false)
          setErrores({})
          refContrasena.current?.focus()
        }}
      />
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
            {agregandoCuenta ? 'AGREGAR CUENTA' : 'INICIÁ SESIÓN'}
          </Text>

          {agregandoCuenta ? (
            <Aviso tono="info" titulo="Estás sumando otra cuenta">
              Iniciá sesión con la otra cuenta. La que ya tenías abierta queda guardada y podés
              volver a ella cuando quieras.
            </Aviso>
          ) : null}

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

          {avisoRecuperar ? (
            <Aviso tono="atencion" titulo="Para restablecer la contraseña">
              {avisoRecuperar}
            </Aviso>
          ) : null}

          <Pressable
            onPress={alRecuperar}
            disabled={pidiendo}
            hitSlop={12}
            style={estilos.olvide}
            accessibilityRole="link"
          >
            <Text style={estilos.olvideTexto}>
              {pidiendo ? 'Enviando el pedido…' : 'Olvidé mi contraseña'}
            </Text>
          </Pressable>

          <BotonPrincipal
            titulo={agregandoCuenta ? 'AGREGAR ESTA CUENTA' : 'INICIAR SESIÓN'}
            alTocar={alEntrar}
            cargando={procesando}
            style={estilos.boton}
          />

          {agregandoCuenta ? (
            <BotonSecundario
              titulo="Volver a mi cuenta"
              alTocar={() => void cancelarAgregarCuenta()}
              style={estilos.volver}
            />
          ) : null}

          <Text style={estilos.pie}>
            Uso interno de WoodTools S.R.L. El acceso lo habilita un administrador.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </Pantalla>
  )
}

/**
 * "Elegí tu contraseña nueva", después de pedir el restablecimiento.
 *
 * Vive deslogueado: no se puede usar `usarSesion().cambiarContrasena`, que
 * necesita sesión. El cambio lo aplica la función del servidor, que sólo lo deja
 * pasar si la oficina ya habilitó el pedido. Por eso el botón puede volver con
 * "todavía no te habilitaron": no es un error, es que falta el paso de la
 * oficina, y se dice tal cual.
 */
function PantallaElegirNueva({
  usuario,
  alCancelar,
  alListo,
}: {
  usuario: string
  alCancelar: () => void | Promise<void>
  alListo: () => void | Promise<void>
}) {
  const estilos = usarEstilos()
  const [nueva, setNueva] = useState('')
  const [repetida, setRepetida] = useState('')
  const [ver, setVer] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [listo, setListo] = useState(false)
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
      await completarRestablecer(nueva)
      setListo(true)
    } catch (e) {
      setError(
        e instanceof Error && e.message
          ? e.message
          : 'No pudimos cambiarla. Probá de nuevo en un momento.',
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

          {listo ? (
            <>
              <Aviso tono="exito" titulo="Contraseña cambiada">
                Listo. Entrá con tu contraseña nueva.
              </Aviso>
              <BotonPrincipal titulo="IR A INICIAR SESIÓN" alTocar={() => void alListo()} style={estilos.boton} />
            </>
          ) : (
            <>
              <Aviso tono="info" titulo={`Pedido enviado para ${usuario}`}>
                Pedile a la oficina que lo habilite. Cuando te avisen que ya está, elegí acá tu
                contraseña nueva y tocá cambiar.
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
                titulo="CAMBIAR MI CONTRASEÑA"
                alTocar={guardar}
                cargando={guardando}
                style={estilos.boton}
              />

              <BotonSecundario titulo="Cancelar el pedido" alTocar={() => void alCancelar()} />
            </>
          )}
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
  boton: {
    marginTop: espaciado.sm,
    minWidth: 260,
  },
  volver: {
    marginTop: espaciado.xs,
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
