import {
  colores,
  espaciado,
  ETIQUETA_TIPO_NOTA,
  formatearFechaCorta,
  formatearPesos,
  radios,
  tipografia,
} from '@woodtools/compartido'
import { useQuery } from '@tanstack/react-query'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { BotonSecundario } from '../componentes/Botones'
import { Aviso, Cargando, Pastilla, Vacio } from '../componentes/Estado'
import { Encabezado } from '../componentes/Encabezado'
import { BarraPanel, Pantalla, Panel, TituloPanel } from '../componentes/Pantalla'
import { notasImpresas, type NotaResumen } from '../servicios/notasPedido'
import type { PropsPantalla } from '../navegacion/tipos'

/**
 * "NOTAS DE PEDIDO IMPRESAS"
 *
 * La otra mitad de las pendientes. Una nota se puede corregir entera mientras
 * no haya salido en papel; una vez impresa, la fábrica ya tiene ese comprobante
 * en la mano y cambiarlo por atrás dejaría dos versiones de la misma nota dando
 * vueltas —una en el taller y otra en la base— sin nada que lo delate.
 *
 * Por eso están en listas separadas y no en una sola con el botón apagado: que
 * el corte se vea antes de tocar, y no al tocar.
 *
 * Desde acá se abre el detalle, que es donde se puede volver a imprimir.
 */
export function PantallaNotasImpresas({ navigation }: PropsPantalla<'NotasImpresas'>) {
  const { data, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: ['notas-impresas'],
    queryFn: notasImpresas,
  })

  const notas = data ?? []

  return (
    <Pantalla>
      <Encabezado alAbrirMenu={() => navigation.navigate('Configuracion')} />

      <Panel contentStyle={estilos.contenido}>
        <BarraPanel alVolver={() => navigation.goBack()} />

        <TituloPanel destacado={error ? undefined : String(notas.length)}>
          NOTAS DE PEDIDO IMPRESAS:
        </TituloPanel>

        {isLoading ? (
          <Cargando texto="Buscando las notas impresas…" />
        ) : error ? (
          <>
            <Aviso tono="error" titulo="No pudimos consultar tus notas">
              Revisá la conexión. Las notas siguen guardadas: esta pantalla no llegó a preguntar por
              ellas.
            </Aviso>
            <BotonSecundario
              titulo="Reintentar"
              alTocar={() => void refetch()}
              cargando={isRefetching}
            />
          </>
        ) : notas.length === 0 ? (
          <Vacio titulo="Todavía no imprimiste ninguna nota" icono="🖨" />
        ) : (
          <>
            <Aviso tono="info" titulo="Estas notas ya no se pueden corregir">
              Salieron en papel y la fábrica las tiene. Si alguna quedó mal, avisá a Administración:
              se anula y se carga una nueva.
            </Aviso>

            {notas.map((n) => (
              <FilaImpresa
                key={n.id}
                nota={n}
                alVer={() => navigation.navigate('DetalleNota', { notaId: n.id })}
              />
            ))}

            <Text style={estilos.pie}>
              Se muestran las últimas {notas.length}. Para buscar por fecha está HISTORIAL DE NOTAS
              DE PEDIDO.
            </Text>
          </>
        )}
      </Panel>
    </Pantalla>
  )
}

function FilaImpresa({ nota, alVer }: { nota: NotaResumen; alVer: () => void }) {
  const sinNumero = nota.numero === null

  return (
    <Pressable
      onPress={alVer}
      accessibilityRole="button"
      accessibilityLabel={`Ver la nota ${nota.numero ?? 'sin número'} de ${nota.cliente_nombre}`}
      style={({ pressed }) => [estilos.fila, pressed && estilos.tocada]}
    >
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
        {nota.estado === 'entregada' ? (
          <Pastilla texto="ENTREGADA" color={colores.verdeOscuro} />
        ) : null}
        {nota.total ? (
          <Text style={estilos.total}>{formatearPesos(Number(nota.total))}</Text>
        ) : null}
        {/* Cuándo salió por la impresora: es el dato que separa esta lista de
            la de pendientes, así que va a la vista. */}
        <Text style={estilos.fecha}>
          {nota.impresa_en ? formatearFechaCorta(nota.impresa_en) : formatearFechaCorta(nota.creado_en)}
        </Text>
      </View>
    </Pressable>
  )
}

const estilos = StyleSheet.create({
  contenido: { gap: espaciado.sm },

  fila: {
    backgroundColor: colores.campoBlanco,
    borderWidth: 2,
    borderColor: colores.negro,
    borderRadius: radios.sm,
    padding: espaciado.md,
    minHeight: 78,
    justifyContent: 'center',
    gap: 2,
  },
  tocada: { backgroundColor: colores.panelClaro },

  numero: {
    fontFamily: tipografia.familia.subtitulo,
    fontSize: tipografia.tamano.base,
    color: colores.tinta,
  },
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
  fecha: {
    fontFamily: tipografia.familia.liviana,
    fontSize: tipografia.tamano.micro,
    color: colores.tintaTenue,
    marginLeft: 'auto',
  },

  pie: {
    fontFamily: tipografia.familia.liviana,
    fontSize: tipografia.tamano.micro,
    color: colores.tintaTenue,
    textAlign: 'center',
    marginTop: espaciado.sm,
  },
})
