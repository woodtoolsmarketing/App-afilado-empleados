import {
  agruparParaNotas,
  aNumero,
  colores,
  DESCRIPCION_GRUPO_NOTA,
  descripcionSugerida,
  DIAS_CHEQUE_MAXIMO,
  esDescripcionSugerida,
  ENCABEZADO_VACIO,
  espaciado,
  ETIQUETA_CONDICION_VENTA,
  ETIQUETA_GRUPO_NOTA,
  ETIQUETA_HERRAMIENTA,
  ETIQUETA_ORIGEN_FRESA,
  ETIQUETA_TIPO_NOTA,
  ETIQUETA_TIPO_SERVICIO,
  fechaEntregaPorDefecto,
  formatearFechaCorta,
  formatearMoneda,
  fechaLocalISO,
  formatearPesos,
  HERRAMIENTAS_POR_SERVICIO,
  ITEM_VACIO,
  radios,
  MAXIMO_RENGLONES,
  OBSERVACION_MAXIMO_CARACTERES,
  renglonEnBlanco,
  renglonNuevo,
  resumenRenglon,
  soloNumeros,
  SUMAR_OTRA,
  tieneRenglonesEnDolares,
  tipografia,
  totalDeRenglones,
  totalDelRenglon,
  totalDelRenglonEnPesos,
  validarEncabezadoNota,
  validarItemNota,
  validarRenglones,
  type CondicionVenta,
  type FormularioItemNota,
  type FormularioNotaEncabezado,
  type Herramienta,
  type OrigenFresa,
  type ParteDeLaNota,
  type TipoNotaPedido,
  type TipoServicio,
} from '@woodtools/compartido'
import DateTimePicker from '@react-native-community/datetimepicker'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'

import { BotonMenu, BotonSecundario } from '../../componentes/Botones'
import { Campo, Casilla, Desplegable, MensajeError } from '../../componentes/Formulario'
import { Aviso, Cargando, Pastilla } from '../../componentes/Estado'
import { Encabezado } from '../../componentes/Encabezado'
import { BarraPanel, Pantalla, Panel, TituloPanel } from '../../componentes/Pantalla'
import { usarSesion, etiquetaVendedor } from '../../nucleo/sesion'
import { CLIENTE_A_MANO } from '../../nucleo/variante'
import {
  corregirNotaPedido,
  crearNotaPedido,
  notaParaCorregir,
  obtenerCotizacion,
  tendenciaCliente,
  type TendenciaCliente,
} from '../../servicios/notasPedido'
import { BuscadorArticulo } from './BuscadorArticulo'
import { PasoCliente, PasoOperacion } from './Encabezado'
import { PasoRenglon } from './Renglon'
import type { PropsPantalla } from '../../navegacion/tipos'

/**
 * "GENERAR NUEVA NOTA DE PEDIDO"
 *
 * Tres páginas, en el orden en que pasan las cosas en el taller:
 *
 *   1. **A quién.** Cliente, zona, vendedor y para cuándo se entrega.
 *   2. **Qué trajo.** Tipo de operación y los renglones, con los campos que
 *      pide la herramienta de cada uno.
 *   3. **Cómo se cobra.** Factura o presupuesto, condición de venta, tipo de
 *      cambio y observaciones.
 *
 * Antes eran dos, con la facturación mezclada en la primera: el vendedor tenía
 * que decidir la condición de venta antes de haber cargado nada, que es
 * justamente el momento en que todavía no sabe cuánto va a salir.
 *
 * La nota lleva varios renglones, como el talonario de papel. Se edita uno por
 * vez —el resto queda arriba como tarjetas— porque en un teléfono no entran dos
 * formularios abiertos y porque así el vendedor siempre sabe cuál está tocando.
 *
 * **La misma pantalla corrige.** Con `notaId` en los parámetros se abre cargada
 * con una nota que todavía no se imprimió, y el botón del final guarda encima
 * en vez de crear otra. Es el mismo formulario a propósito: mantener dos
 * pantallas que dibujan lo mismo termina en que una de las dos se queda atrás.
 */
export function PantallaGenerarNota({ navigation, route }: PropsPantalla<'GenerarNota'>) {
  const perfil = usarSesion((s) => s.perfil)
  const cliente = useQueryClient()

  /** Cuando viene, esta pantalla corrige esa nota en vez de crear una nueva. */
  const notaId = route.params?.notaId ?? null
  const corrigiendo = !!notaId

  const [paso, setPaso] = useState<1 | 2 | 3>(1)
  const [encabezado, setEncabezado] = useState<FormularioNotaEncabezado>({
    ...ENCABEZADO_VACIO,
    vendedor: etiquetaVendedor(perfil),
    // Del perfil, pero editable: hay altas sin código cargado.
    vendedor_numero: perfil?.codigo_vendedor ?? '',
  })
  const [servicios, setServicios] = useState<TipoServicio[]>([])
  const [tipoNota, setTipoNota] = useState<TipoNotaPedido | null>(null)
  /** Cómo se cobra. Va a la columna "Condicion de Venta" del talonario. */
  const [condicionVenta, setCondicionVenta] = useState<CondicionVenta | null>(null)
  const [condicionDetalle, setCondicionDetalle] = useState('')
  /**
   * Lo que este cliente usa siempre, para dejarlo preseleccionado.
   *
   * Se guarda aparte de los valores elegidos porque la pantalla tiene que poder
   * decir de dónde salieron. Un desplegable que aparece completo sin explicar
   * por qué es un desplegable que el vendedor no revisa.
   */
  const [tendencia, setTendencia] = useState<TendenciaCliente | null>(null)
  /**
   * Viene puesta a una semana, que es el plazo normal de la casa.
   *
   * Era el último campo obligatorio que quedaba sin ayuda: el vendedor abría el
   * calendario y contaba siete días a mano en cada nota. Se cambia con un
   * toque. Corrigiendo arranca en null y la pisa la que tenía la nota.
   */
  const [fechaEntrega, setFechaEntrega] = useState<Date | null>(
    corrigiendo ? null : fechaEntregaPorDefecto(),
  )
  const [calendario, setCalendario] = useState(false)
  const [items, setItems] = useState<FormularioItemNota[]>([ITEM_VACIO])
  /** Cuál de los renglones se está editando. */
  const [activo, setActivo] = useState(0)
  const [errores, setErrores] = useState<Record<string, string | undefined>>({})
  const [intentado, setIntentado] = useState(false)
  const [seleccionandoHerramientas, setSeleccionandoHerramientas] = useState(false)
  const [herramientasElegidas, setHerramientasElegidas] = useState<Herramienta[]>([])
  /**
   * Las observaciones van a la columna "Observaciones" del talonario, una por
   * renglón, igual que en el papel.
   *
   * Se cargan como renglones sueltos y **sin botón**: el último siempre está
   * vacío y en cuanto se escribe algo aparece el siguiente. Antes había que
   * tocar "AGREGAR RENGLÓN" para que lo escrito contara, y lo que quedaba en el
   * campo sin tocarlo salía o no salía impreso según el caso.
   */
  const [observaciones, setObservaciones] = useState<string[]>([''])
  /** Las que escribe el servidor ("Va con nota de pedido…"): no se editan. */
  const [observacionesDelSistema, setObservacionesDelSistema] = useState<string[]>([])

  // ── La nota que se está corrigiendo ──────────────────────────────────────
  const {
    data: borrador,
    isLoading: cargandoNota,
    error: errorNota,
  } = useQuery({
    queryKey: ['nota-a-corregir', notaId],
    queryFn: () => notaParaCorregir(notaId!),
    enabled: corrigiendo,
    // Una recarga en medio de la corrección pisaría lo que el vendedor está
    // escribiendo con lo que hay guardado. Se trae una vez y no se vuelve.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  })

  const [cargado, setCargado] = useState(false)

  useEffect(() => {
    if (!borrador || cargado) return
    setEncabezado(borrador.encabezado)
    setServicios(borrador.servicios)
    setTipoNota(borrador.tipoNota)
    setCondicionVenta(borrador.condicionVenta)
    setCondicionDetalle(borrador.condicionDetalle)
    // La fecha viene como `2026-08-20`; con `new Date` de un ISO corto se lee
    // en UTC y en Argentina eso la corre un día para atrás.
    if (borrador.fechaEntrega) {
      const [a, m, d] = borrador.fechaEntrega.split('-').map(Number)
      setFechaEntrega(new Date(a, m - 1, d))
    }
    if (borrador.items.length > 0) setItems(borrador.items)
    setObservaciones([...borrador.observaciones, ''])
    setObservacionesDelSistema(borrador.observacionesDelSistema)
    if (borrador.tipoCambio) setCambioPropio(borrador.tipoCambio)
    setCargado(true)
  }, [borrador, cargado])

  /**
   * Al elegir un cliente, traer cómo compra y dejarlo puesto.
   *
   * Sólo completa lo que está vacío: si el vendedor ya eligió factura porque
   * hoy es distinto, la costumbre del cliente no se la pisa. Ese es todo el
   * criterio —preseleccionar es ahorrar toques, no decidir por el otro—, y es
   * lo que hace que corregir una nota no le cambie nada de lo que ya decía.
   */
  useEffect(() => {
    const id = encabezado.cliente_id
    if (!id) {
      setTendencia(null)
      return
    }

    let vigente = true
    tendenciaCliente(id)
      .then((t) => {
        if (!vigente || !t) return
        setTendencia(t)
        if (t.tipo_nota) setTipoNota((actual) => actual ?? t.tipo_nota)
        if (t.condicion_venta) {
          setCondicionVenta((actual) => {
            if (actual) return actual
            // El detalle viaja con la condición: un "cheque" sin los días
            // preseleccionados deja el campo obligatorio en blanco.
            if (t.condicion_detalle) setCondicionDetalle(t.condicion_detalle)
            return t.condicion_venta
          })
        }
      })
      .catch(() => undefined)

    return () => {
      vigente = false
    }
  }, [encabezado.cliente_id])

  /**
   * Escribir en un renglón de observaciones.
   *
   * El último siempre queda vacío: en cuanto se escribe en él aparece otro
   * abajo. Así cargar la segunda observación no depende de encontrar un botón.
   */
  function escribirObservacion(indice: number, texto: string) {
    setObservaciones((previas) => {
      const nuevas = previas.slice()
      nuevas[indice] = texto
      const esUltima = indice === nuevas.length - 1
      if (esUltima && texto.trim() && nuevas.length < MAXIMO_RENGLONES) nuevas.push('')
      return nuevas
    })
  }

  function quitarObservacion(indice: number) {
    setObservaciones((previas) => {
      const nuevas = previas.filter((_, i) => i !== indice)
      return nuevas.length > 0 ? nuevas : ['']
    })
  }

  /** Las que efectivamente van a la nota: el renglón vacío del final no cuenta. */
  const observacionesCargadas = observaciones.filter((o) => o.trim())

  /**
   * Los ids de las notas que ya salieron de esta pantalla.
   *
   * Mientras esté cargado, el botón de crear deja de crear. La pantalla no se
   * desmonta al ir a la vista previa, así que sin esto el formulario queda
   * entero y vivo, listo para generar la misma nota otra vez.
   */
  const [creadas, setCreadas] = useState<string[]>([])
  /**
   * Ya se guardó: el aviso de "salís sin guardar" no tiene que aparecer cuando
   * la salida es justamente la que sigue a haber guardado.
   */
  const guardado = useRef(false)

  const renglon = items[activo] ?? items[0]

  /** Con una sola operación no hay nada que elegir por renglón. */
  const pedirServicio = servicios.length > 1

  // Al volver de "Generar nuevo cliente" se completa el encabezado solo: el
  // vendedor no tiene que volver a buscar lo que acaba de crear.
  const creadoId = route.params?.clienteCreadoId
  /**
   * La ubicación del cliente recién creado, para que el encabezado le asigne
   * la zona. Se guarda en estado porque los parámetros de ruta se limpian
   * enseguida —si no, volver a esta pantalla revive el alta— y la asignación
   * tiene que sobrevivir a esa limpieza.
   */
  const [ubicacionNueva, setUbicacionNueva] = useState<{
    localidad?: string | null
    provincia?: string | null
    direccion?: string | null
  } | null>(null)

  useEffect(() => {
    if (!creadoId) return
    setEncabezado((e) => ({
      ...e,
      cliente_id: creadoId,
      cliente_nombre: route.params?.clienteCreadoNombre ?? e.cliente_nombre,
      cliente_cuit: route.params?.clienteCreadoCuit ?? e.cliente_cuit,
      cliente_codigo: '',
      cliente_nuevo: false,
      cliente_provisorio: true,
    }))
    setUbicacionNueva({
      localidad: route.params?.clienteCreadoLocalidad ?? null,
      provincia: route.params?.clienteCreadoProvincia ?? null,
      direccion: route.params?.clienteCreadoDireccion ?? null,
    })
    navigation.setParams({ clienteCreadoId: undefined })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creadoId])

  const {
    data: cotizacion,
    isLoading: cargandoCotizacion,
    refetch: reintentarCotizacion,
    isFetching: buscandoCotizacion,
  } = useQuery({
    queryKey: ['cotizacion-hoy'],
    queryFn: () => obtenerCotizacion(),
    staleTime: 60 * 60 * 1000,
  })

  /**
   * El tipo de cambio que el vendedor decidió usar, si pisó el oficial.
   *
   * Vacío significa "el que trajo la app". Se guarda como texto porque es un
   * campo que se tipea: pasarlo por número mientras se escribe se come el
   * separador decimal en cuanto se borra un dígito.
   */
  const [cambioPropio, setCambioPropio] = useState('')
  const [editandoCambio, setEditandoCambio] = useState(false)

  /**
   * El que manda para la cuenta.
   *
   * El oficial es el valor por defecto y el que se muestra siempre, pero el
   * vendedor puede acordar otro con el cliente —y de hecho lo hace—. Antes el
   * casillero no existía: la nota se armaba con el oficial y la diferencia se
   * arreglaba después por teléfono, o salía mal cobrada.
   */
  const cambioElegido = aNumero(cambioPropio)
  const cambioEnUso = cambioElegido > 0 ? cambioElegido : (cotizacion?.venta ?? 0)
  const cambioPisado = cambioElegido > 0 && cambioElegido !== cotizacion?.venta

  /**
   * ¿Hay algo cotizado en dólares en esta nota?
   *
   * De eso depende que el recuadro del tipo de cambio exista siquiera. El
   * afilado se cobra en pesos y la nota sale sin cotización impresa, así que el
   * recuadro no decía nada: era un número grande al lado del total, en otra
   * moneda, en una pantalla donde todo lo demás está en pesos.
   *
   * Se mira sobre las líneas de cómputo y no sobre el campo `moneda` del
   * renglón: en un renglón de servicio la moneda es siempre pesos, aunque el
   * campo haya quedado en dólares de cuando ese renglón era una venta.
   */
  const hayDolares = tieneRenglonesEnDolares(items)

  /**
   * Aplica los cambios SOBRE EL ESTADO ANTERIOR, no sobre la copia del render.
   *
   * Antes armaba `{ ...encabezado, ...cambios }` con el `encabezado` que había
   * cuando se dibujó la pantalla. Con un solo cambio por vez funcionaba; con
   * dos en el mismo evento, el segundo pisaba al primero — los dos partían de
   * la misma copia vieja.
   *
   * Y eso pasaba en cada tecla del campo con micrófono, que avisa dos cosas
   * juntas: el texto nuevo y que el origen es "texto". El segundo aviso
   * devolvía el campo a como estaba, así que escribir no hacía nada y lo
   * dictado desaparecía apenas se transcribía.
   */
  function cambiarEncabezado(cambios: Partial<FormularioNotaEncabezado>) {
    setEncabezado((previo) => ({ ...previo, ...cambios }))
  }

  // La revalidación mira el estado ya aplicado. Hacerla adentro del cambio
  // obligaba a adivinar cómo iba a quedar, que es de dónde salía el problema.
  useEffect(() => {
    if (!intentado) return
    revalidarEncabezado(encabezado, servicios)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [encabezado, servicios, intentado, tipoNota, fechaEntrega, condicionVenta, condicionDetalle])

  function cambiarServicios(nuevos: TipoServicio[]) {
    setServicios(nuevos)
    // Un renglón cuyo servicio se destildó queda huérfano: pasa al primero que
    // siga tildado, y suelta la herramienta si esa ya no aplica.
    const principal = nuevos[0] ?? 'afilado'
    const unaSola = nuevos.length === 1
    setItems((rs) =>
      rs.map((r) => {
        const sigue = nuevos.includes(r.servicio)
        const servicio = sigue ? r.servicio : principal
        const herramienta =
          r.herramienta && HERRAMIENTAS_POR_SERVICIO[servicio].includes(r.herramienta)
            ? r.herramienta
            : null
        /**
         * Con una sola operación no hay nada que elegir y queda puesta.
         *
         * Con varias vuelve a preguntar, salvo que el renglón ya tenga algo
         * cargado: ése se cargó cuando la operación era una sola y no hay
         * ninguna duda de cuál es. El renglón EN BLANCO sí vuelve a preguntar,
         * y es el caso que importa —las operaciones se marcan de a una, así
         * que el primer renglón pasaba por "una sola operación" y quedaba
         * decidido en afilado sin que nadie lo eligiera—.
         */
        const elegido = unaSola
          ? true
          : sigue && r.servicio_elegido && !renglonEnBlanco(r)
        if (
          servicio === r.servicio &&
          herramienta === r.herramienta &&
          elegido === r.servicio_elegido
        ) {
          return r
        }
        return {
          ...r,
          servicio,
          herramienta,
          servicio_elegido: elegido,
          codigos_computo: servicio === r.servicio && herramienta === r.herramienta
            ? r.codigos_computo
            : [],
        }
      }),
    )
    if (intentado) revalidarEncabezado(encabezado, nuevos)
  }

  function revalidarEncabezado(
    enc: FormularioNotaEncabezado,
    servs: TipoServicio[],
    partes?: ParteDeLaNota[],
  ) {
    const { errores: e } = validarEncabezadoNota(enc, {
      servicios: servs,
      tipoNota,
      fechaEntrega: fechaEntrega ? fechaEntrega.toISOString() : null,
      condicionVenta,
      condicionVentaDetalle: condicionDetalle,
      clienteAMano: CLIENTE_A_MANO,
      partes: partes ?? PARTES_DEL_PASO[paso],
    })
    setErrores(e as Record<string, string | undefined>)
  }

  /**
   * Mismo criterio que el encabezado: sobre el renglón que hay, no sobre la
   * copia del render. Acá también llegan cambios encadenados —la descripción
   * se completa sola al elegir la herramienta, el agujero de fábrica llega
   * después de consultar el catálogo— y con la copia vieja uno borraba al otro.
   */
  function cambiarItem(cambios: Partial<FormularioItemNota>) {
    setItems((rs) => rs.map((r, i) => (i === activo ? { ...r, ...cambios } : r)))
  }

  useEffect(() => {
    if (!intentado || paso !== 2 || !renglon) return
    setErrores(
      validarItemNota(renglon, { pedirServicio }).errores as Record<string, string | undefined>,
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renglon, intentado, paso, pedirServicio])

  /** El servicio se elige por renglón cuando arriba tildaron más de uno. */
  function cambiarServicioDelRenglon(servicio: TipoServicio) {
    const herramienta =
      renglon.herramienta && HERRAMIENTAS_POR_SERVICIO[servicio].includes(renglon.herramienta)
        ? renglon.herramienta
        : null
    cambiarItem({ servicio, servicio_elegido: true, herramienta, codigos_computo: [] })
  }

  /**
   * ¿Entra otro renglón?
   *
   * La nota tiene doce, que es el alto del talonario en papel. El tope se
   * avisa acá y no al guardar: descubrir a los trece renglones que hay que
   * sacar uno es tirar el trabajo de cargarlo.
   */
  const lugarLibre = MAXIMO_RENGLONES - items.length

  function avisarSinLugar() {
    Alert.alert(
      `La nota entra hasta ${MAXIMO_RENGLONES} renglones`,
      'Ya están los doce. Si el cliente trajo más, terminá ésta y cargá el resto en otra nota: van a salir con números seguidos y cada una va a decir con cuál va.',
    )
  }

  /**
   * "SUMAR OTRA MECHA" y "AGREGAR OTRA HERRAMIENTA".
   *
   * Antes de abrir uno nuevo se valida el que está abierto: apilar renglones a
   * medio cargar termina en una nota que no se puede crear y en un vendedor
   * buscando cuál de los seis le falta.
   */
  function sumarRenglon(herramienta: Herramienta | null, servicio = renglon.servicio) {
    if (lugarLibre <= 0) {
      avisarSinLugar()
      return
    }
    setIntentado(true)
    const { valido, errores: e } = validarItemNota(renglon, { pedirServicio })
    setErrores(e as Record<string, string | undefined>)
    if (!valido) return

    // La operación del renglón nuevo la decidió el botón que se tocó, así que
    // no hay nada que volver a preguntar.
    const nuevos = [...items, renglonNuevo(servicio, herramienta, true)]
    setItems(nuevos)
    setActivo(nuevos.length - 1)
    setIntentado(false)
    setErrores({})
  }

  /**
   * "No todas son de la misma medida."
   *
   * Parte el renglón en dos: quedan las mismas herramientas en total, pero cada
   * grupo con su medida, su código de cómputo y su precio. Es la única forma de
   * cotizar bien dos anchos distintos, porque el código sale del ancho.
   *
   * Se separa de a uno: para tres medidas distintas, se vuelve a tocar. Repartir
   * automáticamente en N grupos iguales sería adivinar cuántas van en cada uno.
   */
  function separarPorMedida() {
    const actual = renglon
    const total = Math.max(2, Math.round(aNumero(actual.cantidad)))

    const grupo1 = { ...actual, cantidad: String(total - 1) }
    const grupo2: FormularioItemNota = {
      ...actual,
      cantidad: '1',
      // La medida y todo lo que dependa de ella se limpian: son las que van a
      // ser distintas, y dejarlas copiadas invita a olvidarse de cambiarlas.
      diametro_exterior: '',
      diametro: '',
      ancho_corte: '',
      largo: '',
      ancho: '',
      largo_util: '',
      espesor: '',
      paso: '',
      cantidad_dientes: '',
      codigos_computo: [],
      precio_por_diente: '',
      precio_total: '',
    }

    const nuevos = [...items]
    nuevos.splice(activo, 1, grupo1, grupo2)
    setItems(nuevos)
    setActivo(activo + 1)
    setIntentado(false)
    setErrores({})
  }

  /** Agrega un renglón por cada herramienta marcada en la lista múltiple. */
  function agregarHerramientasElegidas() {
    if (herramientasElegidas.length === 0) return
    // Marcar cinco herramientas cuando quedan dos lugares no puede entrar de
    // prepo: se avisa y no se agrega ninguna, que es más claro que meter las
    // dos primeras y descartar las otras tres sin decirlo.
    if (herramientasElegidas.length > lugarLibre) {
      Alert.alert(
        `No entran ${herramientasElegidas.length} renglones más`,
        lugarLibre <= 0
          ? `La nota ya tiene los ${MAXIMO_RENGLONES} renglones. Cargá el resto en otra nota.`
          : `Queda lugar para ${lugarLibre}. Sacá ${herramientasElegidas.length - lugarLibre} de la selección, o cargá el resto en otra nota.`,
      )
      return
    }
    const nuevos = [
      ...items,
      ...herramientasElegidas.map((hta) => renglonNuevo(renglon.servicio, hta, true)),
    ]
    setItems(nuevos)
    setActivo(items.length)
    setHerramientasElegidas([])
    setSeleccionandoHerramientas(false)
    setIntentado(false)
    setErrores({})
  }

  function irARenglon(i: number) {
    setActivo(i)
    setIntentado(false)
    setErrores({})
  }

  function quitarRenglon(i: number) {
    if (items.length === 1) return
    Alert.alert('Quitar el renglón', resumenRenglon(items[i]), [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Quitar',
        style: 'destructive',
        onPress: () => {
          const restantes = items.filter((_, k) => k !== i)
          setItems(restantes)
          setActivo(Math.min(i <= activo ? Math.max(0, activo - 1) : activo, restantes.length - 1))
          setIntentado(false)
          setErrores({})
        },
      },
    ])
  }

  /**
   * Pasar de página valida SÓLO la que se está dejando.
   *
   * Antes se validaba la nota entera en cada CONTINUAR, así que la primera
   * pantalla marcaba en rojo la condición de venta —un campo que recién
   * aparece en la tercera— y no había forma de avanzar sin ir a buscarlo.
   */
  function alContinuar() {
    setIntentado(true)

    const { valido, errores: e } = validarEncabezadoNota(encabezado, {
      servicios,
      tipoNota,
      fechaEntrega: fechaEntrega ? fechaEntrega.toISOString() : null,
      condicionVenta,
      condicionVentaDetalle: condicionDetalle,
      clienteAMano: CLIENTE_A_MANO,
      partes: PARTES_DEL_PASO[paso],
    })
    setErrores(e as Record<string, string | undefined>)
    if (!valido) return

    // De la segunda página no se sale con renglones a medio cargar: el que
    // falta se resuelve acá, con la herramienta delante, y no tres pantallas
    // después cuando ya no se acuerda cuál era.
    if (paso === 2) {
      const revision = validarRenglones(items, { pedirServicio })
      if (!revision.valido) {
        setActivo(revision.indice)
        setErrores(revision.errores as Record<string, string | undefined>)
        return
      }
    }

    setIntentado(false)
    setErrores({})
    setPaso(paso === 1 ? 2 : 3)
  }

  /** Lo que se manda a la base, igual para crear y para corregir. */
  function datosDeLaNota() {
    return {
      encabezado,
      servicios,
      tipoNota: tipoNota!,
      // Fecha local, no UTC: `toISOString` adelanta el día a partir de las
      // 21:00 en Argentina, así que una nota cargada de noche se guardaba con
      // la entrega un día después de la que el vendedor había elegido —y la
      // pantalla le seguía mostrando la correcta.
      fechaEntrega: fechaLocalISO(fechaEntrega!),
      items,
      tipoCambio: cambioEnUso,
      // La fecha es la del dólar oficial. Si el vendedor puso otro
      // cambio, esa fecha ya no describe de dónde salió el número: se deja
      // en null en vez de atribuirle al oficial un valor que no es suyo.
      cotizacionFecha: cambioPisado ? null : (cotizacion?.fecha ?? null),
      observaciones: observacionesCargadas,
      condicionVenta: condicionVenta!,
      condicionVentaDetalle: condicionDetalle,
    }
  }

  function exigirCotizacion() {
    /**
     * La cotización sólo hace falta si hay algo cotizado en dólares.
     *
     * Antes se exigía siempre, así que una nota de afilado —que va toda en
     * pesos y ni siquiera guarda el tipo de cambio— no se podía crear porque
     * no había cotización.
     */
    if (hayDolares && cambioEnUso <= 0) {
      throw new Error(
        'Esta nota tiene renglones cotizados en dólares y todavía no pudimos traer la cotización. Revisá la señal y tocá "Reintentar" arriba.',
      )
    }
  }

  const guardar = useMutation({
    mutationFn: async () => {
      exigirCotizacion()
      return crearNotaPedido(datosDeLaNota())
    },
    onSuccess: async (notas) => {
      setCreadas(notas.map((n) => n.id))
      await cliente.invalidateQueries()

      // Puede haber salido más de una: afilado y venta no van en el mismo
      // comprobante. Se dice cuáles son y con qué número quedó cada una.
      const detalle = notas
        .map((n) => {
          const numero = n.numero === null ? 'sin número todavía' : `Nº ${String(n.numero).padStart(6, '0')}`
          return `· ${ETIQUETA_GRUPO_NOTA[n.grupo]} — ${numero} — ${formatearPesos(n.total)}`
        })
        .join('\n')

      const sinNumero = notas.some((n) => n.numero === null)
      const aviso = sinNumero
        ? '\n\nEl cliente todavía no tiene código, así que quedan esperando que Administración se lo asigne. El trabajo ya está registrado.'
        : ''

      Alert.alert(
        notas.length === 1 ? 'Nota de pedido creada' : `Se crearon ${notas.length} notas de pedido`,
        `${detalle}${aviso}`,
        [
          {
            text: 'Ver antes de imprimir',
            onPress: () =>
              navigation.navigate('VistaPrevia', { notaIds: notas.map((n) => n.id) }),
          },
          { text: 'Listo', onPress: () => navigation.navigate('NotasPedido') },
        ],
      )
    },
    onError: (e: Error) => Alert.alert('No pudimos crear la nota', e.message),
  })

  const corregir = useMutation({
    mutationFn: async () => {
      exigirCotizacion()
      return corregirNotaPedido({
        ...datosDeLaNota(),
        notaId: notaId!,
        observacionesDelSistema,
      })
    },
    onSuccess: async () => {
      guardado.current = true
      await cliente.invalidateQueries()
      Alert.alert(
        'Nota corregida',
        'Queda guardada con los cambios y sigue pendiente de imprimir. El número no cambió.',
        [
          {
            text: 'Ver cómo quedó',
            onPress: () => navigation.navigate('VistaPrevia', { notaIds: [notaId!] }),
          },
          { text: 'Listo', onPress: () => navigation.navigate('NotasPendientes') },
        ],
      )
    },
    onError: (e: Error) => Alert.alert('No pudimos guardar los cambios', e.message),
  })

  const guardando = guardar.isPending || corregir.isPending

  /**
   * Salir de una corrección con el botón de atrás no puede tirar el trabajo.
   *
   * Corrigiendo, la pantalla arranca llena: el vendedor cambia dos medidas y
   * un precio, toca atrás sin querer —o para cerrar el teclado, que en Android
   * es el mismo botón— y la corrección se pierde entera sin una palabra. La
   * nota no se toca, pero lo tipeado sí.
   *
   * Sólo en corrección: creando, lo que se pierde es un formulario en blanco.
   */
  useEffect(() => {
    if (!corrigiendo || guardado.current) return
    const quitar = navigation.addListener('beforeRemove', (e) => {
      if (guardado.current) return
      e.preventDefault()
      Alert.alert(
        'Dejás la corrección sin guardar',
        `La nota ${numeroDeNota(borrador?.numero ?? null).toLowerCase()} va a quedar como estaba.`,
        [
          { text: 'Seguir corrigiendo', style: 'cancel' },
          {
            text: 'Salir sin guardar',
            style: 'destructive',
            onPress: () => navigation.dispatch(e.data.action),
          },
        ],
      )
    })
    return quitar
  }, [navigation, corrigiendo, borrador?.numero])

  function alCrear() {
    /**
     * La nota ya salió: no se vuelve a crear.
     *
     * Desde la vista previa se puede volver con "Volver y corregir" o con
     * "Listo", y las dos vuelven a esta pantalla, que sigue montada y con el
     * formulario entero cargado. Tocar CREAR de nuevo generaba una segunda nota
     * idéntica, con otro número, que Administración recibía como si fueran dos
     * pedidos distintos.
     */
    if (!corrigiendo && creadas.length > 0) {
      Alert.alert(
        'Esta nota ya se creó',
        'Si querés verla o imprimirla, tocá "VER LA NOTA". Para cargar otro pedido, volvé y empezá una nueva.',
        [
          {
            text: 'Ver la nota',
            onPress: () => navigation.navigate('VistaPrevia', { notaIds: creadas }),
          },
          { text: 'Cerrar', style: 'cancel' },
        ],
      )
      return
    }

    setIntentado(true)

    // Antes de guardar se mira la nota entera, no sólo esta página: desde acá
    // se puede volver atrás y dejar algo sin completar.
    const { valido, errores: eEncabezado } = validarEncabezadoNota(encabezado, {
      servicios,
      tipoNota,
      fechaEntrega: fechaEntrega ? fechaEntrega.toISOString() : null,
      condicionVenta,
      condicionVentaDetalle: condicionDetalle,
      clienteAMano: CLIENTE_A_MANO,
    })

    if (!valido) {
      setErrores(eEncabezado as Record<string, string | undefined>)
      // Se salta a la página donde está el campo que falta: marcarlo en rojo
      // en una pantalla que no se está viendo no le sirve a nadie.
      const faltantes = Object.keys(eEncabezado)
      const destino = ([1, 2, 3] as const).find((p) =>
        PARTES_DEL_PASO[p].some((parte) => CAMPOS_DE_LA_PAGINA[parte].some((c) => faltantes.includes(c))),
      )
      if (destino && destino !== paso) setPaso(destino)
      return
    }

    // Se validan todos, no sólo el que está abierto: el vendedor puede haber
    // dejado a medias uno de más arriba. Si falla, la pantalla salta a ése.
    const revision = validarRenglones(items, { pedirServicio })
    setErrores(revision.errores as Record<string, string | undefined>)
    if (!revision.valido) {
      setActivo(revision.indice)
      setPaso(2)
      return
    }

    if (corrigiendo) corregir.mutate()
    else guardar.mutate()
  }

  const tipoCambio = cambioEnUso
  const totalNota = totalDeRenglones(items, tipoCambio)
  // Cómo se va a repartir todo esto en comprobantes. Se calcula acá, con lo
  // que hay cargado, para poder avisarlo antes de crear y no después.
  const grupos = agruparParaNotas(items, tipoCambio)

  // ── Mientras se trae la nota que se va a corregir ────────────────────────
  if (corrigiendo && !cargado) {
    return (
      <Pantalla>
        <Encabezado alAbrirMenu={() => navigation.navigate('Configuracion')} />
        <Panel contentStyle={estilos.contenido}>
          <BarraPanel alVolver={() => navigation.goBack()} />
          {errorNota ? (
            <Aviso tono="error" titulo="No pudimos abrir la nota">
              Revisá la conexión. La nota sigue guardada tal cual estaba: esto es un problema para
              leerla, no algo que le haya pasado.
            </Aviso>
          ) : (
            <Cargando texto={cargandoNota ? 'Buscando la nota…' : 'Abriendo la nota…'} />
          )}
        </Panel>
      </Pantalla>
    )
  }

  return (
    <Pantalla>
      <Encabezado alAbrirMenu={() => navigation.navigate('Configuracion')} />

      <KeyboardAvoidingView
        style={estilos.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Panel contentStyle={estilos.contenido}>
          <BarraPanel
            alVolver={() => (paso > 1 ? setPaso((paso - 1) as 1 | 2) : navigation.goBack())}
          />

          <TituloPanel>
            {corrigiendo ? 'CORREGIR NOTA\nDE PEDIDO' : 'GENERAR NUEVA\nNOTA DE PEDIDO'}
          </TituloPanel>

          {corrigiendo ? (
            <Aviso tono="info" titulo={numeroDeNota(borrador?.numero ?? null)}>
              Todavía no se imprimió, así que se puede corregir entera. Al guardar se reemplaza lo
              que decía; el número no cambia.
            </Aviso>
          ) : null}

          <View style={estilos.pasos}>
            <Pastilla texto="1 · CLIENTE" color={paso === 1 ? colores.rojo : colores.tintaTenue} />
            <Pastilla
              texto="2 · HERRAMIENTA"
              color={paso === 2 ? colores.rojo : colores.tintaTenue}
            />
            <Pastilla
              texto="3 · FACTURACIÓN"
              color={paso === 3 ? colores.rojo : colores.tintaTenue}
            />
          </View>

          {/* ── 1 · A quién se le hace la nota ──────────────────────────── */}
          {paso === 1 ? (
            <>
              <PasoCliente
                form={encabezado}
                alCambiar={cambiarEncabezado}
                alCrearCliente={() =>
                  navigation.navigate('NuevoCliente', {
                    nombreInicial: encabezado.cliente_nombre,
                    documentoInicial: encabezado.cliente_cuit,
                  })
                }
                errores={errores}
                ubicacionInicial={ubicacionNueva}
                codigoVendedorUsuario={perfil?.codigo_vendedor}
              />

              <BotonSecundario
                titulo={
                  fechaEntrega
                    ? `Entrega: ${formatearFechaCorta(fechaEntrega)}`
                    : 'Elegir fecha de entrega'
                }
                alTocar={() => setCalendario(true)}
              />
              {/* De dónde salió la que está puesta. Sin esto, una fecha que
                  aparece sola se lee como una fecha acordada con el cliente. */}
              <Text style={estilos.porTendencia}>
                Puesta sola a una semana. Cambiala si acordaste otra.
              </Text>
              <MensajeError>{errores.fecha_entrega}</MensajeError>

              {calendario ? (
                <DateTimePicker
                  value={fechaEntrega ?? fechaEntregaPorDefecto()}
                  mode="date"
                  display="calendar"
                  minimumDate={new Date()}
                  onChange={(_e, f) => {
                    setCalendario(false)
                    if (f) {
                      setFechaEntrega(f)
                      if (intentado) revalidarEncabezado(encabezado, servicios)
                    }
                  }}
                />
              ) : null}

              <BotonMenu titulo="CONTINUAR" alTocar={alContinuar} />
            </>
          ) : null}

          {/* ── 2 · Qué trajo el cliente ────────────────────────────────── */}
          {paso === 2 ? (
            <>
              <ResumenCliente encabezado={encabezado} servicios={servicios} tipoNota={null} />

              <PasoOperacion
                form={encabezado}
                alCambiar={cambiarEncabezado}
                servicios={servicios}
                alCambiarServicios={cambiarServicios}
                errores={errores}
              />

              {servicios.length === 0 ? (
                <Aviso tono="atencion" titulo="Falta el tipo de operación">
                  Elegí arriba qué vino a hacer el cliente. De eso dependen los campos que pide cada
                  renglón.
                </Aviso>
              ) : (
                <>
                  {items.length > 1 ? (
                    <View style={estilos.renglones}>
                      <Text style={estilos.renglonesTitulo}>
                        RENGLONES DE LA NOTA · {items.length} de {MAXIMO_RENGLONES}
                      </Text>
                      {items.map((r, i) => (
                        <TarjetaRenglon
                          key={i}
                          indice={i}
                          item={r}
                          pedirServicio={pedirServicio}
                          abierto={i === activo}
                          alEditar={() => irARenglon(i)}
                          alQuitar={() => quitarRenglon(i)}
                        />
                      ))}
                    </View>
                  ) : null}

                  {/* Con una sola operación tildada no hay nada que elegir.
                      Con varias arranca SIN elegir: un renglón que se abre ya
                      resuelto en la primera de la lista es un renglón que
                      nadie mira, y ahí es donde una venta terminaba cargada
                      como afilado. */}
                  {pedirServicio ? (
                    <Desplegable<TipoServicio>
                      etiqueta="ESTE RENGLÓN ES DE"
                      obligatorio
                      marcador="Elegí la operación"
                      valor={renglon.servicio_elegido ? renglon.servicio : null}
                      items={servicios.map((s) => ({
                        valor: s,
                        etiqueta: ETIQUETA_TIPO_SERVICIO[s],
                      }))}
                      alCambiar={cambiarServicioDelRenglon}
                      error={errores.servicio}
                    />
                  ) : null}

                  {pedirServicio && !renglon.servicio_elegido ? (
                    <Aviso tono="info" titulo="Elegí la operación de este renglón">
                      La nota lleva {servicios.length} operaciones y cada renglón va con una. Los
                      campos que hay que completar dependen de cuál sea.
                    </Aviso>
                  ) : (
                    <>
                      {/*
                        La clave remonta el formulario al cambiar de renglón. El
                        buscador de códigos guarda estado propio y arrastrar el de
                        otro renglón sería peor que no mostrar nada.
                      */}
                      {renglon.servicio === 'venta' ? (
                        <FormularioVenta
                          key={activo}
                          item={renglon}
                          alCambiar={cambiarItem}
                          errores={errores}
                          tipoCambio={cambioEnUso}
                        />
                      ) : (
                        <PasoRenglon
                          key={activo}
                          item={renglon}
                          alCambiar={cambiarItem}
                          errores={errores}
                        />
                      )}

                      {/* Cargar otro renglón es lo mismo que cerrar éste: se valida igual. */}
                      {renglon.servicio === 'venta' ? (
                        <BotonSecundario
                          titulo="⊕  AGREGAR OTRO ARTÍCULO"
                          alTocar={() => sumarRenglon(null)}
                        />
                      ) : (
                        <>
                          {/*
                            Varias herramientas de la misma medida entran en un renglón.
                            Medidas distintas, no: cada ancho da un código de cómputo y
                            un precio distintos, así que separarlas es lo único que
                            puede cotizar bien. El botón hace esa separación.
                          */}
                          {aNumero(renglon.cantidad) > 1 && renglon.herramienta ? (
                            <BotonSecundario
                              titulo={`⊘  SEPARAR: NO TODAS SON DE LA MISMA MEDIDA`}
                              alTocar={separarPorMedida}
                            />
                          ) : null}

                          {renglon.herramienta ? (
                            <BotonSecundario
                              titulo={`⊕  ${SUMAR_OTRA[renglon.herramienta]}`}
                              alTocar={() => sumarRenglon(renglon.herramienta)}
                            />
                          ) : null}

                          <BotonSecundario
                            titulo={
                              seleccionandoHerramientas
                                ? '▲  CERRAR LA LISTA'
                                : '⊕  AGREGAR OTRAS HERRAMIENTAS'
                            }
                            alTocar={() => setSeleccionandoHerramientas((v) => !v)}
                          />

                          {seleccionandoHerramientas ? (
                            <View style={estilos.multiple}>
                              <Text style={estilos.multipleTitulo}>
                                Marcá todas las que traiga el cliente. Se agrega un renglón por cada
                                una.
                              </Text>
                              {HERRAMIENTAS_POR_SERVICIO[renglon.servicio].map((hta) => (
                                <Casilla
                                  key={hta}
                                  etiqueta={ETIQUETA_HERRAMIENTA[hta]}
                                  valor={herramientasElegidas.includes(hta)}
                                  alCambiar={(v) =>
                                    setHerramientasElegidas((prev) =>
                                      v ? [...prev, hta] : prev.filter((x) => x !== hta),
                                    )
                                  }
                                />
                              ))}
                              <BotonSecundario
                                titulo={`AGREGAR ${herramientasElegidas.length || ''} RENGLÓN${herramientasElegidas.length === 1 ? '' : 'ES'}`}
                                alTocar={agregarHerramientasElegidas}
                              />
                            </View>
                          ) : null}
                        </>
                      )}

                      {/* ── Renglones de OTRA operación ──────────────────────
                          Los botones de arriba siempre siguen la operación del
                          renglón abierto: estando en una venta, todos agregaban
                          otra venta y no había forma visible de sumar el afilado
                          que el cliente trajo en la misma visita. */}
                      {servicios
                        .filter((s) => s !== renglon.servicio)
                        .map((s) => (
                          <BotonSecundario
                            key={s}
                            titulo={`⊕  AGREGAR RENGLÓN DE ${ETIQUETA_TIPO_SERVICIO[s]}`}
                            alTocar={() => sumarRenglon(null, s)}
                          />
                        ))}
                    </>
                  )}
                </>
              )}

              <BotonMenu titulo="CONTINUAR" alTocar={alContinuar} />
            </>
          ) : null}

          {/* ── 3 · Cómo se cobra ───────────────────────────────────────── */}
          {paso === 3 ? (
            <>
              <ResumenCliente
                encabezado={encabezado}
                servicios={servicios}
                tipoNota={tipoNota}
              />

              <Desplegable<TipoNotaPedido>
                etiqueta="TIPO DE NOTA DE PEDIDO"
                obligatorio
                marcador="Elegí el tipo"
                valor={tipoNota}
                items={[
                  {
                    valor: 'factura',
                    etiqueta: ETIQUETA_TIPO_NOTA.factura,
                    descripcion: 'Sale con el logo de WoodTools',
                  },
                  {
                    valor: 'presupuesto',
                    etiqueta: ETIQUETA_TIPO_NOTA.presupuesto,
                    descripcion: 'Sale sin logo',
                  },
                ]}
                alCambiar={(t) => {
                  setTipoNota(t)
                  if (intentado) revalidarEncabezado(encabezado, servicios)
                }}
                error={errores.tipo_nota}
              />

              {tendencia?.tipo_nota && tipoNota === tendencia.tipo_nota ? (
                <Text style={estilos.porTendencia}>{explicarTendencia(tendencia, 'tipo')}</Text>
              ) : null}

              {/* ── Condición de venta ──────────────────────────────────────
                  Va a la columna del talonario que hasta ahora salía vacía.
                  Es opción cerrada y no texto libre: "ctdo" y "contado" son
                  dos condiciones distintas para cualquier planilla. */}
              <Desplegable<CondicionVenta>
                etiqueta="CONDICIÓN DE VENTA"
                obligatorio
                marcador="Cómo se cobra"
                valor={condicionVenta}
                items={(Object.keys(ETIQUETA_CONDICION_VENTA) as CondicionVenta[]).map((c) => ({
                  valor: c,
                  etiqueta: ETIQUETA_CONDICION_VENTA[c],
                }))}
                alCambiar={(c) => {
                  setCondicionVenta(c)
                  // El detalle es de la opción anterior: no se arrastra.
                  setCondicionDetalle('')
                  if (intentado) revalidarEncabezado(encabezado, servicios)
                }}
                error={errores.condicion_venta}
              />

              {tendencia?.condicion_venta && condicionVenta === tendencia.condicion_venta ? (
                <Text style={estilos.porTendencia}>{explicarTendencia(tendencia, 'condicion')}</Text>
              ) : null}

              {condicionVenta === 'cheque' ? (
                <Campo
                  etiqueta="¿A CUÁNTOS DÍAS?"
                  obligatorio
                  value={condicionDetalle}
                  // Sólo números: es una cantidad de días, no un texto.
                  onChangeText={(t) => {
                    setCondicionDetalle(t.replace(/\D/g, '').slice(0, 2))
                    if (intentado) revalidarEncabezado(encabezado, servicios)
                  }}
                  keyboardType="number-pad"
                  contenedorStyle={estilos.corto}
                  placeholder="30"
                  ayuda={`De 0 a ${DIAS_CHEQUE_MAXIMO} días.`}
                  error={errores.condicion_venta_detalle}
                />
              ) : null}

              {condicionVenta === 'otro' ? (
                <Campo
                  etiqueta="¿CUÁL ES LA CONDICIÓN?"
                  obligatorio
                  value={condicionDetalle}
                  onChangeText={(t) => {
                    setCondicionDetalle(t)
                    if (intentado) revalidarEncabezado(encabezado, servicios)
                  }}
                  placeholder="Ej. Retira y paga en fábrica"
                  error={errores.condicion_venta_detalle}
                />
              ) : null}

              {/* ── Cómo se va a repartir en notas ──────────────────────────
                  El afilado se cobra en pesos y la venta se cotiza en dólares:
                  no pueden ir en el mismo comprobante. Se muestra antes de
                  crear para que no sea una sorpresa al final. */}
              {grupos.length > 1 ? (
                <View style={estilos.grupos}>
                  <Text style={estilos.gruposTitulo}>
                    {corrigiendo
                      ? 'ESTO YA NO ENTRA EN UNA SOLA NOTA'
                      : `ESTO SALE EN ${grupos.length} NOTAS DE PEDIDO`}
                  </Text>
                  {grupos.map((g) => (
                    <View key={g.grupo} style={estilos.grupo}>
                      <View style={estilos.grupoFila}>
                        <Text style={estilos.grupoNombre}>{ETIQUETA_GRUPO_NOTA[g.grupo]}</Text>
                        <Text style={estilos.grupoTotal}>{formatearPesos(g.total)}</Text>
                      </View>
                      <Text style={estilos.grupoDetalle}>
                        {g.items.length} {g.items.length === 1 ? 'renglón' : 'renglones'} ·{' '}
                        {DESCRIPCION_GRUPO_NOTA[g.grupo]}
                      </Text>
                    </View>
                  ))}
                  {corrigiendo ? (
                    <Text style={estilos.grupoDetalle}>
                      Esta nota ya tiene su número y no se puede partir en dos. Sacá de acá lo que
                      no corresponda y cargalo en una nota nueva.
                    </Text>
                  ) : null}
                </View>
              ) : null}

              {/* ── Tipo de cambio ──────────────────────────────────────────
                  Aparece SÓLO cuando hay algo cotizado en dólares. El afilado
                  se cobra en pesos y la nota sale sin cotización impresa: el
                  recuadro ahí no decía nada, y un número grande en otra moneda
                  al lado del total es una invitación a leerlo mal. */}
              {hayDolares ? (
                <View style={estilos.cambio}>
                  <Text style={estilos.cambioRotulo}>TIPO DE CAMBIO</Text>
                  {cargandoCotizacion ? (
                    <Text style={estilos.cambioValor}>Buscando…</Text>
                  ) : cotizacion ? (
                    <>
                      <Text style={estilos.cambioValor}>{formatearPesos(cambioEnUso)}</Text>
                      <Text style={estilos.cambioNota}>
                        {cambioPisado
                          ? `Lo pusiste vos. El oficial del ${formatearFechaCorta(cotizacion.fecha)} es ${formatearPesos(cotizacion.venta)}.`
                          : `Dólar oficial del ${formatearFechaCorta(cotizacion.fecha)}${cotizacion.aproximada ? ' (última disponible)' : ''}`}
                      </Text>

                      {/*
                        El vendedor puede acordar otro cambio con el cliente, y de
                        hecho lo hace. Antes no había dónde ponerlo: la nota se
                        armaba con el oficial y la diferencia se arreglaba después
                        por teléfono, o salía mal cobrada.
                      */}
                      {editandoCambio ? (
                        <View style={estilos.cambioEdicion}>
                          <Campo
                            etiqueta="TIPO DE CAMBIO A USAR"
                            value={cambioPropio}
                            onChangeText={(t) => setCambioPropio(soloNumeros(t))}
                            keyboardType="decimal-pad"
                            placeholder={String(cotizacion.venta)}
                            ayuda={
                              cambioElegido > 0
                                ? `Se va a usar ${formatearPesos(cambioElegido)} en toda la nota.`
                                : 'Dejalo vacío para usar el oficial.'
                            }
                          />
                          <BotonSecundario
                            titulo="Volver al oficial"
                            alTocar={() => {
                              setCambioPropio('')
                              setEditandoCambio(false)
                            }}
                          />
                        </View>
                      ) : (
                        <BotonSecundario
                          titulo="✎  Usar otro tipo de cambio"
                          alTocar={() => setEditandoCambio(true)}
                        />
                      )}
                    </>
                  ) : (
                    <>
                      <Text style={estilos.cambioError}>
                        No pudimos traer la cotización, y esta nota tiene renglones en dólares.
                        Reintentá, o poné el tipo de cambio a mano para poder guardarla.
                      </Text>
                      {/* Sin señal, tipearlo es la única salida: sin esto la nota
                          con dólares quedaba trabada hasta volver a tener red. */}
                      <Campo
                        etiqueta="TIPO DE CAMBIO A USAR"
                        value={cambioPropio}
                        onChangeText={(t) => setCambioPropio(soloNumeros(t))}
                        keyboardType="decimal-pad"
                        ayuda={
                          cambioElegido > 0
                            ? `Se va a usar ${formatearPesos(cambioElegido)} en toda la nota.`
                            : 'Poné el valor que acordaste con el cliente.'
                        }
                      />
                      <BotonSecundario
                        titulo={buscandoCotizacion ? 'Buscando…' : '↻  Reintentar'}
                        alTocar={() => void reintentarCotizacion()}
                        deshabilitado={buscandoCotizacion}
                      />
                    </>
                  )}
                </View>
              ) : null}

              {/* ── Observaciones ──────────────────────────────────────────
                  Van a la columna "Observaciones" del talonario, una por
                  renglón, igual que en el formulario de papel. Sesenta
                  caracteres es lo que entra en esa columna: más no se imprime,
                  se corta, así que se frena acá y no en el papel. */}
              <View style={estilos.observaciones}>
                <Text style={estilos.observacionesTitulo}>OBSERVACIONES</Text>

                {observaciones.map((texto, i) => (
                  <View key={i} style={estilos.observacion}>
                    <Text style={estilos.observacionNumero}>{i + 1}</Text>
                    <Campo
                      value={texto}
                      onChangeText={(t) => escribirObservacion(i, t)}
                      placeholder={i === 0 ? 'Ej. Retira el jueves a la mañana' : ''}
                      maxLength={OBSERVACION_MAXIMO_CARACTERES}
                      contenedorStyle={estilos.observacionCampo}
                    />
                    {observaciones.length > 1 ? (
                      <Pressable
                        onPress={() => quitarObservacion(i)}
                        hitSlop={10}
                        accessibilityRole="button"
                        accessibilityLabel={`Quitar la observación ${i + 1}`}
                      >
                        <Text style={estilos.observacionQuitar}>✕</Text>
                      </Pressable>
                    ) : null}
                  </View>
                ))}

                <Text style={estilos.observacionesAyuda}>
                  Una por renglón, hasta {OBSERVACION_MAXIMO_CARACTERES} caracteres cada una. El
                  renglón siguiente aparece solo.
                </Text>

                {observacionesDelSistema.length > 0 ? (
                  <Text style={estilos.observacionesAyuda}>
                    {observacionesDelSistema.join(' · ')} — lo pone el sistema y se mantiene.
                  </Text>
                ) : null}
              </View>

              {totalNota > 0 ? (
                <Aviso
                  tono="exito"
                  titulo={items.length > 1 ? `Total de la nota · ${items.length} renglones` : 'Total del renglón'}
                >
                  {formatearPesos(totalNota)}
                </Aviso>
              ) : null}

              {intentado && Object.keys(errores).length > 0 ? (
                <Aviso tono="error" titulo="Faltan datos">
                  Revisá los campos marcados en rojo antes de guardar.
                </Aviso>
              ) : null}

              <BotonMenu
                titulo={
                  corrigiendo
                    ? 'GUARDAR LOS\nCAMBIOS'
                    : grupos.length > 1
                      ? `CREAR ${grupos.length}\nNOTAS DE PEDIDO`
                      : 'CREAR NOTA\nDE PEDIDO'
                }
                alTocar={alCrear}
                cargando={guardando}
              />
            </>
          ) : null}
        </Panel>
      </KeyboardAvoidingView>
    </Pantalla>
  )
}

/** Qué se valida al salir de cada página. */
const PARTES_DEL_PASO: Record<1 | 2 | 3, ParteDeLaNota[]> = {
  1: ['cliente'],
  2: ['operacion'],
  3: ['facturacion'],
}

/** Los mismos campos, para poder llevar al vendedor a la página que le falta. */
const CAMPOS_DE_LA_PAGINA: Record<ParteDeLaNota, string[]> = {
  cliente: ['cliente', 'cliente_nombre', 'zona', 'datos_cliente', 'fecha_entrega'],
  operacion: ['servicios'],
  facturacion: ['tipo_nota', 'condicion_venta', 'condicion_venta_detalle'],
}

function numeroDeNota(numero: number | null): string {
  return numero === null
    ? 'Nota sin número todavía'
    : `Nota de pedido Nº ${String(numero).padStart(6, '0')}`
}

/**
 * Con quién es la nota, arriba de las páginas 2 y 3.
 *
 * En la segunda y la tercera el cliente ya no está en pantalla, y cargar seis
 * renglones sin ver a quién se le están cargando es la clase de error que
 * recién se descubre en la impresora.
 */
function ResumenCliente({
  encabezado,
  servicios,
  tipoNota,
}: {
  encabezado: FormularioNotaEncabezado
  servicios: TipoServicio[]
  tipoNota: TipoNotaPedido | null
}) {
  return (
    <View style={estilos.resumen}>
      <Text style={estilos.resumenCliente} numberOfLines={1}>
        {encabezado.cliente_codigo ? `${encabezado.cliente_codigo} · ` : ''}
        {encabezado.cliente_nombre || 'Sin cliente'}
      </Text>
      <View style={estilos.resumenPastillas}>
        {servicios.map((s) => (
          <Pastilla key={s} texto={ETIQUETA_TIPO_SERVICIO[s]} color={colores.rojo} />
        ))}
        {tipoNota ? <Pastilla texto={ETIQUETA_TIPO_NOTA[tipoNota]} color={colores.azul} /> : null}
      </View>
    </View>
  )
}

/**
 * Un renglón ya cargado, en la lista de arriba.
 *
 * Se toca para volver a abrirlo y tiene su ✕ para quitarlo. Los que están
 * incompletos se marcan: si no, el vendedor recién se entera al tocar "CREAR
 * NOTA" y tiene que adivinar cuál de los seis le falta.
 */
function TarjetaRenglon({
  indice,
  item,
  pedirServicio,
  abierto,
  alEditar,
  alQuitar,
}: {
  indice: number
  item: FormularioItemNota
  pedirServicio: boolean
  abierto: boolean
  alEditar: () => void
  alQuitar: () => void
}) {
  const total = totalDelRenglon(item)
  const completo = validarItemNota(item, { pedirServicio }).valido

  return (
    <View style={[estilos.tarjeta, abierto && estilos.tarjetaAbierta]}>
      <Pressable
        onPress={alEditar}
        accessibilityRole="button"
        accessibilityLabel={`Renglón ${indice + 1}: ${resumenRenglon(item)}`}
        accessibilityState={{ selected: abierto }}
        style={({ pressed }) => [estilos.tarjetaCuerpo, pressed && estilos.tocada]}
      >
        <View style={estilos.tarjetaFila}>
          <Text style={estilos.tarjetaNumero}>{indice + 1}</Text>
          <Text style={estilos.tarjetaResumen} numberOfLines={2}>
            {resumenRenglon(item)}
          </Text>
        </View>

        <View style={estilos.tarjetaPie}>
          {item.codigos_computo.map((c) => (
            <Pastilla key={c} texto={c} color={colores.verdeOscuro} />
          ))}
          {!completo ? <Pastilla texto="FALTAN DATOS" color={colores.rojoAccion} /> : null}
          {/* En la moneda del renglón: un total en dólares mostrado con "$"
              se lee como pesos y son mil veces menos plata. */}
          {total > 0 ? (
            <Text style={estilos.tarjetaTotal}>
              {formatearMoneda(total, item.servicio === 'venta' ? item.moneda : 'ARS')}
            </Text>
          ) : null}
        </View>
      </Pressable>

      <Pressable
        onPress={alQuitar}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={`Quitar el renglón ${indice + 1}`}
        style={({ pressed }) => [estilos.quitar, pressed && estilos.tocada]}
      >
        <Text style={estilos.quitarTexto}>✕</Text>
      </Pressable>
    </View>
  )
}

/**
 * Renglón de venta.
 *
 * Es el único que no pide medidas: el código de la herramienta ya la identifica.
 */
function FormularioVenta({
  item,
  alCambiar,
  errores,
  tipoCambio,
}: {
  item: FormularioItemNota
  alCambiar: (c: Partial<FormularioItemNota>) => void
  errores: Record<string, string | undefined>
  tipoCambio: number
}) {
  const unidades = aNumero(item.unidades)
  const unitario = aNumero(item.precio)
  const total = totalDelRenglon(item)
  const enPesos = totalDelRenglonEnPesos(item, tipoCambio)

  // La descripción sale de la herramienta —"SC nueva", "Fresa nueva"— igual
  // que en los renglones de servicio. Lo que el vendedor escriba encima no se
  // pisa nunca: sólo se completa mientras siga siendo la nuestra.
  useEffect(() => {
    const sugerida = descripcionSugerida(item.herramienta, 'venta')
    if (item.descripcion !== sugerida && esDescripcionSugerida(item.descripcion)) {
      alCambiar({ descripcion: sugerida })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.herramienta])

  return (
    <>
      {/*
        Qué se vende no es decorativo: decide en qué nota de pedido cae. Las
        sierras sin fin y las fresas nacionales llevan comprobante propio.
      */}
      <Desplegable<Herramienta>
        etiqueta="QUÉ SE VENDE"
        obligatorio
        marcador="Elegí la herramienta"
        valor={item.herramienta}
        items={HERRAMIENTAS_POR_SERVICIO.venta.map((h) => ({
          valor: h,
          etiqueta: ETIQUETA_HERRAMIENTA[h],
          descripcion:
            h === 'sierra_sin_fin' ? 'Va en una nota de pedido aparte' : undefined,
        }))}
        alCambiar={(h) => alCambiar({ herramienta: h, origen_fresa: null })}
        error={errores.herramienta}
      />

      {item.herramienta === 'fresa' ? (
        <Desplegable<OrigenFresa>
          etiqueta="ORIGEN DE LA FRESA"
          obligatorio
          marcador="Nacional o importada"
          valor={item.origen_fresa}
          items={[
            {
              valor: 'nacional',
              etiqueta: ETIQUETA_ORIGEN_FRESA.nacional,
              descripcion: 'Nota aparte, facturada en pesos',
            },
            {
              valor: 'importada',
              etiqueta: ETIQUETA_ORIGEN_FRESA.importada,
              descripcion: 'Va con el resto de la venta, cotizada en dólares',
            },
          ]}
          alCambiar={(o) => alCambiar({ origen_fresa: o })}
          error={errores.origen_fresa}
        />
      ) : null}

      {/* El código, el precio y las características salen de la lista: no se
          tipean. Era el lugar donde más fácil se equivocaba uno. */}
      <BuscadorArticulo
        item={item}
        alElegir={alCambiar}
        tipoCambio={tipoCambio}
        error={errores.codigo_herramienta}
      />

      <Campo
        etiqueta="DESCRIPCIÓN"
        value={item.descripcion}
        onChangeText={(t) => alCambiar({ descripcion: t })}
        multiline
        numberOfLines={2}
        ayuda="Es la que sale impresa. Corta, para que entre en el renglón del talonario."
      />

      <Campo
        etiqueta="UNIDADES"
        obligatorio
        value={item.unidades}
        onChangeText={(t) => alCambiar({ unidades: soloNumeros(t) })}
        keyboardType="number-pad"
        contenedorStyle={estilos.corto}
        error={errores.unidades}
      />

      {/* Por defecto "no": sólo se habilita el detalle si la marcan. */}
      <Casilla
        etiqueta="PROMOCIÓN"
        valor={item.promocion}
        alCambiar={(v) => alCambiar({ promocion: v, ...(v ? {} : { promocion_detalle: '' }) })}
      />

      {item.promocion ? (
        <Campo
          etiqueta="¿Cuál es la promoción?"
          obligatorio
          value={item.promocion_detalle}
          onChangeText={(t) => alCambiar({ promocion_detalle: t })}
          error={errores.promocion_detalle}
        />
      ) : null}

      {/* Es el precio de UNA unidad, en la moneda de la lista. Antes se
          guardaba como total y tres unidades a $100 se facturaban $100. */}
      <Campo
        etiqueta={item.moneda === 'USD' ? 'PRECIO UNITARIO (US$)' : 'PRECIO UNITARIO'}
        obligatorio
        value={item.precio}
        onChangeText={(t) => alCambiar({ precio: soloNumeros(t) })}
        keyboardType="decimal-pad"
        contenedorStyle={estilos.medio}
        error={errores.precio}
        ayuda={unitario > 0 ? formatearMoneda(unitario, item.moneda) : undefined}
      />

      {total > 0 && unidades > 0 ? (
        <View>
          <Text style={estilos.totalVenta}>
            {`${unidades} × ${formatearMoneda(unitario, item.moneda)} = ${formatearMoneda(total, item.moneda)}`}
          </Text>
          {/* Lo que sale en dólares se cotiza en dólares y así se imprime; el
              equivalente en pesos es de referencia, para el vendedor. */}
          {item.moneda === 'USD' && tipoCambio > 0 ? (
            <Text style={estilos.totalVentaPesos}>
              {`≈ ${formatearPesos(enPesos)} al cambio de hoy`}
            </Text>
          ) : null}
        </View>
      ) : null}
    </>
  )
}

/**
 * De dónde salió el valor preseleccionado, en una línea.
 *
 * Se dice con números —"en 7 de sus últimas 8 notas"— y no con un "habitual" a
 * secas: la diferencia entre una costumbre firme y un empate de dos contra dos
 * es justamente lo que decide si el vendedor lo revisa o lo deja pasar.
 */
function explicarTendencia(t: TendenciaCliente, cual: 'tipo' | 'condicion'): string {
  const veces = cual === 'tipo' ? t.tipo_nota_veces : t.condicion_veces
  if (veces >= t.notas_miradas && t.notas_miradas > 1) {
    return `Puesto solo: es lo que este cliente usa en sus últimas ${t.notas_miradas} notas.`
  }
  if (t.notas_miradas === 1) return 'Puesto solo: es lo que usó en su nota anterior.'
  return `Puesto solo: lo usó en ${veces} de sus últimas ${t.notas_miradas} notas. Cambialo si hoy es distinto.`
}

const estilos = StyleSheet.create({
  flex: { flex: 1 },
  contenido: { gap: espaciado.md },
  corto: { maxWidth: 160 },
  medio: { maxWidth: 220 },

  porTendencia: {
    fontFamily: tipografia.familia.cuerpo,
    fontSize: tipografia.tamano.xs,
    color: colores.tintaSuave,
    marginTop: -espaciado.xs,
  },

  pasos: {
    flexDirection: 'row',
    gap: espaciado.xs,
    justifyContent: 'center',
    flexWrap: 'wrap',
  },

  resumen: {
    backgroundColor: colores.campoBlanco,
    borderWidth: 2,
    borderColor: colores.negro,
    borderRadius: radios.sm,
    padding: espaciado.md,
    gap: espaciado.xs,
  },
  resumenCliente: {
    fontFamily: tipografia.familia.subtitulo,
    fontSize: tipografia.tamano.base,
    color: colores.tinta,
  },
  resumenPastillas: { flexDirection: 'row', gap: espaciado.xs, flexWrap: 'wrap' },

  totalVenta: {
    fontFamily: tipografia.familia.fuerte,
    fontSize: tipografia.tamano.sm,
    color: colores.verdeOscuro,
  },
  totalVentaPesos: {
    fontFamily: tipografia.familia.liviana,
    fontSize: tipografia.tamano.xs,
    color: colores.tintaSuave,
  },

  observaciones: {
    borderWidth: 2,
    borderColor: colores.negro,
    borderRadius: radios.sm,
    backgroundColor: colores.campoBlanco,
    padding: espaciado.md,
    gap: espaciado.xs,
  },
  observacionesTitulo: {
    fontFamily: tipografia.familia.subtitulo,
    fontSize: tipografia.tamano.micro,
    color: colores.rojo,
    letterSpacing: 0.8,
  },
  observacionesAyuda: {
    fontFamily: tipografia.familia.liviana,
    fontSize: tipografia.tamano.micro,
    color: colores.tintaSuave,
  },
  observacion: { flexDirection: 'row', alignItems: 'center', gap: espaciado.sm },
  observacionCampo: { flex: 1 },
  observacionNumero: {
    fontFamily: tipografia.familia.titulo,
    fontSize: tipografia.tamano.xs,
    color: colores.rojo,
    minWidth: 16,
  },
  observacionQuitar: {
    fontFamily: tipografia.familia.fuerte,
    fontSize: tipografia.tamano.base,
    color: colores.rojoAccion,
    paddingHorizontal: espaciado.xs,
  },

  grupos: {
    borderWidth: 2,
    borderColor: colores.azul,
    borderRadius: radios.sm,
    backgroundColor: colores.campoBlanco,
    padding: espaciado.md,
    gap: espaciado.sm,
  },
  gruposTitulo: {
    fontFamily: tipografia.familia.subtitulo,
    fontSize: tipografia.tamano.micro,
    color: colores.azul,
    letterSpacing: 0.8,
  },
  grupo: { gap: 2 },
  grupoFila: { flexDirection: 'row', justifyContent: 'space-between', gap: espaciado.sm },
  grupoNombre: {
    flex: 1,
    fontFamily: tipografia.familia.fuerte,
    fontSize: tipografia.tamano.xs,
    color: colores.tinta,
  },
  grupoTotal: {
    fontFamily: tipografia.familia.fuerte,
    fontSize: tipografia.tamano.xs,
    color: colores.verdeOscuro,
  },
  grupoDetalle: {
    fontFamily: tipografia.familia.liviana,
    fontSize: tipografia.tamano.micro,
    color: colores.tintaSuave,
  },

  multiple: {
    borderWidth: 2,
    borderColor: colores.negro,
    borderRadius: radios.sm,
    backgroundColor: colores.campoBlanco,
    padding: espaciado.md,
    gap: espaciado.xs,
  },
  multipleTitulo: {
    fontFamily: tipografia.familia.liviana,
    fontSize: tipografia.tamano.xs,
    color: colores.tintaSuave,
  },

  renglones: { gap: espaciado.xs },
  renglonesTitulo: {
    fontFamily: tipografia.familia.subtitulo,
    fontSize: tipografia.tamano.micro,
    color: colores.rojo,
    letterSpacing: 0.8,
  },
  tarjeta: {
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: colores.campoBlanco,
    borderWidth: 2,
    borderColor: colores.negro,
    borderRadius: radios.sm,
    overflow: 'hidden',
  },
  tarjetaAbierta: { borderColor: colores.rojo, borderWidth: 3 },
  tarjetaCuerpo: {
    flex: 1,
    paddingHorizontal: espaciado.md,
    paddingVertical: espaciado.sm,
    minHeight: 60,
    justifyContent: 'center',
    gap: espaciado.xs,
  },
  tocada: { opacity: 0.7 },
  tarjetaFila: { flexDirection: 'row', alignItems: 'center', gap: espaciado.sm },
  tarjetaNumero: {
    fontFamily: tipografia.familia.titulo,
    fontSize: tipografia.tamano.base,
    color: colores.rojo,
    minWidth: 20,
  },
  tarjetaResumen: {
    flex: 1,
    fontFamily: tipografia.familia.fuerte,
    fontSize: tipografia.tamano.xs,
    color: colores.tinta,
  },
  tarjetaPie: { flexDirection: 'row', alignItems: 'center', gap: espaciado.xs, flexWrap: 'wrap' },
  tarjetaTotal: {
    marginLeft: 'auto',
    fontFamily: tipografia.familia.fuerte,
    fontSize: tipografia.tamano.xs,
    color: colores.verdeOscuro,
  },
  quitar: {
    width: 52,
    borderLeftWidth: 2,
    borderLeftColor: colores.negro,
    backgroundColor: colores.panelClaro,
    justifyContent: 'center',
    alignItems: 'center',
  },
  quitarTexto: {
    fontFamily: tipografia.familia.fuerte,
    fontSize: tipografia.tamano.base,
    color: colores.rojoAccion,
  },

  cambioEdicion: { gap: espaciado.xs, marginTop: espaciado.sm },
  /**
   * Más chico que antes.
   *
   * Era el recuadro más grande de la pantalla —un número enorme, centrado—
   * cuando en realidad es un dato de referencia: lo que se mira es el total.
   */
  cambio: {
    backgroundColor: colores.panelClaro,
    borderWidth: 2,
    borderColor: colores.negro,
    borderRadius: radios.sm,
    paddingHorizontal: espaciado.md,
    paddingVertical: espaciado.sm,
    alignItems: 'center',
    gap: 2,
  },
  cambioRotulo: {
    fontFamily: tipografia.familia.subtitulo,
    fontSize: tipografia.tamano.micro,
    color: colores.rojo,
    letterSpacing: 0.8,
  },
  cambioValor: {
    fontFamily: tipografia.familia.subtitulo,
    fontSize: tipografia.tamano.base,
    color: colores.tinta,
  },
  cambioNota: {
    fontFamily: tipografia.familia.liviana,
    fontSize: tipografia.tamano.micro,
    color: colores.tintaSuave,
  },
  cambioError: {
    fontFamily: tipografia.familia.cuerpo,
    fontSize: tipografia.tamano.xs,
    color: colores.rojoAccion,
    textAlign: 'center',
  },
})
