import {
  aNumero,
  CAMPOS_POR_HERRAMIENTA,
  descripcionSugerida,
  esDescripcionSugerida,
  ETIQUETA_HERRAMIENTA,
  ETIQUETA_ORIGEN_FRESA,
  ETIQUETA_TIPO_SERVICIO,
  formatearMoneda,
  formatearPesos,
  HERRAMIENTAS_POR_SERVICIO,
  SIERRA_MARCAS,
  soloNumeros,
  totalDelRenglon,
  totalDelRenglonEnPesos,
  type FormularioItemNota,
  type Herramienta,
  type OrigenFresa,
  type TipoServicio,
} from '@woodtools/compartido'
import { useEffect } from 'react'

import { BuscadorArticulo } from './BuscadorArticulo'
import { CampoDescuento } from './CampoDescuento'
import { Campo, Desplegable, SelectorMarca } from './Controles'

/**
 * Renglón de venta o reclamo (port del `FormularioVenta` del móvil).
 *
 * Es el único que no pide medidas: el código de la herramienta ya la identifica.
 * El reclamo se carga con el mismo buscador pero va SIEMPRE sin cargo.
 */

const SERVICIOS_RECLAMABLES: TipoServicio[] = [
  'afilado',
  'reparacion',
  'rectificado',
  'hermanado',
  'rebaje',
  'venta',
]

const CARACT_RECLAMO: {
  campoItem: 'diametro_exterior' | 'diametro_interior' | 'ancho_corte'
  campo: 'diametro_exterior' | 'diametro_interior_catalogo' | 'ancho_corte'
  etiqueta: string
}[] = [
  { campoItem: 'diametro_exterior', campo: 'diametro_exterior', etiqueta: 'Ø EXTERIOR' },
  { campoItem: 'diametro_interior', campo: 'diametro_interior_catalogo', etiqueta: 'Ø INTERIOR (AGUJERO)' },
  { campoItem: 'ancho_corte', campo: 'ancho_corte', etiqueta: 'ANCHO DE CORTE' },
]

export function FormularioVenta({
  item,
  alCambiar,
  errores,
  tipoCambio,
}: {
  item: FormularioItemNota
  alCambiar: (c: Partial<FormularioItemNota>) => void
  errores: Record<string, string | undefined>
  tipoCambio: number
}) {
  const unidades = aNumero(item.unidades)
  const unitario = aNumero(item.precio)
  const total = totalDelRenglon(item)
  const enPesos = totalDelRenglonEnPesos(item, tipoCambio)
  const esReclamo = item.servicio === 'reclamo'

  // La descripción sale de la herramienta igual que en los renglones de servicio.
  useEffect(() => {
    const sugerida = descripcionSugerida(item.herramienta, item.servicio, null, item.sierra_marca)
    if (item.descripcion !== sugerida && esDescripcionSugerida(item.descripcion)) {
      alCambiar({ descripcion: sugerida })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.herramienta, item.servicio, item.sierra_marca])

  return (
    <div>
      <Desplegable<Herramienta>
        etiqueta={esReclamo ? 'QUÉ SE RECLAMA' : 'QUÉ SE VENDE'}
        obligatorio
        marcador="Elegí la herramienta"
        valor={item.herramienta}
        items={HERRAMIENTAS_POR_SERVICIO[item.servicio].map((h) => ({
          valor: h,
          etiqueta: ETIQUETA_HERRAMIENTA[h],
          descripcion:
            h === 'sierra_sin_fin' && !esReclamo ? 'Va en una nota de pedido aparte' : undefined,
        }))}
        onChange={(h) =>
          alCambiar(
            h === item.herramienta
              ? { herramienta: h }
              : {
                  herramienta: h,
                  origen_fresa: null,
                  codigo_herramienta: '',
                  descripcion_catalogo: '',
                  precio: '',
                  moneda: 'ARS',
                  diametro_exterior: '',
                  diametro_interior_catalogo: '',
                  ancho_corte: '',
                  cantidad_dientes: '',
                  largo: '',
                  ancho: '',
                  espesor: '',
                  sierra_marca: null,
                },
          )
        }
        error={errores.herramienta}
      />

      {esReclamo ? (
        <Desplegable<TipoServicio>
          etiqueta="¿POR QUÉ SE RECLAMA?"
          obligatorio
          marcador="Elegí el trabajo reclamado"
          valor={item.servicio_reclamado}
          items={SERVICIOS_RECLAMABLES.map((s) => ({
            valor: s,
            etiqueta: s === 'venta' ? 'Vino fallada' : ETIQUETA_TIPO_SERVICIO[s],
            descripcion: s === 'venta' ? 'La herramienta que vendimos vino con falla' : undefined,
          }))}
          onChange={(s) => alCambiar({ servicio_reclamado: s })}
          error={errores.servicio_reclamado}
        />
      ) : null}

      {item.herramienta === 'fresa' && !esReclamo ? (
        <Desplegable<OrigenFresa>
          etiqueta="ORIGEN DE LA FRESA"
          obligatorio
          marcador="Nacional o importada"
          valor={item.origen_fresa}
          items={[
            { valor: 'nacional', etiqueta: ETIQUETA_ORIGEN_FRESA.nacional, descripcion: 'Nota aparte, facturada en pesos' },
            { valor: 'importada', etiqueta: ETIQUETA_ORIGEN_FRESA.importada, descripcion: 'Va con el resto de la venta, cotizada en dólares' },
          ]}
          onChange={(o) => alCambiar({ origen_fresa: o })}
          error={errores.origen_fresa}
        />
      ) : null}

      <BuscadorArticulo
        item={item}
        alElegir={alCambiar}
        tipoCambio={tipoCambio}
        error={errores.codigo_herramienta}
      />

      {item.herramienta === 'sierra' ? (
        <SelectorMarca
          etiqueta="MARCA"
          valor={item.sierra_marca}
          marcas={SIERRA_MARCAS}
          onChange={(m) => alCambiar({ sierra_marca: m })}
        />
      ) : null}

      {esReclamo && item.herramienta
        ? CARACT_RECLAMO.filter((c) => CAMPOS_POR_HERRAMIENTA[item.herramienta!].includes(c.campoItem)).map((c) => (
            <Campo
              key={c.campo}
              etiqueta={c.etiqueta}
              value={item[c.campo]}
              onChange={(t) => alCambiar({ [c.campo]: t.replace(/[^\d.,]/g, '') } as Partial<FormularioItemNota>)}
              inputMode="decimal"
              ayuda="Sale del artículo; corregilo si la pieza es distinta."
            />
          ))
        : null}

      {item.herramienta && CAMPOS_POR_HERRAMIENTA[item.herramienta].includes('cantidad_dientes') ? (
        <Campo
          etiqueta="CANTIDAD DE DIENTES"
          value={item.cantidad_dientes}
          onChange={(t) => alCambiar({ cantidad_dientes: t.replace(/\D/g, '') })}
          inputMode="numeric"
          ayuda="Sale de la lista al elegir el artículo. Va impresa en la columna Z-Paso; no cambia el precio."
        />
      ) : null}

      <Campo
        etiqueta="UNIDADES"
        obligatorio
        value={item.unidades}
        onChange={(t) => alCambiar({ unidades: soloNumeros(t) })}
        inputMode="numeric"
        error={errores.unidades}
      />

      {esReclamo ? (
        <div className="campo">
          <strong style={{ color: 'var(--verde-oscuro)' }}>SIN CARGO</strong>
          <div style={{ fontSize: 12, color: 'var(--tinta-suave)' }}>
            El reclamo se rehace sin cobrar: el renglón va en $ 0.
          </div>
        </div>
      ) : (
        <>
          <Campo
            etiqueta={item.moneda === 'USD' ? 'PRECIO UNITARIO (US$)' : 'PRECIO UNITARIO'}
            obligatorio
            value={item.precio}
            onChange={(t) => alCambiar({ precio: soloNumeros(t) })}
            inputMode="decimal"
            error={errores.precio}
            ayuda={unitario > 0 ? formatearMoneda(unitario, item.moneda) : undefined}
          />

          {total > 0 && unidades > 0 ? (
            <p style={{ fontWeight: 700, fontSize: 13, color: 'var(--verde-oscuro)', marginTop: -8 }}>
              {`${unidades} × ${formatearMoneda(unitario, item.moneda)} = ${formatearMoneda(total, item.moneda)}`}
              {item.moneda === 'USD' && tipoCambio > 0 ? (
                <span style={{ fontWeight: 400, color: 'var(--tinta-suave)' }}>
                  {`  ≈ ${formatearPesos(enPesos)} al cambio de hoy`}
                </span>
              ) : null}
            </p>
          ) : null}

          <CampoDescuento item={item} alCambiar={alCambiar} error={errores.descuento} />
        </>
      )}
    </div>
  )
}
