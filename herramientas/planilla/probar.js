/**
 * Simulador mínimo de Google Apps Script, para probar Codigo.gs fuera de Google.
 *
 *   node herramientas/planilla/probar.js
 *
 * Codigo.gs vive adentro de una planilla y no hay forma de correrlo desde acá,
 * así que cualquier error se descubría recién con la planilla de producción
 * delante. Esto reemplaza la hoja por una matriz en memoria y el servidor por
 * uno de mentira, y después llama a `sincronizar()` igual que el menú.
 *
 * La prueba que justifica el archivo es la primera: una planilla ya instalada,
 * con las once columnas viejas, no tiene que mandar NINGUNA fila la primera vez
 * que se sincroniza con el código nuevo. Si eso falla, las 12.181 filas se van
 * al servidor como si fueran altas.
 */
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const RUTA = path.join(__dirname, 'Codigo.gs')

function hojaFalsa(filas) {
  const celdas = filas.map((f) => f.slice())
  let maxCols = Math.max(...celdas.map((f) => f.length), 1)
  celdas.forEach((f) => {
    while (f.length < maxCols) f.push('')
  })
  let maxRows = celdas.length

  const asegurar = () => {
    while (celdas.length < maxRows) celdas.push(new Array(maxCols).fill(''))
    celdas.forEach((f) => {
      while (f.length < maxCols) f.push('')
    })
  }

  return {
    _celdas: celdas,
    getMaxRows: () => maxRows,
    getMaxColumns: () => maxCols,
    insertRowsAfter: (_d, cuantas) => {
      maxRows += cuantas
      asegurar()
    },
    insertColumnsAfter: (_d, cuantas) => {
      maxCols += cuantas
      asegurar()
    },
    deleteRows: (desde, cuantas) => {
      celdas.splice(desde - 1, cuantas)
      maxRows -= cuantas
      asegurar()
    },
    setFrozenRows: () => {},
    hideColumns: () => {},
    getLastRow: () => {
      for (let i = celdas.length - 1; i >= 0; i--) {
        if (celdas[i].some((v) => v !== '' && v !== null && v !== undefined)) return i + 1
      }
      return 0
    },
    getRange: (fila, col, nFilas, nCols) => {
      nFilas = nFilas === undefined ? 1 : nFilas
      nCols = nCols === undefined ? 1 : nCols
      asegurar()
      return {
        getValues: () => {
          const out = []
          for (let r = 0; r < nFilas; r++) {
            const src = celdas[fila - 1 + r] || new Array(maxCols).fill('')
            out.push(src.slice(col - 1, col - 1 + nCols))
          }
          return out
        },
        setValues: (v) => {
          for (let r = 0; r < v.length; r++) {
            while (celdas.length < fila - 1 + r + 1) celdas.push(new Array(maxCols).fill(''))
            if (celdas.length > maxRows) maxRows = celdas.length
            for (let c = 0; c < v[r].length; c++) {
              celdas[fila - 1 + r][col - 1 + c] = v[r][c]
            }
          }
        },
        setFontWeight: () => {},
        setNumberFormat: () => {},
      }
    },
  }
}

/** Carga Codigo.gs con el entorno de Google reemplazado. */
function cargar(hoja, servidor) {
  const alertas = []
  const contexto = {
    console,
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getSheetByName: () => hoja,
        insertSheet: () => hoja,
      }),
      getUi: () => ({
        alert: (a, b) => alertas.push(String(b === undefined ? a : b)),
        ButtonSet: { OK: 'OK' },
      }),
    },
    Logger: { log: () => {} },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k === 'URL_FUNCION' ? 'https://x' : 'secreto'),
      }),
    },
    UrlFetchApp: null,
    ScriptApp: { getProjectTriggers: () => [] },
  }
  vm.createContext(contexto)
  vm.runInContext(fs.readFileSync(RUTA, 'utf8'), contexto)
  // `llamar` se reemplaza después de cargar: así el resto del archivo queda tal cual.
  contexto.llamar = servidor
  vm.runInContext('llamar = this.llamar || llamar', contexto)
  contexto.__alertas = alertas
  return contexto
}

// ── El servidor de mentira ──────────────────────────────────────────────────

function servidorFalso(padron, opciones) {
  opciones = opciones || {}
  const recibidas = []
  const fn = (cuerpo) => {
    if (cuerpo.operacion === 'leer') {
      const desde = cuerpo.desde || 0
      const trozo = padron.slice(desde, desde + (cuerpo.cantidad || 2000))
      return { filas: trozo, total: padron.length, desde }
    }
    if (cuerpo.operacion === 'guardar') {
      recibidas.push(...cuerpo.filas)
      const codigos = []
      const problemas = []
      for (const f of cuerpo.filas) {
        const existe = padron.some((c) => c.codigo === f.codigo)
        if (!existe) {
          if (!f.razon_social) {
            problemas.push({
              codigo: f.codigo,
              motivo: 'Es un código nuevo y le falta la razón social para darlo de alta',
            })
            continue
          }
          if (opciones.rechazar && opciones.rechazar.includes(f.codigo)) {
            problemas.push({ codigo: f.codigo, motivo: 'Google no encontró esa dirección' })
            continue
          }
          padron.push({
            codigo: f.codigo,
            razon_social: f.razon_social,
            direccion: f.direccion || '',
            localidad: f.localidad || '',
            codigo_postal: f.codigo_postal || '',
            lat: f.lat || '',
            lng: f.lng || '',
            estado: f.direccion ? 'Ubicado' : 'Sin ubicar',
          })
          padron.sort((a, b) => String(a.codigo).localeCompare(String(b.codigo)))
        }
        codigos.push(f.codigo)
      }
      return { aplicados: codigos.length, codigos, problemas }
    }
    throw new Error('operación desconocida')
  }
  fn.recibidas = recibidas
  return fn
}

// ── Las pruebas ─────────────────────────────────────────────────────────────

let fallos = 0
function comprobar(nombre, condicion, detalle) {
  if (condicion) {
    console.log('  OK   ' + nombre)
  } else {
    fallos++
    console.log('  FALLA ' + nombre + (detalle ? '  → ' + detalle : ''))
  }
}

/** Cómo se ve el padrón que devuelve el servidor. */
function clienteBase(codigo, razon, conDireccion) {
  return {
    codigo: codigo,
    razon_social: razon,
    direccion: conDireccion ? 'Calle ' + codigo + ' 100, CABA' : '',
    localidad: conDireccion ? 'CABA' : '',
    codigo_postal: conDireccion ? '1000' : '',
    lat: conDireccion ? -34.6 : '',
    lng: conDireccion ? -58.4 : '',
    estado: conDireccion ? 'Ubicado' : 'Sin ubicar',
  }
}

console.log('\n=== 1. Planilla YA INSTALADA con 11 columnas: el upgrade no debe mandar altas ===')
{
  // 5 clientes con domicilio + 2 sin domicilio (los "129" del padrón real).
  const padron = [
    clienteBase('100', 'UNO SRL', true),
    clienteBase('200', 'DOS SA', true),
    clienteBase('300', 'TRES', true),
    clienteBase('400', 'CUATRO', false),
    clienteBase('500', 'CINCO', false),
  ]
  // La hoja como quedó con la versión vieja: 11 columnas, sin _sync_codigo.
  const filas = [
    ['Código','Razón social','Dirección','Localidad','CP','Latitud','Longitud','Estado','_sync_dir','_sync_lat','_sync_lng'],
  ]
  for (const c of padron) {
    filas.push([c.codigo, c.razon_social, c.direccion, c.localidad, c.codigo_postal, c.lat, c.lng, c.estado, c.direccion, c.lat, c.lng])
  }

  const hoja = hojaFalsa(filas)
  const servidor = servidorFalso(padron.slice())
  const ctx = cargar(hoja, servidor)
  ctx.sincronizar()

  comprobar('no se mandó ninguna fila al servidor', servidor.recibidas.length === 0,
    'mandó ' + servidor.recibidas.length + ': ' + JSON.stringify(servidor.recibidas.map(f => f.codigo)))
  comprobar('el encabezado quedó con 12 columnas',
    hoja.getRange(1, 1, 1, 12).getValues()[0][11] === '_sync_codigo')
  comprobar('las 5 filas quedaron con su respaldo de código',
    hoja.getRange(2, 12, 5, 1).getValues().every((r, i) => String(r[0]) === padron[i].codigo))
}

console.log('\n=== 2. Upgrade con una fila tipeada a mano ANTES: tiene que sobrevivir y darse de alta ===')
{
  const padron = [clienteBase('100', 'UNO SRL', true), clienteBase('200', 'DOS SA', true)]
  const filas = [
    ['Código','Razón social','Dirección','Localidad','CP','Latitud','Longitud','Estado','_sync_dir','_sync_lat','_sync_lng'],
  ]
  for (const c of padron) {
    filas.push([c.codigo, c.razon_social, c.direccion, c.localidad, c.codigo_postal, c.lat, c.lng, c.estado, c.direccion, c.lat, c.lng])
  }
  // Fila tipeada por la oficina: sin Estado y sin respaldos.
  filas.push(['16029', 'QUINTEROS BRIAN', 'San Martin 100, San Martin', 'SAN MARTIN', '1650', '', '', '', '', '', ''])

  const hoja = hojaFalsa(filas)
  const servidor = servidorFalso(padron)
  const ctx = cargar(hoja, servidor)
  ctx.sincronizar()

  comprobar('se mandó exactamente 1 fila', servidor.recibidas.length === 1,
    JSON.stringify(servidor.recibidas.map(f => f.codigo)))
  comprobar('era el alta, con razón social', servidor.recibidas[0] &&
    servidor.recibidas[0].codigo === '16029' && servidor.recibidas[0].razon_social === 'QUINTEROS BRIAN')
  comprobar('el cliente quedó en el padrón', padron.some((c) => c.codigo === '16029'))
  const codigosEnHoja = hoja.getRange(2, 1, hoja.getLastRow() - 1, 1).getValues().map((r) => String(r[0]))
  comprobar('la fila sigue en la hoja después de bajar', codigosEnHoja.indexOf('16029') >= 0,
    JSON.stringify(codigosEnHoja))
  comprobar('y ahora tiene respaldo de código (ya no es alta)',
    String(hoja.getRange(2 + codigosEnHoja.indexOf('16029'), 12, 1, 1).getValues()[0][0]) === '16029')
}

console.log('\n=== 3. Planilla al día: agregar una fila da de alta, y no toca al resto ===')
{
  const padron = [clienteBase('100', 'UNO SRL', true), clienteBase('400', 'CUATRO', false)]
  const filas = [
    ['Código','Razón social','Dirección','Localidad','CP','Latitud','Longitud','Estado','_sync_dir','_sync_lat','_sync_lng','_sync_codigo'],
  ]
  for (const c of padron) {
    filas.push([c.codigo, c.razon_social, c.direccion, c.localidad, c.codigo_postal, c.lat, c.lng, c.estado, c.direccion, c.lat, c.lng, c.codigo])
  }
  filas.push(['900', 'J3 AMOBLAMIENTOS', 'Rivadavia 500, Moron', 'MORON', '1708', '', '', '', '', '', '', ''])

  const hoja = hojaFalsa(filas)
  const servidor = servidorFalso(padron)
  const ctx = cargar(hoja, servidor)
  ctx.sincronizar()

  comprobar('sólo se mandó el alta', servidor.recibidas.length === 1 && servidor.recibidas[0].codigo === '900',
    JSON.stringify(servidor.recibidas.map(f => f.codigo)))
  comprobar('el cliente sin domicilio NO se mandó como alta',
    !servidor.recibidas.some((f) => f.codigo === '400'))
  comprobar('quedó en el padrón', padron.some((c) => c.codigo === '900'))
}

console.log('\n=== 4. Editar una dirección sigue funcionando como antes ===')
{
  const padron = [clienteBase('100', 'UNO SRL', true)]
  const filas = [
    ['Código','Razón social','Dirección','Localidad','CP','Latitud','Longitud','Estado','_sync_dir','_sync_lat','_sync_lng','_sync_codigo'],
    ['100', 'UNO SRL', 'OTRA CALLE 999, CABA', 'CABA', '1000', -34.6, -58.4, 'Ubicado', 'Calle 100 100, CABA', -34.6, -58.4, '100'],
  ]
  const hoja = hojaFalsa(filas)
  const servidor = servidorFalso(padron)
  const ctx = cargar(hoja, servidor)
  ctx.sincronizar()

  comprobar('se detectó la edición', servidor.recibidas.length === 1 &&
    servidor.recibidas[0].direccion === 'OTRA CALLE 999, CABA',
    JSON.stringify(servidor.recibidas))
  comprobar('no se mandó como alta (no lleva razón social)',
    servidor.recibidas[0] && servidor.recibidas[0].razon_social === undefined)
}

console.log('\n=== 5. Un alta rechazada no se borra: queda abajo con el motivo, y se reintenta ===')
{
  const padron = [clienteBase('100', 'UNO SRL', true)]
  const filas = [
    ['Código','Razón social','Dirección','Localidad','CP','Latitud','Longitud','Estado','_sync_dir','_sync_lat','_sync_lng','_sync_codigo'],
    ['100', 'UNO SRL', 'Calle 100 100, CABA', 'CABA', '1000', -34.6, -58.4, 'Ubicado', 'Calle 100 100, CABA', -34.6, -58.4, '100'],
    ['777', '', 'Rivadavia 1, CABA', 'CABA', '1000', '', '', '', '', '', '', ''],
  ]
  const hoja = hojaFalsa(filas)
  const servidor = servidorFalso(padron)
  const ctx = cargar(hoja, servidor)
  ctx.sincronizar()

  const ultima = hoja.getLastRow()
  const fila777 = hoja.getRange(ultima, 1, 1, 12).getValues()[0]
  comprobar('la fila rechazada sigue estando', String(fila777[0]) === '777', JSON.stringify(fila777))
  comprobar('con el motivo en Estado', String(fila777[7]).indexOf('razón social') >= 0, String(fila777[7]))
  comprobar('y sin respaldo de código, así que se reintenta', String(fila777[11]) === '')
  comprobar('el aviso lo dice', ctx.__alertas.join(' ').indexOf('sin cargar') >= 0,
    ctx.__alertas.join(' | '))

  // Segunda vuelta: la oficina completa la razón social.
  hoja.getRange(ultima, 2, 1, 1).setValues([['SEPTECIENTOS SRL']])
  const servidor2 = servidorFalso(padron)
  const ctx2 = cargar(hoja, servidor2)
  ctx2.sincronizar()
  comprobar('en la segunda vuelta se da de alta', padron.some((c) => c.codigo === '777'),
    JSON.stringify(padron.map((c) => c.codigo)))
}

console.log('\n=== 6. Sincronizar dos veces seguidas no manda nada la segunda ===')
{
  const padron = [clienteBase('100', 'UNO SRL', true), clienteBase('400', 'CUATRO', false)]
  const filas = [
    ['Código','Razón social','Dirección','Localidad','CP','Latitud','Longitud','Estado','_sync_dir','_sync_lat','_sync_lng'],
  ]
  for (const c of padron) {
    filas.push([c.codigo, c.razon_social, c.direccion, c.localidad, c.codigo_postal, c.lat, c.lng, c.estado, c.direccion, c.lat, c.lng])
  }
  filas.push(['900', 'NUEVO SRL', 'Rivadavia 500, Moron', 'MORON', '1708', '', '', '', '', '', ''])

  const hoja = hojaFalsa(filas)
  const s1 = servidorFalso(padron)
  cargar(hoja, s1).sincronizar()
  const s2 = servidorFalso(padron)
  cargar(hoja, s2).sincronizar()

  comprobar('la primera mandó el alta', s1.recibidas.length === 1)
  comprobar('la segunda no mandó nada', s2.recibidas.length === 0,
    JSON.stringify(s2.recibidas.map((f) => f.codigo)))
}

console.log('\n=== 7. Una fila sin código no se borra en silencio ===')
{
  const padron = [clienteBase('100', 'UNO SRL', true)]
  const filas = [
    ['Código','Razón social','Dirección','Localidad','CP','Latitud','Longitud','Estado','_sync_dir','_sync_lat','_sync_lng','_sync_codigo'],
    ['100', 'UNO SRL', 'Calle 100 100, CABA', 'CABA', '1000', -34.6, -58.4, 'Ubicado', 'Calle 100 100, CABA', -34.6, -58.4, '100'],
    // La oficina tipea el cliente y se olvida el código, que es el dato que hay
    // que ir a buscar al Gestión.
    ['', 'MADERAS DEL SUR SRL', 'Av. Mitre 4500, Munro', 'MUNRO', '1605', '', '', '', '', '', '', ''],
  ]
  const hoja = hojaFalsa(filas)
  const servidor = servidorFalso(padron)
  const ctx = cargar(hoja, servidor)
  ctx.sincronizar()

  const ultima = hoja.getLastRow()
  const fila = hoja.getRange(ultima, 1, 1, 12).getValues()[0]
  comprobar('la fila sigue en la hoja', String(fila[1]) === 'MADERAS DEL SUR SRL',
    JSON.stringify(fila))
  comprobar('con el motivo en Estado', String(fila[7]).indexOf('código') >= 0, String(fila[7]))
  const aviso = ctx.__alertas.join(' ')
  comprobar('el aviso NO dice que no hubo cambios', aviso.indexOf('No se detectó ningún cambio') < 0, aviso)
  comprobar('y avisa que quedó sin cargar', aviso.indexOf('sin cargar') >= 0, aviso)
}

console.log('\n=== 8. Un alta pendiente sobrevive a un cambio de encabezado ===')
{
  const padron = [clienteBase('100', 'UNO SRL', true)]
  const filas = [
    // Encabezado con una columna renombrada a mano: dispara el resellado.
    ['Código','Razón social','Dirección','Localidad','Codigo postal','Latitud','Longitud','Estado','_sync_dir','_sync_lat','_sync_lng','_sync_codigo'],
    ['100', 'UNO SRL', 'Calle 100 100, CABA', 'CABA', '1000', -34.6, -58.4, 'Ubicado', 'Calle 100 100, CABA', -34.6, -58.4, '100'],
    // Un alta que había quedado pendiente y la oficina ya corrigió: tiene el
    // motivo viejo en Estado y ahora sí la razón social.
    ['16090', 'ABERTURAS RAMOS SRL', 'Av. San Martin 3300, Ramos Mejia', 'RAMOS MEJIA', '1704', '', '',
      'Es un código nuevo y le falta la razón social para darlo de alta', '', '', '', ''],
  ]
  const hoja = hojaFalsa(filas)
  const servidor = servidorFalso(padron)
  const ctx = cargar(hoja, servidor)
  ctx.sincronizar()

  comprobar('se mandó con la razón social', servidor.recibidas.length === 1 &&
    servidor.recibidas[0].razon_social === 'ABERTURAS RAMOS SRL',
    JSON.stringify(servidor.recibidas))
  comprobar('el cliente quedó cargado', padron.some((c) => c.codigo === '16090'),
    JSON.stringify(padron.map((c) => c.codigo)))
}

console.log('\n=== 9. En el upgrade, una fila tipeada con una nota en Estado sigue siendo alta ===')
{
  const padron = [clienteBase('100', 'UNO SRL', true)]
  const filas = [
    ['Código','Razón social','Dirección','Localidad','CP','Latitud','Longitud','Estado','_sync_dir','_sync_lat','_sync_lng'],
    ['100', 'UNO SRL', 'Calle 100 100, CABA', 'CABA', '1000', -34.6, -58.4, 'Ubicado', 'Calle 100 100, CABA', -34.6, -58.4],
    // La oficina dejó escrita una nota suya en la columna Estado.
    ['16100', 'HERRAJES DEL OESTE', 'Rivadavia 900, Moron', 'MORON', '1708', '', '', 'revisar', '', '', ''],
  ]
  const hoja = hojaFalsa(filas)
  const servidor = servidorFalso(padron)
  const ctx = cargar(hoja, servidor)
  ctx.sincronizar()

  comprobar('se mandó como alta, con razón social', servidor.recibidas.length === 1 &&
    servidor.recibidas[0].razon_social === 'HERRAJES DEL OESTE',
    JSON.stringify(servidor.recibidas))
  comprobar('el cliente quedó cargado', padron.some((c) => c.codigo === '16100'))
}

console.log('\n=== 10. Coordenadas con coma decimal llegan como número ===')
{
  const padron = [clienteBase('100', 'UNO SRL', true)]
  const filas = [
    ['Código','Razón social','Dirección','Localidad','CP','Latitud','Longitud','Estado','_sync_dir','_sync_lat','_sync_lng','_sync_codigo'],
    // Pegadas de Google Maps en formato es-AR, como texto.
    ['100', 'UNO SRL', 'Calle 100 100, CABA', 'CABA', '1000', '-34,60176', '-58,38154', 'Ubicado',
      'Calle 100 100, CABA', -34.6, -58.4, '100'],
  ]
  const hoja = hojaFalsa(filas)
  const servidor = servidorFalso(padron)
  cargar(hoja, servidor).sincronizar()

  comprobar('se detectó la edición', servidor.recibidas.length === 1, JSON.stringify(servidor.recibidas))
  comprobar('la latitud viajó como número, no como "-34,60176"',
    servidor.recibidas[0] && servidor.recibidas[0].lat === -34.60176,
    JSON.stringify(servidor.recibidas[0] && servidor.recibidas[0].lat))
  comprobar('y la longitud también',
    servidor.recibidas[0] && servidor.recibidas[0].lng === -58.38154)
}

console.log('\n' + (fallos === 0 ? 'TODO BIEN' : fallos + ' FALLA(S)'))
process.exit(fallos === 0 ? 0 : 1)
