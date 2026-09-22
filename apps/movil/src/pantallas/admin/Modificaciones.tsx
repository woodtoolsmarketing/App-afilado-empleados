import { espaciado, formatearFechaCorta, formatearHora, radios, TOQUE_MINIMO } from '@woodtools/compartido'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Alert, Pressable, Text, View } from 'react-native'
import * as FileSystem from 'expo-file-system'
import * as Sharing from 'expo-sharing'

import { BotonSecundario } from '../../componentes/Botones'
import { Aviso, Cargando, Vacio } from '../../componentes/Estado'
import { Encabezado } from '../../componentes/Encabezado'
import { BarraPanel, Pantalla, Panel, TituloPanel } from '../../componentes/Pantalla'
import { comoISO, modificacionesEntre, type FilaModificacion } from '../../servicios/administracion'
import type { PropsPantalla } from '../../navegacion/tipos'
import { hojaDeTema } from '../../nucleo/tema'

/**
 * "MODIFICACIONES DE CLIENTES" — la auditoría, en el teléfono.
 *
 * Es sólo lectura: cada fila es un campo de la ficha que se tocó —razón social,
 * nombre de fantasía o dirección—, con lo que decía antes y lo que quedó, quién
 * lo cambió y cuándo. Lo escribe un trigger, así que caen tanto los cambios del
 * mapa del celular como los del panel. Sirve para el control de fin de mes.
 *
 * En vez de dos campos de fecha —incómodos en un teléfono— se elige un período
 * de una lista corta. La misma tabla que en el panel se baja en Excel, acá se
 * comparte como CSV por WhatsApp.
 */

type ClaveRango = 'hoy' | 'semana' | 'mes' | 'mes_pasado'

interface Rango {
  clave: ClaveRango
  etiqueta: string
  desde: string
  hasta: string
}

/** Los períodos que se ofrecen, calculados sobre hoy. */
function rangosDisponibles(): Rango[] {
  const hoy = new Date()
  const iso = (d: Date) => comoISO(d)

  const haceSieteDias = new Date(hoy)
  haceSieteDias.setDate(hoy.getDate() - 6)

  const primeroDeEsteMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1)
  const primeroDelMesPasado = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1)
  const ultimoDelMesPasado = new Date(hoy.getFullYear(), hoy.getMonth(), 0)

  return [
    { clave: 'hoy', etiqueta: 'Hoy', desde: iso(hoy), hasta: iso(hoy) },
    { clave: 'semana', etiqueta: 'Últimos 7 días', desde: iso(haceSieteDias), hasta: iso(hoy) },
    { clave: 'mes', etiqueta: 'Este mes', desde: iso(primeroDeEsteMes), hasta: iso(hoy) },
    {
      clave: 'mes_pasado',
      etiqueta: 'Mes pasado',
      desde: iso(primeroDelMesPasado),
      hasta: iso(ultimoDelMesPasado),
    },
  ]
}

function nombreDeAutor(a: FilaModificacion['autor']): string {
  if (!a) return 'Sistema'
  return a.codigo_vendedor ? `${a.nombre_completo} (#${a.codigo_vendedor})` : a.nombre_completo
}

export function PantallaModificaciones({ navigation }: PropsPantalla<'AdminModificaciones'>) {
  const estilos = usarEstilos()
  const rangos = useMemo(rangosDisponibles, [])
  const [clave, setClave] = useState<ClaveRango>('mes')
  const [compartiendo, setCompartiendo] = useState(false)
  const rango = rangos.find((r) => r.clave === clave) ?? rangos[2]

  const { data: filas, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: ['modificaciones-clientes', rango.desde, rango.hasta],
    queryFn: () => modificacionesEntre(rango.desde, rango.hasta),
  })

  const total = filas?.length ?? 0

  async function compartir() {
    if (!filas || filas.length === 0 || compartiendo) return
    setCompartiendo(true)
    try {
      const csv = armarCsv(filas)
      const ruta = `${FileSystem.cacheDirectory}modificaciones-${rango.desde}-a-${rango.hasta}.csv`
      // BOM para que Excel abra los acentos bien.
      await FileSystem.writeAsStringAsync(ruta, `﻿${csv}`, {
        encoding: FileSystem.EncodingType.UTF8,
      })
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(ruta, { mimeType: 'text/csv', UTI: 'public.comma-separated-values-text' })
      } else {
        Alert.alert('No se puede compartir', 'Este teléfono no tiene con qué compartir el archivo.')
      }
    } catch (e) {
      Alert.alert('No pudimos compartir', (e as Error).message)
    } finally {
      setCompartiendo(false)
    }
  }

  return (
    <Pantalla>
      <Encabezado />

      <Panel contentStyle={estilos.contenido}>
        <BarraPanel alVolver={() => navigation.goBack()} />
        <TituloPanel>{'MODIFICACIONES\nDE CLIENTES'}</TituloPanel>

        <Text style={estilos.ayuda}>
          Lo que se cambió de la ficha de cada cliente —razón social, nombre de fantasía o dirección—
          en el período elegido.
        </Text>

        <View style={estilos.tiraRangos}>
          {rangos.map((r) => (
            <Pressable
              key={r.clave}
              onPress={() => setClave(r.clave)}
              accessibilityRole="button"
              accessibilityState={{ selected: r.clave === clave }}
              style={({ pressed }) => [
                estilos.chip,
                r.clave === clave && estilos.chipActivo,
                pressed && estilos.tocado,
              ]}
            >
              <Text style={[estilos.chipTexto, r.clave === clave && estilos.chipTextoActivo]}>
                {r.etiqueta}
              </Text>
            </Pressable>
          ))}
        </View>

        {isLoading ? (
          <Cargando texto="Trayendo los cambios…" />
        ) : error ? (
          <>
            <Aviso tono="error" titulo="No pudimos traer los cambios">
              Revisá la conexión y volvé a intentar. El historial está guardado: esto es sólo que no
              pudimos consultarlo.
            </Aviso>
            <BotonSecundario titulo="↻  Reintentar" alTocar={() => void refetch()} cargando={isRefetching} />
          </>
        ) : total === 0 ? (
          <Vacio titulo="No hay cambios en el período" icono="📋" />
        ) : (
          <>
            <Text style={estilos.conteo}>
              {total} {total === 1 ? 'cambio' : 'cambios'} · {rango.etiqueta.toLowerCase()}
            </Text>

            {/* Arriba de la lista: en un cierre de mes con cientos de filas, la
                acción principal no puede quedar al final de todo el scroll. */}
            <BotonSecundario
              titulo="📤  Compartir CSV"
              alTocar={() => void compartir()}
              cargando={compartiendo}
            />

            {filas!.map((f) => (
              <View key={f.id} style={estilos.fila}>
                <View style={estilos.filaCabecera}>
                  <Text style={estilos.filaCampo}>{f.campo}</Text>
                  <Text style={estilos.filaFecha}>
                    {formatearFechaCorta(new Date(f.modificado_en))} · {formatearHora(f.modificado_en)}
                  </Text>
                </View>
                <Text style={estilos.filaCliente} numberOfLines={1}>
                  {f.cliente?.razon_social ?? f.cliente_codigo ?? 'Cliente'}
                  {f.cliente?.codigo ? `  ·  Nº ${f.cliente.codigo}` : ''}
                </Text>
                <Text style={estilos.filaValor} numberOfLines={2}>
                  <Text style={estilos.filaRotulo}>Antes: </Text>
                  {f.valor_anterior ?? '(vacío)'}
                </Text>
                <Text style={estilos.filaValor} numberOfLines={2}>
                  <Text style={estilos.filaRotulo}>Después: </Text>
                  {f.valor_nuevo ?? '(vacío)'}
                </Text>
                <Text style={estilos.filaAutor}>{nombreDeAutor(f.autor)}</Text>
              </View>
            ))}
          </>
        )}
      </Panel>
    </Pantalla>
  )
}

/** Arma el CSV con las mismas columnas que el Excel del panel. */
function armarCsv(filas: FilaModificacion[]): string {
  const escapar = (v: string) => `"${v.replace(/"/g, '""')}"`
  const cabecera = ['Fecha y hora', 'Quién lo cambió', 'Cliente Nº', 'Cliente', 'Campo', 'Antes', 'Después']
  const lineas = [cabecera.map(escapar).join(',')]
  for (const f of filas) {
    lineas.push(
      [
        `${formatearFechaCorta(new Date(f.modificado_en))} ${formatearHora(f.modificado_en)}`,
        nombreDeAutor(f.autor),
        f.cliente?.codigo ?? f.cliente_codigo ?? '—',
        f.cliente?.razon_social ?? '—',
        f.campo,
        f.valor_anterior ?? '(vacío)',
        f.valor_nuevo ?? '(vacío)',
      ]
        .map((c) => escapar(String(c)))
        .join(','),
    )
  }
  return lineas.join('\n')
}

const usarEstilos = hojaDeTema((t) => ({
  contenido: { gap: espaciado.md },

  ayuda: {
    fontFamily: t.tipografia.familia.cuerpo,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.tintaSuave,
  },

  tiraRangos: { flexDirection: 'row', flexWrap: 'wrap', gap: espaciado.xs },
  chip: {
    minHeight: TOQUE_MINIMO - 8,
    justifyContent: 'center',
    paddingHorizontal: espaciado.md,
    paddingVertical: espaciado.xs,
    borderRadius: radios.sm,
    borderWidth: 2,
    borderColor: t.colores.borde,
    backgroundColor: t.colores.campoBlanco,
  },
  chipActivo: { backgroundColor: t.colores.rojo, borderColor: t.colores.rojo },
  chipTexto: {
    fontFamily: t.tipografia.familia.fuerte,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.tinta,
  },
  chipTextoActivo: { color: t.colores.blanco },
  tocado: { opacity: 0.7 },

  conteo: {
    fontFamily: t.tipografia.familia.subtitulo,
    fontSize: t.tipografia.tamano.sm,
    color: t.colores.tintaSuave,
    letterSpacing: 0.5,
  },

  fila: {
    backgroundColor: t.colores.campoBlanco,
    borderWidth: 1.5,
    borderColor: t.colores.borde,
    borderRadius: radios.sm,
    padding: espaciado.md,
    gap: 3,
  },
  filaCabecera: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: espaciado.sm },
  filaCampo: {
    fontFamily: t.tipografia.familia.subtitulo,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.rojo,
    letterSpacing: 0.5,
  },
  filaFecha: {
    fontFamily: t.tipografia.familia.liviana,
    fontSize: t.tipografia.tamano.micro,
    color: t.colores.tintaTenue,
  },
  filaCliente: {
    fontFamily: t.tipografia.familia.fuerte,
    fontSize: t.tipografia.tamano.sm,
    color: t.colores.tinta,
  },
  filaValor: {
    fontFamily: t.tipografia.familia.cuerpo,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.tinta,
  },
  filaRotulo: { fontFamily: t.tipografia.familia.subtitulo, color: t.colores.tintaSuave },
  filaAutor: {
    fontFamily: t.tipografia.familia.liviana,
    fontSize: t.tipografia.tamano.micro,
    color: t.colores.tintaSuave,
    marginTop: 2,
  },
}))
