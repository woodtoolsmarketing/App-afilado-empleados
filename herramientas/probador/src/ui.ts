/**
 * Capa de interfaz del probador.
 *
 * DOM pelado, sin framework: el probador no es la app, es un banco de pruebas
 * de lo que la app le pide al backend. Cuanto menos maquinaria propia tenga,
 * menos cosas suyas puede estar probando en vez de las nuestras.
 *
 * Los colores, tamaños y espaciados salen de `packages/compartido/src/marca.ts`,
 * el mismo módulo que consumen la app y el panel. Si alguien cambia el rojo de
 * la marca, esto cambia con él.
 */

import { bordes, colores, espaciado, radios, tipografia, TOQUE_MINIMO } from '@woodtools/compartido'

type Hijo = Node | string | number | null | undefined | false | Hijo[]

interface Props {
  clase?: string
  texto?: string
  html?: string
  al?: Partial<Record<keyof HTMLElementEventMap, (e: Event) => void>>
  attr?: Record<string, string | number | boolean | null | undefined>
  estilo?: Partial<CSSStyleDeclaration>
}

/** Hyperscript mínimo. `h('div.panel', {...}, hijos)`. */
export function h<K extends keyof HTMLElementTagNameMap>(
  selector: K | string,
  props: Props = {},
  ...hijos: Hijo[]
): HTMLElement {
  const [etiqueta, ...clases] = selector.split('.')
  const nodo = document.createElement(etiqueta || 'div')

  if (clases.length) nodo.className = clases.join(' ')
  if (props.clase) nodo.className = [nodo.className, props.clase].filter(Boolean).join(' ')
  if (props.texto !== undefined) nodo.textContent = props.texto
  if (props.html !== undefined) nodo.innerHTML = props.html

  for (const [k, v] of Object.entries(props.attr ?? {})) {
    if (v === null || v === undefined || v === false) continue
    nodo.setAttribute(k, String(v))
  }
  for (const [k, v] of Object.entries(props.al ?? {})) {
    nodo.addEventListener(k, v as EventListener)
  }
  Object.assign(nodo.style, props.estilo ?? {})

  agregar(nodo, hijos)
  return nodo
}

function agregar(padre: HTMLElement, hijos: Hijo[]): void {
  for (const hijo of hijos) {
    if (hijo === null || hijo === undefined || hijo === false) continue
    if (Array.isArray(hijo)) agregar(padre, hijo)
    else if (typeof hijo === 'string' || typeof hijo === 'number') {
      padre.appendChild(document.createTextNode(String(hijo)))
    } else padre.appendChild(hijo)
  }
}

export function vaciar(nodo: HTMLElement): HTMLElement {
  while (nodo.firstChild) nodo.removeChild(nodo.firstChild)
  return nodo
}

// ─────────────────────────────────────────────────────────────────────────────
// Piezas que repiten los mockups
// ─────────────────────────────────────────────────────────────────────────────

export function titulo(texto: string): HTMLElement {
  return h('h1.titulo', { texto })
}

export function botonMenu(
  texto: string,
  alTocar: () => void,
  opciones: { subtitulo?: string; deshabilitado?: boolean } = {},
): HTMLElement {
  return h(
    'button.boton-menu',
    {
      al: { click: () => !opciones.deshabilitado && alTocar() },
      attr: { disabled: opciones.deshabilitado },
    },
    h('span.boton-menu-titulo', { texto }),
    opciones.subtitulo ? h('span.boton-menu-sub', { texto: opciones.subtitulo }) : null,
  )
}

export function botonPrincipal(texto: string, alTocar: () => void): HTMLElement {
  return h('button.boton-principal', { texto, al: { click: alTocar } })
}

export function botonSecundario(texto: string, alTocar: () => void): HTMLElement {
  return h('button.boton-secundario', { texto, al: { click: alTocar } })
}

export function pastilla(texto: string, color: string): HTMLElement {
  return h('span.pastilla', { texto, estilo: { background: color } })
}

export function aviso(
  tono: 'error' | 'exito' | 'atencion' | 'info',
  tituloAviso: string | null,
  cuerpo: string,
): HTMLElement {
  return h(
    `div.aviso.aviso-${tono}`,
    {},
    tituloAviso ? h('strong', { texto: tituloAviso }) : null,
    h('span', { texto: cuerpo }),
  )
}

export function campo(
  etiqueta: string,
  opciones: {
    valor?: string
    marcador?: string
    tipo?: string
    error?: string | null
    ayuda?: string
    alCambiar?: (valor: string) => void
    multilinea?: boolean
  } = {},
): HTMLElement {
  const entrada = h(opciones.multilinea ? 'textarea' : 'input', {
    clase: `campo-caja${opciones.error ? ' campo-error' : ''}`,
    attr: { type: opciones.tipo ?? 'text', placeholder: opciones.marcador ?? '', rows: 3 },
    al: {
      input: (e) => opciones.alCambiar?.((e.target as HTMLInputElement).value),
    },
  }) as HTMLInputElement
  entrada.value = opciones.valor ?? ''

  return h(
    'label.campo',
    {},
    h('span.campo-etiqueta', { texto: etiqueta }),
    entrada,
    opciones.ayuda ? h('span.campo-ayuda', { texto: opciones.ayuda }) : null,
    opciones.error ? h('span.campo-error-texto', { texto: opciones.error }) : null,
  )
}

export function desplegable<T extends string>(
  etiqueta: string,
  opciones: { valor: T | null; items: Array<{ valor: T; etiqueta: string }>; alCambiar: (v: T) => void },
  centrada = false,
): HTMLElement {
  const select = h('select.desplegable-caja', {
    al: { change: (e) => opciones.alCambiar((e.target as HTMLSelectElement).value as T) },
  }) as HTMLSelectElement

  for (const item of opciones.items) {
    const op = document.createElement('option')
    op.value = item.valor
    op.textContent = item.etiqueta
    if (item.valor === opciones.valor) op.selected = true
    select.appendChild(op)
  }

  return h(
    'label.campo',
    {},
    h('span.campo-etiqueta', { texto: etiqueta, clase: centrada ? 'centrada' : '' }),
    // El triángulo va fuera de la caja, como en el mockup del historial.
    h('span.desplegable-fila', {}, select, h('span.desplegable-flecha', { texto: '▼' })),
  )
}

export function casilla(etiqueta: string, valor: boolean, alCambiar: (v: boolean) => void): HTMLElement {
  const entrada = h('input', {
    attr: { type: 'checkbox' },
    al: { change: (e) => alCambiar((e.target as HTMLInputElement).checked) },
  }) as HTMLInputElement
  entrada.checked = valor
  return h('label.casilla', {}, entrada, h('span', { texto: etiqueta }))
}

export function cargando(texto = 'Cargando…'): HTMLElement {
  return h('div.cargando', { texto })
}

export function vacio(tituloVacio: string, detalle?: string): HTMLElement {
  return h('div.vacio', {}, h('strong', { texto: tituloVacio }), detalle ? h('span', { texto: detalle }) : null)
}

// ─────────────────────────────────────────────────────────────────────────────
// Hoja de estilos, derivada de los tokens de marca
// ─────────────────────────────────────────────────────────────────────────────

const px = (n: number) => `${n}px`

export const ESTILOS = `
:root {
  --rojo: ${colores.rojo};
  --rojo-boton: ${colores.rojoBoton};
  --rojo-accion: ${colores.rojoAccion};
  --panel: ${colores.panel};
  --panel-claro: ${colores.panelClaro};
  --panel-oscuro: ${colores.panelOscuro};
  --campo: ${colores.campo};
  --campo-blanco: ${colores.campoBlanco};
  --negro: ${colores.negro};
  --tinta: ${colores.tinta};
  --tinta-suave: ${colores.tintaSuave};
  --tinta-tenue: ${colores.tintaTenue};
  --verde: ${colores.verde};
  --verde-oscuro: ${colores.verdeOscuro};
  --azul: ${colores.azul};
  --ambar-oscuro: ${colores.ambarOscuro};
  --toque: ${px(TOQUE_MINIMO)};
}

* { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--rojo);
  color: var(--tinta);
  font-family: Poppins, 'Segoe UI', system-ui, -apple-system, sans-serif;
  font-size: ${px(tipografia.tamano.base)};
  -webkit-font-smoothing: antialiased;
}

/* El marco imita la pantalla del teléfono para que lo que se ve acá sea lo que
   se va a ver en la mano del vendedor, no una versión de escritorio. */
.telefono {
  width: 420px;
  max-width: 100vw;
  min-height: 100vh;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
}

.encabezado {
  display: flex;
  align-items: center;
  gap: ${px(espaciado.sm)};
  padding: ${px(espaciado.md)} ${px(espaciado.base)};
  color: #fff;
}
.encabezado .foto {
  width: 46px; height: 46px; border-radius: 50%;
  background: rgba(255,255,255,0.25);
  border: 2px solid #fff;
  display: grid; place-items: center;
  font-weight: 700; font-size: ${px(tipografia.tamano.base)};
}
.encabezado .quien { line-height: 1.15; }
.encabezado .nombre { font-weight: 700; }
.encabezado .rol { font-size: ${px(tipografia.tamano.xs)}; opacity: 0.9; }
.encabezado .marca {
  margin-left: auto; font-weight: 800; letter-spacing: 0.5px;
  background: #fff; color: var(--rojo);
  padding: 4px 10px; border-radius: ${px(radios.sm)};
}

.panel {
  flex: 1;
  background: var(--panel);
  border: ${px(bordes.marcado)} solid var(--negro);
  border-radius: ${px(radios.base)};
  margin: 0 ${px(espaciado.md)} ${px(espaciado.md)};
  padding: ${px(espaciado.base)};
  display: flex;
  flex-direction: column;
  gap: ${px(espaciado.md)};
}

.barra { display: flex; justify-content: space-between; align-items: center; }
.barra button {
  background: none; border: 0; cursor: pointer;
  font: inherit; font-weight: 600; color: var(--tinta);
  padding: ${px(espaciado.xs)} 0;
}
.barra .fecha { font-size: ${px(tipografia.tamano.xs)}; color: var(--tinta-suave); }

.titulo {
  margin: 0; text-align: center; text-transform: uppercase;
  font-size: ${px(tipografia.tamano.xxl)}; font-weight: 800;
  line-height: ${tipografia.interlineado.ajustado}; letter-spacing: 0.5px;
  white-space: pre-line;
}

.boton-menu {
  min-height: 74px; width: 100%; cursor: pointer;
  background: var(--rojo-boton); color: #fff;
  border: ${px(bordes.marcado)} solid var(--negro);
  border-radius: ${px(radios.sm)};
  padding: ${px(espaciado.md)} ${px(espaciado.base)};
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
  font: inherit;
  box-shadow: 0 3px 6px rgba(0,0,0,0.3);
}
.boton-menu:hover:not(:disabled) { filter: brightness(1.08); }
.boton-menu:disabled { opacity: 0.45; cursor: not-allowed; }
.boton-menu-titulo { font-weight: 700; font-size: ${px(tipografia.tamano.lg)}; text-transform: uppercase; white-space: pre-line; }
.boton-menu-sub { font-size: ${px(tipografia.tamano.xs)}; opacity: 0.85; }

.boton-principal {
  min-height: var(--toque); cursor: pointer; align-self: center; min-width: 220px;
  background: var(--verde); color: var(--negro);
  border: ${px(bordes.marcado)} solid var(--negro); border-radius: ${px(radios.sm)};
  font: inherit; font-weight: 800; font-size: ${px(tipografia.tamano.lg)};
  text-transform: uppercase; letter-spacing: 0.8px;
  box-shadow: 0 3px 6px rgba(0,0,0,0.3);
}
.boton-principal:hover { background: var(--verde-oscuro); }

.boton-secundario {
  min-height: var(--toque); width: 100%; cursor: pointer;
  background: var(--panel-claro); color: var(--tinta);
  border: 2px solid var(--negro); border-radius: ${px(radios.sm)};
  font: inherit; font-weight: 600;
}
.boton-secundario:hover { background: var(--panel-oscuro); }

.campo { display: flex; flex-direction: column; gap: ${px(espaciado.xs)}; }
.campo-etiqueta { font-weight: 500; font-size: ${px(tipografia.tamano.base)}; }
.campo-etiqueta.centrada { text-align: center; }
.campo-caja {
  min-height: var(--toque);
  background: var(--campo);
  border: 2px solid var(--negro); border-radius: ${px(radios.sm)};
  padding: ${px(espaciado.sm)} ${px(espaciado.md)};
  font: inherit; color: var(--tinta); width: 100%;
}
textarea.campo-caja { min-height: 90px; resize: vertical; }
.campo-error { border-color: var(--rojo-accion); border-width: 2.5px; }
.campo-error-texto { color: var(--rojo-accion); font-size: ${px(tipografia.tamano.xs)}; font-weight: 600; }
.campo-ayuda { color: var(--tinta-suave); font-size: ${px(tipografia.tamano.xs)}; }

.desplegable-fila { display: flex; align-items: center; }
.desplegable-caja {
  flex: 1; min-height: var(--toque);
  background: var(--campo-blanco);
  border: 2px solid var(--negro); border-radius: ${px(radios.sm)};
  padding: 0 ${px(espaciado.md)}; font: inherit; color: var(--tinta);
  appearance: none; cursor: pointer;
}
.desplegable-flecha { padding: 0 ${px(espaciado.sm)}; color: var(--tinta-suave); font-size: ${px(tipografia.tamano.xl)}; }

.casilla { display: flex; align-items: center; gap: ${px(espaciado.sm)}; min-height: var(--toque); cursor: pointer; }
.casilla input { width: 26px; height: 26px; accent-color: var(--verde-oscuro); }

.pastilla {
  display: inline-block; color: #fff; font-weight: 600;
  font-size: ${px(tipografia.tamano.micro)};
  padding: 3px 10px; border-radius: ${px(radios.pastilla)};
}

.aviso {
  border: 2px solid; border-radius: ${px(radios.sm)};
  padding: ${px(espaciado.md)};
  display: flex; flex-direction: column; gap: 2px;
  font-size: ${px(tipografia.tamano.xs)};
}
.aviso strong { font-size: ${px(tipografia.tamano.sm)}; }
.aviso-error    { background: rgba(224,27,36,0.12);  border-color: var(--rojo-accion); color: #8A0B0B; }
.aviso-exito    { background: rgba(0,200,83,0.14);   border-color: var(--verde-oscuro); color: #0A5A2A; }
.aviso-atencion { background: rgba(245,165,36,0.16); border-color: var(--ambar-oscuro); color: #6B4708; }
.aviso-info     { background: rgba(29,111,224,0.12); border-color: var(--azul); color: #123E7D; }

.cargando, .vacio {
  text-align: center; color: var(--tinta-suave);
  padding: ${px(espaciado.lg)} 0;
  display: flex; flex-direction: column; gap: ${px(espaciado.xs)};
}

/* ── Acordeón de los historiales ─────────────────────────────────────────── */
.dia-cabecera {
  display: flex; align-items: center; gap: ${px(espaciado.sm)};
  min-height: var(--toque); cursor: pointer;
  background: none; border: 0; font: inherit; width: 100%; text-align: left;
  padding: ${px(espaciado.xs)} 0;
}
.dia-titulo { font-weight: 700; font-size: ${px(tipografia.tamano.xl)}; text-transform: uppercase; }
.dia-flecha { color: var(--tinta-suave); font-size: ${px(tipografia.tamano.lg)}; }
.dia-conteo { margin-left: auto; font-weight: 600; font-size: ${px(tipografia.tamano.sm)}; color: var(--tinta-suave); }
.renglon-nota {
  display: block; width: 100%; text-align: left; cursor: pointer;
  background: none; border: 0; font: inherit; font-weight: 600;
  min-height: 48px; color: var(--tinta);
}
.renglon-nota:hover { text-decoration: underline; }
.renglon-pendiente { color: var(--tinta-tenue); }

/* ── Tarjetas de lista ───────────────────────────────────────────────────── */
.tarjeta {
  background: var(--campo-blanco);
  border: 2px solid var(--negro); border-radius: ${px(radios.sm)};
  padding: ${px(espaciado.md)};
  display: flex; flex-direction: column; gap: ${px(espaciado.xs)};
}
.tarjeta.elegida { border-color: var(--rojo); background: var(--panel-claro); }
.tarjeta-titulo { font-weight: 700; }
.tarjeta-dato { font-size: ${px(tipografia.tamano.xs)}; color: var(--tinta-suave); }
.fila { display: flex; gap: ${px(espaciado.sm)}; align-items: center; flex-wrap: wrap; }
.fila > .campo { flex: 1; }

/* ── Diagnóstico ─────────────────────────────────────────────────────────── */
.diag { display: flex; flex-direction: column; gap: ${px(espaciado.xs)}; }
.diag-fila {
  display: flex; align-items: center; gap: ${px(espaciado.sm)};
  background: var(--campo-blanco); border: 2px solid var(--negro);
  border-radius: ${px(radios.sm)}; padding: ${px(espaciado.sm)} ${px(espaciado.md)};
  font-size: ${px(tipografia.tamano.xs)};
}
.diag-estado { font-size: ${px(tipografia.tamano.lg)}; }
.diag-texto { flex: 1; }
.diag-detalle { color: var(--tinta-suave); }

.pie {
  color: rgba(255,255,255,0.85); text-align: center;
  font-size: ${px(tipografia.tamano.micro)};
  padding: 0 ${px(espaciado.base)} ${px(espaciado.base)};
}
.pie code { background: rgba(0,0,0,0.25); padding: 1px 5px; border-radius: 4px; }
`
