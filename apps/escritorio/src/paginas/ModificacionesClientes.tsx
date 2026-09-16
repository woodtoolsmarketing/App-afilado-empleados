import ExcelJS from 'exceljs'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { supabase } from '../nucleo/supabase'

/**
 * Lo que los vendedores (y la oficina) cambiaron de la ficha de un cliente.
 *
 * Cada fila es un campo tocado —razón social, nombre de fantasía o dirección—
 * con lo que decía antes y lo que quedó, quién lo cambió y cuándo. Sirve para
 * el control de fin de mes: se elige el rango, se mira, y se baja en Excel.
 *
 * Las filas las escribe un trigger en la base, así que caen acá tanto los
 * cambios hechos desde el mapa del celular como los que se hacen en el panel.
 */

interface FilaModificacion {
  id: string
  modificado_en: string
  campo: string
  valor_anterior: string | null
  valor_nuevo: string | null
  cliente_codigo: string | null
  cliente: { codigo: string; razon_social: string } | null
  autor: { nombre_completo: string; codigo_vendedor: string | null } | null
}

/** Primer día del mes en curso y hoy, en formato YYYY-MM-DD local. */
function comoISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function nombreDeAutor(a: FilaModificacion['autor']): string {
  if (!a) return 'Sistema'
  return a.codigo_vendedor ? `${a.nombre_completo} (#${a.codigo_vendedor})` : a.nombre_completo
}

export function PaginaModificacionesClientes() {
  const ahora = new Date()
  const [desde, setDesde] = useState(comoISO(new Date(ahora.getFullYear(), ahora.getMonth(), 1)))
  const [hasta, setHasta] = useState(comoISO(ahora))
  const [exportando, setExportando] = useState(false)

  const { data: filas, isLoading, error } = useQuery({
    queryKey: ['modificaciones-clientes', desde, hasta],
    queryFn: async () => {
      // `hasta` es inclusive: se filtra hasta el día siguiente, exclusivo.
      const siguiente = new Date(`${hasta}T00:00:00`)
      siguiente.setDate(siguiente.getDate() + 1)

      const { data, error } = await supabase
        .from('clientes_modificaciones')
        .select(
          'id, modificado_en, campo, valor_anterior, valor_nuevo, cliente_codigo, cliente:clientes ( codigo, razon_social ), autor:perfiles ( nombre_completo, codigo_vendedor )',
        )
        .gte('modificado_en', desde)
        .lt('modificado_en', comoISO(siguiente))
        .order('modificado_en', { ascending: false })
        .limit(5000)

      if (error) throw error
      return data as unknown as FilaModificacion[]
    },
  })

  const total = filas?.length ?? 0

  async function exportarExcel() {
    if (!filas || filas.length === 0) return
    setExportando(true)
    try {
      const libro = new ExcelJS.Workbook()
      const hoja = libro.addWorksheet('Modificaciones')
      hoja.columns = [
        { header: 'Fecha y hora', key: 'fecha', width: 20 },
        { header: 'Quién lo cambió', key: 'quien', width: 26 },
        { header: 'Cliente Nº', key: 'codigo', width: 14 },
        { header: 'Cliente', key: 'cliente', width: 34 },
        { header: 'Campo', key: 'campo', width: 18 },
        { header: 'Antes', key: 'antes', width: 34 },
        { header: 'Después', key: 'despues', width: 34 },
      ]
      hoja.getRow(1).font = { bold: true }

      for (const f of filas) {
        hoja.addRow({
          fecha: new Date(f.modificado_en).toLocaleString('es-AR', {
            dateStyle: 'short',
            timeStyle: 'short',
          }),
          quien: nombreDeAutor(f.autor),
          codigo: f.cliente?.codigo ?? f.cliente_codigo ?? '—',
          cliente: f.cliente?.razon_social ?? '—',
          campo: f.campo,
          antes: f.valor_anterior ?? '(vacío)',
          despues: f.valor_nuevo ?? '(vacío)',
        })
      }

      const buffer = await libro.xlsx.writeBuffer()
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      const url = URL.createObjectURL(blob)
      const enlace = document.createElement('a')
      enlace.href = url
      enlace.download = `modificaciones-clientes-${desde}-a-${hasta}.xlsx`
      enlace.click()
      URL.revokeObjectURL(url)
    } finally {
      setExportando(false)
    }
  }

  return (
    <>
      <header className="encabezado-pagina">
        <div>
          <h1>Modificaciones de clientes</h1>
          <p>
            Lo que se cambió de la ficha de cada cliente —razón social, nombre de fantasía o
            dirección— en el período elegido.
          </p>
        </div>
        <button
          className="primario"
          disabled={exportando || total === 0}
          onClick={exportarExcel}
        >
          {exportando ? 'Generando…' : 'Exportar Excel'}
        </button>
      </header>

      <section className="tarjeta">
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
            <span style={{ color: 'var(--tinta-suave)' }}>Desde</span>
            <input type="date" value={desde} max={hasta} onChange={(e) => setDesde(e.target.value)} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
            <span style={{ color: 'var(--tinta-suave)' }}>Hasta</span>
            <input type="date" value={hasta} min={desde} onChange={(e) => setHasta(e.target.value)} />
          </label>
          <span style={{ color: 'var(--tinta-suave)', fontSize: 13, paddingBottom: 6 }}>
            {isLoading ? 'Cargando…' : `${total} ${total === 1 ? 'cambio' : 'cambios'}`}
          </span>
        </div>
      </section>

      <section className="tarjeta">
        {error ? (
          <div className="aviso error">No se pudo cargar: {(error as Error).message}</div>
        ) : isLoading ? (
          <p>Cargando…</p>
        ) : total === 0 ? (
          <p className="vacio">No hay modificaciones en el período elegido.</p>
        ) : (
          <table style={{ width: '100%', fontSize: 13 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Fecha</th>
                <th style={{ textAlign: 'left' }}>Quién</th>
                <th style={{ textAlign: 'left' }}>Cliente</th>
                <th style={{ textAlign: 'left' }}>Campo</th>
                <th style={{ textAlign: 'left' }}>Antes</th>
                <th style={{ textAlign: 'left' }}>Después</th>
              </tr>
            </thead>
            <tbody>
              {filas!.map((f) => (
                <tr key={f.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {new Date(f.modificado_en).toLocaleString('es-AR', {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    })}
                  </td>
                  <td>{nombreDeAutor(f.autor)}</td>
                  <td>
                    <code>{f.cliente?.codigo ?? f.cliente_codigo ?? '—'}</code>
                    <br />
                    <small style={{ color: 'var(--tinta-tenue)' }}>
                      {f.cliente?.razon_social ?? '—'}
                    </small>
                  </td>
                  <td>{f.campo}</td>
                  <td style={{ color: 'var(--tinta-suave)' }}>{f.valor_anterior ?? '—'}</td>
                  <td>{f.valor_nuevo ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  )
}
