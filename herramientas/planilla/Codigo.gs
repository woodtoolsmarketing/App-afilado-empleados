/**
 * WoodTools · Espejo del padrón de clientes en Google Sheets
 * ---------------------------------------------------------------------------
 * Este código va pegado DENTRO de la planilla (Extensiones → Apps Script).
 *
 * Qué hace
 *   · Baja de la base los 12.000 y pico de clientes con su ubicación.
 *   · Si alguien edita una dirección o unas coordenadas acá, las sube.
 *   · Corre solo cada tanto, y también a mano desde el menú "WoodTools".
 *
 * Cómo decide quién gana
 *   Supabase es la fuente de verdad y la planilla es un espejo que además se
 *   puede editar. Para distinguir "esto lo cambió una persona" de "esto quedó
 *   viejo", cada fila guarda al final —en columnas ocultas— el último valor que
 *   bajó de la base. Si lo que hay en la celda difiere de ese respaldo, hubo
 *   una edición humana y gana la planilla. Si coincide, gana la base.
 *
 *   Sin ese respaldo habría que elegir entre dos males: pisar siempre lo que
 *   escribe la oficina, o pisar siempre lo que carga el vendedor desde la
 *   calle. Con él, cada cambio real se respeta una sola vez y de un solo lado.
 *
 * Qué se puede editar
 *   Dirección, Localidad, CP, Latitud y Longitud. El resto baja de la base y se
 *   sobrescribe en cada sincronización.
 *
 *   Si escribís una dirección y dejás lat/lng vacías, el servidor la busca en
 *   Google y completa las coordenadas solo. Si escribís lat/lng a mano, mandan
 *   ésas y no se consulta a Google.
 */

// ── Configuración ───────────────────────────────────────────────────────────
// Se guardan con el menú "WoodTools → Configurar", no acá: si estuvieran
// escritas en el código quedarían a la vista de cualquiera que abra el editor.

var HOJA = 'Clientes'

var COLUMNAS = [
  'Código',
  'Razón social',
  'Dirección',
  'Localidad',
  'CP',
  'Latitud',
  'Longitud',
  'Estado',
  '_sync_dir',
  '_sync_lat',
  '_sync_lng',
]

var COL = {
  codigo: 0,
  razon: 1,
  direccion: 2,
  localidad: 3,
  cp: 4,
  lat: 5,
  lng: 6,
  estado: 7,
  syncDir: 8,
  syncLat: 9,
  syncLng: 10,
}

/** Las tres últimas son técnicas: se ocultan para que nadie las toque. */
var PRIMERA_TECNICA = COL.syncDir + 1
var TOTAL_COLUMNAS = COLUMNAS.length

// ── Menú ────────────────────────────────────────────────────────────────────

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('WoodTools')
    .addItem('Sincronizar ahora', 'sincronizar')
    .addSeparator()
    .addItem('Configurar conexión', 'configurar')
    .addItem('Sincronizar cada 15 minutos', 'activarAutomatico')
    .addItem('Dejar de sincronizar solo', 'desactivarAutomatico')
    .addToUi()
}

function configurar() {
  var ui = SpreadsheetApp.getUi()
  var props = PropertiesService.getScriptProperties()

  var url = ui.prompt(
    'Conexión con WoodTools (1 de 2)',
    'Pegá la URL de la función:',
    ui.ButtonSet.OK_CANCEL,
  )
  if (url.getSelectedButton() !== ui.Button.OK) return

  var secreto = ui.prompt(
    'Conexión con WoodTools (2 de 2)',
    'Pegá la clave de acceso:',
    ui.ButtonSet.OK_CANCEL,
  )
  if (secreto.getSelectedButton() !== ui.Button.OK) return

  props.setProperty('URL_FUNCION', url.getResponseText().trim())
  props.setProperty('SECRETO', secreto.getResponseText().trim())

  ui.alert('Listo', 'Ya podés usar "Sincronizar ahora".', ui.ButtonSet.OK)
}

function activarAutomatico() {
  desactivarAutomatico()
  ScriptApp.newTrigger('sincronizar').timeBased().everyMinutes(15).create()
  SpreadsheetApp.getUi().alert('Listo. Se va a sincronizar sola cada 15 minutos.')
}

function desactivarAutomatico() {
  var triggers = ScriptApp.getProjectTriggers()
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'sincronizar') {
      ScriptApp.deleteTrigger(triggers[i])
    }
  }
}

// ── Llamadas al servidor ────────────────────────────────────────────────────

function llamar(cuerpo) {
  var props = PropertiesService.getScriptProperties()
  var url = props.getProperty('URL_FUNCION')
  var secreto = props.getProperty('SECRETO')

  if (!url || !secreto) {
    throw new Error('Falta configurar la conexión. Usá "WoodTools → Configurar conexión".')
  }

  var respuesta = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-planilla-secreto': secreto },
    payload: JSON.stringify(cuerpo),
    muteHttpExceptions: true,
  })

  var texto = respuesta.getContentText()
  var codigo = respuesta.getResponseCode()

  if (codigo !== 200) {
    var motivo = texto
    try {
      motivo = JSON.parse(texto).error || texto
    } catch (e) {
      // La respuesta no era JSON: mostramos el texto crudo, que igual sirve.
    }
    throw new Error('El servidor respondió ' + codigo + ': ' + motivo)
  }

  return JSON.parse(texto)
}

// ── Sincronización ──────────────────────────────────────────────────────────

function sincronizar() {
  var hoja = prepararHoja()
  var subidos = subirEdiciones(hoja)
  var bajados = bajarPadron(hoja)

  // El resumen dice SIEMPRE cuántas ediciones se detectaron y cuántas se
  // aplicaron, incluso cuando son cero. Si sólo se informara el caso con
  // cambios, "no subí nada" se vería igual que "todo bien", y una edición que
  // no llegó a la base es justo lo que hay que enterarse enseguida.
  var mensaje =
    'Ediciones detectadas en la planilla: ' +
    subidos.detectadas +
    '\nSubidas a la base: ' +
    subidos.aplicados +
    '\nClientes bajados: ' +
    bajados

  if (subidos.detectadas === 0) {
    mensaje +=
      '\n\nNo se detectó ninguna edición. Se pueden editar Dirección, ' +
      'Localidad, CP, Latitud y Longitud. Si cambiaste algo y no aparece acá, ' +
      'avisá: puede ser un problema del sincronizador.'
  }

  if (subidos.problemas.length > 0) {
    mensaje += '\n\nNo se pudieron aplicar ' + subidos.problemas.length + ':\n'
    mensaje += subidos.problemas
      .slice(0, 10)
      .map(function (p) {
        return '  · ' + p.codigo + ': ' + p.motivo
      })
      .join('\n')
  }

  // Cuando corre por el disparador de tiempo no hay nadie mirando, y llamar a
  // la interfaz desde ahí tira error. Por eso se intenta y se deja pasar.
  try {
    SpreadsheetApp.getUi().alert('Sincronización terminada', mensaje, SpreadsheetApp.getUi().ButtonSet.OK)
  } catch (e) {
    Logger.log(mensaje)
  }
}

/** Crea la hoja y los encabezados si no existen, y deja todo con el formato justo. */
function prepararHoja() {
  var libro = SpreadsheetApp.getActiveSpreadsheet()
  var hoja = libro.getSheetByName(HOJA)

  if (!hoja) {
    hoja = libro.insertSheet(HOJA)
  }

  var encabezado = hoja.getRange(1, 1, 1, TOTAL_COLUMNAS)
  if (String(hoja.getRange(1, 1).getValue()) !== COLUMNAS[0]) {
    encabezado.setValues([COLUMNAS])
    encabezado.setFontWeight('bold')
    hoja.setFrozenRows(1)
  }

  // El código va como texto: hay clientes "0", "1", "10", y si Sheets los toma
  // como números el orden y la comparación se vuelven un problema.
  hoja.getRange(2, COL.codigo + 1, hoja.getMaxRows() - 1, 1).setNumberFormat('@')
  hoja
    .getRange(2, COL.lat + 1, hoja.getMaxRows() - 1, 2)
    .setNumberFormat('0.0000000')

  hoja.hideColumns(PRIMERA_TECNICA, TOTAL_COLUMNAS - PRIMERA_TECNICA + 1)

  return hoja
}

/** Manda a la base lo que alguien haya editado a mano en la planilla. */
function subirEdiciones(hoja) {
  var ultima = hoja.getLastRow()
  if (ultima < 2) return { detectadas: 0, aplicados: 0, problemas: [] }

  var datos = hoja.getRange(2, 1, ultima - 1, TOTAL_COLUMNAS).getValues()
  var cambios = []

  for (var i = 0; i < datos.length; i++) {
    var f = datos[i]
    var codigo = texto(f[COL.codigo])
    if (!codigo) continue

    // Si la fila nunca se sincronizó no hay respaldo contra el cual comparar, y
    // tomarla como editada haría que la primera corrida subiera el padrón
    // entero. Se saltea: la próxima bajada le deja el respaldo puesto.
    if (texto(f[COL.syncDir]) === '' && texto(f[COL.syncLat]) === '') continue

    var editada =
      texto(f[COL.direccion]) !== texto(f[COL.syncDir]) ||
      // Las coordenadas se comparan como número: la planilla puede devolver
      // -34.6512 o "-34,6512" según el formato de la celda, y comparar el texto
      // crudo daría por editada una fila que nadie tocó.
      !mismoNumero(f[COL.lat], f[COL.syncLat]) ||
      !mismoNumero(f[COL.lng], f[COL.syncLng])

    if (!editada) continue

    cambios.push({
      codigo: codigo,
      direccion: texto(f[COL.direccion]),
      localidad: texto(f[COL.localidad]),
      codigo_postal: texto(f[COL.cp]),
      lat: f[COL.lat],
      lng: f[COL.lng],
    })
  }

  Logger.log('Ediciones detectadas: ' + cambios.length)
  if (cambios.length === 0) return { detectadas: 0, aplicados: 0, problemas: [] }

  // De a 500, que es lo que acepta la función del servidor.
  var aplicados = 0
  var problemas = []
  for (var j = 0; j < cambios.length; j += 500) {
    var r = llamar({ operacion: 'guardar', filas: cambios.slice(j, j + 500) })
    aplicados += r.aplicados || 0
    if (r.problemas) problemas = problemas.concat(r.problemas)
  }

  return { detectadas: cambios.length, aplicados: aplicados, problemas: problemas }
}

/** Dos celdas representan el mismo número (o las dos están vacías). */
function mismoNumero(a, b) {
  var na = numero(a)
  var nb = numero(b)
  if (na === null && nb === null) return true
  if (na === null || nb === null) return false
  // Siete decimales es la precisión con la que se guardan; más abajo de eso
  // es ruido de formato, no una corrección de nadie.
  return Math.abs(na - nb) < 0.0000001
}

function numero(v) {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number') return v
  var n = parseFloat(String(v).trim().replace(',', '.'))
  return isNaN(n) ? null : n
}

/** Trae el padrón completo y reescribe la planilla. */
function bajarPadron(hoja) {
  var filas = []
  var desde = 0

  while (true) {
    var r = llamar({ operacion: 'leer', desde: desde, cantidad: 2000 })
    filas = filas.concat(r.filas)
    desde += r.filas.length
    if (r.filas.length === 0 || desde >= r.total) break
  }

  if (filas.length === 0) return 0

  var matriz = filas.map(function (c) {
    return [
      c.codigo,
      c.razon_social,
      c.direccion,
      c.localidad,
      c.codigo_postal,
      c.lat,
      c.lng,
      c.estado,
      // El respaldo se escribe con el mismo valor que la celda visible: a
      // partir de acá, cualquier diferencia entre las dos es una edición.
      c.direccion,
      c.lat,
      c.lng,
    ]
  })

  // Una planilla nueva trae 1.000 filas y el padrón tiene 12.181. Pedir un
  // rango más grande que la hoja no la agranda: tira "Those rows are out of
  // bounds" y corta la sincronización a la mitad. Se agranda a mano primero.
  var necesarias = matriz.length + 1
  if (hoja.getMaxRows() < necesarias) {
    hoja.insertRowsAfter(hoja.getMaxRows(), necesarias - hoja.getMaxRows())
  }

  var ultima = hoja.getLastRow()
  if (ultima > filas.length + 1) {
    hoja.deleteRows(filas.length + 2, ultima - filas.length - 1)
  }

  hoja.getRange(2, 1, matriz.length, TOTAL_COLUMNAS).setValues(matriz)

  return matriz.length
}

/** Normaliza para comparar: Sheets devuelve a veces número y a veces texto. */
function texto(v) {
  if (v === null || v === undefined || v === '') return ''
  return String(v).trim()
}
