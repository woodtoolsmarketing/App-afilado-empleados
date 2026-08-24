import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import ExcelJS from 'exceljs'
import { useState } from 'react'

import { supabase } from '../nucleo/supabase'

/**
 * "CARGAR ROL MAESTRO"
 *
 * El plan de visitas de un vendedor, cargado de un Excel: a qué clientes tiene
 * que ver y cada cuántos días.
 *
 * ── Qué NO hace ─────────────────────────────────────────────────────────────
 *
 * No crea paradas. Crea el plan; de ahí salen los candidatos que el vendedor ve
 * cada día, todos deseleccionados, y las paradas se crean cuando él elige.
 *
 * Es a propósito: el vendedor no tiene permiso de borrar paradas, así que si el
 * Excel las creara directamente, "deseleccionar" no podría deshacerlo.
 *
 * ── Por qué muestra todo antes de guardar ───────────────────────────────────
 *
 * Porque un Excel de la oficina trae códigos que no existen, filas en blanco en
 * el medio y frecuencias tipeadas como "15 dias". Guardar primero y avisar
 * después deja media carga hecha y la otra media perdida, y nadie sabe cuál fue
 * cuál. Acá se ve el resultado completo —lo que entra y lo que no— y recién
 * entonces se decide.
 */

interface FilaLeida {
  linea: number
  codigo: string
  cadaCuantosDias: number | null
  /** Null hasta que se cruza contra el padrón. */
  clienteId: string | null
  razonSocial: string | null
  problema: string | null
}

export function PaginaRolMaestro({ soloLectura }: { soloLectura: boolean }) {
  const cliente = useQueryClient()
  const [vendedorId, setVendedorId] = useState('')
  const [filas, setFilas] = useState<FilaLeida[]>([])
  const [archivo, setArchivo] = useState('')
  const [leyendo, setLeyendo] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { data: vendedores } = useQuery({
    queryKey: ['vendedores-para-rol'],
    queryFn: async () => {
      const { data, error: err } = await supabase
        .from('perfiles')
        .select('id, nombre_completo, codigo_vendedor')
        .eq('rol', 'vendedor')
        .eq('estado', 'aprobado')
        .order('nombre_completo')
      if (err) throw err
      return (data ?? []) as Array<{
        id: string
        nombre_completo: string
        codigo_vendedor: string | null
      }>
    },
  })

  const { data: yaCargado } = useQuery({
    queryKey: ['rol-maestro', vendedorId],
    enabled: !!vendedorId,
    queryFn: async () => {
      const { count } = await supabase
        .from('rol_maestro')
        .select('id', { count: 'exact', head: true })
        .eq('vendedor_id', vendedorId)
        .eq('activo', true)
      return count ?? 0
    },
  })

  const validas = filas.filter((f) => !f.problema)
  const conProblema = filas.filter((f) => f.problema)

  async function alElegirArchivo(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    setArchivo(f.name)
    setError(null)
    setLeyendo(true)
    try {
      const leidas = await leerPlanilla(f)
      setFilas(await cruzarContraElPadron(leidas))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No pudimos leer el archivo.')
      setFilas([])
    } finally {
      setLeyendo(false)
      // Para que elegir el MISMO archivo otra vez vuelva a disparar el evento.
      e.target.value = ''
    }
  }

  const guardar = useMutation({
    mutationFn: async () => {
      if (!vendedorId) throw new Error('Elegí a qué vendedor le corresponde este rol.')
      const { data: sesion } = await supabase.auth.getSession()

      /*
       * Se reemplaza el plan entero, no se van sumando cargas.
       *
       * Un rol maestro es una foto: "estos son los clientes de este vendedor".
       * Si se acumularan, el cliente que la oficina sacó del Excel seguiría
       * apareciendo para siempre y no habría forma de darlo de baja desde acá.
       *
       * Se desactiva en vez de borrar: el plan viejo queda, y con él la
       * posibilidad de contestar por qué tal cliente se dejó de visitar.
       */
      const { error: e1 } = await supabase
        .from('rol_maestro')
        .update({ activo: false })
        .eq('vendedor_id', vendedorId)
      if (e1) throw e1

      const { error: e2 } = await supabase.from('rol_maestro').upsert(
        validas.map((f, i) => ({
          vendedor_id: vendedorId,
          cliente_id: f.clienteId!,
          cada_cuantos_dias: f.cadaCuantosDias!,
          orden: i + 1,
          activo: true,
          cargado_por: sesion.session?.user.id ?? null,
        })),
        { onConflict: 'vendedor_id,cliente_id' },
      )
      if (e2) throw e2
      return validas.length
    },
    onSuccess: (cuantos) => {
      void cliente.invalidateQueries({ queryKey: ['rol-maestro'] })
      setFilas([])
      setArchivo('')
      alert(`Rol maestro cargado: ${cuantos} clientes.`)
    },
    onError: (e: Error) => setError(e.message),
  })

  return (
    <div>
      <div className="encabezado-pagina">
        <h1>Rol maestro</h1>
        <p>
          A qué clientes tiene que visitar cada vendedor y cada cuántos días. De acá salen los
          candidatos que le aparecen en el teléfono, todos deseleccionados.
        </p>
      </div>

      <div className="tarjeta">
        <div className="campo">
          <label htmlFor="vendedor">Vendedor</label>
          <select
            id="vendedor"
            value={vendedorId}
            onChange={(e) => setVendedorId(e.target.value)}
            disabled={soloLectura}
          >
            <option value="">Elegí el vendedor</option>
            {(vendedores ?? []).map((v) => (
              <option key={v.id} value={v.id}>
                {v.nombre_completo}
                {v.codigo_vendedor ? ` (Nº ${v.codigo_vendedor})` : ''}
              </option>
            ))}
          </select>
        </div>

        {vendedorId && yaCargado !== undefined ? (
          <div className="aviso">
            {yaCargado === 0
              ? 'Este vendedor todavía no tiene rol maestro cargado.'
              : `Hoy tiene ${yaCargado} clientes en su rol. Cargar un Excel nuevo REEMPLAZA el plan entero: los que no estén en el archivo dejan de aparecerle.`}
          </div>
        ) : null}

        <div className="campo">
          <label htmlFor="archivo">Archivo</label>
          <input
            id="archivo"
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={alElegirArchivo}
            disabled={soloLectura || !vendedorId}
          />
          <small>
            Una fila por cliente. Primera columna: el código de cliente. Segunda: cada cuántos días
            visitarlo. La primera fila puede ser el encabezado — si no tiene un número en la segunda
            columna, se saltea.
          </small>
        </div>

        {leyendo ? <div className="aviso">Leyendo el archivo…</div> : null}
        {error ? <div className="aviso error">{error}</div> : null}
      </div>

      {filas.length > 0 ? (
        <div className="tarjeta">
          <h2>
            {archivo} · {validas.length} de {filas.length} filas listas
          </h2>

          {conProblema.length > 0 ? (
            <div className="aviso atencion">
              {conProblema.length} fila{conProblema.length === 1 ? '' : 's'} no se van a cargar. Se
              listan abajo con el motivo; el resto sí entra.
            </div>
          ) : null}

          <table>
            <thead>
              <tr>
                <th style={{ width: 60 }}>Fila</th>
                <th style={{ width: 90 }}>Código</th>
                <th>Cliente</th>
                <th style={{ width: 120 }}>Cada</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.linea} style={f.problema ? { opacity: 0.6 } : undefined}>
                  <td>{f.linea}</td>
                  <td>
                    <code>{f.codigo || '—'}</code>
                  </td>
                  <td>{f.razonSocial ?? '—'}</td>
                  <td>{f.cadaCuantosDias ? `${f.cadaCuantosDias} días` : '—'}</td>
                  <td>
                    {f.problema ? (
                      <span className="pastilla roja">{f.problema}</span>
                    ) : (
                      <span className="pastilla verde">Listo</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="acciones">
            <button
              type="button"
              onClick={() => guardar.mutate()}
              disabled={soloLectura || validas.length === 0 || guardar.isPending}
            >
              {guardar.isPending ? 'Guardando…' : `Cargar ${validas.length} clientes`}
            </button>
            <button type="button" className="secundario" onClick={() => setFilas([])}>
              Descartar
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

/**
 * Lee el archivo y devuelve las filas crudas.
 *
 * Acepta .xlsx y .csv por el mismo camino: ExcelJS lee los dos, y sostener dos
 * lectores para el mismo formato de datos es sostener dos formas de fallar.
 */
async function leerPlanilla(archivo: File): Promise<Array<Omit<FilaLeida, 'clienteId' | 'razonSocial'>>> {
  const libro = new ExcelJS.Workbook()
  const buffer = await archivo.arrayBuffer()

  if (archivo.name.toLowerCase().endsWith('.csv')) {
    const texto = new TextDecoder('utf-8').decode(buffer)
    return texto
      .split(/\r?\n/)
      .map((linea, i) => {
        const celdas = linea.split(/[;,\t]/)
        return interpretar(celdas[0] ?? '', celdas[1] ?? '', i + 1)
      })
      .filter((f): f is Omit<FilaLeida, 'clienteId' | 'razonSocial'> => f !== null)
  }

  await libro.xlsx.load(buffer)
  const hoja = libro.worksheets[0]
  if (!hoja) throw new Error('El archivo no tiene ninguna hoja.')

  const filas: Array<Omit<FilaLeida, 'clienteId' | 'razonSocial'>> = []
  hoja.eachRow((fila, numero) => {
    const leida = interpretar(textoDeCelda(fila.getCell(1)), textoDeCelda(fila.getCell(2)), numero)
    if (leida) filas.push(leida)
  })

  if (filas.length === 0) {
    throw new Error(
      'No encontramos ninguna fila con código de cliente y cantidad de días. Revisá que sean las dos primeras columnas.',
    )
  }
  return filas
}

/** Una celda de ExcelJS puede traer número, texto, fórmula o texto enriquecido. */
function textoDeCelda(celda: ExcelJS.Cell): string {
  const v = celda.value
  if (v === null || v === undefined) return ''
  if (typeof v === 'object' && 'result' in v) return String(v.result ?? '')
  if (typeof v === 'object' && 'richText' in v) {
    return (v.richText ?? []).map((t) => t.text).join('')
  }
  return String(v)
}

/**
 * De dos celdas a una fila, o null si la fila no dice nada.
 *
 * Se saltean en silencio las vacías y la del encabezado. Marcarlas como error
 * llenaría la lista de problemas que no son problemas: toda planilla de oficina
 * tiene un título arriba y filas en blanco en el medio.
 */
function interpretar(
  celdaCodigo: string,
  celdaDias: string,
  linea: number,
): Omit<FilaLeida, 'clienteId' | 'razonSocial'> | null {
  const codigo = celdaCodigo.trim()
  const dias = celdaDias.trim()
  if (!codigo && !dias) return null

  // "15 días", "15", "15,0" — se busca el número y se ignora lo demás.
  const n = /(\d+)/.exec(dias)
  const cadaCuantosDias = n ? Number(n[1]) : null

  // Encabezado: la segunda columna no tiene ningún número.
  if (!cadaCuantosDias && !/^\d+$/.test(codigo)) return null

  return {
    linea,
    codigo,
    cadaCuantosDias,
    problema: !codigo
      ? 'Sin código de cliente'
      : !cadaCuantosDias
        ? 'Sin cada cuántos días'
        : cadaCuantosDias < 1 || cadaCuantosDias > 365
          ? 'La frecuencia tiene que estar entre 1 y 365 días'
          : null,
  }
}

/**
 * Cruza los códigos contra el padrón.
 *
 * Se hace en una sola consulta y no una por fila: un rol maestro son cientos de
 * clientes, y cientos de idas y vueltas contra la base tardan lo suficiente
 * como para que alguien crea que se colgó.
 */
async function cruzarContraElPadron(
  filas: Array<Omit<FilaLeida, 'clienteId' | 'razonSocial'>>,
): Promise<FilaLeida[]> {
  const codigos = [...new Set(filas.map((f) => f.codigo).filter(Boolean))]
  if (codigos.length === 0) return filas.map((f) => ({ ...f, clienteId: null, razonSocial: null }))

  const { data, error } = await supabase
    .from('clientes')
    .select('id, codigo, razon_social, activo')
    .in('codigo', codigos)

  if (error) throw error

  const porCodigo = new Map(
    ((data ?? []) as Array<{ id: string; codigo: string; razon_social: string; activo: boolean }>).map(
      (c) => [c.codigo, c],
    ),
  )

  return filas.map((f) => {
    const c = porCodigo.get(f.codigo)
    return {
      ...f,
      clienteId: c?.id ?? null,
      razonSocial: c?.razon_social ?? null,
      problema:
        f.problema ??
        (!c
          ? 'Ese código no está en el padrón'
          : !c.activo
            ? 'El cliente está dado de baja'
            : null),
    }
  })
}
