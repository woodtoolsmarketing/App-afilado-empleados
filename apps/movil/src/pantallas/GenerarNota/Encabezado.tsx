import {
  espaciado,
  etiquetaZona,
  ETIQUETA_TIPO_SERVICIO,
  numeroDeVendedorImpreso,
  radios,
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
import { ActivityIndicator, Pressable, Text, View } from 'react-native'

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
import { hojaDeTema, usarTema } from '../../nucleo/tema'

/**
 * Las dos primeras páginas de la nota de pedido.
 *
 * `PasoCliente` es la primera —a quién se le hace la nota y para cuándo— y
 * `PasoOperacion` la segunda —qué vino a hacer—. Están en el mismo archivo
 * porque son las dos mitades del encabezado del talonario; se dibujan en
 * pantallas distintas porque completas no entran en un teléfono.
 *
 * El cliente se busca por CÓDIGO o por NOMBRE, y al elegirlo se completan los
 * dos. El vendedor se acuerda de uno u otro según el caso; obligarlo a saber
 * cuál de antemano sería trabajo suyo para comodidad nuestra.
 *
 * **La primera página entra sin scrollear, y eso es un requisito, no un
 * lujo.** Es la que se completa parado en la puerta de un taller, con el
 * cliente enfrente: si hay que arrastrar para encontrar CONTINUAR, se carga
 * mal. Por eso acá adentro hay tres campos que no siempre se dibujan:
 *
 *   * el **CUIT** aparece cuando el cliente tiene uno cargado. Se busca por
 *     código y por nombre, así que como buscador no hacía falta, y como dato
 *     no tiene nada que mostrar en la mitad de las fichas.
 *   * la **ZONA** no se dibuja mientras la app la pueda deducir sola de la
 *     localidad del cliente. Vuelve cuando la localidad está en más de una
 *     —"Victoria" es Entre Ríos en la 136 y en la 143— cuando no se pudo
 *     deducir ninguna, o cuando el vendedor toca CAMBIAR.
 *   * el **DETALLE DEL CLIENTE** es una línea, y se abre al tocarlo. Es un
 *     campo de cuatro renglones que casi siempre viene completo de la ficha y
 *     casi nunca se edita: ocupaba un tercio de la pantalla para no hacer
 *     nada.
 *
 * Ninguno de los tres se pierde: los tres se guardan y los tres se imprimen
 * igual que antes. Lo que cambió es cuándo se preguntan.
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
  alReiniciarFacturacion,
  clienteInicialCodigo,
  errores,
  ubicacionInicial,
  codigoVendedorUsuario,
}: {
  form: FormularioNotaEncabezado
  alCambiar: (cambios: Partial<FormularioNotaEncabezado>) => void
  /** Abre "GENERAR NUEVO CLIENTE" con lo que ya se escribió. */
  alCrearCliente: () => void
  /**
   * Soltar o cambiar de cliente borra el tipo de nota y la condición de venta.
   *
   * Viven fuera del encabezado, así que hay que avisarle a la pantalla. Si no,
   * la costumbre de facturación de un cliente elegido por error queda pegada
   * —ya no está vacía, y la tendencia del cliente correcto no la pisa—, y la
   * nota puede salir con otro tipo de comprobante o con otro plazo de pago sin
   * ninguna señal. Reseteadas a null, la tendencia del cliente correcto las
   * vuelve a sugerir sola.
   */
  alReiniciarFacturacion?: () => void
  /**
   * Código del cliente con el que arrancar el Paso 1 ya elegido.
   *
   * Lo usa la nota que nace de una parada del rol de visita: en vez de una
   * pantalla vacía, se autoselecciona ese cliente con la misma búsqueda de
   * siempre (trae CUIT, provincia, contacto y zona). Queda cambiable.
   */
  clienteInicialCodigo?: string
  errores: Record<string, string | undefined>
  /** La del cliente que acaba de crearse, para asignarle la zona al volver. */
  /**
   * `clienteId` hace que dos altas seguidas con la misma dirección cuenten
   * como dos ubicaciones distintas: la segunda también necesita su zona.
   */
  ubicacionInicial?: (UbicacionCliente & { clienteId?: string }) | null
  /** El del que está usando la app. Es el primero que se prueba. */
  codigoVendedorUsuario?: string | null
}) {
  const { colores } = usarTema()
  const estilos = usarEstilos()
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
   * El vendedor tocó CAMBIAR sobre la zona.
   *
   * Mientras la app la deduce sola, el desplegable no se dibuja: son tres
   * filas de alto para un dato que el vendedor no elige nunca. Pero tiene que
   * poder corregirla —la localidad puede coincidir con la de otra zona— así
   * que la línea de abajo abre el desplegable de verdad, no un cartel.
   */
  const [zonaAbierta, setZonaAbierta] = useState(false)
  /**
   * Si el cliente elegido trajo CUIT.
   *
   * No alcanza con mirar `form.cliente_cuit`: el campo se dibujaba mientras
   * tuviera texto, así que al borrarlo para corregirlo **desaparecía a mitad
   * de la edición**, con el teclado abierto y sin forma de volver a tipearlo.
   *
   * Esto se prende cuando el cliente trae uno y se apaga sólo al cambiar de
   * cliente. Vaciar el casillero deja de esconderlo, que es lo que hay que
   * poder hacer para escribir otro.
   */
  const [clienteTraeCuit, setClienteTraeCuit] = useState(false)

  // Al corregir una nota o seguir un borrador, el encabezado llega después de
  // montar la pantalla: el CUIT aparece ahí, no en el primer render.
  useEffect(() => {
    if (form.cliente_cuit.trim()) setClienteTraeCuit(true)
  }, [form.cliente_cuit])

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

    /*
     * El CUIT dejó de buscar, así que vaciarlo dejó de querer decir nada.
     *
     * Los otros dos campos son el buscador: vaciarlos es el gesto de "me
     * equivoqué de cliente" y por eso sueltan el vínculo. El CUIT ya no busca
     * —sólo se dibuja sobre un cliente que ya está elegido— y ahí vaciarlo es
     * el primer teclazo de corregirlo: el vendedor selecciona todo, borra, y
     * escribe el correcto.
     *
     * Sin esta rama, ese borrado mandaba `cliente_id: null` y soltaba el
     * cliente en silencio; la nota dejaba de poder crearse y el vendedor se
     * enteraba tres pantallas después.
     */
    if (campo === 'cliente_cuit') {
      alCambiar({ cliente_cuit: texto })
      return
    }

    if (form.cliente_id && texto.trim()) {
      alCambiar({ [campo]: texto } as Partial<FormularioNotaEncabezado>)
      return
    }
    setConsulta(texto)
    alCambiar({
      [campo]: texto,
      cliente_id: null,
      // Si había un cliente, se está soltando: lo suyo se va con él.
      ...(form.cliente_id ? loQueSeVaConElCliente() : {}),
    } as Partial<FormularioNotaEncabezado>)
  }

  /**
   * Lo que la app completó sola a partir del cliente que se está soltando.
   *
   * Se va con él, pero sólo si sigue siendo lo que puso la app: lo que el
   * vendedor escribió manda (la misma regla de `elegirCliente`). Sin esto, el
   * cliente siguiente —otro de la base o uno recién dado de alta— heredaba
   * los DATOS DEL CLIENTE del anterior, el validador ya no los pedía y salían
   * impresos en su nota. (El número de vendedor que puso la zona tiene su
   * propia regla: sigue a la zona, en su efecto.)
   */
  const datosPuestosSolos = useRef<string | null>(null)

  function loQueSeVaConElCliente(): Partial<FormularioNotaEncabezado> {
    const cambios: Partial<FormularioNotaEncabezado> = {}
    if (datosPuestosSolos.current !== null && form.datos_cliente === datosPuestosSolos.current) {
      cambios.datos_cliente = ''
      cambios.datos_cliente_origen = 'texto'
    }
    datosPuestosSolos.current = null
    return cambios
  }

  /** Soltar el cliente elegido para buscar otro. Es el "✕ CAMBIAR". */
  function soltarCliente() {
    intervenido.current = true
    vigente.current++
    if (temporizador.current) clearTimeout(temporizador.current)
    setConsulta('')
    setResultados([])
    setConsultaBuscada('')
    setBuscando(false)
    setFallo(null)
    setZonaAbierta(false)
    setClienteTraeCuit(false)
    alCambiar({
      cliente_id: null,
      cliente_codigo: '',
      cliente_nombre: '',
      cliente_cuit: '',
      cliente_provisorio: false,
      ...loQueSeVaConElCliente(),
    })
    alReiniciarFacturacion?.()
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
    // Elegida a mano, el desplegable se vuelve a guardar: ya no hay nada que
    // preguntar y la pantalla recupera su alto.
    setZonaAbierta(false)
    alCambiar({ zona: zona.codigo, zona_id: zona.id })
  }

  // Al volver de "Generar nuevo cliente" con una dirección de Google ya
  // resuelta, la zona se asigna igual que si el cliente hubiera existido.
  //
  // La clave lleva el id del cliente: con la misma dirección para dos altas
  // seguidas (un nombre mal escrito, CAMBIAR y darlo de alta de nuevo) el
  // texto no cambiaba, el efecto no volvía a correr y la segunda quedaba sin
  // zona ni provincia.
  const ubicacionClave = ubicacionInicial
    ? `${ubicacionInicial.clienteId ?? ''}|${ubicacionInicial.localidad ?? ''}|${ubicacionInicial.provincia ?? ''}|${ubicacionInicial.direccion ?? ''}`
    : ''

  useEffect(() => {
    if (!ubicacionInicial) return
    const { localidad, provincia, direccion } = ubicacionInicial
    if (!localidad && !provincia && !direccion) return
    asignarZona(ubicacionInicial)
    // Del cliente recién creado la provincia viene de Google: es la que decide
    // si un "exento" paga IVA o no.
    if (ubicacionInicial.provincia) alCambiar({ cliente_provincia: ubicacionInicial.provincia })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ubicacionClave])

  /**
   * La nota que nace de una parada arranca con ese cliente ya elegido.
   *
   * Se autoselecciona con la misma búsqueda de siempre —una sola vez, y sólo si
   * todavía no hay cliente—, así trae CUIT, provincia, contacto y zona igual que
   * si el vendedor lo hubiera buscado a mano. Si la señal falla o el código no
   * aparece, el campo queda vacío y se busca a mano: no rompe nada.
   */
  /** El vendedor eligió o soltó un cliente a mano: su decisión le gana al auto-select de la parada. */
  const intervenido = useRef(false)
  const autoElegido = useRef(false)
  useEffect(() => {
    if (autoElegido.current) return
    if (!clienteInicialCodigo || CLIENTE_A_MANO || form.cliente_id) return
    autoElegido.current = true
    let vigenteAuto = true
    buscarClientes(clienteInicialCodigo)
      .then((encontrados) => {
        // Si el vendedor ya eligió o soltó un cliente a mano mientras el fetch
        // viajaba (señal mala), su decisión manda: no la pisamos con la de la
        // parada. Ver `intervenido`.
        if (!vigenteAuto || intervenido.current) return
        const exacto = encontrados.find((c) => c.codigo === clienteInicialCodigo)
        if (exacto) elegirCliente(exacto, false)
      })
      .catch(() => undefined)
    return () => {
      vigenteAuto = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clienteInicialCodigo])

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

  /**
   * El número que puso la zona, y de qué zona salió.
   *
   * Ese número sigue a la zona: si la zona cambia —otro cliente, un alta, o
   * elegida a mano— y el número sigue siendo el que puso la app, se vuelve a
   * buscar para la zona nueva. Antes quedaba el de la primera zona para
   * siempre, con la ayuda "De la zona X" nombrando otra. Si el vendedor lo
   * cambió, ya es suyo y no se toca.
   */
  const numeroPuestoPorZona = useRef<string | null>(null)
  const zonaDelNumero = useRef<string | null>(null)

  useEffect(() => {
    const numeroDeOtraZona =
      numeroPuestoPorZona.current !== null &&
      form.vendedor_numero === numeroPuestoPorZona.current &&
      zonaDelNumero.current !== form.zona
    if (numeroYaPuesto.current && !numeroDeOtraZona) return
    if (form.vendedor_numero.trim() && !numeroDeOtraZona) return

    if (codigoVendedorUsuario?.trim()) {
      numeroYaPuesto.current = true
      setOrigenVendedor('usuario')
      alCambiar({ vendedor_numero: codigoVendedorUsuario.trim() })
      return
    }

    if (!form.zona.trim()) return

    let vigente = true
    const zona = form.zona
    vendedorDeZona(zona)
      .then((codigo) => {
        if (!vigente) return
        if (!codigo) {
          // La zona nueva la cubre más de uno (o nadie): el número de la
          // anterior no vale, y queda vacío para que lo ponga el vendedor.
          if (numeroDeOtraZona) {
            numeroYaPuesto.current = false
            numeroPuestoPorZona.current = null
            zonaDelNumero.current = null
            setOrigenVendedor(null)
            alCambiar({ vendedor_numero: '' })
          }
          return
        }
        numeroYaPuesto.current = true
        setOrigenVendedor('zona')
        numeroPuestoPorZona.current = codigo
        zonaDelNumero.current = zona
        alCambiar({ vendedor_numero: codigo })
      })
      .catch(() => undefined)

    return () => {
      vigente = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.vendedor_numero, form.zona, codigoVendedorUsuario])

  /**
   * ¿Se dibuja el CUIT?
   *
   * Sólo si hay uno que mostrar. En la beta el cliente se escribe entero —así
   * que también el CUIT— y un cliente nuevo se está cargando a mano, que es el
   * otro caso en que el campo sirve para algo.
   */
  const muestraCuit = CLIENTE_A_MANO || form.cliente_nuevo || clienteTraeCuit

  /** La zona que quedó puesta, para poder nombrarla en una línea. */
  const zonaElegida = ZONAS.find((z) => z.id === form.zona_id) ?? null

  /**
   * ¿Se dibuja el desplegable de ZONA?
   *
   * Cuando hay algo que decidir: la localidad está en más de una zona, no se
   * pudo deducir ninguna, el validador la está reclamando, o el vendedor tocó
   * CAMBIAR. En la beta siempre, porque ahí no hay ficha de cliente de donde
   * deducirla.
   */
  const muestraZona =
    CLIENTE_A_MANO ||
    zonaAbierta ||
    zonaDudosa.length > 1 ||
    !!errores.zona ||
    // Recién cuando hay cliente elegido y aun así no se pudo deducir. Antes de
    // elegirlo el desplegable no sirve para nada: `elegirCliente` llama a
    // `asignarZona(..., forzar = true)` y pisa lo que se hubiera elegido a
    // mano. Ofrecer un control cuyo valor se descarta es peor que no ofrecerlo.
    (!!form.cliente_id && !zonaElegida)

  function elegirCliente(c: ClienteBuscado, manual = true) {
    // Una elección a mano le gana al auto-select de la parada (ver `intervenido`).
    if (manual) intervenido.current = true
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

    // El CUIT se dibuja si ESTE cliente trae uno. Un cliente sin CUIT apaga
    // el campo que había dejado abierto el anterior.
    setClienteTraeCuit(!!c.cuit)

    // Si los datos los pone la app, se anota: son del cliente y se van con él.
    datosPuestosSolos.current = form.datos_cliente.trim() ? null : datos

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

    // Y borra la facturación del cliente anterior: la tendencia de este cliente
    // la vuelve a sugerir sola, en vez de quedar pegada la del que se cambió.
    alReiniciarFacturacion?.()
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
          Los campos se ven igual de llenos con el cliente enganchado que con
          los datos tipeados a mano, y son dos situaciones muy distintas: sin
          enganchar, la nota no se puede crear. Acá se ve cuál quedó, y por
          dónde se lo suelta si es el equivocado.

          En una línea, no en un recuadro de tres. El rótulo "CLIENTE ELEGIDO"
          lo dicen igual el tilde y el borde verde, y el nombre entra al lado.
          Eran un centímetro y pico de una página que tiene que entrar entera. */}
      {!CLIENTE_A_MANO && form.cliente_id ? (
        <View style={estilos.clienteElegido}>
          <Text style={estilos.clienteElegidoTilde}>✓</Text>
          <Text
            style={[estilos.clienteElegidoNombre, estilos.mitad]}
            numberOfLines={1}
            accessibilityLabel={`Cliente elegido: ${form.cliente_codigo}, ${form.cliente_nombre}`}
          >
            {form.cliente_codigo} · {form.cliente_nombre}
          </Text>
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

      {/* El código del cliente y el número de vendedor, en una fila.
          Son los dos campos cortos de la página y son los dos números que la
          nota lleva arriba; uno debajo del otro comían una fila entera para
          dejar media vacía cada uno.

          La tecla del teclado dice BUSCAR y busca en el acto: el que sabe el
          código lo escribe y confirma, sin esperar a que la app adivine que
          terminó de tipear. `blurOnSubmit={false}` deja el teclado abierto,
          porque lo que sigue es tocar el cliente en la lista de abajo y
          cerrarlo la haría saltar justo cuando aparece. */}
      <View style={estilos.fila}>
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

        {/* El número sale del perfil pero se puede corregir: hay altas sin
            código cargado y el comprobante lo necesita igual. Se imprime sin
            los ceros de relleno del Gestión ("007" sale 7), y ahora además va
            adelante del número de nota: la 81 del vendedor 2 es la 02-0081.

            De dónde salió el número se cuenta en la ayuda del propio campo y
            no en una línea aparte: decía lo mismo y costaba una fila. */}
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
            origenVendedor === 'usuario' && form.vendedor_numero
              ? 'Tuyo. Cambialo si es de otro.'
              : origenVendedor === 'zona' && form.vendedor_numero
                ? `De la zona ${form.zona}.`
                : // Sólo cuando sale distinto de lo que se tipeó, que es el
                  // caso de los códigos con ceros de relleno del Gestión
                  // ("007" sale 7). Cuando sale igual —que es casi siempre—
                  // la línea repetía el número que está tres centímetros más
                  // arriba y costaba una fila de una pantalla que no la tiene.
                  form.vendedor_numero &&
                    numeroDeVendedorImpreso(form.vendedor_numero, VENDEDORES_CON_CERO) !==
                      form.vendedor_numero
                  ? `En la nota sale: ${numeroDeVendedorImpreso(form.vendedor_numero, VENDEDORES_CON_CERO)}`
                  : undefined
          }
        />
      </View>

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

      {/* Mientras no haya cliente elegido, que es cuando sirve.

          Con uno ya enganchado el enlace no lleva a ningún lado bueno: el
          cliente existe, está elegido, y "¿Es nuevo cliente?" abajo de su
          nombre es una fila que sólo puede confundir. Aparece de nuevo apenas
          se lo suelta o si la búsqueda no lo encuentra, que es el momento en
          que el vendedor se pregunta justamente eso.

          En la beta no se dan de alta clientes: escribirlos en la nota es
          justamente lo que se está probando, y crear fichas sueltas mientras
          tanto ensuciaría el padrón que después hay que cargar en serio. */}
      {CLIENTE_A_MANO || form.cliente_id ? null : (
        <Pressable
          onPress={alCrearCliente}
          hitSlop={10}
          accessibilityRole="button"
          style={estilos.enlaceNuevo}
        >
          <Text style={estilos.enlaceNuevoTexto}>¿Es nuevo cliente?</Text>
        </Pressable>
      )}

      {/* El CUIT aparece cuando el cliente tiene uno: ahí es un dato que se
          puede corregir. Cuando no lo tiene era un casillero vacío que no se
          podía completar con nada, porque el CUIT lo carga Administración en
          la ficha, no el vendedor en la nota. */}
      {muestraCuit ? (
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
      ) : null}

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

      {/* ── Vendedor y zona, en una línea ────────────────────────────────
          Los dos son datos que la app pone sola y que el vendedor mira, no
          completa. El nombre no se edita nunca, y la zona sale de la localidad
          del cliente.

          El desplegable de zona son tres filas de alto, y hasta acá se
          dibujaba siempre — también en el caso normal, que es el 90 %: la
          localidad cae en una sola zona y no hay nada que elegir. Ahora sale
          esta línea, y CAMBIAR abre el desplegable de verdad. */}
      {!muestraZona ? (
        <View style={estilos.pieFila}>
          {/*
            Tres piezas, y cuál se encoge no es un detalle.

            El NOMBRE lleva `flex: 1` y es el único que se achica: en un
            teléfono angosto se corta con puntos suspensivos y no pasa nada,
            porque el vendedor sabe cómo se llama.

            La ZONA va sin flex, así que se queda con su ancho natural —tres
            dígitos— y no se corta nunca. Es el dato por el que existe esta
            línea: escondido el desplegable, es lo único que dice en qué zona
            quedó la nota. Puesta junto al nombre en un solo `Text`, con
            "Sebastian Sayago" adelante desaparecía entera y quedaba un "·…".

            Y CAMBIAR tampoco se encoge, porque es el único acceso que queda al
            desplegable: una zona mal deducida no se podría corregir.
          */}
          <Text style={[estilos.vendedor, estilos.mitad]} numberOfLines={1}>
            VENDEDOR: {form.vendedor || '—'}
          </Text>
          {zonaElegida ? (
            <Text style={estilos.zonaPuesta}>ZONA {zonaElegida.codigo}</Text>
          ) : null}
          <Pressable
            onPress={() => setZonaAbierta(true)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Cambiar la zona"
            style={({ pressed }) => [estilos.cambiarZona, pressed && estilos.tocado]}
          >
            <Text style={estilos.cambiarZonaTexto}>CAMBIAR</Text>
          </Pressable>
        </View>
      ) : (
        <>
          <Text style={estilos.vendedor} numberOfLines={1}>
            VENDEDOR: {form.vendedor || '—'}
          </Text>

          {/* ── Zona ─────────────────────────────────────────────────────────
              Dejó de ser texto libre: el número de zona es el que usa la
              oficina para repartir el trabajo, y "Oeste", "oeste" y "Z. Oeste"
              escritos a mano son tres zonas distintas para cualquier
              planilla. */}
          <Desplegable<string>
            etiqueta="ZONA"
            obligatorio
            marcador="Elegí la zona"
            valor={form.zona_id || null}
            items={ZONAS.map((z) => ({
              valor: z.id,
              etiqueta: etiquetaZona(z),
              descripcion: z.localidades.slice(0, 4).join(', '),
              // Se busca por las treinta y seis localidades, no por las cuatro
              // que entran en la línea.
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
              {zonaAuto.origen === 'direccion' ? ', que aparece en la dirección' : ''}. Cambiala si
              no corresponde.
            </Text>
          ) : null}
        </>
      )}

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

      <DetalleDelCliente
        valor={form.datos_cliente}
        alCambiar={(t) => alCambiar({ datos_cliente: t })}
        alCambiarOrigen={(o) => alCambiar({ datos_cliente_origen: o })}
        error={errores.datos_cliente}
      />
    </>
  )
}

/**
 * "DATOS DEL CLIENTE", achicado a una línea.
 *
 * Es un campo de cuatro renglones con micrófono, y en la práctica se completa
 * solo: al elegir el cliente le entran la dirección, el CP, el teléfono, el
 * mail y el contacto de la ficha. El vendedor lo lee y sigue de largo. Abierto
 * siempre, se llevaba un tercio de la primera página para no hacer nada, y era
 * la razón principal por la que había que scrollear para llegar a CONTINUAR.
 *
 * Cerrado muestra el contenido en una línea —cortado, pero se ve de qué
 * cliente se trata— y se abre al tocarlo. Ahí adentro es el mismo campo de
 * siempre, con el micrófono y todo.
 *
 * Se abre solo cuando hay un error: el validador lo reclama vacío y el
 * vendedor tiene que poder verlo y arreglarlo sin adivinar dónde está.
 */
function DetalleDelCliente({
  valor,
  alCambiar,
  alCambiarOrigen,
  error,
}: {
  valor: string
  alCambiar: (texto: string) => void
  alCambiarOrigen: (origen: 'texto' | 'voz') => void
  error?: string
}) {
  const estilos = usarEstilos()
  const [abierto, setAbierto] = useState(false)

  useEffect(() => {
    if (error) setAbierto(true)
  }, [error])

  if (!abierto) {
    return (
      <Pressable
        onPress={() => setAbierto(true)}
        accessibilityRole="button"
        accessibilityLabel="Editar los datos del cliente"
        style={({ pressed }) => [estilos.detalleCerrado, pressed && estilos.tocado]}
      >
        <Text style={estilos.detalleRotulo}>DATOS DEL CLIENTE</Text>
        <Text
          style={valor.trim() ? estilos.detalleTexto : estilos.detalleVacio}
          numberOfLines={1}
        >
          {valor.trim() || 'Tocá para escribir la dirección, el teléfono y el contacto'}
        </Text>
      </Pressable>
    )
  }

  return (
    <View>
      <CampoDictado
        etiqueta="DATOS DEL CLIENTE"
        obligatorio
        valor={valor}
        alCambiar={alCambiar}
        alCambiarOrigen={alCambiarOrigen}
        placeholder="Dirección, teléfono, contacto…"
        error={error}
        // Se abrió porque lo tocaron: el teclado tiene que estar listo.
        autoFocus
      />
      {/* Volver a achicarlo. Sin esto, tocar el campo una vez dejaba la
          pantalla larga para siempre. */}
      <Pressable
        onPress={() => setAbierto(false)}
        hitSlop={10}
        accessibilityRole="button"
        style={({ pressed }) => [estilos.achicar, pressed && estilos.tocado]}
      >
        <Text style={estilos.achicarTexto}>▲ ACHICAR</Text>
      </Pressable>
    </View>
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
  const estilos = usarEstilos()
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

const usarEstilos = hojaDeTema((t) => ({
  fila: { flexDirection: 'row', gap: espaciado.sm },

  /* La descripción general que arma la app. Va con el mismo rótulo que tenía
     el campo, porque para el vendedor es el mismo dato: lo que va a decir la
     nota. Lo que cambió es quién lo escribe. */
  servicio: {
    backgroundColor: t.colores.panelClaro,
    borderRadius: radios.sm,
    borderLeftWidth: 4,
    borderLeftColor: t.colores.verdeOscuro,
    paddingHorizontal: espaciado.md,
    paddingVertical: espaciado.sm,
    gap: espaciado.xs,
  },
  servicioRotulo: {
    fontFamily: t.tipografia.familia.cuerpo,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.tintaSuave,
  },
  servicioTexto: {
    fontFamily: t.tipografia.familia.subtitulo,
    fontSize: t.tipografia.tamano.sm,
    color: t.colores.tinta,
  },
  servicioVacio: {
    fontFamily: t.tipografia.familia.liviana,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.tintaTenue,
  },
  mitad: { flex: 1 },

  vendedor: {
    fontFamily: t.tipografia.familia.cuerpo,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.tintaSuave,
  },

  zonaAuto: {
    fontFamily: t.tipografia.familia.liviana,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.verdeOscuro,
    marginTop: -espaciado.xs,
  },
  zonaDudosa: {
    borderWidth: 2,
    borderColor: t.colores.ambarOscuro,
    borderRadius: radios.sm,
    backgroundColor: t.colores.campoBlanco,
    overflow: 'hidden',
  },
  zonaDudosaTitulo: {
    fontFamily: t.tipografia.familia.cuerpo,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.tinta,
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
    fontFamily: t.tipografia.familia.subtitulo,
    fontSize: t.tipografia.tamano.sm,
    color: t.colores.tinta,
  },

  /* La línea de vendedor y zona: el texto a la izquierda y CAMBIAR ZONA a la
     derecha, en el mismo alto de dedo que el resto de los toques. */
  pieFila: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaciado.sm,
    marginTop: -espaciado.xs,
  },
  /* Sin `flex`: se queda con su ancho natural y no se corta nunca. Ver el
     comentario de la fila. */
  zonaPuesta: {
    fontFamily: t.tipografia.familia.subtitulo,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.tinta,
  },
  cambiarZona: { minHeight: 44, justifyContent: 'center', paddingHorizontal: espaciado.xs },
  cambiarZonaTexto: {
    fontFamily: t.tipografia.familia.subtitulo,
    // Un escalón más que el resto de las ayudas: es el único camino para
    // corregir una zona mal deducida, y al sol la letra más chica no se lee.
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.rojo,
  },

  /* El detalle del cliente cerrado: una línea, con el mismo borde que un
     campo para que se lea como un campo y no como un cartel. */
  detalleCerrado: {
    borderWidth: 2,
    borderColor: t.colores.borde,
    borderRadius: radios.sm,
    backgroundColor: t.colores.campoBlanco,
    paddingHorizontal: espaciado.md,
    paddingVertical: espaciado.sm,
    minHeight: 56,
    justifyContent: 'center',
    gap: 2,
  },
  detalleRotulo: {
    fontFamily: t.tipografia.familia.subtitulo,
    fontSize: t.tipografia.tamano.micro,
    color: t.colores.tintaSuave,
  },
  detalleTexto: {
    fontFamily: t.tipografia.familia.cuerpo,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.tinta,
  },
  detalleVacio: {
    fontFamily: t.tipografia.familia.liviana,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.tintaTenue,
  },
  achicar: { alignSelf: 'flex-end', paddingVertical: espaciado.xs },
  achicarTexto: {
    fontFamily: t.tipografia.familia.subtitulo,
    fontSize: t.tipografia.tamano.micro,
    color: t.colores.rojo,
  },

  enlaceNuevo: { alignSelf: 'flex-start', paddingVertical: espaciado.xs },
  enlaceNuevoTexto: {
    fontFamily: t.tipografia.familia.cuerpo,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.rojo,
    textDecorationLine: 'underline',
  },

  clienteElegido: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaciado.sm,
    borderWidth: 2,
    borderColor: t.colores.verdeOscuro,
    borderRadius: radios.sm,
    backgroundColor: t.colores.campoBlanco,
    paddingHorizontal: espaciado.md,
    // Alto de dedo, y nada más: el rótulo de arriba se fue y el nombre entra
    // en la misma línea que el tilde y el botón de cambiarlo.
    minHeight: 48,
  },
  /* El tilde verde dice lo que decía el rótulo "CLIENTE ELEGIDO", y ocupa un
     carácter en vez de un renglón. */
  clienteElegidoTilde: {
    fontFamily: t.tipografia.familia.fuerte,
    fontSize: t.tipografia.tamano.sm,
    color: t.colores.verdeOscuro,
  },
  clienteElegidoNombre: {
    fontFamily: t.tipografia.familia.fuerte,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.tinta,
  },
  cambiarCliente: {
    // Alto de dedo: se toca parado en un taller.
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: espaciado.xs,
  },
  cambiarClienteTexto: {
    fontFamily: t.tipografia.familia.subtitulo,
    // Un escalón más: es el único camino para corregir un cliente mal elegido.
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.rojo,
  },
  tocado: { opacity: 0.7 },

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
    gap: 2,
  },
  sugerenciaTocada: { backgroundColor: t.colores.panelClaro },
  sugerenciaFila: { flexDirection: 'row', alignItems: 'center', gap: espaciado.sm },
  sugerenciaCodigo: {
    fontFamily: t.tipografia.familia.subtitulo,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.rojo,
  },
  sugerenciaNombre: {
    fontFamily: t.tipografia.familia.fuerte,
    fontSize: t.tipografia.tamano.sm,
    color: t.colores.tinta,
  },
  sugerenciaDato: {
    fontFamily: t.tipografia.familia.liviana,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.tintaSuave,
  },
  sinResultados: {
    fontFamily: t.tipografia.familia.cuerpo,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.tintaSuave,
  },
}))
