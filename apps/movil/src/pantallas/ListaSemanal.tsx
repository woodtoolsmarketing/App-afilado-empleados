import { espaciado, radios, type ClienteBuscado } from '@woodtools/compartido'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native'

import { BotonMenu, BotonSecundario } from '../componentes/Botones'
import { Campo } from '../componentes/Formulario'
import { Aviso, Cargando, Pastilla, Vacio } from '../componentes/Estado'
import { Encabezado } from '../componentes/Encabezado'
import { BarraPanel, Pantalla, Panel, TituloPanel } from '../componentes/Pantalla'
import { buscarClientes, ESPERA_TECLEO, LIMITE_CLIENTES } from '../servicios/clientes'
import {
  DIAS_ISO,
  guardarListaSemanal,
  isodowDeHoy,
  listaSemanalDe,
  nombreLargoDia,
  type ClienteDeLista,
} from '../servicios/agenda'
import type { PropsPantalla } from '../navegacion/tipos'
import { hojaDeTema, usarTema } from '../nucleo/tema'

/**
 * "LISTA SEMANAL"
 *
 * A quién visita el vendedor cada día de la semana, fijo. La arma, la edita y la
 * borra él.
 *
 * ── Qué hace, y qué no ──────────────────────────────────────────────────────
 *
 * No crea paradas ni recorridos. Es una lista fija por día que se repite todas
 * las semanas: lo que se ponga acá aparece en el CALENDARIO DE VISITAS como
 * SUGERIDO ese día, igual que lo que propone la oficina, y el vendedor decide
 * ahí si lo agenda. Así una semana en la que no sale a la calle no queda con
 * destinos que nunca visitó.
 *
 * ── Un día por vez ──────────────────────────────────────────────────────────
 *
 * Se elige el día arriba y se edita SU lista. Guardar reemplaza la de ese día.
 * Cambiar de día o salir con cambios sin guardar avisa: la lista de un día es
 * chica pero rehacerla es tan molesto como perder cualquier otra carga.
 */
export function PantallaListaSemanal({ navigation, route }: PropsPantalla<'ListaSemanal'>) {
  const { colores } = usarTema()
  const estilos = usarEstilos()
  const consultas = useQueryClient()

  const [dia, setDia] = useState<number>(route.params?.diaSemana ?? isodowDeHoy())

  const { data: guardada, isLoading, error, refetch } = useQuery({
    queryKey: ['lista-semanal', dia],
    queryFn: () => listaSemanalDe(dia),
  })

  /**
   * Lo que se está editando para el día elegido.
   *
   * `base` es lo último guardado (o traído): comparar contra él dice si hay
   * cambios sin guardar. Los dos se siembran cuando llega la consulta del día.
   */
  const [elegidos, setElegidos] = useState<ClienteDeLista[]>([])
  const [base, setBase] = useState('')

  useEffect(() => {
    if (!guardada) return
    setElegidos(guardada)
    setBase(guardada.map((c) => c.cliente_id).join(','))
  }, [guardada])

  const claveActual = elegidos.map((c) => c.cliente_id).join(',')
  const hayCambios = claveActual !== base

  // ── Buscador de clientes para agregar ──────────────────────────────────────
  const [consulta, setConsulta] = useState('')
  const [resultados, setResultados] = useState<ClienteBuscado[]>([])
  const [buscando, setBuscando] = useState(false)
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Sólo la última búsqueda puede dibujar: las viejas vuelven en cualquier orden. */
  const vigente = useRef(0)

  async function buscar(texto: string) {
    const mia = ++vigente.current
    setBuscando(true)
    try {
      const encontrados = await buscarClientes(texto)
      if (mia !== vigente.current) return
      setResultados(encontrados)
    } catch {
      if (mia === vigente.current) setResultados([])
    } finally {
      if (mia === vigente.current) setBuscando(false)
    }
  }

  useEffect(() => {
    if (temporizador.current) clearTimeout(temporizador.current)
    if (consulta.trim().length < 2) {
      vigente.current++
      setResultados([])
      setBuscando(false)
      return
    }
    temporizador.current = setTimeout(() => void buscar(consulta.trim()), ESPERA_TECLEO)
    return () => {
      if (temporizador.current) clearTimeout(temporizador.current)
    }
  }, [consulta])

  function agregar(c: ClienteBuscado) {
    setConsulta('')
    setResultados([])
    vigente.current++
    setElegidos((prev) => {
      if (prev.some((e) => e.cliente_id === c.cliente_id)) return prev
      return [
        ...prev,
        {
          cliente_id: c.cliente_id,
          codigo: c.codigo,
          razon_social: c.razon_social,
          direccion: c.direccion,
          lat: c.lat,
          lng: c.lng,
          orden: prev.length + 1,
        },
      ]
    })
  }

  function quitar(clienteId: string) {
    setElegidos((prev) => prev.filter((e) => e.cliente_id !== clienteId))
  }

  const guardar = useMutation({
    mutationFn: () => guardarListaSemanal(dia, elegidos.map((c) => c.cliente_id)),
    onSuccess: async () => {
      // Queda guardado: ya no hay cambios pendientes, y el calendario tiene que
      // reflejar las nuevas sugerencias.
      setBase(claveActual)
      await consultas.invalidateQueries({ queryKey: ['lista-semanal', dia] })
      await consultas.invalidateQueries({ queryKey: ['agenda'] })
      Alert.alert(
        'Lista guardada',
        `Tu lista de los ${nombreLargoDia(dia).toLowerCase()} quedó con ${elegidos.length} cliente${
          elegidos.length === 1 ? '' : 's'
        }. Va a aparecer como sugerida en el calendario todas las semanas.`,
      )
    },
    onError: (e: Error) => Alert.alert('No pudimos guardar la lista', e.message),
  })

  /** Cambiar de día o salir con cambios sin guardar avisa antes de perderlos. */
  function conCuidado(accion: () => void) {
    if (!hayCambios) {
      accion()
      return
    }
    Alert.alert(
      'Tenés cambios sin guardar',
      `La lista de los ${nombreLargoDia(dia).toLowerCase()} tiene cambios que no guardaste.`,
      [
        { text: 'Seguir editando', style: 'cancel' },
        { text: 'Descartar', style: 'destructive', onPress: accion },
      ],
    )
  }

  function cambiarDia(nuevo: number) {
    if (nuevo === dia) return
    conCuidado(() => setDia(nuevo))
  }

  // El botón de atrás no puede tirar lo editado sin avisar.
  useEffect(() => {
    const quitarListener = navigation.addListener('beforeRemove', (e) => {
      if (!hayCambios) return
      e.preventDefault()
      Alert.alert(
        'Tenés cambios sin guardar',
        `La lista de los ${nombreLargoDia(dia).toLowerCase()} tiene cambios que no guardaste.`,
        [
          { text: 'Seguir editando', style: 'cancel' },
          { text: 'Salir sin guardar', style: 'destructive', onPress: () => navigation.dispatch(e.data.action) },
        ],
      )
    })
    return quitarListener
  }, [navigation, hayCambios, dia])

  const yaElegido = (id: string) => elegidos.some((e) => e.cliente_id === id)

  return (
    <Pantalla>
      <Encabezado />

      <KeyboardAvoidingView
        style={estilos.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Panel contentStyle={estilos.contenido}>
          <BarraPanel alVolver={() => navigation.goBack()} />
          <TituloPanel>{'LISTA\nSEMANAL'}</TituloPanel>

          <Aviso tono="info" titulo="Qué es esto">
            A quién visitás cada día, fijo. Se repite todas las semanas y aparece como sugerido en el
            Calendario de visitas, para que lo agendes cuando salgas. No arma el recorrido solo.
          </Aviso>

          {/* ── El día ──────────────────────────────────────────────────── */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={estilos.tira}
          >
            {DIAS_ISO.map((d) => (
              <Pressable
                key={d.iso}
                onPress={() => cambiarDia(d.iso)}
                accessibilityRole="button"
                accessibilityState={{ selected: d.iso === dia }}
                accessibilityLabel={d.largo}
                style={[estilos.dia, d.iso === dia && estilos.diaElegido]}
              >
                <Text style={[estilos.diaTexto, d.iso === dia && estilos.diaTextoElegido]}>
                  {d.corto}
                </Text>
              </Pressable>
            ))}
          </ScrollView>

          <Text style={estilos.diaTitulo}>Los {nombreLargoDia(dia).toLowerCase()}</Text>

          {/* ── Buscador para agregar ───────────────────────────────────── */}
          <Campo
            etiqueta="AGREGAR UN CLIENTE"
            value={consulta}
            onChangeText={setConsulta}
            placeholder="Buscá por código o razón social"
            autoCapitalize="characters"
            returnKeyType="search"
            accesorio={buscando ? <ActivityIndicator size="small" color={colores.rojo} /> : undefined}
          />

          {resultados.length > 0 ? (
            <View style={estilos.sugerencias}>
              {resultados.map((c) => {
                const puesto = yaElegido(c.cliente_id)
                return (
                  <Pressable
                    key={c.cliente_id}
                    onPress={() => (puesto ? undefined : agregar(c))}
                    disabled={puesto}
                    accessibilityRole="button"
                    accessibilityLabel={`${c.codigo ?? ''} ${c.razon_social}`}
                    style={({ pressed }) => [
                      estilos.sugerencia,
                      pressed && !puesto && estilos.sugerenciaTocada,
                      puesto && estilos.sugerenciaPuesta,
                    ]}
                  >
                    <View style={estilos.sugerenciaFila}>
                      {c.codigo ? <Text style={estilos.sugerenciaCodigo}>{c.codigo}</Text> : null}
                      {c.lat === null ? (
                        <Pastilla
                          texto={c.direccion ? 'SIN UBICAR' : 'SIN DIRECCIÓN'}
                          color={colores.rojoAccion}
                        />
                      ) : null}
                      {puesto ? <Pastilla texto="YA ESTÁ" color={colores.verdeOscuro} /> : null}
                    </View>
                    <Text style={estilos.sugerenciaPrincipal} numberOfLines={1}>
                      {c.razon_social}
                    </Text>
                    {c.direccion ? (
                      <Text style={estilos.sugerenciaSecundaria} numberOfLines={1}>
                        {c.direccion}
                      </Text>
                    ) : null}
                  </Pressable>
                )
              })}
            </View>
          ) : null}

          {resultados.length >= LIMITE_CLIENTES ? (
            <Aviso tono="atencion">
              {`Hay más de ${LIMITE_CLIENTES} que coinciden. Escribí un poco más para achicar la lista.`}
            </Aviso>
          ) : null}

          {/* ── La lista del día ────────────────────────────────────────── */}
          {isLoading ? (
            <Cargando texto="Buscando tu lista…" />
          ) : error ? (
            <>
              <Aviso tono="error" titulo="No pudimos traer tu lista">
                Revisá la conexión. Lo guardado sigue estando: esto es un problema para leerlo.
              </Aviso>
              <BotonSecundario titulo="↻  Reintentar" alTocar={() => void refetch()} />
            </>
          ) : elegidos.length === 0 ? (
            <Vacio
              titulo={`No hay nadie para los ${nombreLargoDia(dia).toLowerCase()}`}
              detalle="Buscá un cliente arriba y agregalo. Después tocá GUARDAR."
              icono="🗓"
            />
          ) : (
            <View style={estilos.lista}>
              {elegidos.map((c, i) => (
                <View key={c.cliente_id} style={estilos.fila}>
                  <Text style={estilos.filaNumero}>{i + 1}</Text>
                  <View style={estilos.datos}>
                    <Text style={estilos.nombre} numberOfLines={2}>
                      {c.codigo ? `${c.codigo} · ` : ''}
                      {c.razon_social}
                    </Text>
                    {c.direccion ? (
                      <Text style={estilos.direccion} numberOfLines={1}>
                        {c.direccion}
                      </Text>
                    ) : null}
                    {c.lat === null ? (
                      <View style={estilos.pastillas}>
                        <Pastilla texto="SIN UBICAR" color={colores.rojoAccion} />
                      </View>
                    ) : null}
                  </View>
                  <Pressable
                    onPress={() => quitar(c.cliente_id)}
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel={`Quitar ${c.razon_social}`}
                    style={({ pressed }) => [estilos.quitar, pressed && estilos.tocado]}
                  >
                    <Text style={estilos.quitarTexto}>✕</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          )}

          {elegidos.some((c) => c.lat === null) ? (
            <Aviso tono="atencion" titulo="Hay clientes sin ubicar">
              Los que están sin ubicar van a aparecer igual en el calendario, pero no se van a poder
              agendar hasta que les cargues la dirección en el mapa.
            </Aviso>
          ) : null}
        </Panel>

        <Panel>
          <BotonMenu
            titulo="GUARDAR LA LISTA"
            subtitulo={
              hayCambios
                ? `Los ${nombreLargoDia(dia).toLowerCase()}: ${elegidos.length} cliente${elegidos.length === 1 ? '' : 's'}`
                : 'Sin cambios para guardar'
            }
            alTocar={() => guardar.mutate()}
            cargando={guardar.isPending}
            deshabilitado={!hayCambios}
          />
        </Panel>
      </KeyboardAvoidingView>
    </Pantalla>
  )
}

const usarEstilos = hojaDeTema((t) => ({
  flex: { flex: 1 },
  contenido: { gap: espaciado.md },

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
  },
  diaElegido: { backgroundColor: t.colores.rojoSolido, borderColor: t.colores.borde },
  diaTexto: {
    fontFamily: t.tipografia.familia.subtitulo,
    fontSize: t.tipografia.tamano.sm,
    color: t.colores.tinta,
    letterSpacing: 0.5,
  },
  diaTextoElegido: { color: t.colores.blanco },

  diaTitulo: {
    fontFamily: t.tipografia.familia.subtitulo,
    fontSize: t.tipografia.tamano.base,
    color: t.colores.tinta,
    letterSpacing: 0.6,
  },

  sugerencias: {
    borderWidth: 2,
    borderColor: t.colores.borde,
    borderRadius: radios.sm,
    backgroundColor: t.colores.campoBlanco,
    overflow: 'hidden',
  },
  sugerencia: {
    paddingHorizontal: espaciado.md,
    paddingVertical: espaciado.md,
    borderBottomWidth: 1,
    borderBottomColor: t.colores.panelOscuro,
    minHeight: 60,
    justifyContent: 'center',
    gap: 2,
  },
  sugerenciaTocada: { backgroundColor: t.colores.panelClaro },
  sugerenciaPuesta: { opacity: 0.55 },
  sugerenciaFila: { flexDirection: 'row', alignItems: 'center', gap: espaciado.sm, flexWrap: 'wrap' },
  sugerenciaCodigo: {
    fontFamily: t.tipografia.familia.subtitulo,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.rojo,
  },
  sugerenciaPrincipal: {
    fontFamily: t.tipografia.familia.fuerte,
    fontSize: t.tipografia.tamano.sm,
    color: t.colores.tinta,
  },
  sugerenciaSecundaria: {
    fontFamily: t.tipografia.familia.liviana,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.tintaSuave,
  },

  lista: { gap: espaciado.xs },
  fila: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaciado.sm,
    backgroundColor: t.colores.panelClaro,
    borderRadius: radios.sm,
    padding: espaciado.sm,
    borderLeftWidth: 4,
    borderLeftColor: t.colores.azul,
  },
  filaNumero: {
    width: 22,
    textAlign: 'center',
    fontFamily: t.tipografia.familia.subtitulo,
    fontSize: t.tipografia.tamano.sm,
    color: t.colores.tintaSuave,
  },
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
  quitar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.colores.campoBlanco,
    borderWidth: 2,
    borderColor: t.colores.borde,
  },
  quitarTexto: {
    fontFamily: t.tipografia.familia.subtitulo,
    fontSize: t.tipografia.tamano.base,
    color: t.colores.rojoAccion,
  },
  tocado: { opacity: 0.65 },
}))
