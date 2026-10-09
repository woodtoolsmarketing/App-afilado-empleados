import {
  espaciado,
  fechaLocalISO,
  formatearFechaCorta,
  formatearPesos,
  radios,
} from '@woodtools/compartido'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Pressable, Text, View } from 'react-native'

import { BotonSecundario } from '../componentes/Botones'
import { Aviso, Cargando, Pastilla, Vacio } from '../componentes/Estado'
import { Encabezado } from '../componentes/Encabezado'
import { BarraPanel, Pantalla, Panel, TituloPanel } from '../componentes/Pantalla'
import { cobranzasDelDia } from '../servicios/cobranzas'
import type { PropsPantalla } from '../navegacion/tipos'
import { hojaDeTema, usarTema } from '../nucleo/tema'

/**
 * "HISTORIAL DE COBRANZAS"
 *
 * Sólo para MIRAR: el vendedor repasa, día por día, los cobros que cargó. La
 * carga se hace ahora desde el rol de visita (al tildar "COBRÓ") y la impresión
 * de la planilla es sólo de la oficina, así que acá no hay formulario ni botón
 * de imprimir —antes sí, cuando esta pantalla era "Cobranzas del día"—.
 *
 * Se navega por día con las flechas; no se puede ir al futuro.
 */
export function PantallaHistorialCobranzas({ navigation }: PropsPantalla<'Cobranzas'>) {
  const { colores } = usarTema()
  const estilos = usarEstilos()

  const hoy = fechaLocalISO(new Date())
  const [fecha, setFecha] = useState(hoy)
  const esHoy = fecha === hoy

  const { data: cobros, isLoading, isError, refetch } = useQuery({
    queryKey: ['cobranzas-del-dia', fecha],
    queryFn: () => cobranzasDelDia(fecha),
  })

  const total = (cobros ?? []).reduce((s, c) => s + Number(c.total), 0)

  function cambiarDia(delta: number) {
    const d = new Date(`${fecha}T12:00:00`)
    d.setDate(d.getDate() + delta)
    const nueva = fechaLocalISO(d)
    if (nueva > hoy) return // no se mira para adelante
    setFecha(nueva)
  }

  return (
    <Pantalla>
      <Encabezado />

      <Panel>
        <BarraPanel alVolver={() => navigation.goBack()} />
        <TituloPanel>HISTORIAL DE COBRANZAS</TituloPanel>

        {/* Navegar por día. "Hoy" no deja avanzar: no hay cobros del futuro. */}
        <View style={estilos.navDia}>
          <Pressable
            onPress={() => cambiarDia(-1)}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Día anterior"
            style={({ pressed }) => [estilos.flecha, pressed && estilos.flechaTocada]}
          >
            <Text style={estilos.flechaTexto}>‹</Text>
          </Pressable>
          <Text style={estilos.fechaTexto}>
            {esHoy ? 'HOY' : formatearFechaCorta(`${fecha}T12:00:00`)}
          </Text>
          <Pressable
            onPress={() => cambiarDia(1)}
            disabled={esHoy}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Día siguiente"
            style={({ pressed }) => [
              estilos.flecha,
              pressed && estilos.flechaTocada,
              esHoy && estilos.flechaInactiva,
            ]}
          >
            <Text style={[estilos.flechaTexto, esHoy && estilos.flechaTextoInactivo]}>›</Text>
          </Pressable>
        </View>

        {isLoading ? (
          <Cargando />
        ) : isError ? (
          <View style={estilos.lista}>
            <Aviso tono="error" titulo="No pudimos traer los cobros">
              Puede ser la señal. Reintentá.
            </Aviso>
            <BotonSecundario titulo="Reintentar" alTocar={() => void refetch()} />
          </View>
        ) : (cobros ?? []).length === 0 ? (
          <Vacio
            titulo={esHoy ? 'Todavía no cargaste ningún cobro hoy' : 'No hay cobros ese día'}
            detalle="Los cobros se cargan desde el rol de visita, al tildar “COBRÓ”."
          />
        ) : (
          <View style={estilos.lista}>
            {(cobros ?? []).map((c) => (
              <View key={c.id} style={estilos.fila}>
                <View style={estilos.filaIzquierda}>
                  <Text style={estilos.cliente}>
                    {c.cliente_codigo ? `${c.cliente_codigo} · ` : ''}
                    {c.cliente_nombre}
                  </Text>
                  <View style={estilos.pastillas}>
                    <Pastilla
                      texto={c.tipo_comprobante === 'factura' ? 'FACTURA' : 'PRESUPUESTO'}
                      color={colores.tintaSuave}
                    />
                    {c.cheque > 0 ? (
                      <Pastilla texto={`CHEQUE ${formatearPesos(c.cheque)}`} color={colores.azul} />
                    ) : null}
                    {c.efectivo > 0 ? (
                      <Pastilla
                        texto={`EFECTIVO ${formatearPesos(c.efectivo)}`}
                        color={colores.verdeOscuro}
                      />
                    ) : null}
                  </View>
                  {c.comentarios ? <Text style={estilos.comentario}>{c.comentarios}</Text> : null}
                </View>
                <Text style={estilos.monto}>{formatearPesos(c.total)}</Text>
              </View>
            ))}

            <View style={estilos.totalFila}>
              <Text style={estilos.totalRotulo}>TOTAL</Text>
              <Text style={estilos.totalMonto}>{formatearPesos(total)}</Text>
            </View>
          </View>
        )}
      </Panel>
    </Pantalla>
  )
}

const usarEstilos = hojaDeTema((t) => ({
  navDia: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: espaciado.xs,
  },
  flecha: {
    paddingHorizontal: espaciado.base,
    paddingVertical: espaciado.xs,
  },
  flechaTocada: { opacity: 0.5 },
  flechaInactiva: { opacity: 0.25 },
  flechaTexto: {
    fontFamily: t.tipografia.familia.fuerte,
    fontSize: t.tipografia.tamano.xl,
    color: t.colores.rojo,
  },
  flechaTextoInactivo: { color: t.colores.tintaSuave },
  fechaTexto: {
    fontFamily: t.tipografia.familia.subtitulo,
    fontSize: t.tipografia.tamano.base,
    color: t.colores.tinta,
    letterSpacing: 0.5,
  },
  lista: { gap: espaciado.sm },
  fila: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: espaciado.sm,
    backgroundColor: t.colores.panelClaro,
    borderRadius: radios.sm,
    padding: espaciado.sm,
  },
  filaIzquierda: { flex: 1, gap: espaciado.xs },
  cliente: {
    fontFamily: t.tipografia.familia.fuerte,
    fontSize: t.tipografia.tamano.sm,
    color: t.colores.tinta,
  },
  pastillas: { flexDirection: 'row', gap: espaciado.xs, flexWrap: 'wrap' },
  comentario: {
    fontFamily: t.tipografia.familia.liviana,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.tintaSuave,
  },
  monto: {
    fontFamily: t.tipografia.familia.fuerte,
    fontSize: t.tipografia.tamano.base,
    color: t.colores.tinta,
  },
  totalFila: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 2,
    borderTopColor: t.colores.tinta,
    paddingTop: espaciado.sm,
    marginTop: espaciado.xs,
  },
  totalRotulo: {
    fontFamily: t.tipografia.familia.fuerte,
    fontSize: t.tipografia.tamano.sm,
    color: t.colores.tinta,
  },
  totalMonto: {
    fontFamily: t.tipografia.familia.fuerte,
    fontSize: t.tipografia.tamano.lg,
    color: t.colores.rojo,
  },
}))
