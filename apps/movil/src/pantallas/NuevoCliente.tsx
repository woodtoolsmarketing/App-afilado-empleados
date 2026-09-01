import {
  CLIENTE_NUEVO_VACIO,
  espaciado,
  radios,
  validarClienteNuevo,
  type CampoClienteNuevo,
  type FormularioClienteNuevo,
} from '@woodtools/compartido'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import * as Crypto from 'expo-crypto'
import { useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  View,
} from 'react-native'

import { BotonMenu } from '../componentes/Botones'
import { Campo, MensajeError } from '../componentes/Formulario'
import { Aviso } from '../componentes/Estado'
import { Encabezado } from '../componentes/Encabezado'
import { BarraPanel, Pantalla, Panel, TituloPanel } from '../componentes/Pantalla'
import { crearClienteProvisorio } from '../servicios/clientes'
import { detallarDireccion, sugerirDirecciones, type SugerenciaDireccion } from '../servicios/mapas'
import type { PropsPantalla } from '../navegacion/tipos'
import { hojaDeTema, usarTema } from '../nucleo/tema'

/**
 * "GENERAR NUEVO CLIENTE"
 *
 * Se llega desde "¿Es nuevo cliente?" en la nota de pedido. Junta todo lo que
 * Administración va a necesitar para darlo de alta en el sistema, así no tienen
 * que llamar al vendedor para pedirle el CUIT o la dirección.
 *
 * El cliente se crea **provisorio**: existe y es buscable, pero con código
 * automático. La nota que lo use igual queda sin número hasta que la oficina le
 * ponga el código real.
 */
export function PantallaNuevoCliente({ navigation, route }: PropsPantalla<'NuevoCliente'>) {
  const { colores } = usarTema()
  const estilos = usarEstilos()
  const cliente = useQueryClient()

  const [form, setForm] = useState<FormularioClienteNuevo>({
    ...CLIENTE_NUEVO_VACIO,
    // Si el vendedor ya había escrito algo en la nota, no se lo hacemos tipear
    // de nuevo.
    razon_social: route.params?.nombreInicial ?? '',
    documento: route.params?.documentoInicial ?? '',
  })
  const [errores, setErrores] = useState<Partial<Record<CampoClienteNuevo, string>>>({})
  const [intentado, setIntentado] = useState(false)

  const [texto, setTexto] = useState('')
  const [sugerencias, setSugerencias] = useState<SugerenciaDireccion[]>([])
  const [buscando, setBuscando] = useState(false)
  const [elegida, setElegida] = useState(false)

  const sesion = useRef(Crypto.randomUUID())
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (elegida) return
    if (temporizador.current) clearTimeout(temporizador.current)
    if (texto.trim().length < 4) {
      setSugerencias([])
      return
    }
    temporizador.current = setTimeout(async () => {
      setBuscando(true)
      try {
        setSugerencias(await sugerirDirecciones(texto, sesion.current))
      } catch {
        setSugerencias([])
      } finally {
        setBuscando(false)
      }
    }, 350)
    return () => {
      if (temporizador.current) clearTimeout(temporizador.current)
    }
  }, [texto, elegida])

  /**
   * Aplica los cambios SOBRE EL ESTADO ANTERIOR, no sobre la copia del render.
   *
   * Es el mismo error que tenía la nota de pedido. Acá pegaba en el peor
   * momento: entre que el vendedor toca una sugerencia de dirección y que
   * Google contesta pasan segundos, y en esos segundos sigue tipeando el
   * teléfono y el contacto. Cuando llegaba la respuesta, `{ ...form }` era el
   * formulario de ANTES de tocar la sugerencia, así que todo lo escrito en el
   * medio se borraba solo.
   */
  function actualizar(cambios: Partial<FormularioClienteNuevo>) {
    setForm((previo) => {
      const nuevo = { ...previo, ...cambios }
      if (intentado) setErrores(validarClienteNuevo(nuevo).errores)
      return nuevo
    })
  }

  async function elegirSugerencia(s: SugerenciaDireccion) {
    setElegida(true)
    setSugerencias([])
    setTexto(s.texto)
    setBuscando(true)
    try {
      const d = await detallarDireccion(s.place_id, sesion.current)
      sesion.current = Crypto.randomUUID()
      actualizar({
        direccion: d.direccion_formateada,
        codigo_postal: d.codigo_postal ?? '',
        lat: d.lat,
        lng: d.lng,
        google_place_id: d.google_place_id,
        localidad: d.localidad,
        provincia: d.provincia,
      })
    } catch (e) {
      Alert.alert('No pudimos leer esa dirección', (e as Error).message)
      setElegida(false)
    } finally {
      setBuscando(false)
    }
  }

  // ── Teléfonos: se agregan de a uno con el ⊕ ──────────────────────────────
  function cambiarTelefono(indice: number, valor: string) {
    const telefonos = [...form.telefonos]
    telefonos[indice] = valor
    actualizar({ telefonos })
  }

  function agregarTelefono() {
    actualizar({ telefonos: [...form.telefonos, ''] })
  }

  function quitarTelefono(indice: number) {
    actualizar({ telefonos: form.telefonos.filter((_, i) => i !== indice) })
  }

  const guardar = useMutation({
    mutationFn: () => crearClienteProvisorio(form),
    onSuccess: async (nuevo) => {
      await cliente.invalidateQueries()
      Alert.alert(
        'Cliente creado',
        `${nuevo.razon_social} quedó cargado como provisorio (${nuevo.codigo}).\n\nAdministración le va a asignar el código definitivo; hasta entonces la nota queda sin número.`,
        [
          {
            text: 'Seguir con la nota',
            onPress: () =>
              navigation.navigate('GenerarNota', {
                clienteCreadoId: nuevo.id,
                clienteCreadoNombre: nuevo.razon_social,
                clienteCreadoCuit: nuevo.cuit ?? '',
                // La ubicación viaja para que la nota le asigne la zona sola,
                // igual que cuando el cliente ya existía.
                clienteCreadoLocalidad: form.localidad ?? undefined,
                clienteCreadoProvincia: form.provincia ?? undefined,
                clienteCreadoDireccion: form.direccion || undefined,
              }),
          },
        ],
      )
    },
    onError: (e: Error) => Alert.alert('No pudimos crear el cliente', e.message),
  })

  function alGenerar() {
    setIntentado(true)
    const { valido, errores: nuevos } = validarClienteNuevo(form)
    setErrores(nuevos)
    if (valido) guardar.mutate()
  }

  return (
    <Pantalla>
      <Encabezado />

      <KeyboardAvoidingView
        style={estilos.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Panel contentStyle={estilos.contenido}>
          <BarraPanel alVolver={() => navigation.goBack()} />

          <TituloPanel>{'GENERAR NUEVO\nCLIENTE'}</TituloPanel>

          <Campo
            etiqueta="NOMBRE Y APELLIDO O RAZÓN SOCIAL"
            obligatorio
            value={form.razon_social}
            onChangeText={(t) => actualizar({ razon_social: t })}
            placeholder="Como figura o como lo conocen"
            autoCapitalize="words"
            error={errores.razon_social}
          />

          <Campo
            etiqueta="DNI O CUIT"
            obligatorio
            value={form.documento}
            onChangeText={(t) => actualizar({ documento: t.replace(/[^\d-]/g, '') })}
            placeholder="30-12345678-9"
            keyboardType="numbers-and-punctuation"
            contenedorStyle={estilos.medio}
            error={errores.documento}
          />

          <Campo
            etiqueta="DIRECCIÓN DEL TALLER"
            obligatorio
            value={texto}
            onChangeText={(t) => {
              setTexto(t)
              setElegida(false)
              if (form.lat !== null) {
                // Editar el texto invalida las coordenadas que ya teníamos.
                actualizar({ lat: null, lng: null, google_place_id: null, direccion: t })
              }
            }}
            placeholder="Calle, número, localidad"
            autoCapitalize="words"
            error={errores.direccion}
            ayuda="Elegí una de las sugerencias para que se cargue el CP y la ubicación."
            accesorio={buscando ? <ActivityIndicator size="small" color={colores.rojo} /> : undefined}
          />

          {sugerencias.length > 0 ? (
            <View style={estilos.sugerencias}>
              {sugerencias.map((s) => (
                <Pressable
                  key={s.place_id}
                  onPress={() => elegirSugerencia(s)}
                  accessibilityRole="button"
                  accessibilityLabel={s.texto}
                  style={({ pressed }) => [estilos.sugerencia, pressed && estilos.tocado]}
                >
                  <Text style={estilos.sugerenciaPrincipal} numberOfLines={1}>
                    {s.principal || s.texto}
                  </Text>
                  {s.secundario ? (
                    <Text style={estilos.sugerenciaSecundaria} numberOfLines={1}>
                      {s.secundario}
                    </Text>
                  ) : null}
                </Pressable>
              ))}
            </View>
          ) : null}

          {form.lat !== null ? (
            <Aviso tono="exito" titulo="Dirección confirmada">
              {form.direccion}
            </Aviso>
          ) : null}

          <Campo
            etiqueta="CÓDIGO POSTAL"
            obligatorio
            value={form.codigo_postal}
            onChangeText={(t) => actualizar({ codigo_postal: t })}
            placeholder="1704"
            autoCapitalize="characters"
            maxLength={8}
            contenedorStyle={estilos.corto}
            error={errores.codigo_postal}
            ayuda={form.lat !== null ? 'Lo completó Google. Podés corregirlo.' : undefined}
          />

          {/* ── Teléfonos ─────────────────────────────────────────────────── */}
          <View style={estilos.bloque}>
            <Text style={estilos.rotulo}>TELÉFONO/S</Text>

            {form.telefonos.map((tel, i) => (
              <View key={i} style={estilos.filaTelefono}>
                <Campo
                  value={tel}
                  onChangeText={(t) => cambiarTelefono(i, t)}
                  placeholder="11 4444 5555"
                  keyboardType="phone-pad"
                  contenedorStyle={estilos.flex}
                />
                {i === form.telefonos.length - 1 ? (
                  <Pressable
                    onPress={agregarTelefono}
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel="Agregar otro teléfono"
                    style={({ pressed }) => [estilos.botonRedondo, pressed && estilos.tocado]}
                  >
                    <Text style={estilos.botonRedondoTexto}>+</Text>
                  </Pressable>
                ) : (
                  <Pressable
                    onPress={() => quitarTelefono(i)}
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel={`Quitar el teléfono ${i + 1}`}
                    style={({ pressed }) => [
                      estilos.botonRedondo,
                      estilos.botonQuitar,
                      pressed && estilos.tocado,
                    ]}
                  >
                    <Text style={[estilos.botonRedondoTexto, estilos.botonQuitarTexto]}>−</Text>
                  </Pressable>
                )}
              </View>
            ))}
          </View>

          <Campo
            etiqueta="CORREO ELECTRÓNICO"
            value={form.email}
            onChangeText={(t) => actualizar({ email: t })}
            placeholder="cliente@correo.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            error={errores.email}
          />

          <Campo
            etiqueta="NOMBRE DE FANTASÍA"
            value={form.nombre_fantasia}
            onChangeText={(t) => actualizar({ nombre_fantasia: t })}
            placeholder="Cómo lo conocen en la zona"
            autoCapitalize="words"
          />

          <MensajeError>
            {intentado && Object.keys(errores).length > 0
              ? 'Revisá los campos marcados en rojo.'
              : undefined}
          </MensajeError>

          <Aviso tono="info">
            El cliente se guarda como provisorio con un código automático. Administración le asigna
            el definitivo, y recién ahí la nota de pedido recibe su número.
          </Aviso>

          <BotonMenu
            titulo={'GENERAR\nNUEVO CLIENTE'}
            alTocar={alGenerar}
            cargando={guardar.isPending}
          />
        </Panel>
      </KeyboardAvoidingView>
    </Pantalla>
  )
}

const usarEstilos = hojaDeTema((t) => ({
  flex: { flex: 1 },
  contenido: { gap: espaciado.md },
  medio: { maxWidth: 240 },
  corto: { maxWidth: 180 },

  bloque: { gap: espaciado.xs },
  rotulo: {
    fontFamily: t.tipografia.familia.cuerpo,
    fontSize: t.tipografia.tamano.base,
    color: t.colores.tinta,
  },
  filaTelefono: { flexDirection: 'row', alignItems: 'flex-start', gap: espaciado.sm },

  botonRedondo: {
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: 2.5,
    borderColor: t.colores.borde,
    backgroundColor: t.colores.verde,
    alignItems: 'center',
    justifyContent: 'center',
  },
  botonQuitar: { backgroundColor: t.colores.panelOscuro },
  botonRedondoTexto: {
    fontFamily: t.tipografia.familia.titulo,
    fontSize: 24,
    lineHeight: 28,
    // El "+" va sobre el verde, que es el mismo en los dos temas: negro.
    color: t.colores.negro,
  },
  /*
   * El "−" va sobre un gris que en el tema oscuro se da vuelta, así que su
   * letra tiene que darse vuelta con él. Con el negro compartido quedaba un
   * botón redondo vacío, indistinguible de uno deshabilitado.
   */
  botonQuitarTexto: { color: t.colores.tinta },

  sugerencias: {
    borderWidth: 2,
    borderColor: t.colores.borde,
    borderRadius: radios.sm,
    backgroundColor: t.colores.campoBlanco,
    overflow: 'hidden',
  },
  sugerencia: {
    paddingHorizontal: espaciado.md,
    paddingVertical: espaciado.md,
    borderBottomWidth: 1,
    borderBottomColor: t.colores.panelOscuro,
    minHeight: 60,
    justifyContent: 'center',
  },
  tocado: { opacity: 0.7 },
  sugerenciaPrincipal: {
    fontFamily: t.tipografia.familia.fuerte,
    fontSize: t.tipografia.tamano.sm,
    color: t.colores.tinta,
  },
  sugerenciaSecundaria: {
    fontFamily: t.tipografia.familia.liviana,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.tintaSuave,
  },
}))
