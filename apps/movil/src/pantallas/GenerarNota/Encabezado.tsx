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
import { buscarClientes, ESPERA_TECLEO, LIMITE_CLIENTES } from '../../servicios/clientes'
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
  /**
   * Qué texto se preguntó de verdad.
   *
   * Sin esto, el cartel de "ningún cliente coincide" salía ANTES de haber
   * preguntado nada: al tipear la segunda letra la lista está vacía y todavía
   * no arrancó el temporizador, así que ese mismo render ya decía que el
   * cliente no existe. Se apagaba solo medio segundo después. Es la mitad del
   * "aparece y desaparece", y encima es la mitad que miente.
   */
  const [consultaBuscada, setConsultaBuscada] = useState('')
  /**
   * "No lo encontré" y "no pude preguntar" son cosas distintas.
   *
   * Con la señal cortada en la calle —que es la condición normal— el cartel de
   * "ningún cliente coincide" le hace creer al vendedor que el taller no está
   * cargado. Toca "¿Es nuevo cliente?", lo da de alta, y la oficina se queda
   * con dos fichas del mismo cliente. Los otros dos buscadores de la app ya
   * separan los dos casos; éste era el único que no.
   */
  const [fallo, setFallo] = useState<string | null>(null)
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

  /**
   * Quién manda sobre la lista.
   *
   * Cada búsqueda se lleva un número. Sólo la ÚLTIMA puede escribir en
   * pantalla: si vuelve una vieja, se descarta.
   *
   * No es una precaución teórica, es el "aparece y desaparece". Tipear "10484"
   * dispara varias búsquedas —una por cada pausa entre teclas— y cada una tarda
   * lo suyo entre el servidor y la red del celular. Volvían en cualquier orden,
   * y la de "104" repintaba encima de la de "10484". Peor todavía: el vendedor
   * tocaba el cliente correcto, y una búsqueda que seguía viajando devolvía su
   * lista y la volvía a poner arriba del cliente ya elegido.
   *
   * Por eso también se sube el número al elegir y al limpiar: lo que esté en el
   * aire en ese momento ya no tiene derecho a dibujar nada.
   */
  const vigente = useRef(0)

  async function buscar(texto: string) {
    const mia = ++vigente.current
    setBuscando(true)
    setFallo(null)
    try {
      const encontrados = await buscarClientes(texto)
      if (mia !== vigente.current) return
      setResultados(encontrados)
      setConsultaBuscada(texto)
    } catch (e) {
      if (mia !== vigente.current) return
      // La lista NO se vacía: si había algo bueno de antes, sigue sirviendo.
      // Lo que cambia es que se dice qué pasó, en vez de dar a entender que el
      // cliente no existe.
      setFallo((e as Error).message)
    } finally {
      if (mia === vigente.current) setBuscando(false)
    }
  }

  useEffect(() => {
    if (temporizador.current) clearTimeout(temporizador.current)
    // En la beta no se busca nada: el cliente se escribe entero.
    if (CLIENTE_A_MANO || form.cliente_nuevo || consulta.trim().length < 2) {
      // Sube el número: una búsqueda en vuelo no puede repoblar una lista que
      // se acaba de vaciar a propósito, ni dejar el reloj girando para siempre
      // si el vendedor borró el texto mientras la respuesta viajaba.
      vigente.current++
      setResultados([])
      setConsultaBuscada('')
      setBuscando(false)
      setFallo(null)
      return
    }
    temporizador.current = setTimeout(() => void buscar(consulta.trim()), ESPERA_TECLEO)
    return () => {
      if (temporizador.current) clearTimeout(temporizador.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consulta, form.cliente_nuevo])

  /**
   * Buscar YA, sin esperar la pausa del tecleo.
   *
   * Es lo que hace la tecla "Listo" del teclado: el vendedor terminó de
   * escribir el código y quiere el cliente, no quiere que la app adivine
   * cuándo dejó de tipear.
   */
  function buscarYa() {
    if (temporizador.current) clearTimeout(temporizador.current)
    const texto = consulta.trim()
    if (CLIENTE_A_MANO || form.cliente_nuevo || texto.length < 2) return
    void buscar(texto)
  }

  /**
   * Escribir en los tres campos: buscar, o corregir.
   *
   * **Con un cliente ya elegido, escribir CORRIGE el dato.** No arranca otra
   * búsqueda ni suelta el vínculo. Antes, tocar una sola tecla en cualquiera de
   * los tres —agregarle los guiones al CUIT, poner "S.A." donde decía "S.A",
   * sacarle un espacio a la razón social— mandaba `cliente_id: null`. En
   * pantalla no cambiaba nada: los tres campos seguían llenos con los datos del
   * cliente. Recién al tocar CONTINUAR aparecía "Buscá el cliente por código,
   * nombre o CUIT" debajo de un formulario que YA tenía el código, el nombre y
   * el CUIT. No había forma de entender qué le estaban pidiendo.
   *
   * Vaciar el campo sí suelta el cliente: es el gesto de "me equivoqué de
   * cliente", y para eso está también el botón de cambiarlo.
   *
   * Y si el texto no cambió, no pasa nada: `onChangeText` llega en situaciones
   * donde el vendedor no tocó una tecla.
   */
  function alTipear(campo: 'cliente_codigo' | 'cliente_nombre' | 'cliente_cuit', texto: string) {
    if (texto === form[campo]) return
    if (form.cliente_id && texto.trim()) {
      alCambiar({ [campo]: texto } as Partial<FormularioNotaEncabezado>)
      return
    }
    setConsulta(texto)
    alCambiar({ [campo]: texto, cliente_id: null } as Partial<FormularioNotaEncabezado>)
  }

  /** Soltar el cliente elegido para buscar otro. Es el "✕ CAMBIAR". */
  function soltarCliente() {
    vigente.current++
    if (temporizador.current) clearTimeout(temporizador.current)
    setConsulta('')
    setResultados([])
    setConsultaBuscada('')
    setBuscando(false)
    setFallo(null)
    alCambiar({
      cliente_id: null,
      cliente_codigo: '',
      cliente_nombre: '',
      cliente_cuit: '',
      cliente_provisorio: false,
    })
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
    !fallo &&
    consulta.trim().length >= 2 &&
    // Ya se preguntó por ESTE texto. Sin esta línea el cartel salía en el mismo
    // render en que se tipea la segunda letra, medio segundo antes de que
    // saliera la consulta: la app decía que el cliente no existe sin haber
    // preguntado.
    consultaBuscada === consulta.trim() &&
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
    // Del cliente recién creado la provincia viene de Google: es la que decide
    // si un "exento" paga IVA o no.
    if (ubicacionInicial.provincia) alCambiar({ cliente_provincia: ubicacionInicial.provincia })
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
   *
   * Se pone SOLO UNA VEZ. `form.vendedor_numero` tiene que estar en las
   * dependencias —el número de la zona llega después, y sin eso el efecto no
   * vuelve a correr— pero eso hacía que vaciar el campo lo repusiera al
   * instante: el vendedor borraba el 7 para escribir el número de otro y le
   * volvía el 7 antes de llegar a tipear, justo debajo de una ayuda que dice
   * "cambialo si la nota es de otro". Ahora lo que se pone solo se pone una
   * vez, y lo que el vendedor deja —aunque sea vacío— queda.
   */
  const numeroYaPuesto = useRef(false)

  useEffect(() => {
    if (numeroYaPuesto.current) return
    if (form.vendedor_numero.trim()) return

    if (codigoVendedorUsuario?.trim()) {
      numeroYaPuesto.current = true
      setOrigenVendedor('usuario')
      alCambiar({ vendedor_numero: codigoVendedorUsuario.trim() })
      return
    }

    if (!form.zona.trim()) return

    let vigente = true
    vendedorDeZona(form.zona)
      .then((codigo) => {
        if (!vigente || !codigo) return
        numeroYaPuesto.current = true
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
    // Nada de lo que esté viajando puede volver a abrir la lista encima del
    // cliente que el vendedor acaba de elegir. Ver `vigente`.
    vigente.current++
    if (temporizador.current) clearTimeout(temporizador.current)
    setBuscando(false)
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
      // La provincia no se imprime: la necesita el IVA, porque "exento" sólo
      // vale en Tierra del Fuego.
      cliente_provincia: c.provincia ?? '',
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

      {/* Que el cliente esté elegido deja de ser un estado invisible.
          Los tres campos se ven igual de llenos con el cliente enganchado que
          con los datos tipeados a mano, y son dos situaciones muy distintas:
          sin enganchar, la nota no se puede crear. Acá se ve cuál quedó, y por
          dónde se lo suelta si es el equivocado. */}
      {!CLIENTE_A_MANO && form.cliente_id ? (
        <View style={estilos.clienteElegido}>
          <View style={estilos.clienteElegidoTexto}>
            <Text style={estilos.clienteElegidoRotulo}>CLIENTE ELEGIDO</Text>
            <Text style={estilos.clienteElegidoNombre} numberOfLines={2}>
              {form.cliente_codigo} · {form.cliente_nombre}
            </Text>
          </View>
          <Pressable
            onPress={soltarCliente}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Cambiar de cliente"
            style={({ pressed }) => [estilos.cambiarCliente, pressed && estilos.tocado]}
          >
            <Text style={estilos.cambiarClienteTexto}>✕ CAMBIAR</Text>
          </Pressable>
        </View>
      ) : null}

      {/* La tecla del teclado dice BUSCAR y busca en el acto: el que sabe el
          código lo escribe y confirma, sin esperar a que la app adivine que
          terminó de tipear. `blurOnSubmit={false}` deja el teclado abierto,
          porque lo que sigue es tocar el cliente en la lista de abajo y
          cerrarlo la haría saltar justo cuando aparece. */}
      <Campo
        etiqueta="COD. CLIENTE"
        value={form.cliente_codigo}
        onChangeText={(t) => alTipear('cliente_codigo', t)}
        placeholder="1003"
        autoCapitalize="characters"
        contenedorStyle={estilos.mitad}
        editable={!form.cliente_nuevo}
        returnKeyType="search"
        blurOnSubmit={false}
        onSubmitEditing={buscarYa}
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
        returnKeyType="search"
        blurOnSubmit={false}
        onSubmitEditing={buscarYa}
        accesorio={buscando ? <ActivityIndicator size="small" color={colores.rojo} /> : undefined}
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
        returnKeyType="search"
        blurOnSubmit={false}
        onSubmitEditing={buscarYa}
        accesorio={buscando ? <ActivityIndicator size="small" color={colores.rojo} /> : undefined}
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
              {/* El teléfono, ahora que se puede buscar por él: sin esto, el
                  cliente que enganchó por su número aparece sin ninguna razón
                  visible y parece un resultado al azar. */}
              {c.telefono ? (
                <Text style={estilos.sugerenciaDato} numberOfLines={1}>
                  Tel {c.telefono}
                </Text>
              ) : null}
              {c.cuit ? <Text style={estilos.sugerenciaDato}>CUIT {c.cuit}</Text> : null}
            </Pressable>
          ))}
        </View>
      ) : null}

      {/* La lista quedó cortada, y hay que decirlo.
          Con tres dígitos de un código de cinco hay más de cien candidatos y se
          muestran quince. Sin este cartel el vendedor ve que su cliente no está
          y concluye que no está cargado. Ahora los quince que se ven son los
          quince primeros POR CÓDIGO, así que escribir un dígito más lo trae. */}
      {resultados.length >= LIMITE_CLIENTES ? (
        <Text style={estilos.sinResultados}>
          {`Hay más de ${LIMITE_CLIENTES} que coinciden con “${consulta.trim()}”. Escribí un poco más —otro dígito del código, o más letras del nombre— para achicar la lista.`}
        </Text>
      ) : null}

      {fallo && !buscando ? (
        <Aviso tono="atencion" titulo="No pudimos consultar el padrón">
          {fallo}
          {'\n\n'}Esto NO quiere decir que el cliente no exista. Revisá la señal y tocá BUSCAR de
          nuevo; no lo des de alta como nuevo sin haberlo podido buscar.
        </Aviso>
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

  clienteElegido: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaciado.sm,
    borderWidth: 2,
    borderColor: colores.verdeOscuro,
    borderRadius: radios.sm,
    backgroundColor: colores.campoBlanco,
    paddingHorizontal: espaciado.md,
    paddingVertical: espaciado.sm,
  },
  clienteElegidoTexto: { flex: 1, gap: 2 },
  clienteElegidoRotulo: {
    fontFamily: tipografia.familia.subtitulo,
    fontSize: tipografia.tamano.micro,
    color: colores.verdeOscuro,
  },
  clienteElegidoNombre: {
    fontFamily: tipografia.familia.fuerte,
    fontSize: tipografia.tamano.xs,
    color: colores.tinta,
  },
  cambiarCliente: {
    // Alto de dedo: se toca parado en un taller.
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: espaciado.xs,
  },
  cambiarClienteTexto: {
    fontFamily: tipografia.familia.subtitulo,
    fontSize: tipografia.tamano.micro,
    color: colores.rojo,
  },
  tocado: { opacity: 0.7 },

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
