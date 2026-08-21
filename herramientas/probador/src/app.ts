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
  agruparParaNotas,
  agujeroDelRenglon,
  aNumero,
  CAMPOS_POR_HERRAMIENTA,
  caracteristicasDeArticulo,
  colores,
  DESCRIPCION_GRUPO_NOTA,
  describirRango,
  descripcionSugerida,
  esDescripcionSugerida,
  numeroDeVendedorImpreso,
  VENDEDORES_CON_CERO,
  DIAS_CHEQUE_MAXIMO,
  etiquetaZona,
  ETIQUETA_CONDICION_VENTA,
  formatearMedida,
  formatearMoneda,
  resumenCaracteristicas,
  normalizarMedida,
  ENCABEZADO_VACIO,
  ETIQUETA_ESTADO_NOTA,
  ETIQUETA_GRUPO_NOTA,
  ETIQUETA_HERRAMIENTA,
  ETIQUETA_MOTIVO_NO_VISITA,
  ETIQUETA_ORIGEN_FRESA,
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
  lineasDelRenglon,
  MECHAS_CON_MANO,
  notaImprimibleDesdeFila,
  renglonNuevo,
  resumenRenglon,
  SINGULAR_HERRAMIENTA,
  soloNumeros,
  SUMAR_OTRA,
  totalDeRenglones,
  totalDelRenglon,
  totalDelRenglonEnPesos,
  validarEncabezadoNota,
  validarItemNota,
  validarRenglones,
  zonaParaUbicacion,
  ZONAS,
  type CampoItem,
  type CondicionVenta,
  type FormularioItemNota,
  type FormularioNotaEncabezado,
  type Herramienta,
  type ManoMecha,
  type OrigenFresa,
  type TipoMecha,
  type TipoNotaPedido,
  type TipoServicio,
  type ZonaSugerida,
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

    const email = await d.resolverEmailDeIngreso(usuario)
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
    campo('USUARIO O EMAIL', {
      valor: usuario,
      marcador: 'asosa',
      ayuda: `Con cualquiera de los dos entrás. Un nombre suelto lo traduce la base, y si no lo encuentra se completa con @${d.DOMINIO_USUARIO}.`,
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
        // Mirar antes de imprimir: va arriba porque es el orden en que
        // conviene hacerlo.
        botonSecundario('👁  Ver antes de imprimir', () =>
          pantalla(() => pantallaVistaPrevia(ids, conRol)),
        ),
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
      // El logo va en las dos copias de una factura, como el talonario.
      { nota: imprimible, opciones: { copia: 'original' as const, conLogo } },
      { nota: imprimible, opciones: { copia: 'duplicado' as const, conLogo } },
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
 * Vista previa: la hoja como va a salir, antes de mandarla a la impresora.
 *
 * Acá se muestra el HTML de verdad dentro de un iframe —no una maqueta— porque
 * en una pantalla de PC la hoja A4 entra y se lee. Es el mismo documento que se
 * imprime: si acá está bien, en papel está bien.
 *
 * La app móvil hace lo mismo pero con los datos apilados: una A4 encogida a un
 * teléfono no se lee, así que allá se muestran los mismos números en el orden
 * del talonario.
 */
function pantallaVistaPrevia(ids: string[], conRol: boolean): HTMLElement {
  const marco = h('iframe', {
    attr: { title: 'Vista previa de la nota de pedido' },
    estilo: {
      width: '820px',
      height: '1160px',
      border: '0',
      background: '#fff',
      // La hoja entra en el ancho del panel achicándola; se puede leer igual
      // y, sobre todo, se puede comparar contra el papel.
      transform: 'scale(0.44)',
      transformOrigin: 'top left',
    },
  }) as HTMLIFrameElement

  // El contenedor compensa el alto que la escala le saca al iframe: sin esto
  // queda un agujero blanco de media pantalla debajo de la hoja.
  const caja = h(
    'div',
    { estilo: { width: '100%', height: '510px', overflow: 'hidden' } },
    marco,
  )

  const estadoAccion = h('div')
  const cont = h('div', {}, cargando('Armando la hoja…'))

  void construirDocumento(ids, conRol)
    .then((html) => {
      vaciar(cont).appendChild(caja)
      const doc = marco.contentDocument
      if (!doc) throw new Error('El navegador no dejó preparar la vista previa.')
      doc.open()
      doc.write(html)
      doc.close()
    })
    .catch((e: Error) => {
      vaciar(cont).appendChild(aviso('error', 'No pudimos armar la vista previa', e.message))
    })

  return panel(
    barra(),
    titulo('VISTA PREVIA\nANTES DE IMPRIMIR'),
    aviso(
      'info',
      'Qué estás viendo',
      'La hoja tal cual sale: original y duplicado de cada nota. Revisá los códigos de cómputo, las cantidades y los precios. Si algo está mal, volvé y corregí antes de imprimir.',
    ),
    cont,
    botonMenu('IMPRIMIR', conAviso(() => imprimir(ids, conRol), estadoAccion), {
      subtitulo: `${ids.length} nota${ids.length === 1 ? '' : 's'} · abre el diálogo del navegador`,
    }),
    botonSecundario(
      'Abrirla en otra pestaña, a tamaño real',
      conAviso(() => verDocumento(ids, conRol), estadoAccion),
    ),
    estadoAccion,
  )
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
            botonSecundario('👁  Ver antes de imprimir', () =>
              pantalla(() => pantallaVistaPrevia([notaId], false)),
            ),
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
  /** Renglones de la columna "Observaciones" del talonario. */
  observaciones: string[]
  /** Lo que se está escribiendo antes de tocar "Agregar renglón". */
  observacionNueva: string
  /** Cómo se cobra, más los días del cheque o el texto de "Otro". */
  condicionVenta: CondicionVenta | null
  condicionDetalle: string
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
    observaciones: [],
    observacionNueva: '',
    condicionVenta: null,
    condicionDetalle: '',
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

/**
 * Cómo quedó la última búsqueda de zona. Vive fuera del borrador porque no es
 * un dato de la nota: es la explicación de dónde salió el número, y las
 * opciones cuando la localidad cae en más de una zona.
 */
let zonaSugerida: ZonaSugerida | null = null
let zonaCandidatas: ZonaSugerida[] = []

/**
 * El número de vendedor cuando no lo completan y el que carga no tiene uno.
 *
 * El primer intento —el número propio— ya lo hizo el borrador al abrirse. Éste
 * es el segundo: el vendedor a cargo de la zona. Si la zona la cubre más de
 * uno, la base devuelve null y el campo queda vacío a propósito.
 */
function completarVendedorPorZona(
  enc: { zona: string; vendedor_numero: string },
  refrescar: () => void,
): void {
  if (enc.vendedor_numero.trim() || !enc.zona.trim()) return
  void d
    .vendedorDeZona(enc.zona)
    .then((codigo) => {
      if (!codigo || enc.vendedor_numero.trim()) return
      enc.vendedor_numero = codigo
      refrescar()
    })
    .catch(() => undefined)
}

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

    // La zona sale de dónde está el cliente. Si la localidad cae en más de una
    // —"Victoria" es Entre Ríos en la 136 y en la 143— se muestran las dos y
    // elige el vendedor.
    const { unica, candidatas } = zonaParaUbicacion({
      localidad: c.localidad,
      provincia: c.provincia,
      direccion: c.direccion,
    })
    zonaSugerida = unica
    zonaCandidatas = candidatas.length > 1 ? candidatas : []
    if (unica) {
      enc.zona = unica.zona.codigo
      enc.zona_id = unica.zona.id
      completarVendedorPorZona(enc, refrescar)
    }

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
    // La zona dejó de ser texto libre: es el número que usa la oficina para
    // repartir el trabajo, y "Oeste", "oeste" y "Z. Oeste" escritos a mano son
    // tres zonas distintas para cualquier planilla.
    desplegable('ZONA', {
      valor: enc.zona_id || null,
      items: ZONAS.map((z) => ({ valor: z.id, etiqueta: etiquetaZona(z) })),
      alCambiar: (id) => {
        const zona = ZONAS.find((z) => z.id === id)
        if (!zona) return
        enc.zona = zona.codigo
        enc.zona_id = zona.id
        zonaSugerida = null
        zonaCandidatas = []
        completarVendedorPorZona(enc, refrescar)
        refrescar()
      },
    }),
    err.zona ? h('span.campo-error-texto', { texto: err.zona }) : null,
    zonaSugerida
      ? aviso(
          'exito',
          null,
          `Zona asignada sola por ${zonaSugerida.localidad}. Cambiala si no corresponde.`,
        )
      : null,
    zonaCandidatas.length > 1
      ? h(
          'div.tarjeta',
          {},
          h('div.tarjeta-dato', { texto: 'Esa localidad está en más de una zona. Elegí cuál:' }),
          ...zonaCandidatas.map((c) =>
            botonSecundario(`${etiquetaZona(c.zona)} — coincide por ${c.localidad}`, () => {
              enc.zona = c.zona.codigo
              enc.zona_id = c.zona.id
              zonaSugerida = null
              zonaCandidatas = []
              completarVendedorPorZona(enc, refrescar)
              refrescar()
            }),
          ),
        )
      : null,
    // Sale del perfil pero se puede corregir: hay altas sin código cargado y
    // el comprobante lo necesita igual. Se imprime sin los ceros de relleno.
    campo('VENDEDOR Nº', {
      valor: enc.vendedor_numero,
      marcador: '7',
      ayuda: enc.vendedor_numero
        ? `En la nota sale: ${numeroDeVendedorImpreso(enc.vendedor_numero, VENDEDORES_CON_CERO)}`
        : 'Si lo dejás vacío se completa solo: primero con tu número, y si no tenés, con el del vendedor a cargo de la zona.',
      alCambiar: (v) => (enc.vendedor_numero = v.replace(/\D/g, '').slice(0, 4)),
    }),
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
    // Dos columnas: son siete casillas de una palabra y en una sola columna
    // ocupaban una pantalla entera de scroll para nada.
    h('div.servicios', {}, ...disponibles.map((s) =>
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
    )),
    err.servicios ? aviso('error', null, err.servicios) : null,
    desplegable('TIPO DE NOTA DE PEDIDO', {
      valor: borrador.tipoNota,
      items: [
        { valor: 'factura' as TipoNotaPedido, etiqueta: `${ETIQUETA_TIPO_NOTA.factura} · con logo` },
        { valor: 'presupuesto' as TipoNotaPedido, etiqueta: `${ETIQUETA_TIPO_NOTA.presupuesto} · sin logo` },
      ],
      alCambiar: (v) => (borrador.tipoNota = v),
    }),
    // Cómo se cobra: va a la columna del talonario que salía siempre vacía.
    desplegable('CONDICIÓN DE VENTA', {
      valor: borrador.condicionVenta,
      items: (Object.keys(ETIQUETA_CONDICION_VENTA) as CondicionVenta[]).map((c) => ({
        valor: c,
        etiqueta: ETIQUETA_CONDICION_VENTA[c],
      })),
      alCambiar: (c) => {
        borrador.condicionVenta = c
        // El detalle era de la opción anterior: no se arrastra.
        borrador.condicionDetalle = ''
        refrescar()
      },
    }),
    err.condicion_venta ? h('span.campo-error-texto', { texto: err.condicion_venta }) : null,

    borrador.condicionVenta === 'cheque'
      ? campo('¿A CUÁNTOS DÍAS?', {
          valor: borrador.condicionDetalle,
          marcador: '30',
          ayuda: `De 0 a ${DIAS_CHEQUE_MAXIMO} días.`,
          error: err.condicion_venta_detalle,
          // Sólo números: es una cantidad de días, no un texto.
          alCambiar: (v) => (borrador.condicionDetalle = v.replace(/\D/g, '').slice(0, 2)),
        })
      : null,

    borrador.condicionVenta === 'otro'
      ? campo('¿CUÁL ES LA CONDICIÓN?', {
          valor: borrador.condicionDetalle,
          marcador: 'Ej. Retira y paga en fábrica',
          error: err.condicion_venta_detalle,
          alCambiar: (v) => (borrador.condicionDetalle = v),
        })
      : null,

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
        condicionVenta: borrador.condicionVenta,
        condicionVentaDetalle: borrador.condicionDetalle,
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

/** Los campos que son una medida en milímetros, no una cantidad ni un precio. */
const MEDIDAS = new Set<CampoItem>([
  'diametro_exterior', 'diametro', 'ancho_corte', 'largo', 'ancho',
  'largo_util', 'espesor', 'paso',
])

const ETIQUETAS_CAMPO: Record<CampoItem, string> = {
  cantidad: 'CANTIDAD',
  diametro_exterior: 'DIÁMETRO EXTERIOR',
  diametro_interior: 'DIÁMETRO INTERIOR (OPCIONAL)',
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
  dientes_rotos_cantidad: '¿CUÁNTOS DIENTES ROTOS?',
  reparar_dientes: '¿DESEA REPARAR LOS DIENTES?',
  rascadores: '¿CUÁNTOS RASCADORES?',
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

  // Los inputs del renglón anterior ya no existen: sus referencias tampoco.
  for (const clave of Object.keys(refsCampos)) delete refsCampos[clave]

  const bloqueCodigos = h('div')
  nodoCodigos = bloqueCodigos
  codigoPropuesto = null
  pedirCodigos(item, 0)

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
            // Venta o servicio cambia la descripción: "S.C." vs "SC nueva".
            if (esDescripcionSugerida(item.descripcion)) {
              item.descripcion = descripcionSugerida(item.herramienta, s)
            }
            refrescar()
          },
        })
      : null,

    herramientas.length > 1
      ? desplegable(item.servicio === 'venta' ? 'QUÉ SE VENDE' : 'HERRAMIENTA', {
          valor: item.herramienta,
          items: herramientas.map((x) => ({ valor: x, etiqueta: ETIQUETA_HERRAMIENTA[x] })),
          alCambiar: (v) => {
            item.herramienta = v
            item.codigos_computo = []
            item.origen_fresa = null
            // La descripción se completa sola; lo que escribió el vendedor no
            // se pisa nunca.
            if (esDescripcionSugerida(item.descripcion)) {
              item.descripcion = descripcionSugerida(v, item.servicio)
            }
            refrescar()
          },
        })
      : herramientas.length === 1
        ? (() => {
            if (item.herramienta !== herramientas[0]) item.herramienta = herramientas[0]
            return h('div.tarjeta', {}, h('div.tarjeta-dato', { texto: 'HERRAMIENTA' }), h('strong', { texto: ETIQUETA_HERRAMIENTA[herramientas[0]] }))
          })()
        : null,

    // El origen de la fresa decide en qué nota cae: nacional lleva una nota
    // aparte y en pesos, importada va con el resto de la venta en dólares.
    item.servicio === 'venta' && item.herramienta === 'fresa'
      ? desplegable('ORIGEN DE LA FRESA', {
          valor: item.origen_fresa,
          items: [
            { valor: 'nacional' as OrigenFresa, etiqueta: `${ETIQUETA_ORIGEN_FRESA.nacional} · nota aparte, en pesos` },
            { valor: 'importada' as OrigenFresa, etiqueta: `${ETIQUETA_ORIGEN_FRESA.importada} · con el resto, en dólares` },
          ],
          alCambiar: (v) => {
            item.origen_fresa = v
            refrescar()
          },
        })
      : null,

    item.servicio !== 'venta' && item.herramienta === 'mecha'
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

    // La venta no pide medidas: el código del artículo ya la identifica. Lo
    // que sí pide es qué es, porque de eso depende en qué nota cae.
    ...(item.servicio === 'venta'
      ? camposVenta(item, err)
      : campos.map((c) => dibujarCampo(item, c, err, bloqueCodigos))),

    // Cómo se reparte todo esto en comprobantes. Se muestra antes de crear
    // para que no sea una sorpresa al final.
    (() => {
      const grupos = agruparParaNotas(borrador.items, borrador.cotizacion?.venta ?? 0)
      if (grupos.length < 2) return null
      return h(
        'div.tarjeta',
        {},
        h('div.tarjeta-dato', { texto: `ESTO SALE EN ${grupos.length} NOTAS DE PEDIDO` }),
        ...grupos.map((g) =>
          h(
            'div',
            {},
            h(
              'div.fila',
              {},
              h('strong', { texto: ETIQUETA_GRUPO_NOTA[g.grupo] }),
              h('span', {
                texto: formatearPesos(g.total),
                estilo: { marginLeft: 'auto', color: colores.verdeOscuro, fontWeight: '600' },
              }),
            ),
            h('div.tarjeta-dato', {
              texto: `${g.items.length} ${g.items.length === 1 ? 'renglón' : 'renglones'} · ${DESCRIPCION_GRUPO_NOTA[g.grupo]}`,
            }),
          ),
        ),
      )
    })(),

    borrador.cotizacion
      ? aviso('info', 'TIPO DE CAMBIO', `${formatearPesos(borrador.cotizacion.venta)} · dólar oficial del ${formatearFechaCorta(borrador.cotizacion.fecha)}`)
      : aviso('atencion', 'TIPO DE CAMBIO', 'Buscando la cotización…'),

    item.servicio !== 'venta' && item.herramienta
      ? botonSecundario(`⊕  ${SUMAR_OTRA[item.herramienta]}`, () => sumarRenglon(item.herramienta))
      : null,
    botonSecundario('⊕  AGREGAR OTRA HERRAMIENTA', () => sumarRenglon(null)),

    // Los botones de arriba siguen el servicio del renglón abierto: estando en
    // una venta, todos agregaban otra venta y no había forma visible de sumar
    // el afilado que el cliente trajo en la misma visita. Había que agregar un
    // renglón y cambiarle el servicio con el desplegable de arriba, que nadie
    // encontró. Éstos hacen las dos cosas de una.
    ...borrador.servicios
      .filter((s) => s !== item.servicio)
      .map((s) =>
        botonSecundario(`⊕  AGREGAR RENGLÓN DE ${ETIQUETA_TIPO_SERVICIO[s]}`, () =>
          sumarRenglon(null, s),
        ),
      ),

    bloqueObservaciones(),

    // El total se repinta solo al cambiar cantidad, dientes o precio: se guarda
    // el nodo para poder tocarlo sin volver a dibujar el formulario.
    (() => {
      nodoTotal = h('div')
      pintarTotalDeLaNota()
      return nodoTotal
    })(),

    borrador.intentado && Object.keys(err).length
      ? aviso('error', 'Faltan datos', 'Revisá los campos marcados antes de crear la nota.')
      : null,

    botonMenu('CREAR NOTA\nDE PEDIDO', () => void crear()),
  )
}

function sumarRenglon(
  herramienta: Herramienta | null,
  servicio: TipoServicio = borrador.items[borrador.activo].servicio,
): void {
  borrador.intentado = true
  const { valido, errores } = validarItemNota(borrador.items[borrador.activo])
  borrador.errores = errores as Record<string, string | undefined>
  if (!valido) return refrescar()

  borrador.items = [...borrador.items, renglonNuevo(servicio, herramienta)]
  borrador.activo = borrador.items.length - 1
  borrador.intentado = false
  borrador.errores = {}
  refrescar()
}

/**
 * Las observaciones de la nota, que van a la columna "Observaciones" del
 * talonario. Se cargan de a una porque el papel las reparte por renglón.
 */
function bloqueObservaciones(): HTMLElement {
  function agregar(): void {
    const texto = borrador.observacionNueva.trim()
    if (!texto) return
    borrador.observaciones = [...borrador.observaciones, texto]
    borrador.observacionNueva = ''
    refrescar()
  }

  return h(
    'div.tarjeta',
    {},
    h('div.tarjeta-dato', { texto: 'OBSERVACIONES' }),
    ...borrador.observaciones.map((o, i) =>
      h(
        'div.fila',
        {},
        h('strong', { texto: String(i + 1) }),
        h('span', { texto: o, estilo: { flex: '1' } }),
        botonSecundario('✕', () => {
          borrador.observaciones = borrador.observaciones.filter((_, k) => k !== i)
          refrescar()
        }),
      ),
    ),
    campo('', {
      valor: borrador.observacionNueva,
      marcador: 'Ej. Retira el jueves a la mañana',
      multilinea: true,
      alCambiar: (v) => (borrador.observacionNueva = v),
    }),
    botonSecundario('⊕  AGREGAR RENGLÓN', agregar),
  )
}

/**
 * Referencias a los inputs del renglón que se está editando.
 *
 * Existen para poder tocar un campo sin repintar la pantalla entera. Se limpian
 * cada vez que se dibuja el paso 2, porque los nodos viejos dejan de existir.
 */
const refsCampos: Record<
  string,
  { entrada: HTMLInputElement; ayuda: HTMLElement; texto: (v: string) => string }
> = {}

/** El nodo donde se listan los códigos, y el temporizador de la búsqueda. */
let nodoCodigos: HTMLElement | null = null
let relojCodigos: ReturnType<typeof setTimeout> | null = null
/** El último código que propusimos solos, para no pisar una elección manual. */
let codigoPropuesto: string | null = null

/**
 * El total sale de `totalDelRenglon` del paquete compartido, no de una cuenta
 * propia. Tenía una acá duplicada y se quedó sin el factor de cantidad cuando
 * se arregló la de la app: dos sierras seguían cotizando como una. Cualquier
 * cuenta que la app haga, el probador la tiene que llamar, no copiar.
 */
function recalcular(item: FormularioItemNota): void {
  const campos = item.herramienta ? CAMPOS_POR_HERRAMIENTA[item.herramienta] : []
  if (!campos.includes('precio_por_diente') || !campos.includes('cantidad_dientes')) return
  const total = totalDelRenglon(item)
  if (total > 0) item.precio_total = String(total)
}

/**
 * Busca el código de cómputo de la REPARACIÓN de los dientes rotos.
 *
 * Es la misma medida —el ancho de corte— pero otro servicio, así que da otro
 * código y otro precio. Se dispara cuando contestan que sí quieren repararlos.
 */
function pedirCodigoReparacion(item: FormularioItemNota, donde: HTMLElement): void {
  vaciar(donde).appendChild(cargando('Buscando el código de reparación…'))

  void d
    .resolverCodigoDeItem(item, 'reparacion')
    .then((codigos) => {
      vaciar(donde)
      if (!codigos) return
      if (!codigos.length) {
        donde.appendChild(
          aviso(
            'atencion',
            'Sin código de reparación',
            'El catálogo no tiene un código de reparación para esa medida.',
          ),
        )
        return
      }

      const mejor = codigos[0]
      item.codigo_reparacion = mejor.codigo
      item.precio_reparacion_por_diente = mejor.precio_pesos !== null ? String(mejor.precio_pesos) : ''
      recalcularYPintar(item)

      const linea = lineasDelRenglon(item).find((l) => l.concepto === 'reparacion')
      donde.appendChild(
        h(
          'div.tarjeta',
          {},
          h(
            'div.fila',
            {},
            pastilla(mejor.codigo, colores.ambarOscuro),
            h('span.tarjeta-dato', { texto: describirRango(mejor.rango_min, mejor.rango_max) }),
            h('span', {
              texto: linea
                ? `${linea.cantidad} × ${formatearPesos(linea.precioUnitario)} = ${formatearPesos(linea.total)}`
                : '',
              estilo: { marginLeft: 'auto', color: colores.ambarOscuro, fontWeight: '600' },
            }),
          ),
          h('div.tarjeta-dato', { texto: mejor.descripcion }),
        ),
      )
    })
    .catch(() => {
      vaciar(donde).appendChild(
        aviso('error', null, 'No pudimos buscar el código de reparación.'),
      )
    })
}

/**
 * Busca los códigos que cubren la medida y reescribe SÓLO su bloque.
 *
 * Se hace con debounce porque se dispara en cada tecla del ancho de corte, y
 * sin repintar la pantalla porque eso mataría el cursor del campo que se está
 * tipeando justo arriba.
 */
function pedirCodigos(item: FormularioItemNota, espera = 250): void {
  if (relojCodigos) clearTimeout(relojCodigos)
  relojCodigos = setTimeout(() => {
    const destino = nodoCodigos
    if (!destino) return

    void d
      .resolverCodigoDeItem(item)
      .then((codigos) => {
        // Si mientras tanto se cambió de renglón, este resultado ya no va.
        if (nodoCodigos !== destino) return
        vaciar(destino)
        if (!codigos) return
        if (!codigos.length) {
          destino.appendChild(
            aviso('atencion', null, 'No hay ningún código que cubra esa medida.'),
          )
          return
        }

        // Se propone el más ajustado, pero sólo si no hay una elección manual:
        // lo que puso el vendedor no se pisa aunque cambie la medida.
        const elegidos = item.codigos_computo
        const intocado =
          elegidos.length === 0 || (elegidos.length === 1 && elegidos[0] === codigoPropuesto)
        if (intocado) {
          const mejor = codigos[0]
          codigoPropuesto = mejor.codigo
          item.codigos_computo = [mejor.codigo]
          if (mejor.precio_pesos !== null) {
            item.precio_por_diente = String(mejor.precio_pesos)
            const ref = refsCampos.precio_por_diente
            if (ref) {
              ref.entrada.value = item.precio_por_diente
              ref.ayuda.textContent = ref.texto(item.precio_por_diente)
            }
          }
          recalcularYPintar(item)
        }

        for (const c of codigos) {
          const elegido = item.codigos_computo.includes(c.codigo)
          destino.appendChild(
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
                    if (!elegido && c.precio_pesos !== null) {
                      item.precio_por_diente = String(c.precio_pesos)
                      const ref = refsCampos.precio_por_diente
                      if (ref) {
                        ref.entrada.value = item.precio_por_diente
                        ref.ayuda.textContent = ref.texto(item.precio_por_diente)
                      }
                    }
                    codigoPropuesto = null
                    recalcularYPintar(item)
                    pedirCodigos(item, 0)
                  },
                },
              },
              h(
                'div.fila',
                {},
                h('strong', { texto: c.codigo }),
                // El rango explica por qué ése y no otro.
                h('span.tarjeta-dato', { texto: describirRango(c.rango_min, c.rango_max) }),
                h('span', {
                  texto: c.precio_pesos !== null ? formatearPesos(Number(c.precio_pesos)) : '—',
                  estilo: { marginLeft: 'auto', color: colores.verdeOscuro, fontWeight: '600' },
                }),
              ),
              h('div.tarjeta-dato', { texto: c.descripcion }),
              c.moneda === 'USD'
                ? h('div.tarjeta-dato', {
                    texto: `Lista en US$ ${Number(c.precio).toFixed(2)} · convertido al cambio de hoy`,
                  })
                : null,
            ),
          )
        }
      })
      .catch(() => vaciar(destino))
  }, espera)
}

/**
 * Busca el agujero de fábrica de la herramienta en la lista de precios.
 *
 * Se dispara con las medidas, así que va con espera; y sólo repinta si
 * encontró algo distinto, para no matar el cursor del campo que se está
 * tipeando.
 */
let relojAgujero: ReturnType<typeof setTimeout> | null = null

function pedirAgujeroDeFabrica(item: FormularioItemNota): void {
  const campos = item.herramienta ? CAMPOS_POR_HERRAMIENTA[item.herramienta] : []
  if (!campos.includes('diametro_interior') || !item.diametro_exterior.trim()) return

  if (relojAgujero) clearTimeout(relojAgujero)
  relojAgujero = setTimeout(() => {
    void d
      .agujeroDeFabrica(item)
      .then((agujero) => {
        if (!agujero || agujero === item.diametro_interior_catalogo) return
        item.diametro_interior_catalogo = agujero
        refrescar()
      })
      .catch(() => undefined)
  }, 400)
}

/** El total de la nota, que vive fuera del renglón y también hay que refrescar. */
let nodoTotal: HTMLElement | null = null

function pintarTotalDeLaNota(): void {
  if (!nodoTotal) return
  // En pesos: la nota puede mezclar artículos de lista en dólares con otros
  // en pesos, y sumarlos como si fueran lo mismo no daría plata de ninguna.
  const total = totalDeRenglones(borrador.items, borrador.cotizacion?.venta ?? 0)
  vaciar(nodoTotal)
  if (total > 0) {
    nodoTotal.appendChild(
      aviso(
        'exito',
        `Total · ${borrador.items.length} ${borrador.items.length === 1 ? 'renglón' : 'renglones'}`,
        formatearPesos(total),
      ),
    )
  }
}

/** Recalcula y refleja el total en su campo, sin volver a dibujar nada más. */
function recalcularYPintar(item: FormularioItemNota): void {
  const antes = item.precio_total
  recalcular(item)
  if (item.precio_total === antes) return

  const ref = refsCampos.precio_total
  if (ref) {
    ref.entrada.value = item.precio_total
    ref.ayuda.textContent = ref.texto(item.precio_total)
  }
  pintarTotalDeLaNota()
}

/**
 * El renglón de venta.
 *
 * Es el único que no pide medidas: el código del artículo ya lo identifica. El
 * precio que se carga es el de UNA unidad y el total es la multiplicación.
 */
function camposVenta(
  item: FormularioItemNota,
  err: Record<string, string | undefined>,
): Array<HTMLElement | null> {
  const nodoTotalVenta = h('div.tarjeta-dato')

  function pintarTotalVenta(): void {
    const unidades = aNumero(item.unidades)
    const total = totalDelRenglon(item)
    const enPesos = totalDelRenglonEnPesos(item, borrador.cotizacion?.venta ?? 0)
    nodoTotalVenta.textContent =
      total > 0 && unidades > 0
        ? `${unidades} × ${formatearMoneda(aNumero(item.precio), item.moneda)} = ${formatearMoneda(total, item.moneda)}` +
          (item.moneda === 'USD' && enPesos > 0 ? `  ≈ ${formatearPesos(enPesos)}` : '')
        : ''
    pintarTotalDeLaNota()
  }
  pintarTotalVenta()

  return [
    buscadorDeArticulos(item, err, pintarTotalVenta),
    campo('DESCRIPCIÓN', {
      valor: item.descripcion,
      multilinea: true,
      alCambiar: (v) => (item.descripcion = v),
    }),
    campo('UNIDADES', {
      valor: item.unidades,
      error: err.unidades,
      alCambiar: (v) => {
        item.unidades = soloNumeros(v)
        pintarTotalVenta()
      },
    }),
    casilla('PROMOCIÓN', item.promocion, (v) => {
      item.promocion = v
      if (!v) item.promocion_detalle = ''
      refrescar()
    }),
    item.promocion
      ? campo('¿CUÁL ES LA PROMOCIÓN?', {
          valor: item.promocion_detalle,
          error: err.promocion_detalle,
          alCambiar: (v) => (item.promocion_detalle = v),
        })
      : null,
    campo(item.moneda === 'USD' ? 'PRECIO UNITARIO (US$)' : 'PRECIO UNITARIO', {
      valor: item.precio,
      error: err.precio,
      ayuda: 'Lo que vale UNA unidad, en la moneda de la lista.',
      alCambiar: (v) => {
        item.precio = soloNumeros(v)
        pintarTotalVenta()
      },
    }),
    nodoTotalVenta,
  ]
}

/**
 * Buscador del catálogo de precios.
 *
 * El vendedor tipea el código o parte de la descripción y elige. Al elegir se
 * completa el renglón entero: código, descripción, precio, moneda y las
 * características que la lista trae escritas adentro de la descripción
 * —diámetro, ancho de corte y dientes—, que son las que después hay que copiar
 * a la columna técnica de la nota.
 */
function buscadorDeArticulos(
  item: FormularioItemNota,
  err: Record<string, string | undefined>,
  alCambiarPrecio: () => void,
): HTMLElement {
  const resultados = h('div')
  const elegido = h('div')
  let reloj: ReturnType<typeof setTimeout> | null = null

  function pintarElegido(): void {
    vaciar(elegido)
    if (!item.codigo_herramienta) return
    // Las características se leen del texto de la lista: "SC nueva" no tiene
    // adentro ningún D=, ningún Z=.
    const c = caracteristicasDeArticulo(item.descripcion_catalogo || item.descripcion, null)
    const resumen = resumenCaracteristicas(c)
    const cambio = borrador.cotizacion?.venta ?? 0
    elegido.appendChild(
      h(
        'div.tarjeta',
        { clase: 'elegida' },
        h(
          'div.fila',
          {},
          pastilla(item.codigo_herramienta, colores.verdeOscuro),
          item.moneda === 'USD' ? pastilla('LISTA EN US$', colores.azul) : null,
        ),
        h('div', { texto: item.descripcion_catalogo || item.descripcion }),
        resumen ? h('div.tarjeta-dato', { texto: resumen }) : null,
        item.moneda === 'USD' && cambio > 0
          ? h('div.tarjeta-dato', {
              texto: `Al cambio de hoy: ${formatearPesos(aNumero(item.precio) * cambio)} por unidad`,
            })
          : null,
      ),
    )
  }
  pintarElegido()

  function buscar(texto: string): void {
    if (reloj) clearTimeout(reloj)
    if (texto.trim().length < 2) return void vaciar(resultados)
    reloj = setTimeout(() => {
      void d
        .buscarArticulos(texto.trim())
        .then((articulos) => {
          vaciar(resultados)
          if (!articulos.length) {
            resultados.appendChild(
              aviso('atencion', null, 'No hay ningún artículo con eso. Probá con menos letras.'),
            )
            return
          }
          for (const a of articulos) {
            const c = caracteristicasDeArticulo(a.descripcion, a.medida)
            const resumen = resumenCaracteristicas(c)
            const moneda = a.moneda === 'USD' ? 'USD' : 'ARS'
            resultados.appendChild(
              h(
                'div.tarjeta',
                {
                  estilo: { cursor: 'pointer' },
                  al: {
                    click: () => {
                      item.codigo_herramienta = a.codigo
                      // La descripción impresa NO se pisa con el texto de la
                      // lista: es larga y desborda la columna del talonario.
                      // El artículo queda identificado por el código.
                      if (esDescripcionSugerida(item.descripcion)) {
                        item.descripcion = descripcionSugerida(item.herramienta, item.servicio)
                      }
                      item.descripcion_catalogo = a.descripcion
                      item.precio = String(a.precio)
                      item.moneda = moneda
                      // Las características van a los mismos campos que usa el
                      // afilado, así que salen impresas sin volver a tipearlas.
                      if (c.diametro_exterior) item.diametro_exterior = c.diametro_exterior
                      // El agujero de fábrica va a su propio campo: el que se
                      // carga a mano es el de la pieza del cliente.
                      if (c.diametro_interior) item.diametro_interior_catalogo = c.diametro_interior
                      if (c.ancho_corte) item.ancho_corte = c.ancho_corte
                      if (c.dientes) item.cantidad_dientes = c.dientes
                      if (c.largo) item.largo = c.largo
                      if (c.ancho) item.ancho = c.ancho
                      if (c.espesor) item.espesor = c.espesor
                      alCambiarPrecio()
                      refrescar()
                    },
                  },
                },
                h(
                  'div.fila',
                  {},
                  h('strong', { texto: a.codigo }),
                  h('span', {
                    texto: a.sin_precio
                      ? 'a confirmar'
                      : formatearMoneda(Number(a.precio), moneda),
                    estilo: { marginLeft: 'auto', color: colores.verdeOscuro, fontWeight: '600' },
                  }),
                ),
                h('div', { texto: a.descripcion }),
                resumen ? h('div.tarjeta-dato', { texto: resumen }) : null,
                moneda === 'USD' && a.precio_pesos
                  ? h('div.tarjeta-dato', { texto: `≈ ${formatearPesos(Number(a.precio_pesos))}` })
                  : null,
              ),
            )
          }
        })
        .catch(() => vaciar(resultados))
    }, 300)
  }

  return h(
    'div',
    {},
    campo('BUSCAR EN LA LISTA DE PRECIOS', {
      marcador: 'Código o descripción — ej. LG2B o sierra 300',
      error: err.codigo_herramienta,
      ayuda: 'Al elegir se completan solos el precio y las características.',
      alCambiar: buscar,
    }),
    resultados,
    elegido,
  )
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

  if (c === 'afilado_reparacion') {
    return casilla(ETIQUETAS_CAMPO[c], item.afilado_reparacion, (v) => {
      item.afilado_reparacion = v
      refrescar()
    })
  }

  if (c === 'dientes_rotos') {
    return casilla(ETIQUETAS_CAMPO[c], item.dientes_rotos, (v) => {
      item.dientes_rotos = v
      // Destildar borra todo lo que colgaba de ahí: una cantidad de rotos
      // escondida descontaría dientes que nadie volvió a mirar.
      if (!v) {
        item.dientes_rotos_cantidad = ''
        item.reparar_dientes = null
        item.codigo_reparacion = ''
        item.precio_reparacion_por_diente = ''
      }
      refrescar()
    })
  }

  if (c === 'dientes_rotos_cantidad') {
    if (!item.dientes_rotos) return null
    return campo(ETIQUETAS_CAMPO[c], {
      valor: item.dientes_rotos_cantidad,
      error: err.dientes_rotos_cantidad,
      ayuda: 'Se descuentan de los dientes a afilar.',
      alMontar: ({ entrada, ayuda }) => {
        refsCampos[c] = { entrada, ayuda, texto: () => 'Se descuentan de los dientes a afilar.' }
      },
      alCambiar: (v) => {
        // Sólo enteros: medio diente roto no existe.
        const limpio = v.replace(/\D/g, '')
        item.dientes_rotos_cantidad = limpio
        const ref = refsCampos[c]
        if (ref && ref.entrada.value !== limpio) ref.entrada.value = limpio
        recalcularYPintar(item)
      },
    })
  }

  if (c === 'reparar_dientes') {
    if (!item.dientes_rotos) return null
    const bloqueReparacion = h('div')
    if (item.reparar_dientes === true) pedirCodigoReparacion(item, bloqueReparacion)

    return h(
      'div',
      {},
      // Sin valor por defecto a propósito: la respuesta cambia el precio.
      desplegable('¿DESEA REPARAR LOS DIENTES?', {
        valor: item.reparar_dientes === null ? null : item.reparar_dientes ? 'si' : 'no',
        items: [
          { valor: 'si' as const, etiqueta: 'SÍ, REPARARLOS · se cobran aparte' },
          { valor: 'no' as const, etiqueta: 'NO · sólo se descuentan' },
        ],
        alCambiar: (v) => {
          item.reparar_dientes = v === 'si'
          if (v === 'no') {
            item.codigo_reparacion = ''
            item.precio_reparacion_por_diente = ''
          }
          refrescar()
        },
      }),
      bloqueReparacion,
      err.reparar_dientes ? h('span.campo-error-texto', { texto: err.reparar_dientes }) : null,
      err.codigo_reparacion ? h('span.campo-error-texto', { texto: err.codigo_reparacion }) : null,
    )
  }

  if (c === 'descripcion') {
    return campo('DESCRIPCIÓN', {
      valor: item.descripcion,
      multilinea: true,
      error: err.descripcion,
      ayuda: 'Se completa sola con la herramienta. Agregale lo que haga falta.',
      alCambiar: (v) => (item.descripcion = v),
    })
  }

  if (c === 'diametro_interior') {
    // Opcional: la lista de precios ya trae el agujero de fábrica. Se carga
    // sólo cuando la pieza del cliente tiene otro, que es lo que le cambia el
    // trabajo al taller.
    const deFabrica = item.diametro_interior_catalogo.trim()
    const nodoAviso = h('div')

    function pintarAviso(): void {
      const a = agujeroDelRenglon(item)
      vaciar(nodoAviso)
      if (a.ajuste === 'de_fabrica') return
      nodoAviso.appendChild(
        aviso(
          'atencion',
          a.ajuste === 'agrandado' ? 'Agujero agrandado' : 'Lleva buje reductor',
          `${formatearMedida(a.medida)} contra ${formatearMedida(deFabrica)} de fábrica. ` +
            'Va escrito en la descripción general de la nota.',
        ),
      )
    }
    pintarAviso()

    return h(
      'div',
      {},
      campo('DIÁMETRO INTERIOR (OPCIONAL)', {
        valor: item.diametro_interior,
        marcador: deFabrica || 'El agujero de la herramienta',
        error: err.diametro_interior,
        ayuda: deFabrica
          ? `De fábrica: ${formatearMedida(deFabrica)}. Dejalo vacío si es ése.`
          : 'Si lo dejás vacío, la nota sale sin agujero.',
        alCambiar: (v) => {
          item.diametro_interior = normalizarMedida(v)
          pintarAviso()
        },
      }),
      nodoAviso,
    )
  }

  const etiqueta =
    c === 'cantidad'
      ? `CANTIDAD DE ${item.herramienta ? SINGULAR_HERRAMIENTA[item.herramienta] : 'HERRAMIENTAS'}`
      : ETIQUETAS_CAMPO[c]

  const valorActual = (item as unknown as Record<string, string>)[c] ?? ''
  const esMedida = MEDIDAS.has(c)
  const esPrecio = c === 'precio_por_diente' || c === 'precio_total'

  const textoAyuda = (v: string) =>
    esPrecio && aNumero(v) > 0
      ? formatearPesos(aNumero(v))
      : esMedida && aNumero(v) > 0
        ? formatearMedida(v)
        : ''

  return campo(etiqueta, {
    valor: valorActual,
    error: err[c],
    ayuda: textoAyuda(valorActual),
    alMontar: ({ entrada, ayuda }) => {
      refsCampos[c] = { entrada, ayuda, texto: textoAyuda }
    },
    alCambiar: (v) => {
      // Las medidas van con coma; el punto se toma como coma.
      const limpio = esMedida ? normalizarMedida(v) : soloNumeros(v)
      ;(item as unknown as Record<string, string>)[c] = limpio

      const ref = refsCampos[c]
      if (ref) {
        if (ref.entrada.value !== limpio) ref.entrada.value = limpio
        ref.ayuda.textContent = textoAyuda(limpio)
      }

      // Nada de repintar la pantalla: se actualiza sólo lo que cambió. Repintar
      // recreaba el input y el cursor se iba al principio en cada tecla.
      recalcularYPintar(item)
      if (esMedida) pedirCodigos(item)
      // El diámetro exterior identifica la herramienta en la lista de precios,
      // y de ahí sale su agujero de fábrica.
      if (c === 'diametro_exterior' || c === 'ancho_corte' || c === 'cantidad_dientes') {
        pedirAgujeroDeFabrica(item)
      }
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
    const notas = await d.crearNotaPedido({
      encabezado: borrador.encabezado,
      servicios: borrador.servicios,
      tipoNota: borrador.tipoNota!,
      fechaEntrega: borrador.fechaEntrega,
      items: borrador.items,
      tipoCambio: borrador.cotizacion.venta,
      cotizacionFecha: borrador.cotizacion.fecha,
      observaciones: borrador.observaciones,
      condicionVenta: borrador.condicionVenta!,
      condicionVentaDetalle: borrador.condicionDetalle,
    })

    // Puede haber salido más de una: el afilado y la venta no van en el mismo
    // comprobante.
    const detalle = notas
      .map((n) => {
        const numero = n.numero === null ? 'sin número todavía' : `Nº ${String(n.numero).padStart(6, '0')}`
        return `· ${ETIQUETA_GRUPO_NOTA[n.grupo]} — ${numero} — ${formatearPesos(n.total)}`
      })
      .join('\n')
    const pendiente = notas.some((n) => n.numero === null)
      ? '\n\nEl cliente todavía no tiene código: quedan esperando que Administración se lo asigne.'
      : ''

    alert(
      `${notas.length === 1 ? 'Nota de pedido creada' : `Se crearon ${notas.length} notas de pedido`}\n\n${detalle}${pendiente}`,
    )

    const ids = notas.map((n) => n.id)
    borrador = nuevoBorrador()
    zonaSugerida = null
    zonaCandidatas = []
    pila.length = 0
    pantalla(pantallaNotasPedido, { apilar: false })
    pantalla(() => pantallaVistaPrevia(ids, false))
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
