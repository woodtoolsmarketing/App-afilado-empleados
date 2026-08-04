import { colores, espaciado, radios, tipografia } from '@woodtools/compartido'
import type { ReactNode } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'

/** Indicadores de carga, avisos y estados vacíos. */

export function Cargando({ texto = 'Cargando…' }: { texto?: string }) {
  return (
    <View style={estilos.centrado}>
      <ActivityIndicator size="large" color={colores.rojo} />
      <Text style={estilos.textoCarga}>{texto}</Text>
    </View>
  )
}

export type TonoAviso = 'error' | 'exito' | 'atencion' | 'info'

const TONOS: Record<TonoAviso, { fondo: string; borde: string; texto: string }> = {
  error:    { fondo: 'rgba(224,27,36,0.12)',  borde: colores.rojoAccion, texto: '#8A0B0B' },
  exito:    { fondo: 'rgba(0,200,83,0.14)',   borde: colores.verdeOscuro, texto: '#0A5A2A' },
  atencion: { fondo: 'rgba(245,165,36,0.16)', borde: colores.ambarOscuro, texto: '#6B4708' },
  info:     { fondo: 'rgba(29,111,224,0.12)', borde: colores.azul, texto: '#123E7D' },
}

export function Aviso({
  tono = 'info',
  titulo,
  children,
}: {
  tono?: TonoAviso
  titulo?: string
  children: ReactNode
}) {
  const t = TONOS[tono]
  return (
    <View
      style={[estilos.aviso, { backgroundColor: t.fondo, borderLeftColor: t.borde }]}
      accessibilityLiveRegion="polite"
    >
      {titulo ? <Text style={[estilos.avisoTitulo, { color: t.texto }]}>{titulo}</Text> : null}
      {typeof children === 'string' ? (
        <Text style={[estilos.avisoTexto, { color: t.texto }]}>{children}</Text>
      ) : (
        children
      )}
    </View>
  )
}

export function Vacio({
  titulo,
  detalle,
  icono = '📭',
}: {
  titulo: string
  detalle?: string
  icono?: string
}) {
  return (
    <View style={estilos.centrado}>
      <Text style={estilos.iconoVacio}>{icono}</Text>
      <Text style={estilos.tituloVacio}>{titulo}</Text>
      {detalle ? <Text style={estilos.detalleVacio}>{detalle}</Text> : null}
    </View>
  )
}

/** Pastilla de estado (Pendiente / Visitada / …). */
export function Pastilla({
  texto,
  color,
  colorTexto = colores.blanco,
}: {
  texto: string
  color: string
  colorTexto?: string
}) {
  return (
    <View style={[estilos.pastilla, { backgroundColor: color }]}>
      <Text style={[estilos.pastillaTexto, { color: colorTexto }]}>{texto}</Text>
    </View>
  )
}

const estilos = StyleSheet.create({
  centrado: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: espaciado.lg,
    gap: espaciado.md,
    minHeight: 200,
  },
  textoCarga: {
    fontFamily: tipografia.familia.cuerpo,
    fontSize: tipografia.tamano.sm,
    color: colores.tintaSuave,
  },

  aviso: {
    borderLeftWidth: 4,
    borderRadius: radios.sm,
    padding: espaciado.md,
    gap: espaciado.xs,
  },
  avisoTitulo: {
    fontFamily: tipografia.familia.subtitulo,
    fontSize: tipografia.tamano.sm,
  },
  avisoTexto: {
    fontFamily: tipografia.familia.cuerpo,
    fontSize: tipografia.tamano.xs,
    lineHeight: tipografia.tamano.xs * tipografia.interlineado.normal,
  },

  iconoVacio: { fontSize: 44 },
  tituloVacio: {
    fontFamily: tipografia.familia.subtitulo,
    fontSize: tipografia.tamano.lg,
    color: colores.tinta,
    textAlign: 'center',
  },
  detalleVacio: {
    fontFamily: tipografia.familia.liviana,
    fontSize: tipografia.tamano.sm,
    color: colores.tintaSuave,
    textAlign: 'center',
  },

  pastilla: {
    paddingHorizontal: espaciado.sm,
    paddingVertical: 3,
    borderRadius: radios.pastilla,
    alignSelf: 'flex-start',
  },
  pastillaTexto: {
    fontFamily: tipografia.familia.fuerte,
    fontSize: tipografia.tamano.micro,
    letterSpacing: 0.4,
  },
})
