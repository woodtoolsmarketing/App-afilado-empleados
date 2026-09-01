import { aNumero, espaciado, formatearPesos, radios, soloNumeros } from '@woodtools/compartido'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Alert, Text, View } from 'react-native'

import { BotonPrincipal, BotonSecundario } from '../componentes/Botones'
import { Aviso, Cargando, Pastilla, Vacio } from '../componentes/Estado'
import { Campo, Desplegable } from '../componentes/Formulario'
import { Encabezado } from '../componentes/Encabezado'
import { BarraPanel, Pantalla, Panel, TituloPanel } from '../componentes/Pantalla'
import { cobranzasDelDia, registrarCobranza } from '../servicios/cobranzas'
import { imprimirPlanillaCobranzas } from '../servicios/impresion'
import type { PropsPantalla } from '../navegacion/tipos'
import { hojaDeTema, usarTema } from '../nucleo/tema'

/**
 * "COBRANZAS DEL DÍA"
 *
 * La planilla que el vendedor rendía a mano, cargada desde el teléfono. Cada
 * cobro con su cliente, cuánto fue en cheque y cuánto en efectivo, y el total
 * general abajo.
 *
 * ── Por qué es una pantalla y no un paso de la impresión ────────────────────
 *
 * Porque una nota puede salir en papel por tres caminos distintos y sólo uno
 * confirma que salió de verdad —la impresora de la oficina—; por el diálogo de
 * Android y por PDF la app pregunta. Un cobro colgado del camino confirmado no
 * se registraría nunca en los otros dos. Y además se cobra sin imprimir nada:
 * una factura de la semana pasada, por ejemplo.
 */
export function PantallaCobranzas({ navigation, route }: PropsPantalla<'Cobranzas'>) {
  const { colores } = usarTema()
  const estilos = usarEstilos()
  const cliente = useQueryClient()
  const [cargando, setCargando] = useState(false)

  const { data: cobros, isLoading } = useQuery({
    queryKey: ['cobranzas-del-dia'],
    queryFn: () => cobranzasDelDia(),
  })

  const total = (cobros ?? []).reduce((s, c) => s + Number(c.total), 0)

  const imprimir = useMutation({
    mutationFn: async () => {
      setCargando(true)
      return imprimirPlanillaCobranzas()
    },
    onSettled: () => setCargando(false),
    onSuccess: (r) => Alert.alert('Planilla de cobranzas', r.mensaje),
    onError: (e: Error) => Alert.alert('No pudimos imprimir', e.message),
  })

  return (
    <Pantalla>
      <Encabezado />

      <Panel>
        <BarraPanel alVolver={() => navigation.goBack()} />
        <TituloPanel>COBRANZAS DE HOY</TituloPanel>

        {isLoading ? (
          <Cargando />
        ) : (cobros ?? []).length === 0 ? (
          <Vacio
            titulo="Todavía no cargaste ningún cobro"
            detalle="Cargá el primero con el botón de abajo. La planilla sale con lo que haya."
          />
        ) : (
          <View style={estilos.lista}>
            {(cobros ?? []).map((c) => (
              <View key={c.id} style={estilos.fila}>
                <View style={estilos.filaIzquierda}>
                  <Text style={estilos.cliente}>
                    {c.cliente_codigo ? `${c.cliente_codigo} · ` : ''}
                    {c.cliente_nombre}
                  </Text>
                  <View style={estilos.pastillas}>
                    <Pastilla
                      texto={c.tipo_comprobante === 'factura' ? 'FACTURA' : 'PRESUPUESTO'}
                      color={colores.tintaSuave}
                    />
                    {c.cheque > 0 ? (
                      <Pastilla texto={`CHEQUE ${formatearPesos(c.cheque)}`} color={colores.azul} />
                    ) : null}
                    {c.efectivo > 0 ? (
                      <Pastilla
                        texto={`EFECTIVO ${formatearPesos(c.efectivo)}`}
                        color={colores.verdeOscuro}
                      />
                    ) : null}
                  </View>
                  {c.comentarios ? <Text style={estilos.comentario}>{c.comentarios}</Text> : null}
                </View>
                <Text style={estilos.monto}>{formatearPesos(c.total)}</Text>
              </View>
            ))}

            <View style={estilos.totalFila}>
              <Text style={estilos.totalRotulo}>TOTAL GENERAL</Text>
              <Text style={estilos.totalMonto}>{formatearPesos(total)}</Text>
            </View>
          </View>
        )}
      </Panel>

      <FormularioCobro
        notaId={route.params?.notaId ?? null}
        clienteId={route.params?.clienteId ?? null}
        clienteCodigo={route.params?.clienteCodigo ?? null}
        clienteNombre={route.params?.clienteNombre ?? ''}
        tipoSugerido={route.params?.tipoComprobante ?? 'factura'}
        alGuardar={() => void cliente.invalidateQueries({ queryKey: ['cobranzas-del-dia'] })}
      />

      <Panel>
        <BotonPrincipal
          titulo={cargando ? 'Imprimiendo…' : '🖨 IMPRIMIR LA PLANILLA'}
          alTocar={() => imprimir.mutate()}
          deshabilitado={cargando || (cobros ?? []).length === 0}
        />
      </Panel>
    </Pantalla>
  )
}

/**
 * El alta de un cobro.
 *
 * Se piden las DOS formas por separado —cheque y efectivo— y el total se
 * calcula. Pedir el total además de las formas deja abierta la puerta a que no
 * cierre, y el TOTAL GENERAL de la planilla es lo único que la oficina compara
 * contra lo que el vendedor entrega.
 */
function FormularioCobro({
  notaId,
  clienteId,
  clienteCodigo,
  clienteNombre,
  tipoSugerido,
  alGuardar,
}: {
  notaId: string | null
  clienteId: string | null
  clienteCodigo: string | null
  clienteNombre: string
  tipoSugerido: 'factura' | 'presupuesto'
  alGuardar: () => void
}) {
  const estilos = usarEstilos()
  const [abierto, setAbierto] = useState(!!clienteNombre)
  const [nombre, setNombre] = useState(clienteNombre)
  const [codigo, setCodigo] = useState(clienteCodigo ?? '')
  const [tipo, setTipo] = useState<'factura' | 'presupuesto'>(tipoSugerido)
  const [cheque, setCheque] = useState('')
  const [efectivo, setEfectivo] = useState('')
  const [comentarios, setComentarios] = useState('')

  const total = aPesos(cheque) + aPesos(efectivo)

  const guardar = useMutation({
    mutationFn: () =>
      registrarCobranza({
        notaId,
        clienteId,
        clienteCodigo: codigo.trim() || null,
        clienteNombre: nombre.trim(),
        tipoComprobante: tipo,
        cheque: aPesos(cheque),
        efectivo: aPesos(efectivo),
        comentarios,
      }),
    onSuccess: () => {
      setNombre('')
      setCodigo('')
      setCheque('')
      setEfectivo('')
      setComentarios('')
      setAbierto(false)
      alGuardar()
    },
    onError: (e: Error) => Alert.alert('No pudimos guardar el cobro', e.message),
  })

  if (!abierto) {
    return (
      <Panel>
        <BotonSecundario titulo="+ REGISTRAR UN COBRO" alTocar={() => setAbierto(true)} />
      </Panel>
    )
  }

  return (
    <Panel>
      <TituloPanel>REGISTRAR UN COBRO</TituloPanel>

      <Campo
        etiqueta="CLIENTE"
        obligatorio
        value={nombre}
        onChangeText={setNombre}
        placeholder="Razón social"
        autoCapitalize="words"
      />
      <Campo
        etiqueta="CÓDIGO DE CLIENTE"
        value={codigo}
        onChangeText={(t) => setCodigo(soloNumeros(t))}
        keyboardType="number-pad"
        placeholder="11067"
        ayuda="Es el que va en la primera columna de la planilla."
      />

      {/* Viene propuesto por la nota, pero se puede corregir: un cobro puede ir
          contra un comprobante distinto del que se imprimió. */}
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
        <Aviso tono="exito" titulo="Total cobrado">
          {formatearPesos(total)}
        </Aviso>
      ) : null}

      <Campo
        etiqueta="COMENTARIOS"
        value={comentarios}
        onChangeText={setComentarios}
        placeholder="Cheque a 30 días, entrega parcial…"
        multiline
        numberOfLines={2}
      />

      <BotonPrincipal
        titulo="GUARDAR EL COBRO"
        alTocar={() => guardar.mutate()}
        deshabilitado={guardar.isPending || total <= 0 || !nombre.trim()}
      />
      <BotonSecundario titulo="Cancelar" alTocar={() => setAbierto(false)} />
    </Panel>
  )
}

/**
 * "1.234,50" → 1234.5, y también "1234.50" → 1234.5.
 *
 * La cuenta la hace `aNumero`, del paquete compartido, y no una copia local.
 * Acá había una: borraba TODOS los puntos sin mirar qué separaban, así que un
 * vendedor que tipeara `1500.50` —con el punto decimal del teclado numérico,
 * que es lo que ese teclado ofrece— registraba un cobro de $ 150.050. Cien
 * veces de más, y en la planilla que la oficina compara contra la plata que él
 * entrega.
 *
 * `aNumero` ya resuelve esto: si hay coma, la coma manda y los puntos son de
 * miles; si no hay coma, un único punto seguido de una o dos cifras es
 * decimal. El proyecto tuvo este mismo error una vez en los precios y lo
 * arregló ahí; esta pantalla lo reintrodujo escribiendo el parser de nuevo.
 *
 * Lo único propio que queda es descartar lo que no sea positivo: un cobro de
 * cero o negativo no es un cobro.
 */
function aPesos(texto: string): number {
  const n = aNumero(texto)
  return Number.isFinite(n) && n > 0 ? n : 0
}

const usarEstilos = hojaDeTema((t) => ({
  lista: { gap: espaciado.sm },
  fila: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: espaciado.sm,
    backgroundColor: t.colores.panelClaro,
    borderRadius: radios.sm,
    padding: espaciado.sm,
  },
  filaIzquierda: { flex: 1, gap: espaciado.xs },
  cliente: { fontFamily: t.tipografia.familia.fuerte, fontSize: t.tipografia.tamano.sm, color: t.colores.tinta },
  pastillas: { flexDirection: 'row', gap: espaciado.xs, flexWrap: 'wrap' },
  comentario: {
    fontFamily: t.tipografia.familia.liviana,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.tintaSuave,
  },
  monto: { fontFamily: t.tipografia.familia.fuerte, fontSize: t.tipografia.tamano.base, color: t.colores.tinta },
  totalFila: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 2,
    borderTopColor: t.colores.tinta,
    paddingTop: espaciado.sm,
    marginTop: espaciado.xs,
  },
  totalRotulo: { fontFamily: t.tipografia.familia.fuerte, fontSize: t.tipografia.tamano.sm, color: t.colores.tinta },
  totalMonto: { fontFamily: t.tipografia.familia.fuerte, fontSize: t.tipografia.tamano.lg, color: t.colores.rojo },
  par: { flexDirection: 'row', gap: espaciado.sm },
  mitad: { flex: 1 },
}))
