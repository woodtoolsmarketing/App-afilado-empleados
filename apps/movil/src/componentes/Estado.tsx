import { espaciado, radios } from '@woodtools/compartido'
import { Children, type ReactNode } from 'react'
import { ActivityIndicator, Text, View } from 'react-native'
import { hojaDeTema, usarTema, type Tema } from '../nucleo/tema'

/** Indicadores de carga, avisos y estados vacíos. */

export function Cargando({ texto = 'Cargando…' }: { texto?: string }) {
  const { colores } = usarTema()
  const estilos = usarEstilos()
  return (
    <View style={estilos.centrado}>
      <ActivityIndicator size="large" color={colores.rojo} />
      <Text style={estilos.textoCarga}>{texto}</Text>
    </View>
  )
}

export type TonoAviso = 'error' | 'exito' | 'atencion' | 'info'

interface Tono {
  fondo: string
  borde: string
  texto: string
}

/**
 * Los cuatro tonos del aviso, en el tema que esté puesto.
 *
 * Antes eran una constante del módulo, y no podían seguir siéndolo: el aviso
 * es un fondo apenas teñido con letra oscura encima, y sobre un panel negro
 * eso es letra oscura sobre fondo oscuro. En el tema oscuro se da vuelta la
 * receta —fondo teñido igual, pero letra CLARA del mismo color— y así el
 * aviso rojo sigue leyendo como rojo y sigue leyendo, a secas.
 */
function tonosDelTema(tema: Tema): Record<TonoAviso, Tono> {
  if (tema.oscuro) {
    return {
      error:    { fondo: 'rgba(255,90,90,0.16)',   borde: tema.colores.rojoAccion,   texto: '#FFB3B3' },
      exito:    { fondo: 'rgba(0,212,90,0.16)',    borde: tema.colores.verdeOscuro,  texto: '#7FE8AE' },
      atencion: { fondo: 'rgba(255,193,94,0.16)',  borde: tema.colores.ambarOscuro,  texto: '#FFD79A' },
      info:     { fondo: 'rgba(107,166,255,0.16)', borde: tema.colores.azul,         texto: '#B7D3FF' },
    }
  }
  return {
    error:    { fondo: 'rgba(224,27,36,0.12)',  borde: tema.colores.rojoAccion,  texto: '#8A0B0B' },
    exito:    { fondo: 'rgba(0,200,83,0.14)',   borde: tema.colores.verdeOscuro, texto: '#0A5A2A' },
    atencion: { fondo: 'rgba(245,165,36,0.16)', borde: tema.colores.ambarOscuro, texto: '#6B4708' },
    info:     { fondo: 'rgba(29,111,224,0.12)', borde: tema.colores.azul,        texto: '#123E7D' },
  }
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
  const tema = usarTema()
  const estilos = usarEstilos()
  const t = tonosDelTema(tema)[tono]

  // Un aviso escrito con una interpolación adentro —"La nota lleva {n}
  // operaciones"— no llega como un texto: llega partido en pedazos, y el
  // `typeof children === 'string'` de antes fallaba justo ahí. El texto suelto
  // caía dentro del View y React Native mata el proceso, no muestra un error.
  // Se veía como si el teléfono saltara solo a otra pantalla.
  //
  // Así que la pregunta no es "¿es UN texto?" sino "¿son TODOS texto?".
  const pedazos = Children.toArray(children)
  const esTexto = (p: unknown) => typeof p === 'string' || typeof p === 'number'
  const todoTexto = pedazos.length > 0 && pedazos.every(esTexto)

  return (
    <View
      style={[estilos.aviso, { backgroundColor: t.fondo, borderLeftColor: t.borde }]}
      accessibilityLiveRegion="polite"
    >
      {titulo ? <Text style={[estilos.avisoTitulo, { color: t.texto }]}>{titulo}</Text> : null}
      {todoTexto ? (
        // Todo en un solo Text: los pedazos son un párrafo, no renglones sueltos.
        <Text style={[estilos.avisoTexto, { color: t.texto }]}>{children}</Text>
      ) : (
        // Mezcla de texto y elementos. Hoy no hay ninguno así, pero envolver el
        // texto que ande suelto cuesta una línea y evita que el próximo aviso
        // mixto vuelva a tumbar la app.
        pedazos.map((p, i) =>
          esTexto(p) ? (
            <Text key={i} style={[estilos.avisoTexto, { color: t.texto }]}>
              {p}
            </Text>
          ) : (
            p
          ),
        )
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
  const estilos = usarEstilos()
  return (
    <View style={estilos.centrado}>
      <Text style={estilos.iconoVacio}>{icono}</Text>
      <Text style={estilos.tituloVacio}>{titulo}</Text>
      {detalle ? <Text style={estilos.detalleVacio}>{detalle}</Text> : null}
    </View>
  )
}

/**
 * Qué tan clara es una tinta, del 0 (negro) al 1 (blanco).
 *
 * Es la luminancia relativa de la WCAG, la misma cuenta con la que se mide el
 * contraste entre dos colores. Vive acá y no en el paquete compartido porque
 * es lo único que la usa: la pastilla, para decidir de qué color va su letra.
 */
function claridad(color: string): number {
  const hex = color.trim().replace('#', '')
  if (hex.length !== 3 && hex.length !== 6) return 0
  const corto = hex.length === 3
  const canal = (i: number) => {
    const trozo = corto ? hex[i] + hex[i] : hex.slice(i * 2, i * 2 + 2)
    const v = parseInt(trozo, 16) / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * canal(0) + 0.7152 * canal(1) + 0.0722 * canal(2)
}

/** Cuánto contrasta una tinta contra un fondo, en la escala de la WCAG. */
function contraste(claridadA: number, claridadB: number): number {
  const [alto, bajo] = claridadA >= claridadB ? [claridadA, claridadB] : [claridadB, claridadA]
  return (alto + 0.05) / (bajo + 0.05)
}

/**
 * Pastilla de estado (Pendiente / Visitada / …).
 *
 * ─── Por qué la letra la elige la pastilla y no el que la usa ───────────────
 *
 * Porque el que la usa pasa el RELLENO, y el relleno cambia con el tema. Antes
 * la letra era blanca siempre, y en el tema oscuro los rellenos se aclaran
 * justamente para poder verse sobre el panel negro: la pastilla VISITADA
 * quedaba con letra blanca sobre un verde #00D45A, o sea 2:1, un rectángulo
 * verde sin palabra adentro. Lo mismo el ámbar, el azul y el rojo.
 *
 * Y no era sólo un problema del tema oscuro: en el claro, la misma pastilla
 * verde con letra blanca ya venía en 2,2:1 desde el primer día. Se leía por
 * costumbre, no por contraste.
 *
 * Ahora la pastilla mira cuán claro es el relleno que le dieron y pone la letra
 * del otro lado. El que necesite otra cosa la sigue pudiendo forzar con
 * `colorTexto`.
 */
export function Pastilla({
  texto,
  color,
  colorTexto,
}: {
  texto: string
  color: string
  colorTexto?: string
}) {
  const { colores } = usarTema()
  const estilos = usarEstilos()
  /*
   * Se comparan las dos y gana la que contrasta más. No hay umbral elegido a
   * ojo: el punto en el que conviene pasarse al negro sale de la cuenta, y
   * está bastante más abajo de la mitad —cerca del 18 % de claridad— porque la
   * escala de luminancia no es lineal.
   */
  const delFondo = claridad(color)
  const conBlanco = contraste(claridad(colores.blanco), delFondo)
  const conNegro = contraste(claridad(colores.negro), delFondo)
  const tintaDeLaPastilla = colorTexto ?? (conNegro > conBlanco ? colores.negro : colores.blanco)
  return (
    <View style={[estilos.pastilla, { backgroundColor: color }]}>
      <Text style={[estilos.pastillaTexto, { color: tintaDeLaPastilla }]}>{texto}</Text>
    </View>
  )
}

const usarEstilos = hojaDeTema((t) => ({
  centrado: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: espaciado.lg,
    gap: espaciado.md,
    minHeight: 200,
  },
  textoCarga: {
    fontFamily: t.tipografia.familia.cuerpo,
    fontSize: t.tipografia.tamano.sm,
    color: t.colores.tintaSuave,
  },

  aviso: {
    borderLeftWidth: 4,
    borderRadius: radios.sm,
    padding: espaciado.md,
    gap: espaciado.xs,
  },
  avisoTitulo: {
    fontFamily: t.tipografia.familia.subtitulo,
    fontSize: t.tipografia.tamano.sm,
  },
  avisoTexto: {
    fontFamily: t.tipografia.familia.cuerpo,
    fontSize: t.tipografia.tamano.xs,
    lineHeight: t.tipografia.tamano.xs * t.tipografia.interlineado.normal,
  },

  iconoVacio: { fontSize: 44 },
  tituloVacio: {
    fontFamily: t.tipografia.familia.subtitulo,
    fontSize: t.tipografia.tamano.lg,
    color: t.colores.tinta,
    textAlign: 'center',
  },
  detalleVacio: {
    fontFamily: t.tipografia.familia.liviana,
    fontSize: t.tipografia.tamano.sm,
    color: t.colores.tintaSuave,
    textAlign: 'center',
  },

  pastilla: {
    paddingHorizontal: espaciado.sm,
    paddingVertical: 3,
    borderRadius: radios.pastilla,
    alignSelf: 'flex-start',
  },
  pastillaTexto: {
    fontFamily: t.tipografia.familia.fuerte,
    fontSize: t.tipografia.tamano.micro,
    letterSpacing: 0.4,
  },
}))
