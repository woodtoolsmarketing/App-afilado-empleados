import DateTimePicker from '@react-native-community/datetimepicker'
import {
  espaciado,
  fechaLocalISO,
  formatearDiaHistorial,
  radios,
  TOQUE_MINIMO,
  type Paleta,
} from '@woodtools/compartido'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Alert, Modal, Pressable, ScrollView, Text, View } from 'react-native'

import { BotonMenu, BotonSecundario } from '../componentes/Botones'
import { Aviso, Cargando, Pastilla, Vacio } from '../componentes/Estado'
import { Encabezado } from '../componentes/Encabezado'
import { BarraPanel, Pantalla, Panel, TituloPanel } from '../componentes/Pantalla'
import { hojaDeTema, usarTema } from '../nucleo/tema'
import {
  agendaEntre,
  agendarVisita,
  diasDeLaSemana,
  horaLegible,
  lunesDeLaSemana,
  moverParada,
  nombreDelDia,
  quitarDeLaAgenda,
  type ItemDeAgenda,
} from '../servicios/agenda'
import type { PropsPantalla } from '../navegacion/tipos'

/**
 * "CALENDARIO DE VISITAS"
 *
 * La semana entera, día por día, con lo que hay que hacer cada uno.
 *
 * ─── Qué muestra ────────────────────────────────────────────────────────────
 *
 * Dos cosas juntas, con una pastilla que las distingue:
 *
 *   AGENDADO   Ya es un destino de esa jornada. Puede venir del rol que armó
 *              la oficina, de un envío comprometido, o de algo que el vendedor
 *              agendó desde acá.
 *   SUGERIDO   El plan dice que a ese cliente le toca ese día por su
 *              frecuencia, y todavía no está agendado. Es una propuesta.
 *
 * ─── Por qué la semana y no el mes ──────────────────────────────────────────
 *
 * Porque el mes en un teléfono son 30 casilleros de un centímetro donde no
 * entra un nombre. La pregunta que se hace el vendedor es "qué tengo esta
 * semana" y "cuándo lo puedo meter", y las dos se contestan con siete días a
 * la vista. Para ir más lejos están las flechas.
 *
 * ─── Qué se puede cambiar ───────────────────────────────────────────────────
 *
 * Ponerle hora a un destino, moverlo a otro día, sacarlo de la agenda, y
 * agendar a un sugerido. Lo que ya pasó no se toca: una visita registrada
 * tiene su hora, su observación y su ubicación colgando, y moverla de día
 * haría que un trabajo hecho el martes figure como hecho el jueves.
 */
export function PantallaCalendarioVisitas({ navigation, route }: PropsPantalla<'CalendarioVisitas'>) {
  const estilos = usarEstilos()
  const { colores } = usarTema()
  const consultas = useQueryClient()

  const hoy = useMemo(() => new Date(), [])
  const hoyISO = fechaLocalISO(hoy)

  const [lunes, setLunes] = useState(() =>
    lunesDeLaSemana(route.params?.fecha ? new Date(`${route.params.fecha}T12:00:00`) : new Date()),
  )
  const [elegido, setElegido] = useState(() => route.params?.fecha ?? fechaLocalISO(new Date()))

  const dias = useMemo(() => diasDeLaSemana(lunes), [lunes])
  const domingo = dias[6]

  const { data: agenda, isLoading, error } = useQuery({
    queryKey: ['agenda', fechaLocalISO(lunes)],
    queryFn: () => agendaEntre(lunes, domingo),
  })

  /** Cuántos items tiene cada día, para el globito de la tira de arriba. */
  const porDia = useMemo(() => {
    const cuenta = new Map<string, { agendados: number; sugeridos: number }>()
    for (const i of agenda ?? []) {
      const actual = cuenta.get(i.fecha) ?? { agendados: 0, sugeridos: 0 }
      if (i.tipo === 'agendada') actual.agendados += 1
      else actual.sugeridos += 1
      cuenta.set(i.fecha, actual)
    }
    return cuenta
  }, [agenda])

  /**
   * Lo del día elegido, ordenado como transcurre la jornada.
   *
   * Primero lo que tiene hora, en hora; después lo agendado sin hora, en el
   * orden del recorrido; y al final las sugerencias. Ese es el orden en que se
   * mira: lo que tiene compromiso horario manda sobre lo que no, y lo que
   * todavía no se decidió va último.
   */
  const delDia = useMemo(() => {
    const items = (agenda ?? []).filter((i) => i.fecha === elegido)
    return [...items].sort((a, b) => {
      if (a.tipo !== b.tipo) return a.tipo === 'agendada' ? -1 : 1
      if (a.hora && b.hora) return a.hora.localeCompare(b.hora)
      if (a.hora) return -1
      if (b.hora) return 1
      return (a.orden ?? 9999) - (b.orden ?? 9999) || a.razon_social.localeCompare(b.razon_social)
    })
  }, [agenda, elegido])

  const [enAccion, setEnAccion] = useState<ItemDeAgenda | null>(null)
  const [pidiendoHora, setPidiendoHora] = useState<ItemDeAgenda | null>(null)
  const [pidiendoFecha, setPidiendoFecha] = useState<ItemDeAgenda | null>(null)

  /**
   * Correr la semana se lleva el día elegido con ella.
   *
   * Sin esto, el día elegido se quedaba en la semana vieja: la tira no marcaba
   * ninguno, el título mostraba una fecha que no estaba a la vista, la lista
   * salía vacía, y —lo peor— "Agregar otro destino a este día" seguía
   * agendando para el día de la semana anterior. Se conserva el día de la
   * semana: el que estaba mirando el jueves quiere ver el jueves que viene.
   */
  function correrSemana(cuantas: number) {
    const nuevoLunes = correrSemanas(lunes, cuantas)
    const diaDeLaSemana = (new Date(`${elegido}T12:00:00`).getDay() + 6) % 7
    const nuevoDia = new Date(nuevoLunes.getFullYear(), nuevoLunes.getMonth(), nuevoLunes.getDate())
    nuevoDia.setDate(nuevoDia.getDate() + diaDeLaSemana)
    setLunes(nuevoLunes)
    setElegido(fechaLocalISO(nuevoDia))
  }

  /**
   * Después de tocar la agenda hay que refrescar todo, no sólo esta pantalla.
   *
   * Agendar para hoy suma un destino a la jornada EN CURSO, y esa jornada la
   * leen otras cuatro pantallas con sus propias claves —el recorrido, el
   * calendario de envíos, los clientes de hoy, el resumen del menú—. La pila
   * nativa las deja montadas atrás, así que si no se invalidan, el vendedor
   * vuelve con Atrás y ve la lista de antes: el destino que acaba de agendar no
   * está, y el que acaba de sacar sigue estando.
   *
   * Se invalida todo y no una lista de claves a propósito: es lo que ya hacen
   * las otras pantallas que tocan paradas, y una lista escrita a mano se queda
   * vieja el día que alguien agrega una consulta más.
   */
  async function refrescar() {
    await consultas.invalidateQueries()
  }

  const agendar = useMutation({
    mutationFn: (params: { item: ItemDeAgenda; fecha: string; hora?: string | null }) =>
      agendarVisita({ clienteId: params.item.cliente_id!, fecha: params.fecha, hora: params.hora }),
    onSuccess: refrescar,
    onError: (e: Error) => Alert.alert('No pudimos agendarlo', e.message),
  })

  const mover = useMutation({
    mutationFn: (params: {
      item: ItemDeAgenda
      fecha?: string | null
      hora?: string | null
      borrarHora?: boolean
    }) =>
      moverParada({
        paradaId: params.item.parada_id!,
        fecha: params.fecha ?? params.item.fecha,
        hora: params.hora,
        borrarHora: params.borrarHora,
      }),
    onSuccess: refrescar,
    onError: (e: Error) => Alert.alert('No pudimos cambiarlo', e.message),
  })

  const quitar = useMutation({
    mutationFn: (item: ItemDeAgenda) => quitarDeLaAgenda(item.parada_id!),
    onSuccess: refrescar,
    onError: (e: Error) => Alert.alert('No pudimos sacarlo', e.message),
  })

  const esPasado = elegido < hoyISO
  const trabajando = agendar.isPending || mover.isPending || quitar.isPending

  return (
    <Pantalla>
      <Encabezado />

      <Panel contentStyle={estilos.contenido}>
        <BarraPanel alVolver={() => navigation.goBack()} />
        <TituloPanel>{'CALENDARIO\nDE VISITAS'}</TituloPanel>

        {/* ── La semana ────────────────────────────────────────────────── */}
        <View style={estilos.semana}>
          <Pressable
            onPress={() => correrSemana(-1)}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Semana anterior"
            style={({ pressed }) => [estilos.flecha, pressed && estilos.tocado]}
          >
            <Text style={estilos.flechaTexto}>‹</Text>
          </Pressable>

          <Text style={estilos.rango}>{rangoDeLaSemana(dias)}</Text>

          <Pressable
            onPress={() => correrSemana(1)}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Semana siguiente"
            style={({ pressed }) => [estilos.flecha, pressed && estilos.tocado]}
          >
            <Text style={estilos.flechaTexto}>›</Text>
          </Pressable>
        </View>

        {/*
          Los siete días en una tira horizontal.
          Se desplaza porque con la letra grande al máximo siete casilleros no
          entran en el ancho de un teléfono, y prefiero que se corran a que se
          apilen dos renglones o se recorten los números.
        */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={estilos.tira}
        >
          {dias.map((d) => {
            const iso = fechaLocalISO(d)
            const cuenta = porDia.get(iso)
            return (
              <Pressable
                key={iso}
                onPress={() => setElegido(iso)}
                accessibilityRole="button"
                accessibilityState={{ selected: iso === elegido }}
                accessibilityLabel={`${formatearDiaHistorial(iso)}, ${(cuenta?.agendados ?? 0) + (cuenta?.sugeridos ?? 0)} destinos`}
                style={[
                  estilos.dia,
                  iso === elegido && estilos.diaElegido,
                  iso === hoyISO && estilos.diaHoy,
                ]}
              >
                <Text style={[estilos.diaNombre, iso === elegido && estilos.diaTextoElegido]}>
                  {nombreDelDia(d)}
                </Text>
                <Text style={[estilos.diaNumero, iso === elegido && estilos.diaTextoElegido]}>
                  {d.getDate()}
                </Text>

                {/* Dos puntos y no dos números: en un casillero de este tamaño
                    un "3 · 5" no se lee, y lo que hay que saber de un vistazo
                    es si el día tiene algo o está libre. */}
                <View style={estilos.puntos}>
                  {cuenta?.agendados ? (
                    <View style={[estilos.punto, { backgroundColor: colores.rojoAccion }]} />
                  ) : null}
                  {cuenta?.sugeridos ? (
                    <View style={[estilos.punto, { backgroundColor: colores.azul }]} />
                  ) : null}
                </View>
              </Pressable>
            )
          })}
        </ScrollView>

        <Text style={estilos.diaTitulo}>{formatearDiaHistorial(elegido)}</Text>

        {/* ── Lo del día ───────────────────────────────────────────────── */}
        {isLoading ? (
          <Cargando texto="Armando la semana…" />
        ) : error ? (
          <Aviso tono="error" titulo="No pudimos traer la agenda">
            Revisá la conexión. Lo agendado sigue guardado: esto es un problema para leerlo.
          </Aviso>
        ) : delDia.length === 0 ? (
          <Vacio
            titulo={esPasado ? 'Ese día no tuviste destinos' : 'Ese día está libre'}
            detalle={
              esPasado
                ? undefined
                : 'Podés agregar un destino con el botón de abajo, o esperar a que el plan proponga alguno.'
            }
            icono="🗓"
          />
        ) : (
          <View style={estilos.lista}>
            {delDia.map((i) => (
              <FilaAgenda
                key={i.parada_id ?? `sugerida-${i.cliente_id}`}
                item={i}
                colores={colores}
                bloqueada={esPasado || trabajando}
                alTocar={() => setEnAccion(i)}
              />
            ))}
          </View>
        )}

        {!esPasado ? (
          <BotonSecundario
            titulo="Agregar otro destino a este día"
            alTocar={() =>
              navigation.navigate('AgregarDestino', {
                fecha: elegido,
                volverA: 'CalendarioVisitas',
              })
            }
          />
        ) : null}

        <BotonMenu
          titulo="VOLVER A ESTA SEMANA"
          alTocar={() => {
            setLunes(lunesDeLaSemana(new Date()))
            setElegido(fechaLocalISO(new Date()))
          }}
        />

        <Aviso tono="info" titulo="Cómo leerlo">
          El punto rojo marca los días con destinos ya agendados y el azul los que el plan
          sugiere. Un sugerido no está en tu recorrido hasta que lo agendás.
        </Aviso>
      </Panel>

      {/* ── Qué hacer con el destino tocado ─────────────────────────────── */}
      <HojaDeAcciones
        item={enAccion}
        alCerrar={() => setEnAccion(null)}
        acciones={
          enAccion
            ? enAccion.tipo === 'sugerida'
              ? [
                  {
                    etiqueta: 'AGENDAR PARA ESTE DÍA',
                    detalle: enAccion.lat === null ? 'Falta ubicarlo en el mapa' : undefined,
                    apagada: enAccion.lat === null,
                    hacer: (i) => agendar.mutate({ item: i, fecha: elegido }),
                  },
                  {
                    etiqueta: 'AGENDAR CON HORA',
                    apagada: enAccion.lat === null,
                    hacer: (i) => setPidiendoHora(i),
                  },
                  {
                    etiqueta: 'UBICARLO EN EL MAPA',
                    detalle: enAccion.lat === null ? 'Sin dirección no entra al recorrido' : undefined,
                    // El cliente viaja escrito: es el que la pantalla acaba de
                    // nombrar, y hacerlo buscar de nuevo sería no haberlo oído.
                    hacer: (i) =>
                      navigation.navigate('AgregarDestino', {
                        modo: 'existente',
                        fecha: elegido,
                        volverA: 'CalendarioVisitas',
                        buscarA: i.codigo ?? i.razon_social,
                      }),
                  },
                ]
              : [
                  {
                    etiqueta: enAccion.hora ? 'CAMBIAR LA HORA' : 'PONERLE HORA',
                    hacer: (i) => setPidiendoHora(i),
                  },
                  ...(enAccion.hora
                    ? [
                        {
                          etiqueta: 'SACARLE LA HORA',
                          hacer: (i: ItemDeAgenda) => mover.mutate({ item: i, borrarHora: true }),
                        },
                      ]
                    : []),
                  {
                    etiqueta: 'MOVERLO A OTRO DÍA',
                    hacer: (i) => setPidiendoFecha(i),
                  },
                  {
                    etiqueta: 'SACARLO DE LA AGENDA',
                    destructiva: true,
                    hacer: (i) =>
                      Alert.alert(
                        'Sacarlo de la agenda',
                        `${i.razon_social} queda marcado como omitido. No se borra: la oficina va a ver que estaba y que decidiste no hacerlo.`,
                        [
                          { text: 'Volver', style: 'cancel' },
                          {
                            text: 'Sacarlo',
                            style: 'destructive',
                            onPress: () => quitar.mutate(i),
                          },
                        ],
                      ),
                  },
                ]
            : []
        }
      />

      {/*
        El reloj del sistema. Es el mismo componente que ya usa el calendario de
        envíos para elegir fecha, así que no suma nada al APK: cambiarlo por uno
        propio sería dibujar un reloj a mano por gusto.
      */}
      {pidiendoHora ? (
        <DateTimePicker
          value={horaInicial(pidiendoHora)}
          mode="time"
          is24Hour
          display="spinner"
          onChange={(evento, cuando) => {
            const item = pidiendoHora
            setPidiendoHora(null)
            if (evento.type !== 'set' || !cuando || !item) return
            const hhmm = `${String(cuando.getHours()).padStart(2, '0')}:${String(cuando.getMinutes()).padStart(2, '0')}`
            if (item.tipo === 'sugerida') agendar.mutate({ item, fecha: elegido, hora: hhmm })
            else mover.mutate({ item, hora: hhmm })
          }}
        />
      ) : null}

      {pidiendoFecha ? (
        <DateTimePicker
          value={new Date(`${pidiendoFecha.fecha}T12:00:00`)}
          mode="date"
          display="calendar"
          // Mover algo al pasado no tiene sentido: esa jornada ya terminó y el
          // destino no lo vería nadie. La función del servidor también lo
          // rechaza; esto evita que el vendedor llegue a intentarlo.
          minimumDate={hoy}
          onChange={(evento, cuando) => {
            const item = pidiendoFecha
            setPidiendoFecha(null)
            if (evento.type !== 'set' || !cuando || !item) return
            const destino = fechaLocalISO(cuando)
            mover.mutate({ item, fecha: destino })
            // Se salta al día al que se lo mandó: si no, el vendedor toca
            // "moverlo al jueves" y se queda mirando el martes, sin ninguna
            // señal de que funcionó más que el renglón que desapareció.
            setLunes(lunesDeLaSemana(cuando))
            setElegido(destino)
          }}
        />
      ) : null}
    </Pantalla>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

function FilaAgenda({
  item,
  colores,
  bloqueada,
  alTocar,
}: {
  item: ItemDeAgenda
  colores: Paleta
  bloqueada: boolean
  alTocar: () => void
}) {
  const estilos = usarEstilos()
  const hora = horaLegible(item.hora)
  const sugerida = item.tipo === 'sugerida'
  const resuelta = !!item.estado && item.estado !== 'pendiente' && item.estado !== 'en_camino'

  return (
    <Pressable
      onPress={bloqueada || resuelta ? undefined : alTocar}
      accessibilityRole="button"
      accessibilityLabel={`${item.razon_social}${hora ? `, ${hora}` : ''}`}
      style={({ pressed }) => [
        estilos.fila,
        sugerida && estilos.filaSugerida,
        (bloqueada || resuelta) && estilos.filaApagada,
        pressed && estilos.tocado,
      ]}
    >
      <View style={estilos.horaCaja}>
        <Text style={[estilos.hora, !hora && estilos.sinHora]}>{hora ?? '—'}</Text>
      </View>

      <View style={estilos.datos}>
        <Text style={estilos.nombre} numberOfLines={2}>
          {item.codigo ? `${item.codigo} · ` : ''}
          {item.razon_social}
        </Text>

        {item.direccion ? (
          <Text style={estilos.direccion} numberOfLines={1}>
            {item.direccion}
          </Text>
        ) : null}

        <View style={estilos.pastillas}>
          <Pastilla
            texto={sugerida ? 'SUGERIDO' : etiquetaDelEstado(item.estado)}
            color={sugerida ? colores.azul : colorDelEstado(item.estado, colores)}
          />
          {sugerida && item.cada_cuantos_dias ? (
            <Pastilla texto={`CADA ${item.cada_cuantos_dias} DÍAS`} color={colores.tintaSuave} />
          ) : null}
          {sugerida && item.dias_desde !== null ? (
            <Pastilla
              texto={`HACE ${item.dias_desde} DÍAS`}
              color={
                item.cada_cuantos_dias && item.dias_desde > item.cada_cuantos_dias * 2
                  ? colores.rojoAccion
                  : colores.ambarOscuro
              }
            />
          ) : sugerida ? (
            <Pastilla texto="NUNCA VISITADO" color={colores.azul} />
          ) : null}
          {item.lat === null ? <Pastilla texto="SIN UBICAR" color={colores.rojoAccion} /> : null}
        </View>
      </View>
    </Pressable>
  )
}

interface Accion {
  etiqueta: string
  detalle?: string
  apagada?: boolean
  destructiva?: boolean
  hacer: (item: ItemDeAgenda) => void
}

/**
 * La hoja de opciones del destino tocado.
 *
 * Es un modal propio y no `Alert.alert` con varios botones: en Android, un
 * Alert con más de tres botones descarta los que sobran sin avisar, y acá hay
 * cuatro. Lo que se perdía era justo el último, "sacarlo de la agenda".
 */
function HojaDeAcciones({
  item,
  acciones,
  alCerrar,
}: {
  item: ItemDeAgenda | null
  acciones: Accion[]
  alCerrar: () => void
}) {
  const estilos = usarEstilos()

  return (
    <Modal visible={!!item} transparent animationType="fade" onRequestClose={alCerrar}>
      <Pressable style={estilos.velo} onPress={alCerrar} accessibilityLabel="Cerrar">
        <Pressable style={estilos.hoja} onPress={() => undefined}>
          <Text style={estilos.hojaTitulo} numberOfLines={2}>
            {item?.razon_social}
          </Text>

          {acciones.map((a) => (
            <Pressable
              key={a.etiqueta}
              disabled={a.apagada}
              onPress={() => {
                if (!item) return
                alCerrar()
                // Igual que en el menú lateral: primero se cierra, después se
                // actúa. Un DateTimePicker abierto debajo de este modal no se
                // ve, y el vendedor queda esperando un reloj que ya está ahí.
                requestAnimationFrame(() => a.hacer(item))
              }}
              accessibilityRole="button"
              style={({ pressed }) => [
                estilos.accion,
                a.apagada && estilos.accionApagada,
                pressed && estilos.tocado,
              ]}
            >
              <Text style={[estilos.accionTexto, a.destructiva && estilos.accionDestructiva]}>
                {a.etiqueta}
              </Text>
              {a.detalle ? <Text style={estilos.accionDetalle}>{a.detalle}</Text> : null}
            </Pressable>
          ))}

          <Pressable
            onPress={alCerrar}
            accessibilityRole="button"
            style={({ pressed }) => [estilos.cancelar, pressed && estilos.tocado]}
          >
            <Text style={estilos.cancelarTexto}>VOLVER</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

// ─── Cuentas sueltas ─────────────────────────────────────────────────────────
//
// Ninguna de estas es un componente: reciben la paleta en vez de pedirla, para
// no llamar a un gancho de React desde adentro de un `map`.

function correrSemanas(lunes: Date, cuantas: number): Date {
  const d = new Date(lunes.getFullYear(), lunes.getMonth(), lunes.getDate())
  d.setDate(d.getDate() + cuantas * 7)
  return d
}

const MESES = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC']

/** "1 – 7 SEP", o "29 AGO – 4 SEP" cuando la semana cambia de mes. */
function rangoDeLaSemana(dias: Date[]): string {
  const a = dias[0]
  const b = dias[6]
  if (a.getMonth() === b.getMonth()) {
    return `${a.getDate()} – ${b.getDate()} ${MESES[b.getMonth()]}`
  }
  return `${a.getDate()} ${MESES[a.getMonth()]} – ${b.getDate()} ${MESES[b.getMonth()]}`
}

/** Con qué hora abre el reloj: la que tiene, o las 10 de la mañana. */
function horaInicial(item: ItemDeAgenda): Date {
  if (item.hora) {
    const puesta = new Date(item.hora)
    if (!Number.isNaN(puesta.getTime())) return puesta
  }
  const arranque = new Date()
  arranque.setHours(10, 0, 0, 0)
  return arranque
}

function etiquetaDelEstado(estado: string | null): string {
  switch (estado) {
    case 'visitada':
      return 'VISITADA'
    case 'no_visitada':
      return 'NO VISITADA'
    case 'en_camino':
      return 'EN CAMINO'
    case 'omitida':
      return 'OMITIDA'
    default:
      return 'AGENDADO'
  }
}

function colorDelEstado(estado: string | null, colores: Paleta): string {
  switch (estado) {
    case 'visitada':
      return colores.estadoVisitada
    case 'no_visitada':
      return colores.estadoNoVisitada
    case 'en_camino':
      return colores.estadoEnCamino
    case 'omitida':
      return colores.estadoOmitida
    default:
      return colores.rojoAccion
  }
}

const usarEstilos = hojaDeTema((t) => ({
  contenido: { gap: espaciado.md },

  semana: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: espaciado.sm,
  },
  flecha: {
    width: TOQUE_MINIMO,
    height: TOQUE_MINIMO,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flechaTexto: {
    fontFamily: t.tipografia.familia.titulo,
    fontSize: t.tipografia.tamano.xxl,
    color: t.colores.tinta,
  },
  rango: {
    flex: 1,
    textAlign: 'center',
    fontFamily: t.tipografia.familia.subtitulo,
    fontSize: t.tipografia.tamano.base,
    color: t.colores.tinta,
    letterSpacing: 0.8,
  },

  tira: { gap: espaciado.xs, paddingVertical: 2 },
  dia: {
    minWidth: 52,
    paddingVertical: espaciado.sm,
    paddingHorizontal: espaciado.xs,
    borderRadius: radios.sm,
    borderWidth: 2,
    borderColor: 'transparent',
    backgroundColor: t.colores.panelClaro,
    alignItems: 'center',
    gap: 2,
  },
  diaElegido: { backgroundColor: t.colores.rojoSolido, borderColor: t.colores.borde },
  /* El día de hoy se marca con el borde aunque no esté elegido. */
  diaHoy: { borderColor: t.colores.borde },
  diaNombre: {
    fontFamily: t.tipografia.familia.cuerpo,
    fontSize: t.tipografia.tamano.micro,
    color: t.colores.tintaSuave,
    letterSpacing: 0.5,
  },
  diaNumero: {
    fontFamily: t.tipografia.familia.subtitulo,
    fontSize: t.tipografia.tamano.lg,
    color: t.colores.tinta,
  },
  diaTextoElegido: { color: t.colores.blanco },
  puntos: { flexDirection: 'row', gap: 3, height: 8, alignItems: 'center' },
  punto: { width: 6, height: 6, borderRadius: 3 },

  diaTitulo: {
    fontFamily: t.tipografia.familia.subtitulo,
    fontSize: t.tipografia.tamano.base,
    color: t.colores.tinta,
    letterSpacing: 0.6,
  },

  lista: { gap: espaciado.xs },
  fila: {
    flexDirection: 'row',
    gap: espaciado.sm,
    backgroundColor: t.colores.panelClaro,
    borderRadius: radios.sm,
    padding: espaciado.sm,
    borderLeftWidth: 4,
    borderLeftColor: t.colores.rojoAccion,
  },
  filaSugerida: { borderLeftColor: t.colores.azul },
  filaApagada: { opacity: 0.6 },
  tocado: { opacity: 0.7 },

  horaCaja: { width: 54, alignItems: 'center', justifyContent: 'flex-start', paddingTop: 2 },
  hora: {
    fontFamily: t.tipografia.familia.subtitulo,
    fontSize: t.tipografia.tamano.sm,
    color: t.colores.tinta,
  },
  sinHora: { color: t.colores.tintaTenue },

  datos: { flex: 1, gap: 2 },
  nombre: {
    fontFamily: t.tipografia.familia.fuerte,
    fontSize: t.tipografia.tamano.sm,
    color: t.colores.tinta,
  },
  direccion: {
    fontFamily: t.tipografia.familia.liviana,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.tintaSuave,
  },
  pastillas: { flexDirection: 'row', gap: espaciado.xs, flexWrap: 'wrap', marginTop: 2 },

  velo: {
    flex: 1,
    backgroundColor: t.colores.velo,
    justifyContent: 'flex-end',
  },
  hoja: {
    backgroundColor: t.colores.panel,
    borderTopWidth: 2.5,
    borderTopColor: t.colores.borde,
    borderTopLeftRadius: radios.lg,
    borderTopRightRadius: radios.lg,
    padding: espaciado.base,
    gap: espaciado.xs,
  },
  hojaTitulo: {
    fontFamily: t.tipografia.familia.subtitulo,
    fontSize: t.tipografia.tamano.base,
    color: t.colores.tinta,
    marginBottom: espaciado.xs,
  },
  accion: {
    minHeight: TOQUE_MINIMO,
    justifyContent: 'center',
    paddingHorizontal: espaciado.md,
    borderRadius: radios.sm,
    borderWidth: 2,
    borderColor: t.colores.borde,
    backgroundColor: t.colores.campoBlanco,
  },
  accionApagada: { opacity: 0.45 },
  accionTexto: {
    fontFamily: t.tipografia.familia.fuerte,
    fontSize: t.tipografia.tamano.sm,
    color: t.colores.tinta,
    letterSpacing: 0.5,
  },
  accionDestructiva: { color: t.colores.rojoAccion },
  accionDetalle: {
    fontFamily: t.tipografia.familia.liviana,
    fontSize: t.tipografia.tamano.micro,
    color: t.colores.tintaSuave,
  },
  cancelar: {
    minHeight: TOQUE_MINIMO,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: espaciado.xs,
  },
  cancelarTexto: {
    fontFamily: t.tipografia.familia.subtitulo,
    fontSize: t.tipografia.tamano.sm,
    color: t.colores.tintaSuave,
    letterSpacing: 1,
  },
}))
