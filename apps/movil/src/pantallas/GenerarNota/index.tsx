import {
  aNumero,
  colores,
  ENCABEZADO_VACIO,
  espaciado,
  ETIQUETA_TIPO_NOTA,
  ETIQUETA_TIPO_SERVICIO,
  formatearFechaCorta,
  formatearPesos,
  HERRAMIENTAS_POR_SERVICIO,
  ITEM_VACIO,
  radios,
  renglonNuevo,
  resumenRenglon,
  soloNumeros,
  SUMAR_OTRA,
  tipografia,
  totalDeRenglones,
  validarEncabezadoNota,
  validarItemNota,
  validarRenglones,
  type FormularioItemNota,
  type FormularioNotaEncabezado,
  type Herramienta,
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
import { crearNotaPedido, obtenerCotizacion } from '../../servicios/notasPedido'
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
  })
  const [servicios, setServicios] = useState<TipoServicio[]>([])
  const [tipoNota, setTipoNota] = useState<TipoNotaPedido | null>(null)
  const [fechaEntrega, setFechaEntrega] = useState<Date | null>(null)
  const [calendario, setCalendario] = useState(false)
  const [items, setItems] = useState<FormularioItemNota[]>([ITEM_VACIO])
  /** Cuál de los renglones se está editando. */
  const [activo, setActivo] = useState(0)
  const [errores, setErrores] = useState<Record<string, string | undefined>>({})
  const [intentado, setIntentado] = useState(false)

  const renglon = items[activo] ?? items[0]

  // Al volver de "Generar nuevo cliente" se completa el encabezado solo: el
  // vendedor no tiene que volver a buscar lo que acaba de crear.
  const creadoId = route.params?.clienteCreadoId
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
    navigation.setParams({ clienteCreadoId: undefined })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creadoId])

  const { data: cotizacion, isLoading: cargandoCotizacion } = useQuery({
    queryKey: ['cotizacion-hoy'],
    queryFn: () => obtenerCotizacion(),
    staleTime: 60 * 60 * 1000,
  })

  function cambiarEncabezado(cambios: Partial<FormularioNotaEncabezado>) {
    const nuevo = { ...encabezado, ...cambios }
    setEncabezado(nuevo)
    if (intentado) revalidarEncabezado(nuevo, servicios)
  }

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
    })
    setErrores(e as Record<string, string | undefined>)
  }

  function cambiarItem(cambios: Partial<FormularioItemNota>) {
    const nuevo = { ...renglon, ...cambios }
    setItems((rs) => rs.map((r, i) => (i === activo ? nuevo : r)))
    if (intentado && paso === 2) {
      setErrores(validarItemNota(nuevo).errores as Record<string, string | undefined>)
    }
  }

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
  function sumarRenglon(herramienta: Herramienta | null) {
    setIntentado(true)
    const { valido, errores: e } = validarItemNota(renglon)
    setErrores(e as Record<string, string | undefined>)
    if (!valido) return

    const nuevos = [...items, renglonNuevo(renglon.servicio, herramienta)]
    setItems(nuevos)
    setActivo(nuevos.length - 1)
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
    })
    setErrores(e as Record<string, string | undefined>)
    if (!valido) return
    setIntentado(false)
    setErrores({})
    setPaso(2)
  }

  const guardar = useMutation({
    mutationFn: async () => {
      if (!cotizacion) throw new Error('Todavía no tenemos la cotización del dólar')
      return crearNotaPedido({
        encabezado,
        servicios,
        tipoNota: tipoNota!,
        fechaEntrega: fechaEntrega!.toISOString().slice(0, 10),
        items,
        tipoCambio: cotizacion.venta,
        cotizacionFecha: cotizacion.fecha,
      })
    },
    onSuccess: async (nota) => {
      await cliente.invalidateQueries()
      const sinNumero = nota.numero === null
      Alert.alert(
        sinNumero ? 'Nota guardada, sin número todavía' : 'Nota de pedido creada',
        sinNumero
          ? 'El cliente es nuevo, así que la nota queda esperando que Administración le asigne el código. El trabajo ya quedó registrado.'
          : `Quedó como Nº ${String(nota.numero).padStart(6, '0')}.`,
        [{ text: 'Listo', onPress: () => navigation.navigate('NotasPedido') }],
      )
    },
    onError: (e: Error) => Alert.alert('No pudimos crear la nota', e.message),
  })

  function alCrear() {
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

  const totalNota = totalDeRenglones(items)

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
                    RENGLONES DE LA NOTA · {items.length}
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
                />
              ) : (
                <PasoRenglon
                  key={activo}
                  item={renglon}
                  alCambiar={cambiarItem}
                  errores={errores}
                />
              )}

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
                  <Text style={estilos.cambioError}>
                    No pudimos traer la cotización. Los precios en dólares no se van a convertir.
                  </Text>
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
                  {renglon.herramienta ? (
                    <BotonSecundario
                      titulo={`⊕  ${SUMAR_OTRA[renglon.herramienta]}`}
                      alTocar={() => sumarRenglon(renglon.herramienta)}
                    />
                  ) : null}
                  <BotonSecundario
                    titulo="⊕  AGREGAR OTRA HERRAMIENTA"
                    alTocar={() => sumarRenglon(null)}
                  />
                </>
              )}

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
                titulo={'CREAR NOTA\nDE PEDIDO'}
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
  const total = aNumero(item.precio_total || item.precio)
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
          {total > 0 ? <Text style={estilos.tarjetaTotal}>{formatearPesos(total)}</Text> : null}
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
}: {
  item: FormularioItemNota
  alCambiar: (c: Partial<FormularioItemNota>) => void
  errores: Record<string, string | undefined>
}) {
  return (
    <>
      <Campo
        etiqueta="CÓDIGO HERRAMIENTA"
        obligatorio
        value={item.codigo_herramienta}
        onChangeText={(t) => alCambiar({ codigo_herramienta: t.toUpperCase() })}
        placeholder="Ej. SFUSOL080"
        autoCapitalize="characters"
        error={errores.codigo_herramienta}
      />

      <Campo
        etiqueta="DESCRIPCIÓN"
        value={item.descripcion}
        onChangeText={(t) => alCambiar({ descripcion: t })}
        multiline
        numberOfLines={3}
        ayuda="Se completa sola al elegir el código del catálogo."
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

      <Campo
        etiqueta="PRECIO"
        obligatorio
        value={item.precio}
        onChangeText={(t) => alCambiar({ precio: soloNumeros(t) })}
        keyboardType="decimal-pad"
        contenedorStyle={estilos.medio}
        error={errores.precio}
        ayuda={aNumero(item.precio) > 0 ? formatearPesos(aNumero(item.precio)) : undefined}
      />
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
