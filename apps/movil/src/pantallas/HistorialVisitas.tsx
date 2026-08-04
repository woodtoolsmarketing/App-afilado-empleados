import {
  colores,
  espaciado,
  formatearDiaHistorial,
  formatearFechaCorta,
  formatearHora,
  radios,
  tipografia,
} from '@woodtools/compartido'
import DateTimePicker from '@react-native-community/datetimepicker'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

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
  const [periodo, setPeriodo] = useState<PeriodoHistorial>('semana')
  const [desde, setDesde] = useState(() => new Date(Date.now() - 7 * 86_400_000))
  const [hasta, setHasta] = useState(() => new Date())
  const [calendario, setCalendario] = useState<'desde' | 'hasta' | null>(null)
  const [abiertos, setAbiertos] = useState<Record<string, boolean>>({})

  const { data, isLoading, error } = useQuery({
    queryKey: ['historial', periodo, desde.toDateString(), hasta.toDateString()],
    queryFn: () => obtenerHistorial(periodo, { desde, hasta }),
  })

  return (
    <Pantalla>
      <Encabezado alAbrirMenu={() => navigation.navigate('Configuracion')} />

      <Panel contentStyle={estilos.contenido}>
        <BarraPanel alVolver={() => navigation.goBack()} />

        <TituloPanel>{'HISTORIAL\nDE VISITAS'}</TituloPanel>

        <Desplegable<PeriodoHistorial>
          etiqueta="PERIODO"
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
          data.map((dia) => (
            <DiaAcordeon
              key={dia.rol_visita_id}
              dia={dia}
              abierto={!!abiertos[dia.rol_visita_id]}
              alAlternar={() =>
                setAbiertos((a) => ({ ...a, [dia.rol_visita_id]: !a[dia.rol_visita_id] }))
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
        <View style={estilos.diaResumen}>
          <Text style={estilos.diaConteo}>
            {dia.visitadas}/{dia.total_paradas}
          </Text>
          <Text style={estilos.flecha}>{abierto ? '▲' : '▼'}</Text>
        </View>
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
                <View style={[estilos.punto, { backgroundColor: colorRenglon(d) }]} />
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

function colorRenglon(d: DetalleHistorial): string {
  if (d.visitado === true) return colores.estadoVisitada
  if (d.visitado === false) return colores.estadoNoVisitada
  return colores.estadoOmitida
}

const estilos = StyleSheet.create({
  contenido: { gap: espaciado.md },
  rango: { flexDirection: 'row', gap: espaciado.sm },
  mitad: { flex: 1 },

  dia: {
    borderWidth: 2,
    borderColor: colores.negro,
    borderRadius: radios.sm,
    backgroundColor: colores.panelClaro,
    overflow: 'hidden',
  },
  diaCabecera: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: espaciado.md,
    paddingVertical: espaciado.md,
    minHeight: 62,
  },
  tocado: { opacity: 0.7 },
  diaTitulo: {
    fontFamily: tipografia.familia.subtitulo,
    fontSize: tipografia.tamano.lg,
    color: colores.tinta,
    letterSpacing: 0.4,
  },
  diaResumen: { flexDirection: 'row', alignItems: 'center', gap: espaciado.sm },
  diaConteo: {
    fontFamily: tipografia.familia.fuerte,
    fontSize: tipografia.tamano.sm,
    color: colores.tintaSuave,
  },
  flecha: { fontSize: tipografia.tamano.sm, color: colores.tintaSuave },

  diaCuerpo: {
    backgroundColor: colores.campoBlanco,
    borderTopWidth: 1.5,
    borderTopColor: colores.negro,
    paddingVertical: espaciado.xs,
  },
  renglon: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaciado.sm,
    paddingHorizontal: espaciado.md,
    paddingVertical: espaciado.sm,
    minHeight: 52,
  },
  punto: { width: 10, height: 10, borderRadius: 5 },
  renglonTexto: {
    flex: 1,
    fontFamily: tipografia.familia.liviana,
    fontSize: tipografia.tamano.xs,
    color: colores.tintaSuave,
    lineHeight: tipografia.tamano.xs * 1.4,
  },
  renglonCliente: {
    fontFamily: tipografia.familia.fuerte,
    color: colores.tinta,
  },
  sinDatos: {
    fontFamily: tipografia.familia.liviana,
    fontSize: tipografia.tamano.xs,
    color: colores.tintaTenue,
    padding: espaciado.md,
  },
  nota: {
    fontFamily: tipografia.familia.liviana,
    fontSize: tipografia.tamano.micro,
    color: colores.tintaTenue,
    textAlign: 'center',
    marginTop: espaciado.sm,
  },
})
