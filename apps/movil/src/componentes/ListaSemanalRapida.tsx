import { espaciado, radios, TOQUE_MINIMO } from '@woodtools/compartido'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Alert, Modal, Pressable, Text } from 'react-native'

import { agregarAListaSemanal, DIAS_ISO, nombreLargoDia } from '../servicios/agenda'
import { hojaDeTema } from '../nucleo/tema'

/**
 * "Agregar a mi lista semanal", en un solo lugar.
 *
 * El botón vive en dos pantallas —el detalle de una visita y los resultados del
 * buscador de "Agregar destino"— y en las dos hace lo mismo: elegir un día y
 * sumar el cliente a la lista de ese día. Para no tener dos copias del selector
 * y del aviso, el gancho junta el estado, la mutación y el modal.
 *
 * Se usa así:
 *
 *     const lista = usarListaSemanalRapida()
 *     // en un botón:  onPress={() => lista.abrir(clienteId, nombre)}
 *     // al final del render:  {lista.modal}
 */
export function usarListaSemanalRapida() {
  const consultas = useQueryClient()
  const [objetivo, setObjetivo] = useState<{ id: string; nombre: string } | null>(null)
  const estilos = usarEstilos()

  const agregar = useMutation({
    mutationFn: (v: { dia: number; clienteId: string; nombre: string }) =>
      agregarAListaSemanal(v.dia, v.clienteId),
    onSuccess: async (resultado, v) => {
      // Que la lista semanal y el calendario reflejen el cambio al volver.
      await consultas.invalidateQueries({ queryKey: ['lista-semanal', v.dia] })
      await consultas.invalidateQueries({ queryKey: ['agenda'] })
      const dias = nombreLargoDia(v.dia).toLowerCase()
      Alert.alert(
        resultado === 'agregado' ? 'Agregado a tu lista' : 'Ya estaba en la lista',
        resultado === 'agregado'
          ? `${v.nombre} va a aparecer como sugerido todos los ${dias} en el Calendario de visitas.`
          : `${v.nombre} ya estaba en tu lista de los ${dias}.`,
      )
    },
    onError: (e: Error) => Alert.alert('No pudimos agregarlo', e.message),
  })

  /** Abre el selector de día para ese cliente. */
  function abrir(clienteId: string, clienteNombre: string) {
    setObjetivo({ id: clienteId, nombre: clienteNombre })
  }

  const modal = (
    <Modal
      visible={!!objetivo}
      transparent
      animationType="fade"
      onRequestClose={() => setObjetivo(null)}
    >
      <Pressable style={estilos.velo} onPress={() => setObjetivo(null)} accessibilityLabel="Cerrar">
        <Pressable style={estilos.hoja} onPress={() => undefined}>
          <Text style={estilos.hojaTitulo} numberOfLines={3}>
            {`¿Qué día de la semana ves a ${objetivo?.nombre ?? 'este cliente'}?`}
          </Text>

          {DIAS_ISO.map((d) => (
            <Pressable
              key={d.iso}
              onPress={() => {
                const quien = objetivo
                setObjetivo(null)
                // El nombre viaja con la mutación: el modal ya se cerró y el
                // estado quedó en null, pero el aviso de éxito lo necesita.
                if (quien) agregar.mutate({ dia: d.iso, clienteId: quien.id, nombre: quien.nombre })
              }}
              accessibilityRole="button"
              accessibilityLabel={d.largo}
              style={({ pressed }) => [estilos.diaOpcion, pressed && estilos.tocado]}
            >
              <Text style={estilos.diaOpcionTexto}>{d.largo}</Text>
            </Pressable>
          ))}

          <Pressable
            onPress={() => setObjetivo(null)}
            accessibilityRole="button"
            style={({ pressed }) => [estilos.cancelar, pressed && estilos.tocado]}
          >
            <Text style={estilos.cancelarTexto}>VOLVER</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  )

  return { abrir, modal, agregando: agregar.isPending }
}

const usarEstilos = hojaDeTema((t) => ({
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
  diaOpcion: {
    minHeight: TOQUE_MINIMO,
    justifyContent: 'center',
    paddingHorizontal: espaciado.md,
    borderRadius: radios.sm,
    borderWidth: 2,
    borderColor: t.colores.borde,
    backgroundColor: t.colores.campoBlanco,
  },
  diaOpcionTexto: {
    fontFamily: t.tipografia.familia.fuerte,
    fontSize: t.tipografia.tamano.sm,
    color: t.colores.tinta,
    letterSpacing: 0.5,
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
  tocado: { opacity: 0.7 },
}))
