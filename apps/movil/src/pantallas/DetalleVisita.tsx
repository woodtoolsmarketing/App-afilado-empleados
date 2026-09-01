import {
  espaciado,
  ETIQUETA_ESTADO_PARADA,
  ETIQUETA_MOTIVO_NO_VISITA,
  formatearDistancia,
  formatearFechaCorta,
  formatearHora,
  radios,
} from '@woodtools/compartido'
import { useQuery } from '@tanstack/react-query'
import { Linking, Text, View } from 'react-native'

import { BotonSecundario } from '../componentes/Botones'
import { Aviso, Cargando, Pastilla, Vacio } from '../componentes/Estado'
import { Encabezado } from '../componentes/Encabezado'
import { BarraPanel, Pantalla, Panel, TituloPanel } from '../componentes/Pantalla'
import { obtenerDetalleParada } from '../servicios/jornada'
import type { PropsPantalla } from '../navegacion/tipos'
import { hojaDeTema, usarTema } from '../nucleo/tema'

/**
 * Detalle de una visita del historial: qué se hizo y qué quedó escrito en las
 * observaciones.
 */
export function PantallaDetalleVisita({ navigation, route }: PropsPantalla<'DetalleVisita'>) {
  const { colores } = usarTema()
  const estilos = usarEstilos()
  const { paradaId, fecha } = route.params

  const { data: parada, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: ['detalle-parada', paradaId],
    queryFn: () => obtenerDetalleParada(paradaId),
  })

  const visita = parada?.visita

  return (
    <Pantalla>
      <Encabezado />

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
  const estilos = usarEstilos()
  return (
    <View style={estilos.dato}>
      <Text style={estilos.datoEtiqueta}>{etiqueta}</Text>
      <Text style={estilos.datoValor}>{valor}</Text>
    </View>
  )
}

function Marca({ etiqueta, activo }: { etiqueta: string; activo: boolean }) {
  const estilos = usarEstilos()
  return (
    <View style={estilos.marca}>
      <Text style={[estilos.marcaIcono, activo && estilos.marcaActiva]}>{activo ? '✓' : '·'}</Text>
      <Text style={[estilos.marcaTexto, !activo && estilos.marcaApagada]}>{etiqueta}</Text>
    </View>
  )
}

const usarEstilos = hojaDeTema((t) => ({
  contenido: { gap: espaciado.md },

  tarjeta: {
    backgroundColor: t.colores.campoBlanco,
    borderWidth: 2,
    borderColor: t.colores.borde,
    borderRadius: radios.sm,
    padding: espaciado.md,
    gap: espaciado.xs,
  },
  cliente: {
    fontFamily: t.tipografia.familia.subtitulo,
    fontSize: t.tipografia.tamano.lg,
    color: t.colores.tinta,
  },
  meta: {
    fontFamily: t.tipografia.familia.cuerpo,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.tintaSuave,
  },
  pastillas: { flexDirection: 'row', gap: espaciado.xs, marginTop: espaciado.xs },

  subtitulo: {
    fontFamily: t.tipografia.familia.subtitulo,
    fontSize: t.tipografia.tamano.sm,
    color: t.colores.tinta,
    letterSpacing: 0.6,
    marginBottom: espaciado.xs,
  },
  observacion: {
    fontFamily: t.tipografia.familia.cuerpo,
    fontSize: t.tipografia.tamano.sm,
    color: t.colores.tinta,
    lineHeight: t.tipografia.tamano.sm * t.tipografia.interlineado.holgado,
  },

  dato: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: espaciado.sm,
    borderBottomWidth: 1,
    borderBottomColor: t.colores.panelOscuro,
    gap: espaciado.md,
  },
  datoEtiqueta: {
    fontFamily: t.tipografia.familia.cuerpo,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.tintaSuave,
  },
  datoValor: {
    flexShrink: 1,
    textAlign: 'right',
    fontFamily: t.tipografia.familia.fuerte,
    fontSize: t.tipografia.tamano.sm,
    color: t.colores.tinta,
  },

  marca: { flexDirection: 'row', alignItems: 'center', gap: espaciado.sm, paddingVertical: 4 },
  marcaIcono: {
    width: 24,
    textAlign: 'center',
    fontFamily: t.tipografia.familia.titulo,
    fontSize: t.tipografia.tamano.base,
    color: t.colores.tintaTenue,
  },
  marcaActiva: { color: t.colores.verdeOscuro },
  marcaTexto: {
    fontFamily: t.tipografia.familia.cuerpo,
    fontSize: t.tipografia.tamano.sm,
    color: t.colores.tinta,
  },
  marcaApagada: { color: t.colores.tintaTenue },
}))
