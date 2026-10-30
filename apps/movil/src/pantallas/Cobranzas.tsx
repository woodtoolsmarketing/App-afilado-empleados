import {
  esComoVendedor,
  espaciado,
  fechaLocalISO,
  formatearFechaCorta,
  formatearPesos,
  radios,
} from '@woodtools/compartido'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Alert, Pressable, Text, View } from 'react-native'

import { BotonPrincipal, BotonSecundario } from '../componentes/Botones'
import { BuscarClienteModal } from '../componentes/BuscarClienteModal'
import { Aviso, Cargando, Pastilla, Vacio } from '../componentes/Estado'
import { Encabezado } from '../componentes/Encabezado'
import { ModalCobranza } from '../componentes/ModalCobranza'
import { BarraPanel, Pantalla, Panel, TituloPanel } from '../componentes/Pantalla'
import { cobranzasDelDia, marcarCobroDeVisita, type Cobranza } from '../servicios/cobranzas'
import { encolarCobranzas } from '../servicios/cola'
import { imprimirCobranzas, type ResultadoImpresion } from '../servicios/impresion'
import type { PropsPantalla } from '../navegacion/tipos'
import { usarSesion } from '../nucleo/sesion'
import { hojaDeTema, usarTema } from '../nucleo/tema'

/**
 * "COBRANZAS"
 *
 * El vendedor repasa, día por día, los cobros que cargó, y CORRIGE el que tenga
 * un error: se toca el cobro y se abre el mismo formulario con el que se cargó,
 * ya completo. La carga original se hace desde el rol de visita (al tildar
 * "COBRÓ").
 *
 * El cobro se puede corregir MIENTRAS no haya salido en papel. Una vez que la
 * rendición se imprimió —desde el teléfono con las notas, o desde el panel de la
 * oficina— queda cerrado: lleva la pastilla IMPRESO y ya no se toca, porque el
 * papel con esa cifra ya está en la calle.
 *
 * Se navega por día con las flechas; no se puede ir al futuro.
 */
export function PantallaHistorialCobranzas({ navigation }: PropsPantalla<'Cobranzas'>) {
  const { colores } = usarTema()
  const estilos = usarEstilos()
  const consultas = useQueryClient()

  // Imprimir las cobranzas del día directo (sin pasar por la cola) es sólo para
  // el vendedor que la oficina habilitó (`imprime_cobranzas`). Admin/supervisor
  // imprimen siempre: la bandera sólo aplica a vendedores (mismo criterio que
  // `imprime_roles`).
  const perfil = usarSesion((s) => s.perfil)
  const puedeImprimir = !(esComoVendedor(perfil?.rol) && perfil?.imprime_cobranzas === false)

  const hoy = fechaLocalISO(new Date())
  const [fecha, setFecha] = useState(hoy)
  const esHoy = fecha === hoy
  // Lo que se está haciendo mientras se imprime: buscar la impresora tarda.
  const [avance, setAvance] = useState<string | null>(null)
  // El cobro que se está corrigiendo, o null. Sólo los no impresos abren esto.
  const [editando, setEditando] = useState<Cobranza | null>(null)
  // El alta suelta: primero se busca el cliente, después se abre el formulario
  // con ese cliente para cargar un cobro que se olvidó (sin pasar por una visita).
  const [buscandoCliente, setBuscandoCliente] = useState(false)
  const [clienteNuevoCobro, setClienteNuevoCobro] = useState<{
    id: string | null
    codigo: string | null
    nombre: string
  } | null>(null)

  const { data: cobros, isLoading, isError, refetch } = useQuery({
    queryKey: ['cobranzas-del-dia', fecha],
    queryFn: () => cobranzasDelDia(fecha),
  })

  // Al agregar un cobro a un cliente que ya visitó ese día, el rol de visita
  // tiene que mostrar que cobró. El cobro ya quedó guardado en `cobranzas`; esto
  // es el reflejo en el parte, de mejor esfuerzo (si falla, no interrumpe nada).
  const marcarCobro = useMutation({
    mutationFn: (p: { clienteId: string; fecha: string }) =>
      marcarCobroDeVisita(p.clienteId, p.fecha),
    onSettled: () => {
      // Todas las vistas que dibujan el "cobró" por si quedaron montadas: el rol
      // de hoy, el picker, el historial y el detalle de la parada.
      void consultas.invalidateQueries({ queryKey: ['jornada-hoy'] })
      void consultas.invalidateQueries({ queryKey: ['cobro-clientes-visitados'] })
      void consultas.invalidateQueries({ queryKey: ['historial'] })
      void consultas.invalidateQueries({ queryKey: ['detalle-parada'] })
    },
  })

  /**
   * Mandar la rendición del día A LA OFICINA: entra a la cola y la PC de la
   * oficina la imprime. Lo que se sella (los cobros quedan cerrados) lo hace la
   * oficina al confirmar el papel, no acá.
   */
  const encolar = useMutation({
    mutationFn: () => encolarCobranzas(fecha),
    onSuccess: (r) => {
      Alert.alert(
        r.encolada ? 'Va a la oficina' : 'Ya estaba pedida',
        r.encolada
          ? 'La rendición quedó en la cola. La imprimen en la oficina; mirá "Mis impresiones" para ver tu lugar.'
          : (r.motivo ?? 'Ya hay una rendición de ese día esperando en la oficina.'),
        [
          { text: 'Ver mis impresiones', onPress: () => navigation.navigate('MisImpresiones') },
          { text: 'Listo', style: 'cancel' as const },
        ],
      )
    },
    onError: (e: Error) => Alert.alert('No pudimos mandarla a la oficina', e.message),
  })

  /**
   * Imprimir la rendición del día DIRECTO a la impresora de la oficina (estando
   * al lado), sin pasar por la cola. Sólo para el vendedor habilitado. Al salir,
   * esos cobros quedan sellados como impresos (la lista los muestra con IMPRESO).
   *
   * Los genéricos van explícitos porque `onError` vuelve a llamar a `imprimir`
   * —el reintento— y TypeScript no infiere un tipo que se referencia a sí mismo.
   */
  const imprimir = useMutation<ResultadoImpresion, Error, void>({
    mutationFn: async () => {
      setAvance(null)
      return imprimirCobranzas({ fecha, alAvisar: setAvance })
    },
    onSuccess: (r) => {
      setAvance(null)
      void consultas.invalidateQueries({ queryKey: ['cobranzas-del-dia', fecha] })
      const texto = [r.mensaje, r.advertencia].filter(Boolean).join('\n\n')
      Alert.alert('Enviado a la impresora', texto, [{ text: 'Listo' }])
    },
    onError: (e: Error) => {
      setAvance(null)
      Alert.alert('No pudimos imprimir', e.message, [
        { text: 'Reintentar', onPress: () => imprimir.mutate() },
        { text: 'Cancelar', style: 'cancel' as const },
      ])
    },
  })

  const total = (cobros ?? []).reduce((s, c) => s + Number(c.total), 0)

  function cambiarDia(delta: number) {
    const d = new Date(`${fecha}T12:00:00`)
    d.setDate(d.getDate() + delta)
    const nueva = fechaLocalISO(d)
    if (nueva > hoy) return // no se mira para adelante
    setFecha(nueva)
  }

  // El cobro que se corrige, con la forma que espera el modal. Se memoiza para
  // que su identidad sea ESTABLE entre re-renders del padre (p.ej. un refetch de
  // cobranzasDelDia): si fuera un objeto literal nuevo en cada render, el
  // useEffect de reset de ModalCobranza volvería a correr y borraría lo que el
  // vendedor está tipeando a mitad de una corrección.
  const editandoProp = useMemo(
    () =>
      editando
        ? {
            id: editando.id,
            tipo: editando.tipo_comprobante,
            cheque: editando.cheque,
            efectivo: editando.efectivo,
            retenciones: editando.retenciones,
            comentarios: editando.comentarios,
          }
        : null,
    [editando],
  )

  return (
    <Pantalla>
      <Encabezado />

      <Panel>
        <BarraPanel alVolver={() => navigation.goBack()} />
        <TituloPanel>COBRANZAS</TituloPanel>

        {/* Navegar por día. "Hoy" no deja avanzar: no hay cobros del futuro. */}
        <View style={estilos.navDia}>
          <Pressable
            onPress={() => cambiarDia(-1)}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Día anterior"
            style={({ pressed }) => [estilos.flecha, pressed && estilos.flechaTocada]}
          >
            <Text style={estilos.flechaTexto}>‹</Text>
          </Pressable>
          <Text style={estilos.fechaTexto}>
            {esHoy ? 'HOY' : formatearFechaCorta(`${fecha}T12:00:00`)}
          </Text>
          <Pressable
            onPress={() => cambiarDia(1)}
            disabled={esHoy}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Día siguiente"
            style={({ pressed }) => [
              estilos.flecha,
              pressed && estilos.flechaTocada,
              esHoy && estilos.flechaInactiva,
            ]}
          >
            <Text style={[estilos.flechaTexto, esHoy && estilos.flechaTextoInactivo]}>›</Text>
          </Pressable>
        </View>

        {isLoading ? (
          <Cargando />
        ) : isError ? (
          <View style={estilos.lista}>
            <Aviso tono="error" titulo="No pudimos traer los cobros">
              Puede ser la señal. Reintentá.
            </Aviso>
            <BotonSecundario titulo="Reintentar" alTocar={() => void refetch()} />
          </View>
        ) : (cobros ?? []).length === 0 ? (
          <Vacio
            titulo={esHoy ? 'Todavía no cargaste ningún cobro hoy' : 'No hay cobros ese día'}
            detalle="Se cargan desde el rol de visita al tildar “COBRÓ”, o acá abajo con ＋ AGREGAR COBRANZA."
          />
        ) : (
          <View style={estilos.lista}>
            <Text style={estilos.ayuda}>
              Tocá un cobro para corregirlo. Una vez impreso queda cerrado.
            </Text>

            {(cobros ?? []).map((c) => {
              const impreso = c.impreso_en !== null
              return (
                <Pressable
                  key={c.id}
                  onPress={() => (impreso ? undefined : setEditando(c))}
                  disabled={impreso}
                  accessibilityRole="button"
                  accessibilityLabel={`${c.cliente_nombre}, ${formatearPesos(c.total)}${impreso ? ', impreso' : ', tocá para corregir'}`}
                  style={({ pressed }) => [estilos.fila, pressed && !impreso && estilos.filaTocada]}
                >
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
                      {c.retenciones > 0 ? (
                        <Pastilla
                          texto={`RETENCIÓN ${formatearPesos(c.retenciones)}`}
                          color={colores.ambar}
                        />
                      ) : null}
                      {/* Cerrado: ya salió en papel, no se corrige. Va último,
                          como la pastilla de estado en el resto de la app. */}
                      {impreso ? <Pastilla texto="🔒 IMPRESO" color={colores.rojoAccion} /> : null}
                    </View>
                    {c.comentarios ? <Text style={estilos.comentario}>{c.comentarios}</Text> : null}
                  </View>
                  <Text style={estilos.monto}>{formatearPesos(c.total)}</Text>
                </Pressable>
              )
            })}

            <View style={estilos.totalFila}>
              <Text style={estilos.totalRotulo}>TOTAL</Text>
              <Text style={estilos.totalMonto}>{formatearPesos(total)}</Text>
            </View>
          </View>
        )}
      </Panel>

      {/* Agregar un cobro que se olvidó, sin tener que inventar una visita. Entra
          en el día que se está mirando. Siempre visible —también con la lista
          vacía—, que es justo cuando hace falta. */}
      <Panel>
        <BotonPrincipal
          titulo={esHoy ? '＋ AGREGAR COBRANZA' : '＋ AGREGAR COBRANZA A ESTE DÍA'}
          alTocar={() => setBuscandoCliente(true)}
        />
        {/* Mandar la rendición del día a la oficina para que la impriman. Sólo si
            hay cobros: no se rinde un día vacío. */}
        {(cobros ?? []).length > 0 ? (
          <BotonSecundario
            titulo="📤  Mandar la rendición a la oficina"
            alTocar={() => encolar.mutate()}
            cargando={encolar.isPending}
          />
        ) : null}
        {/* Imprimir directo, para el vendedor que la oficina habilitó
            (`imprime_cobranzas`): sale por la impresora de la oficina sin pasar
            por la cola. El resto sólo manda la rendición (arriba). */}
        {(cobros ?? []).length > 0 && puedeImprimir ? (
          <BotonSecundario
            titulo={esHoy ? '🖨  Imprimir las cobranzas del día' : '🖨  Imprimir las cobranzas de este día'}
            alTocar={() => imprimir.mutate()}
            cargando={imprimir.isPending}
          />
        ) : null}
        {/* Buscar la impresora puede tardar unos segundos; se avisa qué pasa. */}
        {avance ? <Aviso tono="info">{avance}</Aviso> : null}
      </Panel>

      {/* Paso 1 del alta suelta: elegir a quién se le cobró. Arranca con los
          clientes visitados ESE día (el que se está mirando). */}
      <BuscarClienteModal
        visible={buscandoCliente}
        fecha={fecha}
        soloVisitados
        alElegir={(c) => {
          setBuscandoCliente(false)
          setClienteNuevoCobro(c)
        }}
        alCerrar={() => setBuscandoCliente(false)}
      />

      {/* El mismo formulario para corregir un cobro o cargar uno nuevo. Al
          corregir, el cliente viene del cobro y no se toca; al agregar, viene del
          buscador y el cobro entra en el día que se está mirando. Al guardar, se
          refresca la lista del día. */}
      <ModalCobranza
        visible={editando !== null || clienteNuevoCobro !== null}
        cliente={
          editando
            ? { id: null, codigo: editando.cliente_codigo, nombre: editando.cliente_nombre }
            : (clienteNuevoCobro ?? { id: null, codigo: null, nombre: '' })
        }
        // Sólo el alta suelta elige el día; al corregir, el día no se toca.
        fecha={editando ? undefined : fecha}
        editando={editandoProp}
        alCerrar={() => {
          setEditando(null)
          setClienteNuevoCobro(null)
        }}
        alGuardar={() => {
          // Un alta a un cliente visitado refleja en el rol que cobró. Al
          // corregir no: el cliente del cobro editado no sale de la lista de
          // visitados y no se vuelve a marcar.
          const cobrado = editando ? null : clienteNuevoCobro
          setEditando(null)
          setClienteNuevoCobro(null)
          void consultas.invalidateQueries({ queryKey: ['cobranzas-del-dia', fecha] })
          if (cobrado?.id) marcarCobro.mutate({ clienteId: cobrado.id, fecha })
        }}
      />
    </Pantalla>
  )
}

const usarEstilos = hojaDeTema((t) => ({
  navDia: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: espaciado.xs,
  },
  flecha: {
    paddingHorizontal: espaciado.base,
    paddingVertical: espaciado.xs,
  },
  flechaTocada: { opacity: 0.5 },
  flechaInactiva: { opacity: 0.25 },
  flechaTexto: {
    fontFamily: t.tipografia.familia.fuerte,
    fontSize: t.tipografia.tamano.xl,
    color: t.colores.rojo,
  },
  flechaTextoInactivo: { color: t.colores.tintaSuave },
  fechaTexto: {
    fontFamily: t.tipografia.familia.subtitulo,
    fontSize: t.tipografia.tamano.base,
    color: t.colores.tinta,
    letterSpacing: 0.5,
  },
  lista: { gap: espaciado.sm },
  ayuda: {
    fontFamily: t.tipografia.familia.liviana,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.tintaSuave,
  },
  fila: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: espaciado.sm,
    backgroundColor: t.colores.panelClaro,
    borderRadius: radios.sm,
    padding: espaciado.sm,
  },
  filaTocada: { opacity: 0.6 },
  filaIzquierda: { flex: 1, gap: espaciado.xs },
  cliente: {
    fontFamily: t.tipografia.familia.fuerte,
    fontSize: t.tipografia.tamano.sm,
    color: t.colores.tinta,
  },
  pastillas: { flexDirection: 'row', gap: espaciado.xs, flexWrap: 'wrap' },
  comentario: {
    fontFamily: t.tipografia.familia.liviana,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.tintaSuave,
  },
  monto: {
    fontFamily: t.tipografia.familia.fuerte,
    fontSize: t.tipografia.tamano.base,
    color: t.colores.tinta,
  },
  totalFila: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 2,
    borderTopColor: t.colores.tinta,
    paddingTop: espaciado.sm,
    marginTop: espaciado.xs,
  },
  totalRotulo: {
    fontFamily: t.tipografia.familia.fuerte,
    fontSize: t.tipografia.tamano.sm,
    color: t.colores.tinta,
  },
  totalMonto: {
    fontFamily: t.tipografia.familia.fuerte,
    fontSize: t.tipografia.tamano.lg,
    color: t.colores.rojo,
  },
}))
