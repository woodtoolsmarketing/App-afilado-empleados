/**
 * Depura el padrón contra un listado nuevo del Gestión Comercial.
 *
 *   node herramientas/depurar-padron.mjs clientes-wood-tools.xlsx
 *   node herramientas/depurar-padron.mjs clientes-wood-tools.xlsx --aplicar
 *   node herramientas/depurar-padron.mjs clientes-wood-tools.xlsx --planilla
 *   node herramientas/depurar-padron.mjs clientes-wood-tools.xlsx --todos
 *
 * Sin `--aplicar` NO escribe nada: baja el padrón, lo compara con el archivo,
 * imprime el informe y deja un CSV con cada cambio propuesto, uno por línea,
 * para mirarlo en una planilla antes de decidir. Con `--aplicar` escribe.
 *
 * `--planilla` no escribe en la base tampoco: deja las altas armadas con las
 * columnas del espejo de Google Sheets, para pegarlas ahí y que las cargue el
 * sincronizador. Es el mismo resultado por otro camino, y hay una diferencia
 * que conviene tener presente antes de elegir — está explicada abajo de todo.
 *
 * `--todos` deja el padrón ENTERO como va a quedar después de la depuración:
 * los del listado más los que ya están cargados y el listado no trae. No es la
 * diferencia, es la foto completa. Sirve para mirarla, filtrarla o guardarla;
 * para cargar, siguen siendo `--aplicar` o `--planilla`.
 *
 * ─── Por qué no alcanza con volver a importar ───────────────────────────────
 *
 * `importar-clientes.mjs` pisa el cliente entero con lo que trae el listado.
 * Eso servía para la carga inicial, cuando no había nada que pisar. Ahora no:
 * medido entre el listado del 03/09/2026 y las 12.182 fichas cargadas, sobre
 * los 12.181 clientes que están en los dos lados —
 *
 *     razón social ... 1.116 vienen CORTADAS y 0 traen más
 *     dirección .......... 13 cortadas, 130 completan una que estaba vacía
 *     nombre fantasía .... 58 cortadas,  30 completan
 *     CP ................. 37 cortados,   3 completan
 *     teléfono ........... 51 cortados, 115 con menos dígitos, 202 con más
 *     mail ............... 17 cortados, 406 completan
 *
 * — o sea que reimportar de una arruinaría 1.116 razones sociales. Esa es toda
 * la razón de este archivo: traer lo que falta sin romper lo que ya está bien.
 *
 * El listado nuevo sale de un PDF de 1.833 hojas y la columna del PDF es más
 * angosta que el campo del Gestión, que son 30 caracteres. Por eso corta. No es
 * un error de la extracción: es que el papel no entra.
 *
 * ─── La regla ───────────────────────────────────────────────────────────────
 *
 * Una sola, y se puede comprobar: **nunca escribir algo que pierda lo que ya
 * estaba**. Lo del listado entra sólo cuando se puede demostrar que no pierde.
 *
 *   · El listado no dice nada         → queda lo que hay.
 *   · La ficha estaba vacía           → entra lo del listado.
 *   · La razón social                 → NUNCA se pisa. El listado no la mejora
 *                                       nunca y la empeora 1.116 veces.
 *   · Lo mismo, mejor escrito         → entra lo del listado. Son espacios
 *                                       dobles colapsados, el `|` que pasó a
 *                                       `;`, el apóstrofo ´ que pasó a '.
 *   · Las notas                       → sólo se completan. Adentro va la zona,
 *                                       y la zona del listado viene cortada.
 *   · El teléfono                     → entra sólo si la ficha no tiene letras
 *                                       —"FAX", un nombre, que el listado no
 *                                       trae— y ningún número de la ficha
 *                                       desaparece.
 *   · Todo lo demás                   → entra sólo si adentro está TODO lo que
 *                                       ya había, parte por parte. El listado
 *                                       corta cada parte por separado, así que
 *                                       comparar la cadena entera no alcanza.
 *   · Si no                           → queda lo que hay, y sale en el CSV.
 *
 * El CSV trae lo que se va a escribir y, además, lo que se decidió NO escribir
 * cuando el listado traía algo que la ficha no tiene: una mudanza, un teléfono
 * nuevo. Eso es lo único de los rechazos que hay que mirar a mano; los miles de
 * recortes del PDF no aportan nada y quedan sólo en el resumen de arriba.
 *
 * Lo que NO se toca en ningún caso: `cuit`, `documento`, `activo`,
 * `vendedor_id` y `provisorio`. El listado no los trae, y `activo` sobre todo:
 * un cliente que desapareció del listado NO se da de baja solo. Si estaba en un
 * recorrido, desaparecería del rol sin que nadie se entere. Las bajas se
 * informan acá y se hacen a mano desde el panel.
 *
 * ─── Por qué la clave de servicio y no la función temporal ──────────────────
 *
 * `importar-clientes.mjs` escribe por `importar_clientes_temporal`, una función
 * `security definer` que hay que crear antes y borrar después. Existía para no
 * poner una credencial de Supabase en el script. Pero la credencial ya está en
 * el `.env` de la máquina que corre esto, y esa función se perdió una vez —
 * quedó llamada desde el script y sin existir en ningún lado, y el importador
 * quedó inejecutable durante meses.
 *
 * Acá se escribe con `SUPABASE_SERVICE_ROLE_KEY` directo. Es la misma llave que
 * ya está en el archivo, y así no queda NADA instalado en la base: sin función
 * privilegiada dando vueltas y sin un paso manual que alguien se pueda olvidar
 * de deshacer.
 *
 * ─── `--aplicar` o `--planilla`: en qué se diferencian ──────────────────────
 *
 * Los dos dan de alta los mismos clientes. Lo que cambia es qué pasa con el
 * domicilio, y cuánto tarda.
 *
 *   --aplicar   El domicilio entra como TEXTO en `clientes.direccion`, igual
 *               que la carga del Gestión. No se consulta a Google. Son unos
 *               segundos para las 4.314. Después, cuando alguien quiera, se
 *               geocodifica en bloque con `npm run geocodificar:padron`.
 *
 *   --planilla  El sincronizador de la hoja manda cada fila al servidor, y el
 *               servidor geocodifica CADA domicilio contra Google antes de
 *               guardarlo. Medido contra la función desplegada: 4,98 segundos
 *               cada diez filas, o sea medio segundo por cliente. Para 4.314
 *               son unos 36 minutos de reloj, y Apps Script corta a los 6.
 *
 * Por eso el archivo que deja `--planilla` trae el domicilio en columnas
 * aparte: pegando sólo las dos primeras —código y razón social— las 4.314
 * altas entran en una sola sincronización de segundos, y el vendedor ya
 * encuentra al cliente. Los domicilios se pegan después, de a doscientos, o se
 * cargan por el otro camino. La hoja se hizo para dar de alta un cliente o dos;
 * cuatro mil es pedirle algo que no es lo suyo.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import ExcelJS from 'exceljs'

const AQUI = path.dirname(fileURLToPath(import.meta.url))
const RAIZ = path.resolve(AQUI, '..')

const HOJA = 'Clientes'

/** Cuántas filas por request. El tope de PostgREST para leer es 1.000. */
const PAGINA = 1000
/** Cuántas filas por escritura. */
const TANDA = 500

/**
 * Los códigos reales del Gestión llegan hasta 17.337. Lo que pasa de acá es
 * carga de prueba de alguien —55555, 131313, 444444— o un número de otro
 * sistema. No se descartan, porque están en el listado y no me toca a mí
 * decidirlo, pero se informan aparte para que alguien los mire.
 */
const CODIGO_SOSPECHOSO_DESDE = 20000

// ── Configuración ───────────────────────────────────────────────────────────

const env = {}
for (const linea of fs.readFileSync(path.join(RAIZ, '.env'), 'utf8').split(/\r?\n/)) {
  const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}

if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('\n  Falta SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el .env\n')
  process.exit(1)
}

const ARCHIVO = process.argv[2]
const APLICAR = process.argv.includes('--aplicar')
const PARA_PLANILLA = process.argv.includes('--planilla')
const TODOS = process.argv.includes('--todos')

if (!ARCHIVO || !fs.existsSync(ARCHIVO)) {
  console.error('\n  Uso: node herramientas/depurar-padron.mjs <listado.xlsx> [--aplicar]\n')
  process.exit(1)
}

const cabeceras = {
  apikey: env.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
}

// ── Limpieza ────────────────────────────────────────────────────────────────

const texto = (v) => String(v ?? '').replace(/\s+/g, ' ').trim()

/** Sin los ceros de relleno: "00000001003" es "1003", como lo dice la oficina. */
const sinCeros = (v) => texto(v).replace(/^0+(?=\d)/, '')

const digitos = (v) => texto(v).replace(/[^0-9]/g, '')

/**
 * El PDF marca "acá no hay nada" con un guion, y a veces con un punto.
 *
 * La hoja "Info" del listado sólo avisa del guion en Domicilio, pero está en
 * seis columnas: 148 en Nombre fantasía, 150 en Domicilio, y sueltos en CP,
 * Teléfonos, Mail y Datos de entregas. Son 307 celdas. Si entraran tal cual, el
 * cliente quedaría con un guion de nombre de fantasía o de teléfono, y peor: en
 * una ficha que hoy tiene el dato bien, el guion es "algo" y podría pisarlo.
 */
const marcadorVacio = (v) => (/^[-.]+$/.test(texto(v)) ? '' : texto(v))

/**
 * Y marca el código postal que no sabe con todos nueves: 999, 9999, 9999999.
 * Eso también lo dice la hoja "Info". Son 2.424 filas.
 */
const codigoPostal = (v) => (/^9{3,}$/.test(texto(v)) ? '' : marcadorVacio(v))

// ── Lectura del listado ─────────────────────────────────────────────────────

/** Los nombres de columna que espera, en minúsculas y sin acentos. */
const COLUMNAS = {
  codigo: 'codigo',
  razon: 'nombre / razon social',
  fantasia: 'nombre fantasia',
  domicilio: 'domicilio',
  cp: 'cod. postal',
  localidad: 'localidad',
  zona: 'localizacion / zona',
  contacto: 'contacto',
  telefonos: 'telefonos',
  mail: 'mail',
  entrega: 'datos de entregas',
}

const sinAcentos = (s) =>
  texto(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')

async function leerListado(ruta) {
  const libro = new ExcelJS.Workbook()
  await libro.xlsx.readFile(ruta)

  const hoja = libro.getWorksheet(HOJA)
  if (!hoja) {
    console.error(`\n  El archivo no tiene una hoja "${HOJA}". Tiene: ${libro.worksheets.map((h) => h.name).join(', ')}\n`)
    process.exit(1)
  }

  const encabezado = hoja.getRow(1).values.map((v) => sinAcentos(v))
  const col = {}
  for (const [clave, nombre] of Object.entries(COLUMNAS)) {
    const i = encabezado.indexOf(nombre)
    if (i < 0) {
      console.error(`\n  Falta la columna "${nombre}". El encabezado dice: ${encabezado.filter(Boolean).join(' | ')}\n`)
      process.exit(1)
    }
    col[clave] = i
  }

  const filas = []
  const repetidos = []
  const vistos = new Set()

  hoja.eachRow((fila, n) => {
    if (n === 1) return
    // Todas las columnas pasan por el mismo filtro: el marcador de vacío del
    // PDF aparece en seis de ellas, no sólo en Domicilio.
    const dame = (c) => marcadorVacio(fila.getCell(col[c]).text)

    const codigo = sinCeros(fila.getCell(col.codigo).text)
    const razon = dame('razon')
    if (!codigo || !razon) return

    if (vistos.has(codigo)) {
      repetidos.push(codigo)
      return
    }
    vistos.add(codigo)

    const mail = dame('mail')
    // Lo que no tiene arroba no es un mail: son teléfonos sueltos, direcciones
    // web y notas de la oficina. Van a `notas`, como hace el importador.
    const esMail = mail.includes('@')

    filas.push({
      codigo,
      razon_social: razon,
      nombre_fantasia: dame('fantasia'),
      direccion: dame('domicilio'),
      codigo_postal: codigoPostal(fila.getCell(col.cp).text),
      localidad: dame('localidad'),
      contacto_nombre: dame('contacto'),
      telefono: dame('telefonos'),
      email: esMail ? mail : '',
      notas: [
        dame('zona') ? `Zona (Gestión): ${dame('zona')}` : '',
        dame('entrega'),
        !esMail && mail ? mail : '',
      ]
        .filter(Boolean)
        .join(' · '),
    })
  })

  return { filas, repetidos }
}

// ── Lectura del padrón ──────────────────────────────────────────────────────

const CAMPOS = [
  'razon_social',
  'nombre_fantasia',
  'direccion',
  'codigo_postal',
  'localidad',
  'contacto_nombre',
  'telefono',
  'email',
  'notas',
]

async function bajarPadron() {
  const base = new Map()
  for (let desde = 0; ; desde += PAGINA) {
    const url =
      `${env.SUPABASE_URL}/rest/v1/clientes` +
      `?select=codigo,${CAMPOS.join(',')}&order=codigo&offset=${desde}&limit=${PAGINA}`
    const r = await fetch(url, { headers: cabeceras })
    if (!r.ok) throw new Error(`No pudimos leer el padrón: ${r.status} ${await r.text()}`)
    const trozo = await r.json()
    for (const c of trozo) base.set(c.codigo, c)
    if (trozo.length < PAGINA) break
  }
  return base
}

// ── La decisión ─────────────────────────────────────────────────────────────

/**
 * El mismo contenido, ignorando cómo está escrito.
 *
 * Sirve para reconocer los cambios que son sólo de forma: espacios dobles que
 * se colapsaron, el `|` que pasó a `;`, el apóstrofo ´ que pasó a '. En esos
 * casos el listado viene mejor escrito y conviene tomarlo.
 */
const aplanar = (s) => texto(s).toLowerCase().replace(/[^a-z0-9áéíóúñü]/gi, '')

/**
 * Las partes de un campo que guarda varias cosas separadas por `|` o `;`.
 *
 * El campo de mail del Gestión no tiene sólo mails: tiene mails, teléfonos de
 * encargados y notas de la oficina, todo junto y separado con barras. El
 * listado corta CADA parte por su cuenta, así que comparar la cadena entera no
 * alcanza para ver que se perdió algo.
 */
const partes = (s) =>
  texto(s)
    .split(/[|;]/)
    .map((p) => p.trim())
    .filter(Boolean)

/**
 * Lo mismo pero contando también el `·`, que es con lo que este script arma las
 * notas. Se usa sólo para decidir qué sale en el CSV: el listado devuelve las
 * partes en otro orden, así que comparar la cadena entera daba "esto es nuevo"
 * en 942 fichas que no tenían nada nuevo.
 */
const trozos = (s) =>
  texto(s)
    .split(/[|;·]/)
    .map((p) => p.trim())
    .filter(Boolean)

/** Las tiradas de cinco dígitos o más, que es lo que identifica un teléfono. */
const numeros = (s) => texto(s).match(/\d{5,}/g) ?? []

/**
 * Qué queda en un campo cuando el cliente ya existe.
 *
 * Devuelve `{ valor, motivo }`. El motivo es lo que sale en el CSV, para que la
 * decisión se pueda auditar sin leer este archivo.
 *
 * La regla de fondo es una sola: **nunca escribir algo que pierda información
 * que ya estaba**. Lo demás son las formas que toma esa pérdida, que no son
 * obvias — hay campos que guardan varias cosas juntas y ahí comparar la cadena
 * entera no alcanza:
 *
 *   · `notas` es zona + datos de entrega + lo que anotó la oficina. La zona del
 *     listado viene cortada por el ancho de la columna del PDF y las partes
 *     salen en otro orden, así que la cadena nueva no es prefijo de la vieja y
 *     "parece" un dato más nuevo. Medido: 959 fichas perderían texto de la zona.
 *   · `email` puede tener varias direcciones. Medido: 31 fichas perderían una
 *     dirección entera, y en 890 el listado las conserva todas y sólo cambia el
 *     separador.
 *   · `telefono` viene reformateado —sin el 0 de la característica, unido con
 *     guiones— y a veces suma números y a veces pierde uno.
 */
function fusionar(campo, viejo, nuevo) {
  const v = texto(viejo)
  const n = texto(nuevo)

  if (n === '') return { valor: v, motivo: 'el listado no dice nada' }
  if (v === '') return { valor: n, motivo: 'completa un campo vacío' }
  if (v === n) return { valor: v, motivo: 'igual' }

  // El archivo no la mejora nunca y la empeora 1.116 veces.
  if (campo === 'razon_social') {
    return { valor: v, motivo: 'la razón social no se pisa nunca' }
  }

  // Sólo cambió cómo está escrito: gana el listado, que viene normalizado.
  if (aplanar(v) === aplanar(n)) {
    // Salvo cuando lo único que agrega es una barra. La columna Contacto del
    // PDF corta a los 25 caracteres y el extractor pega el sobrante con " | ",
    // así que esa barra no separa dos datos: parte el nombre al medio. Medido:
    // 27 fichas, y en las 27 el contenido es idéntico —lo dice el `aplanar` de
    // arriba— o sea que escribirlo no suma un solo carácter, sólo lo rompe.
    // "JL.LOMBARDO/J.MARCOVECHIO" quedaría "JL.LOMBARDO/J.MARCOVECHI | O".
    if (n.split('|').length > v.split('|').length) {
      return { valor: v, motivo: 'el listado sólo parte el nombre con el corte del PDF' }
    }
    return { valor: n, motivo: 'lo mismo, mejor escrito' }
  }

  // Las notas no se reescriben. Adentro va la zona, y la zona del listado viene
  // cortada por el ancho de la columna del PDF. Completar sí, pisar no.
  if (campo === 'notas') {
    return { valor: v, motivo: 'las notas sólo se completan, no se pisan' }
  }

  // El teléfono es el único campo donde el listado sistemáticamente SUMA: trae
  // números que la ficha no tenía. Pero también reescribe el formato —saca el 0
  // de la característica, junta con guiones— así que la cadena vieja nunca está
  // adentro de la nueva y la regla de abajo lo rechazaría siempre.
  //
  // Se acepta cuando se puede demostrar que no pierde: que la ficha no tenga
  // letras —ahí hay anotaciones como "FAX", "casa", un nombre, que el listado
  // no trae— y que cada tirada de números de la ficha esté en la nueva.
  if (campo === 'telefono') {
    const sinLetras = !/[a-záéíóúñü]/i.test(v)
    const estanTodos = numeros(v).every((t) => digitos(n).includes(t))
    // `numeros` pide cinco dígitos seguidos, y hay fichas donde ningún número
    // llega a eso porque están escritos con guiones cada cuatro —"4635-4247"—.
    // Ahí el `every` no comprueba NADA y da true por vacío: medido, 59 de las
    // 127 aceptaciones pasaban así, y en 2 de ellas el listado se comía un
    // teléfono entero. Esta segunda vuelta mira tiradas de cuatro, y le tolera
    // el 0 de la característica, que el listado saca a propósito.
    const sinPerder = (texto(v).match(/\d{4,}/g) ?? []).every(
      (t) => digitos(n).includes(t) || (t[0] === '0' && digitos(n).includes(t.replace(/^0+/, ''))),
    )
    if (sinLetras && estanTodos && sinPerder) {
      return { valor: n, motivo: 'el listado suma un número' }
    }
    return { valor: v, motivo: 'el listado pierde un número o una anotación' }
  }

  // Para todo lo demás la regla es una sola y se puede comprobar: el listado
  // gana SÓLO si adentro está todo lo que ya había. Cada parte por separado,
  // porque el listado corta parte por parte.
  const cabeTodo = partes(v).every((p) => aplanar(n).includes(aplanar(p)))
  if (cabeTodo) return { valor: n, motivo: 'el listado agrega' }

  return { valor: v, motivo: 'el listado dice otra cosa y no la contiene' }
}

// ── Escritura ───────────────────────────────────────────────────────────────

async function guardar(filas) {
  const url = `${env.SUPABASE_URL}/rest/v1/clientes?on_conflict=codigo`
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      ...cabeceras,
      // Sólo se mandan las columnas que este script maneja, así que el upsert
      // no toca cuit, documento, activo, vendedor_id ni provisorio: las deja
      // como están en las que ya existen, y con su default en las nuevas.
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(filas),
  })
  if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 300)}`)
}

// ── Programa ────────────────────────────────────────────────────────────────

const { filas, repetidos } = await leerListado(ARCHIVO)
console.log(`\n  Listado: ${filas.length} clientes${repetidos.length ? ` (${repetidos.length} códigos repetidos, se usó el primero)` : ''}`)

const base = await bajarPadron()
console.log(`  Padrón:  ${base.size} clientes cargados\n`)

const altas = []
const cambios = []
const detalle = []
const motivos = new Map()

/**
 * Celdas que se reescriben sin cambiar de contenido, sólo con los espacios de
 * adentro colapsados.
 *
 * No salen en el CSV, y con razón: el CSV lista las DECISIONES de la fusión, y
 * acá no se decidió nada. Pero el upsert manda la fila entera, así que esas
 * celdas sí viajan, y el resumen tiene que decirlo o el que revisa el CSV cree
 * que quedaron intactas.
 */
let soloEspacios = 0

/**
 * Cómo queda CADA cliente después de la depuración, esté o no cambiando.
 *
 * Es lo que sale por `--todos`: la foto del padrón como va a quedar, con los
 * 16.495 del listado más los que están cargados y el listado no trae.
 */
const finales = new Map()

for (const fila of filas) {
  const actual = base.get(fila.codigo)

  if (!actual) {
    altas.push(fila)
    finales.set(fila.codigo, { ...fila, estado: 'alta' })
    detalle.push({
      accion: 'alta',
      escribe: 'sí',
      codigo: fila.codigo,
      campo: '',
      base: '',
      listado: fila.razon_social,
      queda: fila.razon_social,
      motivo: 'no estaba en el padrón',
    })
    continue
  }

  const fusionada = { codigo: fila.codigo }
  let toco = false
  let espaciosDeEstaFicha = 0

  for (const campo of CAMPOS) {
    const antes = texto(actual[campo])
    const dice = texto(fila[campo])
    const { valor, motivo } = fusionar(campo, actual[campo], fila[campo])
    fusionada[campo] = valor === '' ? null : valor

    const escribe = valor !== antes
    if (escribe) toco = true

    // `antes` ya pasó por texto(). Contra el valor CRUDO de la base puede haber
    // diferencia aunque `escribe` sea falso: son los espacios dobles.
    if (!escribe && valor !== String(actual[campo] ?? '')) espaciosDeEstaFicha++

    /**
     * Al CSV va lo que se escribe, y TAMBIÉN lo que se decidió no escribir
     * cuando el listado traía algo que la ficha no tiene.
     *
     * Esto último es lo único de los rechazos que vale la pena mirar a mano: un
     * recorte del PDF no aporta nada y son miles, pero una mudanza, un teléfono
     * nuevo o un contacto que cambió sí, y si no sale acá no sale en ningún
     * lado. La primera versión de este archivo decía "mirá el CSV" en el motivo
     * de esos casos y no los escribía: el informe mandaba a un lugar vacío.
     */
    const traeAlgoNuevo =
      dice !== '' && trozos(dice).some((p) => !aplanar(antes).includes(aplanar(p)))
    if (escribe || traeAlgoNuevo) {
      detalle.push({
        accion: escribe ? 'cambio' : 'sin aplicar',
        escribe: escribe ? 'sí' : 'no',
        codigo: fila.codigo,
        campo,
        base: antes,
        listado: dice,
        queda: valor,
        motivo,
      })
    }

    if (motivo !== 'igual' && dice !== antes) {
      motivos.set(`${campo} · ${motivo}`, (motivos.get(`${campo} · ${motivo}`) ?? 0) + 1)
    }
  }

  // Sólo cuentan las de las fichas que se escriben: en las que quedan igual, la
  // fila no viaja y el espacio doble se queda donde está.
  if (toco) {
    cambios.push(fusionada)
    soloEspacios += espaciosDeEstaFicha
  }

  finales.set(fila.codigo, {
    ...fusionada,
    codigo: fila.codigo,
    estado: toco ? 'se completa' : 'ya estaba',
  })
}

const enElListado = new Set(filas.map((f) => f.codigo))
const bajas = [...base.keys()].filter((c) => !enElListado.has(c))

// Los que están cargados y el listado no trae siguen siendo clientes: van a la
// foto con lo que tienen hoy, marcados, porque no se dan de baja solos.
for (const c of bajas) {
  finales.set(c, { ...base.get(c), codigo: c, estado: 'no está en el listado' })
}
const sospechosos = filas.filter((f) => Number(f.codigo) >= CODIGO_SOSPECHOSO_DESDE)

// ── Informe ─────────────────────────────────────────────────────────────────

console.log('  ── Qué haría ─────────────────────────────────────────────')
console.log(`  Altas (están en el listado y no en el padrón) : ${altas.length}`)
console.log(`  Fichas que se completan o corrigen           : ${cambios.length}`)
console.log(`  Sin cambios                                  : ${filas.length - altas.length - cambios.length}`)
console.log()
console.log('  ── Campo por campo ───────────────────────────────────────')
for (const [clave, n] of [...motivos.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(6)}  ${clave}`)
}

if (soloEspacios > 0) {
  console.log()
  console.log(`  Además, ${soloEspacios} celdas se reescriben sólo con los espacios de adentro`)
  console.log('  colapsados, sin cambiar una letra. No están en el CSV porque no hubo nada')
  console.log('  que decidir, pero viajan igual en la escritura.')
}

if (bajas.length) {
  console.log()
  console.log(`  ── ${bajas.length} en el padrón y NO en el listado ────────────────`)
  console.log('  No se dan de baja solas: si alguna está en un recorrido, desaparecería')
  console.log('  del rol sin aviso. Mirala y bajala desde el panel si corresponde.')
  for (const c of bajas.slice(0, 20)) {
    console.log(`    ${c.padStart(6)}  ${base.get(c).razon_social}`)
  }
  if (bajas.length > 20) console.log(`    ... y ${bajas.length - 20} más (están en el CSV)`)
}

if (sospechosos.length) {
  console.log()
  console.log(`  ── ${sospechosos.length} con un código raro (arriba de ${CODIGO_SOSPECHOSO_DESDE}) ──────────`)
  console.log('  Se cargan igual, están en el listado. Pero conviene mirarlos.')
  for (const f of sospechosos) console.log(`    ${f.codigo.padStart(7)}  ${f.razon_social}`)
}

// ── El CSV para revisar ─────────────────────────────────────────────────────

for (const c of bajas) {
  detalle.push({
    accion: 'baja',
    escribe: 'no',
    codigo: c,
    campo: '',
    base: base.get(c).razon_social,
    listado: '',
    queda: base.get(c).razon_social,
    motivo: 'no está en el listado — no se toca',
  })
}

const comilla = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
const salida = path.join(RAIZ, `depuracion-padron.csv`)
fs.writeFileSync(
  salida,
  ['accion;se escribe;codigo;campo;valor en la base;valor en el listado;queda;motivo']
    .concat(
      detalle.map((d) =>
        [d.accion, d.escribe, d.codigo, d.campo, d.base, d.listado, d.queda, d.motivo]
          .map(comilla)
          .join(';'),
      ),
    )
    .join('\r\n') + '\r\n',
  'utf8',
)
console.log(`\n  Detalle línea por línea: ${salida}  (${detalle.length} filas)`)

// ── Las altas, armadas para pegar en el espejo de Google Sheets ─────────────

if (PARA_PLANILLA) {
  /**
   * Las columnas son las primeras cinco del espejo, en el mismo orden. Las que
   * siguen —Latitud, Longitud, Estado y las `_sync_*` ocultas— van vacías a
   * propósito: una fila sin respaldo de código es lo que el sincronizador lee
   * como "esto lo tipeó alguien, es un alta".
   */
  const libro = new ExcelJS.Workbook()
  const hoja = libro.addWorksheet('Pegar en Clientes')

  hoja.addRow(['Código', 'Razón social', 'Dirección', 'Localidad', 'CP'])
  hoja.getRow(1).font = { bold: true }

  for (const f of altas) {
    hoja.addRow([f.codigo, f.razon_social, f.direccion, f.localidad, f.codigo_postal])
  }

  // El código va como texto. Hay clientes "0", "1", "10", y si Google Sheets
  // los toma como números, el orden y la comparación se vuelven un problema —
  // es la misma razón por la que el espejo formatea esa columna así.
  hoja.getColumn(1).numFmt = '@'
  hoja.getColumn(1).width = 10
  hoja.getColumn(2).width = 34
  hoja.getColumn(3).width = 34
  hoja.getColumn(4).width = 24
  hoja.getColumn(5).width = 10

  const destino = path.join(RAIZ, 'altas-para-la-planilla.xlsx')
  await libro.xlsx.writeFile(destino)

  console.log(`\n  Para la planilla: ${destino}  (${altas.length} altas)`)
  console.log('  Antes que nada, la hoja necesita el Codigo.gs nuevo pegado: sin eso, una')
  console.log('  fila agregada a mano se ignora y la bajada siguiente la borra.')
  console.log('  Después, en la hoja "Clientes", primera fila vacía de abajo de todo:')
  console.log('    · pegá SÓLO las columnas A y B (código y razón social) y sincronizá.')
  console.log(`      Son ${altas.length} altas en una sola pasada, de segundos.`)
  console.log('    · los domicilios, después y de a doscientos: el servidor le pregunta a')
  console.log('      Google por cada uno y son ~0,5 s por fila, contra los 6 minutos que')
  console.log('      le da Apps Script a cada corrida.')
}

// ── El padrón entero, como va a quedar ──────────────────────────────────────

if (TODOS) {
  /**
   * Los mismos clientes que quedarían después de `--aplicar`, en un archivo.
   *
   * Va en dos hojas a propósito. La primera trae todo lo que se sabe de cada
   * cliente y es para mirar. La segunda trae SÓLO las cinco columnas del espejo
   * de Google Sheets, en su orden, porque pegar la primera en la hoja correría
   * las columnas: de la F en adelante el espejo tiene Latitud, Longitud, Estado
   * y las `_sync_*` ocultas, y pisarlas rompe la detección de ediciones.
   */
  const libro = new ExcelJS.Workbook()
  libro.title = 'Padrón WoodTools — foto completa'
  libro.description =
    'Los 16.496 clientes como quedan después de la depuración. Es para mirar, no ' +
    'para cargar: para cargar están --aplicar (la base) o --planilla (las altas).'

  const orden = [...finales.keys()].sort((a, b) => {
    const na = Number(a)
    const nb = Number(b)
    if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb
    return String(a).localeCompare(String(b))
  })

  const completa = libro.addWorksheet('Padrón completo')
  completa.addRow([
    'Código', 'Razón social', 'Nombre fantasía', 'Dirección', 'Localidad', 'CP',
    'Contacto', 'Teléfonos', 'Mail', 'Notas', 'Estado',
  ])
  completa.getRow(1).font = { bold: true }

  // El nombre NO puede ser una orden. Este archivo viaja por mail y por Drive
  // sin la consola donde salió el aviso, y una hoja llamada "Pegar en Clientes"
  // con 16.496 filas es una invitación a hacer justo lo que no hay que hacer.
  // La que sí se pega es la de `--planilla`, que trae sólo las altas.
  const espejo = libro.addWorksheet('Columnas del espejo (NO pegar)')
  espejo.addRow(['Código', 'Razón social', 'Dirección', 'Localidad', 'CP'])
  espejo.getRow(1).font = { bold: true }

  for (const codigo of orden) {
    const c = finales.get(codigo)
    const v = (k) => texto(c[k])
    completa.addRow([
      codigo, v('razon_social'), v('nombre_fantasia'), v('direccion'), v('localidad'),
      v('codigo_postal'), v('contacto_nombre'), v('telefono'), v('email'), v('notas'),
      c.estado,
    ])
    espejo.addRow([codigo, v('razon_social'), v('direccion'), v('localidad'), v('codigo_postal')])
  }

  // El código va como texto: hay clientes "0", "1", "10", y si Google Sheets los
  // toma como números el orden y la comparación se vuelven un problema.
  for (const hoja of [completa, espejo]) {
    hoja.getColumn(1).numFmt = '@'
    hoja.getColumn(1).width = 10
    hoja.getColumn(2).width = 34
    hoja.views = [{ state: 'frozen', ySplit: 1 }]
  }
  completa.getColumn(3).width = 24
  completa.getColumn(4).width = 34
  completa.getColumn(5).width = 22
  completa.getColumn(7).width = 24
  completa.getColumn(8).width = 26
  completa.getColumn(9).width = 30
  completa.getColumn(10).width = 40
  completa.getColumn(11).width = 20
  espejo.getColumn(3).width = 34
  espejo.getColumn(4).width = 22

  const destino = path.join(RAIZ, 'padron-completo.xlsx')
  await libro.xlsx.writeFile(destino)

  const cuenta = { alta: 0, 'se completa': 0, 'ya estaba': 0, 'no está en el listado': 0 }
  for (const c of finales.values()) cuenta[c.estado] = (cuenta[c.estado] ?? 0) + 1

  console.log(`
  Padrón completo: ${destino}  (${finales.size} clientes)`)
  console.log(`    · ${cuenta['alta']} altas nuevas`)
  console.log(`    · ${cuenta['se completa']} que se completan o corrigen`)
  console.log(`    · ${cuenta['ya estaba']} que quedan igual`)
  console.log(`    · ${cuenta['no está en el listado']} cargados que el listado no trae`)
  console.log('  OJO: no pegues esto entero en la hoja "Clientes". Las 12.182 fichas que ya')
  console.log('  están volverían como filas nuevas y el servidor geocodificaría cada una:')
  console.log('  son horas de reloj y reescribe todas las direcciones. Para cargar, --aplicar.')
}

// ── Aplicar ─────────────────────────────────────────────────────────────────

if (!APLICAR) {
  console.log('\n  No se escribió nada. Mirá el CSV y, si está bien:')
  console.log(`    node herramientas/depurar-padron.mjs ${ARCHIVO} --aplicar\n`)
  process.exit(0)
}

const aEscribir = [...altas.map((f) => {
  const fila = { codigo: f.codigo }
  for (const campo of CAMPOS) fila[campo] = texto(f[campo]) === '' ? null : texto(f[campo])
  return fila
}), ...cambios]

console.log(`\n  Escribiendo ${aEscribir.length} fichas...`)
let hechas = 0
for (let i = 0; i < aEscribir.length; i += TANDA) {
  await guardar(aEscribir.slice(i, i + TANDA))
  hechas += Math.min(TANDA, aEscribir.length - i)
  if ((i / TANDA) % 5 === 0 || hechas === aEscribir.length) {
    console.log(`    ${hechas} / ${aEscribir.length}`)
  }
}

console.log(`\n  Listo. ${altas.length} altas y ${cambios.length} fichas completadas.`)
console.log('  Las bajas, si las había, siguen activas: se hacen a mano desde el panel.\n')
