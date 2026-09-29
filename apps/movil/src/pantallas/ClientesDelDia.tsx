import { espaciado, radios, TOQUE_MINIMO } from '@woodtools/compartido'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Alert, Pressable, Text, View } from 'react-native'

import { BotonMenu, BotonSecundario } from '../componentes/Botones'
import { Aviso, Cargando, Pastilla, Vacio } from '../componentes/Estado'
import { Encabezado } from '../componentes/Encabezado'
import { BarraPanel, Pantalla, Panel, TituloPanel } from '../componentes/Pantalla'
import { usarSesion } from '../nucleo/sesion'
import {
  armarRecorridoCon,
  candidatosDelDia,
  obtenerJornadaDeHoy,
  type CandidatoDelDia,
} from '../servicios/jornada'
import { optimizarRecorrido, previsualizarRecorrido } from '../servicios/mapas'
import { ubicacionActual } from '../servicios/ubicacion'
import type { PropsPantalla } from '../navegacion/tipos'
import { hojaDeTema, usarTema } from '../nucleo/tema'

/**
 * "CLIENTES DE HOY"
 *
 * A quién toca visitar según el rol maestro que cargó la oficina, para que el
 * vendedor arme su recorrido eligiendo.
 *
 * ── Por qué arrancan todos deseleccionados ──────────────────────────────────
 *
 * Porque la lista es una sugerencia, no una orden. El plan dice "a este cliente
 * se lo ve cada 15 días" y hoy se cumplieron los 15; si conviene hacerlo hoy o
 * el lunes lo sabe el que maneja. Arrancar todo tildado convierte la sugerencia
 * en un recorrido que hay que desarmar, que es más trabajo que armarlo.
 *
 * ── Por qué son candidatos y no paradas ─────────────────────────────────────
 *
 * Deseleccionar tiene que no dejar rastro, y el vendedor no puede borrar
 * paradas. Si el Excel de la oficina creara las paradas directamente, destildar
 * a lo sumo las marcaría omitidas y quedarían igual en el rol del día como
 * destinos que nunca se visitaron.
 */
export function PantallaClientesDelDia({ navigation }: PropsPantalla<'ClientesDelDia'>) {
  const estilos = usarEstilos()
  const perfil = usarSesion((s) => s.perfil)
  const cliente = useQueryClient()
  const [elegidos, setElegidos] = useState<Set<string>>(new Set())

  const { data: candidatos, isLoading, error, refetch } = useQuery({
    queryKey: ['candidatos-del-dia'],
    queryFn: candidatosDelDia,
  })

  const lista = candidatos ?? []
  const seleccionados = lista.filter((c) => elegidos.has(c.cliente_id))
  // Cuántos no están en el mapa. Ya no decide quién puede entrar al recorrido
  // —entran todos—, sólo si hace falta explicarle al vendedor qué va a pasar
  // con ellos cuando los tilde.
  const sinUbicar = lista.filter((c) => c.lat === null).length
  const todosElegidos = lista.length > 0 && lista.every((c) => elegidos.has(c.cliente_id))

  function alternar(id: string) {
    setElegidos((previos) => {
      const nuevos = new Set(previos)
      if (nuevos.has(id)) nuevos.delete(id)
      else nuevos.add(id)
      return nuevos
    })
  }

  /**
   * Atajo para cuando el vendedor va a hacer casi todos: tildar de a uno es
   * mucho toque si el rol trajo veinte candidatos y noventa por ciento entra.
   * No toca el arranque sin nada tildado —sigue siendo la regla—, es una
   * acción explícita más que el vendedor elige tocar.
   *
   * Antes el atajo era "tildar todos los ubicados" y salteaba a propósito a los
   * que no tenían dirección, porque ésos ni siquiera podían entrar al recorrido.
   * Ahora entran como cualquier otro, así que seguir separándolos dejaría afuera
   * justo a los que el vendedor pidió poder meter en la lista —y peor: en
   * silencio, porque el atajo diría "todos" y no los estaría contando.
   */
  function alternarTodos() {
    setElegidos(todosElegidos ? new Set() : new Set(lista.map((c) => c.cliente_id)))
  }

  const armar = useMutation({
    mutationFn: async () => {
      if (!perfil) throw new Error('No hay sesión')
      const resultado = await armarRecorridoCon(perfil.id, seleccionados)
      if (resultado.agregados === 0) return resultado

      // Con el recorrido cargado se lo ordena antes de mostrarlo: sin esto la
      // ruta sale en el orden en que se tildaron los clientes, que es el orden
      // de la lista y no el del camino.
      const jornada = await obtenerJornadaDeHoy(perfil.id)
      if (jornada) {
        try {
          const donde = await ubicacionActual()
          await optimizarRecorrido(jornada.jornada.id, { lat: donde.lat, lng: donde.lng })
        } catch {
          // Sin señal o sin Google queda el orden por cercanía, que la RPC ya
          // aplica sola. No es motivo para no armar el recorrido.
        }
      }
      return resultado
    },
    onSuccess: async (r) => {
      await cliente.invalidateQueries()
      setElegidos(new Set())

      const perdidos = r.fallaron.length
      Alert.alert(
        'Recorrido armado',
        `${r.agregados} destino${r.agregados === 1 ? '' : 's'} en tu recorrido de hoy.` +
          // No se nombra el motivo. Antes decía "Están sin ubicar en el mapa"
          // porque ésa era la única razón por la que un candidato se caía, y ya
          // no lo es: el que no está en el mapa entra igual. Lo que quede acá
          // ahora es un problema de verdad —se cortó la señal en el medio, por
          // ejemplo—, y adivinarle una causa sería mandarlo a arreglar algo que
          // no está roto.
          (perdidos > 0
            ? `\n\nNo entraron ${perdidos}: ${r.fallaron.map((f) => f.razon_social).join(', ')}. Tildalos de nuevo y volvé a armar; si sigue pasando, avisale a la oficina.`
            : ''),
        [
          { text: 'Ver el recorrido', onPress: () => navigation.navigate('Recorrido') },
          { text: 'Listo', style: 'cancel' },
        ],
      )
    },
    onError: (e: Error) => Alert.alert('No pudimos armar el recorrido', e.message),
  })

  const verEnMaps = useMutation({
    mutationFn: async () => {
      if (!perfil) throw new Error('No hay sesión')
      const jornada = await obtenerJornadaDeHoy(perfil.id)
      if (!jornada || jornada.paradas.length === 0) {
        throw new Error('Todavía no armaste el recorrido de hoy.')
      }
      const donde = await ubicacionActual()
      return previsualizarRecorrido(donde, jornada.paradas)
    },
    onSuccess: (r) => {
      // El techo es de Google, no nuestro: la URL universal acepta nueve
      // destinos intermedios y en el navegador del teléfono, tres. Decirlo es
      // mejor que abrir un mapa al que le faltan paradas sin avisar.
      if (r.abierto && r.incluidas < r.total) {
        Alert.alert(
          'Se abrió el trazado',
          `Google Maps admite ${r.incluidas} destinos por enlace y tu recorrido tiene ${r.total}. El resto se navega desde el mapa de la app, destino por destino.`,
        )
      }
    },
    onError: (e: Error) => Alert.alert('No pudimos abrir el mapa', e.message),
  })

  return (
    <Pantalla>
      <Encabezado />

      <Panel contentStyle={estilos.contenido}>
        <BarraPanel alVolver={() => navigation.goBack()} />
        <TituloPanel destacado={lista.length > 0 ? String(lista.length) : undefined}>
          CLIENTES DE HOY
        </TituloPanel>

        {isLoading ? (
          <Cargando texto="Buscando a quién te toca ver…" />
        ) : error ? (
          <>
            <Aviso tono="error" titulo="No pudimos traer la lista">
              Revisá la conexión. El plan sigue cargado: esto es un problema para leerlo.
            </Aviso>
            <BotonSecundario titulo="↻  Reintentar" alTocar={() => void refetch()} />
          </>
        ) : lista.length === 0 ? (
          <Vacio
            titulo="Hoy no te toca nadie"
            detalle="O ya visitaste a todos los que estaban para hoy, o la oficina todavía no cargó tu rol maestro."
            icono="✓"
          />
        ) : (
          <>
            <Text style={estilos.ayuda}>
              Tildá los que vas a hacer hoy. Arrancan todos sin tildar: la lista es lo que el plan
              sugiere, no lo que tenés que hacer sí o sí.
            </Text>

            {/*
              El aviso pasó de "atención" a "info" y dejó de ser una traba.
              Antes avisaba que esos clientes NO iban a poder entrar, que era el
              problema entero: el vendedor sabe dónde están, y la app le pedía
              primero la dirección exacta para recién después dejarlo armar el
              día. Ahora entran, así que lo único que hay que contarle es qué les
              va a pasar —van al final, y la ubicación queda cuando llega—, para
              que no le sorprenda el orden ni crea que se perdió alguno.
            */}
            {sinUbicar > 0 ? (
              <Aviso tono="info" titulo="Hay clientes sin ubicar">
                {`${sinUbicar} de estos todavía no están puestos en el mapa, pero tildalos igual: entran al recorrido, van al final de la lista, y la ubicación la guardás cuando llegás. Si preferís dejarla hecha ahora, tocá UBICAR en la fila.`}
              </Aviso>
            ) : null}

            <Pressable
              onPress={alternarTodos}
              accessibilityRole="button"
              style={({ pressed }) => [estilos.atajo, pressed && estilos.atajoTocado]}
            >
              <Text style={estilos.atajoTexto}>
                {todosElegidos ? 'Ninguno' : 'Tildar todos'}
              </Text>
            </Pressable>

            <View style={estilos.lista}>
              {lista.map((c) => (
                <Fila
                  key={c.cliente_id}
                  candidato={c}
                  elegido={elegidos.has(c.cliente_id)}
                  alTocar={() => alternar(c.cliente_id)}
                  alUbicar={() =>
                    // El camino para ubicarlo sigue estando, pero dejó de ser lo
                    // que pasa al tocar la fila: ahora cuelga del botón UBICAR,
                    // como una opción para el que quiera dejarlo resuelto antes
                    // de salir.
                    //
                    // El cliente viaja escrito: la fila ya lo nombra, y
                    // hacerlo buscar de nuevo en AGREGAR DESTINO sería no
                    // haberlo escuchado. Mismo patrón que CalendarioVisitas
                    // para "UBICARLO EN EL MAPA". `volverA` para caer de vuelta
                    // acá y no en el recorrido, donde quedaron otros tildados.
                    navigation.navigate('AgregarDestino', {
                      modo: 'existente',
                      buscarA: c.codigo ?? c.razon_social,
                      volverA: 'ClientesDelDia',
                    })
                  }
                />
              ))}
            </View>
          </>
        )}
      </Panel>

      {seleccionados.length > 0 ? (
        <Panel>
          <BotonMenu
            titulo={`ARMAR EL RECORRIDO\nCON ${seleccionados.length}`}
            alTocar={() => armar.mutate()}
            cargando={armar.isPending}
          />
        </Panel>
      ) : null}

      <Panel>
        <BotonSecundario
          titulo="🗺  Ver el recorrido de hoy en Google Maps"
          alTocar={() => verEnMaps.mutate()}
          cargando={verEnMaps.isPending}
        />
      </Panel>
    </Pantalla>
  )
}

function Fila({
  candidato,
  elegido,
  alTocar,
  alUbicar,
}: {
  candidato: CandidatoDelDia
  elegido: boolean
  alTocar: () => void
  alUbicar: () => void
}) {
  const { colores } = usarTema()
  const estilos = usarEstilos()
  const sinUbicar = candidato.lat === null

  return (
    <Pressable
      // Tocar la fila TILDA, esté el cliente en el mapa o no.
      //
      // Antes, si no tenía dirección, el toque se iba derecho a la pantalla de
      // ubicarlo. No era una ayuda, era el peaje: ubicarlo era la única forma de
      // que ese cliente entrara al recorrido. Eso es exactamente lo que el
      // vendedor pidió que se termine —"no me permite dejarlo en la lista sin
      // tener la dirección"—, y de paso era la única fila de la lista que hacía
      // algo distinto a las demás con el mismo gesto.
      //
      // Ahora todas las filas son el mismo casillero, y ubicarlo pasó a ser el
      // botón UBICAR de al lado, para el que quiera dejarlo hecho antes de salir.
      onPress={alTocar}
      // No se atenúa aunque esté sin ubicar: entra al recorrido igual que
      // cualquier otro, y el gris leería como "no se puede tocar". La pastilla
      // "SIN UBICAR" ya comunica el estado, que es información, no un freno.
      style={[estilos.fila, elegido && estilos.filaElegida]}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: elegido }}
    >
      <View style={[estilos.tilde, elegido && estilos.tildeMarcado]}>
        {elegido ? <Text style={estilos.tildeTexto}>✓</Text> : null}
      </View>

      <View style={estilos.datos}>
        <Text style={estilos.nombre}>
          {candidato.codigo ? `${candidato.codigo} · ` : ''}
          {candidato.razon_social}
        </Text>
        {candidato.direccion ? (
          <Text style={estilos.direccion} numberOfLines={1}>
            {candidato.direccion}
          </Text>
        ) : null}
        <View style={estilos.pastillas}>
          <Pastilla texto={`CADA ${candidato.cada_cuantos_dias} DÍAS`} color={colores.tintaSuave} />
          {/* Cuánto se pasó, no cuándo fue: "hace 22 días" dice si urge; una
              fecha obliga a sacar la cuenta. */}
          {candidato.dias_desde !== null ? (
            <Pastilla
              texto={`HACE ${candidato.dias_desde} DÍAS`}
              color={
                candidato.dias_desde > candidato.cada_cuantos_dias * 2
                  ? colores.rojoAccion
                  : colores.ambarOscuro
              }
            />
          ) : (
            <Pastilla texto="NUNCA VISITADO" color={colores.azul} />
          )}
          {sinUbicar ? <Pastilla texto="SIN UBICAR" color={colores.rojoAccion} /> : null}
        </View>
      </View>

      {/*
        El camino a ubicarlo, ahora al costado y no encima del toque de la fila.
        Es un Pressable adentro de otro: el de adentro se queda con el dedo, así
        que tocar UBICAR no tilda al cliente de yapa.

        Va visible y no en un toque largo a propósito. Un toque largo no se ve, y
        el que maneja la camioneta no va a descubrirlo solo; si el único camino
        para ubicar a un cliente es un gesto que nadie le contó, es lo mismo que
        haberlo sacado.
      */}
      {sinUbicar ? (
        <Pressable
          onPress={alUbicar}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`Ubicar a ${candidato.razon_social} en el mapa`}
          style={({ pressed }) => [estilos.ubicar, pressed && estilos.ubicarTocado]}
        >
          <Text style={estilos.ubicarTexto}>UBICAR</Text>
        </Pressable>
      ) : null}
    </Pressable>
  )
}

const usarEstilos = hojaDeTema((t) => ({
  contenido: { gap: espaciado.sm },
  ayuda: {
    fontFamily: t.tipografia.familia.liviana,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.tintaSuave,
  },
  lista: { gap: espaciado.xs },
  atajo: {
    minHeight: TOQUE_MINIMO,
    alignSelf: 'flex-end',
    justifyContent: 'center',
    paddingHorizontal: espaciado.xs,
  },
  atajoTocado: { opacity: 0.6 },
  atajoTexto: {
    fontFamily: t.tipografia.familia.fuerte,
    fontSize: t.tipografia.tamano.sm,
    color: t.colores.verdeOscuro,
    textDecorationLine: 'underline',
  },
  fila: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaciado.sm,
    backgroundColor: t.colores.panelClaro,
    borderRadius: radios.sm,
    padding: espaciado.sm,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  /*
   * `campoBlanco` y no `blanco`: el blanco puro es el mismo en los dos temas,
   * así que en el oscuro tildar un cliente lo pintaba de blanco y su razón
   * social —que sí sigue al tema— quedaba en 1,1:1. El cliente elegido era el
   * único que no se podía leer. `campoBlanco` es blanco en el tema claro y una
   * superficie oscura en el otro, así que el efecto es el mismo y la letra se
   * lee en los dos. Lo que marca cuál está elegido es el borde verde.
   */
  filaElegida: { borderColor: t.colores.verdeOscuro, backgroundColor: t.colores.campoBlanco },
  filaApagada: { opacity: 0.55 },
  /*
   * UBICAR: secundario a propósito. Contorno y letra chica, no un botón lleno,
   * porque en esta pantalla lo importante es tildar y salir; ubicar es lo que
   * hace el que tiene un minuto. Con `minHeight: TOQUE_MINIMO` para que se
   * pueda tocar con la camioneta en movimiento sin errarle al casillero.
   */
  ubicar: {
    minHeight: TOQUE_MINIMO,
    justifyContent: 'center',
    paddingHorizontal: espaciado.sm,
    borderRadius: radios.sm,
    borderWidth: 2,
    borderColor: t.colores.borde,
    backgroundColor: t.colores.campoBlanco,
  },
  ubicarTocado: { opacity: 0.65 },
  ubicarTexto: {
    fontFamily: t.tipografia.familia.subtitulo,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.rojo,
    letterSpacing: 0.5,
  },
  tilde: {
    width: 26,
    height: 26,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: t.colores.tintaTenue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tildeMarcado: { backgroundColor: t.colores.verdeOscuro, borderColor: t.colores.verdeOscuro },
  tildeTexto: { color: t.colores.blanco, fontFamily: t.tipografia.familia.fuerte, fontSize: 16 },
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
}))
