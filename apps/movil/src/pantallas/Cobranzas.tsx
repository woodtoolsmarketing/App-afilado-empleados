import {
  aNumero,
  espaciado,
  formatearPesos,
  radios,
  soloNumeros,
  type ClienteBuscado,
} from '@woodtools/compartido'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native'

import { BotonPrincipal, BotonSecundario } from '../componentes/Botones'
import { Aviso, Cargando, Pastilla, Vacio } from '../componentes/Estado'
import { Campo, Desplegable } from '../componentes/Formulario'
import { Encabezado } from '../componentes/Encabezado'
import { BarraPanel, Pantalla, Panel, TituloPanel } from '../componentes/Pantalla'
import { buscarClientes, ESPERA_TECLEO, LIMITE_CLIENTES } from '../servicios/clientes'
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

  const { data: cobros, isLoading, isError, refetch } = useQuery({
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
        ) : isError ? (
          // Si la consulta falla no es lo mismo que "no cargaste nada": mostrarlo
          // como vacío hacía que el vendedor recargara un cobro que ya estaba.
          <View style={estilos.lista}>
            <Aviso tono="error" titulo="No pudimos traer los cobros de hoy">
              Puede ser la señal. Reintentá antes de cargar un cobro, así no cargás uno
              que ya estaba.
            </Aviso>
            <BotonSecundario titulo="Reintentar" alTocar={() => void refetch()} />
          </View>
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
  const { colores } = usarTema()
  const estilos = usarEstilos()
  const [abierto, setAbierto] = useState(!!clienteNombre)
  const [nombre, setNombre] = useState(clienteNombre)
  const [codigo, setCodigo] = useState(clienteCodigo ?? '')
  const [tipo, setTipo] = useState<'factura' | 'presupuesto'>(tipoSugerido)
  const [cheque, setCheque] = useState('')
  const [efectivo, setEfectivo] = useState('')
  const [comentarios, setComentarios] = useState('')

  /**
   * El cliente ya viene resuelto desde "COBRÉ ESTA NOTA" — con su cliente_id —
   * y ahí no hace falta buscar nada. Arranca con la misma condición que
   * `abierto`, y se apaga después del primer guardado: un segundo cobro
   * cargado desde esta misma pantalla ya es un caso "abierto desde el menú",
   * aunque la pantalla se haya abierto originalmente desde la nota.
   */
  const [precargado, setPrecargado] = useState(!!clienteNombre)

  /**
   * El cliente_id que viaja a `registrarCobranza`.
   *
   * Antes de este cambio, abierto desde el menú, CLIENTE y CÓDIGO eran texto
   * libre y el cobro quedaba sin cliente_id: no había forma de cruzarlo contra
   * la cuenta corriente del cliente en la oficina. Ahora se completa al elegir
   * un cliente de la búsqueda de abajo, igual que en el Paso 1 de la nota.
   */
  const [clienteIdElegido, setClienteIdElegido] = useState<string | null>(clienteId)
  // La nota precargada (si se entró desde una nota) es del PRIMER cobro: se
  // resetea en onSuccess como el cliente, para que el segundo cobro cargado en
  // la misma pantalla no quede enganchado a la nota del primero.
  const [notaIdActual, setNotaIdActual] = useState<string | null>(notaId)

  // ── Búsqueda de cliente ───────────────────────────────────────────────────
  // Mismo patrón que `PasoCliente` en GenerarNota/Encabezado.tsx —debounce,
  // sólo la última búsqueda escribe en pantalla— pero sin zona ni CUIT: acá
  // sólo hacen falta el nombre y el código.
  const [consulta, setConsulta] = useState('')
  const [resultados, setResultados] = useState<ClienteBuscado[]>([])
  const [buscando, setBuscando] = useState(false)
  const [consultaBuscada, setConsultaBuscada] = useState('')
  const [fallo, setFallo] = useState<string | null>(null)
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null)
  const vigente = useRef(0)

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
      setFallo((e as Error).message)
    } finally {
      if (mia === vigente.current) setBuscando(false)
    }
  }

  useEffect(() => {
    if (temporizador.current) clearTimeout(temporizador.current)
    if (precargado || clienteIdElegido || consulta.trim().length < 2) {
      vigente.current++
      setResultados([])
      setConsultaBuscada('')
      setBuscando(false)
      setFallo(null)
      return
    }
    temporizador.current = setTimeout(() => void buscar(consulta.trim()), ESPERA_TECLEO)
    return () => {
      if (temporizador.current) clearTimeout(temporizador.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consulta, clienteIdElegido])

  /** La tecla "Listo" del teclado: busca ya, sin esperar la pausa del tecleo. */
  function buscarYa() {
    if (temporizador.current) clearTimeout(temporizador.current)
    const texto = consulta.trim()
    if (precargado || texto.length < 2) return
    void buscar(texto)
  }

  /**
   * Escribir en CLIENTE o CÓDIGO busca. Si el cobro vino precargado de una
   * nota no busca nada: el vendedor sólo corrige el texto, como antes de este
   * cambio.
   */
  function alTipear(campo: 'nombre' | 'codigo', texto: string) {
    const valorPrevio = campo === 'nombre' ? nombre : codigo
    if (campo === 'nombre') setNombre(texto)
    else setCodigo(texto)

    if (precargado || texto === valorPrevio) return
    setClienteIdElegido(null)
    setConsulta(texto)
  }

  function elegirCliente(c: ClienteBuscado) {
    vigente.current++
    if (temporizador.current) clearTimeout(temporizador.current)
    setBuscando(false)
    setResultados([])
    setConsultaBuscada('')
    setFallo(null)
    setConsulta('')
    setNombre(c.razon_social)
    setCodigo(c.codigo)
    setClienteIdElegido(c.cliente_id)
  }

  /**
   * "No lo encontré" y "no pude preguntar" son cosas distintas: con la señal
   * cortada en la calle el cartel de "ningún cliente coincide" da a entender
   * que el cliente no está cargado, y acá eso no tiene arreglo —no se da de
   * alta un cliente desde este formulario—, así que hay que decir qué pasó de
   * verdad.
   */
  const sinResultados =
    !precargado &&
    !clienteIdElegido &&
    !buscando &&
    !fallo &&
    consulta.trim().length >= 2 &&
    consultaBuscada === consulta.trim() &&
    resultados.length === 0

  const total = aPesos(cheque) + aPesos(efectivo)

  const guardar = useMutation({
    mutationFn: () =>
      registrarCobranza({
        notaId: notaIdActual,
        clienteId: clienteIdElegido,
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
      setClienteIdElegido(null)
      setNotaIdActual(null)
      setConsulta('')
      setResultados([])
      // A partir de acá cualquier otro cobro que se cargue en esta pantalla
      // arranca en blanco, así que ya puede buscar.
      setPrecargado(false)
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
        onChangeText={(t) => alTipear('nombre', t)}
        placeholder="Razón social"
        autoCapitalize="words"
        returnKeyType="search"
        blurOnSubmit={false}
        onSubmitEditing={buscarYa}
        accesorio={buscando ? <ActivityIndicator size="small" color={colores.rojo} /> : undefined}
      />
      <Campo
        etiqueta="CÓDIGO DE CLIENTE"
        value={codigo}
        onChangeText={(t) => alTipear('codigo', soloNumeros(t))}
        keyboardType="number-pad"
        placeholder="11067"
        ayuda="Es el que va en la primera columna de la planilla."
        returnKeyType="search"
        blurOnSubmit={false}
        onSubmitEditing={buscarYa}
      />

      {/* Resultados de la búsqueda. Elegir uno completa CLIENTE y CÓDIGO y
          guarda el cliente_id; si el cliente no aparece, se sigue pudiendo
          cargar el cobro con lo que se haya tipeado —a mano, sin cliente_id—,
          porque un cliente fuera de la búsqueda igual se tiene que poder
          cobrar. */}
      {!precargado && resultados.length > 0 ? (
        <View style={estilos.sugerencias}>
          {resultados.map((c) => (
            <Pressable
              key={c.cliente_id}
              onPress={() => elegirCliente(c)}
              accessibilityRole="button"
              accessibilityLabel={`${c.codigo}, ${c.razon_social}`}
              style={({ pressed }) => [estilos.sugerencia, pressed && estilos.sugerenciaTocada]}
            >
              <View style={estilos.sugerenciaFila}>
                <Text style={estilos.sugerenciaCodigo}>{c.codigo}</Text>
                {c.provisorio ? <Pastilla texto="PROVISORIO" color={colores.ambarOscuro} /> : null}
              </View>
              <Text style={estilos.sugerenciaNombre} numberOfLines={1}>
                {c.razon_social}
              </Text>
              {c.direccion ? (
                <Text style={estilos.sugerenciaDato} numberOfLines={1}>
                  {c.direccion}
                </Text>
              ) : null}
            </Pressable>
          ))}
        </View>
      ) : null}

      {!precargado && resultados.length >= LIMITE_CLIENTES ? (
        <Text style={estilos.sinResultados}>
          {`Hay más de ${LIMITE_CLIENTES} que coinciden. Escribí un poco más —otro dígito del código, o más letras del nombre— para achicar la lista.`}
        </Text>
      ) : null}

      {!precargado && fallo && !buscando ? (
        <Aviso tono="atencion" titulo="No pudimos consultar el padrón">
          {fallo}
          {'\n\n'}Esto NO quiere decir que el cliente no exista. Podés cargar el cobro igual
          escribiendo los datos a mano, pero quedará sin enganchar a su ficha.
        </Aviso>
      ) : !precargado && sinResultados ? (
        <Text style={estilos.sinResultados}>
          Ningún cliente coincide con “{consulta.trim()}”. Podés cargar el cobro igual con lo que
          escribiste.
        </Text>
      ) : null}

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
        cargando={guardar.isPending}
        deshabilitado={guardar.isPending || total <= 0 || !nombre.trim()}
      />
      {/*
        Con mala señal el guardado puede tardar. Sin el spinner de arriba y con
        "Cancelar" activo, el vendedor no ve que algo está pasando, toca
        Cancelar, la petición igual se completa en segundo plano y él vuelve a
        cargar el mismo cobro: duplicado en la planilla que la oficina compara
        contra la plata que entrega. Mientras guarda, no se puede cancelar.
      */}
      <BotonSecundario
        titulo="Cancelar"
        alTocar={() => setAbierto(false)}
        deshabilitado={guardar.isPending}
      />
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

  // ── Búsqueda de cliente (ver FormularioCobro) ─────────────────────────────
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
  sugerenciaFila: { flexDirection: 'row', alignItems: 'center', gap: espaciado.sm },
  sugerenciaCodigo: {
    fontFamily: t.tipografia.familia.subtitulo,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.rojo,
  },
  sugerenciaNombre: {
    fontFamily: t.tipografia.familia.fuerte,
    fontSize: t.tipografia.tamano.sm,
    color: t.colores.tinta,
  },
  sugerenciaDato: {
    fontFamily: t.tipografia.familia.liviana,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.tintaSuave,
  },
  sinResultados: {
    fontFamily: t.tipografia.familia.cuerpo,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.tintaSuave,
  },
}))
