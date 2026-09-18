import { espaciado, radios, TOQUE_MINIMO } from '@woodtools/compartido'
import { Alert, Pressable, Text, View } from 'react-native'

import { BotonMenu } from '../componentes/Botones'
import { Aviso } from '../componentes/Estado'
import { Encabezado } from '../componentes/Encabezado'
import { BarraPanel, Pantalla, Panel, TituloPanel } from '../componentes/Pantalla'
import type { CuentaGuardada } from '../nucleo/cuentas'
import { usarSesion } from '../nucleo/sesion'
import { hojaDeTema } from '../nucleo/tema'
import type { PropsPantalla } from '../navegacion/tipos'
import { seguimientoActivo } from '../servicios/ubicacion'

/**
 * "CUENTAS"
 *
 * Varias cuentas en el mismo teléfono, para el vendedor que tiene una de Buenos
 * Aires y otra para las giras. Se toca una y se pasa a ella al instante —ya se
 * pasó el candado del teléfono al abrir la app, no hace falta la contraseña de
 * nuevo— o se agrega otra, que sí se loguea con su clave.
 *
 * Antes de cambiar o agregar, si hay un recorrido en curso se avisa: el
 * seguimiento de ubicación es por cuenta y cambiar de una lo corta.
 */
export function PantallaCuentas({ navigation }: PropsPantalla<'Cuentas'>) {
  const estilos = usarEstilos()
  const { perfil, cuentas, cambiarCuenta, agregarCuenta, cerrarSesion, quitarCuenta } = usarSesion()

  const activaId = perfil?.id ?? null

  /**
   * Cambiar y agregar cortan el seguimiento de la cuenta que se deja. Si hay
   * uno en curso se avisa y se pide confirmar; si no, se sigue derecho.
   */
  async function conGuardaDeRecorrido(accion: () => void | Promise<void>) {
    const enCurso = await seguimientoActivo()
    if (!enCurso) {
      await accion()
      return
    }
    Alert.alert(
      'Tenés un recorrido en curso',
      'Si cambiás de cuenta se corta el seguimiento de tu ubicación de esta cuenta. El recorrido queda abierto y lo podés reanudar más tarde.',
      [
        { text: 'Volver', style: 'cancel' },
        { text: 'Cambiar igual', style: 'destructive', onPress: () => void accion() },
      ],
    )
  }

  function cambiar(cuenta: CuentaGuardada) {
    if (cuenta.perfilId === activaId) return
    void conGuardaDeRecorrido(() => cambiarCuenta(cuenta.perfilId))
  }

  function agregar() {
    void conGuardaDeRecorrido(() => agregarCuenta())
  }

  function cerrarLaActiva() {
    Alert.alert(
      'Cerrar sesión',
      'Esta cuenta se saca de este teléfono. Si tenés otra guardada, se pasa a ella; si no, vas a la pantalla de ingreso.',
      [
        { text: 'Volver', style: 'cancel' },
        { text: 'Cerrar sesión', style: 'destructive', onPress: () => void cerrarSesion() },
      ],
    )
  }

  function quitar(cuenta: CuentaGuardada) {
    Alert.alert(
      `Quitar a ${cuenta.nombre}`,
      'Se saca esta cuenta de este teléfono. Para volver a usarla vas a tener que iniciar sesión con su contraseña.',
      [
        { text: 'Volver', style: 'cancel' },
        {
          text: 'Quitar',
          style: 'destructive',
          onPress: () => void quitarCuenta(cuenta.perfilId),
        },
      ],
    )
  }

  return (
    <Pantalla>
      <Encabezado />

      <Panel contentStyle={estilos.contenido}>
        <BarraPanel alVolver={() => navigation.goBack()} />

        <TituloPanel>CUENTAS</TituloPanel>

        {cuentas.map((cuenta) => {
          const activa = cuenta.perfilId === activaId
          return (
            <View key={cuenta.perfilId} style={[estilos.fila, activa && estilos.filaActiva]}>
              <Pressable
                onPress={() => cambiar(cuenta)}
                disabled={activa}
                accessibilityRole="button"
                accessibilityLabel={activa ? `${cuenta.nombre}, en uso` : `Cambiar a ${cuenta.nombre}`}
                style={({ pressed }) => [estilos.toqueFila, pressed && !activa && estilos.tocado]}
              >
                <View style={[estilos.avatar, activa && estilos.avatarActivo]}>
                  <Text style={estilos.iniciales}>{iniciales(cuenta.nombre)}</Text>
                </View>
                <View style={estilos.textos}>
                  <Text style={estilos.nombre} numberOfLines={1}>
                    {cuenta.nombre}
                  </Text>
                  <Text style={estilos.detalle} numberOfLines={1}>
                    {[cuenta.usuario ?? cuenta.email, cuenta.codigoVendedor ? `#${cuenta.codigoVendedor}` : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                </View>
                {activa ? (
                  <Text style={estilos.enUso}>EN USO</Text>
                ) : (
                  <Text style={estilos.flecha}>→</Text>
                )}
              </Pressable>

              <Pressable
                onPress={() => (activa ? cerrarLaActiva() : quitar(cuenta))}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={activa ? 'Cerrar sesión de esta cuenta' : `Quitar a ${cuenta.nombre}`}
                style={({ pressed }) => [estilos.quitar, pressed && estilos.tocado]}
              >
                <Text style={estilos.quitarTexto}>{activa ? 'Cerrar sesión' : 'Quitar'}</Text>
              </Pressable>
            </View>
          )
        })}

        <BotonMenu titulo="AGREGAR OTRA CUENTA" alTocar={agregar} />

        <Aviso tono="info" titulo="Cada cuenta se autoriza una vez">
          La primera vez que entrás con una cuenta nueva en este teléfono, un administrador tiene
          que habilitarlo, igual que con cualquier teléfono. Después el cambio es directo.
        </Aviso>
      </Panel>
    </Pantalla>
  )
}

function iniciales(nombre?: string | null): string {
  if (!nombre) return '?'
  return nombre
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
}

const usarEstilos = hojaDeTema((t) => ({
  contenido: { gap: espaciado.md },

  fila: {
    backgroundColor: t.colores.campoBlanco,
    borderWidth: 2,
    borderColor: t.colores.borde,
    borderRadius: radios.sm,
    overflow: 'hidden',
  },
  filaActiva: {
    borderColor: t.colores.rojo,
  },
  toqueFila: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaciado.md,
    padding: espaciado.md,
  },
  tocado: { backgroundColor: t.colores.panelOscuro },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.colores.rojoOscuro,
  },
  avatarActivo: {
    backgroundColor: t.colores.rojo,
  },
  iniciales: {
    fontFamily: t.tipografia.familia.subtitulo,
    fontSize: t.tipografia.tamano.base,
    color: t.colores.blanco,
  },
  textos: { flex: 1 },
  nombre: {
    fontFamily: t.tipografia.familia.fuerte,
    fontSize: t.tipografia.tamano.base,
    color: t.colores.tinta,
  },
  detalle: {
    fontFamily: t.tipografia.familia.cuerpo,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.tintaSuave,
  },
  enUso: {
    fontFamily: t.tipografia.familia.subtitulo,
    fontSize: t.tipografia.tamano.micro,
    color: t.colores.rojo,
    letterSpacing: 1,
  },
  flecha: {
    fontFamily: t.tipografia.familia.subtitulo,
    fontSize: t.tipografia.tamano.lg,
    color: t.colores.tintaSuave,
  },
  quitar: {
    minHeight: TOQUE_MINIMO,
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingHorizontal: espaciado.md,
    paddingBottom: espaciado.sm,
  },
  quitarTexto: {
    fontFamily: t.tipografia.familia.cuerpo,
    fontSize: t.tipografia.tamano.sm,
    color: t.colores.tintaSuave,
    textDecorationLine: 'underline',
  },
}))
