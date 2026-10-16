import { espaciado, radios, type ClienteBuscado } from '@woodtools/compartido'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from 'react-native'

import { BotonSecundario } from './Botones'
import { Aviso } from './Estado'
import { Campo } from './Formulario'
import { Pantalla, Panel, TituloPanel } from './Pantalla'
import { usarSesion } from '../nucleo/sesion'
import { buscarClientes, ESPERA_TECLEO } from '../servicios/clientes'
import { obtenerJornadaDe } from '../servicios/jornada'
import { hojaDeTema } from '../nucleo/tema'

/** Un cliente elegido para cobrarle: `id` null = cargado a mano (no está en el padrón). */
type ClienteElegido = { id: string | null; codigo: string | null; nombre: string }

/**
 * Elegir a quién cobrarle, para el alta suelta de cobranza (AGREGAR COBRANZA).
 *
 * Arranca mostrando a los clientes que el vendedor VISITÓ ese día: el cobro que
 * se olvidó es, casi siempre, de alguien que ya vio, así que lo elige de esa
 * lista sin buscar. Si no está ahí —cobró a otro, o es de otro día—, el buscador
 * de arriba encuentra cualquier cliente del padrón (`buscar_clientes`, tolera
 * acentos y typos); y si no está ni en el padrón (una factura vieja), se carga
 * con el nombre a mano.
 */
export function BuscarClienteModal({
  visible,
  fecha,
  alElegir,
  alCerrar,
}: {
  visible: boolean
  /** El día que se está mirando en COBRANZAS: de ahí salen los visitados. */
  fecha: string
  alElegir: (cliente: ClienteElegido) => void
  alCerrar: () => void
}) {
  const estilos = usarEstilos()
  const perfilId = usarSesion((s) => s.perfil?.id)
  const [consulta, setConsulta] = useState('')
  const [resultados, setResultados] = useState<ClienteBuscado[]>([])
  const [buscando, setBuscando] = useState(false)
  const [fallo, setFallo] = useState<string | null>(null)
  const [consultaBuscada, setConsultaBuscada] = useState('')
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Sólo la última búsqueda puede dibujar: tipear un código son varias búsquedas
  // que vuelven en cualquier orden.
  const vigente = useRef(0)

  // Los clientes visitados ese día: la lista principal del picker. Se trae sólo
  // mientras el modal está abierto.
  const { data: jornada, isLoading: cargandoVisitados } = useQuery({
    queryKey: ['cobro-clientes-visitados', perfilId, fecha],
    queryFn: () => obtenerJornadaDe(perfilId as string, fecha),
    enabled: visible && !!perfilId,
  })

  const visitados = useMemo(() => {
    const vistos = new Map<string, ClienteElegido>()
    for (const p of jornada?.paradas ?? []) {
      // "Ya visitado" de verdad: el parte quedó cerrado como visitado. Sin
      // cliente del padrón no hay a quién cobrarle desde acá. Uno por cliente,
      // aunque tenga varias sucursales en el recorrido.
      if (p.visita?.visitado !== true || !p.cliente_id || vistos.has(p.cliente_id)) continue
      vistos.set(p.cliente_id, {
        id: p.cliente_id,
        codigo: p.cliente?.codigo ?? null,
        nombre: p.cliente?.razon_social ?? p.razon_social_snapshot ?? 'Cliente',
      })
    }
    return [...vistos.values()]
  }, [jornada])

  // Al abrir de nuevo, arranca limpio: un cobro no hereda la búsqueda del anterior.
  useEffect(() => {
    if (!visible) return
    setConsulta('')
    setResultados([])
    setBuscando(false)
    setFallo(null)
    setConsultaBuscada('')
  }, [visible])

  async function buscar(texto: string) {
    const mia = ++vigente.current
    setBuscando(true)
    setFallo(null)
    try {
      const encontrados = await buscarClientes(texto)
      if (mia !== vigente.current) return
      setResultados(encontrados)
      setConsultaBuscada(texto)
    } catch (e) {
      if (mia !== vigente.current) return
      setResultados([])
      setFallo((e as Error).message)
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
      setFallo(null)
      setConsultaBuscada('')
      return
    }
    temporizador.current = setTimeout(() => void buscar(consulta.trim()), ESPERA_TECLEO)
    return () => {
      if (temporizador.current) clearTimeout(temporizador.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consulta])

  // Con 2+ letras tipeadas, el picker pasa de "visitados" a buscar en el padrón.
  const modoBusqueda = consulta.trim().length >= 2
  const sinResultados = modoBusqueda && !buscando && !fallo && resultados.length === 0 && consultaBuscada

  // El nombre a mano, para un cobro de alguien que no está en el padrón (una
  // factura vieja, algo sin ficha). Se habilita con un nombre de verdad —al menos
  // tres caracteres y alguna letra— para no cargar un pedazo de código como nombre.
  const textoManual = consulta.trim()
  const puedeCargarAMano = textoManual.length >= 3 && /[a-zA-ZÀ-ÿ]/.test(textoManual)

  function Fila({ cliente }: { cliente: ClienteElegido; direccion?: string | null }) {
    return (
      <Pressable
        onPress={() => alElegir(cliente)}
        accessibilityRole="button"
        accessibilityLabel={`Cobrarle a ${cliente.nombre}`}
        style={({ pressed }) => [estilos.fila, pressed && estilos.filaTocada]}
      >
        <Text style={estilos.filaNombre}>
          {cliente.codigo ? `${cliente.codigo} · ` : ''}
          {cliente.nombre}
        </Text>
      </Pressable>
    )
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={alCerrar}>
      <Pantalla>
        <Panel desplazable={false} contentStyle={estilos.contenido}>
          <TituloPanel>{'¿A QUIÉN\nLE COBRASTE?'}</TituloPanel>

          <Campo
            placeholder="Buscá otro cliente o escribí un nombre"
            value={consulta}
            onChangeText={setConsulta}
            autoCapitalize="none"
            autoCorrect={false}
          />

          <ScrollView
            style={estilos.cuerpo}
            contentContainerStyle={estilos.cuerpoContenido}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {modoBusqueda ? (
              // ── Buscando en el padrón ──
              buscando ? (
                <View style={estilos.cargando}>
                  <ActivityIndicator />
                </View>
              ) : fallo ? (
                <Aviso tono="error" titulo="No pudimos buscar">
                  Puede ser la señal. Probá de nuevo.
                </Aviso>
              ) : (
                <>
                  {resultados.map((c) => (
                    <Pressable
                      key={c.cliente_id}
                      onPress={() =>
                        alElegir({ id: c.cliente_id, codigo: c.codigo, nombre: c.razon_social })
                      }
                      accessibilityRole="button"
                      accessibilityLabel={`Cobrarle a ${c.razon_social}`}
                      style={({ pressed }) => [estilos.fila, pressed && estilos.filaTocada]}
                    >
                      <Text style={estilos.filaNombre}>
                        {c.codigo ? `${c.codigo} · ` : ''}
                        {c.razon_social}
                      </Text>
                      {c.direccion ? (
                        <Text style={estilos.filaDireccion} numberOfLines={1}>
                          {c.direccion}
                        </Text>
                      ) : null}
                    </Pressable>
                  ))}

                  {sinResultados ? (
                    <Aviso tono="info">
                      Ningún cliente coincide con “{textoManual}”. Podés cargarlo a mano abajo.
                    </Aviso>
                  ) : null}

                  {/* El cliente no está en el padrón (una factura vieja, algo sin
                      ficha): se cobra con el nombre tal cual, sin código. */}
                  {puedeCargarAMano ? (
                    <Pressable
                      onPress={() => alElegir({ id: null, codigo: null, nombre: textoManual })}
                      accessibilityRole="button"
                      accessibilityLabel={`Cobrarle a ${textoManual}, con el nombre a mano`}
                      style={({ pressed }) => [estilos.manual, pressed && estilos.filaTocada]}
                    >
                      <Text style={estilos.manualNombre}>＋ Cobrarle a “{textoManual}”</Text>
                      <Text style={estilos.manualAyuda}>
                        No está en la lista: se carga con el nombre a mano, sin código.
                      </Text>
                    </Pressable>
                  ) : null}
                </>
              )
            ) : // ── Por defecto: los clientes que visitó ese día ──
            cargandoVisitados ? (
              <View style={estilos.cargando}>
                <ActivityIndicator />
              </View>
            ) : visitados.length > 0 ? (
              <>
                <Text style={estilos.rotulo}>CLIENTES QUE VISITASTE</Text>
                {visitados.map((c) => (
                  <Fila key={c.id ?? c.nombre} cliente={c} />
                ))}
              </>
            ) : (
              <Aviso tono="info">
                No hay visitas ese día. Buscá el cliente arriba por código o nombre, o escribí el
                nombre para cargarlo a mano.
              </Aviso>
            )}
          </ScrollView>

          <BotonSecundario titulo="Cancelar" alTocar={alCerrar} />
        </Panel>
      </Pantalla>
    </Modal>
  )
}

const usarEstilos = hojaDeTema((t) => ({
  contenido: { flex: 1, padding: espaciado.base, gap: espaciado.base },
  cuerpo: { flex: 1 },
  cuerpoContenido: { gap: espaciado.xs, paddingBottom: espaciado.xs },
  cargando: { paddingVertical: espaciado.lg, alignItems: 'center' },
  rotulo: {
    fontFamily: t.tipografia.familia.subtitulo,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.tintaSuave,
    letterSpacing: 0.5,
    marginBottom: espaciado.xs,
  },
  fila: {
    backgroundColor: t.colores.panelClaro,
    borderRadius: radios.sm,
    padding: espaciado.sm,
    gap: 2,
  },
  filaTocada: { opacity: 0.6 },
  filaNombre: {
    fontFamily: t.tipografia.familia.fuerte,
    fontSize: t.tipografia.tamano.sm,
    color: t.colores.tinta,
  },
  filaDireccion: {
    fontFamily: t.tipografia.familia.liviana,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.tintaSuave,
  },
  // El "cargar a mano": se distingue de los resultados con el borde punteado del
  // verde de la marca, para que se lea como una acción y no como un cliente más.
  manual: {
    borderRadius: radios.sm,
    borderWidth: 2,
    borderColor: t.colores.verdeOscuro,
    borderStyle: 'dashed',
    padding: espaciado.sm,
    gap: 2,
    marginTop: espaciado.xs,
  },
  manualNombre: {
    fontFamily: t.tipografia.familia.fuerte,
    fontSize: t.tipografia.tamano.sm,
    color: t.colores.verdeOscuro,
  },
  manualAyuda: {
    fontFamily: t.tipografia.familia.liviana,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.tintaSuave,
  },
}))
