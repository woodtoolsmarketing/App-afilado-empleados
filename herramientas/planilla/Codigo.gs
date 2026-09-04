/**
 * WoodTools · Espejo del padrón de clientes en Google Sheets
 * ---------------------------------------------------------------------------
 * Este código va pegado DENTRO de la planilla (Extensiones → Apps Script).
 *
 * Qué hace
 *   · Baja de la base los 16.000 y pico de clientes con su ubicación.
 *   · Si alguien edita una dirección o unas coordenadas acá, las sube.
 *   · Si alguien agrega una fila con un código nuevo, da de alta al cliente.
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
 *
 * Cómo se da de alta un cliente
 *   Agregando una fila abajo de todo con el código y la razón social. El código
 *   tiene que ser EL DEL GESTIÓN: es lo que después une esta carga con la del
 *   listado, cuando el importador traiga esa ficha con el CUIT y el teléfono.
 *
 *   La fila tipeada a mano se reconoce porque no tiene puesto su respaldo de
 *   código —la columna oculta `_sync_codigo`—, que sólo lo escribe la bajada.
 *   Antes se miraba si estaban vacíos los respaldos de dirección y coordenadas,
 *   y eso confundía dos cosas distintas: los 129 clientes del padrón que no
 *   tienen domicilio bajan con esos dos respaldos vacíos, y quedaban excluidos
 *   de la detección de ediciones igual que una fila nueva.
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
  '_sync_codigo',
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
  syncCodigo: 11,
}

/**
 * Los dos únicos valores que la bajada escribe en la columna Estado.
 *
 * Son el espejo de lo que arma el servidor en
 * `supabase/functions/planilla/index.ts` al responder "leer". Están acá porque
 * el sellado los usa para reconocer una fila que bajó de la base, y si allá
 * cambian y acá no, el sellado no reconoce ninguna fila y manda el padrón
 * entero como altas. Es el peor modo de falla del archivo: vale el acoplamiento
 * con tal de que quede escrito por qué.
 */
var ESTADO_UBICADO = 'Ubicado'
var ESTADO_SIN_UBICAR = 'Sin ubicar'

/** Las cuatro últimas son técnicas: se ocultan para que nadie las toque. */
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
  var bajados = bajarPadron(hoja, subidos.pendientes)

  // El resumen dice SIEMPRE cuántas ediciones se detectaron y cuántas se
  // aplicaron, incluso cuando son cero. Si sólo se informara el caso con
  // cambios, "no subí nada" se vería igual que "todo bien", y una edición que
  // no llegó a la base es justo lo que hay que enterarse enseguida.
  var mensaje =
    'Cambios detectados en la planilla: ' +
    subidos.detectadas +
    '\n  · de los cuales, clientes nuevos: ' +
    subidos.altas +
    '\nSubidos a la base: ' +
    subidos.aplicados +
    '\nClientes bajados: ' +
    bajados

  // "No se detectó ningún cambio" sólo cuando de verdad no había NADA: si hay
  // filas que quedaron pendientes, sí había algo, y decir lo contrario es
  // justamente el cartel que hacía creer que el cliente se había cargado.
  if (subidos.detectadas === 0 && subidos.pendientes.length === 0) {
    mensaje +=
      '\n\nNo se detectó ningún cambio. Se pueden editar Dirección, ' +
      'Localidad, CP, Latitud y Longitud, y se puede agregar una fila abajo de ' +
      'todo con el código y la razón social para dar de alta un cliente. Si ' +
      'hiciste algo de eso y no aparece acá, avisá: puede ser un problema del ' +
      'sincronizador.'
  }

  if (subidos.pendientes.length > 0) {
    mensaje +=
      '\n\nQuedaron ' +
      subidos.pendientes.length +
      ' fila(s) sin cargar. No se borraron: están abajo de todo, con el motivo ' +
      'en la columna Estado. Corregilas y volvé a sincronizar.'
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

  // Se compara el encabezado ENTERO, no sólo la primera celda. Con la primera
  // alcanzaba mientras las columnas no cambiaran; cuando se agregó
  // `_sync_codigo`, una planilla ya instalada seguía teniendo el encabezado
  // viejo y la columna nueva quedaba sin nombre. Comparar todo hace que la
  // planilla se actualice sola al pegar una versión nueva de este código.
  if (hoja.getMaxColumns() < TOTAL_COLUMNAS) {
    hoja.insertColumnsAfter(hoja.getMaxColumns(), TOTAL_COLUMNAS - hoja.getMaxColumns())
  }

  var encabezado = hoja.getRange(1, 1, 1, TOTAL_COLUMNAS)
  var actual = encabezado.getValues()[0]
  var iguales = true
  for (var i = 0; i < TOTAL_COLUMNAS; i++) {
    if (String(actual[i]) !== COLUMNAS[i]) iguales = false
  }

  if (!iguales) {
    encabezado.setValues([COLUMNAS])
    encabezado.setFontWeight('bold')
    hoja.setFrozenRows(1)
    sellarFilasQueYaBajaron(hoja)
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

/**
 * Le pone el respaldo de código a las filas que ya estaban bajadas.
 *
 * Corre UNA sola vez: cuando se pega esta versión del código sobre una planilla
 * que ya venía funcionando, `_sync_codigo` es una columna recién creada y está
 * vacía en todas las filas. Sin esto, la primera sincronización tomaría el
 * padrón ENTERO como filas nuevas y se lo mandaría al servidor — miles de
 * consultas a Google y una reescritura de todas las direcciones.
 *
 * Cuál fila ya bajó de la base se sabe por la columna Estado: la escribe la
 * bajada en todas, incluso en los 129 clientes sin domicilio, que son los que
 * bajan con los respaldos de dirección y coordenadas vacíos. Una fila tipeada a
 * mano no tiene Estado, así que sobrevive como alta y se carga igual.
 */
function sellarFilasQueYaBajaron(hoja) {
  var ultima = hoja.getLastRow()
  if (ultima < 2) return

  var codigos = hoja.getRange(2, COL.codigo + 1, ultima - 1, 1).getValues()
  var estados = hoja.getRange(2, COL.estado + 1, ultima - 1, 1).getValues()
  var sellos = hoja.getRange(2, COL.syncCodigo + 1, ultima - 1, 1).getValues()

  var sellados = 0
  for (var i = 0; i < codigos.length; i++) {
    if (texto(sellos[i][0]) !== '') continue
    if (texto(codigos[i][0]) === '') continue

    // Sólo se sella lo que escribió la bajada. Cualquier otro texto en Estado es
    // el motivo de un alta rechazada, o una nota que alguien dejó ahí, y esa
    // fila NO bajó de la base: si se sellara, la próxima sincronización la
    // mandaría como corrección —o sea, sin razón social—, el servidor la
    // rechazaría por código nuevo sin razón social, y la bajada la borraría.
    // Justo después de que la oficina completó lo que el cartel le pidió.
    var estado = texto(estados[i][0])
    if (estado !== ESTADO_UBICADO && estado !== ESTADO_SIN_UBICAR) continue

    sellos[i][0] = texto(codigos[i][0])
    sellados++
  }

  if (sellados > 0) {
    hoja.getRange(2, COL.syncCodigo + 1, ultima - 1, 1).setValues(sellos)
  }
  Logger.log('Filas selladas como ya bajadas: ' + sellados)
}

/** Manda a la base lo que alguien haya editado a mano en la planilla. */
function subirEdiciones(hoja) {
  var vacio = { detectadas: 0, altas: 0, aplicados: 0, problemas: [], pendientes: [] }

  var ultima = hoja.getLastRow()
  if (ultima < 2) return vacio

  var datos = hoja.getRange(2, 1, ultima - 1, TOTAL_COLUMNAS).getValues()
  var cambios = []
  var altas = 0
  /** Las filas nuevas, guardadas enteras por si el servidor las rechaza. */
  var filaDelAlta = {}
  /** Las que tienen algo escrito pero les falta el código. */
  var sinCodigo = []

  for (var i = 0; i < datos.length; i++) {
    var f = datos[i]
    var codigo = texto(f[COL.codigo])

    if (!codigo) {
      // Una fila con algo escrito y sin código no se puede mandar —el código es
      // la clave— pero tampoco se puede tirar en silencio: la bajada reescribe
      // la hoja y la borraría, que es exactamente la desaparición que este
      // cambio vino a sacar. Se guarda y se devuelve abajo de todo con el
      // motivo, igual que un alta rechazada.
      if (texto(f[COL.razon]) !== '' || texto(f[COL.direccion]) !== '') {
        sinCodigo.push({
          fila: f,
          motivo: 'Falta el código del cliente: ponelo en la primera columna',
        })
      }
      continue
    }

    // Sin respaldo de código, la fila no bajó de la base: la tipeó alguien, y
    // es un alta. El respaldo lo escribe únicamente `bajarPadron`, así que no
    // hay forma de que una fila del padrón llegue acá sin él.
    var esAlta = texto(f[COL.syncCodigo]) === ''

    if (esAlta) {
      altas++
      filaDelAlta[codigo] = f
      cambios.push({
        codigo: codigo,
        razon_social: texto(f[COL.razon]),
        direccion: texto(f[COL.direccion]),
        localidad: texto(f[COL.localidad]),
        codigo_postal: texto(f[COL.cp]),
        lat: numero(f[COL.lat]),
        lng: numero(f[COL.lng]),
      })
      continue
    }

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
      lat: numero(f[COL.lat]),
      lng: numero(f[COL.lng]),
    })
  }

  Logger.log('Ediciones detectadas: ' + cambios.length + ' (altas: ' + altas + ')')

  // Aunque no haya nada que mandar puede haber filas sin código para devolver:
  // es el caso típico, la oficina tipea un cliente y nada más. Sin esto se
  // perdían por este return, que es justo el camino más probable.
  if (cambios.length === 0) {
    return { detectadas: 0, altas: 0, aplicados: 0, problemas: [], pendientes: sinCodigo }
  }

  // De a 500, que es lo que acepta la función del servidor.
  var aplicados = 0
  var problemas = []
  var seAplico = {}
  for (var j = 0; j < cambios.length; j += 500) {
    var r = llamar({ operacion: 'guardar', filas: cambios.slice(j, j + 500) })
    aplicados += r.aplicados || 0
    if (r.problemas) problemas = problemas.concat(r.problemas)
    if (r.codigos) {
      for (var k = 0; k < r.codigos.length; k++) seAplico[r.codigos[k]] = true
    }
  }

  // El alta que el servidor NO aceptó no puede desaparecer: la bajada reescribe
  // la hoja entera desde la base, y esa fila no está en la base. Se la guarda
  // para volver a escribirla abajo de todo, con el motivo a la vista. Así el
  // que la tipeó ve qué le faltó en vez de encontrarse la fila borrada.
  var pendientes = sinCodigo.slice()
  var motivoDe = {}
  for (var m = 0; m < problemas.length; m++) motivoDe[problemas[m].codigo] = problemas[m].motivo

  for (var cod in filaDelAlta) {
    if (seAplico[cod]) continue
    pendientes.push({
      fila: filaDelAlta[cod],
      motivo: motivoDe[cod] || 'No se pudo dar de alta',
    })
  }

  return {
    detectadas: cambios.length,
    altas: altas,
    aplicados: aplicados,
    problemas: problemas,
    pendientes: pendientes,
  }
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

/**
 * Trae el padrón completo y reescribe la planilla.
 *
 * `pendientes` son las altas que el servidor no aceptó. Van abajo de todo, con
 * el motivo en la columna Estado y sin respaldo de código, así que la próxima
 * sincronización las vuelve a intentar. Corregís lo que faltaba y salen solas.
 */
function bajarPadron(hoja, pendientes) {
  pendientes = pendientes || []

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
      // Y el del código, que es lo que distingue una fila que bajó de la base
      // de una que tipeó alguien.
      c.codigo,
    ]
  })

  for (var i = 0; i < pendientes.length; i++) {
    var f = pendientes[i].fila
    matriz.push([
      f[COL.codigo],
      f[COL.razon],
      f[COL.direccion],
      f[COL.localidad],
      f[COL.cp],
      f[COL.lat],
      f[COL.lng],
      pendientes[i].motivo,
      // Los cuatro respaldos van vacíos a propósito: la fila sigue siendo un
      // alta pendiente, no una fila del padrón.
      '',
      '',
      '',
      '',
    ])
  }

  // Una planilla nueva trae 1.000 filas y el padrón tiene 16.496. Pedir un
  // rango más grande que la hoja no la agranda: tira "Those rows are out of
  // bounds" y corta la sincronización a la mitad. Se agranda a mano primero.
  var necesarias = matriz.length + 1
  if (hoja.getMaxRows() < necesarias) {
    hoja.insertRowsAfter(hoja.getMaxRows(), necesarias - hoja.getMaxRows())
  }

  var ultima = hoja.getLastRow()
  if (ultima > necesarias) {
    hoja.deleteRows(necesarias + 1, ultima - necesarias)
  }

  hoja.getRange(2, 1, matriz.length, TOTAL_COLUMNAS).setValues(matriz)

  return filas.length
}

/** Normaliza para comparar: Sheets devuelve a veces número y a veces texto. */
function texto(v) {
  if (v === null || v === undefined || v === '') return ''
  return String(v).trim()
}
