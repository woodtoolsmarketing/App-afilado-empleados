import {
  espaciado,
  ETIQUETA_TIPO_NOTA,
  formatearHora,
  formatearPesos,
  numeroDeNotaImpreso,
  radios,
  TOQUE_MINIMO,
} from '@woodtools/compartido'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Alert, Pressable, Text, View } from 'react-native'

import { BotonMenu, BotonSecundario } from '../componentes/Botones'
import { Aviso, Cargando, Pastilla, Vacio } from '../componentes/Estado'
import { Campo, Casilla, comparable } from '../componentes/Formulario'
import { Encabezado } from '../componentes/Encabezado'
import { BarraPanel, Pantalla, Panel, TituloPanel } from '../componentes/Pantalla'
import {
  marcarImpresas,
  notasPendientes,
  sePuedeCorregir,
  type NotaResumen,
} from '../servicios/notasPedido'
import { imprimirNotas, type ResultadoImpresion } from '../servicios/impresion'
import type { PropsPantalla } from '../navegacion/tipos'
import { hojaDeTema, usarTema } from '../nucleo/tema'

/**
 * "VER NOTAS DE PEDIDO PENDIENTES"
 *
 * Lista para seleccionar. Desde acá se puede imprimir en la impresora de la
 * oficina o exportar a PDF —esa segunda opción existe sólo en esta pantalla,
 * no en el botón de "imprimir todas" del menú.
 */
export function PantallaNotasPendientes({ navigation }: PropsPantalla<'NotasPendientes'>) {
  const estilos = usarEstilos()
  const cliente = useQueryClient()
  const [elegidas, setElegidas] = useState<Set<string>>(new Set())
  // Arranca TILDADA: lo normal es que el vendedor quiera que, junto con las
  // notas, salga el rol de visita de los días en que las hizo. Se puede
  // destildar si esta vez sólo quiere las notas.
  const [conRolDeVisita, setConRolDeVisita] = useState(true)
  const [busqueda, setBusqueda] = useState('')

  const { data: notas, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: ['notas-pendientes'],
    queryFn: notasPendientes,
  })

  const todas = notas ?? []
  const seleccionadas = todas.filter((n) => elegidas.has(n.id))
  // Sin selección explícita, "imprimir todas" manda sólo lo que todavía no salió
  // en papel. Las notas de cliente nuevo quedan en 'pendiente_cliente' con
  // `impresa_en` puesto (no cambian de estado, para no salir de la cola de
  // Administración): sin este filtro se reimprimían cada día. Una ya impresa se
  // reimprime sólo si el vendedor la elige a mano.
  const noImpresas = todas.filter((n) => !n.impresa_en)
  const objetivo = seleccionadas.length > 0 ? seleccionadas : noImpresas
  const hayParaImprimir = objetivo.length > 0

  // El buscador sólo filtra lo que se ve en la lista, para encontrar una nota
  // entre muchas. La selección y el "imprimir todas" siguen operando sobre el
  // total: buscar ayuda a ubicar, no cambia qué se manda a imprimir.
  const filtro = comparable(busqueda)
  const visibles = filtro
    ? todas.filter(
        (n) =>
          comparable(n.cliente_nombre).includes(filtro) ||
          comparable(n.cliente_codigo ?? '').includes(filtro) ||
          comparable(numeroDeNotaImpreso(n.numero, n.vendedor_numero) ?? '').includes(filtro),
      )
    : todas

  function alternar(id: string) {
    setElegidas((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  /**
   * El vendedor confirmó que el papel salió: recién ahí se sellan las notas.
   *
   * Va aparte de la impresión porque puede fallar sola —se imprimió bien y la
   * red se cayó al marcarlas— y ahí lo que corresponde es decirlo y dejarlas
   * pendientes, no dar por perdida la impresión.
   */
  const confirmar = useMutation({
    mutationFn: (ids: string[]) => marcarImpresas(ids),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: ['notas-pendientes'] })
      Alert.alert('Listo', 'Las notas quedaron como impresas.')
    },
    onError: (e: Error) =>
      Alert.alert(
        'No pudimos marcarlas',
        `${e.message}\n\nEl papel salió igual. Siguen figurando como pendientes: volvé a imprimirlas cuando tengas señal, o avisá a la oficina.`,
      ),
  })

  // Los genéricos van explícitos porque `onError` vuelve a llamar a
  // `imprimir` —el reintento— y TypeScript no puede inferir un tipo que se
  // referencia a sí mismo mientras lo está construyendo.
  const imprimir = useMutation<
    ResultadoImpresion & { ids: string[]; selladoFallo: boolean },
    Error,
    void
  >({
    mutationFn: async () => {
      // Los ids se congelan ACÁ, antes de imprimir: entre el envío y el refresco
      // de la lista el vendedor puede haber tocado la selección.
      const ids = objetivo.map((n) => n.id)
      const resultado = await imprimirNotas({
        notaIds: ids,
        incluirRolDeVisita: conRolDeVisita,
      })
      // El sellado es un UPDATE por internet que puede fallar aunque el papel
      // (IPP, red local) ya haya salido. Si falla NO se trata como error de
      // impresión —el "Reintentar" del onError volvería a sacar el papel—: se
      // marca `selladoFallo` y el onSuccess ofrece sellar sin reimprimir.
      let selladoFallo = false
      if (resultado.confirmado) {
        try {
          await marcarImpresas(ids)
        } catch {
          selladoFallo = true
        }
      }
      return { ...resultado, ids, selladoFallo }
    },
    onSuccess: (r) => {
      void cliente.invalidateQueries({ queryKey: ['notas-pendientes'] })
      // El papel salió pero no se pudo sellar: se avisa y se ofrece sellar sin
      // volver a imprimir (la mutación `confirmar` sólo marca, no saca papel).
      if (r.selladoFallo) {
        Alert.alert(
          'El papel salió',
          'Salió el papel, pero no pudimos marcarlas como impresas (parece falta de señal). Siguen en pendientes.',
          [
            { text: 'Marcar ahora', onPress: () => confirmar.mutate(r.ids) },
            { text: 'Después', style: 'cancel' },
          ],
        )
        return
      }
      // Que el rol no saliera no invalida la impresión: se cuenta, sin convertirlo en error.
      const texto = r.advertencia ? `${r.mensaje}\n\n${r.advertencia}` : r.mensaje
      Alert.alert('Enviado a la impresora', texto)
    },
    // Es la pantalla del "llego a la oficina e imprimo todo lo del día": el
    // reintento tiene que estar a un toque. Ya no hay "Elegir otra impresora"
    // (el diálogo de Android dejaba guardar PDF): la única salida es la oficina.
    onError: (e: Error) => {
      Alert.alert('No pudimos imprimir', e.message, [
        { text: 'Reintentar', onPress: () => imprimir.mutate() },
        { text: 'Cancelar', style: 'cancel' },
      ])
    },
  })

  return (
    <Pantalla>
      <Encabezado />

      <Panel contentStyle={estilos.contenido}>
        <BarraPanel alVolver={() => navigation.goBack()} />

        {/*
          El contador sólo se muestra cuando efectivamente se contaron. Si la
          consulta falló —o todavía está cargando, cuando `todas` es [] porque
          `data` no llegó—, un "0" grande al lado del título es una afirmación
          falsa sobre el trabajo del vendedor.
        */}
        <TituloPanel destacado={isLoading || error ? undefined : String(todas.length)}>
          NOTAS DE PEDIDO PENDIENTES:
        </TituloPanel>

        {isLoading ? (
          <Cargando texto="Buscando tus notas…" />
        ) : error ? (
          /*
            "No pude preguntar" no es "no hay".
            Sin señal, la pantalla decía "No tenés notas pendientes" y mostraba
            un 0: el vendedor podía tener cinco notas sin imprimir y creer que
            ya estaba. Ahora dice lo que pasó y deja reintentar.
          */
          <>
            <Aviso tono="error" titulo="No pudimos consultar tus notas">
              Revisá la conexión. Puede que tengas notas pendientes sin imprimir: esta pantalla no
              llegó a preguntarlo.
            </Aviso>
            <BotonSecundario
              titulo="Reintentar"
              alTocar={() => void refetch()}
              cargando={isRefetching}
            />
          </>
        ) : todas.length === 0 ? (
          <Vacio titulo="No tenés notas pendientes" icono="📄" />
        ) : (
          <>
            {/* Mientras no se impriman se pueden corregir enteras: cliente,
                renglones y precios. El ✎ de cada fila abre el mismo formulario
                con lo que la nota ya dice. */}
            <Aviso tono="info">
              Tocá el ✎ para corregir una nota antes de imprimirla. Una vez impresa pasa a NOTAS DE
              PEDIDO IMPRESAS y ya no se puede tocar.
            </Aviso>

            {/* Con pocas notas no hace falta; con muchas, ubicar la de un
                cliente a ojo es peor que escribir su nombre o su número. El
                `|| filtro` es para no esconder el campo si la lista bajó de 5
                con una búsqueda puesta: dejaría el filtro pegado sin nada para
                borrarlo. */}
            {todas.length > 5 || filtro ? (
              <Campo
                value={busqueda}
                onChangeText={setBusqueda}
                placeholder="Buscar por cliente o número…"
                autoCorrect={false}
              />
            ) : null}

            {filtro && visibles.length === 0 ? (
              <Aviso tono="info">Ninguna nota pendiente coincide con “{busqueda}”.</Aviso>
            ) : null}

            {visibles.map((n) => (
              <FilaNota
                key={n.id}
                nota={n}
                elegida={elegidas.has(n.id)}
                alAlternar={() => alternar(n.id)}
                alVer={() => navigation.navigate('DetalleNota', { notaId: n.id })}
                // `push` y no `navigate`: si el formulario quedara montado más
                // abajo en la pila, `navigate` volvería a ése —cargado con la
                // nota anterior— en vez de abrir el que se pidió.
                alCorregir={() => navigation.push('GenerarNota', { notaId: n.id })}
              />
            ))}

            {seleccionadas.length > 0 ? (
              <Aviso tono="info">
                {`${seleccionadas.length} nota${seleccionadas.length === 1 ? '' : 's'} seleccionada${seleccionadas.length === 1 ? '' : 's'}. Si no elegís ninguna se imprimen todas.`}
              </Aviso>
            ) : null}

            {/*
              Sale todo en un solo trabajo de impresión: las planillas de rol
              adelante y las notas atrás. Arranca TILDADA, y suma el rol de
              visita de CADA DÍA en que se hicieron las notas que se imprimen
              (no sólo el de hoy): el que imprime a la noche lo de varios días se
              lleva la planilla de cada uno.
            */}
            <Casilla
              etiqueta="SUMAR EL ROL DE VISITA DE ESOS DÍAS"
              valor={conRolDeVisita}
              alCambiar={setConRolDeVisita}
            />

            {/* Antes de imprimir se puede mirar. Va arriba del botón de
                imprimir porque es el orden en que conviene hacerlo. */}
            <BotonSecundario
              titulo="👁  Ver antes de imprimir"
              alTocar={() => {
                if (!hayParaImprimir) return
                navigation.navigate('VistaPrevia', {
                  notaIds: objetivo.map((n) => n.id),
                  incluirRolDeVisita: conRolDeVisita,
                })
              }}
            />

            <BotonMenu
              titulo={'IMPRIMIR NOTAS\nDE PEDIDO'}
              subtitulo={
                !hayParaImprimir
                  ? 'Ya salieron todas: tocá una para volver a imprimirla'
                  : conRolDeVisita
                    ? `${objetivo.length} nota${objetivo.length === 1 ? '' : 's'} y el rol de visita de esos días, a la impresora de la oficina`
                    : `${objetivo.length} nota${objetivo.length === 1 ? '' : 's'} a la impresora de la oficina`
              }
              alTocar={() => {
                if (!hayParaImprimir) return
                imprimir.mutate()
              }}
              cargando={imprimir.isPending}
            />
          </>
        )}
      </Panel>
    </Pantalla>
  )
}

function FilaNota({
  nota,
  elegida,
  alAlternar,
  alVer,
  alCorregir,
}: {
  nota: NotaResumen
  elegida: boolean
  alAlternar: () => void
  alVer: () => void
  alCorregir: () => void
}) {
  const { colores } = usarTema()
  const estilos = usarEstilos()
  const sinNumero = nota.numero === null

  return (
    <View style={[estilos.fila, elegida && estilos.filaElegida]}>
      {/*
        El recuadro se ve de 36 —igual que el del componente `Casilla`— pero lo
        que se toca es el Pressable que lo envuelve, de TOQUE_MINIMO (56): el
        área táctil queda al estándar de la app sin depender del hitSlop para
        llegar al tamaño.
      */}
      <Pressable
        onPress={alAlternar}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: elegida }}
        accessibilityLabel={`Seleccionar nota ${nota.numero ?? 'pendiente'}`}
        style={estilos.casillaToque}
      >
        <View style={[estilos.casilla, elegida && estilos.casillaMarcada]}>
          {elegida ? <Text style={estilos.tilde}>✓</Text> : null}
        </View>
      </Pressable>

      <Pressable style={estilos.filaCuerpo} onPress={alVer} accessibilityRole="button">
        <Text style={[estilos.numero, sinNumero && estilos.numeroPendiente]}>
          NOTA DE PEDIDO{' '}
          {sinNumero ? '— — —' : `Nº ${numeroDeNotaImpreso(nota.numero, nota.vendedor_numero)}`}
        </Text>

        <Text style={estilos.cliente} numberOfLines={1}>
          {nota.cliente_codigo ? `${nota.cliente_codigo} · ` : ''}
          {nota.cliente_nombre}
        </Text>

        <View style={estilos.pastillas}>
          {nota.tipo_nota ? (
            <Pastilla
              texto={ETIQUETA_TIPO_NOTA[nota.tipo_nota]}
              color={nota.tipo_nota === 'factura' ? colores.azul : colores.tintaSuave}
            />
          ) : null}
          {sinNumero ? <Pastilla texto="ESPERA CÓD. CLIENTE" color={colores.ambarOscuro} /> : null}
          {nota.total ? (
            <Text style={estilos.total}>{formatearPesos(Number(nota.total))}</Text>
          ) : null}
          <Text style={estilos.hora}>{formatearHora(nota.creado_en)}</Text>
        </View>
      </Pressable>

      {/*
        El ✎ desaparece cuando la nota ya salió en papel.

        Puede pasar acá, en la lista de PENDIENTES: las notas que esperan el
        código de cliente se imprimen sin cambiar de estado —para no caerse de
        la cola de Administración— así que siguen figurando como pendientes.
        Ofrecer corregirlas era mandar al vendedor a cargar cambios que el
        servidor iba a rechazar al guardar.
      */}
      {sePuedeCorregir(nota.estado, nota.impresa_en) ? (
        <Pressable
          onPress={alCorregir}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`Corregir la nota ${nota.numero ?? 'pendiente'} de ${nota.cliente_nombre}`}
          style={({ pressed }) => [estilos.corregir, pressed && estilos.corregirTocado]}
        >
          <Text style={estilos.corregirTexto}>✎</Text>
        </Pressable>
      ) : (
        <View style={estilos.corregirVacio}>
          <Text style={estilos.corregirVacioTexto}>ya{'\n'}salió</Text>
        </View>
      )}
    </View>
  )
}

const usarEstilos = hojaDeTema((t) => ({
  contenido: { gap: espaciado.sm },

  fila: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaciado.md,
    backgroundColor: t.colores.campoBlanco,
    borderWidth: 2,
    borderColor: t.colores.borde,
    borderRadius: radios.sm,
    padding: espaciado.md,
    minHeight: 78,
  },
  filaElegida: { backgroundColor: t.colores.panelClaro, borderColor: t.colores.rojo },

  // El área que se toca para marcar la nota: un cuadrado de TOQUE_MINIMO (56)
  // que centra el recuadro de 36. Así el toque llega al estándar de la app sin
  // depender del hitSlop, y el recuadro visible queda del tamaño del `Casilla`.
  casillaToque: {
    width: TOQUE_MINIMO,
    height: TOQUE_MINIMO,
    alignItems: 'center',
    justifyContent: 'center',
  },
  casilla: {
    width: 36,
    height: 36,
    borderWidth: 2.5,
    borderColor: t.colores.borde,
    borderRadius: radios.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  casillaMarcada: { backgroundColor: t.colores.verde },
  tilde: { fontFamily: t.tipografia.familia.titulo, fontSize: 19, lineHeight: 23 },

  filaCuerpo: { flex: 1, gap: 2 },
  numero: {
    fontFamily: t.tipografia.familia.subtitulo,
    fontSize: t.tipografia.tamano.base,
    color: t.colores.tinta,
  },
  // Sin código de cliente todavía no es un comprobante: se muestra apagado.
  numeroPendiente: { color: t.colores.tintaTenue },
  cliente: {
    fontFamily: t.tipografia.familia.cuerpo,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.tintaSuave,
  },
  pastillas: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaciado.xs,
    flexWrap: 'wrap',
    marginTop: 3,
  },
  total: {
    fontFamily: t.tipografia.familia.fuerte,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.tinta,
  },
  hora: {
    fontFamily: t.tipografia.familia.liviana,
    fontSize: t.tipografia.tamano.micro,
    color: t.colores.tintaTenue,
    marginLeft: 'auto',
  },

  /** El lápiz que abre la nota para corregirla. Sólo existe en las pendientes. */
  corregir: {
    width: 46,
    minHeight: 46,
    borderWidth: 2,
    borderColor: t.colores.borde,
    borderRadius: radios.sm,
    backgroundColor: t.colores.panelClaro,
    alignItems: 'center',
    justifyContent: 'center',
  },
  corregirTocado: { backgroundColor: t.colores.campo },
  /** El hueco del ✎ cuando la nota ya se imprimió: dice por qué no está. */
  corregirVacio: { width: 46, minHeight: 46, alignItems: 'center', justifyContent: 'center' },
  corregirVacioTexto: {
    fontFamily: t.tipografia.familia.liviana,
    fontSize: t.tipografia.tamano.micro,
    color: t.colores.tintaTenue,
    textAlign: 'center',
  },
  corregirTexto: {
    fontFamily: t.tipografia.familia.fuerte,
    fontSize: t.tipografia.tamano.lg,
    color: t.colores.rojo,
  },
}))
