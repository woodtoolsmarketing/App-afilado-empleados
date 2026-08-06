/**
 * Zonas de venta de WoodTools.
 *
 * El número de zona va impreso en la nota de pedido y es el que usa la oficina
 * para repartir el trabajo. Hasta ahora el vendedor lo escribía a mano en un
 * campo libre ("Oeste", "oeste", "Z. Oeste"…), que es exactamente el tipo de
 * dato que después nadie puede agrupar.
 *
 * Acá está la planilla de zonas tal como la pasó la empresa, y con ella la
 * asignación automática: al cargar la ubicación del cliente se busca su
 * localidad en estas listas y la zona sale sola.
 *
 * Tres cosas que no son obvias y conviene tener presentes:
 *
 *  1. **El código no es único.** El 121 aparece dos veces en la planilla
 *     (Cañada de Gómez y Santa Fe Capital). Por eso cada zona tiene además un
 *     `id` propio, y lo que se guarda en la nota es el `codigo`, que es lo que
 *     la oficina lee.
 *
 *  2. **Hay localidades repetidas entre zonas**, y no por error: "Las Heras"
 *     está en Buenos Aires (116) y en Mendoza (126), "Maipú" en Buenos Aires
 *     (120) y en Mendoza (126), "Victoria" en Entre Ríos aparece en 136 y 143.
 *     Por eso el resultado de la búsqueda es una LISTA de candidatas: la
 *     provincia desempata cuando se la conoce y, cuando no alcanza, se le
 *     pregunta al vendedor en vez de elegir por él.
 *
 *  3. **Las zonas que la planilla marca "(Todos)"** —101 Norte, 103 La Plata,
 *     107 Oeste y 110 CABA— vinieron sin listado de localidades. Para que la
 *     asignación automática funcione igual se armó uno con los partidos y
 *     localidades habituales de cada una; quedan marcadas con
 *     `listadoEstimado` para que se puedan revisar y corregir. El resto de las
 *     listas es textual de la planilla.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Normalización
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Abreviaturas que aparecen en la planilla y que Google devuelve escritas
 * enteras (o al revés). Sólo van las que no tienen otra lectura posible: "cap."
 * puede ser Capital o Capitán, así que ésa se resuelve con alias explícitos.
 */
const ABREVIATURAS: Record<string, string> = {
  gral: 'general',
  grl: 'general',
  cnel: 'coronel',
  crnel: 'coronel',
  sta: 'santa',
  sto: 'santo',
  cnia: 'colonia',
  pto: 'puerto',
  emp: 'empalme',
  exalt: 'exaltacion',
  cdad: 'ciudad',
  ing: 'ingeniero',
  dr: 'doctor',
  av: '',
  avda: '',
  avenida: '',
  calle: '',
  provincia: '',
  partido: '',
  departamento: '',
  dpto: '',
  argentina: '',
}

/** Reemplazos de más de una palabra, que hay que hacer antes de separar. */
const FRASES: Array<[RegExp, string]> = [
  [/\bbs\s+as\b/g, 'buenos aires'],
  [/\bcaba\b/g, 'ciudad autonoma de buenos aires'],
  [/\bcapital federal\b/g, 'ciudad autonoma de buenos aires'],
  [/\bciudad de buenos aires\b/g, 'ciudad autonoma de buenos aires'],
]

const COMBINANTES = new RegExp('[\\u0300-\\u036f]', 'g')

/**
 * Deja el texto en una forma comparable: sin tildes, sin puntuación, en
 * minúsculas y con las abreviaturas resueltas. "Gral. Belgrano" y "General
 * Belgrano" terminan siendo la misma cadena, que es todo lo que hace falta.
 */
export function normalizarUbicacion(texto: string | null | undefined): string {
  let t = String(texto ?? '')
    .normalize('NFD')
    .replace(COMBINANTES, '')
    .toLowerCase()
    .replace(/[^a-z0-9'\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  for (const [de, a] of FRASES) t = t.replace(de, a)

  return t
    .split(' ')
    .map((p) => (p in ABREVIATURAS ? ABREVIATURAS[p] : p))
    .filter(Boolean)
    .join(' ')
}

/**
 * ¿Aparece la frase como palabras completas?
 *
 * Con `includes` a secas, "Colón" entraría dentro de "Colonia Caroya" y "Salto"
 * dentro de "Saltos". La nota de pedido saldría con la zona equivocada por una
 * coincidencia de letras.
 */
function contieneFrase(texto: string, frase: string): boolean {
  if (!frase || !texto) return false
  let desde = 0
  for (;;) {
    const i = texto.indexOf(frase, desde)
    if (i < 0) return false
    const abre = i === 0 || texto[i - 1] === ' '
    const fin = i + frase.length
    const cierra = fin === texto.length || texto[fin] === ' '
    if (abre && cierra) return true
    desde = i + 1
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// El catálogo
// ─────────────────────────────────────────────────────────────────────────────

export interface ZonaVenta {
  /** Único. El código no lo es: el 121 está dos veces en la planilla. */
  id: string
  /** Lo que se imprime en la nota, en el recuadro "Zona". */
  codigo: string
  nombre: string
  /**
   * Para desempatar los nombres repetidos entre provincias. Vacío = la zona no
   * se define por provincia y nunca se descarta por ese motivo.
   */
  provincias: string[]
  localidades: string[]
  /**
   * La planilla decía "(Todos)" y el listado lo armamos nosotros. Hay que
   * revisarlo con la empresa antes de darlo por cerrado.
   */
  listadoEstimado?: boolean
  /**
   * La zona ES una o más provincias enteras (146 Noroeste, 147 Sur, 150
   * Litoral, 151 Chaco/Formosa, 110 CABA). Sólo estas se pueden reconocer por
   * el nombre de la provincia.
   *
   * Sin esta distinción, la 121 "Santa Fe Capital" se llevaba puesto todo lo
   * que estuviera en la provincia de Santa Fe —Rosario incluido— y la 148 se
   * quedaba con cualquier dirección de Neuquén. Una zona de una ciudad no
   * puede reclamar la provincia entera.
   */
  territorioProvincial?: boolean
}

const BA = 'Buenos Aires'
const CABA_PROV = 'Ciudad Autónoma de Buenos Aires'

export const ZONAS: ZonaVenta[] = [
  {
    id: '101',
    codigo: '101',
    nombre: 'Zona Norte',
    provincias: [BA],
    listadoEstimado: true,
    localidades: [
      'Vicente López', 'Olivos', 'Florida', 'Munro', 'Villa Martelli', 'Carapachay',
      'La Lucila', 'Florida Oeste',
      'San Isidro', 'Martínez', 'Acassuso', 'Beccar', 'Boulogne', 'Villa Adelina',
      'San Fernando', 'Virreyes', 'Victoria',
      'Tigre', 'Don Torcuato', 'General Pacheco', 'Benavídez', 'Rincón de Milberg',
      'El Talar', 'Nordelta', 'Dique Luján',
      'Escobar', 'Belén de Escobar', 'Garín', 'Maquinista Savio', 'Ingeniero Maschwitz',
      'General San Martín', 'Villa Ballester', 'José León Suárez', 'San Andrés',
      'Villa Lynch', 'Chilavert', 'Billinghurst',
      'Tres de Febrero', 'Caseros', 'Santos Lugares', 'Ciudadela', 'Villa Bosch',
      'Sáenz Peña', 'Martín Coronado', 'Loma Hermosa',
      'San Miguel', 'Bella Vista', 'Muñiz', 'José C. Paz',
      'Malvinas Argentinas', 'Grand Bourg', 'Los Polvorines', 'Tortuguitas', 'Pablo Nogués',
      'Del Viso',
    ],
  },
  {
    id: '102',
    codigo: '102',
    nombre: 'Zona Sur — Avellaneda / Quilmes',
    provincias: [BA],
    localidades: [
      'Avellaneda', 'Quilmes', 'Berazategui', 'Florencio Varela', 'Florecio Varela',
      // Contiguas, que es lo que dice la planilla.
      'Sarandí', 'Wilde', 'Dock Sud', 'Villa Domínico', 'Piñeyro', 'Crucecita',
      'Bernal', 'Don Bosco', 'Ezpeleta', 'San Francisco Solano', 'Hudson',
      'Villa España', 'Ranelagh', 'Plátanos', 'Sourigues', 'Guillermo Enrique Hudson',
      'Bosques', 'Gutiérrez', 'Zeballos',
    ],
  },
  {
    id: '103',
    codigo: '103',
    nombre: 'La Plata',
    provincias: [BA],
    listadoEstimado: true,
    localidades: [
      'La Plata', 'Tolosa', 'Ringuelet', 'Gonnet', 'Manuel B. Gonnet', 'City Bell',
      'Villa Elisa', 'Villa Castells', 'Joaquín Gorina', 'Los Hornos', 'San Carlos',
      'Melchor Romero', 'Abasto', 'Arturo Seguí', 'Etcheverry', 'Olmos', 'Lisandro Olmos',
      'Berisso', 'Ensenada', 'Punta Lara',
    ],
  },
  {
    id: '104',
    codigo: '104',
    nombre: 'Zona Sur — Lanús / Lomas',
    provincias: [BA],
    localidades: [
      'Lanús', 'Gerli', 'Lomas de Zamora', 'Banfield', 'Monte Grande', 'Adrogué',
      'Canning',
      // "y toda esa parte de la zona sur".
      'Valentín Alsina', 'Remedios de Escalada', 'Temperley', 'Turdera', 'Llavallol',
      'Burzaco', 'Claypole', 'Longchamps', 'Glew', 'Rafael Calzada', 'San Francisco Solano',
      'Almirante Brown', 'Esteban Echeverría', 'Luis Guillón', '9 de Abril',
      'El Jagüel', 'Ezeiza', 'Tristán Suárez', 'Lomas del Mirador',
      'Alejandro Korn', 'Guernica', 'Presidente Perón', 'San Vicente',
    ],
  },
  {
    id: '107',
    codigo: '107',
    nombre: 'Zona Oeste',
    provincias: [BA],
    listadoEstimado: true,
    localidades: [
      'Morón', 'Castelar', 'Haedo', 'El Palomar', 'Villa Sarmiento',
      'Ituzaingó', 'Hurlingham', 'William Morris', 'Villa Tesei',
      'Ramos Mejía', 'San Justo', 'Villa Luzuriaga', 'Isidro Casanova',
      'Gregorio de Laferrere', 'González Catán', 'Rafael Castillo', 'Ciudad Evita',
      'Tapiales', 'Aldo Bonzi', 'Villa Madero', 'La Tablada', 'Virrey del Pino',
      'La Matanza', '20 de Junio',
      'Merlo', 'San Antonio de Padua', 'Libertad', 'Mariano Acosta', 'Pontevedra',
      'Moreno', 'Paso del Rey', 'Francisco Álvarez', 'Trujui', 'Cuartel V',
      'Marcos Paz', 'General Rodríguez', 'Padua',
    ],
  },
  {
    id: '110',
    codigo: '110',
    nombre: 'CABA',
    provincias: [CABA_PROV],
    territorioProvincial: true,
    listadoEstimado: true,
    localidades: [
      'Ciudad Autónoma de Buenos Aires', 'Capital Federal', 'CABA',
    ],
  },
  {
    id: '115',
    codigo: '115',
    nombre: 'Gral. Belgrano / Brandsen',
    provincias: [BA],
    localidades: [
      'General Belgrano', 'Gral. Belgrano', 'Brandsen', 'Coronel Brandsen',
      'San Vicente', 'Ranchos', 'San Miguel del Monte', 'S.M. del Monte', 'Monte',
    ],
  },
  {
    id: '116',
    codigo: '116',
    nombre: 'Navarro / Cañuelas / Lobos',
    provincias: [BA],
    localidades: ['Navarro', 'Las Heras', 'General Las Heras', 'Cañuelas', 'Lobos'],
  },
  {
    id: '120',
    codigo: '120',
    nombre: 'Ruta 2',
    provincias: [BA],
    localidades: ['Chascomús', 'Lezama', 'Dolores', 'Maipú', 'Castelli'],
  },
  {
    id: '121-canada-de-gomez',
    codigo: '121',
    nombre: 'Cañada de Gómez',
    provincias: ['Santa Fe'],
    localidades: ['Armstrong', 'Arteaga', 'Cañada de Gómez', 'Carcarañá', 'Correa'],
  },
  {
    id: '121-santa-fe',
    codigo: '121',
    nombre: 'Santa Fe Capital',
    provincias: ['Santa Fe'],
    localidades: ['Santa Fe', 'Santa Fe Capital', 'Santa Fe de la Vera Cruz'],
  },
  {
    id: '122',
    codigo: '122',
    nombre: 'Mar del Plata / Costa Atlántica',
    provincias: [BA],
    localidades: [
      'Mar del Plata', 'Miramar', 'Chapadmalal', 'Santa Teresita', 'Mar del Tuyú',
      'San Bernardo', 'Mar de Ajó', 'Pinamar', 'San Clemente', 'San Clemente del Tuyú',
      'Santa Clara', 'Santa Clara del Mar', 'Villa Gesell', 'Ostende', 'Las Toninas',
      'Aguas Verdes', 'Valeria del Mar',
    ],
  },
  {
    id: '124',
    codigo: '124',
    nombre: 'Necochea',
    provincias: [BA],
    localidades: ['Necochea', 'Quequén', 'Sierra de la Ventana'],
  },
  {
    id: '126',
    codigo: '126',
    nombre: 'San Juan / San Luis / Mendoza',
    provincias: ['Mendoza', 'San Juan', 'San Luis'],
    localidades: [
      'San Luis', 'Villa Mercedes', 'Vicuña Mackenna', 'V. Mackenna',
      'Mendoza', 'Tunuyán', 'Tupungato', 'San Rafael', 'General Alvear', 'Gral. Alvear',
      'San Juan', 'Caucete', 'Pocitos', 'Rawson', 'Godoy Cruz', 'Palmira',
      'Guaymallén', 'Luján de Cuyo', 'Las Heras', 'Maipú', 'General San Martín',
      'Gral. San Martín', 'Chimbas', 'Albardón',
    ],
  },
  {
    id: '130',
    codigo: '130',
    nombre: 'Ruta 5',
    provincias: [BA, 'La Pampa', 'Santa Fe'],
    localidades: [
      'Arenales', 'General Arenales', 'Santa Rosa', 'Sta. Rosa', 'Darregueira',
      'Trenque Lauquen', 'Rufino', 'Olavarría', 'Junín', 'Bragado',
      'Carlos Casares', 'C. Casares', 'Roque Pérez',
    ],
  },
  {
    id: '132',
    codigo: '132',
    nombre: 'Bahía Blanca',
    provincias: [BA, 'La Pampa'],
    localidades: [
      'Bahía Blanca', 'Pringles', 'Coronel Pringles', 'Cnel. Pringles',
      'Castex', 'Eduardo Castex', 'Rivadavia', 'Pigüé', 'Carhué', 'Gral. Lacha',
      'Santa Rosa', 'Sta. Rosa', 'Lobería', 'Huanguelén', 'Coronel Suárez',
      'Cnel. Suárez', 'General Pico', 'Gral. Pico',
    ],
  },
  {
    id: '136',
    codigo: '136',
    nombre: 'Entre Ríos',
    provincias: ['Entre Ríos', 'Corrientes'],
    localidades: [
      'Colón', 'Villa Elisa', 'Ubajay', 'San Salvador', 'Concordia', 'Mocoretá',
      'Juan Pujol', 'Monte Caseros', 'San José', 'Concepción del Uruguay',
      'Gualeguaychú', 'Chajarí', 'Calabacillas', 'Pucheta', 'Colonia Libertad',
      'Federación', 'Paso de los Libres', 'Santo Tomé', 'Victoria', 'Diamante',
      'Gualeguay', 'Ceibas',
    ],
  },
  {
    id: '137',
    codigo: '137',
    nombre: 'Córdoba',
    provincias: ['Córdoba'],
    localidades: [
      'Córdoba', 'Carlos Paz', 'Villa Carlos Paz', 'Cosquín', 'Fronteras', 'Devoto',
      'La Falda', 'Capilla del Monte', 'C. del Monte', 'Jesús María', 'J. María',
      'Río Ceballos', 'Villa del Rosario', 'V. del Rosario', 'Río Segundo', 'Río II',
      'Alta Gracia', 'Calamuchita', 'Villa General Belgrano', 'V.G. Belgrano',
      'Oliva', 'Oncativo', 'La Carlota', 'Canals', 'Rivera Indarte', 'Chapuí',
      'Los Boulevares', 'Ferreyra', 'Sampacho', 'Río Cuarto', 'Venado Tuerto',
      'V. Tuerto', 'Elena', 'Almafuerte', 'Río Tercero', 'Río III', 'Costa Sacate',
      'Monte Buey', 'Bell Ville', 'Dehesa', 'La Dehesa', 'Adelia María',
      'Colonia Caroya', 'Cnia. Caroya', 'Dolores', 'Colazo', 'Arroyito',
      'Laguna Larga', 'La Para', 'Marcos Juárez',
    ],
  },
  {
    id: '140',
    codigo: '140',
    nombre: 'Pergamino',
    provincias: [BA],
    localidades: [
      'San Antonio de Areco', 'S.A. de Areco', 'Capitán Sarmiento', 'Cap. Sarmiento',
      'Salto', 'San Andrés de Giles', 'S.A. de Giles', 'Carmen de Areco', 'C. de Areco',
      'Arrecifes', 'Pergamino', 'Norberto de la Riestra', 'N. de la Riestra',
      'Chacabuco', 'Chivilcoy', '25 de Mayo', 'Veinticinco de Mayo', 'Zárate', 'Campana',
    ],
  },
  {
    id: '141',
    codigo: '141',
    nombre: 'Luján / Pilar / Mercedes',
    provincias: [BA],
    localidades: [
      'Pilar', 'Capilla del Señor', 'Exaltación de la Cruz', 'Exalt. de la Cruz',
      'Luján', 'Mercedes', 'Parada Robles', 'Villa Flandria', 'Jáuregui', 'Open Door',
      'Cortines',
    ],
  },
  {
    id: '142',
    codigo: '142',
    nombre: 'Rosario',
    provincias: ['Santa Fe', BA],
    localidades: [
      'Acebal', 'Albarellos', 'Álvarez', 'Arequito', 'Arroyo Seco', 'Baradero',
      'Casilda', 'Empalme Villa Constitución', 'Emp. Villa Constitución', 'Fuentes',
      'Funes', 'Pujato', 'Ramallo', 'Roldán', 'Rosario', 'San Nicolás de los Arroyos',
      'S. Nicolás de los Arroyos', 'San Nicolás', 'Soldini', 'Uranga',
      'Villa Constitución', 'V. Constitución', 'Villa Ramallo', 'V. Ramallo',
    ],
  },
  {
    id: '143',
    codigo: '143',
    nombre: 'Urdinarrain / Nogoyá',
    provincias: ['Entre Ríos', 'Corrientes'],
    localidades: [
      'Urdinarrain', 'Victoria', 'Crespo', 'Ramírez', 'General Ramírez', 'Nogoyá',
      'Rosario del Tala', 'Basavilbaso', 'Corrientes',
    ],
  },
  {
    id: '144',
    codigo: '144',
    nombre: 'Chillar / Alberti',
    provincias: [BA, 'Santa Fe'],
    localidades: [
      'Chillar', "General O'Brien", "Gral. O'Brien", "O'Brien", 'Alberti', 'Moquehuá',
      'General Alvear', 'Gral. Alvear', 'Gorostiaga', 'Suipacha', 'Villa Lía',
      'Pedernales', "O'Higgins", 'Coronel Mom', 'Ascensión', 'Totoras',
    ],
  },
  {
    id: '146',
    codigo: '146',
    nombre: 'Salta / Noroeste',
    provincias: [
      'Salta', 'Catamarca', 'Tucumán', 'Jujuy', 'La Rioja', 'Santiago del Estero',
    ],
    territorioProvincial: true,
    localidades: [
      'Salta', 'Catamarca', 'San Fernando del Valle de Catamarca', 'Tucumán',
      'San Miguel de Tucumán', 'Jujuy', 'San Salvador de Jujuy', 'La Rioja',
      'Santiago del Estero',
    ],
  },
  {
    id: '147',
    codigo: '147',
    nombre: 'Sur',
    provincias: ['Tierra del Fuego', 'Chubut', 'Santa Cruz'],
    territorioProvincial: true,
    localidades: [
      'Tierra del Fuego', 'Chubut', 'Santa Cruz', 'Puerto Madryn', 'Pto. Madryn',
      'Patagonia Sur', 'Río Gallegos', 'Río Grande', 'Ushuaia', 'Comodoro Rivadavia',
      'Trelew', 'Rawson',
    ],
  },
  {
    id: '148',
    codigo: '148',
    nombre: 'Sur Corta',
    provincias: ['Río Negro', 'Neuquén'],
    localidades: [
      'Río Colorado', 'Choele Choel', 'Villa Regina', 'V. Regina', 'Lamarque',
      'General Roca', 'Gral. Roca', 'Allen', 'Cipolletti', 'Cinco Saltos', '5 Saltos',
      'General Conesa', 'Gral. Conesa', 'Neuquén', 'General Godoy', 'Gral. Godoy',
      'Luis Beltrán', 'Centenario', 'Plottier', 'Fernández Oro',
    ],
  },
  {
    id: '149',
    codigo: '149',
    nombre: 'Esperanza',
    provincias: ['Santa Fe', 'Córdoba'],
    localidades: [
      'Esperanza', 'San Jerónimo', 'Franck', 'Humboldt', 'San Justo', 'Rafaela',
      'Crespo', 'San Francisco',
    ],
  },
  {
    id: '150',
    codigo: '150',
    nombre: 'Litoral / Misiones',
    provincias: ['Misiones'],
    territorioProvincial: true,
    localidades: [
      'Litoral', 'Misiones', 'Corrientes', 'Posadas', 'Oberá', 'Eldorado',
      'Puerto Iguazú', 'Goya',
    ],
  },
  {
    id: '151',
    codigo: '151',
    nombre: 'Chaco / Formosa',
    provincias: ['Chaco', 'Formosa'],
    territorioProvincial: true,
    localidades: [
      'Chaco', 'Formosa', 'Resistencia', 'Presidencia Roque Sáenz Peña', 'Charata',
    ],
  },
  {
    id: '152',
    codigo: '152',
    nombre: 'Sur Larga',
    provincias: ['Neuquén', 'Río Negro', 'Chubut'],
    localidades: [
      'Zapala', 'Aluminé', 'Junín de los Andes', 'San Martín de los Andes',
      'S.M. de los Andes', 'Villa La Angostura', 'V. La Angostura', 'El Bolsón',
      'Lago Puelo', 'Esquel', 'El Maitén', 'Cutral Có', 'Cutral-Có',
    ],
  },
  {
    id: '154',
    codigo: '154',
    nombre: 'Bariloche',
    provincias: ['Río Negro'],
    localidades: ['Bariloche', 'San Carlos de Bariloche', 'Dina Huapi'],
  },
]

/** "107 · Zona Oeste" — cómo se muestra la zona en cualquier lista. */
export function etiquetaZona(z: ZonaVenta): string {
  return `${z.codigo} · ${z.nombre}`
}

/**
 * El nombre de una zona a partir del código guardado en la nota.
 *
 * Con el 121, que está repetido, devuelve los dos nombres separados por " / ":
 * el código guardado no alcanza para saber cuál de las dos era, y mostrar una
 * sola sería inventar.
 */
export function nombreDeZona(codigo: string | null | undefined): string {
  const c = String(codigo ?? '').trim()
  if (!c) return ''
  const encontradas = ZONAS.filter((z) => z.codigo === c)
  if (encontradas.length === 0) return c
  return encontradas.map((z) => z.nombre).join(' / ')
}

// ─────────────────────────────────────────────────────────────────────────────
// Asignación automática
// ─────────────────────────────────────────────────────────────────────────────

/** De dónde salió la coincidencia. Cambia cuánto se le puede creer. */
export type OrigenZona = 'localidad' | 'provincia' | 'direccion'

export interface ZonaSugerida {
  zona: ZonaVenta
  /** La localidad del catálogo que coincidió, tal como está escrita. */
  localidad: string
  origen: OrigenZona
  /** Para ordenar candidatas. No se muestra. */
  puntaje: number
}

export interface UbicacionCliente {
  localidad?: string | null
  provincia?: string | null
  /** La dirección formateada completa, que suele traer localidad y provincia. */
  direccion?: string | null
}

/** Índice normalizado, calculado una sola vez al cargar el módulo. */
const INDICE = ZONAS.map((zona) => ({
  zona,
  provincias: zona.provincias.map(normalizarUbicacion),
  localidades: zona.localidades.map((l) => ({ texto: l, norma: normalizarUbicacion(l) })),
}))

/**
 * Cuánto vale cada procedencia. Que la localidad pese más que la dirección no
 * es un detalle: "Las Heras" es un partido de Buenos Aires y también una
 * avenida de medio país, así que una coincidencia dentro del texto libre de la
 * dirección nunca puede ganarle a una localidad declarada.
 */
const PESO: Record<OrigenZona, number> = { localidad: 3000, provincia: 2000, direccion: 1000 }

/**
 * Qué zonas podrían corresponder a esa ubicación, de la más probable a la menos.
 *
 * Devuelve una lista y no una zona porque hay localidades repetidas entre
 * provincias y la ubicación no siempre trae la provincia. Cuando queda una
 * sola, la pantalla la aplica sola; cuando quedan varias, pregunta.
 */
export function zonasPorUbicacion(u: UbicacionCliente): ZonaSugerida[] {
  const textos: Array<[OrigenZona, string]> = [
    ['localidad', normalizarUbicacion(u.localidad)],
    ['provincia', normalizarUbicacion(u.provincia)],
    ['direccion', normalizarUbicacion(u.direccion)],
  ]
  const provincia = normalizarUbicacion(u.provincia)

  const candidatas: ZonaSugerida[] = []
  let hayCoincidenciaDeProvincia = false

  for (const entrada of INDICE) {
    const coincideProvincia = provincia !== '' && entrada.provincias.some((p) => p === provincia)
    if (coincideProvincia) hayCoincidenciaDeProvincia = true

    let mejor: ZonaSugerida | null = null

    for (const [origen, texto] of textos) {
      if (!texto) continue
      // Sólo las zonas que SON una provincia entera se reconocen por el nombre
      // de la provincia. Si no, "Santa Fe Capital" se quedaría con Rosario.
      if (origen === 'provincia' && !entrada.zona.territorioProvincial) continue
      for (const loc of entrada.localidades) {
        if (!contieneFrase(texto, loc.norma)) continue
        // La localidad más larga gana: "Rosario del Tala" describe mejor que
        // "Rosario", y las dos coinciden con el mismo texto.
        const puntaje = PESO[origen] + loc.norma.length + (coincideProvincia ? 500 : 0)
        if (!mejor || puntaje > mejor.puntaje) {
          mejor = { zona: entrada.zona, localidad: loc.texto, origen, puntaje }
        }
      }
    }

    if (mejor) candidatas.push(mejor)
  }

  // La provincia descarta: "Las Heras, Mendoza" no puede ser la 116, que es de
  // Buenos Aires. Sólo se aplica si alguna candidata declara esa provincia; si
  // ninguna la declara, el dato no sirve para elegir y se lo ignora.
  const filtradas = hayCoincidenciaDeProvincia
    ? candidatas.filter(
        (c) => c.zona.provincias.length === 0 || c.zona.provincias.map(normalizarUbicacion).includes(provincia),
      )
    : candidatas

  return filtradas.sort((a, b) => b.puntaje - a.puntaje)
}

export interface ResultadoZona {
  /** La zona a aplicar sola. Sólo se llena cuando no hay ninguna duda. */
  unica: ZonaSugerida | null
  /** Todas las que podrían ser, para que el vendedor elija. */
  candidatas: ZonaSugerida[]
}

/**
 * La respuesta lista para la pantalla.
 *
 * Dos reglas para decidir si se aplica sola:
 *
 *  · **Gana la mejor procedencia.** Si alguna zona coincidió por localidad
 *    declarada, las que sólo coincidieron por el texto de la dirección no
 *    compiten: "Junín de los Andes" es la 152 aunque la dirección diga
 *    "Neuquén" y la 148 tenga Neuquén en su lista.
 *
 *  · **Si todas las que quedan tienen el mismo código, no hay duda.** El 121
 *    está dos veces en la planilla y lo que se imprime es el 121: preguntar
 *    cuál de los dos es sería preguntar por algo que no cambia nada.
 *
 * Fuera de eso se devuelven todas. Con dos empatadas de verdad —una "Victoria"
 * que puede ser la 136 o la 143— elegir por el vendedor sería poner un número
 * que nadie chequeó en un comprobante.
 */
export function zonaParaUbicacion(u: UbicacionCliente): ResultadoZona {
  const candidatas = zonasPorUbicacion(u)
  if (candidatas.length === 0) return { unica: null, candidatas }

  const mejorOrigen = candidatas[0].origen
  const delMejorOrigen = candidatas.filter((c) => c.origen === mejorOrigen)
  const codigos = new Set(delMejorOrigen.map((c) => c.zona.codigo))

  return {
    unica: codigos.size === 1 ? delMejorOrigen[0] : null,
    candidatas,
  }
}

/** Buscador del selector de zona: filtra por código, nombre o localidad. */
export function buscarZonas(texto: string): ZonaVenta[] {
  const q = normalizarUbicacion(texto)
  if (!q) return ZONAS
  return ZONAS.filter((z, i) => {
    if (z.codigo.includes(q)) return true
    if (normalizarUbicacion(z.nombre).includes(q)) return true
    return INDICE[i].localidades.some((l) => l.norma.includes(q))
  })
}
