import {
  colores,
  espaciado,
  ETIQUETA_ESTADO_PARADA,
  ETIQUETA_MOTIVO_NO_VISITA,
  formatearDistancia,
  formatearFechaCorta,
  formatearHora,
  radios,
  tipografia,
} from '@woodtools/compartido'
import { useQuery } from '@tanstack/react-query'
import { Linking, StyleSheet, Text, View } from 'react-native'

import { BotonSecundario } from '../componentes/Botones'
import { Aviso, Cargando, Pastilla, Vacio } from '../componentes/Estado'
import { Encabezado } from '../componentes/Encabezado'
import { BarraPanel, Pantalla, Panel, TituloPanel } from '../componentes/Pantalla'
import { obtenerDetalleParada } from '../servicios/jornada'
import type { PropsPantalla } from '../navegacion/tipos'

/**
 * Detalle de una visita del historial: qué se hizo y qué quedó escrito en las
 * observaciones.
 */
export function PantallaDetalleVisita({ navigation, route }: PropsPantalla<'DetalleVisita'>) {
  const { paradaId, fecha } = route.params

  const { data: parada, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: ['detalle-parada', paradaId],
    queryFn: () => obtenerDetalleParada(paradaId),
  })

  const visita = parada?.visita

  return (
    <Pantalla>
      <Encabezado alAbrirMenu={() => navigation.navigate('Configuracion')} />

      <Panel contentStyle={estilos.contenido}>
        <BarraPanel alVolver={() => navigation.goBack()} fecha={new Date(`${fecha}T12:00:00`)} />

        {isLoading ? (
          <Cargando />
        ) : error ? (
          /*
            Sin señal decía "No encontramos esa visita", que suena a que la
            visita no existe. Lo que no existe es la respuesta del servidor.
          */
          <>
            <Aviso tono="error" titulo="No pudimos abrir la visita">
              Revisá la conexión. Lo que cargaste sigue guardado: esto es un problema para leerlo.
            </Aviso>
            <BotonSecundario
              titulo="Reintentar"
              alTocar={() => void refetch()}
              cargando={isRefetching}
            />
          </>
        ) : !parada ? (
          <Vacio titulo="No encontramos esa visita" icono="🔍" />
        ) : (
          <>
            <TituloPanel>DETALLE DE LA VISITA</TituloPanel>

            <View style={estilos.tarjeta}>
              <Text style={estilos.cliente}>
                {parada.cliente?.razon_social ?? parada.razon_social_snapshot ?? 'Destino sin cliente'}
              </Text>
              {parada.cliente?.codigo ? (
                <Text style={estilos.meta}>Cliente Nº {parada.cliente.codigo}</Text>
              ) : null}
              <Text style={estilos.meta}>{parada.direccion.direccion_formateada}</Text>
              {parada.direccion.codigo_postal ? (
                <Text style={estilos.meta}>CP {parada.direccion.codigo_postal}</Text>
              ) : null}

              <View style={estilos.pastillas}>
                <Pastilla
                  texto={`Nº ${parada.orden}`}
                  color={colores.tintaSuave}
                />
                <Pastilla
                  texto={ETIQUETA_ESTADO_PARADA[parada.estado]}
                  color={
                    parada.estado === 'visitada'
                      ? colores.estadoVisitada
                      : parada.estado === 'no_visitada'
                        ? colores.estadoNoVisitada
                        : colores.estadoOmitida
                  }
                />
              </View>
            </View>

            <Dato etiqueta="Fecha" valor={formatearFechaCorta(new Date(`${fecha}T12:00:00`))} />
            <Dato etiqueta="Hora de llegada" valor={formatearHora(parada.llegada_en)} />

            {visita ? (
              <>
                <Dato etiqueta="¿Se concretó?" valor={visita.visitado ? 'SÍ' : 'NO'} />

                {visita.visitado ? (
                  <View style={estilos.tarjeta}>
                    <Text style={estilos.subtitulo}>TIPO DE VISITA</Text>
                    <Marca etiqueta="Vendió" activo={visita.vendio} />
                    <Marca etiqueta="Cobró" activo={visita.cobro} />
                    <Marca etiqueta="Retiró afilado" activo={visita.retiro_afilado} />
                    <Marca etiqueta="Entregó" activo={visita.entrego} />
                  </View>
                ) : (
                  <Aviso tono="atencion" titulo="No se concretó">
                    {visita.motivo_no_visita
                      ? ETIQUETA_MOTIVO_NO_VISITA[visita.motivo_no_visita]
                      : 'Sin motivo registrado'}
                  </Aviso>
                )}

                {visita.contacto_nombre ? (
                  <Dato etiqueta="Atendido por" valor={visita.contacto_nombre} />
                ) : null}

                <View style={estilos.tarjeta}>
                  <Text style={estilos.subtitulo}>
                    OBSERVACIÓN {visita.observacion_origen === 'voz' ? '🎤' : ''}
                  </Text>
                  <Text style={estilos.observacion}>{visita.observacion}</Text>
                </View>

                {visita.desvio_m !== null && visita.desvio_m > 500 ? (
                  <Aviso tono="atencion" titulo="Registrado lejos del domicilio">
                    {`El parte se cargó a ${formatearDistancia(visita.desvio_m)} de la dirección del cliente.`}
                  </Aviso>
                ) : null}

                <Dato
                  etiqueta="Registrado"
                  valor={`${formatearFechaCorta(visita.registrado_en)} a las ${formatearHora(visita.registrado_en)}`}
                />
              </>
            ) : (
              <Aviso tono="info">Este destino quedó sin parte cargado.</Aviso>
            )}

            <BotonSecundario
              titulo="Ver en el mapa"
              alTocar={() =>
                Linking.openURL(
                  `https://www.google.com/maps/search/?api=1&query=${parada.direccion.lat},${parada.direccion.lng}`,
                )
              }
            />
          </>
        )}
      </Panel>
    </Pantalla>
  )
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <View style={estilos.dato}>
      <Text style={estilos.datoEtiqueta}>{etiqueta}</Text>
      <Text style={estilos.datoValor}>{valor}</Text>
    </View>
  )
}

function Marca({ etiqueta, activo }: { etiqueta: string; activo: boolean }) {
  return (
    <View style={estilos.marca}>
      <Text style={[estilos.marcaIcono, activo && estilos.marcaActiva]}>{activo ? '✓' : '·'}</Text>
      <Text style={[estilos.marcaTexto, !activo && estilos.marcaApagada]}>{etiqueta}</Text>
    </View>
  )
}

const estilos = StyleSheet.create({
  contenido: { gap: espaciado.md },

  tarjeta: {
    backgroundColor: colores.campoBlanco,
    borderWidth: 2,
    borderColor: colores.negro,
    borderRadius: radios.sm,
    padding: espaciado.md,
    gap: espaciado.xs,
  },
  cliente: {
    fontFamily: tipografia.familia.subtitulo,
    fontSize: tipografia.tamano.lg,
    color: colores.tinta,
  },
  meta: {
    fontFamily: tipografia.familia.cuerpo,
    fontSize: tipografia.tamano.xs,
    color: colores.tintaSuave,
  },
  pastillas: { flexDirection: 'row', gap: espaciado.xs, marginTop: espaciado.xs },

  subtitulo: {
    fontFamily: tipografia.familia.subtitulo,
    fontSize: tipografia.tamano.sm,
    color: colores.tinta,
    letterSpacing: 0.6,
    marginBottom: espaciado.xs,
  },
  observacion: {
    fontFamily: tipografia.familia.cuerpo,
    fontSize: tipografia.tamano.sm,
    color: colores.tinta,
    lineHeight: tipografia.tamano.sm * tipografia.interlineado.holgado,
  },

  dato: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: espaciado.sm,
    borderBottomWidth: 1,
    borderBottomColor: colores.panelOscuro,
    gap: espaciado.md,
  },
  datoEtiqueta: {
    fontFamily: tipografia.familia.cuerpo,
    fontSize: tipografia.tamano.xs,
    color: colores.tintaSuave,
  },
  datoValor: {
    flexShrink: 1,
    textAlign: 'right',
    fontFamily: tipografia.familia.fuerte,
    fontSize: tipografia.tamano.sm,
    color: colores.tinta,
  },

  marca: { flexDirection: 'row', alignItems: 'center', gap: espaciado.sm, paddingVertical: 4 },
  marcaIcono: {
    width: 24,
    textAlign: 'center',
    fontFamily: tipografia.familia.titulo,
    fontSize: tipografia.tamano.base,
    color: colores.tintaTenue,
  },
  marcaActiva: { color: colores.verdeOscuro },
  marcaTexto: {
    fontFamily: tipografia.familia.cuerpo,
    fontSize: tipografia.tamano.sm,
    color: colores.tinta,
  },
  marcaApagada: { color: colores.tintaTenue },
})
