import {
  caracteristicasDeArticulo,
  descripcionSugerida,
  esDescripcionSugerida,
  ETIQUETA_HERRAMIENTA,
  FAMILIA_PRODUCTO,
  formatearMoneda,
  formatearPesos,
  marcaDeCodigo,
  resumenCaracteristicas,
  type CaracteristicasArticulo,
  type FormularioItemNota,
} from '@woodtools/compartido'
import { useEffect, useRef, useState } from 'react'

import {
  buscarArticulos,
  FAMILIA_COMPLETA,
  LISTA_SUELTA,
  type ArticuloCatalogo,
} from '../../servicios/notasPedido'
import { Aviso, Campo, MensajeError, Pastilla } from './Controles'

/**
 * Buscador del catálogo de precios para cotizar una venta.
 *
 * Port del móvil (`GenerarNota/BuscadorArticulo.tsx`): misma lógica —precarga la
 * familia entera y filtra en el navegador, salida a "toda la lista", filtros por
 * Ø/ancho/dientes, elegir completa el renglón con las características de la
 * lista—. En el panel no hace falta la ventana modal del teléfono: la búsqueda
 * se abre como un panel debajo del botón.
 */
export function BuscadorArticulo({
  item,
  alElegir,
  tipoCambio,
  error,
}: {
  item: FormularioItemNota
  alElegir: (cambios: Partial<FormularioItemNota>) => void
  tipoCambio: number
  error?: string
}) {
  const [abierto, setAbierto] = useState(false)

  const elegido = item.codigo_herramienta
    ? caracteristicasDeArticulo(item.descripcion_catalogo || item.descripcion, null)
    : null

  return (
    <div className="campo">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        style={{ width: '100%', ...(error ? { borderColor: 'var(--rojo-accion)' } : {}) }}
      >
        {abierto
          ? '▲  Cerrar la lista'
          : item.codigo_herramienta
            ? '🔎  Cambiar el artículo'
            : '🔎  Buscar el artículo en la lista'}
      </button>
      <MensajeError>{error}</MensajeError>

      {item.codigo_herramienta ? (
        <div
          style={{
            border: '2px solid var(--verde-oscuro)',
            borderRadius: 'var(--radio)',
            background: 'var(--blanco)',
            padding: 10,
            marginTop: 8,
          }}
        >
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 4 }}>
            <Pastilla texto={item.codigo_herramienta} color="verde" />
            {item.moneda === 'USD' ? <Pastilla texto="LISTA EN US$" color="azul" /> : null}
          </div>
          <div style={{ fontWeight: 700, fontSize: 13 }}>
            {item.descripcion_catalogo || item.descripcion}
          </div>
          {elegido && resumenCaracteristicas(elegido) ? (
            <div style={{ fontSize: 12, color: 'var(--tinta-suave)' }}>
              {resumenCaracteristicas(elegido)}
            </div>
          ) : null}
          {item.moneda === 'USD' && tipoCambio > 0 ? (
            <div style={{ fontSize: 12, color: 'var(--tinta-suave)' }}>
              {`Al cambio de hoy: ${formatearPesos(Number(item.precio) * tipoCambio)} por unidad`}
            </div>
          ) : null}
        </div>
      ) : null}

      {abierto ? (
        <PanelBusqueda
          item={item}
          tipoCambio={tipoCambio}
          alElegir={(cambios) => {
            alElegir(cambios)
            setAbierto(false)
          }}
        />
      ) : null}
    </div>
  )
}

function PanelBusqueda({
  item,
  alElegir,
  tipoCambio,
}: {
  item: FormularioItemNota
  alElegir: (cambios: Partial<FormularioItemNota>) => void
  tipoCambio: number
}) {
  const [consulta, setConsulta] = useState('')
  const [baseFamilia, setBaseFamilia] = useState<ArticuloCatalogo[] | null>(null)
  const [resultados, setResultados] = useState<ArticuloCatalogo[]>([])
  const [buscando, setBuscando] = useState(false)
  const [fallo, setFallo] = useState<string | null>(null)
  const [reintento, setReintento] = useState(0)
  const [todaLaLista, setTodaLaLista] = useState(false)
  const [filtroDiametro, setFiltroDiametro] = useState('')
  const [filtroAncho, setFiltroAncho] = useState('')
  const [filtroDientes, setFiltroDientes] = useState('')
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null)

  const familia = todaLaLista || !item.herramienta ? null : FAMILIA_PRODUCTO[item.herramienta]
  const texto = consulta.trim()
  const hayTextoSuelto = texto.length >= 2

  // Precarga de la familia entera: una sola consulta y el resto filtra local.
  useEffect(() => {
    if (familia === null) {
      setBaseFamilia(null)
      setBuscando(false)
      return
    }
    let cancelado = false
    setBaseFamilia(null)
    setBuscando(true)
    setFallo(null)
    buscarArticulos('', familia, FAMILIA_COMPLETA)
      .then((todos) => {
        if (!cancelado) setBaseFamilia(todos)
      })
      .catch((e) => {
        if (!cancelado) {
          setBaseFamilia([])
          setFallo((e as Error).message)
        }
      })
      .finally(() => {
        if (!cancelado) setBuscando(false)
      })
    return () => {
      cancelado = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [familia, reintento])

  // Búsqueda en TODA la lista (sin familia): sigue consultando el servidor.
  useEffect(() => {
    if (familia !== null) {
      setResultados([])
      return
    }
    if (temporizador.current) clearTimeout(temporizador.current)
    if (!hayTextoSuelto) {
      setResultados([])
      setFallo(null)
      return
    }
    let cancelado = false
    temporizador.current = setTimeout(async () => {
      setBuscando(true)
      setFallo(null)
      try {
        const encontrados = await buscarArticulos(texto, null)
        if (cancelado) return
        setResultados(encontrados)
      } catch (e) {
        if (cancelado) return
        setResultados([])
        setFallo((e as Error).message)
      } finally {
        if (!cancelado) setBuscando(false)
      }
    }, 300)
    return () => {
      cancelado = true
      if (temporizador.current) clearTimeout(temporizador.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texto, familia, hayTextoSuelto, reintento])

  const lista = familia !== null ? filtrarFamilia(baseFamilia ?? [], texto) : resultados
  const sinResultados =
    !buscando &&
    !fallo &&
    lista.length === 0 &&
    (familia !== null ? baseFamilia !== null : hayTextoSuelto)
  const familiaTruncada = familia !== null && (baseFamilia?.length ?? 0) >= FAMILIA_COMPLETA

  function elegir(a: ArticuloCatalogo) {
    const c = caracteristicasDeArticulo(a.descripcion, a.medida)
    const esVentaSierra = item.servicio === 'venta' && item.herramienta === 'sierra'
    const nuevaMarca = esVentaSierra ? marcaDeCodigo(a.codigo) : item.sierra_marca
    alElegir({
      codigo_herramienta: a.codigo,
      ...(esDescripcionSugerida(item.descripcion)
        ? { descripcion: descripcionSugerida(item.herramienta, item.servicio, null, nuevaMarca) }
        : {}),
      ...(esVentaSierra ? { sierra_marca: nuevaMarca } : {}),
      descripcion_catalogo: a.descripcion,
      precio: String(a.precio),
      moneda: a.moneda === 'USD' ? 'USD' : 'ARS',
      diametro_exterior: c.diametro_exterior ?? '',
      diametro_interior_catalogo: c.diametro_interior ?? '',
      ancho_corte: c.ancho_corte ?? '',
      cantidad_dientes: c.dientes ?? '',
      largo: c.largo ?? '',
      ancho: c.ancho ?? '',
      espesor: c.espesor ?? '',
    })
  }

  const aNum = (s: string | null | undefined): number | null => {
    if (!s) return null
    const n = Number(String(s).replace(',', '.').replace(/[^\d.]/g, ''))
    return Number.isFinite(n) ? n : null
  }
  const dientesCoincide = (a: ArticuloCatalogo, filtro: number): boolean => {
    if (a.dientes === filtro) return true
    const m = /[Zz]\s*=?\s*(\d+(?:\s*\+\s*\d+)*)/.exec(`${a.descripcion ?? ''} ${a.medida ?? ''}`)
    if (!m) return false
    const partes = m[1].split('+').map((p) => Number(p.trim())).filter((n) => Number.isFinite(n))
    return partes.includes(filtro) || partes.reduce((x, y) => x + y, 0) === filtro
  }
  const fDiam = aNum(filtroDiametro)
  const fAncho = aNum(filtroAncho)
  const fDientes = aNum(filtroDientes)
  const visibles = lista.filter((a) => {
    if (fDiam === null && fAncho === null && fDientes === null) return true
    const c = caracteristicasDeArticulo(a.descripcion, a.medida)
    const diam = a.diametro_exterior ?? aNum(c.diametro_exterior)
    const ancho = a.ancho_corte ?? aNum(c.ancho_corte)
    if (fDiam !== null && diam !== fDiam) return false
    if (fAncho !== null && ancho !== fAncho) return false
    if (fDientes !== null && !dientesCoincide(a, fDientes)) return false
    return true
  })

  const prefijo = prefijoComun(visibles.map((a) => a.codigo))
  const loQueSeLista = item.herramienta
    ? ETIQUETA_HERRAMIENTA[item.herramienta].toLowerCase()
    : 'la lista'
  const hayFiltroCaract = fDiam !== null || fAncho !== null || fDientes !== null

  return (
    <div
      style={{
        border: '2px solid var(--negro)',
        borderRadius: 'var(--radio)',
        background: 'var(--panel-claro)',
        padding: 12,
        marginTop: 8,
      }}
    >
      <Campo
        etiqueta={familia ? 'Buscar entre lo que se vende' : 'Buscar en la lista de precios'}
        value={consulta}
        onChange={setConsulta}
        placeholder={familia ? 'Achicá la lista — ej. LU3F o 300' : 'Código o descripción — ej. LG2B'}
      />

      <div className="fila" style={{ marginBottom: 10 }}>
        <Campo etiqueta="Ø EXT." value={filtroDiametro} onChange={setFiltroDiametro} placeholder="250" inputMode="decimal" estiloContenedor={{ marginBottom: 0 }} />
        <Campo etiqueta="ANCHO" value={filtroAncho} onChange={setFiltroAncho} placeholder="3,2" inputMode="decimal" estiloContenedor={{ marginBottom: 0 }} />
        <Campo etiqueta="DIENTES" value={filtroDientes} onChange={setFiltroDientes} placeholder="80" inputMode="numeric" estiloContenedor={{ marginBottom: 0 }} />
      </div>

      {buscando ? <p style={{ fontSize: 13 }}>Buscando…</p> : null}

      {visibles.length > 0 ? (
        <div
          style={{
            border: '2px solid var(--negro)',
            borderRadius: 'var(--radio)',
            background: 'var(--blanco)',
            maxHeight: 320,
            overflowY: 'auto',
          }}
        >
          {visibles.map((a) => (
            <FilaMedida
              key={`${a.codigo}|${a.descripcion}`}
              articulo={a}
              prefijo={prefijo}
              tipoCambio={tipoCambio}
              alTocar={() => elegir(a)}
            />
          ))}
        </div>
      ) : null}

      {!hayFiltroCaract && familia === null && resultados.length >= LISTA_SUELTA ? (
        <p style={{ fontSize: 12, color: 'var(--tinta-suave)', marginTop: 6 }}>
          {`Hay más de ${LISTA_SUELTA} que coinciden y se muestran los primeros. Escribí un poco más, o usá los filtros de arriba.`}
        </p>
      ) : null}

      {familiaTruncada ? (
        <p style={{ fontSize: 12, color: 'var(--tinta-suave)', marginTop: 6 }}>
          {`Se cargaron los primeros ${baseFamilia?.length ?? 0} de ${loQueSeLista}. Si el que buscás no aparece, tocá "Buscar en toda la lista".`}
        </p>
      ) : null}

      {hayFiltroCaract && lista.length > 0 && visibles.length === 0 ? (
        <Aviso tono="atencion">
          {`Ninguno de los ${lista.length} que se cargaron coincide con esos filtros. Probá con otra medida, o borrá los filtros.`}
        </Aviso>
      ) : null}

      {fallo && !buscando ? (
        <>
          <Aviso tono="atencion" titulo="No pudimos consultar la lista de precios">
            {fallo} Revisá la conexión y reintentá.
          </Aviso>
          <button type="button" className="chico" onClick={() => setReintento((n) => n + 1)}>
            ↻ Reintentar
          </button>
        </>
      ) : null}

      {sinResultados ? (
        <Aviso tono="atencion">
          {familia
            ? `No hay ninguna ${loQueSeLista} con eso. Probá con menos letras, o mirá toda la lista con el botón de abajo.`
            : 'No hay ningún artículo con eso. Probá con menos letras, o con parte de la descripción.'}
        </Aviso>
      ) : null}

      {item.herramienta ? (
        <button
          type="button"
          className="chico"
          style={{ marginTop: 8 }}
          onClick={() => setTodaLaLista((v) => !v)}
        >
          {todaLaLista
            ? `◂ Volver a ${ETIQUETA_HERRAMIENTA[item.herramienta].toLowerCase()}`
            : 'Buscar en toda la lista de precios'}
        </button>
      ) : null}
    </div>
  )
}

function FilaMedida({
  articulo,
  prefijo,
  tipoCambio,
  alTocar,
}: {
  articulo: ArticuloCatalogo
  prefijo: string
  tipoCambio: number
  alTocar: () => void
}) {
  const c: CaracteristicasArticulo = caracteristicasDeArticulo(articulo.descripcion, articulo.medida)
  const compacto = resumenCompacto(c)
  const moneda = articulo.moneda === 'USD' ? 'USD' : 'ARS'
  const codigoCorto =
    prefijo && articulo.codigo.startsWith(prefijo) ? articulo.codigo.slice(prefijo.length) : articulo.codigo

  return (
    <button
      type="button"
      onClick={alTocar}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        border: 'none',
        borderBottom: '1px solid var(--panel-oscuro)',
        borderRadius: 0,
        background: 'none',
        padding: '8px 12px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontWeight: 700 }}>
          {codigoCorto}
          {compacto ? <span style={{ fontWeight: 400, color: 'var(--tinta-suave)' }}>{`  ${compacto}`}</span> : null}
        </span>
        <span style={{ fontWeight: 700, color: 'var(--verde-oscuro)' }}>
          {articulo.sin_precio ? 'a confirmar' : formatearMoneda(Number(articulo.precio), moneda)}
        </span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--tinta-suave)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {articulo.descripcion}
      </div>
      {moneda === 'USD' && articulo.precio_pesos ? (
        <div style={{ fontSize: 11, color: 'var(--tinta-tenue)' }}>{`≈ ${formatearPesos(Number(articulo.precio_pesos))}`}</div>
      ) : moneda === 'USD' && tipoCambio > 0 ? (
        <div style={{ fontSize: 11, color: 'var(--tinta-tenue)' }}>{`≈ ${formatearPesos(Number(articulo.precio) * tipoCambio)}`}</div>
      ) : null}
    </button>
  )
}

function resumenCompacto(c: CaracteristicasArticulo): string {
  return [
    c.diametro_exterior ? `Ø${c.diametro_exterior}` : null,
    c.dientes ? `Z${c.dientes}` : null,
    c.ancho_corte ? `${c.ancho_corte}mm` : null,
  ]
    .filter(Boolean)
    .join(' ')
}

function filtrarFamilia(base: ArticuloCatalogo[], texto: string): ArticuloCatalogo[] {
  const t = texto.trim().toLowerCase()
  if (!t) return base
  const coincide = base.filter(
    (a) => a.codigo.toLowerCase().includes(t) || (a.descripcion ?? '').toLowerCase().includes(t),
  )
  return coincide.sort(
    (a, b) => (a.codigo.toLowerCase() === t ? 0 : 1) - (b.codigo.toLowerCase() === t ? 0 : 1),
  )
}

function prefijoComun(codigos: string[]): string {
  if (codigos.length < 2) return ''
  let comun = codigos[0]
  for (const c of codigos.slice(1)) {
    let i = 0
    while (i < comun.length && i < c.length && comun[i] === c[i]) i++
    comun = comun.slice(0, i)
    if (!comun) return ''
  }
  const corte = comun.lastIndexOf(' ')
  return corte > 0 ? comun.slice(0, corte + 1) : ''
}
