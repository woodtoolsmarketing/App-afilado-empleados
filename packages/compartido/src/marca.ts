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

export const colores = {
  /** Rojo institucional. Fondo de todas las pantallas de la app móvil. */
  rojo: '#B30F0F',
  rojoOscuro: '#8A0B0B',
  rojoClaro: '#D42222',
  /** Rojo de los botones del menú, un punto más profundo que el fondo. */
  rojoBoton: '#A00D0D',

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
