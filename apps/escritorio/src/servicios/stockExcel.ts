import * as XLSX from 'xlsx'

/**
 * Parseo del Excel de "Existencias por Depósito" del Gestión.
 *
 * El archivo es un .XLS viejo (BIFF) con varias HOJAS (una por proveedor) que se
 * solapan. Cada hoja: col 0 = Código, col 1 = Desc. Técnica, col 2 = "Dpto.:
 * 00001" (la cantidad). Cada producto es UNA fila con código + cantidad; las
 * filas con código vacío son continuaciones de la descripción (medidas, notas) y
 * se saltan. Se dedupe por código entre hojas; si un código trae cantidades
 * distintas se reporta como conflicto (se toma la mayor). Acá sólo se extrae
 * código + cantidad: la clasificación producto/servicio y el matcheo contra el
 * catálogo los hace el servidor (`fijar_stock_masivo`).
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

    // Detectar la fila de encabezado (arriba hay título/filtros): la que dice
    // "Código" o "Dpto.".
    let hdr = 0
    for (let r = 0; r < Math.min(5, filas.length); r++) {
      const c0 = String(filas[r]?.[0] ?? '')
      const c2 = String(filas[r]?.[2] ?? '')
      if (c0.includes('digo') || c2.includes('Dpto')) {
        hdr = r
        break
      }
    }

    let productos = 0
    for (let r = hdr + 1; r < filas.length; r++) {
      const fila = filas[r]
      const c0 = fila?.[0]
      if (c0 === undefined || c0 === null || String(c0).trim() === '') continue // continuación de descripción
      const codigo = normalizarCodigo(c0)
      const desc = String(fila?.[1] ?? '').trim().toLowerCase()
      if (codigo === '1' && desc === 'texto') continue // fila basura del Gestión
      const cantidad = aCantidad(fila?.[2])
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
