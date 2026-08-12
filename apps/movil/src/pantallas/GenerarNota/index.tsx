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
  formatearFechaCorta,
  formatearMoneda,
  fechaLocalISO,
  formatearPesos,
  HERRAMIENTAS_POR_SERVICIO,
  ITEM_VACIO,
  radios,
  MAXIMO_RENGLONES,
  renglonNuevo,
  resumenRenglon,
  soloNumeros,
  SUMAR_OTRA,
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
  type TipoNotaPedido,
  type TipoServicio,
} from '@woodtools/compartido'
import DateTimePicker from '@react-native-community/datetimepicker'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
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
import { Aviso, Pastilla } from '../../componentes/Estado'
import { Encabezado } from '../../componentes/Encabezado'
import { BarraPanel, Pantalla, Panel, TituloPanel } from '../../componentes/Pantalla'
import { usarSesion, etiquetaVendedor } from '../../nucleo/sesion'
import { CLIENTE_A_MANO } from '../../nucleo/variante'
import { crearNotaPedido, obtenerCotizacion } from '../../servicios/notasPedido'
import { BuscadorArticulo } from './BuscadorArticulo'
import { PasoEncabezado } from './Encabezado'
import { PasoRenglon } from './Renglon'
import type { PropsPantalla } from '../../navegacion/tipos'

/**
 * "GENERAR NUEVA NOTA DE PEDIDO"
 *
 * Dos pasos, porque el formulario completo no entra de una en un teléfono y
 * porque el segundo depende de lo que se elija en el primero:
 *
 *   1. Cliente, datos y tipo de servicio.
 *   2. Los renglones, con los campos que pide la herramienta de cada uno.
 *
 * La nota lleva varios renglones, como el talonario de papel. Se edita uno por
 * vez —el resto queda arriba como tarjetas— porque en un teléfono no entran dos
 * formularios abiertos y porque así el vendedor siempre sabe cuál está tocando.
 *
 * El tipo de cambio se trae solo al abrir la pantalla y queda congelado en la
 * nota. No es un dato que el vendedor tenga que averiguar.
 */
export function PantallaGenerarNota({ navigation, route }: PropsPantalla<'GenerarNota'>) {
  const perfil = usarSesion((s) => s.perfil)
  const cliente = useQueryClient()

  const [paso, setPaso] = useState<1 | 2>(1)
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
  const [fechaEntrega, setFechaEntrega] = useState<Date | null>(null)
  const [calendario, setCalendario] = useState(false)
  const [items, setItems] = useState<FormularioItemNota[]>([ITEM_VACIO])
  /** Cuál de los renglones se está editando. */
  const [activo, setActivo] = useState(0)
  const [errores, setErrores] = useState<Record<string, string | undefined>>({})
  const [intentado, setIntentado] = useState(false)
  const [seleccionandoHerramientas, setSeleccionandoHerramientas] = useState(false)
  const [herramientasElegidas, setHerramientasElegidas] = useState<Herramienta[]>([])
  /**
   * Las observaciones van a la columna "Observaciones" del talonario, que hasta
   * ahora salía siempre vacía. Se cargan de a una porque el papel las reparte
   * por renglón: una observación por fila.
   */
  const [observaciones, setObservaciones] = useState<string[]>([])
  const [observacionNueva, setObservacionNueva] = useState('')

  function agregarObservacion() {
    const texto = observacionNueva.trim()
    if (!texto) return
    setObservaciones((o) => [...o, texto])
    setObservacionNueva('')
  }

  /**
   * Lo que quedó escrito en el campo sin tocar "AGREGAR RENGLÓN".
   *
   * Va a la nota igual. Pedirle al vendedor que además de escribir apriete un
   * botón para que lo escrito cuente es una trampa: escribe, crea la nota, y la
   * observación no sale impresa. El botón sigue estando para cargar varias.
   */
  const observacionPendiente = observacionNueva.trim()

  /**
   * Los ids de las notas que ya salieron de esta pantalla.
   *
   * Mientras esté cargado, el botón de crear deja de crear. La pantalla no se
   * desmonta al ir a la vista previa, así que sin esto el formulario queda
   * entero y vivo, listo para generar la misma nota otra vez.
   */
  const [creadas, setCreadas] = useState<string[]>([])

  const renglon = items[activo] ?? items[0]

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
   * ¿Hay algo cotizado en dólares en esta nota?
   *
   * De eso depende que la cotización sea imprescindible. El afilado va siempre
   * en pesos y ni siquiera guarda el tipo de cambio, así que una nota de
   * afilado no tiene por qué quedar trabada porque no haya cotización.
   */
  const hayDolares = items.some((i) => i.moneda === 'USD')

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
    setItems((rs) =>
      rs.map((r) => {
        const servicio = nuevos.includes(r.servicio) ? r.servicio : principal
        const herramienta =
          r.herramienta && HERRAMIENTAS_POR_SERVICIO[servicio].includes(r.herramienta)
            ? r.herramienta
            : null
        if (servicio === r.servicio && herramienta === r.herramienta) return r
        return { ...r, servicio, herramienta, codigos_computo: [] }
      }),
    )
    if (intentado) revalidarEncabezado(encabezado, nuevos)
  }

  function revalidarEncabezado(enc: FormularioNotaEncabezado, servs: TipoServicio[]) {
    const { errores: e } = validarEncabezadoNota(enc, {
      servicios: servs,
      tipoNota,
      fechaEntrega: fechaEntrega ? fechaEntrega.toISOString() : null,
      condicionVenta,
      condicionVentaDetalle: condicionDetalle,
      clienteAMano: CLIENTE_A_MANO,
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
    setErrores(validarItemNota(renglon).errores as Record<string, string | undefined>)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renglon, intentado, paso])

  /** El servicio se elige por renglón cuando arriba tildaron más de uno. */
  function cambiarServicioDelRenglon(servicio: TipoServicio) {
    const herramienta =
      renglon.herramienta && HERRAMIENTAS_POR_SERVICIO[servicio].includes(renglon.herramienta)
        ? renglon.herramienta
        : null
    cambiarItem({ servicio, herramienta, codigos_computo: [] })
  }

  /**
   * "SUMAR OTRA MECHA" y "AGREGAR OTRA HERRAMIENTA".
   *
   * Antes de abrir uno nuevo se valida el que está abierto: apilar renglones a
   * medio cargar termina en una nota que no se puede crear y en un vendedor
   * buscando cuál de los seis le falta.
   */
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

  function sumarRenglon(herramienta: Herramienta | null, servicio = renglon.servicio) {
    if (lugarLibre <= 0) {
      avisarSinLugar()
      return
    }
    setIntentado(true)
    const { valido, errores: e } = validarItemNota(renglon)
    setErrores(e as Record<string, string | undefined>)
    if (!valido) return

    const nuevos = [...items, renglonNuevo(servicio, herramienta)]
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
      ...herramientasElegidas.map((hta) => renglonNuevo(renglon.servicio, hta)),
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

  function alContinuar() {
    setIntentado(true)
    const { valido, errores: e } = validarEncabezadoNota(encabezado, {
      servicios,
      tipoNota,
      fechaEntrega: fechaEntrega ? fechaEntrega.toISOString() : null,
      condicionVenta,
      condicionVentaDetalle: condicionDetalle,
      clienteAMano: CLIENTE_A_MANO,
    })
    setErrores(e as Record<string, string | undefined>)
    if (!valido) return
    setIntentado(false)
    setErrores({})
    setPaso(2)
  }

  const guardar = useMutation({
    mutationFn: async () => {
      /**
       * La cotización sólo hace falta si hay algo cotizado en dólares.
       *
       * Antes se exigía siempre, así que una nota de afilado —que va toda en
       * pesos y ni siquiera guarda el tipo de cambio— no se podía crear porque
       * no había cotización, mientras el cartel de arriba decía justo lo
       * contrario: "los precios en dólares no se van a convertir".
       */
      if (hayDolares && !cotizacion) {
        throw new Error(
          'Esta nota tiene renglones cotizados en dólares y todavía no pudimos traer la cotización. Revisá la señal y tocá "Reintentar" arriba.',
        )
      }

      return crearNotaPedido({
        encabezado,
        servicios,
        tipoNota: tipoNota!,
        // Fecha local, no UTC: `toISOString` adelanta el día a partir de las
        // 21:00 en Argentina, así que una nota cargada de noche se guardaba con
        // la entrega un día después de la que el vendedor había elegido —y la
        // pantalla le seguía mostrando la correcta.
        fechaEntrega: fechaLocalISO(fechaEntrega!),
        items,
        tipoCambio: cotizacion?.venta ?? 0,
        cotizacionFecha: cotizacion?.fecha ?? null,
        // Lo que quedó escrito en el campo y no se agregó con el botón cuenta
        // igual. Antes se descartaba en silencio: el vendedor escribía la
        // observación, creaba la nota, y salía impresa sin ella.
        observaciones: observacionPendiente ? [...observaciones, observacionPendiente] : observaciones,
        condicionVenta: condicionVenta!,
        condicionVentaDetalle: condicionDetalle,
      })
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
    if (creadas.length > 0) {
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
    // Se validan todos, no sólo el que está abierto: el vendedor puede haber
    // dejado a medias uno de más arriba. Si falla, la pantalla salta a ése.
    const { valido, indice, errores: e } = validarRenglones(items)
    setErrores(e as Record<string, string | undefined>)
    if (!valido) {
      setActivo(indice)
      return
    }
    guardar.mutate()
  }

  const tipoCambio = cotizacion?.venta ?? 0
  const totalNota = totalDeRenglones(items, tipoCambio)
  // Cómo se va a repartir todo esto en comprobantes. Se calcula acá, con lo
  // que hay cargado, para poder avisarlo antes de crear y no después.
  const grupos = agruparParaNotas(items, tipoCambio)

  return (
    <Pantalla>
      <Encabezado alAbrirMenu={() => navigation.navigate('Configuracion')} />

      <KeyboardAvoidingView
        style={estilos.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Panel contentStyle={estilos.contenido}>
          <BarraPanel
            alVolver={() => (paso === 2 ? setPaso(1) : navigation.goBack())}
          />

          <TituloPanel>{'GENERAR NUEVA\nNOTA DE PEDIDO'}</TituloPanel>

          <View style={estilos.pasos}>
            <Pastilla
              texto="1 · CLIENTE"
              color={paso === 1 ? colores.rojo : colores.tintaTenue}
            />
            <Pastilla
              texto="2 · HERRAMIENTA"
              color={paso === 2 ? colores.rojo : colores.tintaTenue}
            />
          </View>

          {paso === 1 ? (
            <>
              <PasoEncabezado
                form={encabezado}
                alCambiar={cambiarEncabezado}
                servicios={servicios}
                alCambiarServicios={cambiarServicios}
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

              <BotonSecundario
                titulo={
                  fechaEntrega
                    ? `Entrega: ${formatearFechaCorta(fechaEntrega)}`
                    : 'Elegir fecha de entrega'
                }
                alTocar={() => setCalendario(true)}
              />
              <MensajeError>{errores.fecha_entrega}</MensajeError>

              {calendario ? (
                <DateTimePicker
                  value={fechaEntrega ?? new Date()}
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
          ) : (
            <>
              <View style={estilos.resumen}>
                <Text style={estilos.resumenCliente} numberOfLines={1}>
                  {encabezado.cliente_codigo ? `${encabezado.cliente_codigo} · ` : ''}
                  {encabezado.cliente_nombre}
                </Text>
                <View style={estilos.resumenPastillas}>
                  {servicios.map((s) => (
                    <Pastilla key={s} texto={ETIQUETA_TIPO_SERVICIO[s]} color={colores.rojo} />
                  ))}
                  {tipoNota ? (
                    <Pastilla texto={ETIQUETA_TIPO_NOTA[tipoNota]} color={colores.azul} />
                  ) : null}
                </View>
              </View>

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
                      abierto={i === activo}
                      alEditar={() => irARenglon(i)}
                      alQuitar={() => quitarRenglon(i)}
                    />
                  ))}
                </View>
              ) : null}

              {/* Con un solo servicio tildado no hay nada que elegir. */}
              {servicios.length > 1 ? (
                <Desplegable<TipoServicio>
                  etiqueta="SERVICIO DE ESTE RENGLÓN"
                  obligatorio
                  valor={renglon.servicio}
                  items={servicios.map((s) => ({ valor: s, etiqueta: ETIQUETA_TIPO_SERVICIO[s] }))}
                  alCambiar={cambiarServicioDelRenglon}
                />
              ) : null}

              {/*
                La clave remonta el formulario al cambiar de renglón. El buscador
                de códigos guarda estado propio y arrastrar el de otro renglón
                sería peor que no mostrar nada.
              */}
              {renglon.servicio === 'venta' ? (
                <FormularioVenta
                  key={activo}
                  item={renglon}
                  alCambiar={cambiarItem}
                  errores={errores}
                  tipoCambio={cotizacion?.venta ?? 0}
                />
              ) : (
                <PasoRenglon
                  key={activo}
                  item={renglon}
                  alCambiar={cambiarItem}
                  errores={errores}
                />
              )}

              {/* ── Cómo se va a repartir en notas ──────────────────────────
                  El afilado se cobra en pesos y la venta se cotiza en dólares:
                  no pueden ir en el mismo comprobante. Se muestra antes de
                  crear para que no sea una sorpresa al final. */}
              {grupos.length > 1 ? (
                <View style={estilos.grupos}>
                  <Text style={estilos.gruposTitulo}>
                    ESTO SALE EN {grupos.length} NOTAS DE PEDIDO
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
                </View>
              ) : null}

              {/* El tipo de cambio no se tipea: se trae y se congela en la nota. */}
              <View style={estilos.cambio}>
                <Text style={estilos.cambioRotulo}>TIPO DE CAMBIO</Text>
                {cargandoCotizacion ? (
                  <Text style={estilos.cambioValor}>Buscando…</Text>
                ) : cotizacion ? (
                  <>
                    <Text style={estilos.cambioValor}>{formatearPesos(cotizacion.venta)}</Text>
                    <Text style={estilos.cambioNota}>
                      Dólar oficial del {formatearFechaCorta(cotizacion.fecha)}
                      {cotizacion.aproximada ? ' (última disponible)' : ''}
                    </Text>
                  </>
                ) : (
                  <>
                    {/* Dice lo que pasa DE VERDAD según esta nota. Antes decía
                        siempre "los precios en dólares no se van a convertir",
                        incluso cuando la falta de cotización trababa por
                        completo la creación de la nota. */}
                    <Text style={estilos.cambioError}>
                      {hayDolares
                        ? 'No pudimos traer la cotización, y esta nota tiene renglones en dólares. Hace falta para poder crearla.'
                        : 'No pudimos traer la cotización. Esta nota va toda en pesos, así que se puede crear igual.'}
                    </Text>
                    <BotonSecundario
                      titulo={buscandoCotizacion ? 'Buscando…' : '↻  Reintentar'}
                      alTocar={() => void reintentarCotizacion()}
                      deshabilitado={buscandoCotizacion}
                    />
                  </>
                )}
              </View>

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
                        Marcá todas las que traiga el cliente. Se agrega un renglón por cada una.
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

              {/* ── Renglones de OTRO servicio ──────────────────────────────
                  Los botones de arriba siempre siguen el servicio del renglón
                  abierto: estando en una venta, todos agregaban otra venta y no
                  había forma visible de sumar el afilado que el cliente trajo
                  en la misma visita. Había que agregar un renglón y después
                  cambiarle el servicio con el desplegable de arriba, que nadie
                  encontró. Estos botones hacen las dos cosas de una. */}
              {servicios.filter((s) => s !== renglon.servicio).map((s) => (
                <BotonSecundario
                  key={s}
                  titulo={`⊕  AGREGAR RENGLÓN DE ${ETIQUETA_TIPO_SERVICIO[s]}`}
                  alTocar={() => sumarRenglon(null, s)}
                />
              ))}

              {/* ── Observaciones ──────────────────────────────────────────
                  Van a la columna "Observaciones" del talonario, una por
                  renglón, igual que en el formulario de papel. */}
              <View style={estilos.observaciones}>
                <Text style={estilos.observacionesTitulo}>OBSERVACIONES</Text>

                {observaciones.map((o, i) => (
                  <View key={`${o}-${i}`} style={estilos.observacion}>
                    <Text style={estilos.observacionNumero}>{i + 1}</Text>
                    <Text style={estilos.observacionTexto}>{o}</Text>
                    <Pressable
                      onPress={() => setObservaciones((prev) => prev.filter((_, k) => k !== i))}
                      hitSlop={10}
                      accessibilityRole="button"
                      accessibilityLabel={`Quitar la observación ${i + 1}`}
                    >
                      <Text style={estilos.observacionQuitar}>✕</Text>
                    </Pressable>
                  </View>
                ))}

                <Campo
                  etiqueta=""
                  value={observacionNueva}
                  onChangeText={setObservacionNueva}
                  placeholder="Ej. Retira el jueves a la mañana"
                  multiline
                  numberOfLines={2}
                  onSubmitEditing={agregarObservacion}
                />

                <BotonSecundario titulo="⊕  AGREGAR RENGLÓN" alTocar={agregarObservacion} />
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
                  Revisá los campos marcados en rojo antes de crear la nota.
                </Aviso>
              ) : null}

              <BotonMenu
                titulo={grupos.length > 1 ? `CREAR ${grupos.length}\nNOTAS DE PEDIDO` : 'CREAR NOTA\nDE PEDIDO'}
                alTocar={alCrear}
                cargando={guardar.isPending}
              />
            </>
          )}
        </Panel>
      </KeyboardAvoidingView>
    </Pantalla>
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
  abierto,
  alEditar,
  alQuitar,
}: {
  indice: number
  item: FormularioItemNota
  abierto: boolean
  alEditar: () => void
  alQuitar: () => void
}) {
  const total = totalDelRenglon(item)
  const completo = validarItemNota(item).valido

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

const estilos = StyleSheet.create({
  flex: { flex: 1 },
  contenido: { gap: espaciado.md },
  corto: { maxWidth: 160 },
  medio: { maxWidth: 220 },

  pasos: { flexDirection: 'row', gap: espaciado.sm, justifyContent: 'center' },

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
  observacion: { flexDirection: 'row', alignItems: 'center', gap: espaciado.sm },
  observacionNumero: {
    fontFamily: tipografia.familia.titulo,
    fontSize: tipografia.tamano.xs,
    color: colores.rojo,
    minWidth: 16,
  },
  observacionTexto: {
    flex: 1,
    fontFamily: tipografia.familia.cuerpo,
    fontSize: tipografia.tamano.xs,
    color: colores.tinta,
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

  cambio: {
    backgroundColor: colores.panelClaro,
    borderWidth: 2,
    borderColor: colores.negro,
    borderRadius: radios.sm,
    padding: espaciado.md,
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
    fontFamily: tipografia.familia.titulo,
    fontSize: tipografia.tamano.xl,
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
