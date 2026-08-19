import {
  colores,
  espaciado,
  etiquetaZona,
  ETIQUETA_TIPO_SERVICIO,
  numeroDeVendedorImpreso,
  radios,
  tipografia,
  VENDEDORES_CON_CERO,
  zonaParaUbicacion,
  lineaDeServicio,
  ZONAS,
  type ClienteBuscado,
  type FormularioItemNota,
  type FormularioNotaEncabezado,
  type TipoServicio,
  type UbicacionCliente,
  type ZonaSugerida,
} from '@woodtools/compartido'
import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'

import {
  Campo,
  Desplegable,
  DesplegableMultiple,
  MensajeError,
} from '../../componentes/Formulario'
import { CampoDictado } from '../../componentes/CampoDictado'
import { Aviso, Pastilla } from '../../componentes/Estado'
import { CLIENTE_A_MANO } from '../../nucleo/variante'
import { buscarClientes } from '../../servicios/clientes'
import { vendedorDeZona } from '../../servicios/notasPedido'

/**
 * Las dos primeras páginas de la nota de pedido.
 *
 * `PasoCliente` es la primera —a quién se le hace la nota y para cuándo— y
 * `PasoOperacion` la segunda —qué vino a hacer—. Están en el mismo archivo
 * porque son las dos mitades del encabezado del talonario; se dibujan en
 * pantallas distintas porque completas no entran en un teléfono.
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

/** Una línea que diga qué es cada operación, para no elegir por el nombre solo. */
const QUE_ES_LA_OPERACION: Partial<Record<TipoServicio, string>> = {
  venta: 'Se lleva una herramienta nueva',
  afilado: 'Trae una herramienta a afilar',
  reparacion: 'Dientes rotos o daños a reparar',
  rectificado: 'Corregir la geometría de la pieza',
  hermanado: 'Igualar incisores entre sí',
  rebaje: 'Sólo cuchillas, y sólo si hay afilado',
  reclamo: 'Sobre un trabajo que ya hicimos',
}

export function PasoCliente({
  form,
  alCambiar,
  alCrearCliente,
  errores,
  ubicacionInicial,
  codigoVendedorUsuario,
}: {
  form: FormularioNotaEncabezado
  alCambiar: (cambios: Partial<FormularioNotaEncabezado>) => void
  /** Abre "GENERAR NUEVO CLIENTE" con lo que ya se escribió. */
  alCrearCliente: () => void
  errores: Record<string, string | undefined>
  /** La del cliente que acaba de crearse, para asignarle la zona al volver. */
  ubicacionInicial?: UbicacionCliente | null
  /** El del que está usando la app. Es el primero que se prueba. */
  codigoVendedorUsuario?: string | null
}) {
  const [consulta, setConsulta] = useState('')
  const [resultados, setResultados] = useState<ClienteBuscado[]>([])
  const [buscando, setBuscando] = useState(false)
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null)
  /**
   * Cómo quedó la última búsqueda de zona: sirve para explicar de dónde salió
   * el número, y para ofrecer las opciones cuando la localidad está en más de
   * una zona. Nada de esto se guarda: es ayuda para elegir.
   */
  const [zonaAuto, setZonaAuto] = useState<ZonaSugerida | null>(null)
  const [zonaDudosa, setZonaDudosa] = useState<ZonaSugerida[]>([])
  /** De dónde salió el número de vendedor cuando lo puso la app. */
  const [origenVendedor, setOrigenVendedor] = useState<'usuario' | 'zona' | null>(null)

  useEffect(() => {
    if (temporizador.current) clearTimeout(temporizador.current)
    // En la beta no se busca nada: el cliente se escribe entero.
    if (CLIENTE_A_MANO || form.cliente_nuevo || consulta.trim().length < 2) {
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

  /**
   * Cuándo decir que no se encontró nada.
   *
   * Sin este aviso, "no hay coincidencias" y "todavía no busqué" se ven igual
   * —pantalla sin lista— y el vendedor no sabe si esperar o seguir escribiendo.
   */
  const sinResultados =
    !CLIENTE_A_MANO &&
    !form.cliente_nuevo &&
    !form.cliente_id &&
    !buscando &&
    consulta.trim().length >= 2 &&
    resultados.length === 0

  /**
   * La zona sale de dónde está el cliente.
   *
   * Se aplica sola cuando no hay duda. Cuando la localidad está en más de una
   * zona —"Victoria" es Entre Ríos en la 136 y en la 143, "Las Heras" es
   * Buenos Aires o Mendoza— se muestran las dos y elige el vendedor: poner un
   * número que nadie miró en un comprobante es peor que preguntar.
   *
   * Nunca pisa una zona ya elegida a mano.
   */
  function asignarZona(u: UbicacionCliente, forzar = false): void {
    const { unica, candidatas } = zonaParaUbicacion(u)
    setZonaDudosa(candidatas.length > 1 ? candidatas : [])
    setZonaAuto(unica)

    if (!unica) return
    if (form.zona && !forzar) return
    alCambiar({ zona: unica.zona.codigo, zona_id: unica.zona.id })
  }

  function elegirZona(id: string): void {
    const zona = ZONAS.find((z) => z.id === id)
    if (!zona) return
    setZonaAuto(null)
    setZonaDudosa([])
    alCambiar({ zona: zona.codigo, zona_id: zona.id })
  }

  // Al volver de "Generar nuevo cliente" con una dirección de Google ya
  // resuelta, la zona se asigna igual que si el cliente hubiera existido.
  const ubicacionClave = ubicacionInicial
    ? `${ubicacionInicial.localidad ?? ''}|${ubicacionInicial.provincia ?? ''}|${ubicacionInicial.direccion ?? ''}`
    : ''

  useEffect(() => {
    if (!ubicacionInicial || !ubicacionClave.replace(/\|/g, '')) return
    asignarZona(ubicacionInicial)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ubicacionClave])

  /**
   * El número de vendedor, cuando no lo completan.
   *
   * Dos intentos, en este orden:
   *
   *  1. **El del que está usando la app.** Es el caso normal y el único que no
   *     puede estar equivocado: la nota la carga quien la va a firmar.
   *  2. **El que tiene a cargo la zona.** Para cuando quien carga no tiene
   *     número propio —la oficina tomando un pedido por teléfono, un
   *     administrativo— y el comprobante lo necesita igual.
   *
   * Si la zona la cubre más de un vendedor, la base devuelve null y el campo
   * queda vacío a propósito. Es el mismo criterio que el de la zona: preguntar
   * sale más barato que facturar con el número de otro.
   */
  useEffect(() => {
    if (form.vendedor_numero.trim()) return

    if (codigoVendedorUsuario?.trim()) {
      setOrigenVendedor('usuario')
      alCambiar({ vendedor_numero: codigoVendedorUsuario.trim() })
      return
    }

    if (!form.zona.trim()) return

    let vigente = true
    vendedorDeZona(form.zona)
      .then((codigo) => {
        if (!vigente || !codigo) return
        setOrigenVendedor('zona')
        alCambiar({ vendedor_numero: codigo })
      })
      .catch(() => undefined)

    return () => {
      vigente = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.vendedor_numero, form.zona, codigoVendedorUsuario])

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

    // Elegir otro cliente sí pisa la zona: es la ubicación la que manda, y
    // dejar la del cliente anterior sería peor que cualquier duda.
    asignarZona(
      { localidad: c.localidad, provincia: c.provincia, direccion: c.direccion },
      true,
    )
  }

  return (
    <>
      {/* ── Identificación del cliente ────────────────────────────────────── */}
      {CLIENTE_A_MANO ? (
        <Aviso tono="atencion" titulo="Versión de prueba">
          Los datos del cliente se cargan a mano: esta versión no los busca en la base. Completá
          código, nombre y CUIT como los tengas, y elegí la zona del desplegable — acá no se asigna
          sola.
        </Aviso>
      ) : null}

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

      {/* A lo ancho, y no a media fila junto al código: "MULTIPLACAS S.A" no
          entraba y el casillero mostraba "ULTIPLACAS S.A". El nombre estaba
          bien —se corría adentro del campo— pero un vendedor que lee una razón
          social sin la primera letra tiene toda la razón en desconfiar. */}
      <Campo
        etiqueta="NOMBRE O RAZÓN SOCIAL"
        value={form.cliente_nombre}
        onChangeText={(t) => alTipear('cliente_nombre', t)}
        placeholder="Razón social"
        autoCapitalize="words"
        error={errores.cliente_nombre}
      />

      {/* En la beta no se dan de alta clientes: escribirlos en la nota es
          justamente lo que se está probando, y crear fichas sueltas mientras
          tanto ensuciaría el padrón que después hay que cargar en serio. */}
      {CLIENTE_A_MANO ? null : (
        <Pressable
          onPress={alCrearCliente}
          hitSlop={10}
          accessibilityRole="button"
          style={estilos.enlaceNuevo}
        >
          <Text style={estilos.enlaceNuevoTexto}>¿Es nuevo cliente?</Text>
        </Pressable>
      )}

      {/* El VENDEDOR va abajo como dato fijo en vez de un campo deshabilitado:
          no se edita nunca y ocupaba media pantalla. */}
      <Campo
        etiqueta="CUIT"
        value={form.cliente_cuit}
        onChangeText={(t) => alTipear('cliente_cuit', t)}
        placeholder="30-12345678-9"
        keyboardType="numbers-and-punctuation"
        contenedorStyle={estilos.mitad}
      />

      {/* ── Resultados de la búsqueda ─────────────────────────────────────────
          Van JUSTO ABAJO de los tres campos que buscan —código, nombre y
          CUIT—, no al final del encabezado. Estaban después de la zona y del
          vendedor: el vendedor tipeaba el código, la lista aparecía fuera de
          la pantalla y parecía que el buscador no hacía nada. */}
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
              {/* La dirección desempata dos razones sociales parecidas, que es
                  la confusión más cara al elegir de una lista. */}
              {c.direccion ? (
                <Text style={estilos.sugerenciaDato} numberOfLines={1}>
                  {c.direccion}
                </Text>
              ) : null}
              {c.cuit ? <Text style={estilos.sugerenciaDato}>CUIT {c.cuit}</Text> : null}
            </Pressable>
          ))}
        </View>
      ) : sinResultados ? (
        <Text style={estilos.sinResultados}>
          Ningún cliente coincide con “{consulta.trim()}”. Se busca por código, razón social y
          CUIT.
        </Text>
      ) : null}

      {/* El número sale del perfil pero se puede corregir: hay altas sin
          código cargado y el comprobante lo necesita igual. Se imprime sin los
          ceros de relleno del Gestión ("007" sale 7). */}
      <View style={estilos.fila}>
        <Text style={[estilos.vendedor, estilos.mitad]}>VENDEDOR: {form.vendedor}</Text>
        <Campo
          etiqueta="VENDEDOR Nº"
          obligatorio
          value={form.vendedor_numero}
          onChangeText={(t) => {
            setOrigenVendedor(null)
            alCambiar({ vendedor_numero: t.replace(/\D/g, '').slice(0, 4) })
          }}
          keyboardType="number-pad"
          placeholder="7"
          contenedorStyle={estilos.mitad}
          error={errores.vendedor_numero}
          ayuda={
            form.vendedor_numero
              ? `En la nota sale: ${numeroDeVendedorImpreso(form.vendedor_numero, VENDEDORES_CON_CERO)}`
              : 'Va impreso en la nota.'
          }
        />
      </View>

      {origenVendedor && form.vendedor_numero ? (
        <Text style={estilos.zonaAuto}>
          {origenVendedor === 'usuario'
            ? 'Puesto solo con tu número de vendedor. Cambialo si la nota es de otro.'
            : `Puesto solo: es el vendedor a cargo de la zona ${form.zona}.`}
        </Text>
      ) : null}

      {/* ── Zona ───────────────────────────────────────────────────────────────
          Dejó de ser texto libre: el número de zona es el que usa la oficina
          para repartir el trabajo, y "Oeste", "oeste" y "Z. Oeste" escritos a
          mano son tres zonas distintas para cualquier planilla. */}
      <Desplegable<string>
        etiqueta="ZONA"
        obligatorio
        marcador="Elegí la zona"
        valor={form.zona_id || null}
        items={ZONAS.map((z) => ({
          valor: z.id,
          etiqueta: etiquetaZona(z),
          descripcion: z.localidades.slice(0, 4).join(', '),
          // Se busca por las treinta y seis localidades, no por las cuatro que
          // entran en la línea.
          buscarEn: [z.nombre, ...z.provincias, ...z.localidades].join(' '),
        }))}
        marcadorBusqueda="Buscá por número, zona o localidad…"
        vacio="Ninguna zona coincide con eso."
        alCambiar={elegirZona}
        error={errores.zona}
      />

      {zonaAuto ? (
        <Text style={estilos.zonaAuto}>
          Asignada sola por {zonaAuto.localidad}
          {zonaAuto.origen === 'direccion' ? ', que aparece en la dirección' : ''}. Cambiala si no
          corresponde.
        </Text>
      ) : null}

      {zonaDudosa.length > 1 ? (
        <View style={estilos.zonaDudosa}>
          <Text style={estilos.zonaDudosaTitulo}>
            Esa localidad está en más de una zona. Elegí cuál:
          </Text>
          {zonaDudosa.map((c) => (
            <Pressable
              key={c.zona.id}
              onPress={() => elegirZona(c.zona.id)}
              accessibilityRole="button"
              style={({ pressed }) => [estilos.zonaOpcion, pressed && estilos.sugerenciaTocada]}
            >
              <Text style={estilos.zonaOpcionTexto}>{etiquetaZona(c.zona)}</Text>
              <Text style={estilos.sugerenciaDato}>coincide por {c.localidad}</Text>
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

      <CampoDictado
        etiqueta="DATOS DEL CLIENTE"
        obligatorio
        valor={form.datos_cliente}
        alCambiar={(t) => alCambiar({ datos_cliente: t })}
        alCambiarOrigen={(o) => alCambiar({ datos_cliente_origen: o })}
        placeholder="Dirección, teléfono, contacto…"
        error={errores.datos_cliente}
      />
    </>
  )
}

/**
 * La segunda página: qué vino a hacer el cliente.
 *
 * El TIPO DE OPERACIÓN eran siete casillas sueltas repartidas en dos columnas.
 * Ahora es un desplegable que acepta varias, como cualquier otro campo del
 * formulario: la pregunta es una sola —qué trajo— y la respuesta puede tener
 * más de una parte.
 */
export function PasoOperacion({
  form,
  alCambiar,
  servicios,
  alCambiarServicios,
  items,
  errores,
}: {
  form: FormularioNotaEncabezado
  alCambiar: (cambios: Partial<FormularioNotaEncabezado>) => void
  servicios: TipoServicio[]
  alCambiarServicios: (servicios: TipoServicio[]) => void
  /** Los renglones cargados hasta ahora: de ahí sale la descripción general. */
  items: FormularioItemNota[]
  errores: Record<string, string | undefined>
}) {
  const linea = lineaDeServicio(items)
  const conAfilado = servicios.includes('afilado')
  const disponibles: TipoServicio[] = conAfilado
    ? [...SERVICIOS_BASE, 'rebaje', 'reclamo']
    : [...SERVICIOS_BASE, 'reclamo']

  return (
    <>
      {/* Qué va a decir la nota, armado con los renglones que se van cargando.
          Se muestra acá y no sólo al imprimir porque es el momento en que se
          puede corregir: si dice "AFILADO DE SIERRAS" y el cliente trajo
          fresas, el renglón está mal cargado y se ve al toque. */}
      <View style={estilos.servicio}>
        <Text style={estilos.servicioRotulo}>DESCRIPCIÓN GRAL. DE LA HERRAMIENTA</Text>
        {linea ? (
          <Text style={estilos.servicioTexto}>{linea}</Text>
        ) : (
          <Text style={estilos.servicioVacio}>
            Se completa sola con las herramientas que cargues abajo.
          </Text>
        )}
      </View>

      <CampoDictado
        etiqueta="AGREGAR A LA DESCRIPCIÓN"
        valor={form.descripcion_herramienta}
        alCambiar={(t) => alCambiar({ descripcion_herramienta: t })}
        alCambiarOrigen={(o) => alCambiar({ descripcion_herramienta_origen: o })}
        placeholder="Algo más que tenga que saber la fábrica"
      />

      <DesplegableMultiple<TipoServicio>
        etiqueta="TIPO DE OPERACIÓN"
        obligatorio
        marcador="Elegí qué vino a hacer"
        valores={servicios}
        items={disponibles.map((s) => ({
          valor: s,
          etiqueta: ETIQUETA_TIPO_SERVICIO[s],
          descripcion: QUE_ES_LA_OPERACION[s],
        }))}
        // Al destildar afilado, rebaje deja de tener sentido y se va con él.
        alCambiar={(nuevos) =>
          alCambiarServicios(
            nuevos.includes('afilado') ? nuevos : nuevos.filter((x) => x !== 'rebaje'),
          )
        }
        ayuda={
          conAfilado
            ? undefined
            : 'REBAJE aparece cuando la nota lleva afilado: sólo se rebajan cuchillas que se afilan.'
        }
        error={errores.servicios}
      />
    </>
  )
}

const estilos = StyleSheet.create({
  fila: { flexDirection: 'row', gap: espaciado.sm },

  /* La descripción general que arma la app. Va con el mismo rótulo que tenía
     el campo, porque para el vendedor es el mismo dato: lo que va a decir la
     nota. Lo que cambió es quién lo escribe. */
  servicio: {
    backgroundColor: colores.panelClaro,
    borderRadius: radios.sm,
    borderLeftWidth: 4,
    borderLeftColor: colores.verdeOscuro,
    paddingHorizontal: espaciado.md,
    paddingVertical: espaciado.sm,
    gap: espaciado.xs,
  },
  servicioRotulo: {
    fontFamily: tipografia.familia.cuerpo,
    fontSize: tipografia.tamano.xs,
    color: colores.tintaSuave,
  },
  servicioTexto: {
    fontFamily: tipografia.familia.subtitulo,
    fontSize: tipografia.tamano.sm,
    color: colores.tinta,
  },
  servicioVacio: {
    fontFamily: tipografia.familia.liviana,
    fontSize: tipografia.tamano.xs,
    color: colores.tintaTenue,
  },
  mitad: { flex: 1 },

  vendedor: {
    fontFamily: tipografia.familia.cuerpo,
    fontSize: tipografia.tamano.xs,
    color: colores.tintaSuave,
  },

  zonaAuto: {
    fontFamily: tipografia.familia.liviana,
    fontSize: tipografia.tamano.xs,
    color: colores.verdeOscuro,
    marginTop: -espaciado.xs,
  },
  zonaDudosa: {
    borderWidth: 2,
    borderColor: colores.ambarOscuro,
    borderRadius: radios.sm,
    backgroundColor: colores.campoBlanco,
    overflow: 'hidden',
  },
  zonaDudosaTitulo: {
    fontFamily: tipografia.familia.cuerpo,
    fontSize: tipografia.tamano.xs,
    color: colores.tinta,
    paddingHorizontal: espaciado.md,
    paddingTop: espaciado.sm,
  },
  zonaOpcion: {
    paddingHorizontal: espaciado.md,
    paddingVertical: espaciado.sm,
    minHeight: 52,
    justifyContent: 'center',
  },
  zonaOpcionTexto: {
    fontFamily: tipografia.familia.subtitulo,
    fontSize: tipografia.tamano.sm,
    color: colores.tinta,
  },

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
  sinResultados: {
    fontFamily: tipografia.familia.cuerpo,
    fontSize: tipografia.tamano.xs,
    color: colores.tintaSuave,
  },
})
