/**
 * Probador de escritorio de la app del vendedor.
 *
 * NO es la app: es un banco de pruebas que habla con el MISMO Supabase y usa el
 * MISMO paquete compartido —tokens de marca, validaciones, tabla de campos por
 * herramienta y templates de impresión— para poder recorrer los circuitos desde
 * la PC sin compilar un APK.
 *
 * Lo que queda afuera está afuera porque un navegador no lo puede hacer, no
 * porque no esté programado: mapa y navegación (necesitan GPS y Google Maps
 * nativo), dictado por Gemini (micrófono + Edge Function) e impresión directa
 * por IPP (el navegador no abre un socket contra la impresora). Todo eso se
 * marca en pantalla en vez de simularse: un botón que finge imprimir sería peor
 * que no tenerlo.
 */

import {
  aNumero,
  CAMPOS_POR_HERRAMIENTA,
  colores,
  ENCABEZADO_VACIO,
  ETIQUETA_ESTADO_NOTA,
  ETIQUETA_HERRAMIENTA,
  ETIQUETA_MOTIVO_NO_VISITA,
  ETIQUETA_ROL,
  ETIQUETA_TIPO_MECHA,
  ETIQUETA_TIPO_NOTA,
  ETIQUETA_TIPO_SERVICIO,
  formatearDiaHistorial,
  formatearFechaCorta,
  formatearHora,
  formatearPesos,
  generarDocumentoImpresion,
  HERRAMIENTAS_POR_SERVICIO,
  ITEM_VACIO,
  MECHAS_CON_MANO,
  notaImprimibleDesdeFila,
  renglonNuevo,
  resumenRenglon,
  SINGULAR_HERRAMIENTA,
  soloNumeros,
  SUMAR_OTRA,
  totalDeRenglones,
  validarEncabezadoNota,
  validarItemNota,
  validarRenglones,
  type CampoItem,
  type FormularioItemNota,
  type FormularioNotaEncabezado,
  type Herramienta,
  type ManoMecha,
  type TipoMecha,
  type TipoNotaPedido,
  type TipoServicio,
} from '@woodtools/compartido'

import * as d from './datos'
import {
  aviso,
  botonMenu,
  botonPrincipal,
  botonSecundario,
  campo,
  cargando,
  casilla,
  desplegable,
  h,
  pastilla,
  titulo,
  vaciar,
  vacio,
  type ESTILOS,
} from './ui'

// ─────────────────────────────────────────────────────────────────────────────
// Estado
// ─────────────────────────────────────────────────────────────────────────────

interface Estado {
  perfil: Record<string, any> | null
  acceso: 'cargando' | 'sin_sesion' | 'pendiente' | 'rechazado' | 'suspendido' | 'dispositivo' | 'ok'
  error: string | null
  instalacion: string
}

const estado: Estado = { perfil: null, acceso: 'cargando', error: null, instalacion: '' }

const raiz = document.getElementById('app') as HTMLElement
let panelActual: HTMLElement | null = null
const pila: Array<() => HTMLElement> = []

function pantalla(constructor: () => HTMLElement, opciones: { apilar?: boolean } = {}): void {
  if (opciones.apilar !== false && panelActual) pila.push(ultimoConstructor)
  ultimoConstructor = constructor
  dibujar(constructor)
}

let ultimoConstructor: () => HTMLElement = () => h('div')

function dibujar(constructor: () => HTMLElement): void {
  vaciar(raiz)
  raiz.appendChild(
    h(
      'div.telefono',
      {},
      encabezado(),
      constructor(),
      h('div.pie', {
        html:
          'Probador de escritorio · no es la app. Mapa, dictado e impresión directa por IPP ' +
          'quedan afuera porque el navegador no los puede hacer.',
      }),
    ),
  )
  panelActual = raiz
}

/** Vuelve a dibujar la pantalla actual sin tocar la pila. */
function refrescar(): void {
  dibujar(ultimoConstructor)
}

function volver(): void {
  const anterior = pila.pop()
  if (anterior) {
    ultimoConstructor = anterior
    dibujar(anterior)
  }
}

function encabezado(): HTMLElement {
  const p = estado.perfil
  const iniciales = (p?.nombre_completo ?? '?')
    .split(' ')
    .slice(0, 2)
    .map((x: string) => x[0])
    .join('')
    .toUpperCase()

  return h(
    'header.encabezado',
    {},
    h('div.foto', { texto: p ? iniciales : '·' }),
    h(
      'div.quien',
      {},
      h('div.nombre', { texto: p?.nombre_completo ?? 'Sin sesión' }),
      h('div.rol', {
        texto: p
          ? `${ETIQUETA_ROL[p.rol as keyof typeof ETIQUETA_ROL]}${p.codigo_vendedor ? ` #${p.codigo_vendedor}` : ''}`
          : 'Probador',
      }),
    ),
    h('div.marca', { texto: 'WoodTools' }),
  )
}

function panel(...hijos: Array<Node | null | false>): HTMLElement {
  return h('main.panel', {}, ...hijos)
}

function barra(conVolver = true, fecha: Date = new Date()): HTMLElement {
  return h(
    'div.barra',
    {},
    conVolver && pila.length > 0
      ? h('button', { texto: '‹ Atrás', al: { click: volver } })
      : h('span'),
    h('span.fecha', { texto: formatearFechaCorta(fecha) }),
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Diagnóstico
// ─────────────────────────────────────────────────────────────────────────────

const ICONO: Record<string, string> = { ok: '✅', falta: '⛔', error: '❌', aviso: '⚠️' }

function pantallaDiagnostico(): HTMLElement {
  const lista = h('div.diag', {}, cargando('Revisando el backend…'))
  const nota = h('div')

  void d.haySesion().then((hay) => {
    if (!hay) {
      nota.appendChild(
        aviso(
          'atencion',
          'Sin sesión',
          'Varios chequeos no pueden leer nada hasta que inicies sesión: RLS los bloquea, y eso es el backend funcionando bien. Volvé a chequear después de entrar.',
        ),
      )
    }
  })

  void d.diagnosticar().then((chequeos) => {
    vaciar(lista)
    for (const c of chequeos) {
      lista.appendChild(
        h(
          'div.diag-fila',
          {},
          h('span.diag-estado', { texto: ICONO[c.estado] ?? '·' }),
          h(
            'div.diag-texto',
            {},
            h('strong', { texto: c.titulo }),
            h('div.diag-detalle', { texto: c.detalle }),
          ),
        ),
      )
    }
  })

  return panel(
    barra(),
    titulo('DIAGNÓSTICO'),
    aviso(
      'info',
      'Qué es esto',
      'Chequea contra tu proyecto qué está puesto y qué falta. Sirve para saber si un "no aparece nada" es la migración sin aplicar o simplemente que todavía no hay datos.',
    ),
    nota,
    lista,
    botonSecundario('Volver a chequear', () => refrescar()),
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Acceso
// ─────────────────────────────────────────────────────────────────────────────

function pantallaLogin(): HTMLElement {
  let usuario = localStorage.getItem('woodtools.probador.usuario') ?? ''
  let contrasena = ''
  let procesando = false

  const mensaje = h('div')

  async function entrar() {
    if (procesando) return
    procesando = true
    vaciar(mensaje).appendChild(cargando('Entrando…'))

    const email = d.normalizarUsuario(usuario)
    const { data, error } = await d.supabase.auth.signInWithPassword({ email, password: contrasena })

    if (error || !data.session) {
      procesando = false
      vaciar(mensaje).appendChild(
        aviso(
          'error',
          'No pudimos entrar',
          error?.message === 'Invalid login credentials'
            ? 'Usuario o contraseña incorrectos.'
            : (error?.message ?? 'Revisá la conexión.'),
        ),
      )
      return
    }

    localStorage.setItem('woodtools.probador.usuario', usuario.trim())
    await evaluarAcceso()
    procesando = false
    enrutarPorAcceso()
  }

  return panel(
    barra(false),
    titulo('INICIAR SESIÓN'),
    campo('USUARIO', {
      valor: usuario,
      marcador: 'asosa',
      ayuda: `Sin @ se completa con @${d.DOMINIO_USUARIO}, igual que en la app.`,
      alCambiar: (v) => (usuario = v),
    }),
    campo('CONTRASEÑA', { tipo: 'password', alCambiar: (v) => (contrasena = v) }),
    mensaje,
    botonPrincipal('INICIAR SESIÓN', () => void entrar()),
    botonSecundario('Ver diagnóstico del backend', () => pantalla(pantallaDiagnostico)),
  )
}

function pantallaBloqueada(tituloTexto: string, cuerpo: string, extra?: HTMLElement): HTMLElement {
  return panel(
    barra(false),
    titulo(tituloTexto),
    aviso('atencion', null, cuerpo),
    extra ?? null,
    botonSecundario('Cerrar sesión', () => {
      void d.supabase.auth.signOut().then(() => {
        estado.perfil = null
        estado.acceso = 'sin_sesion'
        pila.length = 0
        pantalla(pantallaLogin, { apilar: false })
      })
    }),
  )
}

async function evaluarAcceso(): Promise<void> {
  const { data: sesion } = await d.supabase.auth.getSession()
  if (!sesion.session) {
    estado.acceso = 'sin_sesion'
    estado.perfil = null
    return
  }

  const perfil = await d.obtenerPerfil(sesion.session.user.id)
  estado.perfil = perfil

  if (!perfil) {
    estado.acceso = 'sin_sesion'
    estado.error = 'No pudimos cargar tu perfil.'
    return
  }

  switch (perfil.estado) {
    case 'pendiente':
      estado.acceso = 'pendiente'
      return
    case 'rechazado':
      estado.acceso = 'rechazado'
      estado.error = perfil.motivo_rechazo ?? null
      return
    case 'suspendido':
    case 'baja':
      estado.acceso = 'suspendido'
      return
  }

  const dispositivo = await d.registrarYVerificarDispositivo(perfil.id)
  estado.instalacion = dispositivo.instalacion_id
  estado.acceso = dispositivo.autorizado ? 'ok' : 'dispositivo'
}

function enrutarPorAcceso(): void {
  pila.length = 0
  switch (estado.acceso) {
    case 'sin_sesion':
      return pantalla(pantallaLogin, { apilar: false })
    case 'pendiente':
      return pantalla(
        () =>
          pantallaBloqueada(
            'ESPERANDO\nAPROBACIÓN',
            'Tu alta todavía tiene que aprobarla un administrador desde el panel de escritorio.',
          ),
        { apilar: false },
      )
    case 'rechazado':
      return pantalla(
        () => pantallaBloqueada('ACCESO\nRECHAZADO', estado.error ?? 'Un administrador rechazó el acceso.'),
        { apilar: false },
      )
    case 'suspendido':
      return pantalla(
        () => pantallaBloqueada('CUENTA\nDADA DE BAJA', 'Hablá con la oficina.'),
        { apilar: false },
      )
    case 'dispositivo':
      return pantalla(
        () =>
          pantallaBloqueada(
            'DISPOSITIVO\nNO AUTORIZADO',
            'Esta PC quedó registrada como un dispositivo más y espera que un administrador la habilite desde el panel → Usuarios. Es el mismo candado que tiene el teléfono.',
            h('div.tarjeta', {}, h('div.tarjeta-dato', { texto: 'ID de instalación' }), h('code', { texto: estado.instalacion })),
          ),
        { apilar: false },
      )
    default:
      return pantalla(pantallaMenu, { apilar: false })
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Menú
// ─────────────────────────────────────────────────────────────────────────────

function pantallaMenu(): HTMLElement {
  return panel(
    barra(false),
    titulo('MENÚ'),
    botonMenu('VISITAS', () => pantalla(pantallaVisitas)),
    botonMenu('HISTORIAL\nDE VISITAS', () => pantalla(pantallaHistorialVisitas)),
    botonMenu('NOTAS\nDE PEDIDO', () => pantalla(pantallaNotasPedido)),
    botonSecundario('Diagnóstico del backend', () => pantalla(pantallaDiagnostico)),
    botonSecundario('Cerrar sesión', () => {
      void d.supabase.auth.signOut().then(() => {
        estado.perfil = null
        estado.acceso = 'sin_sesion'
        enrutarPorAcceso()
      })
    }),
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Visitas
// ─────────────────────────────────────────────────────────────────────────────

function pantallaVisitas(): HTMLElement {
  const lista = h('div', {}, cargando('Buscando tu recorrido…'))

  void d.jornadaDeHoy(estado.perfil!.id).then((jornada) => {
    vaciar(lista)
    if (!jornada || jornada.paradas.length === 0) {
      lista.appendChild(vacio('No tenés recorrido armado hoy', 'Se arma desde el panel de escritorio.'))
      return
    }
    for (const p of jornada.paradas) {
      lista.appendChild(
        h(
          'div.tarjeta',
          {},
          h('div.fila', {}, h('span.tarjeta-titulo', { texto: `${p.orden}. ${p.cliente?.razon_social ?? p.razon_social_snapshot ?? '—'}` })),
          h('div.tarjeta-dato', { texto: p.direccion?.direccion_formateada ?? p.direccion_snapshot ?? '' }),
          h(
            'div.fila',
            {},
            pastilla(p.estado.toUpperCase(), colorParada(p.estado)),
            p.visita ? pastilla(p.visita.visitado ? 'VISITADO' : 'NO VISITADO', p.visita.visitado ? colores.verdeOscuro : colores.rojoAccion) : null,
            p.llegada_en ? h('span.tarjeta-dato', { texto: formatearHora(p.llegada_en) }) : null,
          ),
          p.visita?.observacion ? h('div.tarjeta-dato', { texto: p.visita.observacion }) : null,
        ),
      )
    }
  })

  return panel(
    barra(),
    titulo('VISITAS DE HOY'),
    aviso(
      'info',
      'Sin mapa',
      'El recorrido optimizado y la navegación quedan en el teléfono: necesitan GPS y el Maps nativo. Acá se ve la lista y el estado de cada destino.',
    ),
    lista,
  )
}

function colorParada(estadoParada: string): string {
  switch (estadoParada) {
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

// ─────────────────────────────────────────────────────────────────────────────
// Acordeón compartido por los dos historiales
// ─────────────────────────────────────────────────────────────────────────────

function acordeon(
  dias: Array<{ clave: string; fecha: string; conteo?: string; renglones: HTMLElement[] }>,
  abiertos: Record<string, boolean>,
  alAlternar: (clave: string) => void,
): HTMLElement {
  const cont = h('div')
  dias.forEach((dia, i) => {
    // El primer día arranca abierto, como en la app.
    const abierto = abiertos[dia.clave] ?? i === 0
    cont.appendChild(
      h(
        'div',
        {},
        h(
          'button.dia-cabecera',
          { al: { click: () => alAlternar(dia.clave) } },
          h('span.dia-titulo', { texto: formatearDiaHistorial(dia.fecha) }),
          h('span.dia-flecha', { texto: abierto ? '▲' : '▼' }),
          dia.conteo ? h('span.dia-conteo', { texto: dia.conteo }) : null,
        ),
        abierto ? h('div', {}, ...dia.renglones) : null,
      ),
    )
  })
  return cont
}

const PERIODOS: Array<{ valor: string; etiqueta: string; dias: number }> = [
  { valor: 'semana', etiqueta: 'ÚLTIMA SEMANA', dias: 7 },
  { valor: 'mes', etiqueta: 'MES ANTERIOR', dias: 30 },
  { valor: 'noventa', etiqueta: 'ÚLTIMOS 90 DÍAS', dias: 90 },
]

function rango(periodo: string): { desde: string; hasta: string } {
  const dias = PERIODOS.find((p) => p.valor === periodo)?.dias ?? 7
  const hasta = new Date()
  const desde = new Date()
  desde.setDate(hasta.getDate() - dias)
  const iso = (x: Date) => x.toISOString().slice(0, 10)
  return { desde: iso(desde), hasta: iso(hasta) }
}

// ─────────────────────────────────────────────────────────────────────────────
// Historial de visitas
// ─────────────────────────────────────────────────────────────────────────────

let periodoVisitas = 'semana'
const abiertosVisitas: Record<string, boolean> = {}

function pantallaHistorialVisitas(): HTMLElement {
  const cont = h('div', {}, cargando('Buscando tus visitas…'))
  const { desde, hasta } = rango(periodoVisitas)

  void d
    .historialVisitas(desde, hasta)
    .then((dias) => {
      vaciar(cont)
      if (!dias.length) {
        cont.appendChild(vacio('Sin visitas en este período'))
        return
      }
      cont.appendChild(
        acordeon(
          dias.map((dia) => ({
            clave: dia.rol_visita_id,
            fecha: dia.fecha,
            conteo: `${dia.visitadas}/${dia.total_paradas}`,
            renglones: (dia.detalle ?? [])
              .filter((x: Record<string, any>) => x.parada_id)
              .map((x: Record<string, any>) =>
                h(
                  'div.renglon-nota',
                  {},
                  h('strong', { texto: `${x.cliente}: ` }),
                  x.visitado === false
                    ? `No visitado — ${x.motivo ? (ETIQUETA_MOTIVO_NO_VISITA[x.motivo as keyof typeof ETIQUETA_MOTIVO_NO_VISITA] ?? x.motivo) : 'sin motivo'}`
                    : x.visitado === true
                      ? `Visitado ${x.hora ? `a las ${formatearHora(x.hora)}` : ''}`
                      : 'Sin visitar',
                ),
              ),
          })),
          abiertosVisitas,
          (clave) => {
            abiertosVisitas[clave] = !(abiertosVisitas[clave] ?? false)
            refrescar()
          },
        ),
      )
    })
    .catch((e: Error) => {
      vaciar(cont).appendChild(aviso('error', 'No pudimos cargar el historial', e.message))
    })

  return panel(
    barra(),
    titulo('HISTORIAL\nDE VISITAS'),
    desplegable(
      'PERIODO',
      {
        valor: periodoVisitas,
        items: PERIODOS.map((p) => ({ valor: p.valor, etiqueta: p.etiqueta })),
        alCambiar: (v) => {
          periodoVisitas = v
          refrescar()
        },
      },
      true,
    ),
    cont,
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Notas de pedido
// ─────────────────────────────────────────────────────────────────────────────

function pantallaNotasPedido(): HTMLElement {
  const contador = h('span')
  void d.notasPendientes().then((n) => (contador.textContent = String(n.length)))

  return panel(
    barra(),
    titulo('NOTAS\nDE PEDIDO'),
    botonMenu('GENERAR NUEVA\nNOTA DE PEDIDO', () => pantalla(pantallaGenerarNota)),
    botonMenu('VER NOTAS\nPENDIENTES', () => pantalla(pantallaNotasPendientes)),
    botonMenu('HISTORIAL\nDE NOTAS', () => pantalla(pantallaHistorialNotas)),
  )
}

let periodoNotas = 'semana'
const abiertosNotas: Record<string, boolean> = {}

function pantallaHistorialNotas(): HTMLElement {
  const cont = h('div', {}, cargando('Buscando tus notas…'))
  const { desde, hasta } = rango(periodoNotas)

  void d
    .historialNotas(desde, hasta)
    .then((dias) => {
      vaciar(cont)
      if (!dias.length) {
        cont.appendChild(vacio('Sin notas en este período', 'Probá con otro rango.'))
        return
      }
      cont.appendChild(
        acordeon(
          dias.map((dia) => ({
            clave: dia.fecha,
            fecha: dia.fecha,
            renglones: dia.detalle.map((n) =>
              h('button.renglon-nota', {
                clase: n.numero === null ? 'renglon-pendiente' : '',
                texto:
                  n.numero === null
                    ? '- NOTA DE PEDIDO — — —'
                    : `- NOTA DE PEDIDO Nº ${String(n.numero).padStart(6, '0')}`,
                al: { click: () => pantalla(() => pantallaDetalleNota(n.nota_id)) },
              }),
            ),
          })),
          abiertosNotas,
          (clave) => {
            abiertosNotas[clave] = !(abiertosNotas[clave] ?? false)
            refrescar()
          },
        ),
      )
    })
    .catch((e: Error) => {
      vaciar(cont).appendChild(aviso('error', 'No pudimos cargar el historial', e.message))
    })

  return panel(
    barra(),
    titulo('HISTORIAL DE\nNOTAS DE PEDIDO'),
    desplegable(
      'PERIODO',
      {
        valor: periodoNotas,
        items: PERIODOS.map((p) => ({ valor: p.valor, etiqueta: p.etiqueta })),
        alCambiar: (v) => {
          periodoNotas = v
          refrescar()
        },
      },
      true,
    ),
    cont,
  )
}

const elegidas = new Set<string>()

function pantallaNotasPendientes(): HTMLElement {
  const cont = h('div', {}, cargando('Buscando tus notas…'))
  let conRol = false
  const acciones = h('div')

  void d.notasPendientes().then((notas) => {
    vaciar(cont)
    if (!notas.length) {
      cont.appendChild(vacio('No tenés notas pendientes'))
      return
    }
    for (const n of notas) {
      const marcada = elegidas.has(n.id)
      cont.appendChild(
        h(
          'div.tarjeta',
          { clase: marcada ? 'elegida' : '' },
          h(
            'div.fila',
            {},
            casilla('', marcada, (v) => {
              if (v) elegidas.add(n.id)
              else elegidas.delete(n.id)
              refrescar()
            }),
            h('span.tarjeta-titulo', {
              texto:
                n.numero === null
                  ? 'NOTA DE PEDIDO — — —'
                  : `NOTA DE PEDIDO Nº ${String(n.numero).padStart(6, '0')}`,
            }),
          ),
          h('div.tarjeta-dato', {
            texto: `${n.cliente_codigo ? `${n.cliente_codigo} · ` : ''}${n.cliente_nombre}`,
          }),
          h(
            'div.fila',
            {},
            n.tipo_nota ? pastilla(ETIQUETA_TIPO_NOTA[n.tipo_nota as TipoNotaPedido], n.tipo_nota === 'factura' ? colores.azul : colores.tintaSuave) : null,
            n.numero === null ? pastilla('ESPERA CÓD. CLIENTE', colores.ambarOscuro) : null,
            n.total ? h('span.tarjeta-dato', { texto: formatearPesos(Number(n.total)) }) : null,
            h('span.tarjeta-dato', { texto: formatearHora(n.creado_en) }),
          ),
          botonSecundario('Ver detalle', () => pantalla(() => pantallaDetalleNota(n.id))),
        ),
      )
    }

    const objetivo = elegidas.size ? notas.filter((n) => elegidas.has(n.id)) : notas
    const ids = objetivo.map((n) => n.id)
    const estadoAccion = h('div')

    vaciar(acciones).appendChild(
      h(
        'div',
        {},
        casilla('SUMAR EL ROL DE VISITA DE HOY', conRol, (v) => (conRol = v)),
        botonMenu('IMPRIMIR NOTAS\nDE PEDIDO', conAviso(() => imprimir(ids, conRol), estadoAccion), {
          subtitulo: `${objetivo.length} nota${objetivo.length === 1 ? '' : 's'} · abre el diálogo del navegador`,
        }),
        botonSecundario(
          'Ver el documento en otra pestaña',
          conAviso(() => verDocumento(ids, conRol), estadoAccion),
        ),
        estadoAccion,
      ),
    )
  })

  return panel(
    barra(),
    titulo('NOTAS DE PEDIDO\nPENDIENTES'),
    aviso(
      'info',
      'Impresión',
      'Se arma el mismo documento que manda la app, con el template compartido. "Imprimir" abre el diálogo del navegador — ahí elegís la impresora o "Guardar como PDF". El envío directo por IPP a la de la oficina sólo puede hacerlo el teléfono.',
    ),
    cont,
    acciones,
  )
}

/**
 * Arma el documento y lo manda a imprimir.
 *
 * Se imprime desde un IFRAME oculto, no desde `window.open`. Abrir una ventana
 * nueva desde un archivo `file://` lo bloquea el navegador la mitad de las
 * veces, y cuando lo bloquea no hay forma de distinguirlo de un error. El
 * iframe no pide permiso a nadie.
 */
async function construirDocumento(ids: string[], incluirRolDeVisita: boolean): Promise<string> {
  const notas = await Promise.all(ids.map(d.obtenerNota))
  const paginas = notas.flatMap((n) => {
    const imprimible = notaImprimibleDesdeFila(n)
    const conLogo = n.tipo_nota === 'factura'
    return [
      { nota: imprimible, opciones: { copia: 'original' as const, conLogo } },
      { nota: imprimible, opciones: { copia: 'duplicado' as const, conLogo: false } },
    ]
  })

  let rolDeVisita
  if (incluirRolDeVisita) {
    const jornada = await d.jornadaDeHoy(estado.perfil!.id)
    if (jornada && jornada.paradas.length) {
      /* eslint-disable @typescript-eslint/no-unnecessary-condition */
      rolDeVisita = {
        fecha: formatearFechaCorta(`${jornada.jornada.fecha}T12:00:00`),
        vendedor: estado.perfil!.nombre_completo ?? '',
        vendedor_numero: estado.perfil!.codigo_vendedor ?? '',
        paradas: jornada.paradas.map((p: Record<string, any>) => ({
          numero: p.orden,
          hora: p.llegada_en ? formatearHora(p.llegada_en) : '',
          cliente_numero: p.cliente?.codigo ?? '',
          razon_social: p.cliente?.razon_social ?? p.razon_social_snapshot ?? '',
          direccion: p.direccion?.direccion_formateada ?? p.direccion_snapshot ?? '',
          vendio: p.visita?.vendio ?? false,
          cobro: p.visita?.cobro ?? false,
          retiro_afilado: p.visita?.retiro_afilado ?? false,
          entrego: p.visita?.entrego ?? false,
          contacto: p.visita?.contacto_nombre ?? p.cliente?.contacto_nombre ?? '',
          resultado: p.visita
            ? p.visita.visitado
              ? p.visita.observacion
              : `NO VISITADO — ${p.visita.motivo_no_visita ? ETIQUETA_MOTIVO_NO_VISITA[p.visita.motivo_no_visita as keyof typeof ETIQUETA_MOTIVO_NO_VISITA] : 'Sin visitar'}. ${p.visita.observacion}`
            : '',
        })),
        visitadas: jornada.paradas.filter((p: Record<string, any>) => p.visita?.visitado === true).length,
        no_visitadas: jornada.paradas.filter((p: Record<string, any>) => p.visita?.visitado === false).length,
        observaciones_jornada: jornada.jornada.observaciones_jornada ?? '',
      }
      /* eslint-enable @typescript-eslint/no-unnecessary-condition */
    } else {
      alert('Hoy no armaste recorrido, así que salen sólo las notas.')
    }
  }

  return generarDocumentoImpresion(paginas, { rolDeVisita })
}

/** Un iframe fuera de pantalla, reutilizado entre impresiones. */
function marcoImpresion(): HTMLIFrameElement {
  let marco = document.getElementById('marco-impresion') as HTMLIFrameElement | null
  if (!marco) {
    marco = document.createElement('iframe')
    marco.id = 'marco-impresion'
    Object.assign(marco.style, {
      position: 'fixed',
      right: '0',
      bottom: '0',
      width: '0',
      height: '0',
      border: '0',
      visibility: 'hidden',
    })
    document.body.appendChild(marco)
  }
  return marco
}

async function imprimir(ids: string[], incluirRolDeVisita: boolean): Promise<void> {
  const html = await construirDocumento(ids, incluirRolDeVisita)
  const marco = marcoImpresion()
  const doc = marco.contentDocument
  if (!doc) throw new Error('El navegador no dejó preparar el documento de impresión.')

  doc.open()
  doc.write(html)
  doc.close()

  // Las hojas de estilo se aplican después del write: imprimir en el mismo tick
  // saca el talonario sin bordes ni grises.
  await new Promise((listo) => setTimeout(listo, 300))
  marco.contentWindow?.focus()
  marco.contentWindow?.print()
}

/**
 * "Guardar como PDF" del navegador es el propio diálogo de impresión, así que
 * el equivalente honesto acá es abrir el documento para verlo y decidir. La app
 * sí genera un PDF de verdad con expo-print.
 */
async function verDocumento(ids: string[], incluirRolDeVisita: boolean): Promise<void> {
  const html = await construirDocumento(ids, incluirRolDeVisita)
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.target = '_blank'
  a.rel = 'noopener'
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/**
 * Envuelve cualquier acción larga: sin esto, un `void accion()` que falla se
 * pierde en una promesa sin manejar y el botón simplemente no hace nada.
 */
function conAviso(accion: () => Promise<void>, donde: HTMLElement): () => void {
  return () => {
    vaciar(donde).appendChild(cargando('Preparando…'))
    accion()
      .then(() => vaciar(donde))
      .catch((e: Error) => {
        console.error('[probador]', e)
        vaciar(donde).appendChild(aviso('error', 'No se pudo', e.message || String(e)))
      })
  }
}

function pantallaDetalleNota(notaId: string): HTMLElement {
  const cont = h('div', {}, cargando('Buscando la nota…'))

  void d.obtenerNota(notaId).then((n) => {
    const items = (n.items ?? []).slice().sort((a: any, b: any) => a.orden - b.orden)
    vaciar(cont)
    cont.appendChild(
      h(
        'div',
        {},
        h(
          'div.fila',
          {},
          n.tipo_nota ? pastilla(ETIQUETA_TIPO_NOTA[n.tipo_nota as TipoNotaPedido], colores.azul) : null,
          pastilla(ETIQUETA_ESTADO_NOTA[n.estado as keyof typeof ETIQUETA_ESTADO_NOTA] ?? n.estado, colores.tintaSuave),
          ...(n.servicios ?? []).map((s: TipoServicio) => pastilla(ETIQUETA_TIPO_SERVICIO[s], colores.rojo)),
        ),
        h(
          'div.tarjeta',
          {},
          h('div.tarjeta-titulo', { texto: n.cliente_nombre }),
          n.cliente_codigo ? h('div.tarjeta-dato', { texto: `Cliente Nº ${n.cliente_codigo}` }) : null,
          n.cliente_cuit ? h('div.tarjeta-dato', { texto: `CUIT ${n.cliente_cuit}` }) : null,
          n.zona ? h('div.tarjeta-dato', { texto: `Zona ${n.zona}` }) : null,
        ),
        n.datos_cliente ? h('div.tarjeta', {}, h('div.tarjeta-dato', { texto: 'DATOS DEL CLIENTE' }), h('div', { texto: n.datos_cliente })) : null,
        ...items.map((i: Record<string, any>) =>
          h(
            'div.tarjeta',
            {},
            h('div.tarjeta-titulo', {
              texto: `${i.orden}. ${i.herramienta ? ETIQUETA_HERRAMIENTA[i.herramienta as Herramienta] : 'VENTA'}`,
            }),
            h('div.tarjeta-dato', {
              texto: `${ETIQUETA_TIPO_SERVICIO[i.servicio as TipoServicio]} · ${i.cantidad} un.`,
            }),
            i.descripcion ? h('div.tarjeta-dato', { texto: i.descripcion }) : null,
            h('div.fila', {}, ...(i.codigos_computo ?? []).map((c: string) => pastilla(c, colores.verdeOscuro))),
            i.precio_total ? h('div.tarjeta-dato', { texto: formatearPesos(Number(i.precio_total)) }) : null,
          ),
        ),
        n.total ? aviso('exito', 'TOTAL', formatearPesos(Number(n.total))) : null,
        (() => {
          const estadoAccion = h('div')
          return h(
            'div',
            {},
            botonMenu('IMPRIMIR', conAviso(() => imprimir([notaId], false), estadoAccion), {
              subtitulo: 'Original y duplicado',
            }),
            botonSecundario(
              'Ver el documento en otra pestaña',
              conAviso(() => verDocumento([notaId], false), estadoAccion),
            ),
            estadoAccion,
          )
        })(),
      ),
    )
  })

  return panel(barra(), titulo('DETALLE\nDE LA NOTA'), cont)
}

// ─────────────────────────────────────────────────────────────────────────────
// Generar nota
// ─────────────────────────────────────────────────────────────────────────────

interface BorradorNota {
  paso: 1 | 2
  encabezado: FormularioNotaEncabezado
  servicios: TipoServicio[]
  tipoNota: TipoNotaPedido | null
  fechaEntrega: string
  items: FormularioItemNota[]
  activo: number
  errores: Record<string, string | undefined>
  intentado: boolean
  cotizacion: { fecha: string; venta: number } | null
}

let borrador: BorradorNota = nuevoBorrador()

function nuevoBorrador(): BorradorNota {
  return {
    paso: 1,
    encabezado: { ...ENCABEZADO_VACIO },
    servicios: [],
    tipoNota: null,
    fechaEntrega: '',
    items: [{ ...ITEM_VACIO }],
    activo: 0,
    errores: {},
    intentado: false,
    cotizacion: null,
  }
}

function pantallaGenerarNota(): HTMLElement {
  if (!borrador.cotizacion) {
    void d.obtenerCotizacion().then((c) => {
      borrador.cotizacion = c
      refrescar()
    })
  }
  return borrador.paso === 1 ? pasoEncabezado() : pasoRenglones()
}

const SERVICIOS_BASE: TipoServicio[] = ['venta', 'afilado', 'reparacion', 'rectificado', 'hermanado']

function pasoEncabezado(): HTMLElement {
  const enc = borrador.encabezado
  const err = borrador.errores
  const sugerencias = h('div')

  let buscando: ReturnType<typeof setTimeout> | null = null
  function buscar(texto: string) {
    if (buscando) clearTimeout(buscando)
    if (texto.trim().length < 2) return vaciar(sugerencias)
    buscando = setTimeout(() => {
      void d.buscarClientes(texto).then((rs) => {
        vaciar(sugerencias)
        for (const c of rs) {
          sugerencias.appendChild(
            h(
              'div.tarjeta',
              { al: { click: () => elegirCliente(c) }, estilo: { cursor: 'pointer' } },
              h('div.fila', {}, h('strong', { texto: c.codigo }), c.provisorio ? pastilla('PROVISORIO', colores.ambarOscuro) : null),
              h('div', { texto: c.razon_social }),
              c.cuit ? h('div.tarjeta-dato', { texto: `CUIT ${c.cuit}` }) : null,
            ),
          )
        }
      })
    }, 300)
  }

  function elegirCliente(c: Record<string, any>) {
    Object.assign(enc, {
      cliente_id: c.cliente_id,
      cliente_codigo: c.codigo,
      cliente_nombre: c.razon_social,
      cliente_cuit: c.cuit ?? '',
      cliente_provisorio: c.provisorio,
      cliente_nuevo: false,
      datos_cliente: enc.datos_cliente.trim()
        ? enc.datos_cliente
        : [c.razon_social, c.direccion, c.telefono, c.email].filter(Boolean).join(' — '),
    })
    refrescar()
  }

  const conAfilado = borrador.servicios.includes('afilado')
  const disponibles: TipoServicio[] = conAfilado
    ? [...SERVICIOS_BASE, 'rebaje', 'reclamo']
    : [...SERVICIOS_BASE, 'reclamo']

  return panel(
    barra(),
    titulo('GENERAR NUEVA\nNOTA DE PEDIDO'),
    h(
      'div.fila',
      {},
      campo('COD. CLIENTE', {
        valor: enc.cliente_codigo,
        alCambiar: (v) => {
          enc.cliente_codigo = v
          enc.cliente_id = null
          buscar(v)
        },
      }),
      campo('NOMBRE', {
        valor: enc.cliente_nombre,
        error: err.cliente_nombre,
        alCambiar: (v) => {
          enc.cliente_nombre = v
          enc.cliente_id = null
          buscar(v)
        },
      }),
    ),
    campo('CUIT', {
      valor: enc.cliente_cuit,
      alCambiar: (v) => {
        enc.cliente_cuit = v
        enc.cliente_id = null
        buscar(v)
      },
    }),
    sugerencias,
    botonSecundario('¿Es nuevo cliente?', () => pantalla(pantallaNuevoCliente)),
    enc.cliente_provisorio
      ? aviso('atencion', 'Cliente provisorio', 'La nota se guarda igual y queda sin número hasta que Administración le asigne el código.')
      : null,
    err.cliente ? aviso('error', null, err.cliente) : null,
    campo('ZONA', { valor: enc.zona, error: err.zona, alCambiar: (v) => (enc.zona = v) }),
    campo('DATOS DEL CLIENTE', {
      valor: enc.datos_cliente,
      multilinea: true,
      error: err.datos_cliente,
      ayuda: 'En el teléfono este campo se dicta con el micrófono.',
      alCambiar: (v) => (enc.datos_cliente = v),
    }),
    campo('DESCRIPCIÓN GRAL. DE LA HERRAMIENTA', {
      valor: enc.descripcion_herramienta,
      multilinea: true,
      alCambiar: (v) => (enc.descripcion_herramienta = v),
    }),
    h('h3', { texto: 'TIPO DE SERVICIO', estilo: { textAlign: 'center', margin: '0' } }),
    ...disponibles.map((s) =>
      casilla(ETIQUETA_TIPO_SERVICIO[s], borrador.servicios.includes(s), (v) => {
        const nuevos = v ? [...borrador.servicios, s] : borrador.servicios.filter((x) => x !== s)
        borrador.servicios = nuevos.includes('afilado') ? nuevos : nuevos.filter((x) => x !== 'rebaje')
        const principal = borrador.servicios[0] ?? 'afilado'
        borrador.items = borrador.items.map((r) => {
          const servicio = borrador.servicios.includes(r.servicio) ? r.servicio : principal
          const herramienta =
            r.herramienta && HERRAMIENTAS_POR_SERVICIO[servicio].includes(r.herramienta) ? r.herramienta : null
          return { ...r, servicio, herramienta, codigos_computo: [] }
        })
        refrescar()
      }),
    ),
    err.servicios ? aviso('error', null, err.servicios) : null,
    desplegable('TIPO DE NOTA DE PEDIDO', {
      valor: borrador.tipoNota,
      items: [
        { valor: 'factura' as TipoNotaPedido, etiqueta: `${ETIQUETA_TIPO_NOTA.factura} · con logo` },
        { valor: 'presupuesto' as TipoNotaPedido, etiqueta: `${ETIQUETA_TIPO_NOTA.presupuesto} · sin logo` },
      ],
      alCambiar: (v) => (borrador.tipoNota = v),
    }),
    campo('FECHA DE ENTREGA', {
      tipo: 'date',
      valor: borrador.fechaEntrega,
      error: err.fecha_entrega,
      alCambiar: (v) => (borrador.fechaEntrega = v),
    }),
    botonMenu('CONTINUAR', () => {
      borrador.intentado = true
      const { valido, errores } = validarEncabezadoNota(borrador.encabezado, {
        servicios: borrador.servicios,
        tipoNota: borrador.tipoNota,
        fechaEntrega: borrador.fechaEntrega || null,
      })
      borrador.errores = errores as Record<string, string | undefined>
      if (!valido) return refrescar()
      borrador.paso = 2
      borrador.intentado = false
      borrador.errores = {}
      refrescar()
    }),
  )
}

const ETIQUETAS_CAMPO: Record<CampoItem, string> = {
  cantidad: 'CANTIDAD',
  diametro_exterior: 'DIÁMETRO EXTERIOR',
  diametro: 'DIÁMETRO',
  ancho_corte: 'ANCHO DE CORTE',
  largo: 'LARGO',
  ancho: 'ANCHO',
  largo_util: 'LARGO ÚTIL',
  espesor: 'ESPESOR',
  paso: 'PASO',
  descripcion: 'DESCRIPCIÓN',
  cantidad_dientes: 'CANTIDAD DE DIENTES',
  tipo_mecha: 'TIPO DE MECHA',
  mano: '¿ES DERECHA O IZQUIERDA?',
  dientes_rotos: '¿TIENE DIENTES ROTOS?',
  afilado_reparacion: '¿AFILADO / REPARACIÓN?',
  codigos_computo: 'CÓDIGO/S DE CÓMPUTO',
  precio_por_diente: 'PRECIO POR DIENTE',
  precio_total: 'PRECIO TOTAL',
}

function pasoRenglones(): HTMLElement {
  const item = borrador.items[borrador.activo]
  const err = borrador.errores
  const herramientas = HERRAMIENTAS_POR_SERVICIO[item.servicio]
  const campos = item.herramienta ? CAMPOS_POR_HERRAMIENTA[item.herramienta] : []

  const bloqueCodigos = h('div')

  // Mismo automatismo que la app: apenas hay medida se busca el código.
  void d.resolverCodigoDeItem(item).then((codigos) => {
    vaciar(bloqueCodigos)
    if (!codigos) return
    if (!codigos.length) {
      bloqueCodigos.appendChild(aviso('atencion', null, 'No hay ningún código que cubra esa medida.'))
      return
    }
    for (const c of codigos) {
      const elegido = item.codigos_computo.includes(c.codigo)
      bloqueCodigos.appendChild(
        h(
          'div.tarjeta',
          {
            clase: elegido ? 'elegida' : '',
            estilo: { cursor: 'pointer' },
            al: {
              click: () => {
                item.codigos_computo = elegido
                  ? item.codigos_computo.filter((x) => x !== c.codigo)
                  : [...item.codigos_computo, c.codigo]
                if (!elegido && c.precio_pesos !== null) item.precio_por_diente = String(c.precio_pesos)
                recalcular(item)
                refrescar()
              },
            },
          },
          h(
            'div.fila',
            {},
            h('strong', { texto: c.codigo }),
            h('span', {
              texto: c.precio_pesos !== null ? formatearPesos(Number(c.precio_pesos)) : '—',
              estilo: { marginLeft: 'auto', color: colores.verdeOscuro, fontWeight: '600' },
            }),
          ),
          h('div.tarjeta-dato', { texto: c.descripcion }),
          c.moneda === 'USD'
            ? h('div.tarjeta-dato', { texto: `Lista en US$ ${Number(c.precio).toFixed(2)} · convertido al cambio de hoy` })
            : null,
        ),
      )
    }
  })

  return panel(
    barra(),
    titulo('GENERAR NUEVA\nNOTA DE PEDIDO'),
    h(
      'div.tarjeta',
      {},
      h('div.tarjeta-titulo', {
        texto: `${borrador.encabezado.cliente_codigo ? `${borrador.encabezado.cliente_codigo} · ` : ''}${borrador.encabezado.cliente_nombre}`,
      }),
      h('div.fila', {}, ...borrador.servicios.map((s) => pastilla(ETIQUETA_TIPO_SERVICIO[s], colores.rojo))),
    ),

    borrador.items.length > 1
      ? h(
          'div',
          {},
          h('div.tarjeta-dato', { texto: `RENGLONES DE LA NOTA · ${borrador.items.length}` }),
          ...borrador.items.map((r, i) =>
            h(
              'div.tarjeta',
              { clase: i === borrador.activo ? 'elegida' : '' },
              h(
                'div.fila',
                {},
                h('strong', { texto: String(i + 1) }),
                h('span', { texto: resumenRenglon(r), estilo: { flex: '1' } }),
                !validarItemNota(r).valido ? pastilla('FALTAN DATOS', colores.rojoAccion) : null,
              ),
              h(
                'div.fila',
                {},
                botonSecundario('Editar', () => {
                  borrador.activo = i
                  borrador.errores = {}
                  refrescar()
                }),
                borrador.items.length > 1
                  ? botonSecundario('Quitar', () => {
                      borrador.items = borrador.items.filter((_, k) => k !== i)
                      borrador.activo = Math.min(borrador.activo, borrador.items.length - 1)
                      refrescar()
                    })
                  : null,
              ),
            ),
          ),
        )
      : null,

    borrador.servicios.length > 1
      ? desplegable('SERVICIO DE ESTE RENGLÓN', {
          valor: item.servicio,
          items: borrador.servicios.map((s) => ({ valor: s, etiqueta: ETIQUETA_TIPO_SERVICIO[s] })),
          alCambiar: (s) => {
            item.servicio = s
            if (!HERRAMIENTAS_POR_SERVICIO[s].includes(item.herramienta as Herramienta)) item.herramienta = null
            item.codigos_computo = []
            refrescar()
          },
        })
      : null,

    herramientas.length > 1
      ? desplegable('HERRAMIENTA', {
          valor: item.herramienta,
          items: herramientas.map((x) => ({ valor: x, etiqueta: ETIQUETA_HERRAMIENTA[x] })),
          alCambiar: (v) => {
            item.herramienta = v
            item.codigos_computo = []
            refrescar()
          },
        })
      : herramientas.length === 1
        ? (() => {
            if (item.herramienta !== herramientas[0]) item.herramienta = herramientas[0]
            return h('div.tarjeta', {}, h('div.tarjeta-dato', { texto: 'HERRAMIENTA' }), h('strong', { texto: ETIQUETA_HERRAMIENTA[herramientas[0]] }))
          })()
        : null,

    item.herramienta === 'mecha'
      ? desplegable('TIPO DE MECHA', {
          valor: item.tipo_mecha,
          items: (Object.keys(ETIQUETA_TIPO_MECHA) as TipoMecha[]).map((t) => ({ valor: t, etiqueta: ETIQUETA_TIPO_MECHA[t] })),
          alCambiar: (t) => {
            item.tipo_mecha = t
            item.mano = null
            refrescar()
          },
        })
      : null,

    ...campos.map((c) => dibujarCampo(item, c, err, bloqueCodigos)),

    borrador.cotizacion
      ? aviso('info', 'TIPO DE CAMBIO', `${formatearPesos(borrador.cotizacion.venta)} · dólar oficial del ${formatearFechaCorta(borrador.cotizacion.fecha)}`)
      : aviso('atencion', 'TIPO DE CAMBIO', 'Buscando la cotización…'),

    item.servicio !== 'venta' && item.herramienta
      ? botonSecundario(`⊕  ${SUMAR_OTRA[item.herramienta]}`, () => sumarRenglon(item.herramienta))
      : null,
    botonSecundario('⊕  AGREGAR OTRA HERRAMIENTA', () => sumarRenglon(null)),

    totalDeRenglones(borrador.items) > 0
      ? aviso('exito', `Total de la nota · ${borrador.items.length} renglón${borrador.items.length === 1 ? '' : 'es'}`, formatearPesos(totalDeRenglones(borrador.items)))
      : null,

    borrador.intentado && Object.keys(err).length
      ? aviso('error', 'Faltan datos', 'Revisá los campos marcados antes de crear la nota.')
      : null,

    botonMenu('CREAR NOTA\nDE PEDIDO', () => void crear()),
  )
}

function sumarRenglon(herramienta: Herramienta | null): void {
  borrador.intentado = true
  const { valido, errores } = validarItemNota(borrador.items[borrador.activo])
  borrador.errores = errores as Record<string, string | undefined>
  if (!valido) return refrescar()

  borrador.items = [...borrador.items, renglonNuevo(borrador.items[borrador.activo].servicio, herramienta)]
  borrador.activo = borrador.items.length - 1
  borrador.intentado = false
  borrador.errores = {}
  refrescar()
}

function recalcular(item: FormularioItemNota): void {
  const campos = item.herramienta ? CAMPOS_POR_HERRAMIENTA[item.herramienta] : []
  if (!campos.includes('precio_por_diente') || !campos.includes('cantidad_dientes')) return
  const total = aNumero(item.precio_por_diente) * aNumero(item.cantidad_dientes)
  if (total > 0) item.precio_total = String(Math.round(total * 100) / 100)
}

function dibujarCampo(
  item: FormularioItemNota,
  c: CampoItem,
  err: Record<string, string | undefined>,
  bloqueCodigos: HTMLElement,
): HTMLElement | null {
  if (c === 'tipo_mecha') return null

  if (c === 'codigos_computo') {
    return h(
      'div',
      {},
      h('span.campo-etiqueta', { texto: 'CÓDIGO/S DE CÓMPUTO' }),
      h('div.fila', {}, ...item.codigos_computo.map((x) => pastilla(x, colores.verdeOscuro))),
      bloqueCodigos,
      err.codigos_computo ? h('span.campo-error-texto', { texto: err.codigos_computo }) : null,
    )
  }

  if (c === 'mano') {
    if (!item.tipo_mecha || !MECHAS_CON_MANO.includes(item.tipo_mecha)) return null
    return desplegable('¿ES DERECHA O IZQUIERDA?', {
      valor: item.mano,
      items: [
        { valor: 'derecha' as ManoMecha, etiqueta: 'DERECHA' },
        { valor: 'izquierda' as ManoMecha, etiqueta: 'IZQUIERDA' },
      ],
      alCambiar: (v) => {
        item.mano = v
        refrescar()
      },
    })
  }

  if (c === 'dientes_rotos' || c === 'afilado_reparacion') {
    return casilla(ETIQUETAS_CAMPO[c], item[c], (v) => {
      ;(item as Record<string, any>)[c] = v
      refrescar()
    })
  }

  if (c === 'descripcion') {
    return campo('DESCRIPCIÓN', {
      valor: item.descripcion,
      multilinea: true,
      error: err.descripcion,
      alCambiar: (v) => (item.descripcion = v),
    })
  }

  const etiqueta =
    c === 'cantidad'
      ? `CANTIDAD DE ${item.herramienta ? SINGULAR_HERRAMIENTA[item.herramienta] : 'HERRAMIENTAS'}`
      : ETIQUETAS_CAMPO[c]

  return campo(etiqueta, {
    valor: (item as unknown as Record<string, string>)[c] ?? '',
    error: err[c],
    ayuda:
      (c === 'precio_por_diente' || c === 'precio_total') &&
      aNumero((item as unknown as Record<string, string>)[c] ?? '') > 0
        ? formatearPesos(aNumero((item as unknown as Record<string, string>)[c] ?? ''))
        : undefined,
    alCambiar: (v) => {
      ;(item as unknown as Record<string, string>)[c] = soloNumeros(v)
      recalcular(item)
      // Cambiar la medida vuelve a disparar la búsqueda del código.
      if (c === 'ancho_corte' || c === 'ancho' || c === 'diametro') refrescar()
    },
  })
}

async function crear(): Promise<void> {
  borrador.intentado = true
  const { valido, indice, errores } = validarRenglones(borrador.items)
  borrador.errores = errores as Record<string, string | undefined>
  if (!valido) {
    borrador.activo = indice
    return refrescar()
  }
  if (!borrador.cotizacion) return alert('Todavía no tenemos la cotización del dólar')

  try {
    const nota = await d.crearNotaPedido({
      encabezado: borrador.encabezado,
      servicios: borrador.servicios,
      tipoNota: borrador.tipoNota!,
      fechaEntrega: borrador.fechaEntrega,
      items: borrador.items,
      tipoCambio: borrador.cotizacion.venta,
      cotizacionFecha: borrador.cotizacion.fecha,
    })
    alert(
      nota.numero === null
        ? 'Nota guardada, sin número todavía. El cliente es nuevo y queda esperando el código de Administración.'
        : `Nota de pedido creada: Nº ${String(nota.numero).padStart(6, '0')}`,
    )
    borrador = nuevoBorrador()
    pila.length = 0
    pantalla(pantallaNotasPedido, { apilar: false })
  } catch (e) {
    alert(`No pudimos crear la nota: ${(e as Error).message}`)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Cliente nuevo
// ─────────────────────────────────────────────────────────────────────────────

function pantallaNuevoCliente(): HTMLElement {
  const form = {
    razon_social: borrador.encabezado.cliente_nombre,
    documento: borrador.encabezado.cliente_cuit,
    direccion: '',
    codigo_postal: '',
    telefonos: '',
    email: '',
    nombre_fantasia: '',
  }

  return panel(
    barra(),
    titulo('GENERAR\nNUEVO CLIENTE'),
    aviso('info', 'Sin autocompletado de Google', 'En el teléfono la dirección se elige de las sugerencias de Google y trae el CP y las coordenadas. Acá se escribe a mano, así que el cliente queda sin coordenadas y no se lo puede meter en un recorrido.'),
    campo('NOMBRE Y APELLIDO O RAZÓN SOCIAL', { valor: form.razon_social, alCambiar: (v) => (form.razon_social = v) }),
    campo('DNI O CUIT', { valor: form.documento, alCambiar: (v) => (form.documento = v) }),
    campo('DIRECCIÓN DEL TALLER', { alCambiar: (v) => (form.direccion = v) }),
    campo('CÓDIGO POSTAL', { alCambiar: (v) => (form.codigo_postal = v) }),
    campo('TELÉFONOS', { alCambiar: (v) => (form.telefonos = v) }),
    campo('CORREO', { tipo: 'email', alCambiar: (v) => (form.email = v) }),
    campo('NOMBRE DE FANTASÍA', { alCambiar: (v) => (form.nombre_fantasia = v) }),
    botonMenu('CREAR CLIENTE', () => {
      void d
        .crearClienteProvisorio(form)
        .then((c) => {
          Object.assign(borrador.encabezado, {
            cliente_id: c.id,
            cliente_nombre: c.razon_social,
            cliente_cuit: c.cuit ?? '',
            cliente_codigo: '',
            cliente_nuevo: false,
            cliente_provisorio: true,
          })
          alert(`Cliente creado con código provisorio ${c.codigo}.`)
          volver()
        })
        .catch((e: Error) => alert(`No pudimos crear el cliente: ${e.message}`))
    }),
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Arranque
// ─────────────────────────────────────────────────────────────────────────────

export async function arrancar(): Promise<void> {
  dibujar(() => panel(cargando('Conectando…')))
  await evaluarAcceso()
  enrutarPorAcceso()
}

export type { ESTILOS }
