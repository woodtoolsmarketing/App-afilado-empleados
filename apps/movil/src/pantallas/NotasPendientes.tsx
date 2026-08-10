import {
  colores,
  espaciado,
  ETIQUETA_TIPO_NOTA,
  formatearHora,
  formatearPesos,
  radios,
  tipografia,
} from '@woodtools/compartido'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native'

import { BotonMenu, BotonSecundario } from '../componentes/Botones'
import { Aviso, Cargando, Pastilla, Vacio } from '../componentes/Estado'
import { Casilla } from '../componentes/Formulario'
import { Encabezado } from '../componentes/Encabezado'
import { BarraPanel, Pantalla, Panel, TituloPanel } from '../componentes/Pantalla'
import { marcarImpresas, notasPendientes, type NotaResumen } from '../servicios/notasPedido'
import { imprimirNotas, type ResultadoImpresion } from '../servicios/impresion'
import type { PropsPantalla } from '../navegacion/tipos'

/**
 * "VER NOTAS DE PEDIDO PENDIENTES"
 *
 * Lista para seleccionar. Desde acá se puede imprimir en la impresora de la
 * oficina o exportar a PDF —esa segunda opción existe sólo en esta pantalla,
 * no en el botón de "imprimir todas" del menú.
 */
export function PantallaNotasPendientes({ navigation }: PropsPantalla<'NotasPendientes'>) {
  const cliente = useQueryClient()
  const [elegidas, setElegidas] = useState<Set<string>>(new Set())
  const [conRolDeVisita, setConRolDeVisita] = useState(false)

  const { data: notas, isLoading } = useQuery({
    queryKey: ['notas-pendientes'],
    queryFn: notasPendientes,
  })

  const todas = notas ?? []
  const seleccionadas = todas.filter((n) => elegidas.has(n.id))
  // Sin selección explícita se opera sobre todas: es lo que espera alguien que
  // entra y toca "imprimir" de una.
  const objetivo = seleccionadas.length > 0 ? seleccionadas : todas

  function alternar(id: string) {
    setElegidas((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  // Los genéricos van explícitos porque `onError` vuelve a llamar a
  // `imprimir` —el reintento— y TypeScript no puede inferir un tipo que se
  // referencia a sí mismo mientras lo está construyendo.
  const imprimir = useMutation<
    ResultadoImpresion,
    Error,
    { comoPdf: boolean; conDialogo?: boolean }
  >({
    mutationFn: async (opciones: { comoPdf: boolean; conDialogo?: boolean }) => {
      const resultado = await imprimirNotas({
        notaIds: objetivo.map((n) => n.id),
        incluirRolDeVisita: conRolDeVisita,
        comoPdf: opciones.comoPdf,
        usarDialogoDelSistema: opciones.conDialogo,
      })
      if (!opciones.comoPdf) await marcarImpresas(objetivo.map((n) => n.id))
      return resultado
    },
    onSuccess: (r, opciones) => {
      void cliente.invalidateQueries({ queryKey: ['notas-pendientes'] })
      const base = opciones.comoPdf ? 'Podés compartirlo o guardarlo.' : r.mensaje
      Alert.alert(
        opciones.comoPdf ? 'PDF generado' : 'Enviado a la impresora',
        // Que el rol no saliera no invalida la impresión: se cuenta abajo, sin
        // convertirlo en un error.
        r.advertencia ? `${base}\n\n${r.advertencia}` : base,
      )
    },
    // Es la pantalla del "llego a la oficina e imprimo todo lo del día": el
    // reintento tiene que estar a un toque, sin volver a armar la selección.
    onError: (e: Error) => {
      Alert.alert('No pudimos imprimir', e.message, [
        { text: 'Reintentar', onPress: () => imprimir.mutate({ comoPdf: false }) },
        {
          text: 'Elegir otra impresora',
          onPress: () => imprimir.mutate({ comoPdf: false, conDialogo: true }),
        },
        { text: 'Cancelar', style: 'cancel' },
      ])
    },
  })

  return (
    <Pantalla>
      <Encabezado alAbrirMenu={() => navigation.navigate('Configuracion')} />

      <Panel contentStyle={estilos.contenido}>
        <BarraPanel alVolver={() => navigation.goBack()} />

        <TituloPanel destacado={String(todas.length)}>NOTAS DE PEDIDO PENDIENTES:</TituloPanel>

        {isLoading ? (
          <Cargando texto="Buscando tus notas…" />
        ) : todas.length === 0 ? (
          <Vacio titulo="No tenés notas pendientes" icono="📄" />
        ) : (
          <>
            {todas.map((n) => (
              <FilaNota
                key={n.id}
                nota={n}
                elegida={elegidas.has(n.id)}
                alAlternar={() => alternar(n.id)}
                alVer={() => navigation.navigate('DetalleNota', { notaId: n.id })}
              />
            ))}

            {seleccionadas.length > 0 ? (
              <Aviso tono="info">
                {`${seleccionadas.length} nota${seleccionadas.length === 1 ? '' : 's'} seleccionada${seleccionadas.length === 1 ? '' : 's'}. Si no elegís ninguna se imprimen todas.`}
              </Aviso>
            ) : null}

            {/*
              Sale todo en un solo trabajo de impresión: la planilla del día
              adelante y las notas atrás. Arranca destildado — es un agregado,
              no lo que se viene a hacer a esta pantalla.
            */}
            <Casilla
              etiqueta="SUMAR EL ROL DE VISITA DE HOY"
              valor={conRolDeVisita}
              alCambiar={setConRolDeVisita}
            />

            {/* Antes de imprimir se puede mirar. Va arriba del botón de
                imprimir porque es el orden en que conviene hacerlo. */}
            <BotonSecundario
              titulo="👁  Ver antes de imprimir"
              alTocar={() =>
                navigation.navigate('VistaPrevia', {
                  notaIds: objetivo.map((n) => n.id),
                  incluirRolDeVisita: conRolDeVisita,
                })
              }
            />

            <BotonMenu
              titulo={'IMPRIMIR NOTAS\nDE PEDIDO'}
              subtitulo={
                conRolDeVisita
                  ? `${objetivo.length} nota${objetivo.length === 1 ? '' : 's'} y el rol de visita, a la impresora de la oficina`
                  : `${objetivo.length} nota${objetivo.length === 1 ? '' : 's'} a la impresora de la oficina`
              }
              alTocar={() => imprimir.mutate({ comoPdf: false })}
              cargando={imprimir.isPending}
            />

            {/* La exportación a PDF sólo existe acá, como pidieron. */}
            <BotonSecundario
              titulo="Guardar como PDF"
              alTocar={() => imprimir.mutate({ comoPdf: true })}
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
}: {
  nota: NotaResumen
  elegida: boolean
  alAlternar: () => void
  alVer: () => void
}) {
  const sinNumero = nota.numero === null

  return (
    <View style={[estilos.fila, elegida && estilos.filaElegida]}>
      <Pressable
        onPress={alAlternar}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: elegida }}
        accessibilityLabel={`Seleccionar nota ${nota.numero ?? 'pendiente'}`}
        hitSlop={8}
        style={[estilos.casilla, elegida && estilos.casillaMarcada]}
      >
        {elegida ? <Text style={estilos.tilde}>✓</Text> : null}
      </Pressable>

      <Pressable style={estilos.filaCuerpo} onPress={alVer} accessibilityRole="button">
        <Text style={[estilos.numero, sinNumero && estilos.numeroPendiente]}>
          NOTA DE PEDIDO {sinNumero ? '— — —' : `Nº ${String(nota.numero).padStart(6, '0')}`}
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
    </View>
  )
}

const estilos = StyleSheet.create({
  contenido: { gap: espaciado.sm },

  fila: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaciado.md,
    backgroundColor: colores.campoBlanco,
    borderWidth: 2,
    borderColor: colores.negro,
    borderRadius: radios.sm,
    padding: espaciado.md,
    minHeight: 78,
  },
  filaElegida: { backgroundColor: colores.panelClaro, borderColor: colores.rojo },

  casilla: {
    width: 30,
    height: 30,
    borderWidth: 2.5,
    borderColor: colores.negro,
    borderRadius: radios.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  casillaMarcada: { backgroundColor: colores.verde },
  tilde: { fontFamily: tipografia.familia.titulo, fontSize: 19, lineHeight: 23 },

  filaCuerpo: { flex: 1, gap: 2 },
  numero: {
    fontFamily: tipografia.familia.subtitulo,
    fontSize: tipografia.tamano.base,
    color: colores.tinta,
  },
  // Sin código de cliente todavía no es un comprobante: se muestra apagado.
  numeroPendiente: { color: colores.tintaTenue },
  cliente: {
    fontFamily: tipografia.familia.cuerpo,
    fontSize: tipografia.tamano.xs,
    color: colores.tintaSuave,
  },
  pastillas: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaciado.xs,
    flexWrap: 'wrap',
    marginTop: 3,
  },
  total: {
    fontFamily: tipografia.familia.fuerte,
    fontSize: tipografia.tamano.xs,
    color: colores.tinta,
  },
  hora: {
    fontFamily: tipografia.familia.liviana,
    fontSize: tipografia.tamano.micro,
    color: colores.tintaTenue,
    marginLeft: 'auto',
  },
})
