import {
  CONDICIONES_IVA,
  espaciado,
  radios,
  type CampoClienteNuevo,
  type CondicionIva,
  type FormularioClienteNuevo,
} from '@woodtools/compartido'
import { useMutation } from '@tanstack/react-query'
import * as Crypto from 'expo-crypto'
import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native'

import { BotonMenu } from './Botones'
import { Campo, Desplegable } from './Formulario'
import { Aviso } from './Estado'
import {
  detallarDireccion,
  sugerirDirecciones,
  ubicacionComoDireccion,
  type DireccionResuelta,
  type SugerenciaDireccion,
} from '../servicios/mapas'
import { permisoDeUbicacionPuntual, ubicacionActual } from '../servicios/ubicacion'
import { hojaDeTema, usarTema } from '../nucleo/tema'

/**
 * Arma el guión del DNI o CUIT a medida que se tipea.
 *
 * Hasta el octavo dígito todavía podría ser un DNI (7 u 8 dígitos, sin guiones),
 * así que no se toca. Recién al noveno queda claro que es un CUIT: ahí van 11 en
 * total y el XX-XXXXXXXX-X se arma solo, sin que el vendedor tipee los guiones.
 */
function formatearDocumento(digitos: string): string {
  const limitados = digitos.slice(0, 11)
  if (limitados.length <= 8) return limitados
  const prefijo = limitados.slice(0, 2)
  const cuerpo = limitados.slice(2, 10)
  const verificador = limitados.slice(10, 11)
  return [prefijo, cuerpo, verificador].filter(Boolean).join('-')
}

/**
 * Los campos del alta de cliente nuevo, en un solo lugar.
 *
 * Es el MISMO formulario que usan los dos caminos de alta —"GENERAR NUEVO
 * CLIENTE" desde la nota y "CLIENTE NUEVO" al agregar al recorrido—, para que
 * pidan exactamente lo mismo y la oficina reciba la ficha completa en los dos
 * casos. Cada pantalla pone su propio título y su botón de guardar; acá viven
 * sólo los campos y la búsqueda de dirección.
 *
 * La DIRECCIÓN DE ENTREGA se respalda en Google: al elegir una sugerencia o usar
 * el GPS, el texto que queda es el que Google devuelve para esas coordenadas. Si
 * el vendedor edita el texto, vuelve a buscarse en Google (y hay que reconfirmar
 * eligiendo una sugerencia), porque sin coordenadas el cliente no entra a un
 * recorrido.
 */
export function CamposClienteNuevo({
  form,
  actualizar,
  errores,
}: {
  form: FormularioClienteNuevo
  actualizar: (cambios: Partial<FormularioClienteNuevo>) => void
  errores: Partial<Record<CampoClienteNuevo, string>>
}) {
  const { colores } = usarTema()
  const estilos = usarEstilos()

  const [texto, setTexto] = useState(form.direccion)
  const [sugerencias, setSugerencias] = useState<SugerenciaDireccion[]>([])
  const [buscando, setBuscando] = useState(false)
  const [elegida, setElegida] = useState(form.lat !== null)

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

  async function elegirSugerencia(s: SugerenciaDireccion) {
    setElegida(true)
    setSugerencias([])
    setTexto(s.texto)
    setBuscando(true)
    try {
      const d = await detallarDireccion(s.place_id, sesion.current)
      sesion.current = Crypto.randomUUID()
      // El texto final es el que Google da para esas coordenadas, no el que se
      // tipeó: así lo que ve el vendedor coincide con el punto que se guarda.
      setTexto(d.direccion_formateada)
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

  const desdeGps = useMutation<DireccionResuelta, Error, void>({
    mutationFn: async () => {
      if (!(await permisoDeUbicacionPuntual())) {
        throw new Error(
          'Necesitamos permiso de ubicación para usar dónde estás. Podés activarlo en los ajustes del teléfono.',
        )
      }
      const coords = await ubicacionActual()
      return ubicacionComoDireccion({ lat: coords.lat, lng: coords.lng })
    },
    onSuccess: (d) => {
      setElegida(true)
      setSugerencias([])
      setTexto(d.direccion_formateada)
      actualizar({
        direccion: d.direccion_formateada,
        codigo_postal: d.codigo_postal ?? '',
        lat: d.lat,
        lng: d.lng,
        google_place_id: d.google_place_id,
        localidad: d.localidad,
        provincia: d.provincia,
      })
    },
    onError: (e) => Alert.alert('No pudimos usar tu ubicación', e.message),
  })

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

  return (
    <>
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
        onChangeText={(t) => {
          // Si el texto se achicó es un borrado: se deja pasar tal cual, porque
          // reformatear ahí reinserta el guión recién borrado y traba el cursor.
          if (t.length < form.documento.length) {
            actualizar({ documento: t.replace(/[^\d-]/g, '') })
            return
          }
          const digitosNuevos = t.replace(/\D/g, '')
          const digitosPrevios = form.documento.replace(/\D/g, '')
          if (digitosNuevos.startsWith(digitosPrevios)) {
            actualizar({ documento: formatearDocumento(digitosNuevos) })
          } else {
            actualizar({ documento: t.replace(/[^\d-]/g, '') })
          }
        }}
        placeholder="30-12345678-9"
        keyboardType="numbers-and-punctuation"
        contenedorStyle={estilos.medio}
        error={errores.documento}
      />

      <Desplegable<CondicionIva>
        etiqueta="CONDICIÓN FRENTE AL IVA"
        obligatorio
        marcador="Elegí una opción"
        valor={form.condicion_iva === '' ? null : form.condicion_iva}
        items={CONDICIONES_IVA.map((c) => ({ valor: c.valor, etiqueta: c.etiqueta }))}
        alCambiar={(v) => actualizar({ condicion_iva: v })}
        error={errores.condicion_iva}
      />

      <Campo
        etiqueta="DIRECCIÓN DE ENTREGA"
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
        ayuda="Elegí una sugerencia, o usá tu ubicación actual si el taller no aparece en Google."
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

      {form.lat === null ? (
        <>
          <Text style={estilos.separadorO}>— o —</Text>
          <BotonMenu
            titulo="UTILIZAR MI UBICACIÓN ACTUAL"
            subtitulo="Guarda el punto donde estás parado ahora"
            alTocar={() => desdeGps.mutate()}
            cargando={desdeGps.isPending}
            deshabilitado={buscando}
          />
        </>
      ) : null}

      {form.lat !== null ? (
        <Aviso tono="exito" titulo="Dirección de entrega confirmada">
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

      <Campo
        etiqueta="DIRECCIÓN FISCAL"
        value={form.direccion_fiscal}
        onChangeText={(t) => actualizar({ direccion_fiscal: t })}
        placeholder="Sólo si factura en otro domicilio"
        autoCapitalize="words"
        ayuda="Opcional. El domicilio de la factura, si es distinto al de entrega."
      />

      <Campo
        etiqueta="CONTACTO"
        obligatorio
        value={form.contacto_nombre}
        onChangeText={(t) => actualizar({ contacto_nombre: t })}
        placeholder="Quién atiende en el taller"
        autoCapitalize="words"
        error={errores.contacto_nombre}
      />

      {/* ── Teléfonos: se agregan de a uno con el ⊕ ─────────────────────────── */}
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
        obligatorio
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
    </>
  )
}

const usarEstilos = hojaDeTema((t) => ({
  flex: { flex: 1 },
  medio: { maxWidth: 240 },
  corto: { maxWidth: 180 },

  separadorO: {
    fontFamily: t.tipografia.familia.cuerpo,
    fontSize: t.tipografia.tamano.sm,
    color: t.colores.tintaTenue,
    textAlign: 'center',
    marginVertical: -espaciado.xs,
  },

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
    color: t.colores.negro,
  },
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
