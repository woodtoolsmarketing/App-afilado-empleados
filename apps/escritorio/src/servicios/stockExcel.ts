import * as XLSX from 'xlsx'

/**
 * Parseo del Excel de "Existencias por Depósito" del Gestión.
 *
 * El archivo puede venir como .XLS BIFF (varias HOJAS, una por proveedor, que se
 * solapan) o como SpreadsheetML/XML de una sola hoja; SheetJS lee ambos. Las
 * columnas NO están en posiciones fijas: según el reporte, entre el Código y la
 * cantidad pueden aparecer "U.M" (Unidad) y "Proveedor". Por eso se ubican POR
 * ENCABEZADO, no por índice (antes se tomaba el índice 2 fijo y, cuando ahí caía
 * "U.M", se cargaba la palabra "Unidad" → 0 en todos los productos).
 *
 * En cada hoja: la fila de encabezado es la que tiene una celda "Dpto.:…" o
 * "Total"; el Código es la primera columna; la CANTIDAD es la del DEPÓSITO
 * ("Dpto.: 00001"), NO el "Total" (que suma otros depósitos) — el stock
 * disponible es el del depósito. Cada producto es UNA fila con código + cantidad;
 * las filas con código vacío son continuaciones de la descripción y se saltan. Se
 * dedupe por código entre hojas (toma la mayor; conflicto si difieren). Acá sólo
 * se extrae código + cantidad: la clasificación producto/servicio y el matcheo
 * contra el catálogo los hace el servidor (`fijar_stock_masivo`).
 */

export interface ItemStock {
  codigo: string
  cantidad: number
}

export interface ResumenParseo {
  items: ItemStock[]
  conflictos: { codigo: string; cantidades: number[] }[]
  hojas: { nombre: string; productos: number }[]
}

function normalizarCodigo(v: unknown): string {
  // El Gestión trae códigos numéricos (p.ej. 10001) que la librería lee como
  // número; se pasan a texto como el resto.
  if (typeof v === 'number') return String(v)
  return String(v ?? '').trim()
}

function aCantidad(v: unknown): number {
  if (typeof v === 'number') return Math.max(0, Math.round(v))
  const n = Number(String(v ?? '').replace(',', '.'))
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0
}

export function parsearStockGestion(datos: ArrayBuffer): ResumenParseo {
  const wb = XLSX.read(datos, { type: 'array' })
  const map = new Map<string, { cantidad: number; cantidades: Set<number> }>()
  const hojas: { nombre: string; productos: number }[] = []

  for (const nombre of wb.SheetNames) {
    const ws = wb.Sheets[nombre]
    if (!ws) continue
    const filas = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, blankrows: false })

    // Ubicar la fila de encabezado y las columnas POR SU NOMBRE (no por índice):
    // el encabezado está varias filas abajo (arriba van título y filtros) y entre
    // el Código y la cantidad pueden venir "U.M" y "Proveedor". Se reconoce el
    // encabezado por la celda "Dpto.:…" o "Total" (ASCII; la "ó" de "Código"
    // llega mal codificada del .XLS, y la línea de filtro "Ordenado por Codigo…"
    // no tiene celda Dpto/Total).
    const fold = (v: unknown) =>
      String(v ?? '')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')

    let hdr = -1
    for (let r = 0; r < filas.length; r++) {
      const celdas = (filas[r] ?? []).map(fold)
      if (celdas.some((c) => c.startsWith('dpto') || c === 'total')) {
        hdr = r
        break
      }
    }
    if (hdr < 0) continue // esta hoja no trae la tabla de existencias

    const enc = (filas[hdr] ?? []).map(fold)
    let colCodigo = enc.findIndex((c) => c.includes('digo') && c.length < 15)
    if (colCodigo < 0) colCodigo = 0
    // La cantidad es la del depósito. Si hay varios "Dpto.:…" se prefiere el
    // 00001; el "Total" (que suma otros depósitos) NO se usa.
    let colCantidad = enc.findIndex((c) => c.startsWith('dpto') && c.includes('00001'))
    if (colCantidad < 0) colCantidad = enc.findIndex((c) => c.startsWith('dpto'))
    if (colCantidad < 0) continue // sin columna de depósito no hay cantidad

    let productos = 0
    for (let r = hdr + 1; r < filas.length; r++) {
      const fila = filas[r]
      const c0 = fila?.[colCodigo]
      if (c0 === undefined || c0 === null || String(c0).trim() === '') continue // continuación de descripción
      const codigo = normalizarCodigo(c0)
      const desc = String(fila?.[colCodigo + 1] ?? '').trim().toLowerCase()
      if (codigo === '1' && desc === 'texto') continue // fila basura del Gestión
      const cantidad = aCantidad(fila?.[colCantidad])
      productos++
      const prev = map.get(codigo)
      if (prev) {
        prev.cantidades.add(cantidad)
        prev.cantidad = Math.max(prev.cantidad, cantidad)
      } else {
        map.set(codigo, { cantidad, cantidades: new Set([cantidad]) })
      }
    }
    hojas.push({ nombre, productos })
  }

  const items: ItemStock[] = []
  const conflictos: { codigo: string; cantidades: number[] }[] = []
  for (const [codigo, v] of map) {
    items.push({ codigo, cantidad: v.cantidad })
    if (v.cantidades.size > 1) {
      conflictos.push({ codigo, cantidades: [...v.cantidades].sort((a, b) => a - b) })
    }
  }
  items.sort((a, b) => a.codigo.localeCompare(b.codigo))
  return { items, conflictos, hojas }
}
