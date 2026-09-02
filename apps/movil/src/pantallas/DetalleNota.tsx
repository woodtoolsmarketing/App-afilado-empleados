import {
  espaciado,
  ETIQUETA_ESTADO_NOTA,
  ETIQUETA_HERRAMIENTA,
  ETIQUETA_TIPO_MECHA,
  ETIQUETA_TIPO_NOTA,
  ETIQUETA_TIPO_SERVICIO,
  formatearFechaCorta,
  formatearHora,
  formatearMoneda,
  formatearPesos,
  herramientaEnLaDescripcion,
  numeroDeNotaImpreso,
  radios,
  type EstadoNotaPedido,
  type Herramienta,
  type Paleta,
  type SierraClase,
  type TipoMecha,
  type TipoServicio,
} from '@woodtools/compartido'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Text, View } from 'react-native'

import { BotonMenu, BotonSecundario } from '../componentes/Botones'
import { Aviso, Cargando, Pastilla, Vacio } from '../componentes/Estado'
import { Encabezado } from '../componentes/Encabezado'
import { BarraPanel, Pantalla, Panel, TituloPanel } from '../componentes/Pantalla'
import { imprimirNotas } from '../servicios/impresion'
import {
  encolarImpresion,
  marcarImpresas,
  obtenerNota,
  sePuedeCorregir,
} from '../servicios/notasPedido'
import type { PropsPantalla } from '../navegacion/tipos'
import { hojaDeTema, usarTema } from '../nucleo/tema'

/**
 * Detalle de una nota de pedido.
 *
 * Muestra lo que quedó registrado y deja imprimirla o guardarla como PDF. Es la
 * pantalla a la que se llega tanto desde las pendientes como desde el
 * historial, así que se adapta: una nota ya impresa no ofrece "imprimir" como
 * acción principal.
 */

/** Nombres legibles de las medidas guardadas en `detalle`. */
const ETIQUETA_MEDIDA: Record<string, string> = {
  diametro_exterior: 'Diámetro exterior',
  diametro: 'Diámetro',
  ancho_corte: 'Ancho de corte',
  largo: 'Largo',
  ancho: 'Ancho',
  largo_util: 'Largo útil',
  espesor: 'Espesor',
  paso: 'Paso',
  mano: 'Mano',
  /**
   * El texto libre de la promoción, que ya no se carga.
   *
   * Se queda para las notas emitidas antes de que la promoción pasara a ser un
   * porcentaje: siguen teniendo su "llevando 3" adentro de `detalle`, y sin
   * esta etiqueta el detalle lo mostraría con el nombre crudo de la clave.
   */
  promocion_detalle: 'Promoción',
}

interface ItemNota {
  id: string
  orden: number
  servicio: TipoServicio
  herramienta: Herramienta | null
  codigo_herramienta: string | null
  descripcion: string | null
  cantidad: number
  cantidad_dientes: number | null
  precio_unitario: number | null
  precio_total: number | null
  /**
   * En qué moneda está cotizado el renglón.
   *
   * La columna siempre vino en la consulta —`select '*, items:...(*)'`— pero
   * esta interfaz no la declaraba y la pantalla imprimía todo con el signo de
   * pesos. Media lista de precios está en dólares, así que un renglón de venta
   * mostraba "Precio unitario $ 258,42" sobre un total de la misma pantalla
   * que decía "$ 391.506,30": el mismo cartel, mil quinientas veces menos
   * plata, y son los números que el vendedor le canta al cliente cuando abre
   * la nota para consultarla.
   */
  moneda: 'ARS' | 'USD' | null
  codigos_computo: string[]
  promocion: boolean
  descuento_porcentaje: number | null
  dientes_rotos: boolean
  detalle: Record<string, unknown>
}

export function PantallaDetalleNota({ navigation, route }: PropsPantalla<'DetalleNota'>) {
  const { colores } = usarTema()
  const estilos = usarEstilos()
  const { notaId } = route.params
  const cliente = useQueryClient()

  const { data: nota, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: ['nota', notaId],
    queryFn: () => obtenerNota(notaId),
  })

  const imprimir = useMutation({
    mutationFn: async (comoPdf: boolean) => {
      const r = await imprimirNotas({ notaIds: [notaId], comoPdf })
      // Sólo se marca cuando la impresora confirmó el trabajo. El diálogo del
      // sistema vuelve apenas se abre, así que por ahí no sabemos si salió el
      // papel o si el vendedor canceló.
      if (r.confirmado) await marcarImpresas([notaId])
      return r
    },
    onSuccess: (r, comoPdf) => {
      void cliente.invalidateQueries()
      Alert.alert(comoPdf ? 'PDF generado' : 'Enviado a la impresora', r.mensaje)
    },
    onError: (e: Error) => Alert.alert('No pudimos imprimir', e.message),
  })

  /**
   * Pedirle a la oficina que la imprima.
   *
   * No se marca nada acá: la nota se sella cuando la PC confirma que el papel
   * salió. Que quede "pendiente" después de tocar el botón no es un error, es
   * lo correcto —todavía no se imprimió—.
   */
  const encolar = useMutation({
    mutationFn: () => encolarImpresion(notaId),
    onSuccess: (r) => {
      void cliente.invalidateQueries()
      Alert.alert(
        r.encolada ? 'Va a la oficina' : 'Ya estaba pedida',
        r.encolada
          ? 'La nota quedó en la cola. La imprimen en la oficina y recién ahí queda marcada como impresa.'
          : (r.motivo ?? 'Ya hay un pedido esperando para esta nota.'),
      )
    },
    onError: (e: Error) => Alert.alert('No pudimos mandarla', e.message),
  })

  if (isLoading) {
    return (
      <Pantalla>
        <Encabezado />
        <Panel>
          <Cargando />
        </Panel>
      </Pantalla>
    )
  }

  /*
    "No pude preguntar" no es "no existe".
    Sin señal la pantalla decía "No encontramos esa nota", que es una respuesta
    sobre la nota y no sobre la conexión: el vendedor podía creer que la nota
    que acababa de cargar se había perdido.
  */
  if (error) {
    return (
      <Pantalla>
        <Encabezado />
        <Panel contentStyle={estilos.contenido}>
          <BarraPanel alVolver={() => navigation.goBack()} />
          <Aviso tono="error" titulo="No pudimos abrir la nota">
            Revisá la conexión. La nota sigue guardada: esto es un problema para leerla, no algo
            que le haya pasado.
          </Aviso>
          <BotonSecundario
            titulo="Reintentar"
            alTocar={() => void refetch()}
            cargando={isRefetching}
          />
        </Panel>
      </Pantalla>
    )
  }

  if (!nota) {
    return (
      <Pantalla>
        <Encabezado />
        <Panel>
          <Vacio titulo="No encontramos esa nota" icono="🔍" />
        </Panel>
      </Pantalla>
    )
  }

  const n = nota as Record<string, any>
  const items: ItemNota[] = (n.items ?? []).slice().sort((a: ItemNota, b: ItemNota) => a.orden - b.orden)
  const sinNumero = n.numero === null
  const estado = n.estado as EstadoNotaPedido
  const yaImpresa = estado === 'impresa' || estado === 'entregada'

  return (
    <Pantalla>
      <Encabezado />

      <Panel contentStyle={estilos.contenido}>
        <BarraPanel
          alVolver={() => navigation.goBack()}
          fecha={new Date(n.creado_en)}
        />

        <TituloPanel>
          {sinNumero
            ? 'NOTA DE PEDIDO'
            : `NOTA DE PEDIDO\nNº ${numeroDeNotaImpreso(n.numero, n.vendedor_numero)}`}
        </TituloPanel>

        {sinNumero ? (
          <Aviso tono="atencion" titulo="Todavía sin número">
            El cliente es nuevo y Administración le tiene que asignar el código. Hasta entonces la
            nota existe y el trabajo está registrado, pero no es un comprobante numerado.
          </Aviso>
        ) : null}

        <View style={estilos.pastillas}>
          {n.tipo_nota ? (
            <Pastilla
              texto={ETIQUETA_TIPO_NOTA[n.tipo_nota as 'factura' | 'presupuesto']}
              color={n.tipo_nota === 'factura' ? colores.azul : colores.tintaSuave}
            />
          ) : null}
          <Pastilla texto={ETIQUETA_ESTADO_NOTA[estado]} color={colorEstado(estado, colores)} />
          {(n.servicios ?? []).map((s: TipoServicio) => (
            <Pastilla key={s} texto={ETIQUETA_TIPO_SERVICIO[s]} color={colores.rojo} />
          ))}
        </View>

        {/* ── Cliente ─────────────────────────────────────────────────────── */}
        <View style={estilos.tarjeta}>
          <Text style={estilos.tarjetaTitulo}>CLIENTE</Text>
          <Text style={estilos.cliente}>{n.cliente_nombre}</Text>
          {n.cliente_codigo ? <Dato etiqueta="Cliente Nº" valor={n.cliente_codigo} /> : null}
          {n.cliente_cuit ? <Dato etiqueta="CUIT" valor={n.cliente_cuit} /> : null}
          {n.zona ? <Dato etiqueta="Zona" valor={n.zona} /> : null}
          <Dato
            etiqueta="Vendedor"
            valor={
              n.vendedor?.codigo_vendedor
                ? `${n.vendedor.nombre_completo} (#${n.vendedor.codigo_vendedor})`
                : (n.vendedor?.nombre_completo ?? '—')
            }
          />
        </View>

        {n.datos_cliente ? (
          <View style={estilos.tarjeta}>
            <Text style={estilos.tarjetaTitulo}>
              DATOS DEL CLIENTE {n.datos_cliente_origen === 'voz' ? '🎤' : ''}
            </Text>
            <Text style={estilos.texto}>{n.datos_cliente}</Text>
          </View>
        ) : null}

        {n.descripcion_herramienta ? (
          <View style={estilos.tarjeta}>
            <Text style={estilos.tarjetaTitulo}>
              DESCRIPCIÓN GENERAL {n.descripcion_herramienta_origen === 'voz' ? '🎤' : ''}
            </Text>
            <Text style={estilos.texto}>{n.descripcion_herramienta}</Text>
          </View>
        ) : null}

        {/* ── Renglones ───────────────────────────────────────────────────── */}
        <Text style={estilos.subtitulo}>HERRAMIENTAS</Text>

        {items.map((i) => (
          <RenglonDetalle key={i.id} item={i} />
        ))}

        {/* ── Cierre ──────────────────────────────────────────────────────── */}
        <View style={estilos.tarjeta}>
          <Dato
            etiqueta="Fecha de entrega"
            valor={n.fecha_entrega ? formatearFechaCorta(`${n.fecha_entrega}T12:00:00`) : '—'}
          />
          <Dato
            etiqueta="Tipo de cambio"
            valor={n.tipo_cambio ? formatearPesos(Number(n.tipo_cambio)) : '—'}
          />
          <Dato
            etiqueta="Emitida"
            valor={`${formatearFechaCorta(n.creado_en)} a las ${formatearHora(n.creado_en)}`}
          />
          {n.total ? (
            <View style={estilos.totalFila}>
              <Text style={estilos.totalRotulo}>TOTAL</Text>
              <Text style={estilos.totalValor}>{formatearPesos(Number(n.total))}</Text>
            </View>
          ) : null}
        </View>

        {yaImpresa ? (
          <Aviso tono="info">
            {`Ya se imprimió el ${formatearFechaCorta(n.impresa_en ?? n.creado_en)}. Podés volver a imprimirla, pero ya no se puede corregir: la fábrica tiene ese comprobante.`}
          </Aviso>
        ) : null}

        {/* Mientras no salió en papel se corrige entera —cliente, renglones y
            precios— en el mismo formulario con que se cargó. */}
        {sePuedeCorregir(estado, n.impresa_en) ? (
          <BotonSecundario
            titulo="✎  CORREGIR ESTA NOTA"
            alTocar={() => navigation.push('GenerarNota', { notaId })}
          />
        ) : null}

        <BotonSecundario
          titulo="👁  Ver antes de imprimir"
          alTocar={() => navigation.navigate('VistaPrevia', { notaIds: [notaId] })}
        />

        {/* El cobro va acá y no adentro del botón de imprimir: se cobra sin
            imprimir nada —una factura de la semana pasada— y se imprime sin
            cobrar. Atarlos obligaba a una de las dos cosas para hacer la otra.
            El comprobante y el cliente viajan puestos: es lo que el vendedor
            tiene delante cuando cobra. */}
        <BotonSecundario
          titulo="💵  COBRÉ ESTA NOTA"
          alTocar={() =>
            navigation.navigate('Cobranzas', {
              notaId,
              clienteId: n.cliente_id ?? null,
              clienteCodigo: n.cliente_codigo ?? null,
              clienteNombre: n.cliente_nombre ?? '',
              tipoComprobante: n.tipo_nota === 'factura' ? 'factura' : 'presupuesto',
            })
          }
        />

        <BotonMenu
          titulo={yaImpresa ? 'VOLVER A IMPRIMIR' : 'IMPRIMIR'}
          subtitulo="Original y duplicado"
          alTocar={() => imprimir.mutate(false)}
          cargando={imprimir.isPending}
        />

        {/* La salida para cuando no hay impresora cerca —que en la calle es
            casi siempre— y para cuando la nota tiene que salir sí o sí igual a
            las demás: el papel lo saca la PC de la oficina, con el mismo
            tamaño de letra todas las veces. */}
        <BotonSecundario
          titulo="🖨  Mandar a imprimir a la oficina"
          alTocar={() => encolar.mutate()}
          cargando={encolar.isPending}
        />

        <BotonSecundario
          titulo="Guardar como PDF"
          alTocar={() => imprimir.mutate(true)}
          cargando={imprimir.isPending}
        />
      </Panel>
    </Pantalla>
  )
}

function RenglonDetalle({ item }: { item: ItemNota }) {
  const { colores } = usarTema()
  const estilos = usarEstilos()
  const medidas = Object.entries(item.detalle ?? {})
    .filter(([k, v]) => ETIQUETA_MEDIDA[k] && v !== '' && v !== null)
    .map(([k, v]) => {
      // El tipo de mecha se guarda como código; acá se muestra legible.
      if (k === 'mano') return [ETIQUETA_MEDIDA[k], String(v)] as const
      return [ETIQUETA_MEDIDA[k], String(v)] as const
    })

  const tipoMecha = item.detalle?.tipo_mecha as TipoMecha | undefined
  // Un incisor se cargó en SIERRAS pero no es una sierra: se anuncia por lo
  // que es, igual que en la hoja impresa.
  const nombra = herramientaEnLaDescripcion(
    item.herramienta,
    (item.detalle?.sierra_clase as SierraClase | undefined) ?? null,
  )

  return (
    <View style={estilos.renglon}>
      <View style={estilos.renglonCabecera}>
        <Text style={estilos.renglonNumero}>{item.orden}</Text>
        <View style={estilos.renglonTitulos}>
          <Text style={estilos.renglonHerramienta}>
            {nombra ? ETIQUETA_HERRAMIENTA[nombra] : 'VENTA'}
            {tipoMecha ? ` · ${ETIQUETA_TIPO_MECHA[tipoMecha]}` : ''}
          </Text>
          <Text style={estilos.renglonServicio}>
            {ETIQUETA_TIPO_SERVICIO[item.servicio]} · {item.cantidad} un.
          </Text>
        </View>
      </View>

      {item.codigo_herramienta ? (
        <Dato etiqueta="Código" valor={item.codigo_herramienta} />
      ) : null}
      {item.descripcion ? <Text style={estilos.renglonDesc}>{item.descripcion}</Text> : null}

      {medidas.length > 0 ? (
        <View style={estilos.medidas}>
          {medidas.map(([etiqueta, valor]) => (
            <View key={etiqueta} style={estilos.medida}>
              <Text style={estilos.medidaEtiqueta}>{etiqueta}</Text>
              <Text style={estilos.medidaValor}>{valor}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {item.codigos_computo?.length > 0 ? (
        <View style={estilos.codigos}>
          {item.codigos_computo.map((c) => (
            <Pastilla key={c} texto={c} color={colores.verdeOscuro} />
          ))}
        </View>
      ) : null}

      {item.cantidad_dientes ? (
        <Dato etiqueta="Dientes" valor={String(item.cantidad_dientes)} />
      ) : null}
      {item.dientes_rotos ? (
        <Pastilla texto="CON DIENTES ROTOS" color={colores.ambarOscuro} />
      ) : null}
      {/* Cuanto, no solo que si. Una pastilla que dice "CON PROMOCION" obliga a
          abrir la nota impresa para saber si fue un 5 o un 65. */}
      {item.promocion ? (
        <Pastilla
          texto={
            item.descuento_porcentaje
              ? `${Number(item.descuento_porcentaje)} % DE DESCUENTO`
              : 'CON PROMOCIÓN'
          }
          color={colores.azul}
        />
      ) : null}

      {item.precio_unitario ? (
        <Dato
          etiqueta="Precio unitario"
          valor={formatearMoneda(Number(item.precio_unitario), monedaDelItem(item))}
        />
      ) : null}
      {item.precio_total ? (
        <View style={estilos.renglonTotal}>
          {/* `precio_total` esta en precio de LISTA: el descuento se aplica
              despues. Con descuento se muestran los dos numeros, porque el de
              arriba tachado sin el de abajo se lee como el importe a cobrar. */}
          {descuentoDelItem(item) > 0 ? (
            <Text style={estilos.renglonTotalLista}>
              {formatearMoneda(Number(item.precio_total), monedaDelItem(item))}
            </Text>
          ) : null}
          <Text style={estilos.renglonTotalValor}>
            {formatearMoneda(
              Number(item.precio_total) * (1 - descuentoDelItem(item) / 100),
              monedaDelItem(item),
            )}
          </Text>
        </View>
      ) : null}
    </View>
  )
}

/** El descuento del renglon, acotado: la base admite hasta 100. */
/**
 * En qué moneda se lee el importe de un renglón.
 *
 * Sólo la venta puede ir en dólares. En un renglón de servicio la moneda es
 * siempre pesos aunque la columna diga otra cosa: queda en dólares de cuando
 * ese renglón era una venta, y el precio guardado ya está en pesos. Es el
 * mismo criterio que usa la pantalla de carga.
 */
function monedaDelItem(item: ItemNota): 'ARS' | 'USD' {
  return item.servicio === 'venta' && item.moneda === 'USD' ? 'USD' : 'ARS'
}

function descuentoDelItem(item: ItemNota): number {
  const n = Number(item.descuento_porcentaje)
  if (!item.promocion || !Number.isFinite(n) || n <= 0) return 0
  return Math.min(n, 100)
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  const estilos = usarEstilos()
  return (
    <View style={estilos.dato}>
      <Text style={estilos.datoEtiqueta}>{etiqueta}</Text>
      <Text style={estilos.datoValor} numberOfLines={2}>
        {valor}
      </Text>
    </View>
  )
}

/**
 * El color va como parametro y no se pide adentro.
 *
 * Esto no es un componente: es una cuenta. Pedirle el tema aca adentro seria
 * llamar a un gancho de React desde una funcion que se invoca en medio de un
 * `map`, y ahi React deja de poder contar cuantos ganchos tiene el dibujado.
 * Se lo pasa el que dibuja, que si es un componente.
 */
function colorEstado(estado: EstadoNotaPedido, colores: Paleta): string {
  switch (estado) {
    case 'pendiente_cliente':
      return colores.ambarOscuro
    case 'impresa':
      return colores.azul
    case 'entregada':
      return colores.verdeOscuro
    case 'anulada':
      return colores.rojoAccion
    default:
      return colores.tintaSuave
  }
}

const usarEstilos = hojaDeTema((t) => ({
  contenido: { gap: espaciado.md },
  pastillas: { flexDirection: 'row', gap: espaciado.xs, flexWrap: 'wrap', justifyContent: 'center' },

  tarjeta: {
    backgroundColor: t.colores.campoBlanco,
    borderWidth: 2,
    borderColor: t.colores.borde,
    borderRadius: radios.sm,
    padding: espaciado.md,
    gap: 2,
  },
  tarjetaTitulo: {
    fontFamily: t.tipografia.familia.subtitulo,
    fontSize: t.tipografia.tamano.micro,
    color: t.colores.rojo,
    letterSpacing: 0.8,
    marginBottom: espaciado.xs,
  },
  cliente: {
    fontFamily: t.tipografia.familia.subtitulo,
    fontSize: t.tipografia.tamano.base,
    color: t.colores.tinta,
    marginBottom: espaciado.xs,
  },
  texto: {
    fontFamily: t.tipografia.familia.cuerpo,
    fontSize: t.tipografia.tamano.sm,
    color: t.colores.tinta,
    lineHeight: t.tipografia.tamano.sm * t.tipografia.interlineado.holgado,
  },

  subtitulo: {
    fontFamily: t.tipografia.familia.subtitulo,
    fontSize: t.tipografia.tamano.sm,
    color: t.colores.tintaSuave,
    letterSpacing: 1,
    marginTop: espaciado.xs,
  },

  renglon: {
    backgroundColor: t.colores.panelClaro,
    borderWidth: 2,
    borderColor: t.colores.borde,
    borderRadius: radios.sm,
    padding: espaciado.md,
    gap: espaciado.xs,
  },
  renglonCabecera: { flexDirection: 'row', alignItems: 'center', gap: espaciado.md },
  renglonNumero: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: t.colores.rojoSolido,
    color: t.colores.blanco,
    textAlign: 'center',
    lineHeight: 32,
    fontFamily: t.tipografia.familia.titulo,
    fontSize: t.tipografia.tamano.sm,
    overflow: 'hidden',
  },
  renglonTitulos: { flex: 1 },
  renglonHerramienta: {
    fontFamily: t.tipografia.familia.subtitulo,
    fontSize: t.tipografia.tamano.sm,
    color: t.colores.tinta,
  },
  renglonServicio: {
    fontFamily: t.tipografia.familia.liviana,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.tintaSuave,
  },
  renglonDesc: {
    fontFamily: t.tipografia.familia.cuerpo,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.tintaSuave,
  },

  medidas: { flexDirection: 'row', flexWrap: 'wrap', gap: espaciado.sm, marginTop: espaciado.xs },
  medida: {
    backgroundColor: t.colores.campoBlanco,
    borderWidth: 1,
    borderColor: t.colores.panelOscuro,
    borderRadius: radios.sm,
    paddingHorizontal: espaciado.sm,
    paddingVertical: 3,
  },
  medidaEtiqueta: {
    fontFamily: t.tipografia.familia.liviana,
    fontSize: t.tipografia.tamano.micro,
    color: t.colores.tintaTenue,
  },
  medidaValor: {
    fontFamily: t.tipografia.familia.fuerte,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.tinta,
  },

  codigos: { flexDirection: 'row', gap: espaciado.xs, flexWrap: 'wrap', marginTop: espaciado.xs },

  renglonTotal: { alignItems: 'flex-end', marginTop: espaciado.xs },
  renglonTotalLista: {
    fontFamily: t.tipografia.familia.liviana,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.tintaTenue,
    textDecorationLine: 'line-through',
  },
  renglonTotalValor: {
    fontFamily: t.tipografia.familia.subtitulo,
    fontSize: t.tipografia.tamano.base,
    color: t.colores.verdeOscuro,
  },

  dato: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: espaciado.md,
    paddingVertical: 3,
  },
  datoEtiqueta: {
    fontFamily: t.tipografia.familia.cuerpo,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.tintaSuave,
  },
  datoValor: {
    flexShrink: 1,
    textAlign: 'right',
    fontFamily: t.tipografia.familia.fuerte,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.tinta,
  },

  totalFila: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 2,
    borderTopColor: t.colores.borde,
    marginTop: espaciado.sm,
    paddingTop: espaciado.sm,
  },
  totalRotulo: {
    fontFamily: t.tipografia.familia.subtitulo,
    fontSize: t.tipografia.tamano.sm,
    color: t.colores.tinta,
    letterSpacing: 1,
  },
  totalValor: {
    fontFamily: t.tipografia.familia.titulo,
    fontSize: t.tipografia.tamano.lg,
    color: t.colores.tinta,
  },
}))
