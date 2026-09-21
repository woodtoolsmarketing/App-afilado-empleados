import {
  espaciado,
  ETIQUETA_ESTADO_PARADA,
  formatearFechaCorta,
  radios,
  type EstadoParada,
  type Paleta,
} from '@woodtools/compartido'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Alert, Text, View } from 'react-native'

import { BotonMenu, BotonSecundario } from '../componentes/Botones'
import { Aviso, Cargando, Pastilla, Vacio } from '../componentes/Estado'
import { Encabezado } from '../componentes/Encabezado'
import { BarraPanel, Pantalla, Panel, TituloPanel } from '../componentes/Pantalla'
import { usarSesion } from '../nucleo/sesion'
import { imprimirRolDeVisita, type ResultadoImpresion } from '../servicios/impresion'
import { obtenerJornadaDeHoy } from '../servicios/jornada'
import type { PropsPantalla } from '../navegacion/tipos'
import { hojaDeTema, usarTema } from '../nucleo/tema'

/**
 * "ROL DE VISITA DE HOY", para imprimir o compartir.
 *
 * Es la misma planilla que la oficina arma en el panel ("Roles de Visita"),
 * ahora salida del teléfono: el vendedor la imprime en la impresora de la
 * oficina o la comparte como PDF por WhatsApp. Muestra un resumen del recorrido
 * —los mismos destinos que van en la hoja— y dos botones; la hoja de verdad, en
 * A4, se ve con "Guardar / compartir PDF".
 */
export function PantallaRolDeVisita({ navigation }: PropsPantalla<'RolDeVisita'>) {
  const { colores } = usarTema()
  const estilos = usarEstilos()
  const perfil = usarSesion((s) => s.perfil)

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['jornada-hoy', perfil?.id],
    queryFn: () => obtenerJornadaDeHoy(perfil!.id),
    enabled: !!perfil,
  })

  const paradas = data?.paradas ?? []
  const visitadas = paradas.filter((p) => p.estado === 'visitada').length
  const noVisitadas = paradas.filter((p) => p.estado === 'no_visitada').length

  /** Lo que se está haciendo mientras tanto: buscar la impresora tarda. */
  const [avance, setAvance] = useState<string | null>(null)

  // Los genéricos van explícitos porque `onError` vuelve a llamar a `imprimir`
  // —el reintento— y TypeScript no puede inferir un tipo que se referencia a sí
  // mismo mientras lo está construyendo.
  const imprimir = useMutation<ResultadoImpresion, Error, { comoPdf: boolean; conDialogo?: boolean }>({
    mutationFn: async (opciones) => {
      setAvance(null)
      return imprimirRolDeVisita({
        comoPdf: opciones.comoPdf,
        usarDialogoDelSistema: opciones.conDialogo,
        alAvisar: setAvance,
      })
    },
    onSuccess: (r, opciones) => {
      setAvance(null)
      const texto = [r.mensaje, r.advertencia].filter(Boolean).join('\n\n')

      // Por el diálogo del sistema Android no avisa si salió el papel; acá no
      // hay nada que marcar, así que sólo se informa.
      if (!opciones.comoPdf && r.via === 'sistema') {
        Alert.alert('Se abrió el diálogo de impresión', texto, [{ text: 'Entendido' }])
        return
      }

      Alert.alert(opciones.comoPdf ? 'PDF generado' : 'Enviado a la impresora', texto, [
        { text: 'Listo' },
      ])
    },
    // El error se muestra acá y se puede reintentar sin salir de la pantalla. El
    // diálogo de Android queda como tercera opción, sólo si el vendedor la elige.
    onError: (e: Error) => {
      setAvance(null)
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
      <Encabezado />

      <Panel contentStyle={estilos.contenido}>
        <BarraPanel alVolver={() => navigation.goBack()} />
        <TituloPanel>{'ROL DE VISITA\nDE HOY'}</TituloPanel>

        {isLoading ? (
          <Cargando texto="Armando la planilla…" />
        ) : error ? (
          <>
            <Aviso tono="error" titulo="No pudimos traer tu recorrido">
              Revisá la señal. Tus destinos están guardados: esto es sólo que no pudimos consultarlos.
            </Aviso>
            <BotonSecundario titulo="↻  Reintentar" alTocar={() => void refetch()} />
          </>
        ) : paradas.length === 0 ? (
          <Vacio
            titulo="Hoy no armaste recorrido"
            detalle="Cuando tengas destinos cargados para hoy, vas a poder imprimir o compartir la planilla desde acá."
            icono="🗺️"
          />
        ) : (
          <>
            <View style={estilos.resumen}>
              <Text style={estilos.resumenFecha}>{formatearFechaCorta(new Date())}</Text>
              <Text style={estilos.resumenLinea}>
                {perfil?.nombre_completo ?? 'Vendedor'}
                {perfil?.codigo_vendedor ? ` · Nº ${perfil.codigo_vendedor}` : ''}
              </Text>
              <View style={estilos.resumenPastillas}>
                <Pastilla texto={`${paradas.length} destino${paradas.length === 1 ? '' : 's'}`} color={colores.tintaSuave} />
                {visitadas > 0 ? (
                  <Pastilla texto={`${visitadas} visitada${visitadas === 1 ? '' : 's'}`} color={colores.estadoVisitada} />
                ) : null}
                {noVisitadas > 0 ? (
                  <Pastilla texto={`${noVisitadas} sin visitar`} color={colores.estadoNoVisitada} />
                ) : null}
              </View>
            </View>

            {paradas.map((p) => (
              <View key={p.id} style={estilos.fila}>
                <View style={[estilos.numero, { backgroundColor: colorDeEstado(p.estado, colores) }]}>
                  <Text style={estilos.numeroTexto}>{p.orden}</Text>
                </View>
                <View style={estilos.filaTextos}>
                  <Text style={estilos.filaCliente} numberOfLines={1}>
                    {p.cliente?.razon_social ?? p.razon_social_snapshot ?? 'Destino sin cliente'}
                  </Text>
                  <Text style={estilos.filaDireccion} numberOfLines={2}>
                    {p.direccion.direccion_formateada}
                  </Text>
                </View>
                <Pastilla
                  texto={ETIQUETA_ESTADO_PARADA[p.estado]}
                  color={colorDeEstado(p.estado, colores)}
                />
              </View>
            ))}

            {/* Buscar la impresora en la red puede llevar unos segundos. Sin
                decir qué está pasando, parecen segundos de nada. */}
            {avance ? <Aviso tono="info">{avance}</Aviso> : null}

            <BotonMenu
              titulo="IMPRIMIR"
              subtitulo="En la impresora de la oficina"
              alTocar={() => imprimir.mutate({ comoPdf: false })}
              cargando={imprimir.isPending}
            />
            <BotonSecundario
              titulo="Guardar / compartir PDF"
              alTocar={() => imprimir.mutate({ comoPdf: true })}
              cargando={imprimir.isPending}
            />
          </>
        )}
      </Panel>
    </Pantalla>
  )
}

/**
 * El color va como parámetro y no se pide adentro: se invoca dentro de un
 * `map`, y llamar a un gancho de tema ahí rompe la cuenta de ganchos de React.
 */
function colorDeEstado(estado: EstadoParada, colores: Paleta): string {
  switch (estado) {
    case 'visitada':
      return colores.estadoVisitada
    case 'no_visitada':
      return colores.estadoNoVisitada
    case 'en_camino':
      return colores.estadoEnCamino
    case 'omitida':
      return colores.estadoOmitida
    default:
      return colores.estadoPendiente
  }
}

const usarEstilos = hojaDeTema((t) => ({
  contenido: { gap: espaciado.md },

  resumen: {
    backgroundColor: t.colores.campoBlanco,
    borderWidth: 2,
    borderColor: t.colores.borde,
    borderRadius: radios.sm,
    padding: espaciado.md,
    gap: espaciado.xs,
  },
  resumenFecha: {
    fontFamily: t.tipografia.familia.subtitulo,
    fontSize: t.tipografia.tamano.base,
    color: t.colores.tinta,
  },
  resumenLinea: {
    fontFamily: t.tipografia.familia.cuerpo,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.tintaSuave,
  },
  resumenPastillas: {
    flexDirection: 'row',
    gap: espaciado.xs,
    flexWrap: 'wrap',
    marginTop: espaciado.xs,
  },

  fila: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaciado.md,
    backgroundColor: t.colores.panelClaro,
    borderWidth: 1.5,
    borderColor: t.colores.borde,
    borderRadius: radios.sm,
    padding: espaciado.sm,
    minHeight: 64,
  },
  numero: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: t.colores.borde,
  },
  numeroTexto: {
    fontFamily: t.tipografia.familia.titulo,
    fontSize: t.tipografia.tamano.sm,
    color: t.colores.blanco,
  },
  filaTextos: { flex: 1, gap: 2 },
  filaCliente: {
    fontFamily: t.tipografia.familia.fuerte,
    fontSize: t.tipografia.tamano.sm,
    color: t.colores.tinta,
  },
  filaDireccion: {
    fontFamily: t.tipografia.familia.liviana,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.tintaSuave,
  },
}))
