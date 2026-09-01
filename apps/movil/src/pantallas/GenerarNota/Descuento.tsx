import {
  DESCUENTOS_DISPONIBLES,
  descuentoDelRenglon,
  espaciado,
  formatearMoneda,
  totalDelRenglon,
  type FormularioItemNota,
} from '@woodtools/compartido'
import { Text, View } from 'react-native'

import { Casilla, Desplegable } from '../../componentes/Formulario'
import { hojaDeTema } from '../../nucleo/tema'

/**
 * El descuento del renglón: la casilla que lo habilita y el porcentaje.
 *
 * Vive en su propio archivo porque lo usan los dos formularios —el de venta,
 * que está en `index.tsx`, y el de servicio, que está en `Renglon.tsx`—. Antes
 * la promoción existía sólo en el de venta; ahora un cliente grande negocia el
 * afilado igual que la sierra, así que tenía que estar en los dos y no podía
 * quedar escrito dos veces.
 *
 * Se muestra la cuenta hecha, no sólo el porcentaje. Es la misma razón por la
 * que el renglón imprime "32 × $ 139.656 = $ 4.468.992" en vez del total pelado:
 * un importe grande no se puede revisar, hay que aceptarlo o rehacerlo a mano.
 * Con el antes y el después a la vista, un 65 % tocado sin querer se ve al
 * instante — y se ve en la pantalla, que es donde todavía se puede arreglar.
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
  const estilos = usarEstilos()
  const porcentaje = descuentoDelRenglon(item)

  // El total de lista es el mismo renglón sin el descuento. Se recalcula en vez
  // de guardarse para que no pueda quedar viejo cuando cambian los dientes, las
  // unidades o el precio.
  const conDescuento = totalDelRenglon(item)
  const deLista = totalDelRenglon({ ...item, promocion: false })
  const ahorro = deLista - conDescuento

  // El afilado siempre se cobra en pesos; sólo la venta puede ir en dólares.
  const moneda = item.servicio === 'venta' ? item.moneda : 'ARS'

  return (
    <>
      {/* Por defecto "no". Apagarla borra el porcentaje: dejarlo puesto haría
          que volver a marcarla aplicara un descuento que nadie eligió. */}
      <Casilla
        etiqueta="PROMOCIÓN"
        valor={item.promocion}
        alCambiar={(v) => alCambiar({ promocion: v, ...(v ? {} : { descuento: '' }) })}
      />

      {item.promocion ? (
        <View>
          <Desplegable
            etiqueta="DESCUENTO"
            obligatorio
            marcador="Elegí cuánto"
            valor={item.descuento || null}
            items={DESCUENTOS_DISPONIBLES.map((d) => ({
              valor: String(d),
              etiqueta: `${d} %`,
            }))}
            alCambiar={(v) => alCambiar({ descuento: v })}
            error={error}
          />

          {porcentaje > 0 && deLista > 0 ? (
            <Text style={estilos.cuenta}>
              {`${formatearMoneda(deLista, moneda)} − ${porcentaje} % = `}
              <Text style={estilos.resultado}>{formatearMoneda(conDescuento, moneda)}</Text>
              {`  (se le descuentan ${formatearMoneda(ahorro, moneda)})`}
            </Text>
          ) : null}
        </View>
      ) : null}
    </>
  )
}

const usarEstilos = hojaDeTema((t) => ({
  cuenta: {
    fontFamily: t.tipografia.familia.liviana,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.tintaSuave,
    marginTop: -espaciado.xs,
    marginBottom: espaciado.sm,
  },
  resultado: {
    fontFamily: t.tipografia.familia.fuerte,
    color: t.colores.verdeOscuro,
  },
}))
