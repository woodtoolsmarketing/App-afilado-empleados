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
  const sinUbicar = lista.filter((c) => c.lat === null).length
  const ubicados = lista.filter((c) => c.lat !== null)
  const todosUbicadosElegidos =
    ubicados.length > 0 && ubicados.every((c) => elegidos.has(c.cliente_id))

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
   */
  function alternarTodosLosUbicados() {
    setElegidos(todosUbicadosElegidos ? new Set() : new Set(ubicados.map((c) => c.cliente_id)))
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
          (perdidos > 0
            ? `\n\nNo entraron ${perdidos}: ${r.fallaron.map((f) => f.razon_social).join(', ')}. Están sin ubicar en el mapa.`
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

            {sinUbicar > 0 ? (
              <Aviso tono="atencion" titulo="Hay clientes sin ubicar">
                {`${sinUbicar} de estos no tienen dirección en el mapa y no pueden entrar al recorrido. Tocá el cliente para ubicarlo, o pedile a la oficina que le cargue la dirección.`}
              </Aviso>
            ) : null}

            {ubicados.length > 0 ? (
              <Pressable
                onPress={alternarTodosLosUbicados}
                accessibilityRole="button"
                style={({ pressed }) => [estilos.atajo, pressed && estilos.atajoTocado]}
              >
                <Text style={estilos.atajoTexto}>
                  {todosUbicadosElegidos ? 'Ninguno' : 'Tildar todos los ubicados'}
                </Text>
              </Pressable>
            ) : null}

            <View style={estilos.lista}>
              {lista.map((c) => (
                <Fila
                  key={c.cliente_id}
                  candidato={c}
                  elegido={elegidos.has(c.cliente_id)}
                  alTocar={() => alternar(c.cliente_id)}
                  alUbicar={() =>
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
      // Sin ubicar ya no es "deshabilitado": tocarlo lleva a ubicarlo en el
      // mapa en vez de tildarlo, así que no es un checkbox para esta fila.
      onPress={sinUbicar ? alUbicar : alTocar}
      // No se atenúa aunque esté sin ubicar: ahora es accionable (tocarla lleva
      // a ubicarla), y el gris de antes leía como "no se puede tocar". La
      // pastilla "SIN UBICAR" ya comunica el estado. Mismo criterio que CalendarioVisitas.
      style={[estilos.fila, elegido && estilos.filaElegida]}
      accessibilityRole={sinUbicar ? 'button' : 'checkbox'}
      accessibilityState={sinUbicar ? undefined : { checked: elegido }}
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
