import {
  DESCUENTOS_DISPONIBLES,
  descuentoDelRenglon,
  formatearMoneda,
  totalDelRenglon,
  type FormularioItemNota,
} from '@woodtools/compartido'

import { Casilla, Desplegable } from './Controles'

/**
 * El descuento del renglón: la casilla que lo habilita y el porcentaje.
 *
 * Port del móvil (`GenerarNota/Descuento.tsx`). Se muestra la cuenta hecha —el
 * antes, el porcentaje y el después— porque un importe grande no se puede
 * revisar: con el antes y el después a la vista, un 65 % tocado sin querer se ve
 * al instante, y se ve acá, que es donde todavía se puede arreglar.
 */
export function CampoDescuento({
  item,
  alCambiar,
  error,
}: {
  item: FormularioItemNota
  alCambiar: (cambios: Partial<FormularioItemNota>) => void
  error?: string | null
}) {
  const porcentaje = descuentoDelRenglon(item)

  const conDescuento = totalDelRenglon(item)
  const deLista = totalDelRenglon({ ...item, promocion: false })
  const ahorro = deLista - conDescuento

  const moneda = item.servicio === 'venta' ? item.moneda : 'ARS'

  return (
    <>
      <Casilla
        etiqueta="PROMOCIÓN"
        valor={item.promocion}
        onChange={(v) => alCambiar({ promocion: v, ...(v ? {} : { descuento: '' }) })}
      />

      {item.promocion ? (
        <div>
          <Desplegable<string>
            etiqueta="DESCUENTO"
            obligatorio
            marcador="Elegí cuánto"
            valor={item.descuento || null}
            items={DESCUENTOS_DISPONIBLES.map((d) => ({ valor: String(d), etiqueta: `${d} %` }))}
            onChange={(v) => alCambiar({ descuento: v })}
            error={error}
          />

          {porcentaje > 0 && deLista > 0 ? (
            <p style={{ fontSize: 12.5, color: 'var(--tinta-suave)', marginTop: -8, marginBottom: 10 }}>
              {`${formatearMoneda(deLista, moneda)} − ${porcentaje} % = `}
              <strong style={{ color: 'var(--verde-oscuro)' }}>
                {formatearMoneda(conDescuento, moneda)}
              </strong>
              {`  (se le descuentan ${formatearMoneda(ahorro, moneda)})`}
            </p>
          ) : null}
        </div>
      ) : null}
    </>
  )
}
