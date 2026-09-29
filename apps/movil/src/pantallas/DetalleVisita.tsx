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
import { Alert, Linking, Text, View } from 'react-native'

import { BotonSecundario } from '../componentes/Botones'
import { Aviso, Cargando, Pastilla, Vacio } from '../componentes/Estado'
import { Encabezado } from '../componentes/Encabezado'
import { usarListaSemanalRapida } from '../componentes/ListaSemanalRapida'
import { BarraPanel, Pantalla, Panel, TituloPanel } from '../componentes/Pantalla'
import { obtenerDetalleParada } from '../servicios/jornada'
import { buscarEnMapsPorTexto } from '../servicios/mapas'
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

  const lista = usarListaSemanalRapida()
  // Sólo se puede agregar un cliente de verdad (uno con ficha). Un destino sin
  // cliente o con nombre suelto no entra en la lista semanal.
  const clienteId = parada?.cliente?.id ?? null
  const clienteNombre = parada?.cliente?.razon_social ?? 'este cliente'

  /*
   * El domicilio sale de dos lados distintos, y de cuál sale cambia todo lo que
   * puede hacer esta pantalla.
   *
   * Si la parada está ubicada hay una dirección de verdad, con su punto en el
   * mapa. Si entró SIN UBICAR —el vendedor la agregó al recorrido porque sabe
   * dónde queda, sin frenarse a buscarla, y nunca llegó a guardar la ubicación—
   * no hay punto: lo único que quedó es `direccion_snapshot`, el domicilio
   * escrito que vino del sistema de gestión ("URQUIZA OESTE PARADA16,
   * GUALEGUAYCHÚ"). Para el vendedor eso alcanza de sobra; para una URL de mapa
   * con coordenadas no.
   *
   * Se sacan como constantes acá arriba a propósito: al ser `const`, el
   * estrechamiento sobrevive adentro de los `alTocar`, y no hace falta ningún
   * `!` para convencer al compilador de algo que después puede dejar de ser
   * cierto.
   */
  const punto = parada?.direccion ?? null
  const domicilioEscrito = parada?.direccion_snapshot ?? null
  const domicilio = punto?.direccion_formateada ?? domicilioEscrito

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
              {/* Sin dirección y sin domicilio escrito no se inventa nada: se
                  dice que no quedó anotado, que es la verdad. */}
              <Text style={estilos.meta}>{domicilio ?? 'Sin domicilio anotado'}</Text>
              {punto?.codigo_postal ? (
                <Text style={estilos.meta}>CP {punto.codigo_postal}</Text>
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
                {/* La misma pastilla roja que en el resto de la app, y última
                    como en todas: acá explica por qué el domicilio de arriba es
                    el texto del sistema y por qué el botón de abajo busca en
                    vez de ir derecho al punto. Un solo símbolo para aprender. */}
                {punto === null ? (
                  <Pastilla texto="SIN UBICAR" color={colores.rojoAccion} />
                ) : null}
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

            {/* Atajo a la lista semanal: mandar a este cliente a un día fijo
                sin salir del historial. Sólo si es un cliente con ficha. */}
            {clienteId ? (
              <BotonSecundario
                titulo="📋  Agregar a mi lista semanal"
                alTocar={() => lista.abrir(clienteId, clienteNombre)}
                cargando={lista.agregando}
              />
            ) : null}

            {/*
              Con punto se abre el punto, como siempre. Sin punto el botón no se
              esconde: se busca en Google Maps el domicilio escrito, que es
              exactamente lo que haría el vendedor a mano. No se navega derecho
              al primer resultado porque un domicilio de texto puede ser
              ambiguo, y salir manejando hacia una conjetura sin avisar es peor
              que mostrarle los resultados y que elija él.

              Si no hay ni punto ni domicilio escrito no hay nada que abrir, y
              ahí sí el botón desaparece: un botón que no puede cumplir es una
              promesa rota cada vez que lo tocan.
            */}
            {punto ? (
              <BotonSecundario
                titulo="Ver en el mapa"
                alTocar={() =>
                  Linking.openURL(
                    `https://www.google.com/maps/search/?api=1&query=${punto.lat},${punto.lng}`,
                  )
                }
              />
            ) : domicilioEscrito ? (
              <BotonSecundario
                // Mismo nombre que en Recorrido y en DestinoVisitado: es el
                // mismo botón y el vendedor lo usa en los tres el mismo día.
                titulo="Buscar en Maps"
                alTocar={() =>
                  void buscarEnMapsPorTexto(domicilioEscrito).catch((e: Error) =>
                    Alert.alert('No pudimos abrir el mapa', e.message),
                  )
                }
              />
            ) : null}
          </>
        )}
      </Panel>

      {lista.modal}
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
  // Envuelve porque ahora pueden ser tres —número, estado y "SIN UBICAR"— y en
  // un teléfono angosto la tercera se salía de la tarjeta.
  pastillas: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: espaciado.xs,
    marginTop: espaciado.xs,
  },

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
