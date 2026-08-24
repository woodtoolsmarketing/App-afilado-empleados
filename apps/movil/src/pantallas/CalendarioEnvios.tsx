import DateTimePicker from '@react-native-community/datetimepicker'
import {
  colores,
  espaciado,
  formatearFechaCorta,
  radios,
  tipografia,
} from '@woodtools/compartido'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { BotonMenu, BotonSecundario } from '../componentes/Botones'
import { Aviso, Cargando, Pastilla, Vacio } from '../componentes/Estado'
import { Encabezado } from '../componentes/Encabezado'
import { BarraPanel, Pantalla, Panel, TituloPanel } from '../componentes/Pantalla'
import { usarSesion } from '../nucleo/sesion'
import { diasAgendados } from '../servicios/jornada'
import type { PropsPantalla } from '../navegacion/tipos'

/**
 * "CALENDARIO DE ENVÍOS"
 *
 * Qué hay comprometido para los próximos días, y desde dónde se agenda algo
 * nuevo.
 *
 * ── Qué reemplaza ───────────────────────────────────────────────────────────
 *
 * Antes, un envío que había que hacer se cargaba como destino de HOY con
 * prioridad ALTA, porque era la única forma de que no se perdiera. Eso mezclaba
 * dos cosas distintas: lo que hay que hacer ahora y lo que hay que hacer el
 * jueves. El recorrido del día terminaba con destinos que no eran de ese día.
 *
 * Ahora lo que es para otro día se agenda en su día, y aparece en el rol de
 * visita de esa fecha cuando llega. Y lo que es para hoy no necesita que nadie
 * elija una prioridad: si el vendedor está cerca, se desvía; si no, entra a la
 * ruta y la optimización lo ubica.
 *
 * ── Por qué muestra sólo los días con algo ──────────────────────────────────
 *
 * Un mes en blanco con treinta casilleros vacíos no dice nada. Lo que el
 * vendedor necesita ver es dónde tiene trabajo comprometido, que son tres o
 * cuatro días.
 */
export function PantallaCalendarioEnvios({ navigation }: PropsPantalla<'CalendarioEnvios'>) {
  const perfil = usarSesion((s) => s.perfil)
  const [eligiendoFecha, setEligiendoFecha] = useState(false)

  const { data: dias, isLoading } = useQuery({
    queryKey: ['dias-agendados', perfil?.id],
    queryFn: () => diasAgendados(perfil!.id, hoyISO()),
    enabled: !!perfil,
  })

  return (
    <Pantalla>
      <Encabezado alAbrirMenu={() => navigation.navigate('Configuracion')} />

      <Panel contentStyle={estilos.contenido}>
        <BarraPanel alVolver={() => navigation.goBack()} />
        <TituloPanel>CALENDARIO DE ENVÍOS</TituloPanel>

        {isLoading ? (
          <Cargando texto="Buscando lo agendado…" />
        ) : (dias ?? []).length === 0 ? (
          <Vacio
            titulo="No hay nada agendado"
            detalle="Lo que se acuerde para otro día se carga acá y aparece solo en el rol de visita de esa fecha."
            icono="🗓"
          />
        ) : (
          <View style={estilos.lista}>
            {(dias ?? []).map((d) => {
              const esHoy = d.fecha === hoyISO()
              return (
                <Pressable
                  key={d.rol_visita_id}
                  style={estilos.dia}
                  onPress={() =>
                    // El de hoy es el recorrido; los otros todavía no se recorren,
                    // así que se miran desde el historial de esa fecha.
                    esHoy
                      ? navigation.navigate('Recorrido')
                      : navigation.navigate('AgregarDestino', {
                          fecha: d.fecha,
                          volverA: 'CalendarioEnvios',
                        })
                  }
                >
                  <View style={estilos.diaIzquierda}>
                    <Text style={estilos.fecha}>{formatearFechaCorta(`${d.fecha}T12:00:00`)}</Text>
                    <Text style={estilos.cuantos}>
                      {d.destinos === 1 ? '1 destino' : `${d.destinos} destinos`}
                    </Text>
                  </View>
                  {esHoy ? <Pastilla texto="HOY" color={colores.rojo} /> : null}
                </Pressable>
              )
            })}
          </View>
        )}

        <Aviso tono="info" titulo="Cómo entra un envío al recorrido">
          Lo que se agrega para hoy no pide prioridad: si estás cerca del destino se pone como
          próximo y te desvía; si estás lejos entra a la ruta y el mapa lo ubica donde menos te
          cuesta.
        </Aviso>

        <BotonMenu titulo={'AGENDAR PARA\nOTRO DÍA'} alTocar={() => setEligiendoFecha(true)} />

        <BotonSecundario
          titulo="Agregar un destino para hoy"
          alTocar={() => navigation.navigate('AgregarDestino', { volverA: 'CalendarioEnvios' })}
        />

        {eligiendoFecha ? (
          <DateTimePicker
            value={new Date()}
            mode="date"
            display="calendar"
            // Agendar para ayer no tiene sentido: la jornada de ayer ya pasó y
            // el destino no lo vería nadie.
            minimumDate={new Date()}
            onChange={(_evento, fecha) => {
              setEligiendoFecha(false)
              if (!fecha) return
              navigation.navigate('AgregarDestino', {
                fecha: fechaLocalISO(fecha),
                volverA: 'CalendarioEnvios',
              })
            }}
          />
        ) : null}
      </Panel>
    </Pantalla>
  )
}

/**
 * La fecha en formato ISO corto, en hora local.
 *
 * `toISOString` la corre al día siguiente a partir de las 21:00 en Argentina, y
 * agendar a la noche para mañana terminaría agendando para pasado.
 */
function fechaLocalISO(fecha: Date): string {
  const local = new Date(fecha.getTime() - fecha.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 10)
}

function hoyISO(): string {
  return fechaLocalISO(new Date())
}

const estilos = StyleSheet.create({
  contenido: { gap: espaciado.sm },
  lista: { gap: espaciado.xs },
  dia: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colores.panelClaro,
    borderRadius: radios.sm,
    padding: espaciado.sm,
  },
  diaIzquierda: { gap: 2 },
  fecha: {
    fontFamily: tipografia.familia.fuerte,
    fontSize: tipografia.tamano.sm,
    color: colores.tinta,
  },
  cuantos: {
    fontFamily: tipografia.familia.liviana,
    fontSize: tipografia.tamano.xs,
    color: colores.tintaSuave,
  },
})
