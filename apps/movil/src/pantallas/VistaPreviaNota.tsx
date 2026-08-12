import {
  colores,
  espaciado,
  ETIQUETA_TIPO_NOTA,
  ETIQUETA_TIPO_SERVICIO,
  formatearPesos,
  nombreDeZona,
  notaImprimibleDesdeFila,
  radios,
  tipografia,
  type NotaParaImprimir,
} from '@woodtools/compartido'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Alert, StyleSheet, Text, View } from 'react-native'

import { BotonMenu, BotonSecundario } from '../componentes/Botones'
import { Aviso, Cargando, Pastilla } from '../componentes/Estado'
import { Encabezado } from '../componentes/Encabezado'
import { BarraPanel, Pantalla, Panel, TituloPanel } from '../componentes/Pantalla'
import { imprimirNotas, type ResultadoImpresion } from '../servicios/impresion'
import { marcarImpresas, obtenerNota } from '../servicios/notasPedido'
import type { PropsPantalla } from '../navegacion/tipos'

/**
 * Vista previa de la nota de pedido, antes de mandarla a la impresora.
 *
 * Muestra **lo mismo que se va a imprimir**, no una aproximación: sale de
 * `notaImprimibleDesdeFila`, la misma función que arma el HTML del talonario.
 * Si acá dice 187 dientes y $ 46.534,95, eso es lo que sale en papel.
 *
 * Lo que no es igual es la maqueta. Una hoja A4 metida en la pantalla de un
 * teléfono no se lee, así que en vez de encogerla se muestran los mismos datos
 * apilados y en el mismo orden que el formulario en papel. Para ver la hoja tal
 * cual está "GUARDAR COMO PDF", que genera el documento de verdad.
 */
export function PantallaVistaPreviaNota({ navigation, route }: PropsPantalla<'VistaPrevia'>) {
  const { notaIds, incluirRolDeVisita = false } = route.params
  const cliente = useQueryClient()

  const { data, isLoading, error } = useQuery({
    queryKey: ['vista-previa', notaIds],
    queryFn: async () => {
      const filas = await Promise.all(notaIds.map(obtenerNota))
      return filas.map((f) => notaImprimibleDesdeFila(f as Record<string, any>))
    },
  })

  /** Lo que se está haciendo mientras tanto: buscar la impresora tarda. */
  const [avance, setAvance] = useState<string | null>(null)

  // Los genéricos van explícitos porque `onError` vuelve a llamar a
  // `imprimir` —el reintento— y TypeScript no puede inferir un tipo que se
  // referencia a sí mismo mientras lo está construyendo.
  const imprimir = useMutation<
    ResultadoImpresion,
    Error,
    { comoPdf: boolean; conDialogo?: boolean }
  >({
    mutationFn: async (opciones: { comoPdf: boolean; conDialogo?: boolean }) => {
      setAvance(null)
      const r = await imprimirNotas({
        notaIds,
        incluirRolDeVisita,
        comoPdf: opciones.comoPdf,
        usarDialogoDelSistema: opciones.conDialogo,
        alAvisar: setAvance,
      })
      if (!opciones.comoPdf) await marcarImpresas(notaIds)
      return r
    },
    onSuccess: async (r, opciones) => {
      setAvance(null)
      await cliente.invalidateQueries()
      Alert.alert(
        opciones.comoPdf ? 'PDF generado' : 'Enviado a la impresora',
        [r.mensaje, r.advertencia].filter(Boolean).join('\n\n'),
        [{ text: 'Listo', onPress: () => navigation.goBack() }],
      )
    },
    /**
     * El error se muestra acá y se puede reintentar sin salir de la pantalla.
     *
     * El diálogo de Android queda como tercera opción, y sólo si el vendedor
     * la elige: antes se abría solo, lo sacaba de la app y hacía imposible
     * distinguir "no llegué a la impresora" de "elegí mal en el diálogo".
     */
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
      <Encabezado alAbrirMenu={() => navigation.navigate('Configuracion')} />

      <Panel contentStyle={estilos.contenido}>
        <BarraPanel alVolver={() => navigation.goBack()} />
        <TituloPanel>{'VISTA PREVIA\nANTES DE IMPRIMIR'}</TituloPanel>

        {isLoading ? (
          <Cargando texto="Armando la vista previa…" />
        ) : error ? (
          <Aviso tono="error" titulo="No pudimos armar la vista previa">
            {(error as Error).message}
          </Aviso>
        ) : (
          <>
            <Aviso tono="info" titulo="Qué estás viendo">
              Los mismos datos que van al papel, ordenados como el talonario. Revisá los códigos de
              cómputo, las cantidades y los precios. Si algo está mal, volvé y corregí la nota antes
              de imprimir.
            </Aviso>

            {(data ?? []).map((nota, i) => (
              <TarjetaVistaPrevia key={notaIds[i]} nota={nota} />
            ))}

            {incluirRolDeVisita ? (
              <Aviso tono="info">
                Adelante de las notas se imprime el rol de visita de hoy. No se muestra acá porque
                es la planilla del día, no parte de la nota.
              </Aviso>
            ) : null}

            {/* Buscar la impresora en la red puede llevar unos segundos. Sin
                decir qué está pasando, parecen segundos de nada. */}
            {avance ? <Aviso tono="info">{avance}</Aviso> : null}

            <BotonMenu
              titulo={'IMPRIMIR'}
              subtitulo={`${notaIds.length} nota${notaIds.length === 1 ? '' : 's'} · original y duplicado`}
              alTocar={() => imprimir.mutate({ comoPdf: false })}
              cargando={imprimir.isPending}
            />
            <BotonSecundario
              titulo="Guardar como PDF"
              alTocar={() => imprimir.mutate({ comoPdf: true })}
              cargando={imprimir.isPending}
            />
            <BotonSecundario titulo="Volver y corregir" alTocar={() => navigation.goBack()} />
          </>
        )}
      </Panel>
    </Pantalla>
  )
}

function TarjetaVistaPrevia({ nota }: { nota: NotaParaImprimir }) {
  // Las filas en blanco del talonario no se muestran: en papel están para
  // escribir a mano, y acá sólo serían diez renglones vacíos de scroll.
  const tecnicos = nota.tecnicos.filter((t) => t.descripcion || t.cantidad)
  // Una observación puede venir sola, en una fila sin código ni cantidad: son
  // las que se agregaron de más con "AGREGAR RENGLÓN". Si el filtro mira sólo
  // el cómputo, esas filas desaparecen de la vista previa y el vendedor firma
  // creyendo que la observación no quedó — cuando en el papel sí sale.
  const comerciales = nota.comerciales.filter(
    (c) => c.codigo_computo || c.cantidad || c.observaciones,
  )
  const observaciones = nota.comerciales.map((c) => c.observaciones).filter(Boolean)

  return (
    <View style={estilos.hoja}>
      {/* ── Cabecera ─────────────────────────────────────────────────────── */}
      <View style={estilos.cabecera}>
        <View style={estilos.cabeceraIzq}>
          <Text style={estilos.rotuloChico}>NOTA DE PEDIDO</Text>
          <Text style={estilos.numero}>
            {nota.numero ? `Nº ${nota.numero}` : '— — —'}
          </Text>
          {!nota.numero ? (
            <Text style={estilos.pendiente}>Pendiente del código de cliente</Text>
          ) : null}
        </View>
        <View style={estilos.cabeceraDer}>
          {nota.tipo_nota ? (
            <Pastilla
              texto={ETIQUETA_TIPO_NOTA[nota.tipo_nota]}
              color={nota.tipo_nota === 'factura' ? colores.azul : colores.tintaSuave}
            />
          ) : null}
          <Text style={estilos.dato}>Emisión: {nota.emision}</Text>
          <Text style={estilos.dato}>Entrega: {nota.fecha_entrega ?? '—'}</Text>
        </View>
      </View>

      <View style={estilos.pastillas}>
        {nota.servicios.map((s) => (
          <Pastilla key={s} texto={ETIQUETA_TIPO_SERVICIO[s]} color={colores.rojo} />
        ))}
      </View>

      <View style={estilos.identificacion}>
        <Text style={estilos.dato}>Vendedor Nº {nota.vendedor_numero || '—'}</Text>
        <Text style={estilos.dato}>Cliente Nº {nota.cliente_numero ?? '—'}</Text>
        <Text style={estilos.dato}>
          Zona {nota.zona || '—'}
          {nota.zona ? ` · ${nombreDeZona(nota.zona)}` : ''}
        </Text>
      </View>

      <Bloque titulo="DATOS DEL CLIENTE">{nota.datos_cliente || '—'}</Bloque>
      {nota.descripcion_herramientas ? (
        <Bloque titulo="DESCRIPCIÓN GENERAL">{nota.descripcion_herramientas}</Bloque>
      ) : null}

      {/* ── Características técnicas ─────────────────────────────────────── */}
      <Text style={estilos.tituloTabla}>CARACTERÍSTICAS TÉCNICAS</Text>
      {tecnicos.length === 0 ? (
        <Text style={estilos.vacio}>Sin renglones</Text>
      ) : (
        tecnicos.map((t, i) => (
          <View key={i} style={estilos.renglon}>
            <Text style={estilos.renglonTitulo}>{t.descripcion || '—'}</Text>
            <Text style={estilos.renglonDato}>
              {[
                `Cantidad ${t.cantidad}`,
                t.diametro_exterior ? `ØExt/Largo ${t.diametro_exterior}` : null,
                t.diametro_interior ? `ØInt/Ancho ${t.diametro_interior}` : null,
                t.ancho_corte ? `Ancho corte/Espesor ${t.ancho_corte}` : null,
                t.z_paso ? `Z-Paso ${t.z_paso}` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
            {/* La casilla de operación lleva la cantidad de dientes cuando el
                trabajo se cuenta por dientes: "Afilado 187". */}
            <View style={estilos.operaciones}>
              {(
                [
                  ['Afilado', t.afilado],
                  ['Rectificado', t.rectificado],
                  ['Reparación', t.reparacion],
                  ['Tensado', t.tensado],
                  ['Rellenado', t.rellenado],
                ] as Array<[string, boolean | number | string]>
              )
                .filter(([, valor]) => valor !== false && valor !== '' && valor !== 0)
                .map(([rotulo, valor]) => (
                  <Pastilla
                    key={rotulo}
                    texto={valor === true ? rotulo : `${rotulo} ${valor}`}
                    color={colores.verdeOscuro}
                  />
                ))}
              {t.otro ? <Pastilla texto={String(t.otro).toUpperCase()} color={colores.tintaSuave} /> : null}
            </View>
          </View>
        ))
      )}

      {/* ── Características comerciales ──────────────────────────────────── */}
      <Text style={estilos.tituloTabla}>CARACTERÍSTICAS COMERCIALES</Text>
      <View style={estilos.filaTabla}>
        <Text style={[estilos.celdaCabecera, estilos.colCodigo]}>Código</Text>
        <Text style={[estilos.celdaCabecera, estilos.colNum]}>Cant.</Text>
        <Text style={[estilos.celdaCabecera, estilos.colPrecio]}>Precio{'\n'}unitario</Text>
        <Text style={[estilos.celdaCabecera, estilos.colPrecio]}>Precio{'\n'}total</Text>
      </View>
      {comerciales.length === 0 ? (
        <Text style={estilos.vacio}>Sin cómputo</Text>
      ) : (
        comerciales.map((c, i) => (
          <View key={i} style={estilos.filaTabla}>
            <Text style={[estilos.celda, estilos.colCodigo]}>{c.codigo_computo || '—'}</Text>
            <Text style={[estilos.celda, estilos.colNum]}>{c.cantidad}</Text>
            <Text style={[estilos.celda, estilos.colPrecio]}>{c.precio_unitario || '—'}</Text>
            <Text style={[estilos.celda, estilos.colPrecio, estilos.celdaFuerte]}>
              {c.precio || '—'}
            </Text>
          </View>
        ))
      )}

      {/* ── Observaciones ────────────────────────────────────────────────────
          En el papel van en la última columna de la tabla comercial, una por
          renglón. Acá esa columna no entra —serían cinco columnas en el ancho
          de un teléfono— así que van listadas aparte, en el mismo orden en el
          que se van a imprimir. */}
      {observaciones.length > 0 ? (
        <>
          <Text style={estilos.tituloTabla}>OBSERVACIONES</Text>
          {observaciones.map((o, i) => (
            <View key={i} style={estilos.filaTabla}>
              <Text style={[estilos.celda, estilos.colNum]}>{i + 1}</Text>
              <Text style={[estilos.celda, estilos.colObservacion]}>{o}</Text>
            </View>
          ))}
        </>
      ) : null}

      {/* El renglón de reparación de dientes rotos se distingue por su
          condición de venta: conviene que se lea también acá. */}
      {comerciales.some((c) => c.condicion_venta) ? (
        <Text style={estilos.notaPie}>
          {comerciales
            .filter((c) => c.condicion_venta)
            .map((c) => `${c.codigo_computo}: ${c.condicion_venta}`)
            .join(' · ')}
        </Text>
      ) : null}

      <View style={estilos.pie}>
        <Text style={estilos.dato}>Condición de venta: {nota.condicion_venta || '—'}</Text>
        {/* Pasa por `formatearPesos` como en todas las demás pantallas. Salía
            crudo —"1234.56", sin signo y sin separador de miles—, que es el
            único lugar de la app donde un importe se mostraba así. */}
        <Text style={estilos.dato}>
          Tipo de cambio:{' '}
          {nota.tipo_cambio
            ? formatearPesos(Number(nota.tipo_cambio))
            : '(vacío — se cobra en pesos)'}
        </Text>
        <Text style={estilos.dato}>
          {nota.tipo_nota === 'factura'
            ? 'Sale con el logo de WoodTools en las dos copias.'
            : 'Presupuesto: sale sin logo.'}
        </Text>
      </View>
    </View>
  )
}

function Bloque({ titulo, children }: { titulo: string; children: string }) {
  return (
    <View style={estilos.bloque}>
      <Text style={estilos.rotuloChico}>{titulo}</Text>
      <Text style={estilos.bloqueTexto}>{children}</Text>
    </View>
  )
}

const estilos = StyleSheet.create({
  contenido: { gap: espaciado.md },

  hoja: {
    backgroundColor: colores.campoBlanco,
    borderWidth: 2,
    borderColor: colores.negro,
    borderRadius: radios.sm,
    padding: espaciado.md,
    gap: espaciado.sm,
  },

  cabecera: { flexDirection: 'row', justifyContent: 'space-between', gap: espaciado.sm },
  cabeceraIzq: { flex: 1 },
  cabeceraDer: { alignItems: 'flex-end', gap: 2 },

  rotuloChico: {
    fontFamily: tipografia.familia.subtitulo,
    fontSize: tipografia.tamano.micro,
    color: colores.rojo,
    letterSpacing: 0.8,
  },
  numero: {
    fontFamily: tipografia.familia.titulo,
    fontSize: tipografia.tamano.xl,
    color: colores.tinta,
  },
  pendiente: {
    fontFamily: tipografia.familia.liviana,
    fontSize: tipografia.tamano.micro,
    color: colores.ambarOscuro,
  },
  dato: {
    fontFamily: tipografia.familia.cuerpo,
    fontSize: tipografia.tamano.xs,
    color: colores.tintaSuave,
  },

  pastillas: { flexDirection: 'row', gap: espaciado.xs, flexWrap: 'wrap' },
  identificacion: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: espaciado.sm,
    borderTopWidth: 1,
    borderTopColor: colores.panelOscuro,
    paddingTop: espaciado.xs,
  },

  bloque: { gap: 2 },
  bloqueTexto: {
    fontFamily: tipografia.familia.cuerpo,
    fontSize: tipografia.tamano.xs,
    color: colores.tinta,
  },

  tituloTabla: {
    fontFamily: tipografia.familia.subtitulo,
    fontSize: tipografia.tamano.micro,
    color: colores.tinta,
    letterSpacing: 0.8,
    backgroundColor: colores.panelClaro,
    paddingHorizontal: espaciado.xs,
    paddingVertical: 3,
    marginTop: espaciado.xs,
  },
  vacio: {
    fontFamily: tipografia.familia.liviana,
    fontSize: tipografia.tamano.xs,
    color: colores.tintaTenue,
  },

  renglon: {
    borderBottomWidth: 1,
    borderBottomColor: colores.panelOscuro,
    paddingVertical: espaciado.xs,
    gap: 2,
  },
  renglonTitulo: {
    fontFamily: tipografia.familia.fuerte,
    fontSize: tipografia.tamano.xs,
    color: colores.tinta,
  },
  renglonDato: {
    fontFamily: tipografia.familia.liviana,
    fontSize: tipografia.tamano.micro,
    color: colores.tintaSuave,
  },
  operaciones: { flexDirection: 'row', gap: espaciado.xs, flexWrap: 'wrap' },

  filaTabla: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: colores.panelOscuro,
    paddingVertical: 3,
  },
  celdaCabecera: {
    fontFamily: tipografia.familia.subtitulo,
    fontSize: tipografia.tamano.micro,
    color: colores.tintaSuave,
  },
  celda: {
    fontFamily: tipografia.familia.cuerpo,
    fontSize: tipografia.tamano.xs,
    color: colores.tinta,
  },
  celdaFuerte: { fontFamily: tipografia.familia.fuerte, color: colores.verdeOscuro },
  colCodigo: { flex: 2 },
  colNum: { flex: 1, textAlign: 'right' },
  colPrecio: { flex: 2, textAlign: 'right' },
  colObservacion: { flex: 6 },

  notaPie: {
    fontFamily: tipografia.familia.liviana,
    fontSize: tipografia.tamano.micro,
    color: colores.ambarOscuro,
  },
  pie: { borderTopWidth: 1, borderTopColor: colores.panelOscuro, paddingTop: espaciado.xs },
})
