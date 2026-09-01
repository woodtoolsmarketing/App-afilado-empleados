import {
  colores as paletaDeLaMarca,
  paletaOscura,
  tipografia as tipografiaDeLaMarca,
  type Paleta,
} from '@woodtools/compartido'
import {
  PixelRatio,
  StyleSheet,
  type ImageStyle,
  type TextStyle,
  type ViewStyle,
} from 'react-native'
import { create } from 'zustand'

import { cacheLocal } from './supabase'

/**
 * El tema de la app: qué paleta está puesta y de qué tamaño es la letra.
 *
 * ─── Por qué esto no podía resolverse con una constante ──────────────────────
 *
 * Las 34 pantallas escriben sus estilos con `StyleSheet.create({ … })` al pie
 * del archivo, y eso corre UNA vez: cuando el módulo se carga, mucho antes de
 * que nadie haya podido elegir nada. El color y el tamaño quedan congelados
 * ahí adentro. Cambiar `colores.tinta` en caliente no cambia ni un píxel,
 * porque lo que se dibuja es la copia que se sacó al arrancar.
 *
 * Por eso los estilos pasan a fabricarse: `hojaDeTema` recibe la receta y la
 * cocina cada vez que cambia el tema. El costo es una línea por pantalla; el
 * beneficio es que el tema oscuro y el tamaño de la letra funcionan de verdad
 * y no a medias.
 *
 * ─── Por qué se guarda en el teléfono y no en el servidor ────────────────────
 *
 * Porque es del teléfono, no del vendedor. El que ve mal necesita la letra
 * grande en SU aparato; si mañana usa otro, ese otro tiene su propio brillo,
 * su propio tamaño de pantalla y probablemente su propia respuesta. Y sobre
 * todo: tiene que andar sin señal, que es la mitad del día.
 */

export type ModoTema = 'claro' | 'oscuro'

export interface TipografiaDelTema {
  familia: typeof tipografiaDeLaMarca.familia
  /** Los mismos escalones de siempre, ya multiplicados por lo que se eligió. */
  tamano: { -readonly [K in keyof typeof tipografiaDeLaMarca.tamano]: number }
  interlineado: typeof tipografiaDeLaMarca.interlineado
}

export interface Tema {
  /** Identidad de esta combinación. Es la clave con la que se guardan las hojas. */
  id: string
  modo: ModoTema
  oscuro: boolean
  colores: Paleta
  tipografia: TipografiaDelTema
  /** Cuánto se agranda la letra respecto del diseño original. 1 es tal cual. */
  escala: number
}

// ─────────────────────────────────────────────────────────────────────────────
// El tamaño de la letra
// ─────────────────────────────────────────────────────────────────────────────

/**
 * De la barra 0–100 al multiplicador que se le aplica a la letra.
 *
 * La barra del mockup arranca en 0 y termina en 100, con el 50 en el medio. El
 * 50 tiene que ser EL TAMAÑO DE SIEMPRE: es el que ve el que nunca toca esta
 * pantalla, y no puede ser que mover la barra al centro le cambie la app.
 *
 * Por eso son dos tramos y no una recta: de 0 a 50 va de 0,80 a 1,00, y de 50
 * a 100 va de 1,00 a 1,60. La mitad de arriba estira más que la de abajo
 * porque para eso está: el que entra acá casi siempre viene a agrandar.
 */
export function multiplicadorDeLetra(porcentaje: number): number {
  const p = Math.max(0, Math.min(100, porcentaje))
  return p <= 50 ? 0.8 + (p / 50) * 0.2 : 1 + ((p - 50) / 50) * 0.6
}

/** El punto de la barra que deja la letra tal como fue diseñada. */
export const LETRA_NORMAL = 50

/** La barra se mueve de a cinco. Ver `hojaDeTema`: cada punto es una hoja más. */
export const PASO_DE_LA_BARRA = 5

/**
 * Cuánto hay que estirar la letra NOSOTROS, sabiendo que Android ya la estira.
 *
 * React Native multiplica todos los `fontSize` por el tamaño de letra del
 * sistema sin que nadie se lo pida. Si además multiplicáramos por lo que dice
 * la barra, el que tiene el teléfono en "letra grande" y elige "letra grande"
 * acá terminaría con el doble, no con lo que pidió.
 *
 * Así que se divide por lo del sistema para cancelarlo: lo que se ve en
 * pantalla termina siendo exactamente el multiplicador elegido. Y cuando está
 * tildado "usar el tamaño del celular" no se toca nada —escala 1— y manda el
 * teléfono, que es lo que la casilla promete.
 */
function escalaEfectiva(porcentaje: number, delCelular: boolean): number {
  if (delCelular) return 1
  const delSistema = PixelRatio.getFontScale() || 1
  return multiplicadorDeLetra(porcentaje) / delSistema
}

// ─────────────────────────────────────────────────────────────────────────────
// Lo que el vendedor eligió
// ─────────────────────────────────────────────────────────────────────────────

const CLAVE = 'ajustes_de_tema'

interface AjustesGuardados {
  modo: ModoTema
  porcentajeLetra: number
  letraDelCelular: boolean
}

const POR_DEFECTO: AjustesGuardados = {
  modo: 'claro',
  porcentajeLetra: LETRA_NORMAL,
  // Arranca tildado: sin esto, un vendedor que tiene el teléfono en letra
  // grande porque ve mal abriría la app y la vería chica, sin entender por qué.
  letraDelCelular: true,
}

interface EstadoTema extends AjustesGuardados {
  /** Falso hasta que se leyó lo guardado. Ver `App.tsx`: evita el parpadeo. */
  listo: boolean
  cargar: () => Promise<void>
  ponerModo: (modo: ModoTema) => void
  ponerPorcentajeLetra: (porcentaje: number) => void
  ponerLetraDelCelular: (usar: boolean) => void
}

/**
 * Guardar espera un momento antes de escribir de verdad.
 *
 * La barra del tamaño de letra avisa en cada movimiento del dedo —tiene que
 * hacerlo, porque la vista previa es en vivo—, y eso son decenas de avisos por
 * segundo. Escribir cada uno en el disco es cientos de escrituras en un solo
 * arrastre, en el mismo almacén donde vive la caché con la que la app anda sin
 * señal. Lo que importa guardar es dónde QUEDÓ la barra, no por dónde pasó.
 *
 * Un tercio de segundo es más largo que la pausa entre dos movimientos del
 * dedo y más corto que lo que tarda alguien en salir de la pantalla.
 */
const ESPERA_PARA_GUARDAR = 350
let guardadoPendiente: ReturnType<typeof setTimeout> | null = null

function guardar(estado: AjustesGuardados): void {
  if (guardadoPendiente) clearTimeout(guardadoPendiente)
  guardadoPendiente = setTimeout(() => {
    guardadoPendiente = null
    void cacheLocal
      .setItem(
        CLAVE,
        JSON.stringify({
          modo: estado.modo,
          porcentajeLetra: estado.porcentajeLetra,
          letraDelCelular: estado.letraDelCelular,
        }),
      )
      .catch(() => undefined)
  }, ESPERA_PARA_GUARDAR)
}

export const usarAjustesDeTema = create<EstadoTema>((set, get) => ({
  ...POR_DEFECTO,
  listo: false,

  cargar: async () => {
    try {
      const crudo = await cacheLocal.getItem(CLAVE)
      if (crudo) {
        const leido = JSON.parse(crudo) as Partial<AjustesGuardados>
        set({
          modo: leido.modo === 'oscuro' ? 'oscuro' : 'claro',
          porcentajeLetra:
            typeof leido.porcentajeLetra === 'number' && Number.isFinite(leido.porcentajeLetra)
              ? Math.max(0, Math.min(100, leido.porcentajeLetra))
              : LETRA_NORMAL,
          letraDelCelular: leido.letraDelCelular !== false,
        })
      }
    } catch {
      // Un ajuste ilegible se trata como si no estuviera: se arranca con el
      // tema de siempre. Nunca vale la pena no abrir la app por esto.
    } finally {
      set({ listo: true })
    }
  },

  ponerModo: (modo) => {
    if (modo === get().modo) return
    set({ modo })
    guardar({ ...get(), modo })
  },

  ponerPorcentajeLetra: (porcentaje) => {
    const limpio = Math.max(0, Math.min(100, Math.round(porcentaje)))
    // La barra avisa en cada movimiento del dedo, aunque el valor escalonado no
    // haya cambiado. Sin este corte, un arrastre de punta a punta obliga a
    // rehacer las hojas de estilo de las 27 pantallas montadas decenas de veces
    // por escalón, y el arrastre se pone a tirones en un teléfono común.
    if (limpio === get().porcentajeLetra) return
    set({ porcentajeLetra: limpio })
    guardar({ ...get(), porcentajeLetra: limpio })
  },

  ponerLetraDelCelular: (usar) => {
    if (usar === get().letraDelCelular) return
    set({ letraDelCelular: usar })
    guardar({ ...get(), letraDelCelular: usar })
  },
}))

// ─────────────────────────────────────────────────────────────────────────────
// El tema armado
// ─────────────────────────────────────────────────────────────────────────────

/** Se guardan armados: el tema cambia de vez en cuando, se lee todo el tiempo. */
const armados = new Map<string, Tema>()

function armar(modo: ModoTema, escala: number): Tema {
  const id = modo + '|' + escala.toFixed(3)
  const yaEsta = armados.get(id)
  if (yaEsta) return yaEsta

  const tamano = {} as TipografiaDelTema['tamano']
  for (const [nombre, valor] of Object.entries(tipografiaDeLaMarca.tamano)) {
    // Se redondea a medio punto: los tamaños con muchos decimales hacen que
    // dos textos del mismo escalón caigan en píxeles distintos y se vean
    // desalineados.
    tamano[nombre as keyof TipografiaDelTema['tamano']] = Math.round(valor * escala * 2) / 2
  }

  const tema: Tema = {
    id,
    modo,
    oscuro: modo === 'oscuro',
    colores: modo === 'oscuro' ? paletaOscura : (paletaDeLaMarca as unknown as Paleta),
    tipografia: {
      familia: tipografiaDeLaMarca.familia,
      tamano,
      interlineado: tipografiaDeLaMarca.interlineado,
    },
    escala,
  }
  armados.set(id, tema)
  return tema
}

/** El tema que está puesto ahora. Se vuelve a dibujar solo cuando cambia. */
export function usarTema(): Tema {
  const modo = usarAjustesDeTema((s) => s.modo)
  const porcentaje = usarAjustesDeTema((s) => s.porcentajeLetra)
  const delCelular = usarAjustesDeTema((s) => s.letraDelCelular)
  return armar(modo, escalaEfectiva(porcentaje, delCelular))
}

/**
 * El tema, para el código que no está dibujando.
 *
 * Sirve para cualquier cosa que necesite un color fuera de un componente. En un
 * componente va `usarTema()`, que además vuelve a dibujar cuando el tema cambia.
 */
export function temaActual(): Tema {
  const s = usarAjustesDeTema.getState()
  return armar(s.modo, escalaEfectiva(s.porcentajeLetra, s.letraDelCelular))
}

// ─────────────────────────────────────────────────────────────────────────────
// Las hojas de estilo
// ─────────────────────────────────────────────────────────────────────────────

type Reglas = Record<string, ViewStyle | TextStyle | ImageStyle>

/**
 * Cuántas hojas se recuerdan por pantalla.
 *
 * Cada combinación de tema y tamaño de letra es una hoja distinta. La barra se
 * mueve de a cinco, así que en teoría hay 21 tamaños por 2 temas: recordarlas
 * todas sería juntar basura de un rato en la pantalla de configuración. Cuatro
 * cubre lo real —el tema puesto, el otro, y un par de tamaños mientras se
 * prueba la barra— y armar una hoja de nuevo cuesta microsegundos.
 */
const HOJAS_RECORDADAS = 4

/**
 * Convierte una receta de estilos en un gancho que devuelve la hoja del tema.
 *
 * Reemplaza al `StyleSheet.create` suelto al pie del archivo:
 *
 *     const usarEstilos = hojaDeTema((t) => ({
 *       titulo: { color: t.colores.tinta, fontSize: t.tipografia.tamano.xl },
 *     }))
 *
 * y adentro del componente, `const estilos = usarEstilos()`.
 *
 * La hoja se arma una sola vez por tema y queda guardada, así que dibujar no
 * cuesta más que antes: lo único que se paga es la primera vez después de
 * cambiar de tema.
 */
export function hojaDeTema<T extends Reglas>(receta: (tema: Tema) => T): () => T {
  const guardadas = new Map<string, T>()

  return function usarEstilos(): T {
    const tema = usarTema()
    let hoja = guardadas.get(tema.id)
    if (!hoja) {
      hoja = StyleSheet.create(receta(tema) as Reglas as never) as T
      if (guardadas.size >= HOJAS_RECORDADAS) {
        const masVieja = guardadas.keys().next().value
        if (masVieja !== undefined) guardadas.delete(masVieja)
      }
      guardadas.set(tema.id, hoja)
    }
    return hoja
  }
}
