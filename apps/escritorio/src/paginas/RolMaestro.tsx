import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import ExcelJS from 'exceljs'
import { useState } from 'react'

import { supabase } from '../nucleo/supabase'

/**
 * "CARGAR ROL MAESTRO"
 *
 * El plan de visitas de un vendedor, cargado de un Excel: a qué clientes tiene
 * que ver.
 *
 * ── Qué NO hace ─────────────────────────────────────────────────────────────
 *
 * No crea paradas. Crea el plan; de ahí salen los candidatos que el vendedor ve
 * cada día, todos deseleccionados, y las paradas se crean cuando él elige.
 *
 * Es a propósito: el vendedor no tiene permiso de borrar paradas, así que si el
 * Excel las creara directamente, "deseleccionar" no podría deshacerlo.
 *
 * ── Cómo se lee el Excel ────────────────────────────────────────────────────
 *
 * Los Excel de la oficina son planillas de recorrido por día y zona: arriba
 * tienen el logo y un título, después una fila de encabezados —"Hora", "Cod",
 * "Razon Social", "Direccion"…— y recién abajo los clientes. La columna que
 * importa es "Cod": ahí está el CÓDIGO del cliente. NO es la primera columna
 * (esa suele ser un número de orden 1, 2, 3…), y por eso el código no se busca
 * por posición sino por el nombre del encabezado. Buscarlo por posición fue lo
 * que hacía que se cargara el número de orden como si fuera el código y todo
 * saliera cruzado.
 *
 * El resto de las columnas se ignora. La razón social sale del padrón, cruzando
 * por el código, así que la del Excel no hace falta.
 *
 * ── Por qué muestra todo antes de guardar ───────────────────────────────────
 *
 * Porque un Excel de la oficina trae códigos que no existen y filas en blanco
 * en el medio. Guardar primero y avisar después deja media carga hecha y la
 * otra media perdida, y nadie sabe cuál fue cuál. Acá se ve el resultado
 * completo —lo que entra y lo que no— y recién entonces se decide.
 */

interface FilaLeida {
  linea: number
  codigo: string
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

  /**
   * Las filas que se van a cargar, con los clientes repetidos marcados.
   *
   * Un mismo código de cliente en dos filas es lo típico de una planilla que
   * se fue armando por zonas, y las dos cruzan bien contra el padrón: sin esto
   * las dos salían "Listo" y ninguna aparecía en la lista de problemas.
   *
   * El upsert las manda juntas en un solo comando y Postgres lo aborta con
   * 21000, "ON CONFLICT DO UPDATE command cannot affect row a second time".
   * Eso sería un error y nada más si el guardado fuera una sola transacción,
   * pero son dos requests: el primero —desactivar el plan entero— ya
   * commiteó. El vendedor se quedaba sin plan y sin reemplazo, y a la mañana
   * siguiente abría CLIENTES DE HOY y no le tocaba nadie.
   *
   * Se queda la primera aparición, que es la que la oficina escribió primero,
   * y la repetida pasa a la lista de problemas para que se vea ANTES de
   * cargar.
   */
  const vistos = new Set<string>()
  const revisadas = filas.map((f) => {
    if (f.problema || !f.clienteId) return f
    if (vistos.has(f.clienteId)) {
      return { ...f, problema: `El cliente ${f.codigo} ya está en otra fila` }
    }
    vistos.add(f.clienteId)
    return f
  })

  const validas = revisadas.filter((f) => !f.problema)
  const conProblema = revisadas.filter((f) => f.problema)

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
          // Sin frecuencia: el Excel de recorrido no la trae. La columna es
          // opcional en la base y un cliente sin frecuencia es candidato
          // siempre. Ver la migración 20260915130000.
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
          A qué clientes tiene que visitar cada vendedor. De acá salen los candidatos que le
          aparecen en el teléfono, todos deseleccionados.
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
            El Excel tiene que tener una columna con el encabezado <b>Cod</b> (el código de cliente).
            El resto de las columnas se ignora, y las filas de arriba —logo, título— se saltean
            solas.
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
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {/* `revisadas` y no `filas`: es la lista que ya tiene marcados los
                  clientes repetidos, que es justamente lo que hay que ver acá
                  antes de cargar. */}
              {revisadas.map((f) => (
                <tr key={f.linea} style={f.problema ? { opacity: 0.6 } : undefined}>
                  <td>{f.linea}</td>
                  <td>
                    <code>{f.codigo || '—'}</code>
                  </td>
                  <td>{f.razonSocial ?? '—'}</td>
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

/** Deja un encabezado comparable: sin acentos, sin puntuación, en minúscula. */
function normalizarEncabezado(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** ¿Este encabezado es la columna del código de cliente? "Cod", "Código", … */
function esEncabezadoCodigo(texto: string): boolean {
  return /^cod(igo)?( de)?( cliente)?$/.test(normalizarEncabezado(texto))
}

/**
 * Lee el archivo y devuelve las filas crudas (una por código de cliente).
 *
 * Acepta .xlsx y .csv por el mismo camino: se arma una grilla de texto y se
 * busca la columna "Cod" por su nombre, no por su posición. La razón de leer
 * TODA la grilla y no sólo las primeras columnas es justamente esa: el código
 * puede estar en la tercera columna, después de un número de orden y de "Hora".
 */
async function leerPlanilla(archivo: File): Promise<Array<Pick<FilaLeida, 'linea' | 'codigo'>>> {
  const grilla = await grillaDeTexto(archivo)

  // La fila de encabezados es la primera que tenga una celda "Cod". Todo lo de
  // arriba —logo, título, filas en blanco— queda descartado solo.
  let filaEncabezado = -1
  let columnaCodigo = -1
  for (let i = 0; i < grilla.length && filaEncabezado < 0; i++) {
    const fila = grilla[i] ?? []
    for (let j = 0; j < fila.length; j++) {
      if (esEncabezadoCodigo(fila[j] ?? '')) {
        filaEncabezado = i
        columnaCodigo = j
        break
      }
    }
  }

  if (columnaCodigo < 0) {
    throw new Error(
      'No encontramos la columna del código. El Excel tiene que tener un encabezado "Cod" (o "Código") arriba de la columna con los códigos de cliente.',
    )
  }

  const filas: Array<Pick<FilaLeida, 'linea' | 'codigo'>> = []
  for (let i = filaEncabezado + 1; i < grilla.length; i++) {
    const codigo = (grilla[i]?.[columnaCodigo] ?? '').trim()
    if (!codigo) continue
    // La numeración que se muestra es la del Excel (1-based), para que "fila 7"
    // sea la fila 7 de la planilla y se pueda ir a mirarla.
    filas.push({ linea: i + 1, codigo })
  }

  if (filas.length === 0) {
    throw new Error(
      'Encontramos la columna "Cod" pero no hay ninguna fila con código debajo. Revisá el archivo.',
    )
  }
  return filas
}

/** Arma una grilla de celdas de texto, fila por fila, desde .xlsx o .csv. */
async function grillaDeTexto(archivo: File): Promise<string[][]> {
  const buffer = await archivo.arrayBuffer()

  if (archivo.name.toLowerCase().endsWith('.csv')) {
    const texto = new TextDecoder('utf-8').decode(buffer)
    return texto.split(/\r?\n/).map((linea) => linea.split(/[;,\t]/).map((c) => c.trim()))
  }

  const libro = new ExcelJS.Workbook()
  await libro.xlsx.load(buffer)
  const hoja = libro.worksheets[0]
  if (!hoja) throw new Error('El archivo no tiene ninguna hoja.')

  const grilla: string[][] = []
  hoja.eachRow({ includeEmpty: true }, (fila, numero) => {
    const celdas: string[] = []
    fila.eachCell({ includeEmpty: true }, (celda, columna) => {
      celdas[columna - 1] = textoDeCelda(celda)
    })
    grilla[numero - 1] = celdas
  })
  return grilla
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
 * Cruza los códigos contra el padrón.
 *
 * Se hace en una sola consulta y no una por fila: un rol maestro son cientos de
 * clientes, y cientos de idas y vueltas contra la base tardan lo suficiente
 * como para que alguien crea que se colgó.
 */
async function cruzarContraElPadron(
  filas: Array<Pick<FilaLeida, 'linea' | 'codigo'>>,
): Promise<FilaLeida[]> {
  const codigos = [...new Set(filas.map((f) => f.codigo).filter(Boolean))]
  if (codigos.length === 0) {
    return filas.map((f) => ({ ...f, clienteId: null, razonSocial: null, problema: 'Sin código de cliente' }))
  }

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
      problema: !c
        ? 'Ese código no está en el padrón'
        : !c.activo
          ? 'El cliente está dado de baja'
          : null,
    }
  })
}
