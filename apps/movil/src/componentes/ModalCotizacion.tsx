import { espaciado } from '@woodtools/compartido'
import { useEffect, useState } from 'react'
import { Modal, Pressable, ScrollView, Text, View } from 'react-native'

import { BotonMenu, BotonSecundario } from './Botones'
import { Campo } from './Formulario'
import { BarraPanel, Pantalla, Panel, TituloPanel } from './Pantalla'
import { hojaDeTema } from '../nucleo/tema'

interface FilaCotizacion {
  herramienta: string
  cantidad: string
}

/**
 * Popup para registrar lo que el vendedor COTIZÓ en la visita.
 *
 * Una lista de herramienta + cantidad, con "añadir más" (como la carga de un
 * cobro). Al confirmar devuelve el texto ya armado ("2 Sierra 300; 1 Fresa
 * recta"), que el parte suma a la observación de la visita —así queda en el rol
 * y la oficina ve qué se cotizó, aunque no haya terminado en una nota—.
 */
export function ModalCotizacion({
  visible,
  alCerrar,
  alConfirmar,
}: {
  visible: boolean
  alCerrar: () => void
  /** El texto armado de la cotización. Vacío nunca (se deshabilita LISTO). */
  alConfirmar: (texto: string) => void
}) {
  const estilos = usarEstilos()
  const [filas, setFilas] = useState<FilaCotizacion[]>([{ herramienta: '', cantidad: '' }])

  // Cada vez que se abre arranca en blanco: una cotización no hereda la anterior.
  useEffect(() => {
    if (visible) setFilas([{ herramienta: '', cantidad: '' }])
  }, [visible])

  function cambiar(i: number, cambios: Partial<FilaCotizacion>) {
    setFilas((f) => f.map((fila, idx) => (idx === i ? { ...fila, ...cambios } : fila)))
  }
  function agregar() {
    setFilas((f) => [...f, { herramienta: '', cantidad: '' }])
  }
  function quitar(i: number) {
    setFilas((f) => (f.length > 1 ? f.filter((_, idx) => idx !== i) : f))
  }

  const validas = filas.filter((f) => f.herramienta.trim())

  function confirmar() {
    const texto = validas
      .map((f) => `${f.cantidad.trim() ? f.cantidad.trim() + ' ' : ''}${f.herramienta.trim()}`)
      .join('; ')
    alConfirmar(texto)
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={alCerrar}>
      <Pantalla>
        <Panel desplazable={false} contentStyle={estilos.marco}>
          <BarraPanel alVolver={alCerrar} />
          <TituloPanel unaLinea>COTIZÓ</TituloPanel>
          <Text style={estilos.ayuda}>
            Qué le cotizaste: herramienta y cantidad. Sumá las que hagan falta; va a la observación
            de la visita.
          </Text>

          <ScrollView
            style={estilos.zona}
            contentContainerStyle={estilos.zonaContenido}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {filas.map((f, i) => (
              <View key={i} style={estilos.fila}>
                <View style={estilos.flex}>
                  <Campo
                    etiqueta={i === 0 ? 'HERRAMIENTA' : undefined}
                    value={f.herramienta}
                    onChangeText={(t) => cambiar(i, { herramienta: t })}
                    placeholder="Ej. Sierra 300, Fresa recta"
                    autoCapitalize="words"
                  />
                </View>
                <View style={estilos.cant}>
                  <Campo
                    etiqueta={i === 0 ? 'CANT.' : undefined}
                    value={f.cantidad}
                    onChangeText={(t) => cambiar(i, { cantidad: t.replace(/[^\d]/g, '') })}
                    placeholder="1"
                    keyboardType="number-pad"
                  />
                </View>
                {filas.length > 1 ? (
                  <Pressable
                    onPress={() => quitar(i)}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={`Quitar el renglón ${i + 1}`}
                    style={({ pressed }) => [estilos.quitar, pressed && estilos.tocado]}
                  >
                    <Text style={estilos.quitarTexto}>−</Text>
                  </Pressable>
                ) : null}
              </View>
            ))}

            <BotonSecundario titulo="＋ AÑADIR OTRA" alTocar={agregar} />
          </ScrollView>

          <BotonMenu titulo="LISTO" alTocar={confirmar} deshabilitado={validas.length === 0} />
        </Panel>
      </Pantalla>
    </Modal>
  )
}

const usarEstilos = hojaDeTema((t) => ({
  marco: {
    flex: 1,
    paddingHorizontal: espaciado.base,
    paddingTop: espaciado.md,
    paddingBottom: espaciado.md,
    gap: espaciado.md,
  },
  ayuda: {
    fontFamily: t.tipografia.familia.liviana,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.tintaSuave,
  },
  zona: { flex: 1 },
  zonaContenido: { gap: espaciado.sm, paddingBottom: espaciado.sm },
  flex: { flex: 1 },
  cant: { width: 80 },
  fila: { flexDirection: 'row', gap: espaciado.sm, alignItems: 'flex-start' },
  quitar: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-end',
  },
  quitarTexto: { fontFamily: t.tipografia.familia.titulo, fontSize: 24, color: t.colores.tinta },
  tocado: { opacity: 0.6 },
}))
