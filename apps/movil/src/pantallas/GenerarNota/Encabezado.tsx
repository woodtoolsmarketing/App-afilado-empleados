import {
  colores,
  espaciado,
  ETIQUETA_TIPO_SERVICIO,
  radios,
  tipografia,
  type ClienteBuscado,
  type FormularioNotaEncabezado,
  type TipoServicio,
} from '@woodtools/compartido'
import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'

import { Campo, Casilla, MensajeError } from '../../componentes/Formulario'
import { CampoDictado } from '../../componentes/CampoDictado'
import { Aviso, Pastilla } from '../../componentes/Estado'
import { buscarClientes } from '../../servicios/clientes'

/**
 * Encabezado de la nota de pedido.
 *
 * Los tres campos de identificación —Cód. Cliente, Nombre y CUIT— buscan sobre
 * lo mismo y al elegir un cliente se completan los tres. El vendedor se acuerda
 * de uno u otro según el caso; obligarlo a saber cuál de antemano sería
 * trabajo suyo para comodidad nuestra.
 */

/**
 * "REBAJE" sólo aplica a cuchillas y en los mockups aparece recién cuando se
 * tilda AFILADO. Se replica ese comportamiento para no mostrar una opción que
 * en la mayoría de los casos no va a ningún lado.
 */
const SERVICIOS_BASE: TipoServicio[] = [
  'venta',
  'afilado',
  'reparacion',
  'rectificado',
  'hermanado',
]

export function PasoEncabezado({
  form,
  alCambiar,
  servicios,
  alCambiarServicios,
  alCrearCliente,
  errores,
}: {
  form: FormularioNotaEncabezado
  alCambiar: (cambios: Partial<FormularioNotaEncabezado>) => void
  servicios: TipoServicio[]
  alCambiarServicios: (servicios: TipoServicio[]) => void
  /** Abre "GENERAR NUEVO CLIENTE" con lo que ya se escribió. */
  alCrearCliente: () => void
  errores: Record<string, string | undefined>
}) {
  const [consulta, setConsulta] = useState('')
  const [resultados, setResultados] = useState<ClienteBuscado[]>([])
  const [buscando, setBuscando] = useState(false)
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (temporizador.current) clearTimeout(temporizador.current)
    if (form.cliente_nuevo || consulta.trim().length < 2) {
      setResultados([])
      return
    }
    temporizador.current = setTimeout(async () => {
      setBuscando(true)
      try {
        setResultados(await buscarClientes(consulta))
      } catch {
        setResultados([])
      } finally {
        setBuscando(false)
      }
    }, 300)
    return () => {
      if (temporizador.current) clearTimeout(temporizador.current)
    }
  }, [consulta, form.cliente_nuevo])

  /** Tipear en cualquiera de los tres invalida el cliente ya elegido. */
  function alTipear(campo: 'cliente_codigo' | 'cliente_nombre' | 'cliente_cuit', texto: string) {
    setConsulta(texto)
    alCambiar({ [campo]: texto, cliente_id: null } as Partial<FormularioNotaEncabezado>)
  }

  function elegirCliente(c: ClienteBuscado) {
    setResultados([])
    setConsulta('')
    // Acá está el "que uno complete a los otros": se llenan los tres campos y,
    // si el cliente tiene ficha, también los datos de contacto.
    const datos = [
      c.razon_social,
      c.direccion,
      c.codigo_postal ? `CP ${c.codigo_postal}` : null,
      c.telefono ? `Tel ${c.telefono}` : null,
      c.email,
      c.contacto_nombre ? `Contacto: ${c.contacto_nombre}` : null,
    ]
      .filter(Boolean)
      .join(' — ')

    alCambiar({
      cliente_id: c.cliente_id,
      cliente_codigo: c.codigo,
      cliente_nombre: c.razon_social,
      cliente_cuit: c.cuit ?? '',
      cliente_provisorio: c.provisorio,
      // Sólo se completa si el vendedor todavía no escribió nada: lo suyo manda.
      datos_cliente: form.datos_cliente.trim() ? form.datos_cliente : datos,
      cliente_nuevo: false,
    })
  }

  const conAfilado = servicios.includes('afilado')
  const disponibles: TipoServicio[] = conAfilado
    ? [...SERVICIOS_BASE, 'rebaje', 'reclamo']
    : [...SERVICIOS_BASE, 'reclamo']

  function alternarServicio(s: TipoServicio) {
    const nuevo = servicios.includes(s)
      ? servicios.filter((x) => x !== s)
      : [...servicios, s]
    // Al destildar afilado, rebaje deja de tener sentido y se va con él.
    alCambiarServicios(nuevo.includes('afilado') ? nuevo : nuevo.filter((x) => x !== 'rebaje'))
  }

  return (
    <>
      {/* ── Identificación del cliente ────────────────────────────────────── */}
      <View style={estilos.fila}>
        <Campo
          etiqueta="COD. CLIENTE"
          value={form.cliente_codigo}
          onChangeText={(t) => alTipear('cliente_codigo', t)}
          placeholder="1003"
          autoCapitalize="characters"
          contenedorStyle={estilos.mitad}
          editable={!form.cliente_nuevo}
          accesorio={buscando ? <ActivityIndicator size="small" color={colores.rojo} /> : undefined}
        />
        <Campo
          etiqueta="NOMBRE"
          value={form.cliente_nombre}
          onChangeText={(t) => alTipear('cliente_nombre', t)}
          placeholder="Razón social"
          autoCapitalize="words"
          contenedorStyle={estilos.mitad}
          error={errores.cliente_nombre}
        />
      </View>

      <Pressable
        onPress={alCrearCliente}
        hitSlop={10}
        accessibilityRole="button"
        style={estilos.enlaceNuevo}
      >
        <Text style={estilos.enlaceNuevoTexto}>¿Es nuevo cliente?</Text>
      </Pressable>

      <View style={estilos.fila}>
        <Campo
          etiqueta="CUIT"
          value={form.cliente_cuit}
          onChangeText={(t) => alTipear('cliente_cuit', t)}
          placeholder="30-12345678-9"
          keyboardType="numbers-and-punctuation"
          contenedorStyle={estilos.mitad}
        />
        <Campo
          etiqueta="VENDEDOR"
          value={form.vendedor}
          onChangeText={(t) => alCambiar({ vendedor: t })}
          contenedorStyle={estilos.mitad}
          editable={false}
        />
      </View>

      <Campo
        etiqueta="ZONA"
        value={form.zona}
        onChangeText={(t) => alCambiar({ zona: t })}
        placeholder="Oeste"
        autoCapitalize="words"
        contenedorStyle={estilos.corto}
        error={errores.zona}
      />

      {resultados.length > 0 ? (
        <View style={estilos.sugerencias}>
          {resultados.map((c) => (
            <Pressable
              key={c.cliente_id}
              onPress={() => elegirCliente(c)}
              accessibilityRole="button"
              accessibilityLabel={`${c.codigo}, ${c.razon_social}`}
              style={({ pressed }) => [estilos.sugerencia, pressed && estilos.sugerenciaTocada]}
            >
              <View style={estilos.sugerenciaFila}>
                <Text style={estilos.sugerenciaCodigo}>{c.codigo}</Text>
                {c.provisorio ? <Pastilla texto="PROVISORIO" color={colores.ambarOscuro} /> : null}
              </View>
              <Text style={estilos.sugerenciaNombre} numberOfLines={1}>
                {c.razon_social}
              </Text>
              {c.cuit ? <Text style={estilos.sugerenciaDato}>CUIT {c.cuit}</Text> : null}
            </Pressable>
          ))}
        </View>
      ) : null}

      {form.cliente_provisorio ? (
        <Aviso tono="atencion" titulo="Cliente provisorio">
          Ya está cargado con todos sus datos, pero todavía sin código definitivo. La nota se guarda
          igual y queda sin número hasta que Administración se lo asigne.
        </Aviso>
      ) : form.cliente_nuevo ? (
        <Aviso tono="atencion" titulo="Cliente nuevo">
          La nota se guarda con el nombre, CUIT, vendedor y zona, pero sin número, hasta que
          Administración lo dé de alta.
        </Aviso>
      ) : null}

      <MensajeError>{errores.cliente}</MensajeError>

      {/* ── Textos con dictado ────────────────────────────────────────────── */}
      <CampoDictado
        etiqueta="DATOS DEL CLIENTE"
        obligatorio
        valor={form.datos_cliente}
        alCambiar={(t) => alCambiar({ datos_cliente: t })}
        alCambiarOrigen={(o) => alCambiar({ datos_cliente_origen: o })}
        placeholder="Dirección, teléfono, contacto…"
        error={errores.datos_cliente}
      />

      <CampoDictado
        etiqueta="DESCRIPCIÓN GRAL. DE LA HERRAMIENTA"
        valor={form.descripcion_herramienta}
        alCambiar={(t) => alCambiar({ descripcion_herramienta: t })}
        alCambiarOrigen={(o) => alCambiar({ descripcion_herramienta_origen: o })}
        placeholder="Qué trae el cliente, en general"
      />

      {/* ── Tipo de servicio ──────────────────────────────────────────────── */}
      <Text style={estilos.tituloBloque}>TIPO DE SERVICIO</Text>

      {disponibles.map((s) => (
        <Casilla
          key={s}
          etiqueta={ETIQUETA_TIPO_SERVICIO[s]}
          valor={servicios.includes(s)}
          alCambiar={() => alternarServicio(s)}
        />
      ))}

      <MensajeError>{errores.servicios}</MensajeError>
    </>
  )
}

const estilos = StyleSheet.create({
  fila: { flexDirection: 'row', gap: espaciado.sm },
  mitad: { flex: 1 },
  corto: { maxWidth: 200 },

  enlaceNuevo: { alignSelf: 'flex-start', paddingVertical: espaciado.xs },
  enlaceNuevoTexto: {
    fontFamily: tipografia.familia.cuerpo,
    fontSize: tipografia.tamano.xs,
    color: colores.rojo,
    textDecorationLine: 'underline',
  },

  sugerencias: {
    borderWidth: 2,
    borderColor: colores.negro,
    borderRadius: radios.sm,
    backgroundColor: colores.campoBlanco,
    overflow: 'hidden',
  },
  sugerencia: {
    paddingHorizontal: espaciado.md,
    paddingVertical: espaciado.md,
    borderBottomWidth: 1,
    borderBottomColor: colores.panelOscuro,
    minHeight: 60,
    justifyContent: 'center',
    gap: 2,
  },
  sugerenciaTocada: { backgroundColor: colores.panelClaro },
  sugerenciaFila: { flexDirection: 'row', alignItems: 'center', gap: espaciado.sm },
  sugerenciaCodigo: {
    fontFamily: tipografia.familia.subtitulo,
    fontSize: tipografia.tamano.xs,
    color: colores.rojo,
  },
  sugerenciaNombre: {
    fontFamily: tipografia.familia.fuerte,
    fontSize: tipografia.tamano.sm,
    color: colores.tinta,
  },
  sugerenciaDato: {
    fontFamily: tipografia.familia.liviana,
    fontSize: tipografia.tamano.xs,
    color: colores.tintaSuave,
  },

  tituloBloque: {
    fontFamily: tipografia.familia.subtitulo,
    fontSize: tipografia.tamano.base,
    color: colores.tinta,
    letterSpacing: 0.8,
    textDecorationLine: 'underline',
    textAlign: 'center',
    marginTop: espaciado.sm,
  },
})
