import { useMutation } from '@tanstack/react-query'
import { type ChangeEvent, type CSSProperties, useRef, useState } from 'react'

import { fijarStockMasivo, type ReporteCargaStock } from '../servicios/stock'
import { parsearStockGestion, type ResumenParseo } from '../servicios/stockExcel'

/**
 * Carga masiva de stock desde el Excel de "Existencias por Depósito" del Gestión.
 *
 * El flujo es con PREVIA: se parsea el .XLS (todas las hojas), se pide al
 * servidor una clasificación en seco (`dry_run`) y se muestra qué se va a
 * actualizar / ignorar antes de escribir nada. Recién con "Cargar" se aplica.
 */

type Estado =
  | { fase: 'idle' }
  | { fase: 'parseando' }
  | { fase: 'previa'; parseo: ResumenParseo; reporte: ReporteCargaStock }

export function CargaStockExcel({ onAplicado }: { onAplicado: (r: ReporteCargaStock) => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [estado, setEstado] = useState<Estado>({ fase: 'idle' })
  const [ceroFaltantes, setCeroFaltantes] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function alElegirArchivo(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // permite re-elegir el mismo archivo
    if (!file) return
    setError(null)
    setCeroFaltantes(false)
    setEstado({ fase: 'parseando' })
    try {
      const buf = await file.arrayBuffer()
      const parseo = parsearStockGestion(buf)
      if (parseo.items.length === 0) {
        throw new Error('No encontré productos en el Excel. ¿Es el export de "Existencias por Depósito"?')
      }
      const reporte = await fijarStockMasivo(parseo.items, { dryRun: true, ceroFaltantes: false })
      setEstado({ fase: 'previa', parseo, reporte })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setEstado({ fase: 'idle' })
    }
  }

  // Al tildar "poner en 0 los que no vinieron" se recalcula la previa para ver
  // cuántos productos quedarían en 0.
  const recalc = useMutation({
    mutationFn: (cero: boolean) => {
      if (estado.fase !== 'previa') throw new Error('sin previa')
      return fijarStockMasivo(estado.parseo.items, { dryRun: true, ceroFaltantes: cero })
    },
    onSuccess: (reporte) => setEstado((s) => (s.fase === 'previa' ? { ...s, reporte } : s)),
  })

  const aplicar = useMutation({
    mutationFn: () => {
      if (estado.fase !== 'previa') throw new Error('sin previa')
      return fijarStockMasivo(estado.parseo.items, { dryRun: false, ceroFaltantes })
    },
    onSuccess: (reporte) => {
      setEstado({ fase: 'idle' })
      onAplicado(reporte)
    },
    onError: (e: Error) => setError(e.message),
  })

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".xls,.xlsx"
        style={{ display: 'none' }}
        onChange={(e) => void alElegirArchivo(e)}
      />
      <button
        className="primario"
        disabled={estado.fase === 'parseando'}
        onClick={() => inputRef.current?.click()}
      >
        {estado.fase === 'parseando' ? 'Leyendo…' : '📥 Subir Excel del Gestión'}
      </button>

      {error && (
        <div className="aviso error" role="alert" style={{ marginTop: 10 }}>
          {error}
        </div>
      )}

      {estado.fase === 'previa' && (
        <div style={overlay} role="dialog" aria-modal="true">
          <div className="tarjeta" style={dialogo}>
            <h2 style={{ marginTop: 0 }}>Revisá antes de cargar el stock</h2>
            <p style={{ color: 'var(--tinta-suave)' }}>
              El Excel trae <strong>{estado.reporte.recibidos}</strong> códigos de{' '}
              {estado.parseo.hojas.length} hojas.
            </p>

            <div className="rejilla" style={{ marginBottom: 14 }}>
              <Indicador valor={estado.reporte.productos} etiqueta="Productos a actualizar" />
              <Indicador valor={estado.reporte.servicios} etiqueta="Servicios (se ignoran)" />
              <Indicador valor={estado.reporte.no_catalogo} etiqueta="No están en el catálogo" />
            </div>

            {estado.parseo.conflictos.length > 0 && (
              <div className="aviso atencion" style={{ marginBottom: 10 }}>
                {estado.parseo.conflictos.length} código(s) venían con cantidad distinta entre hojas; se toma
                la mayor
                {estado.parseo.conflictos.length <= 6
                  ? ` (${estado.parseo.conflictos.map((c) => c.codigo).join(', ')})`
                  : ''}
                .
              </div>
            )}

            {estado.reporte.no_catalogo > 0 && (
              <details style={{ marginBottom: 12 }}>
                <summary>Ver códigos que no están en el catálogo</summary>
                <p style={{ fontSize: 12, color: 'var(--tinta-suave)', wordBreak: 'break-word' }}>
                  {estado.reporte.faltan_en_catalogo.join(', ')}
                  {estado.reporte.no_catalogo > estado.reporte.faltan_en_catalogo.length ? ' …' : ''}
                </p>
                <p style={{ fontSize: 12, color: 'var(--tinta-tenue)', marginBottom: 0 }}>
                  Son códigos del Gestión que todavía no están en la lista de precios. Hasta que se carguen al
                  catálogo no pueden llevar stock.
                </p>
              </details>
            )}

            <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <input
                type="checkbox"
                checked={ceroFaltantes}
                disabled={aplicar.isPending}
                onChange={(e) => {
                  setCeroFaltantes(e.target.checked)
                  recalc.mutate(e.target.checked)
                }}
                style={{ marginTop: 3 }}
              />
              <span>
                Poner en <strong>0</strong> los productos que no vinieron en este Excel
                {ceroFaltantes && (
                  <span style={{ color: 'var(--tinta-suave)' }}>
                    {' — '}
                    {recalc.isPending
                      ? 'calculando…'
                      : `${estado.reporte.puestos_en_cero} con stock pasarían a 0`}
                  </span>
                )}
                <br />
                <small style={{ color: 'var(--tinta-tenue)' }}>
                  Dejalo sin tildar si el Excel es sólo una parte. Tildalo si es la foto completa del depósito.
                </small>
              </span>
            </label>

            <div
              className="acciones"
              style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}
            >
              <button className="chico" onClick={() => setEstado({ fase: 'idle' })} disabled={aplicar.isPending}>
                Cancelar
              </button>
              <button
                className="primario"
                onClick={() => aplicar.mutate()}
                disabled={
                  aplicar.isPending ||
                  recalc.isPending ||
                  (estado.reporte.productos === 0 && estado.reporte.puestos_en_cero === 0)
                }
              >
                {aplicar.isPending
                  ? 'Cargando…'
                  : `Cargar stock de ${estado.reporte.productos} productos`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function Indicador({ valor, etiqueta }: { valor: number; etiqueta: string }) {
  return (
    <div className="indicador">
      <div className="valor">{valor}</div>
      <div className="etiqueta">{etiqueta}</div>
    </div>
  )
}

const overlay: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.5)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
  padding: 20,
}
const dialogo: CSSProperties = { maxWidth: 560, width: '100%', maxHeight: '85vh', overflow: 'auto' }
