import {
  espaciado,
  formatearDiaHistorial,
  numeroDeNotaImpreso,
  TOQUE_MINIMO,
} from '@woodtools/compartido'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Pressable, Text, View } from 'react-native'

import { Campo, comparable, Desplegable } from '../componentes/Formulario'
import { Aviso, Cargando, Vacio } from '../componentes/Estado'
import { Encabezado } from '../componentes/Encabezado'
import { BarraPanel, Pantalla, Panel, TituloPanel } from '../componentes/Pantalla'
import { historialNotas, type DiaNotas } from '../servicios/notasPedido'
import { rangoDelPeriodo, type PeriodoHistorial } from '../servicios/jornada'
import type { PropsPantalla } from '../navegacion/tipos'
import { hojaDeTema } from '../nucleo/tema'

/**
 * "HISTORIAL DE NOTAS DE PEDIDO"
 *
 * Acordeón por día, como el historial de visitas: el vendedor no tiene que
 * aprender dos formas de mirar lo mismo.
 *
 * El renglón dice sólo "NOTA DE PEDIDO Nº ______", como en el mockup. Se probó
 * mostrando además tipo, cliente, hora e importe y era peor: son siete renglones
 * por día y el dato que el vendedor busca —el número— quedaba compitiendo con
 * cuatro más. Todo eso está a un toque, en el detalle de la nota.
 */
export function PantallaHistorialNotas({ navigation }: PropsPantalla<'HistorialNotas'>) {
  const estilos = usarEstilos()
  const [periodo, setPeriodo] = useState<PeriodoHistorial>('semana')
  const [abiertos, setAbiertos] = useState<Record<string, boolean>>({})
  const [busqueda, setBusqueda] = useState('')

  /**
   * El primer día arranca abierto. Entrar y ver una pila de títulos sin un solo
   * dato no le dice nada al vendedor; con uno desplegado, además, queda claro
   * que los otros se abren.
   *
   * Se resuelve con `??` en vez de precargar el estado porque los días llegan
   * después de montar la pantalla y cambian al cambiar el período: lo que se
   * recuerda es lo que el vendedor tocó, no lo que había cuando abrió.
   */
  const estaAbierto = (fecha: string, indice: number) => abiertos[fecha] ?? indice === 0

  const { desde, hasta } = rangoDelPeriodo(periodo)

  const { data, isLoading, error } = useQuery({
    queryKey: ['historial-notas', periodo],
    queryFn: () => historialNotas(desde, hasta),
  })

  // Con pocas notas no hace falta buscador; con muchas, encontrar una a ojo
  // entre los días es peor que escribir el número o el cliente. El umbral es
  // el mismo que en PENDIENTES e IMPRESAS.
  const dias = data ?? []
  const totalNotas = dias.reduce((acc, d) => acc + d.detalle.length, 0)
  const mostrarBuscador = totalNotas > 5

  /**
   * El filtro sólo achica lo que YA bajó `historialNotas` para el período
   * elegido —nunca sale a buscar fuera de ese rango— y mira el nombre del
   * cliente aunque el renglón no lo muestre (ver el comentario de arriba
   * sobre por qué la fila calla el nombre): buscarlo sigue siendo la forma
   * más rápida de encontrar la nota, aunque no se lea en pantalla.
   *
   * `cantidad` se recalcula sobre lo filtrado: si no, el lector de pantalla
   * anunciaría "5 notas" en un día donde sólo se ve 1 porque las otras cuatro
   * no coincidieron.
   */
  const filtro = comparable(busqueda)
  const diasVisibles = filtro
    ? dias
        .map((dia) => {
          const detalle = dia.detalle.filter(
            (n) =>
              comparable(n.cliente_nombre).includes(filtro) ||
              comparable(numeroDeNotaImpreso(n.numero, n.vendedor_numero) ?? '').includes(filtro),
          )
          return { ...dia, detalle, cantidad: detalle.length }
        })
        .filter((dia) => dia.detalle.length > 0)
    : dias

  return (
    <Pantalla>
      <Encabezado />

      <Panel contentStyle={estilos.contenido}>
        <BarraPanel alVolver={() => navigation.goBack()} />

        <TituloPanel>{'HISTORIAL DE\nNOTAS DE PEDIDO'}</TituloPanel>

        <Desplegable<PeriodoHistorial>
          etiqueta="PERIODO"
          etiquetaCentrada
          valor={periodo}
          items={[
            { valor: 'semana', etiqueta: 'ÚLTIMA SEMANA' },
            { valor: 'mes', etiqueta: 'MES ANTERIOR' },
            { valor: 'noventa', etiqueta: 'ÚLTIMOS 90 DÍAS' },
          ]}
          // Cambiar de período borra la búsqueda: si no, un filtro puesto para
          // la semana queda pegado sobre otro rango, y si ese rango trae ≤5
          // notas el campo se esconde y no hay con qué borrarlo.
          alCambiar={(p) => {
            setPeriodo(p)
            setBusqueda('')
          }}
        />

        {isLoading ? (
          <Cargando texto="Buscando tus notas…" />
        ) : error ? (
          <Aviso tono="error" titulo="No pudimos cargar el historial">
            Revisá la conexión y volvé a intentar.
          </Aviso>
        ) : !data || data.length === 0 ? (
          <Vacio titulo="Sin notas en este período" detalle="Probá con otro rango." icono="📄" />
        ) : (
          <>
            {mostrarBuscador || filtro ? (
              <Campo
                value={busqueda}
                onChangeText={setBusqueda}
                placeholder="Buscar por cliente o número…"
                autoCorrect={false}
              />
            ) : null}

            {filtro && diasVisibles.length === 0 ? (
              <Aviso tono="info">Ninguna nota coincide con “{busqueda}”.</Aviso>
            ) : null}

            {diasVisibles.map((dia, i) => (
              <DiaAcordeon
                key={dia.fecha}
                dia={dia}
                // Buscando, el día se fuerza abierto: ya viene filtrado a las
                // notas que coinciden, y esconderlas detrás de un acordeón
                // cerrado obligaría a un toque de más para ver lo que se buscó.
                abierto={filtro ? true : estaAbierto(dia.fecha, i)}
                alAlternar={() =>
                  setAbiertos((a) => ({ ...a, [dia.fecha]: !(a[dia.fecha] ?? i === 0) }))
                }
                alElegir={(notaId) => navigation.navigate('DetalleNota', { notaId })}
              />
            ))}
          </>
        )}

        <Text style={estilos.nota}>
          El historial guarda los últimos 90 días. Lo anterior lo consultan los administradores
          desde el panel de escritorio.
        </Text>
      </Panel>
    </Pantalla>
  )
}

function DiaAcordeon({
  dia,
  abierto,
  alAlternar,
  alElegir,
}: {
  dia: DiaNotas
  abierto: boolean
  alAlternar: () => void
  alElegir: (notaId: string) => void
}) {
  const estilos = usarEstilos()
  return (
    <View style={estilos.dia}>
      <Pressable
        onPress={alAlternar}
        accessibilityRole="button"
        accessibilityState={{ expanded: abierto }}
        // El conteo sale de la pantalla pero no del lector: es el único lugar
        // donde alguien que no ve la lista se entera de cuántas hay.
        accessibilityLabel={`${formatearDiaHistorial(dia.fecha)}, ${dia.cantidad} ${dia.cantidad === 1 ? 'nota' : 'notas'}`}
        style={({ pressed }) => [estilos.diaCabecera, pressed && estilos.tocado]}
      >
        <Text style={estilos.diaTitulo}>{formatearDiaHistorial(dia.fecha)}</Text>
        <Text style={estilos.flecha}>{abierto ? '▲' : '▼'}</Text>
      </Pressable>

      {abierto ? (
        <View style={estilos.diaCuerpo}>
          {dia.detalle.map((n) => (
            <Pressable
              key={n.nota_id}
              onPress={() => alElegir(n.nota_id)}
              accessibilityRole="button"
              accessibilityLabel={
                n.numero === null
                  ? `Nota de pedido sin número todavía, ${n.cliente_nombre}`
                  : `Nota de pedido ${numeroDeNotaImpreso(n.numero, n.vendedor_numero)}, ${n.cliente_nombre}`
              }
              style={({ pressed }) => [estilos.renglon, pressed && estilos.tocado]}
            >
              <Text style={[estilos.renglonTexto, n.numero === null && estilos.renglonPendiente]}>
                {/* Sin código de cliente todavía no es un comprobante: va apagada
                    y con los mismos guiones que en pendientes y en el talonario. */}
                {n.numero === null
                  ? '- NOTA DE PEDIDO — — —'
                  : `- NOTA DE PEDIDO Nº ${numeroDeNotaImpreso(n.numero, n.vendedor_numero)}`}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  )
}

const usarEstilos = hojaDeTema((t) => ({
  contenido: { gap: espaciado.md },

  // Sin caja ni recuadro: en el mockup el título del día es texto suelto sobre
  // el panel, y el acordeón se lee como una lista y no como una pila de cajas.
  dia: {},
  diaCabecera: {
    flexDirection: 'row',
    alignItems: 'center',
    // El triángulo va pegado al nombre del día, no contra el borde derecho.
    gap: espaciado.sm,
    paddingVertical: espaciado.xs,
    minHeight: TOQUE_MINIMO,
  },
  tocado: { opacity: 0.7 },
  diaTitulo: {
    fontFamily: t.tipografia.familia.subtitulo,
    fontSize: t.tipografia.tamano.xl,
    color: t.colores.tinta,
    letterSpacing: 0.4,
  },
  flecha: { fontSize: t.tipografia.tamano.lg, color: t.colores.tintaSuave },

  diaCuerpo: { paddingBottom: espaciado.xs },
  renglon: {
    justifyContent: 'center',
    // Los renglones van apretados como en el mockup —son siete por día— pero
    // se tocan para abrir la nota, así que no bajan del piso de Android.
    minHeight: 48,
  },
  renglonTexto: {
    fontFamily: t.tipografia.familia.fuerte,
    fontSize: t.tipografia.tamano.base,
    color: t.colores.tinta,
  },
  renglonPendiente: { color: t.colores.tintaTenue },
  nota: {
    fontFamily: t.tipografia.familia.liviana,
    fontSize: t.tipografia.tamano.micro,
    color: t.colores.tintaTenue,
    textAlign: 'center',
    marginTop: espaciado.sm,
  },
}))
