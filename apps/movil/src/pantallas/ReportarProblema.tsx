import {
  espaciado,
  etiquetaDelMotivo,
  formatearFechaCorta,
  MOTIVO_OTRO,
  MOTIVOS_DE_PROBLEMA,
  radios,
  ETIQUETA_ESTADO_REPORTE,
  type ReporteProblema,
} from '@woodtools/compartido'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Alert, Text, View } from 'react-native'

import { BotonPrincipal } from '../componentes/Botones'
import { Aviso, Pastilla } from '../componentes/Estado'
import { Encabezado } from '../componentes/Encabezado'
import { Campo, CampoConOpciones, Desplegable } from '../componentes/Formulario'
import { BarraPanel, Pantalla, Panel, TituloPanel } from '../componentes/Pantalla'
import { hojaDeTema, usarTema } from '../nucleo/tema'
import { cuandoSeDaFrecuente, misReportes, reportarProblema } from '../servicios/problemas'
import type { PropsPantalla } from '../navegacion/tipos'

/**
 * "REPORTAR UN PROBLEMA"
 *
 * ─── A dónde va lo que se escribe acá ───────────────────────────────────────
 *
 * A Marketing, que es el usuario que resuelve los problemas de la app. No
 * viaja por WhatsApp ni por mail: queda guardado con la versión, el modelo del
 * teléfono y el código de instalación puestos, y aparece en el panel de la
 * oficina. Un mensaje se lee una vez y se pierde en una conversación; un
 * reporte se puede contar, ordenar por cuántos lo tuvieron, y contestar.
 *
 * ─── Por qué el vendedor ve lo que ya reportó ───────────────────────────────
 *
 * Porque si no, reportar es hablarle a una pared. Abajo de todo está la lista
 * de lo suyo, con en qué estado quedó y qué le contestaron. Es también lo que
 * evita el mismo problema reportado cinco veces por la misma persona el mismo
 * día: se ve que ya avisó.
 */
export function PantallaReportarProblema({ navigation, route }: PropsPantalla<'ReportarProblema'>) {
  const estilos = usarEstilos()
  const { colores } = usarTema()
  const consultas = useQueryClient()

  const [motivo, setMotivo] = useState<string | null>(route.params?.motivo ?? null)
  const [detalle, setDetalle] = useState('')
  const [cuando, setCuando] = useState('')
  const [errorMotivo, setErrorMotivo] = useState<string | null>(null)
  const [errorDetalle, setErrorDetalle] = useState<string | null>(null)

  /*
   * Las respuestas que ya escribieron otros, para el segundo campo.
   *
   * Se piden por motivo: "cuándo se da" que sirve para la impresora no sirve
   * para el buscador de clientes. Cuando todavía no hay ninguna —al principio,
   * o para un motivo nuevo— la lista vuelve vacía y el campo queda como un
   * campo común, que es exactamente lo que hacía falta antes de que hubiera
   * historia que aprender.
   */
  const { data: sugerencias } = useQuery({
    queryKey: ['cuando-se-da', motivo],
    queryFn: () => cuandoSeDaFrecuente(motivo),
    enabled: !!motivo,
  })

  const { data: mios } = useQuery({
    queryKey: ['mis-reportes'],
    queryFn: () => misReportes(10),
  })

  const enviar = useMutation({
    mutationFn: () =>
      reportarProblema({
        motivo: motivo!,
        detalle: detalle,
        cuandoSeDa: cuando,
        pantalla: route.params?.pantalla ?? 'Reportar un problema',
      }),
    onSuccess: async () => {
      await consultas.invalidateQueries({ queryKey: ['mis-reportes'] })
      setDetalle('')
      setCuando('')
      setMotivo(null)
      Alert.alert(
        'Lo recibimos',
        'Le llegó a Marketing con la versión de tu app y el modelo de tu teléfono. Te contestan por acá mismo: lo vas a ver abajo, en "LO QUE YA REPORTASTE".',
        [{ text: 'Listo', onPress: () => navigation.goBack() }, { text: 'Reportar otro' }],
      )
    },
    onError: (e: Error) => Alert.alert('No pudimos enviarlo', e.message),
  })

  function revisarYEnviar() {
    if (!motivo) {
      setErrorMotivo('Elegí cuál es el problema.')
      return
    }
    setErrorMotivo(null)

    /*
     * Con "Otro" el detalle es obligatorio.
     *
     * Un reporte que dice "Otro" y nada más no se puede atender: no hay
     * pregunta que hacerle a nadie. Con el resto de los motivos el detalle
     * suma pero no hace falta —"la nota no sale por la impresora" ya se
     * entiende— y exigirlo sería el paso de más que hace que el vendedor deje
     * de reportar.
     */
    if (motivo === MOTIVO_OTRO && detalle.trim().length < 5) {
      setErrorDetalle('Contá con tus palabras qué pasó.')
      return
    }
    setErrorDetalle(null)

    enviar.mutate()
  }

  return (
    <Pantalla>
      <Encabezado />

      <Panel contentStyle={estilos.contenido}>
        <BarraPanel alVolver={() => navigation.goBack()} />
        <TituloPanel>{'REPORTAR\nUN PROBLEMA'}</TituloPanel>

        <Text style={estilos.senal}>⚠</Text>

        <Desplegable
          etiqueta="¿Cuál es el problema?"
          obligatorio
          marcador="Elegí una opción"
          valor={motivo}
          items={MOTIVOS_DE_PROBLEMA.map((m) => ({
            valor: m.valor,
            etiqueta: m.etiqueta,
            descripcion: m.descripcion,
          }))}
          alCambiar={(v) => {
            setMotivo(v)
            setErrorMotivo(null)
            // También el del detalle: pasando de "Otro" a cualquier otro motivo,
            // el campo deja de ser obligatorio y su cartel rojo quedaba puesto
            // sobre un campo que ya no lo pide.
            setErrorDetalle(null)
          }}
          error={errorMotivo}
        />

        {/*
          El campo de escribir aparece SIEMPRE, no sólo con "Otro".
          Con "Otro" es obligatorio y por eso cambia el rótulo; con los demás
          es donde entra lo que el desplegable no puede saber: qué cliente,
          qué código, qué decía el cartel.
        */}
        <Campo
          etiqueta={motivo === MOTIVO_OTRO ? '¿Qué pasó?' : 'Contalo con tus palabras (opcional)'}
          obligatorio={motivo === MOTIVO_OTRO}
          value={detalle}
          onChangeText={(texto) => {
            setDetalle(texto)
            if (errorDetalle) setErrorDetalle(null)
          }}
          placeholder="Qué estabas haciendo, con qué cliente, qué decía la pantalla…"
          multiline
          numberOfLines={4}
          error={errorDetalle}
        />

        <CampoConOpciones
          etiqueta="¿Cuándo suele darse el problema?"
          valor={cuando}
          onChangeText={setCuando}
          alElegir={setCuando}
          opciones={(sugerencias ?? []).map((s) => ({ valor: s }))}
          placeholder="Siempre / Al abrir la app / Cuando no hay señal…"
          sinCoincidencias="Ninguna de las respuestas anteriores coincide. Escribila como quieras."
          ayuda={
            (sugerencias ?? []).length > 0
              ? 'Tocá el campo para ver lo que contestaron los demás con este mismo problema.'
              : undefined
          }
        />

        <BotonPrincipal
          titulo="ENVIAR"
          alTocar={revisarYEnviar}
          cargando={enviar.isPending}
        />

        <Aviso tono="info" titulo="Qué viaja con el reporte">
          La versión de la app, el modelo del teléfono y su código de instalación. No hace falta
          que los busques ni que los sepas: es lo que necesita la oficina para reproducir el
          problema, y sin eso queda como "a veces falla".
        </Aviso>

        {(mios ?? []).length > 0 ? (
          <View style={estilos.mios}>
            <Text style={estilos.miosTitulo}>LO QUE YA REPORTASTE</Text>
            {(mios ?? []).map((r) => (
              <FilaReporte key={r.id} reporte={r} colorEstado={colorDelEstado(r, colores)} />
            ))}
          </View>
        ) : null}
      </Panel>
    </Pantalla>
  )
}

function FilaReporte({
  reporte,
  colorEstado,
}: {
  reporte: ReporteProblema
  colorEstado: string
}) {
  const estilos = usarEstilos()

  return (
    <View style={estilos.reporte}>
      <View style={estilos.reporteCabecera}>
        <Text style={estilos.reporteMotivo} numberOfLines={2}>
          {etiquetaDelMotivo(reporte.motivo)}
        </Text>
        <Pastilla texto={ETIQUETA_ESTADO_REPORTE[reporte.estado]} color={colorEstado} />
      </View>

      <Text style={estilos.reporteFecha}>{formatearFechaCorta(reporte.creado_en)}</Text>

      {reporte.detalle ? (
        <Text style={estilos.reporteDetalle} numberOfLines={3}>
          {reporte.detalle}
        </Text>
      ) : null}

      {/* La respuesta de la oficina es lo único por lo que vale la pena volver
          a esta pantalla, así que se destaca en vez de mezclarse con el resto. */}
      {reporte.respuesta ? (
        <View style={estilos.respuesta}>
          <Text style={estilos.respuestaTitulo}>Te contestaron</Text>
          <Text style={estilos.respuestaTexto}>{reporte.respuesta}</Text>
        </View>
      ) : null}
    </View>
  )
}

/**
 * El color va como parámetro y la cuenta como función suelta.
 *
 * No es un componente: pedirle el tema acá adentro sería llamar a un gancho de
 * React desde una función que se invoca en medio de un `map`.
 */
function colorDelEstado(
  reporte: ReporteProblema,
  colores: { azul: string; ambarOscuro: string; verdeOscuro: string; tintaTenue: string },
): string {
  switch (reporte.estado) {
    case 'nuevo':
      return colores.azul
    case 'en_revision':
      return colores.ambarOscuro
    case 'resuelto':
      return colores.verdeOscuro
    default:
      return colores.tintaTenue
  }
}

const usarEstilos = hojaDeTema((t) => ({
  contenido: { gap: espaciado.md },
  senal: {
    fontSize: t.tipografia.tamano.display,
    textAlign: 'center',
    color: t.colores.ambarOscuro,
  },

  mios: { gap: espaciado.sm, marginTop: espaciado.base },
  miosTitulo: {
    fontFamily: t.tipografia.familia.subtitulo,
    fontSize: t.tipografia.tamano.sm,
    color: t.colores.tintaSuave,
    letterSpacing: 1,
  },
  reporte: {
    backgroundColor: t.colores.panelClaro,
    borderRadius: radios.sm,
    padding: espaciado.sm,
    gap: espaciado.xs,
  },
  reporteCabecera: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: espaciado.sm,
  },
  reporteMotivo: {
    flex: 1,
    fontFamily: t.tipografia.familia.fuerte,
    fontSize: t.tipografia.tamano.sm,
    color: t.colores.tinta,
  },
  reporteFecha: {
    fontFamily: t.tipografia.familia.liviana,
    fontSize: t.tipografia.tamano.micro,
    color: t.colores.tintaTenue,
  },
  reporteDetalle: {
    fontFamily: t.tipografia.familia.liviana,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.tintaSuave,
  },
  respuesta: {
    backgroundColor: t.colores.campoBlanco,
    borderLeftWidth: 4,
    borderLeftColor: t.colores.verdeOscuro,
    borderRadius: radios.sm,
    padding: espaciado.sm,
    gap: 2,
  },
  respuestaTitulo: {
    fontFamily: t.tipografia.familia.subtitulo,
    fontSize: t.tipografia.tamano.micro,
    color: t.colores.verdeOscuro,
    letterSpacing: 0.5,
  },
  respuestaTexto: {
    fontFamily: t.tipografia.familia.cuerpo,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.tinta,
  },
}))
