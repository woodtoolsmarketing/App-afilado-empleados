import {
  espaciado,
  formatearDiaHistorial,
  formatearFechaCorta,
  formatearHora,
  TOQUE_MINIMO,
  type Paleta,
} from '@woodtools/compartido'
import DateTimePicker from '@react-native-community/datetimepicker'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Pressable, Text, View } from 'react-native'

import { BotonSecundario } from '../componentes/Botones'
import { Desplegable } from '../componentes/Formulario'
import { Aviso, Cargando, Vacio } from '../componentes/Estado'
import { Encabezado } from '../componentes/Encabezado'
import { BarraPanel, Pantalla, Panel, TituloPanel } from '../componentes/Pantalla'
import {
  obtenerHistorial,
  type DetalleHistorial,
  type DiaHistorial,
  type PeriodoHistorial,
} from '../servicios/jornada'
import type { PropsPantalla } from '../navegacion/tipos'
import { hojaDeTema, usarTema } from '../nucleo/tema'

/**
 * "HISTORIAL DE VISITAS"
 *
 * Un acordeón por día. Cada renglón muestra el cliente y cuándo se cerró la
 * visita; al tocarlo se abre el detalle completo con las observaciones.
 *
 * El tope de 90 días no es sólo de la interfaz: la función `historial_visitas`
 * de Postgres le recorta el rango a los vendedores aunque pidan más atrás. Lo
 * anterior a esa ventana vive en los Excel del bucket privado, al que sólo
 * llegan los administradores.
 */
export function PantallaHistorial({ navigation }: PropsPantalla<'Historial'>) {
  const estilos = usarEstilos()
  const [periodo, setPeriodo] = useState<PeriodoHistorial>('semana')
  const [desde, setDesde] = useState(() => new Date(Date.now() - 7 * 86_400_000))
  const [hasta, setHasta] = useState(() => new Date())
  const [calendario, setCalendario] = useState<'desde' | 'hasta' | null>(null)
  const [abiertos, setAbiertos] = useState<Record<string, boolean>>({})

  /**
   * El primer día arranca abierto, igual que en el historial de notas: entrar y
   * ver una pila de títulos sin un solo dato no le dice nada al vendedor.
   * Se resuelve con `??` porque los días llegan después de montar la pantalla y
   * cambian con el período: lo que se recuerda es lo que el vendedor tocó.
   */
  const estaAbierto = (clave: string, indice: number) => abiertos[clave] ?? indice === 0

  const { data, isLoading, error } = useQuery({
    queryKey: ['historial', periodo, desde.toDateString(), hasta.toDateString()],
    queryFn: () => obtenerHistorial(periodo, { desde, hasta }),
  })

  return (
    <Pantalla>
      <Encabezado />

      <Panel contentStyle={estilos.contenido}>
        <BarraPanel alVolver={() => navigation.goBack()} />

        <TituloPanel>{'HISTORIAL\nDE VISITAS'}</TituloPanel>

        <Desplegable<PeriodoHistorial>
          etiqueta="PERIODO"
          etiquetaCentrada
          valor={periodo}
          items={[
            { valor: 'semana', etiqueta: 'ÚLTIMA SEMANA' },
            { valor: 'mes', etiqueta: 'MES ANTERIOR' },
            { valor: 'noventa', etiqueta: 'ÚLTIMOS 90 DÍAS' },
            { valor: 'personalizado', etiqueta: 'PERSONALIZADO' },
          ]}
          alCambiar={setPeriodo}
        />

        {periodo === 'personalizado' ? (
          <View style={estilos.rango}>
            <BotonSecundario
              titulo={`Desde: ${formatearFechaCorta(desde)}`}
              alTocar={() => setCalendario('desde')}
              style={estilos.mitad}
            />
            <BotonSecundario
              titulo={`Hasta: ${formatearFechaCorta(hasta)}`}
              alTocar={() => setCalendario('hasta')}
              style={estilos.mitad}
            />
          </View>
        ) : null}

        {calendario ? (
          <DateTimePicker
            value={calendario === 'desde' ? desde : hasta}
            mode="date"
            display="calendar"
            maximumDate={new Date()}
            // Los vendedores no pueden mirar más atrás de la ventana de retención.
            minimumDate={new Date(Date.now() - 90 * 86_400_000)}
            onChange={(_evento, fecha) => {
              setCalendario(null)
              if (!fecha) return
              if (calendario === 'desde') setDesde(fecha)
              else setHasta(fecha)
            }}
          />
        ) : null}

        {isLoading ? (
          <Cargando texto="Buscando tu historial…" />
        ) : error ? (
          <Aviso tono="error" titulo="No pudimos cargar el historial">
            Revisá la conexión y volvé a intentar.
          </Aviso>
        ) : !data || data.length === 0 ? (
          <Vacio
            titulo="Sin visitas en este período"
            detalle="Probá con otro rango de fechas."
            icono="📅"
          />
        ) : (
          data.map((dia, i) => (
            <DiaAcordeon
              key={dia.rol_visita_id}
              dia={dia}
              abierto={estaAbierto(dia.rol_visita_id, i)}
              alAlternar={() =>
                setAbiertos((a) => ({
                  ...a,
                  [dia.rol_visita_id]: !(a[dia.rol_visita_id] ?? i === 0),
                }))
              }
              alElegir={(detalle) =>
                navigation.navigate('DetalleVisita', {
                  rolVisitaId: dia.rol_visita_id,
                  paradaId: detalle.parada_id,
                  fecha: dia.fecha,
                })
              }
            />
          ))
        )}

        <Text style={estilos.nota}>
          El historial guarda los últimos 90 días. Lo anterior queda archivado y lo consultan los
          administradores desde el panel de escritorio.
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
  dia: DiaHistorial
  abierto: boolean
  alAlternar: () => void
  alElegir: (detalle: DetalleHistorial) => void
}) {
  const { colores } = usarTema()
  const estilos = usarEstilos()
  const detalle = (dia.detalle ?? []).filter((d) => d.parada_id)

  return (
    <View style={estilos.dia}>
      <Pressable
        onPress={alAlternar}
        accessibilityRole="button"
        accessibilityState={{ expanded: abierto }}
        accessibilityLabel={`${formatearDiaHistorial(dia.fecha)}, ${dia.total_paradas} destinos`}
        style={({ pressed }) => [estilos.diaCabecera, pressed && estilos.tocado]}
      >
        <Text style={estilos.diaTitulo}>{formatearDiaHistorial(dia.fecha)}</Text>
        <Text style={estilos.flecha}>{abierto ? '▲' : '▼'}</Text>
        <Text style={estilos.diaConteo}>
          {dia.visitadas}/{dia.total_paradas}
        </Text>
      </Pressable>

      {abierto ? (
        <View style={estilos.diaCuerpo}>
          {detalle.length === 0 ? (
            <Text style={estilos.sinDatos}>Sin destinos cargados ese día.</Text>
          ) : (
            detalle.map((d) => (
              <Pressable
                key={d.parada_id}
                onPress={() => alElegir(d)}
                accessibilityRole="button"
                accessibilityLabel={`${d.cliente}, ${textoEstado(d)}`}
                style={({ pressed }) => [estilos.renglon, pressed && estilos.tocado]}
              >
                <View style={[estilos.punto, { backgroundColor: colorRenglon(d, colores) }]} />
                <Text style={estilos.renglonTexto} numberOfLines={2}>
                  <Text style={estilos.renglonCliente}>{d.cliente}: </Text>
                  {textoEstado(d)}
                </Text>
              </Pressable>
            ))
          )}
        </View>
      ) : null}
    </View>
  )
}

function textoEstado(d: DetalleHistorial): string {
  if (d.visitado === true) {
    const acciones = [
      d.vendio && 'vendió',
      d.cobro && 'cobró',
      d.retiro_afilado && 'retiró afilado',
      d.entrego && 'entregó',
    ].filter(Boolean)
    const hecho = acciones.length > 0 ? acciones.join(', ') : 'visitado'
    return `${hecho[0].toUpperCase()}${hecho.slice(1)} el ${new Date(d.hora ?? '').getDate()}/${new Date(d.hora ?? '').getMonth() + 1} a las ${formatearHora(d.hora)}`
  }
  if (d.visitado === false) {
    return d.motivo === 'direccion_erronea'
      ? 'No visitado — dirección errónea'
      : 'No visitado — el cliente no estaba'
  }
  return 'Sin visitar'
}

/**
 * El color va como parametro y no se pide adentro.
 *
 * Esto no es un componente: es una cuenta. Pedirle el tema aca adentro seria
 * llamar a un gancho de React desde una funcion que se invoca en medio de un
 * `map`, y ahi React deja de poder contar cuantos ganchos tiene el dibujado.
 * Se lo pasa el que dibuja, que si es un componente.
 */
function colorRenglon(d: DetalleHistorial, colores: Paleta): string {
  if (d.visitado === true) return colores.estadoVisitada
  if (d.visitado === false) return colores.estadoNoVisitada
  return colores.estadoOmitida
}

const usarEstilos = hojaDeTema((t) => ({
  contenido: { gap: espaciado.md },
  rango: { flexDirection: 'row', gap: espaciado.sm },
  mitad: { flex: 1 },

  // Mismo acordeón que el historial de notas de pedido: el día es texto suelto
  // sobre el panel, sin caja. Que las dos pantallas se vean igual era el punto.
  dia: {},
  diaCabecera: {
    flexDirection: 'row',
    alignItems: 'center',
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
  // El "3/8" se queda: dice cuántas de las planificadas se cumplieron, que es
  // información que el historial de notas no tiene y no se puede deducir.
  diaConteo: {
    fontFamily: t.tipografia.familia.fuerte,
    fontSize: t.tipografia.tamano.sm,
    color: t.colores.tintaSuave,
    marginLeft: 'auto',
  },
  flecha: { fontSize: t.tipografia.tamano.lg, color: t.colores.tintaSuave },

  diaCuerpo: { paddingBottom: espaciado.xs },
  renglon: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaciado.sm,
    minHeight: 48,
  },
  punto: { width: 10, height: 10, borderRadius: 5 },
  renglonTexto: {
    flex: 1,
    fontFamily: t.tipografia.familia.liviana,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.tintaSuave,
    lineHeight: t.tipografia.tamano.xs * 1.4,
  },
  renglonCliente: {
    fontFamily: t.tipografia.familia.fuerte,
    color: t.colores.tinta,
  },
  sinDatos: {
    fontFamily: t.tipografia.familia.liviana,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.tintaTenue,
    padding: espaciado.md,
  },
  nota: {
    fontFamily: t.tipografia.familia.liviana,
    fontSize: t.tipografia.tamano.micro,
    color: t.colores.tintaTenue,
    textAlign: 'center',
    marginTop: espaciado.sm,
  },
}))
