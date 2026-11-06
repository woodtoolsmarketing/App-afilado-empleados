import {
  CLIENTE_NUEVO_VACIO,
  espaciado,
  validarClienteNuevo,
  type CampoClienteNuevo,
  type FormularioClienteNuevo,
} from '@woodtools/compartido'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Alert, ScrollView } from 'react-native'

import { BotonMenu } from '../componentes/Botones'
import { CamposClienteNuevo } from '../componentes/CamposClienteNuevo'
import { Aviso, Cargando } from '../componentes/Estado'
import { Encabezado } from '../componentes/Encabezado'
import { BarraPanel, Pantalla, Panel, TituloPanel } from '../componentes/Pantalla'
import {
  editarClienteProvisorio,
  fichaProvisorioParaEditar,
  formularioDesdeFichaProvisorio,
} from '../servicios/clientes'
import type { PropsPantalla } from '../navegacion/tipos'
import { hojaDeTema } from '../nucleo/tema'

/**
 * Editar un cliente PROVISORIO recién cargado, desde el recorrido.
 *
 * El vendedor carga un cliente nuevo "a mano" y, si se da cuenta de que se
 * equivocó en un dato, lo corrige acá —con el MISMO formulario que el alta—. La
 * edición vive sólo mientras la ficha sigue provisoria: apenas la oficina le
 * pone el código real, la base la cierra (y esta pantalla lo avisa).
 *
 * El chequeo de duplicados del formulario se apaga a propósito: el cliente ya
 * está en el padrón (es provisorio) y, prendido, se encontraría a sí mismo.
 */
export function PantallaEditarProspecto({ route, navigation }: PropsPantalla<'EditarProspecto'>) {
  const estilos = usarEstilos()
  const clienteQuery = useQueryClient()
  const clienteId = route.params.clienteId

  const [form, setForm] = useState<FormularioClienteNuevo>(CLIENTE_NUEVO_VACIO)
  const [errores, setErrores] = useState<Partial<Record<CampoClienteNuevo, string>>>({})
  const [intentado, setIntentado] = useState(false)

  const ficha = useQuery({
    queryKey: ['ficha-provisorio', clienteId],
    queryFn: () => fichaProvisorioParaEditar(clienteId),
  })

  // Apenas llega la ficha, precargar el formulario con lo que ya hay cargado.
  useEffect(() => {
    if (ficha.data) setForm(formularioDesdeFichaProvisorio(ficha.data))
  }, [ficha.data])

  const guardar = useMutation({
    mutationFn: () => editarClienteProvisorio(clienteId, form),
    onSuccess: async () => {
      // Cambió la ficha del cliente: el recorrido (y lo que dependa de él) tiene
      // que volver a leerla para mostrar los datos corregidos.
      await clienteQuery.invalidateQueries()
      Alert.alert('Datos corregidos', `Se guardaron los cambios de ${form.razon_social}.`)
      navigation.goBack()
    },
    onError: (e: Error) => Alert.alert('No pudimos guardar los cambios', e.message),
  })

  function actualizar(cambios: Partial<FormularioClienteNuevo>) {
    setForm((f) => ({ ...f, ...cambios }))
  }

  function alGuardar() {
    if (guardar.isPending) return
    setIntentado(true)
    const { valido, errores: nuevos } = validarClienteNuevo(form)
    setErrores(nuevos)
    if (valido) guardar.mutate()
  }

  return (
    <Pantalla>
      <Encabezado />

      <Panel desplazable={false} contentStyle={estilos.marco}>
        <BarraPanel alVolver={() => navigation.goBack()} />
        <TituloPanel unaLinea>EDITAR PROSPECTO</TituloPanel>

        {ficha.isLoading ? (
          <Cargando />
        ) : ficha.isError ? (
          <Aviso tono="atencion" titulo="No pudimos cargar la ficha">
            Revisá la señal y volvé a intentar.
          </Aviso>
        ) : !ficha.data ? (
          <Aviso tono="atencion" titulo="No se puede editar">
            Este cliente ya fue confirmado por la oficina (o no lo cargaste vos), así que sus datos
            ya no se editan desde la app.
          </Aviso>
        ) : (
          <>
            {/* Lo único que se desplaza: el formulario. El botón de guardar queda
                fijo al pie, siempre a la vista. */}
            <ScrollView
              style={estilos.zona}
              contentContainerStyle={estilos.zonaContenido}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <CamposClienteNuevo
                form={form}
                actualizar={actualizar}
                errores={intentado ? errores : {}}
                chequearDuplicados={false}
              />
            </ScrollView>

            <BotonMenu titulo="GUARDAR CAMBIOS" alTocar={alGuardar} cargando={guardar.isPending} />
          </>
        )}
      </Panel>
    </Pantalla>
  )
}

const usarEstilos = hojaDeTema(() => ({
  marco: {
    flex: 1,
    paddingHorizontal: espaciado.base,
    paddingTop: espaciado.md,
    paddingBottom: espaciado.md,
    gap: espaciado.md,
  },
  zona: { flex: 1 },
  zonaContenido: { gap: espaciado.md, paddingBottom: espaciado.sm },
}))
