/**
 * Catálogo de "Reportar un problema" CONTEXTUAL, pantalla por pantalla.
 *
 * ─── Por qué un catálogo por pantalla y no la lista global ───────────────────
 *
 * Porque el reporte útil es el que llega con el problema PUNTUAL de esa función,
 * no un motivo genérico elegido en un desplegable de trece. En cada pantalla el
 * vendedor ve un botón en el CUERPO con la pregunta de esa pantalla ("¿No
 * encontrás al cliente?") y, al tocarlo, elige entre los 3 problemas más
 * probables de ESA función + "Otros" (a mano). La oficina lo ve exacto.
 *
 * Los 3 problemas salieron de revisar qué hace cada pantalla (ver el workflow
 * `catalogo-reportes-por-pantalla`). El principal va PRIMERO.
 *
 * ─── Por qué texto y no un enum de la base ───────────────────────────────────
 *
 * Igual que `MOTIVOS_DE_PROBLEMA`: agregar o cambiar un problema es tocar este
 * archivo y publicar, no una migración. `reportes_problema.motivo` guarda la
 * frase elegida tal cual, y el panel la muestra así.
 */

export interface ContextoProblema {
  /** Nombre legible de la pantalla, para el campo `pantalla` del reporte. */
  pantalla: string
  /** El título en forma de pregunta del botón que va en el cuerpo de la pantalla. */
  pregunta: string
  /** Los 3 problemas más probables de esa función, el principal primero. */
  problemas: string[]
}

/** La 4ª opción, universal: el vendedor cuenta a mano qué pasó. */
export const PROBLEMA_OTROS = 'Otro problema (lo cuento yo)'

import type { ParametrosApp } from './tipos'

const POR_RUTA: Partial<Record<keyof ParametrosApp, ContextoProblema>> = {
  // ── Clientes y direcciones ──────────────────────────────────────────────
  AgregarDestino: {
    pantalla: 'Buscar cliente / agregar destino',
    pregunta: '¿No encontrás al cliente?',
    problemas: [
      'No me aparece un cliente que existe',
      'Me trae mal la dirección o la sucursal',
      'Lo agrego y no entra al recorrido',
    ],
  },
  NuevoCliente: {
    pantalla: 'Cliente nuevo',
    pregunta: '¿No podés cargar al cliente nuevo?',
    problemas: [
      'No me toma la dirección que cargo',
      'Me dice que ya existe y frena',
      'Lo cargué y no lo encuentro',
    ],
  },
  EditarProspecto: {
    pantalla: 'Editar cliente provisorio',
    pregunta: '¿No podés corregir los datos?',
    problemas: [
      'No me deja editarlo, dice confirmado',
      'No me guarda los cambios',
      'No me carga la ficha del cliente',
    ],
  },
  CorregirDireccion: {
    pantalla: 'Corregir dirección',
    pregunta: '¿No podés corregir la dirección?',
    problemas: [
      'El GPS no me toma dónde estoy',
      'No me completa la dirección del pin',
      'Mandé la corrección y sigue igual',
    ],
  },

  // ── Notas de pedido ─────────────────────────────────────────────────────
  NotasPedido: {
    pantalla: 'Notas de pedido (inicio)',
    pregunta: '¿No te cierra el número de pendientes?',
    problemas: [
      'Dice mal cuántas pendientes tengo',
      'Una nota que cargué no figura',
      'Los botones me quedan en gris',
    ],
  },
  GenerarNota: {
    pantalla: 'Generar / editar una nota',
    pregunta: '¿No podés terminar de cargar la nota?',
    problemas: [
      'No sé qué falta para seguir',
      'No encuentro el código en la lista',
      'El precio o el total sale mal',
    ],
  },
  NotasPendientes: {
    pantalla: 'Notas pendientes de mandar',
    pregunta: '¿No podés imprimir las notas?',
    problemas: [
      'Mandé a imprimir y no salió nada',
      'Falta una nota en la lista',
      'No me deja corregir una nota',
    ],
  },
  DetalleNota: {
    pantalla: 'Detalle de una nota',
    pregunta: '¿Hay algo mal en la nota?',
    problemas: [
      'Un dato de la nota está mal',
      'Falta una herramienta que cargué',
      'No me deja corregir la nota',
    ],
  },

  // ── Impresión y rol de visita ───────────────────────────────────────────
  NotasImpresas: {
    pantalla: 'Notas impresas',
    pregunta: '¿No encontrás una nota impresa?',
    problemas: [
      'No aparece una nota que imprimí',
      'Una nota impresa salió con error',
      'El total o el número no coincide',
    ],
  },
  HistorialNotas: {
    pantalla: 'Historial de notas',
    pregunta: '¿No encontrás una nota vieja?',
    problemas: [
      'No encuentro una nota de otro día',
      'La nota es de hace más de 90 días',
      'La búsqueda por cliente no la trae',
    ],
  },
  VistaPrevia: {
    pantalla: 'Vista previa / imprimir',
    pregunta: '¿Algo mal en la vista previa?',
    problemas: [
      'Un precio o cantidad no coincide',
      'Falta un renglón u observación',
      'Mandé a imprimir y no salió',
    ],
  },
  RolDeVisita: {
    pantalla: 'Rol de visita (planilla)',
    pregunta: '¿Algo mal en el rol de visita?',
    problemas: [
      'Falta un destino en la planilla',
      'Un destino figura sin dirección o cliente',
      'Lo mandé a la oficina y no salió',
    ],
  },
  MisImpresiones: {
    pantalla: 'Mis impresiones (cola)',
    pregunta: '¿Algo que mandaste no aparece?',
    problemas: [
      'No aparece algo que mandé a imprimir',
      'Mi turno en la cola no avanza',
      'Dice impreso pero no salió el papel',
    ],
  },

  // ── Recorrido, mapa y visita ────────────────────────────────────────────
  Recorrido: {
    pantalla: 'Recorrido del día',
    pregunta: '¿Un problema con tu recorrido de hoy?',
    problemas: [
      'Me manda a la dirección equivocada',
      'No abre el recorrido en Google Maps',
      'El orden de los destinos está mal',
    ],
  },
  MapaClientes: {
    pantalla: 'Mapa de clientes',
    pregunta: '¿No encontrás al cliente en el mapa?',
    problemas: [
      'El cliente no aparece en el mapa',
      'El pin cae en el lugar equivocado',
      'El buscador no lo encuentra',
    ],
  },
  Visitas: {
    pantalla: 'Visitas del día',
    pregunta: '¿No te cierra el número de visitas?',
    problemas: [
      'Me dice mal cuántas visitas tengo',
      'Marca mal pendientes o visitados',
      'Dice que no tengo destinos cargados',
    ],
  },
  DestinoVisitado: {
    pantalla: 'Parte de la visita',
    pregunta: '¿No podés guardar la visita?',
    problemas: [
      'No me guarda el parte',
      'Me pide datos que ya completé',
      'El micrófono no toma lo que dicté',
    ],
  },

  // ── Agenda y planificación ──────────────────────────────────────────────
  ClientesDelDia: {
    pantalla: 'Clientes del día',
    pregunta: '¿Falta alguien en los de hoy?',
    problemas: [
      'Falta un cliente que tengo hoy',
      'Aparece uno que hoy no toca',
      'Al armar quedan clientes afuera',
    ],
  },
  CalendarioVisitas: {
    pantalla: 'Calendario de visitas (semana)',
    pregunta: '¿Falta un cliente en la semana?',
    problemas: [
      'Falta un cliente que esperaba',
      'Agendé uno y no aparece',
      'No me deja moverlo de día',
    ],
  },
  ListaSemanal: {
    pantalla: 'Lista semanal fija',
    pregunta: '¿No encontrás al cliente?',
    problemas: [
      'No encuentro al cliente para agregarlo',
      'Guardé y no me quedó la lista',
      'No aparece sugerido en el calendario',
    ],
  },
  CalendarioEnvios: {
    pantalla: 'Agenda de envíos',
    pregunta: '¿Falta algo que agendaste?',
    problemas: [
      'No aparece un día que agendé',
      'Falta un envío comprometido',
      'No veo lo que tengo ese día',
    ],
  },
  Historial: {
    pantalla: 'Historial de visitas',
    pregunta: '¿Falta una visita que hiciste?',
    problemas: [
      'Falta una visita que hice',
      'Dice que no visité y sí fui',
      'No encuentro un día de hace rato',
    ],
  },
  DetalleVisita: {
    pantalla: 'Detalle de una visita',
    pregunta: '¿Figura mal algo de la visita?',
    problemas: [
      'Figura mal lo que hice',
      'La observación quedó mal o cortada',
      'El mapa no cae en el cliente',
    ],
  },

  // ── Cobranzas, stock, cuenta ────────────────────────────────────────────
  Cobranzas: {
    pantalla: 'Cobranzas',
    pregunta: '¿Algo no cuadra en las cobranzas?',
    problemas: [
      'Falta un cobro que cargué',
      'No me deja corregir un cobro',
      'Mandé la rendición y no llegó',
    ],
  },
  StockDisponible: {
    pantalla: 'Stock disponible',
    pregunta: '¿El stock no coincide?',
    problemas: [
      'Dice que hay y no hay',
      'No encuentro la herramienta que busco',
      'No me dice cuánto hay',
    ],
  },
  ComunicacionInterna: {
    pantalla: 'Comunicación con la oficina',
    pregunta: '¿No podés comunicarte con la oficina?',
    problemas: [
      'El WhatsApp no me abre el chat',
      'Un número de la oficina está mal',
      'Falta un contacto de la oficina',
    ],
  },
  Cuentas: {
    pantalla: 'Cuentas guardadas en el teléfono',
    pregunta: '¿No podés cambiar de cuenta?',
    problemas: [
      'No me pasa a la otra cuenta',
      'No aparece una cuenta que tenía',
      'Agregué una cuenta y no entra',
    ],
  },

  // ── Menú, configuración, administración ─────────────────────────────────
  Menu: {
    pantalla: 'Menú principal',
    pregunta: '¿Te falta una opción del menú?',
    problemas: [
      'Me falta una opción que uso',
      'Dice mal los pendientes de hoy',
      'Toco una opción y no abre',
    ],
  },
  Configuracion: {
    pantalla: 'Configuración',
    pregunta: '¿Un problema con la configuración?',
    problemas: [
      'Cambio la letra y no cambia',
      'Busco actualización y no la baja',
      'Mis datos de la cuenta están mal',
    ],
  },
  AdminUsuarios: {
    pantalla: 'Administración de usuarios',
    pregunta: '¿Un problema con el alta de usuarios?',
    problemas: [
      'Creé el usuario y perdí la contraseña',
      'No me deja aprobar al usuario nuevo',
      'Habilité el teléfono y no entra',
    ],
  },
  AdminClientes: {
    pantalla: 'Administración de clientes',
    pregunta: '¿Un problema con un cliente?',
    problemas: [
      'No encuentro al cliente que busco',
      'No me deja guardar sin la ubicación',
      'Guardo el cliente y no se guarda',
    ],
  },
  AdminModificaciones: {
    pantalla: 'Auditoría de modificaciones',
    pregunta: '¿Falta un cambio en la lista?',
    problemas: [
      'Falta un cambio que se hizo',
      'No puedo compartir el CSV',
      'Dice mal quién lo cambió',
    ],
  },
}

/**
 * El contexto de problema para la ruta donde está el vendedor. Para una ruta sin
 * mapear devuelve `null`: ahí el botón de reporte del cuerpo no se muestra (y
 * queda el genérico del menú). Nunca tira.
 */
export function problemaDePantalla(ruta: string): ContextoProblema | null {
  return POR_RUTA[ruta as keyof ParametrosApp] ?? null
}
