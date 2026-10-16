import { aNumero, espaciado, formatearPesos, radios, soloNumeros } from '@woodtools/compartido'
import { useMutation } from '@tanstack/react-query'
import * as Crypto from 'expo-crypto'
import { useEffect, useRef, useState } from 'react'
import { Alert, Modal, ScrollView, Text, View } from 'react-native'

import { editarCobranza, registrarCobranza } from '../servicios/cobranzas'
import { hojaDeTema } from '../nucleo/tema'
import { BotonPrincipal, BotonSecundario } from './Botones'
import { Aviso } from './Estado'
import { Campo, Desplegable } from './Formulario'
import { Pantalla, Panel, TituloPanel } from './Pantalla'

/**
 * El cobro, cargado DESDE el rol de visita.
 *
 * ── Por qué a pantalla completa y sin scroll ────────────────────────────────
 *
 * Se abre al tildar "COBRÓ" en el parte. El cliente ya es el de la parada, así
 * que no se busca: entra arriba, de sólo lectura, y el vendedor sólo completa
 * contra qué cobra, cheque/efectivo y un comentario. Con esos pocos campos el
 * formulario entra entero en una pantalla y el vendedor no tiene que arrastrar
 * nada en la calle, con una mano.
 *
 * El título y los botones quedan FIJOS; los campos van en un ScrollView propio
 * (por eso el `Panel` va `desplazable={false}`, para no anidar dos scrolls). En
 * una pantalla normal no hay nada que arrastrar; pero cuando aparece el recuadro
 * "Total" o se abre el teclado, el cuerpo se achica y deja scrollear SÓLO los
 * campos, de modo que GUARDAR EL COBRO nunca queda tapado ni recortado (el panel
 * tiene `overflow: hidden`, así que un botón que se pase de alto no se podría
 * tocar).
 *
 * El total NO se pide: es la suma de cheque + efectivo (lo mismo que hacía la
 * pantalla "Cobranzas del día"), para que no quede abierta la puerta a que no
 * cierre contra el TOTAL de la planilla, que es lo que la oficina compara.
 */

/** "1.234,50" → 1234,5; descarta lo que no sea positivo. Igual que la vieja pantalla. */
function aPesos(texto: string): number {
  const n = aNumero(texto)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** Un monto de la base al texto del campo: 0 queda vacío (usa el placeholder). */
function aEntrada(n: number): string {
  return n > 0 ? String(n) : ''
}

/** Un cobro ya cargado que se está corrigiendo (no uno nuevo). */
export interface CobranzaEnEdicion {
  id: string
  tipo: 'factura' | 'presupuesto'
  cheque: number
  efectivo: number
  comentarios: string | null
}

export function ModalCobranza({
  visible,
  cliente,
  notaId = null,
  tipoSugerido,
  fecha,
  editando,
  alCerrar,
  alGuardar,
}: {
  visible: boolean
  /** El cliente de la parada (o de la nota): no se cambia acá, es contra quién se cobra. */
  cliente: { id: string | null; codigo: string | null; nombre: string }
  /** La nota contra la que se cobra, cuando se abre desde una. */
  notaId?: string | null
  /** El comprobante que propone la nota. Por defecto, factura. */
  tipoSugerido?: 'factura' | 'presupuesto'
  /**
   * El día del cobro, sólo para el alta suelta desde COBRANZAS (agregar uno que
   * se olvidó en el día que se está mirando). Desde la visita/nota no se pasa:
   * el cobro es de hoy.
   */
  fecha?: string
  /**
   * Cuando viene, el modal CORRIGE ese cobro en vez de crear uno nuevo: se
   * precargan sus montos y GUARDAR llama a `editarCobranza`. El servidor rechaza
   * si ya se imprimió.
   */
  editando?: CobranzaEnEdicion | null
  alCerrar: () => void
  /** Se llama después de guardar un cobro (el parte marca "cobró" y suma uno). */
  alGuardar: () => void
}) {
  const estilos = usarEstilos()
  const [tipo, setTipo] = useState<'factura' | 'presupuesto'>(tipoSugerido ?? 'factura')
  const [cheque, setCheque] = useState('')
  const [efectivo, setEfectivo] = useState('')
  const [comentarios, setComentarios] = useState('')

  // El id del cobro se genera en el teléfono, no en la base. Así, si se guarda
  // con mala señal y el INSERT entra pero se pierde la respuesta, tocar GUARDAR de
  // nuevo reintenta con el MISMO id: la base lo rechaza por clave repetida y el
  // servicio lo toma como "ya estaba" en vez de grabar una segunda fila que
  // inflaría el TOTAL de la planilla. Se renueva en cada apertura, para que un
  // segundo cobro (otro "＋ CARGAR OTRO COBRO") sea una fila distinta.
  const idCobro = useRef(Crypto.randomUUID())

  // Cada vez que se abre: corrigiendo, se precarga el cobro; nuevo, arranca en
  // blanco (con el comprobante que proponga la nota). Un segundo cobro, o uno
  // abierto desde otra nota, no hereda lo anterior.
  useEffect(() => {
    if (!visible) return
    if (editando) {
      setTipo(editando.tipo)
      setCheque(aEntrada(editando.cheque))
      setEfectivo(aEntrada(editando.efectivo))
      setComentarios(editando.comentarios ?? '')
      return
    }
    idCobro.current = Crypto.randomUUID()
    setTipo(tipoSugerido ?? 'factura')
    setCheque('')
    setEfectivo('')
    setComentarios('')
  }, [visible, tipoSugerido, editando])

  const total = aPesos(cheque) + aPesos(efectivo)

  const guardar = useMutation({
    mutationFn: () =>
      editando
        ? editarCobranza({
            id: editando.id,
            tipoComprobante: tipo,
            cheque: aPesos(cheque),
            efectivo: aPesos(efectivo),
            comentarios,
          })
        : registrarCobranza({
            id: idCobro.current,
            notaId,
            clienteId: cliente.id,
            clienteCodigo: cliente.codigo,
            clienteNombre: cliente.nombre,
            tipoComprobante: tipo,
            cheque: aPesos(cheque),
            efectivo: aPesos(efectivo),
            comentarios,
            fecha,
          }),
    onSuccess: () => alGuardar(),
    onError: (e: Error) =>
      Alert.alert(editando ? 'No pudimos guardar los cambios' : 'No pudimos guardar el cobro', e.message),
  })

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={alCerrar}>
      <Pantalla>
        <Panel desplazable={false} contentStyle={estilos.contenido}>
          <TituloPanel>{editando ? 'CORREGIR EL COBRO' : 'REGISTRAR UN COBRO'}</TituloPanel>

          <ScrollView
            style={estilos.cuerpo}
            contentContainerStyle={estilos.cuerpoContenido}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* El cliente viene de la parada, de sólo lectura. */}
            <View style={estilos.cliente}>
              <Text style={estilos.clienteCodigo}>
                {cliente.codigo ? `#${cliente.codigo}` : 'Sin código'}
              </Text>
              <Text style={estilos.clienteNombre} numberOfLines={2}>
                {cliente.nombre || 'Cliente'}
              </Text>
            </View>

            <Desplegable<'factura' | 'presupuesto'>
              etiqueta="¿CONTRA QUÉ SE COBRA?"
              obligatorio
              valor={tipo}
              items={[
                { valor: 'factura', etiqueta: 'FACTURA' },
                { valor: 'presupuesto', etiqueta: 'PRESUPUESTO' },
              ]}
              alCambiar={setTipo}
            />

            <View style={estilos.par}>
              <View style={estilos.mitad}>
                <Campo
                  etiqueta="CHEQUE"
                  value={cheque}
                  onChangeText={(t) => setCheque(soloNumeros(t))}
                  keyboardType="decimal-pad"
                  placeholder="0"
                />
              </View>
              <View style={estilos.mitad}>
                <Campo
                  etiqueta="EFECTIVO"
                  value={efectivo}
                  onChangeText={(t) => setEfectivo(soloNumeros(t))}
                  keyboardType="decimal-pad"
                  placeholder="0"
                />
              </View>
            </View>

            {total > 0 ? (
              <Aviso tono="exito" titulo="Total">
                {formatearPesos(total)}
              </Aviso>
            ) : null}

            {/* Multilínea FINA: arranca de una línea y crece con el texto. El
                comentario casi siempre va vacío o corto, y la caja alta de
                siempre (150px) empujaba el form a scrollear y dejaba GUARDAR
                tapado. Así entra todo sin scroll y el botón queda abajo. */}
            <Campo
              etiqueta="COMENTARIOS"
              value={comentarios}
              onChangeText={setComentarios}
              placeholder="Cheque a 30 días, entrega parcial…"
              multiline
              multilineaFina
            />
          </ScrollView>

          <View style={estilos.botones}>
            <BotonPrincipal
              titulo={editando ? 'GUARDAR LOS CAMBIOS' : 'GUARDAR EL COBRO'}
              alTocar={() => guardar.mutate()}
              cargando={guardar.isPending}
              deshabilitado={guardar.isPending || total <= 0}
            />
            {/* Mientras guarda no se puede cancelar: con mala señal el cobro se
                completa igual en segundo plano y cancelar llevaría a cargarlo de
                nuevo —duplicado en la planilla que la oficina compara—. */}
            <BotonSecundario
              titulo="Cancelar"
              alTocar={alCerrar}
              deshabilitado={guardar.isPending}
            />
          </View>
        </Panel>
      </Pantalla>
    </Modal>
  )
}

const usarEstilos = hojaDeTema((t) => ({
  contenido: {
    flex: 1,
    padding: espaciado.base,
    gap: espaciado.base,
  },
  // El cuerpo se queda con el alto que sobra entre el título y los botones; si
  // los campos no entran (Total + teclado), scrollea sólo acá.
  cuerpo: { flex: 1 },
  cuerpoContenido: { gap: espaciado.base, paddingBottom: espaciado.xs },
  cliente: {
    backgroundColor: t.colores.panelClaro,
    borderRadius: radios.sm,
    padding: espaciado.sm,
    gap: espaciado.xs,
  },
  clienteCodigo: {
    fontFamily: t.tipografia.familia.fuerte,
    fontSize: t.tipografia.tamano.base,
    color: t.colores.rojoAccion,
  },
  clienteNombre: {
    fontFamily: t.tipografia.familia.fuerte,
    fontSize: t.tipografia.tamano.sm,
    color: t.colores.tinta,
  },
  par: { flexDirection: 'row', gap: espaciado.sm },
  mitad: { flex: 1 },
  botones: { gap: espaciado.sm },
}))
