import {
  aNumero,
  ENCABEZADO_VACIO,
  esRenglonDeArticulo,
  ETIQUETA_HERRAMIENTA,
  ETIQUETA_TIPO_SERVICIO,
  formatearMoneda,
  HERRAMIENTAS_POR_SERVICIO,
  ITEM_VACIO,
  lineaDeServicio,
  MAXIMO_RENGLONES,
  medidasDelTipoDePieza,
  numeroDeNotaImpreso,
  renglonEnBlanco,
  renglonNuevo,
  resumenRenglon,
  SUMAR_OTRA,
  tieneRenglonesEnDolares,
  totalDelRenglon,
  validarEncabezadoNota,
  validarItemNota,
  validarRenglones,
  type CondicionVenta,
  type FormularioItemNota,
  type FormularioNotaEncabezado,
  type Herramienta,
  type TipoNotaPedido,
  type TipoServicio,
} from '@woodtools/compartido'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'

import {
  modificarNotaPedido,
  notaParaCorregir,
  obtenerCotizacion,
} from '../servicios/notasPedido'
import { Aviso, Casilla, Desplegable, MensajeError, Pastilla } from '../componentes/editor-nota/Controles'
import { EditorRenglon } from '../componentes/editor-nota/EditorRenglon'
import { FormularioVenta } from '../componentes/editor-nota/FormularioVenta'
import { ResumenFacturacion } from '../componentes/editor-nota/ResumenFacturacion'
import { SelectorCliente } from '../componentes/editor-nota/SelectorCliente'

/**
 * Editor completo de una nota de pedido, en el panel (admin-only).
 *
 * Es el PORT del editor del celular (apps/movil/src/pantallas/GenerarNota) a
 * React web: mismas tres partes —cliente, renglones, facturación— pero en una
 * sola pantalla (un modal full-screen), porque acá no hace falta el asistente de
 * 3 pasos. La lógica de precios y códigos la pone @woodtools/compartido y el
 * servicio del panel, así que la cotización sale idéntica a la del teléfono.
 *
 * Guarda con `modificar_nota_pedido`, que pasa por encima del papel: una nota ya
 * impresa se puede corregir, pero el ciclo de vida no se toca. El banner avisa
 * que la copia en papel queda distinta y que se puede reimprimir desde la cola.
 */

/** Lo mínimo de la fila de la nota que el editor necesita para el encabezado. */
export interface NotaParaEditar {
  id: string
  numero: number | null
  vendedor_numero: string | null
  estado: string
  impresa_en?: string | null
}

const SERVICIOS_BASE: TipoServicio[] = [
  'venta',
  'afilado',
  'reparacion',
  'rectificado',
  'hermanado',
  'mecanizado',
]

const QUE_ES_LA_OPERACION: Partial<Record<TipoServicio, string>> = {
  venta: 'Se lleva una herramienta nueva',
  afilado: 'Trae una herramienta a afilar',
  reparacion: 'Dientes desafilados o daños a reparar',
  rectificado: 'Corregir la geometría de la pieza',
  hermanado: 'Igualar incisores entre sí',
  rebaje: 'Sólo cuchillas, y sólo si hay afilado',
  reclamo: 'Sobre un trabajo que ya hicimos',
  mecanizado: 'Achicar o agrandar el agujero (sierras y fresas)',
}

export function EditorNota({
  nota,
  alCerrar,
  alGuardado,
}: {
  nota: NotaParaEditar
  alCerrar: () => void
  alGuardado: () => void
}) {
  const notaId = nota.id

  const [encabezado, setEncabezado] = useState<FormularioNotaEncabezado>(ENCABEZADO_VACIO)
  const [servicios, setServicios] = useState<TipoServicio[]>([])
  const [tipoNota, setTipoNota] = useState<TipoNotaPedido | null>(null)
  const [condicionVenta, setCondicionVenta] = useState<CondicionVenta | null>(null)
  const [condicionDetalle, setCondicionDetalle] = useState('')
  const [fechaEntrega, setFechaEntrega] = useState('') // ISO corto YYYY-MM-DD
  const [items, setItems] = useState<FormularioItemNota[]>([ITEM_VACIO])
  const [activo, setActivo] = useState(0)
  const [errores, setErrores] = useState<Record<string, string | undefined>>({})
  const [intentado, setIntentado] = useState(false)
  const [observaciones, setObservaciones] = useState<string[]>([''])
  const [observacionesDelSistema, setObservacionesDelSistema] = useState<string[]>([])
  const [cambioPropio, setCambioPropio] = useState('')
  const [seleccionandoHerramientas, setSeleccionandoHerramientas] = useState(false)
  const [herramientasElegidas, setHerramientasElegidas] = useState<Herramienta[]>([])
  const [cargado, setCargado] = useState(false)
  const [mensaje, setMensaje] = useState<string | null>(null)

  // ── La nota que se está corrigiendo ──────────────────────────────────────
  const {
    data: borrador,
    isLoading: cargandoNota,
    error: errorNota,
  } = useQuery({
    queryKey: ['nota-a-corregir-panel', notaId],
    queryFn: () => notaParaCorregir(notaId),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  })

  useEffect(() => {
    if (!borrador || cargado) return
    setEncabezado(borrador.encabezado)
    setServicios(borrador.servicios)
    setTipoNota(borrador.tipoNota)
    setCondicionVenta(borrador.condicionVenta)
    setCondicionDetalle(borrador.condicionDetalle)
    setFechaEntrega(borrador.fechaEntrega ?? '')
    if (borrador.items.length > 0) setItems(borrador.items)
    setObservaciones([...borrador.observaciones, ''])
    setObservacionesDelSistema(borrador.observacionesDelSistema)
    if (borrador.tipoCambio) setCambioPropio(borrador.tipoCambio)
    setCargado(true)
  }, [borrador, cargado])

  // ── Cotización ────────────────────────────────────────────────────────────
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

  const cambioElegido = aNumero(cambioPropio)
  const cambioEnUso = cambioElegido > 0 ? cambioElegido : (cotizacion?.venta ?? 0)
  const cambioPisado = cambioElegido > 0 && cambioElegido !== cotizacion?.venta
  const hayDolares = tieneRenglonesEnDolares(items)

  const pedirServicio = servicios.length > 1
  const renglon = items[activo] ?? items[0]
  const lugarLibre = MAXIMO_RENGLONES - items.length

  function cambiarEncabezado(cambios: Partial<FormularioNotaEncabezado>) {
    setEncabezado((previo) => ({ ...previo, ...cambios }))
  }

  function cambiarItem(cambios: Partial<FormularioItemNota>) {
    setItems((rs) => rs.map((r, i) => (i === activo ? { ...r, ...cambios } : r)))
  }

  // ── Revalidación en vivo (una sola pasada: encabezado + renglón activo) ────
  // Un solo efecto que mezcla los dos conjuntos de errores: así ninguno pisa al
  // otro (sus claves no se solapan) y los dos se ven sin pelearse por `errores`.
  useEffect(() => {
    if (!intentado) return
    const enc = validarEncabezadoNota(encabezado, {
      servicios,
      tipoNota,
      fechaEntrega: fechaEntrega || null,
      condicionVenta,
      condicionVentaDetalle: condicionDetalle,
      clienteAMano: false,
    })
    const item = renglon
      ? validarItemNota(renglon, { pedirServicio })
      : { errores: {} as Record<string, string> }
    setErrores({ ...(item.errores as Record<string, string>), ...(enc.errores as Record<string, string>) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intentado, encabezado, servicios, tipoNota, fechaEntrega, condicionVenta, condicionDetalle, items, activo])

  // ── Operación (servicios) ──────────────────────────────────────────────────
  function limpiarAlCambiarDeServicio(
    servicio: TipoServicio,
    herramienta: Herramienta | null,
  ): Partial<FormularioItemNota> {
    const deLaOtra: Partial<FormularioItemNota> = esRenglonDeArticulo(servicio)
      ? {
          cantidad: '',
          cantidad_dientes: '',
          precio_por_diente: '',
          precio_total: '',
          dientes_rotos: false,
          dientes_rotos_cantidad: '',
          reparar_dientes: null,
          codigo_reparacion: '',
          precio_reparacion_por_diente: '',
        }
      : {
          unidades: '',
          precio: '',
          codigo_herramienta: '',
          descripcion_catalogo: '',
          moneda: 'ARS',
          origen_fresa: null,
        }
    return {
      herramienta,
      codigos_computo: [],
      sin_cargo: servicio === 'reclamo',
      ...(servicio === 'reclamo'
        ? { promocion: false, descuento: '' }
        : { servicio_reclamado: null }),
      ...deLaOtra,
    }
  }

  function cambiarServicios(nuevos: TipoServicio[]) {
    setServicios(nuevos)
    const principal = nuevos[0] ?? 'afilado'
    const unaSola = nuevos.length === 1
    setItems((rs) =>
      rs.map((r) => {
        const sigue = nuevos.includes(r.servicio)
        const servicio = sigue ? r.servicio : principal
        const elegido = unaSola ? true : sigue && r.servicio_elegido && !renglonEnBlanco(r)
        if (servicio === r.servicio) {
          return elegido === r.servicio_elegido ? r : { ...r, servicio_elegido: elegido }
        }
        const herramienta =
          r.herramienta && HERRAMIENTAS_POR_SERVICIO[servicio].includes(r.herramienta)
            ? r.herramienta
            : null
        return {
          ...r,
          servicio,
          servicio_elegido: elegido,
          ...limpiarAlCambiarDeServicio(servicio, herramienta),
        }
      }),
    )
  }

  function cambiarServicioDelRenglon(servicio: TipoServicio) {
    const herramienta =
      renglon.herramienta && HERRAMIENTAS_POR_SERVICIO[servicio].includes(renglon.herramienta)
        ? renglon.herramienta
        : null
    cambiarItem({
      servicio,
      servicio_elegido: true,
      ...limpiarAlCambiarDeServicio(servicio, herramienta),
    })
  }

  // ── Renglones ───────────────────────────────────────────────────────────────
  function sumarRenglon(herramienta: Herramienta | null, servicio = renglon.servicio) {
    if (lugarLibre <= 0) {
      window.alert(`La nota entra hasta ${MAXIMO_RENGLONES} renglones. Cargá el resto en otra nota.`)
      return
    }
    setIntentado(true)
    const { valido, errores: e } = validarItemNota(renglon, {
      pedirServicio,
      exigirConfirmacionCodigo: false,
    })
    setErrores(e as Record<string, string | undefined>)
    if (!valido) return

    const nuevos = [...items, renglonNuevo(servicio, herramienta, true)]
    setItems(nuevos)
    setActivo(nuevos.length - 1)
    setIntentado(false)
    setErrores({})
  }

  function separarPorMedida() {
    const actual = renglon
    const total = Math.max(2, Math.round(aNumero(actual.cantidad)))
    const totalViejo = aNumero(actual.precio_total)
    const precioGrupo1 =
      totalViejo > 0
        ? String(Math.round(((totalViejo * (total - 1)) / total) * 100) / 100)
        : actual.precio_total

    const grupo1 = { ...actual, cantidad: String(total - 1), precio_total: precioGrupo1 }
    const grupo2: FormularioItemNota = {
      ...actual,
      cantidad: '1',
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
      codigo_confirmado: null,
      precio_por_diente: '',
      precio_total: '',
      ...medidasDelTipoDePieza(actual.herramienta, actual.tipo_pieza),
      dientes_rotos: false,
      dientes_rotos_cantidad: '',
      reparar_dientes: null,
      codigo_reparacion: '',
      precio_reparacion_por_diente: '',
    }

    const nuevos = [...items]
    nuevos.splice(activo, 1, grupo1, grupo2)
    setItems(nuevos)
    setActivo(activo + 1)
    setIntentado(false)
    setErrores({})
  }

  function agregarHerramientasElegidas() {
    if (herramientasElegidas.length === 0) return
    if (herramientasElegidas.length > lugarLibre) {
      window.alert(
        lugarLibre <= 0
          ? `La nota ya tiene los ${MAXIMO_RENGLONES} renglones. Cargá el resto en otra nota.`
          : `Queda lugar para ${lugarLibre}. Sacá ${herramientasElegidas.length - lugarLibre} de la selección.`,
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
    if (!window.confirm(`Quitar el renglón:\n\n${resumenRenglon(items[i])}`)) return
    const restantes = items.filter((_, k) => k !== i)
    setItems(restantes)
    setActivo(Math.min(i <= activo ? Math.max(0, activo - 1) : activo, restantes.length - 1))
    setIntentado(false)
    setErrores({})
  }

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

  const observacionesCargadas = observaciones.filter((o) => o.trim())

  function datosDeLaNota() {
    return {
      notaId,
      encabezado,
      servicios,
      tipoNota: tipoNota!,
      fechaEntrega,
      items,
      tipoCambio: cambioEnUso,
      cotizacionFecha: cambioPisado ? null : (cotizacion?.fecha ?? null),
      observaciones: observacionesCargadas,
      observacionesDelSistema,
      condicionVenta: condicionVenta!,
      condicionVentaDetalle: condicionDetalle,
    }
  }

  function exigirCotizacion() {
    if (hayDolares && cambioEnUso <= 0) {
      throw new Error(
        'Esta nota tiene renglones cotizados en dólares y todavía no pudimos traer la cotización. Reintentá, o poné el tipo de cambio a mano.',
      )
    }
  }

  const guardar = useMutation({
    mutationFn: async () => {
      exigirCotizacion()
      return modificarNotaPedido(datosDeLaNota())
    },
    onSuccess: () => {
      setMensaje(null)
      alGuardado()
    },
    onError: (e: Error) => setMensaje(e.message),
  })

  function alGuardar() {
    setIntentado(true)

    const { valido, errores: eEncabezado } = validarEncabezadoNota(encabezado, {
      servicios,
      tipoNota,
      fechaEntrega: fechaEntrega || null,
      condicionVenta,
      condicionVentaDetalle: condicionDetalle,
      clienteAMano: false,
    })
    if (!valido) {
      setErrores(eEncabezado as Record<string, string | undefined>)
      setMensaje('Faltan datos del cliente o de la facturación. Revisá lo marcado en rojo.')
      return
    }

    const revision = validarRenglones(items, { pedirServicio })
    if (!revision.valido) {
      setErrores(revision.errores as Record<string, string | undefined>)
      setActivo(revision.indice)
      setMensaje('Revisá el renglón marcado: falta completarlo o confirmar el código.')
      return
    }

    setMensaje(null)
    guardar.mutate()
  }

  const titulo =
    nota.numero === null
      ? 'Nota sin número todavía'
      : `Nota de pedido Nº ${numeroDeNotaImpreso(nota.numero, nota.vendedor_numero ?? '')}`

  const conAfilado = servicios.includes('afilado')
  const disponibles: TipoServicio[] = conAfilado
    ? [...SERVICIOS_BASE, 'rebaje', 'reclamo']
    : [...SERVICIOS_BASE, 'reclamo']
  const linea = lineaDeServicio(items)

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.55)',
        display: 'grid',
        placeItems: 'start center',
        zIndex: 60,
        padding: 20,
        overflowY: 'auto',
      }}
      onClick={alCerrar}
    >
      <div
        className="tarjeta"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(1100px, 96vw)', margin: 0 }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
          <h2 style={{ margin: 0 }}>Modificar {titulo}</h2>
          <button onClick={alCerrar}>Cerrar</button>
        </div>

        {nota.impresa_en ? (
          <Aviso tono="atencion" titulo="Esta nota ya se imprimió">
            Vas a cambiar su contenido. La copia en papel que tiene la fábrica queda distinta: hay
            que reimprimirla desde la cola de impresión. El número y el estado no cambian.
          </Aviso>
        ) : (
          <Aviso tono="info" titulo="Modificación de administración">
            Se reemplaza el contenido de la nota. El número y el estado no cambian.
          </Aviso>
        )}

        {mensaje ? (
          <div className="aviso error" role="alert">
            {mensaje}
          </div>
        ) : null}

        {!cargado ? (
          errorNota ? (
            <Aviso tono="error" titulo="No pudimos abrir la nota">
              Revisá la conexión. La nota sigue guardada tal cual estaba.
            </Aviso>
          ) : (
            <p>{cargandoNota ? 'Buscando la nota…' : 'Abriendo la nota…'}</p>
          )
        ) : (
          <>
            {/* ── 1 · Cliente ──────────────────────────────────────────────── */}
            <section className="tarjeta" style={{ background: 'var(--panel-claro)' }}>
              <h2>Cliente</h2>
              <SelectorCliente form={encabezado} alCambiar={cambiarEncabezado} errores={errores} />
              <div className="campo" style={{ maxWidth: 260 }}>
                <label htmlFor="fecha-entrega">Fecha de entrega *</label>
                <input
                  id="fecha-entrega"
                  type="date"
                  value={fechaEntrega}
                  onChange={(e) => setFechaEntrega(e.target.value)}
                  style={errores.fecha_entrega ? { borderColor: 'var(--rojo-accion)' } : undefined}
                />
                <MensajeError>{errores.fecha_entrega}</MensajeError>
              </div>
            </section>

            {/* ── 2 · Renglones ────────────────────────────────────────────── */}
            <section className="tarjeta" style={{ background: 'var(--panel-claro)' }}>
              <h2>Renglones · {items.length} de {MAXIMO_RENGLONES}</h2>

              {/* Descripción general y tipo de operación */}
              <div
                style={{
                  borderLeft: '4px solid var(--verde-oscuro)',
                  background: 'var(--blanco)',
                  borderRadius: 'var(--radio)',
                  padding: '8px 12px',
                  marginBottom: 12,
                }}
              >
                <div style={{ fontSize: 11, color: 'var(--tinta-suave)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Descripción gral. de la herramienta
                </div>
                <div style={{ fontWeight: 700 }}>
                  {linea || <span style={{ color: 'var(--tinta-tenue)', fontWeight: 400 }}>Se arma sola con los renglones.</span>}
                </div>
              </div>

              <div className="campo">
                <label htmlFor="desc-extra">Agregar a la descripción</label>
                <input
                  id="desc-extra"
                  value={encabezado.descripcion_herramienta}
                  onChange={(e) =>
                    cambiarEncabezado({
                      descripcion_herramienta: e.target.value,
                      descripcion_herramienta_origen: 'texto',
                    })
                  }
                  placeholder="Algo más que tenga que saber la fábrica"
                />
              </div>

              <div className="campo">
                <label>Tipo de operación *</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {disponibles.map((s) => {
                    const marcado = servicios.includes(s)
                    return (
                      <label
                        key={s}
                        title={QUE_ES_LA_OPERACION[s]}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          border: `2px solid ${marcado ? 'var(--verde-oscuro)' : 'var(--panel-oscuro)'}`,
                          borderRadius: 'var(--radio)',
                          padding: '6px 10px',
                          cursor: 'pointer',
                          background: marcado ? 'rgba(0,200,83,0.1)' : 'var(--blanco)',
                          textTransform: 'none',
                          margin: 0,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={marcado}
                          onChange={(e) => {
                            const nuevos = e.target.checked
                              ? [...servicios, s]
                              : servicios.filter((x) => x !== s)
                            cambiarServicios(
                              nuevos.includes('afilado') ? nuevos : nuevos.filter((x) => x !== 'rebaje'),
                            )
                          }}
                          style={{ width: 16, height: 16, minHeight: 0, flex: '0 0 auto' }}
                        />
                        <span style={{ fontWeight: 600, fontSize: 13 }}>{ETIQUETA_TIPO_SERVICIO[s]}</span>
                      </label>
                    )
                  })}
                </div>
                {!conAfilado ? (
                  <div className="donde-se-hizo">
                    REBAJE aparece cuando la nota lleva afilado: sólo se rebajan cuchillas que se
                    afilan.
                  </div>
                ) : null}
                <MensajeError>{errores.servicios}</MensajeError>
              </div>

              {servicios.length === 0 ? (
                <Aviso tono="atencion" titulo="Falta el tipo de operación">
                  Elegí arriba qué vino a hacer el cliente. De eso dependen los campos de cada
                  renglón.
                </Aviso>
              ) : (
                <>
                  {items.length > 1 ? (
                    <div style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
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
                    </div>
                  ) : null}

                  {pedirServicio ? (
                    <Desplegable<TipoServicio>
                      etiqueta="Este renglón es de"
                      obligatorio
                      marcador="Elegí la operación"
                      valor={renglon.servicio_elegido ? renglon.servicio : null}
                      items={servicios.map((s) => ({ valor: s, etiqueta: ETIQUETA_TIPO_SERVICIO[s] }))}
                      onChange={cambiarServicioDelRenglon}
                      error={errores.servicio}
                    />
                  ) : null}

                  {pedirServicio && !renglon.servicio_elegido ? (
                    <Aviso tono="info" titulo="Elegí la operación de este renglón">
                      La nota lleva {servicios.length} operaciones y cada renglón va con una.
                    </Aviso>
                  ) : (
                    <div
                      style={{
                        border: '3px solid var(--rojo)',
                        borderRadius: 'var(--radio)',
                        background: 'var(--blanco)',
                        padding: 14,
                      }}
                    >
                      {esRenglonDeArticulo(renglon.servicio) ? (
                        <FormularioVenta
                          key={activo}
                          item={renglon}
                          alCambiar={cambiarItem}
                          errores={errores}
                          tipoCambio={cambioEnUso}
                        />
                      ) : (
                        <EditorRenglon
                          key={activo}
                          item={renglon}
                          alCambiar={cambiarItem}
                          errores={errores}
                          clienteId={encabezado.cliente_id}
                        />
                      )}

                      <div className="acciones" style={{ marginTop: 12 }}>
                        {esRenglonDeArticulo(renglon.servicio) ? (
                          <button type="button" onClick={() => sumarRenglon(renglon.herramienta)}>
                            ⊕ Agregar otro artículo
                          </button>
                        ) : (
                          <>
                            {aNumero(renglon.cantidad) > 1 && renglon.herramienta ? (
                              <button type="button" onClick={separarPorMedida}>
                                ⊘ Separar: no todas son de la misma medida
                              </button>
                            ) : null}
                            {renglon.herramienta ? (
                              <button type="button" onClick={() => sumarRenglon(renglon.herramienta)}>
                                ⊕ {SUMAR_OTRA[renglon.herramienta]}
                              </button>
                            ) : null}
                            <button type="button" onClick={() => setSeleccionandoHerramientas((v) => !v)}>
                              {seleccionandoHerramientas ? '▲ Cerrar la lista' : '⊕ Agregar otras herramientas'}
                            </button>
                          </>
                        )}
                        {servicios
                          .filter((s) => s !== renglon.servicio)
                          .map((s) => (
                            <button key={s} type="button" onClick={() => sumarRenglon(null, s)}>
                              ⊕ Agregar renglón de {ETIQUETA_TIPO_SERVICIO[s]}
                            </button>
                          ))}
                      </div>

                      {seleccionandoHerramientas && !esRenglonDeArticulo(renglon.servicio) ? (
                        <div
                          style={{
                            border: '2px solid var(--panel-oscuro)',
                            borderRadius: 'var(--radio)',
                            padding: 10,
                            marginTop: 10,
                          }}
                        >
                          <p style={{ fontSize: 13, color: 'var(--tinta-suave)', marginTop: 0 }}>
                            Marcá todas las que traiga el cliente. Se agrega un renglón por cada una.
                          </p>
                          {HERRAMIENTAS_POR_SERVICIO[renglon.servicio].map((hta) => (
                            <Casilla
                              key={hta}
                              etiqueta={ETIQUETA_HERRAMIENTA[hta]}
                              valor={herramientasElegidas.includes(hta)}
                              onChange={(v) =>
                                setHerramientasElegidas((prev) =>
                                  v ? [...prev, hta] : prev.filter((x) => x !== hta),
                                )
                              }
                            />
                          ))}
                          <button type="button" className="chico" onClick={agregarHerramientasElegidas}>
                            {herramientasElegidas.length === 1
                              ? 'Agregar 1 renglón'
                              : herramientasElegidas.length === 0
                                ? 'Agregar renglones'
                                : `Agregar ${herramientasElegidas.length} renglones`}
                          </button>
                        </div>
                      ) : null}
                    </div>
                  )}
                </>
              )}
            </section>

            {/* ── 3 · Facturación ──────────────────────────────────────────── */}
            <section className="tarjeta" style={{ background: 'var(--panel-claro)' }}>
              <h2>Facturación</h2>
              <ResumenFacturacion
                tipoNota={tipoNota}
                onTipoNota={setTipoNota}
                condicionVenta={condicionVenta}
                condicionDetalle={condicionDetalle}
                onCondicionVenta={setCondicionVenta}
                onCondicionDetalle={setCondicionDetalle}
                observaciones={observaciones}
                onEscribirObservacion={escribirObservacion}
                onQuitarObservacion={quitarObservacion}
                observacionesDelSistema={observacionesDelSistema}
                items={items}
                tipoCambio={cambioEnUso}
                hayDolares={hayDolares}
                cotizacion={cotizacion}
                cargandoCotizacion={cargandoCotizacion}
                buscandoCotizacion={buscandoCotizacion}
                reintentarCotizacion={() => void reintentarCotizacion()}
                cambioPropio={cambioPropio}
                onCambioPropio={setCambioPropio}
                cambioEnUso={cambioEnUso}
                cambioPisado={cambioPisado}
                errores={errores}
              />
            </section>

            <div className="acciones" style={{ justifyContent: 'flex-end' }}>
              <button onClick={alCerrar}>Cancelar</button>
              <button className="primario" onClick={alGuardar} disabled={guardar.isPending}>
                {guardar.isPending ? 'Guardando…' : 'Guardar los cambios'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/** Un renglón ya cargado, en la lista de arriba (port de TarjetaRenglon). */
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
    <div
      style={{
        display: 'flex',
        alignItems: 'stretch',
        border: `${abierto ? 3 : 2}px solid ${abierto ? 'var(--rojo)' : 'var(--panel-oscuro)'}`,
        borderRadius: 'var(--radio)',
        background: 'var(--blanco)',
        overflow: 'hidden',
      }}
    >
      <button
        type="button"
        onClick={alEditar}
        style={{
          flex: 1,
          textAlign: 'left',
          border: 'none',
          borderRadius: 0,
          background: 'none',
          padding: '8px 12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: 'var(--rojo)', fontWeight: 800, minWidth: 18 }}>{indice + 1}</span>
          <span style={{ fontWeight: 700 }}>{resumenRenglon(item)}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
          {item.codigos_computo.map((c) => (
            <Pastilla key={c} texto={c} color="verde" />
          ))}
          {!completo ? <Pastilla texto="FALTAN DATOS" color="roja" /> : null}
          {total > 0 ? (
            <span style={{ marginLeft: 'auto', fontWeight: 700, color: 'var(--verde-oscuro)' }}>
              {formatearMoneda(total, item.servicio === 'venta' ? item.moneda : 'ARS')}
            </span>
          ) : null}
        </div>
      </button>
      <button
        type="button"
        onClick={alQuitar}
        aria-label={`Quitar el renglón ${indice + 1}`}
        style={{
          width: 48,
          border: 'none',
          borderLeft: '2px solid var(--panel-oscuro)',
          borderRadius: 0,
          background: 'var(--panel-claro)',
          color: 'var(--rojo-accion)',
          fontWeight: 800,
        }}
      >
        ✕
      </button>
    </div>
  )
}
