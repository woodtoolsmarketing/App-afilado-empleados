import {
  CLIENTE_NUEVO_VACIO,
  espaciado,
  validarClienteNuevo,
  type CampoClienteNuevo,
  type FormularioClienteNuevo,
} from '@woodtools/compartido'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Alert, KeyboardAvoidingView, Platform } from 'react-native'

import { BotonMenu } from '../componentes/Botones'
import { CamposClienteNuevo } from '../componentes/CamposClienteNuevo'
import { MensajeError } from '../componentes/Formulario'
import { Aviso } from '../componentes/Estado'
import { Encabezado } from '../componentes/Encabezado'
import { BarraPanel, Pantalla, Panel, TituloPanel } from '../componentes/Pantalla'
import { crearClienteProvisorio } from '../servicios/clientes'
import type { PropsPantalla } from '../navegacion/tipos'
import { hojaDeTema } from '../nucleo/tema'

/**
 * "GENERAR NUEVO CLIENTE"
 *
 * Se llega desde "¿Es nuevo cliente?" en la nota de pedido. Junta todo lo que
 * Administración va a necesitar para darlo de alta en el sistema, así no tienen
 * que llamar al vendedor para pedirle el CUIT o la dirección.
 *
 * El cliente se crea **provisorio**: existe con código automático, pero el
 * vendedor no lo va a encontrar en el buscador hasta que la oficina lo cargue
 * con su código definitivo. La nota que lo use igual se guarda; queda sin número
 * hasta que se complete el alta.
 *
 * Los campos son los mismos que en "CLIENTE NUEVO" del recorrido: viven en
 * `CamposClienteNuevo`.
 */
export function PantallaNuevoCliente({ navigation, route }: PropsPantalla<'NuevoCliente'>) {
  const estilos = usarEstilos()
  const cliente = useQueryClient()

  const [form, setForm] = useState<FormularioClienteNuevo>({
    ...CLIENTE_NUEVO_VACIO,
    // Si el vendedor ya había escrito algo en la nota, no se lo hacemos retipear.
    razon_social: route.params?.nombreInicial ?? '',
    documento: route.params?.documentoInicial ?? '',
  })
  const [errores, setErrores] = useState<Partial<Record<CampoClienteNuevo, string>>>({})
  const [intentado, setIntentado] = useState(false)

  function actualizar(cambios: Partial<FormularioClienteNuevo>) {
    setForm((previo) => {
      const nuevo = { ...previo, ...cambios }
      if (intentado) setErrores(validarClienteNuevo(nuevo).errores)
      return nuevo
    })
  }

  const guardar = useMutation({
    mutationFn: () => crearClienteProvisorio(form),
    onSuccess: async (nuevo) => {
      await cliente.invalidateQueries()
      Alert.alert(
        'Cliente creado',
        `${nuevo.razon_social} quedó cargado para que la oficina lo confirme.\n\nHasta que le asignen el código, no va a aparecer en el buscador y la nota queda sin número.`,
        [
          {
            text: 'Seguir con la nota',
            onPress: () =>
              navigation.navigate('GenerarNota', {
                paradaId: route.params?.paradaId,
                clienteCreadoId: nuevo.id,
                clienteCreadoNombre: nuevo.razon_social,
                clienteCreadoCuit: nuevo.cuit ?? '',
                clienteCreadoLocalidad: form.localidad ?? undefined,
                clienteCreadoProvincia: form.provincia ?? undefined,
                clienteCreadoDireccion: form.direccion || undefined,
              }),
          },
        ],
      )
    },
    onError: (e: Error) => Alert.alert('No pudimos crear el cliente', e.message),
  })

  function alGenerar() {
    if (guardar.isPending || guardar.isSuccess) return
    setIntentado(true)
    const { valido, errores: nuevos } = validarClienteNuevo(form)
    setErrores(nuevos)
    if (valido) guardar.mutate()
  }

  return (
    <Pantalla>
      <Encabezado />

      <KeyboardAvoidingView
        style={estilos.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Panel contentStyle={estilos.contenido}>
          <BarraPanel alVolver={() => navigation.goBack()} />

          <TituloPanel>{'GENERAR NUEVO\nCLIENTE'}</TituloPanel>

          <CamposClienteNuevo form={form} actualizar={actualizar} errores={errores} />

          <MensajeError>
            {intentado && Object.keys(errores).length > 0
              ? 'Revisá los campos marcados en rojo.'
              : undefined}
          </MensajeError>

          <Aviso tono="info">
            El cliente queda para que Administración lo confirme. Hasta entonces no aparece en el
            buscador y la nota de pedido no recibe su número.
          </Aviso>

          <BotonMenu
            titulo={'GENERAR\nNUEVO CLIENTE'}
            alTocar={alGenerar}
            cargando={guardar.isPending}
          />
        </Panel>
      </KeyboardAvoidingView>
    </Pantalla>
  )
}

const usarEstilos = hojaDeTema(() => ({
  flex: { flex: 1 },
  contenido: { gap: espaciado.md },
}))
