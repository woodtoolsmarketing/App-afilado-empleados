import { espaciado, radios, type ClienteBuscado } from '@woodtools/compartido'
import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from 'react-native'

import { BotonSecundario } from './Botones'
import { Aviso } from './Estado'
import { Campo } from './Formulario'
import { Pantalla, Panel, TituloPanel } from './Pantalla'
import { buscarClientes, ESPERA_TECLEO } from '../servicios/clientes'
import { hojaDeTema } from '../nucleo/tema'

/**
 * Elegir un cliente buscándolo por código o razón social.
 *
 * Lo usa el alta suelta de cobranza (AGREGAR COBRANZA), donde no se parte de una
 * parada ni de una nota, así que el cliente hay que buscarlo. Es la misma función
 * de búsqueda del resto de la app (`buscar_clientes`, tolera acentos y typos), con
 * el mismo arreglo de "sólo la última búsqueda dibuja" para que tipear rápido no
 * deje una lista vieja arriba de la elegida.
 */
export function BuscarClienteModal({
  visible,
  alElegir,
  alCerrar,
}: {
  visible: boolean
  alElegir: (cliente: { id: string; codigo: string | null; nombre: string }) => void
  alCerrar: () => void
}) {
  const estilos = usarEstilos()
  const [consulta, setConsulta] = useState('')
  const [resultados, setResultados] = useState<ClienteBuscado[]>([])
  const [buscando, setBuscando] = useState(false)
  const [fallo, setFallo] = useState<string | null>(null)
  const [consultaBuscada, setConsultaBuscada] = useState('')
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Sólo la última búsqueda puede dibujar: tipear un código son varias búsquedas
  // que vuelven en cualquier orden.
  const vigente = useRef(0)

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

  const sinResultados =
    consulta.trim().length >= 2 && !buscando && !fallo && resultados.length === 0 && consultaBuscada

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={alCerrar}>
      <Pantalla>
        <Panel desplazable={false} contentStyle={estilos.contenido}>
          <TituloPanel>{'¿A QUIÉN\nLE COBRASTE?'}</TituloPanel>

          <Campo
            placeholder="Buscá por código o razón social"
            value={consulta}
            onChangeText={setConsulta}
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
          />

          <ScrollView
            style={estilos.cuerpo}
            contentContainerStyle={estilos.cuerpoContenido}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {buscando ? (
              <View style={estilos.cargando}>
                <ActivityIndicator />
              </View>
            ) : fallo ? (
              <Aviso tono="error" titulo="No pudimos buscar">
                Puede ser la señal. Probá de nuevo.
              </Aviso>
            ) : sinResultados ? (
              <Aviso tono="info">
                Ningún cliente coincide con “{consulta.trim()}”. Probá con otro nombre o código.
              </Aviso>
            ) : (
              resultados.map((c) => (
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
              ))
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
}))
