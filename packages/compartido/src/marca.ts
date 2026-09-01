/**
 * Sistema de diseño de WoodTools.
 *
 * Los colores salen de la identidad de la marca y de los mockups: fondo rojo
 * intenso, panel gris claro con borde negro marcado, y verde sólo para la
 * acción principal que hace avanzar al usuario.
 *
 * Es la única fuente de verdad de color y tipografía: la app móvil y el panel
 * de escritorio consumen estos mismos tokens para que no se desincronicen.
 */

/**
 * La paleta clara: la de siempre, la de los mockups.
 *
 * Se sigue llamando `colores` porque es el nombre que usa todo el sistema —el
 * panel de escritorio, las plantillas de impresión y las 34 pantallas de la
 * app— y renombrarla no habría corregido nada. Lo que cambió es que ahora
 * tiene una gemela oscura con exactamente las mismas claves, así que cualquier
 * pantalla puede pedir "la paleta que está puesta" en vez de ésta.
 */
export const colores = {
  /**
   * El fondo de la pantalla.
   *
   * Estaba escrito como `rojo` en todos lados, y ahí se mezclaban dos trabajos
   * distintos: el rojo de la marca —el de una pastilla, el de un renglón
   * destacado, el del reloj de arena mientras carga— y el color del papel
   * sobre el que se apoya todo. Con el tema oscuro dejan de poder ser lo
   * mismo: el fondo se va al negro y el acento tiene que ACLARARSE para que se
   * siga viendo. Un solo token no puede ir para los dos lados.
   */
  fondo: '#B30F0F',

  /**
   * El borde negro marcado, que es parte de la identidad de los mockups.
   *
   * Aparte de `negro` por la misma razón: en el tema oscuro un borde negro
   * sobre un panel casi negro no separa nada, así que ahí se aclara. Pero
   * `negro` también es el color de la LETRA sobre el botón verde, y esa letra
   * tiene que seguir siendo negra en los dos temas.
   */
  borde: '#0A0A0A',

  /** Rojo institucional. El acento: pastillas, totales, el indicador de carga. */
  rojo: '#B30F0F',
  rojoOscuro: '#8A0B0B',
  rojoClaro: '#D42222',
  /** Rojo de los botones del menú, un punto más profundo que el fondo. */
  rojoBoton: '#A00D0D',

  /**
   * El rojo que se usa como RELLENO con letra o ícono blanco encima.
   *
   * El botón del micrófono, el número del renglón, el pie de la hoja de
   * opciones. En el tema claro es idéntico al de la marca —nadie ve la
   * diferencia— y existe sólo para que en el oscuro pueda oscurecerse: ahí el
   * `rojo` se ACLARA para poder leerse sobre el panel negro, y un blanco sobre
   * ese rojo claro deja de leerse.
   */
  rojoSolido: '#B30F0F',

  /** Gris del panel central. */
  panel: '#DCDCDC',
  panelClaro: '#ECECEC',
  panelOscuro: '#C4C4C4',

  /** Campos de formulario. */
  campo: '#D5D5D5',
  campoBlanco: '#FFFFFF',

  negro: '#0A0A0A',
  tinta: '#141414',
  tintaSuave: '#4A4A4A',
  tintaTenue: '#7A7A7A',
  blanco: '#FFFFFF',

  /** Verde de "INICIAR SESIÓN" / "CONTINUAR" / "SÍ". */
  verde: '#00C853',
  verdeOscuro: '#009B40',
  /** Rojo del botón "NO", más saturado que el fondo para que se distinga. */
  rojoAccion: '#E01B24',

  ambar: '#F5A524',
  ambarOscuro: '#B87A12',
  azul: '#1D6FE0',

  /** Estados de parada. */
  estadoPendiente: '#7A7A7A',
  estadoEnCamino: '#1D6FE0',
  estadoVisitada: '#00C853',
  estadoNoVisitada: '#E01B24',
  estadoOmitida: '#B87A12',

  /** Prioridades. */
  prioridadAlta: '#E01B24',
  prioridadMedia: '#F5A524',
  prioridadBaja: '#7A7A7A',

  transparente: 'transparent',
  velo: 'rgba(0,0,0,0.55)',
  veloClaro: 'rgba(0,0,0,0.25)',
} as const

export const tipografia = {
  familia: {
    /** Titulares en mayúsculas — geométrica y contundente, como en los mockups. */
    titulo: 'Poppins_800ExtraBold',
    subtitulo: 'Poppins_700Bold',
    fuerte: 'Poppins_600SemiBold',
    cuerpo: 'Poppins_500Medium',
    liviana: 'Poppins_400Regular',
  },
  tamano: {
    micro: 11,
    xs: 13,
    sm: 15,
    base: 17,
    lg: 20,
    xl: 24,
    xxl: 30,
    display: 38,
    hero: 46,
  },
  interlineado: {
    ajustado: 1.15,
    normal: 1.4,
    holgado: 1.6,
  },
} as const

export const espaciado = {
  xs: 4,
  sm: 8,
  md: 12,
  base: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const

export const radios = {
  nulo: 0,
  sm: 6,
  md: 10,
  base: 14,
  lg: 20,
  pastilla: 999,
} as const

export const bordes = {
  /** El borde negro marcado es parte de la identidad visual de los mockups. */
  marcado: 2.5,
  medio: 1.5,
  fino: 1,
} as const

export const sombras = {
  panel: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.28,
    shadowRadius: 14,
    elevation: 8,
  },
  boton: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 5,
  },
  flotante: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.35,
    shadowRadius: 22,
    elevation: 14,
  },
} as const

/**
 * Altura mínima de cualquier elemento tocable.
 *
 * El vendedor usa la app parado en la calle, con una mano, muchas veces con
 * guantes o bajo el sol. 56 px es el piso, no el ideal.
 */
export const TOQUE_MINIMO = 56

/** Estilo del mapa: mantiene el mapa legible sin competir con el rojo de la marca. */
export const estiloMapa = [
  { featureType: 'poi.business', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.park', elementType: 'labels.text', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'simplified' }] },
] as const

export type Colores = typeof colores

/**
 * La forma de una paleta: exactamente las claves de la clara.
 *
 * El tipo se saca de `colores` y no se escribe a mano a propósito. Agregar un
 * color nuevo y olvidarse de darle valor en el tema oscuro sería un color que
 * queda `undefined` en la mitad de los teléfonos, y eso en React Native no
 * explota: dibuja transparente. Así el compilador lo caza antes.
 */
export type Paleta = { -readonly [K in keyof typeof colores]: string }

/**
 * La paleta oscura.
 *
 * ── Cómo está pensada ───────────────────────────────────────────────────────
 *
 * No es "la clara invertida". Invertir un rojo #B30F0F da un verde, y el fondo
 * de la app dejaría de ser WoodTools. Lo que se conserva es la ESTRUCTURA:
 * un fondo, un panel un punto más claro que el fondo, renglones un punto más
 * claros que el panel, y la letra en el extremo opuesto. En el tema claro esa
 * escalera va de oscuro a claro; acá va al revés.
 *
 * ── Por qué el fondo no es negro puro ───────────────────────────────────────
 *
 * Porque encima va un panel, y encima del panel renglones. Arrancando de
 * #000000 no quedan escalones abajo: los tres niveles terminan siendo el mismo
 * gris y la pantalla se lee como una sola mancha. Arrancando de #161314 hay
 * lugar para los tres, y el tinte cálido —es un negro con una gota de rojo, no
 * un gris azulado— es lo que hace que siga pareciendo la misma app.
 *
 * ── Qué NO cambia de color ──────────────────────────────────────────────────
 *
 * El blanco de la letra sobre los botones rojos, y el `negro` de la letra
 * sobre el botón verde. Esos dos viajan pegados a un fondo de color que es el
 * mismo en los dos temas, así que cambiarlos sólo empeoraría el contraste.
 */
export const paletaOscura: Paleta = {
  /** Casi negro, con una gota de rojo para que no se lea como un gris frío. */
  fondo: '#100E0F',

  /**
   * El borde se ACLARA. Es lo contrario de lo que uno escribiría, y es el
   * punto: un borde negro sobre un panel negro no separa nada. Lo que hace el
   * borde marcado en el tema claro —recortar el panel contra el fondo— acá lo
   * hace un gris medio.
   *
   * El valor está elegido con la cuenta de contraste hecha, no a ojo: contra
   * las cuatro superficies del tema oscuro —fondo, panel, renglón y campo— da
   * entre 3,2 y 4,3 a 1, que es el piso que pide la WCAG para algo que no es
   * texto pero hay que poder ver. Un punto más oscuro y el panel deja de tener
   * contorno; un punto más claro y la pantalla se llena de jaulas grises.
   */
  borde: '#807576',

  /**
   * El acento se aclara por lo mismo. El #B30F0F de la marca sobre el panel
   * oscuro queda en 1,6:1 de contraste: se ve una mancha, no se lee.
   */
  rojo: '#FF6B6B',
  rojoOscuro: '#3A1414',
  rojoClaro: '#FF8A8A',
  /**
   * El relleno de los botones del menú. Acá SÍ se oscurece en vez de aclararse,
   * porque encima va letra blanca: sobre el #FF6B6B del acento, el blanco
   * queda en 2,3:1 y no se lee.
   */
  rojoBoton: '#8E1A1A',
  /** Ver `rojoSolido` en la paleta clara: acá se oscurece por el mismo motivo. */
  rojoSolido: '#8E1A1A',

  /** El panel: un escalón por encima del fondo. */
  panel: '#241F20',
  /** Los renglones dentro del panel: otro escalón más. */
  panelClaro: '#302A2B',
  /** Separadores y lo deshabilitado. */
  panelOscuro: '#413A3B',

  campo: '#373132',
  /** El "campo blanco" deja de ser blanco: es la caja donde se escribe. */
  campoBlanco: '#2A2526',

  /** La letra sobre el botón verde. Igual en los dos temas: el verde no cambia. */
  negro: '#0A0A0A',
  tinta: '#F3EFEF',
  tintaSuave: '#C2BBBB',
  tintaTenue: '#8E8686',
  /** La letra sobre los botones rojos, y la chapa del logo. Sigue siendo blanco. */
  blanco: '#FFFFFF',

  verde: '#00D45A',
  verdeOscuro: '#00A94A',
  rojoAccion: '#FF5A5A',

  ambar: '#FFC15E',
  ambarOscuro: '#E5A02B',
  azul: '#6BA6FF',

  estadoPendiente: '#8E8686',
  estadoEnCamino: '#6BA6FF',
  estadoVisitada: '#00D45A',
  estadoNoVisitada: '#FF5A5A',
  estadoOmitida: '#E5A02B',

  prioridadAlta: '#FF5A5A',
  prioridadMedia: '#FFC15E',
  prioridadBaja: '#8E8686',

  transparente: 'transparent',
  /** El velo del modal. Más opaco que en el tema claro: abajo ya está oscuro. */
  velo: 'rgba(0,0,0,0.72)',
  veloClaro: 'rgba(0,0,0,0.45)',
}

/** La paleta clara, con el mismo tipo que la oscura. Es `colores`, nombrada. */
export const paletaClara: Paleta = { ...colores }
