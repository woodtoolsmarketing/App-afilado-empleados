import {
  agruparParaNotas,
  armarPlazoDePago,
  CONDICIONES_CON_PLAZO,
  DESCRIPCION_GRUPO_NOTA,
  ETIQUETA_CONDICION_VENTA,
  ETIQUETA_GRUPO_NOTA,
  ETIQUETA_TIPO_NOTA,
  formatearFechaCorta,
  formatearPesos,
  OBSERVACION_MAXIMO_CARACTERES,
  opcionesHasta,
  PLAZO_DESDE_DIAS,
  plazoDePago,
  soloNumeros,
  totalDeRenglones,
  type CondicionVenta,
  type FormularioItemNota,
  type TipoNotaPedido,
} from '@woodtools/compartido'

import type { Cotizacion } from '../../servicios/notasPedido'
import { Aviso, Campo, Desplegable, MensajeError } from './Controles'

/**
 * Cómo se cobra la nota (port de la tercera página del móvil).
 *
 * Tipo de nota, condición de venta (con el plazo del cheque / cuenta corriente),
 * observaciones, el reparto en comprobantes (`agruparParaNotas`), el tipo de
 * cambio cuando hay dólares, y el total con los descuentos ya aplicados
 * (`totalDeRenglones`) — el mismo número que va a salir impreso.
 */
export function ResumenFacturacion({
  tipoNota,
  onTipoNota,
  condicionVenta,
  condicionDetalle,
  onCondicionVenta,
  onCondicionDetalle,
  observaciones,
  onEscribirObservacion,
  onQuitarObservacion,
  observacionesDelSistema,
  items,
  tipoCambio,
  hayDolares,
  cotizacion,
  cargandoCotizacion,
  buscandoCotizacion,
  reintentarCotizacion,
  cambioPropio,
  onCambioPropio,
  cambioEnUso,
  cambioPisado,
  errores,
}: {
  tipoNota: TipoNotaPedido | null
  onTipoNota: (t: TipoNotaPedido) => void
  condicionVenta: CondicionVenta | null
  condicionDetalle: string
  onCondicionVenta: (c: CondicionVenta) => void
  onCondicionDetalle: (detalle: string) => void
  observaciones: string[]
  onEscribirObservacion: (indice: number, texto: string) => void
  onQuitarObservacion: (indice: number) => void
  observacionesDelSistema: string[]
  items: FormularioItemNota[]
  tipoCambio: number
  hayDolares: boolean
  cotizacion: Cotizacion | undefined
  cargandoCotizacion: boolean
  buscandoCotizacion: boolean
  reintentarCotizacion: () => void
  cambioPropio: string
  onCambioPropio: (t: string) => void
  cambioEnUso: number
  cambioPisado: boolean
  errores: Record<string, string | undefined>
}) {
  const plazoElegido = plazoDePago(condicionDetalle)
  const grupos = agruparParaNotas(items, tipoCambio)
  const totalNota = totalDeRenglones(items, tipoCambio)

  function cambiarPlazo(desde: number | undefined, hasta: number | undefined) {
    onCondicionDetalle(armarPlazoDePago(desde, hasta))
  }

  return (
    <div>
      <div className="fila">
        <Desplegable<TipoNotaPedido>
          etiqueta="Tipo de nota de pedido"
          obligatorio
          marcador="Elegí el tipo"
          valor={tipoNota}
          items={[
            { valor: 'factura', etiqueta: ETIQUETA_TIPO_NOTA.factura, descripcion: 'Sale con el logo de WoodTools' },
            { valor: 'presupuesto', etiqueta: ETIQUETA_TIPO_NOTA.presupuesto, descripcion: 'Sale sin logo' },
          ]}
          onChange={onTipoNota}
          error={errores.tipo_nota}
          estiloContenedor={{ marginBottom: 14 }}
        />
        <Desplegable<CondicionVenta>
          etiqueta="Condición de venta"
          obligatorio
          marcador="Cómo se cobra"
          valor={condicionVenta}
          items={(Object.keys(ETIQUETA_CONDICION_VENTA) as CondicionVenta[]).map((c) => ({
            valor: c,
            etiqueta: ETIQUETA_CONDICION_VENTA[c],
          }))}
          onChange={(c) => {
            onCondicionVenta(c)
            onCondicionDetalle('')
          }}
          error={errores.condicion_venta}
          estiloContenedor={{ marginBottom: 14 }}
        />
      </div>

      {condicionVenta && CONDICIONES_CON_PLAZO.includes(condicionVenta) ? (
        <>
          <div className="fila">
            <Desplegable<string>
              etiqueta="De"
              obligatorio
              marcador="Desde"
              valor={plazoElegido?.desde !== undefined ? String(plazoElegido.desde) : null}
              items={PLAZO_DESDE_DIAS.map((d) => ({ valor: String(d), etiqueta: `${d} días` }))}
              onChange={(v) => cambiarPlazo(Number(v), plazoElegido?.hasta)}
              estiloContenedor={{ marginBottom: 6 }}
            />
            <Desplegable<string>
              etiqueta="Hasta"
              obligatorio
              marcador="Hasta"
              valor={plazoElegido?.hasta !== undefined ? String(plazoElegido.hasta) : null}
              items={opcionesHasta(plazoElegido?.desde, plazoElegido?.hasta).map((d) => ({
                valor: String(d),
                etiqueta: `${d} días`,
              }))}
              onChange={(v) => cambiarPlazo(plazoElegido?.desde, Number(v))}
              estiloContenedor={{ marginBottom: 6 }}
            />
          </div>
          <MensajeError>{errores.condicion_venta_detalle}</MensajeError>
        </>
      ) : null}

      {condicionVenta === 'otro' ? (
        <Campo
          etiqueta="¿Cuál es la condición?"
          obligatorio
          value={condicionDetalle}
          onChange={onCondicionDetalle}
          placeholder="Ej. Retira y paga en fábrica"
          error={errores.condicion_venta_detalle}
        />
      ) : null}

      {grupos.length > 1 ? (
        <div
          style={{
            border: '2px solid var(--azul)',
            borderRadius: 'var(--radio)',
            background: 'var(--blanco)',
            padding: 12,
            marginBottom: 14,
          }}
        >
          <div style={{ fontWeight: 800, color: 'var(--azul)', fontSize: 12, letterSpacing: 0.6 }}>
            ESTO YA NO ENTRA EN UNA SOLA NOTA
          </div>
          {grupos.map((g) => (
            <div key={g.grupo} style={{ marginTop: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <strong>{ETIQUETA_GRUPO_NOTA[g.grupo]}</strong>
                <strong style={{ color: 'var(--verde-oscuro)' }}>{formatearPesos(g.total)}</strong>
              </div>
              <div style={{ fontSize: 12, color: 'var(--tinta-suave)' }}>
                {g.items.length} {g.items.length === 1 ? 'renglón' : 'renglones'} ·{' '}
                {DESCRIPCION_GRUPO_NOTA[g.grupo]}
              </div>
            </div>
          ))}
          <p style={{ fontSize: 12, color: 'var(--tinta-suave)', marginTop: 8 }}>
            Esta nota ya tiene su número y no se puede partir en dos. Sacá de acá lo que no
            corresponda; al guardar se rechaza si quedan dos grupos.
          </p>
        </div>
      ) : null}

      {hayDolares ? (
        <div
          style={{
            border: '2px solid var(--negro)',
            borderRadius: 'var(--radio)',
            background: 'var(--panel-claro)',
            padding: 12,
            marginBottom: 14,
          }}
        >
          <div style={{ fontWeight: 800, color: 'var(--rojo)', fontSize: 12, letterSpacing: 0.6 }}>
            TIPO DE CAMBIO
          </div>
          {cargandoCotizacion ? (
            <div>Buscando…</div>
          ) : cotizacion ? (
            <>
              <div style={{ fontWeight: 700, fontSize: 16 }}>{formatearPesos(cambioEnUso)}</div>
              <div style={{ fontSize: 12, color: 'var(--tinta-suave)' }}>
                {cambioPisado
                  ? `Lo pusiste vos. El oficial del ${formatearFechaCorta(cotizacion.fecha)} es ${formatearPesos(cotizacion.venta)}.`
                  : `Dólar oficial del ${formatearFechaCorta(cotizacion.fecha)}${cotizacion.aproximada ? ' (última disponible)' : ''}`}
              </div>
              <Campo
                etiqueta="Tipo de cambio a usar"
                value={cambioPropio}
                onChange={(t) => onCambioPropio(soloNumeros(t))}
                placeholder={String(cotizacion.venta)}
                inputMode="decimal"
                ayuda="Dejalo vacío para usar el oficial."
                estiloContenedor={{ marginTop: 8, marginBottom: 0, maxWidth: 240 }}
              />
            </>
          ) : (
            <>
              <div style={{ color: 'var(--rojo-accion)', fontSize: 13 }}>
                No pudimos traer la cotización, y esta nota tiene renglones en dólares. Reintentá, o
                poné el tipo de cambio a mano para poder guardarla.
              </div>
              <Campo
                etiqueta="Tipo de cambio a usar"
                value={cambioPropio}
                onChange={(t) => onCambioPropio(soloNumeros(t))}
                inputMode="decimal"
                estiloContenedor={{ marginTop: 8, marginBottom: 0, maxWidth: 240 }}
              />
              <button
                type="button"
                className="chico"
                disabled={buscandoCotizacion}
                onClick={reintentarCotizacion}
                style={{ marginTop: 8 }}
              >
                {buscandoCotizacion ? 'Buscando…' : '↻ Reintentar'}
              </button>
            </>
          )}
        </div>
      ) : null}

      {/* Observaciones: una por renglón, el siguiente aparece solo. */}
      <div
        style={{
          border: '2px solid var(--negro)',
          borderRadius: 'var(--radio)',
          background: 'var(--blanco)',
          padding: 12,
          marginBottom: 14,
        }}
      >
        <div style={{ fontWeight: 800, color: 'var(--rojo)', fontSize: 12, letterSpacing: 0.6, marginBottom: 6 }}>
          OBSERVACIONES
        </div>
        {observaciones.map((texto, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{ color: 'var(--rojo)', fontWeight: 700, minWidth: 16 }}>{i + 1}</span>
            <input
              value={texto}
              onChange={(e) => onEscribirObservacion(i, e.target.value)}
              placeholder={i === 0 ? 'Ej. Retira el jueves a la mañana' : ''}
              maxLength={OBSERVACION_MAXIMO_CARACTERES}
              style={{ flex: 1 }}
            />
            {observaciones.length > 1 ? (
              <button
                type="button"
                className="chico"
                onClick={() => onQuitarObservacion(i)}
                aria-label={`Quitar la observación ${i + 1}`}
              >
                ✕
              </button>
            ) : null}
          </div>
        ))}
        <p style={{ fontSize: 12, color: 'var(--tinta-suave)', margin: 0 }}>
          Una por renglón, hasta {OBSERVACION_MAXIMO_CARACTERES} caracteres cada una.
        </p>
        {observacionesDelSistema.length > 0 ? (
          <p style={{ fontSize: 12, color: 'var(--tinta-suave)', margin: '4px 0 0' }}>
            {observacionesDelSistema.join(' · ')} — lo pone el sistema y se mantiene.
          </p>
        ) : null}
      </div>

      {totalNota > 0 ? (
        <Aviso tono="exito" titulo={items.length > 1 ? `Total de la nota · ${items.length} renglones` : 'Total del renglón'}>
          {formatearPesos(totalNota)}
        </Aviso>
      ) : null}
    </div>
  )
}
