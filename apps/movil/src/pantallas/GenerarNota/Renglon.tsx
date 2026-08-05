import {
  aNumero,
  calcularTotalPorDientes,
  CAMPOS_POR_HERRAMIENTA,
  colores,
  espaciado,
  ETIQUETA_HERRAMIENTA,
  ETIQUETA_TIPO_MECHA,
  formatearPesos,
  HERRAMIENTAS_POR_SERVICIO,
  MECHAS_CON_MANO,
  radios,
  SINGULAR_HERRAMIENTA,
  soloNumeros,
  tipografia,
  type CampoItem,
  type FormularioItemNota,
  type Herramienta,
  type ManoMecha,
  type TipoMecha,
  type TipoServicio,
} from '@woodtools/compartido'
import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'

import { Campo, Casilla, Desplegable, MensajeError } from '../../componentes/Formulario'
import { Aviso, Pastilla } from '../../componentes/Estado'
import { resolverCodigoDeItem, type CodigoComputo } from '../../servicios/notasPedido'

/**
 * Un renglón de la nota.
 *
 * Qué campos se dibujan lo decide `CAMPOS_POR_HERRAMIENTA`, la misma tabla que
 * usa el validador. Así no puede pasar que la pantalla muestre un campo que el
 * validador ignora, ni que exija uno que nunca se mostró.
 *
 * El código de cómputo y el precio se buscan solos apenas hay medida: es la
 * parte que le saca al vendedor tener que acordarse de mil códigos parado en un
 * taller.
 */

const ETIQUETAS: Record<CampoItem, string> = {
  cantidad: 'CANTIDAD',
  diametro_exterior: 'DIÁMETRO EXTERIOR',
  diametro: 'DIÁMETRO',
  ancho_corte: 'ANCHO DE CORTE',
  largo: 'LARGO',
  ancho: 'ANCHO',
  largo_util: 'LARGO ÚTIL',
  espesor: 'ESPESOR',
  paso: 'PASO',
  descripcion: 'DESCRIPCIÓN',
  cantidad_dientes: 'CANTIDAD DE DIENTES A AFILAR',
  tipo_mecha: 'TIPO DE MECHA',
  mano: '¿ES DERECHA O IZQUIERDA?',
  dientes_rotos: '¿TIENE DIENTES ROTOS?',
  afilado_reparacion: '¿AFILADO / REPARACIÓN?',
  codigos_computo: 'CÓDIGO/S DE CÓMPUTO',
  precio_por_diente: 'PRECIO POR DIENTE',
  precio_total: 'PRECIO TOTAL',
}

/** El rótulo de "cantidad de dientes" cambia según el servicio. */
function etiquetaDientes(servicio: TipoServicio): string {
  if (servicio === 'reparacion') return 'CANTIDAD DE DIENTES A REPARAR'
  if (servicio === 'rectificado') return 'CANTIDAD DE DIENTES A RECTIFICAR'
  if (servicio === 'hermanado') return 'CANTIDAD DE DIENTES A HERMANAR'
  return 'CANTIDAD DE DIENTES A AFILAR'
}

function etiquetaSiNo(campo: CampoItem, servicio: TipoServicio): string {
  if (campo === 'dientes_rotos') {
    return servicio === 'reparacion' ? '¿TIENE DIENTES DESAFILADOS?' : '¿TIENE DIENTES ROTOS?'
  }
  return ETIQUETAS[campo]
}

export function PasoRenglon({
  item,
  alCambiar,
  errores,
}: {
  item: FormularioItemNota
  alCambiar: (cambios: Partial<FormularioItemNota>) => void
  errores: Record<string, string | undefined>
}) {
  const [codigos, setCodigos] = useState<CodigoComputo[]>([])
  const [buscando, setBuscando] = useState(false)
  const [sinCodigo, setSinCodigo] = useState(false)
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null)
  /**
   * El último código que propusimos solos. Sirve para distinguir "lo puso el
   * buscador" de "lo eligió el vendedor": lo primero se puede pisar cuando
   * cambia la medida, lo segundo no.
   */
  const propuesto = useRef<string | null>(null)

  const herramientas = HERRAMIENTAS_POR_SERVICIO[item.servicio]
  const campos = item.herramienta ? CAMPOS_POR_HERRAMIENTA[item.herramienta] : []

  /**
   * El código elegido ya no está entre los que cubren la medida. Pasa al
   * volver a un renglón cargado y corregirle el ancho: la elección manual no
   * se pisa sola, pero quedarse callados dejaría un precio que no corresponde.
   */
  const codigoDesactualizado =
    codigos.length > 0 &&
    item.codigos_computo.length > 0 &&
    !item.codigos_computo.some((c) => codigos.some((x) => x.codigo === c))

  // Con una sola herramienta posible (hermanado → incisores, rebaje →
  // cuchillas) se elige sola: no hay nada que decidir.
  useEffect(() => {
    if (herramientas.length === 1 && item.herramienta !== herramientas[0]) {
      alCambiar({ herramienta: herramientas[0] })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.servicio])

  // ── Búsqueda automática del código de cómputo ───────────────────────────
  const medidaClave = [item.ancho_corte, item.ancho, item.diametro].join('|')

  useEffect(() => {
    if (temporizador.current) clearTimeout(temporizador.current)
    if (!item.herramienta) return

    temporizador.current = setTimeout(async () => {
      setBuscando(true)
      setSinCodigo(false)
      try {
        const encontrados = await resolverCodigoDeItem(item)
        if (encontrados === null) {
          setCodigos([])
          return
        }
        setCodigos(encontrados)
        if (encontrados.length === 0) {
          setSinCodigo(true)
          return
        }
        // El más ajustado es el primero: se propone ese y el vendedor puede
        // cambiarlo si el trabajo es otro. Sólo se pisa lo que pusimos
        // nosotros — una elección manual se respeta aunque cambie la medida.
        const elegidos = item.codigos_computo
        const intocado =
          elegidos.length === 0 ||
          (elegidos.length === 1 && elegidos[0] === propuesto.current)
        if (!intocado) return

        const mejor = encontrados[0]
        propuesto.current = mejor.codigo
        alCambiar({
          codigos_computo: [mejor.codigo],
          ...(mejor.precio_pesos !== null
            ? { precio_por_diente: String(mejor.precio_pesos) }
            : {}),
        })
      } catch {
        setCodigos([])
      } finally {
        setBuscando(false)
      }
      // 250 ms y no 400: el código es la respuesta a la medida que se acaba de
      // tipear y ahora se dibuja justo debajo, así que la espera se nota.
    }, 250)

    return () => {
      if (temporizador.current) clearTimeout(temporizador.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [medidaClave, item.herramienta])

  // ── Precio total = precio por diente × cantidad de dientes ──────────────
  useEffect(() => {
    if (!campos.includes('precio_por_diente') || !campos.includes('cantidad_dientes')) return
    const total = calcularTotalPorDientes(
      aNumero(item.precio_por_diente),
      aNumero(item.cantidad_dientes),
    )
    const actual = aNumero(item.precio_total)
    if (total > 0 && Math.abs(total - actual) > 0.005) {
      alCambiar({ precio_total: String(total) })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.precio_por_diente, item.cantidad_dientes, item.herramienta])

  function campoNumerico(campo: CampoItem, etiqueta: string, ancho?: 'tercio' | 'mitad') {
    const valor = (item as unknown as Record<string, string>)[campo] ?? ''
    const esPrecio = campo === 'precio_por_diente' || campo === 'precio_total'
    return (
      <Campo
        key={campo}
        etiqueta={etiqueta}
        obligatorio
        value={valor}
        onChangeText={(t) => alCambiar({ [campo]: soloNumeros(t) } as Partial<FormularioItemNota>)}
        keyboardType="decimal-pad"
        error={errores[campo]}
        contenedorStyle={ancho === 'tercio' ? estilos.tercio : ancho === 'mitad' ? estilos.mitad : undefined}
        ayuda={esPrecio && aNumero(valor) > 0 ? formatearPesos(aNumero(valor)) : undefined}
      />
    )
  }

  return (
    <>
      {/* Herramienta */}
      {herramientas.length > 1 ? (
        <Desplegable<Herramienta>
          etiqueta={`HERRAMIENTA A ${rotuloServicio(item.servicio)}`}
          obligatorio
          marcador="Elegí la herramienta"
          valor={item.herramienta}
          items={herramientas.map((h) => ({ valor: h, etiqueta: ETIQUETA_HERRAMIENTA[h] }))}
          alCambiar={(h) => alCambiar({ herramienta: h, codigos_computo: [] })}
          error={errores.herramienta}
        />
      ) : item.herramienta ? (
        <View style={estilos.herramientaFija}>
          <Text style={estilos.herramientaFijaRotulo}>
            HERRAMIENTA A {rotuloServicio(item.servicio)}
          </Text>
          <Text style={estilos.herramientaFijaValor}>
            {ETIQUETA_HERRAMIENTA[item.herramienta]}
          </Text>
        </View>
      ) : null}

      {item.herramienta === 'mecha' ? (
        <Desplegable<TipoMecha>
          etiqueta="TIPO DE MECHA"
          obligatorio
          marcador="Elegí el tipo"
          valor={item.tipo_mecha}
          items={(Object.keys(ETIQUETA_TIPO_MECHA) as TipoMecha[]).map((t) => ({
            valor: t,
            etiqueta: ETIQUETA_TIPO_MECHA[t],
          }))}
          alCambiar={(t) => alCambiar({ tipo_mecha: t, mano: null })}
          error={errores.tipo_mecha}
        />
      ) : null}

      {/* Campos propios de la herramienta */}
      {campos.map((campo) => {
        if (campo === 'tipo_mecha') return null

        if (campo === 'cantidad') {
          return campoNumerico(
            campo,
            `CANTIDAD DE ${item.herramienta ? SINGULAR_HERRAMIENTA[item.herramienta] : 'HERRAMIENTAS'}`,
            'tercio',
          )
        }

        if (campo === 'cantidad_dientes') {
          return campoNumerico(campo, etiquetaDientes(item.servicio), 'mitad')
        }

        if (campo === 'descripcion') {
          return (
            <Campo
              key={campo}
              etiqueta="DESCRIPCIÓN"
              obligatorio
              value={item.descripcion}
              onChangeText={(t) => alCambiar({ descripcion: t })}
              placeholder="Marca, modelo, estado…"
              multiline
              numberOfLines={3}
              error={errores.descripcion}
            />
          )
        }

        if (campo === 'mano') {
          // Sólo las mechas que tienen mano: preguntarlo en una barreno no
          // significa nada.
          if (!item.tipo_mecha || !MECHAS_CON_MANO.includes(item.tipo_mecha)) return null
          return (
            <Desplegable<ManoMecha>
              key={campo}
              etiqueta="¿ES DERECHA O IZQUIERDA?"
              obligatorio
              marcador="Elegí"
              valor={item.mano}
              items={[
                { valor: 'derecha', etiqueta: 'DERECHA' },
                { valor: 'izquierda', etiqueta: 'IZQUIERDA' },
              ]}
              alCambiar={(m) => alCambiar({ mano: m })}
              error={errores.mano}
            />
          )
        }

        if (campo === 'dientes_rotos' || campo === 'afilado_reparacion') {
          const valor = campo === 'dientes_rotos' ? item.dientes_rotos : item.afilado_reparacion
          return (
            <Casilla
              key={campo}
              etiqueta={etiquetaSiNo(campo, item.servicio)}
              valor={valor}
              alCambiar={(v) => alCambiar({ [campo]: v } as Partial<FormularioItemNota>)}
            />
          )
        }

        if (campo === 'codigos_computo') {
          return (
            <View key={campo} style={estilos.bloqueCodigos}>
              <Text style={estilos.rotulo}>CÓDIGO/S DE CÓMPUTO</Text>

              {buscando ? (
                <View style={estilos.buscando}>
                  <ActivityIndicator size="small" color={colores.rojo} />
                  <Text style={estilos.buscandoTexto}>Buscando el código por la medida…</Text>
                </View>
              ) : null}

              {item.codigos_computo.length > 0 ? (
                <View style={estilos.elegidos}>
                  {item.codigos_computo.map((c) => (
                    <Pastilla key={c} texto={c} color={colores.verdeOscuro} />
                  ))}
                </View>
              ) : null}

              {codigos.length > 0 ? (
                <View style={estilos.opciones}>
                  {codigos.map((c) => {
                    const elegido = item.codigos_computo.includes(c.codigo)
                    return (
                      <Pressable
                        key={c.codigo}
                        onPress={() =>
                          alCambiar({
                            codigos_computo: elegido
                              ? item.codigos_computo.filter((x) => x !== c.codigo)
                              : [...item.codigos_computo, c.codigo],
                            ...(!elegido && c.precio_pesos !== null
                              ? { precio_por_diente: String(c.precio_pesos) }
                              : {}),
                          })
                        }
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: elegido }}
                        style={({ pressed }) => [
                          estilos.opcion,
                          elegido && estilos.opcionElegida,
                          pressed && estilos.tocado,
                        ]}
                      >
                        <View style={estilos.opcionFila}>
                          <Text style={estilos.opcionCodigo}>{c.codigo}</Text>
                          <Text style={estilos.opcionPrecio}>
                            {c.precio_pesos !== null ? formatearPesos(Number(c.precio_pesos)) : '—'}
                          </Text>
                        </View>
                        <Text style={estilos.opcionDesc} numberOfLines={1}>
                          {c.descripcion}
                        </Text>
                        {c.moneda === 'USD' ? (
                          <Text style={estilos.opcionNota}>
                            Lista en US$ {Number(c.precio).toFixed(2)} · convertido al cambio de hoy
                          </Text>
                        ) : null}
                      </Pressable>
                    )
                  })}
                </View>
              ) : null}

              {codigoDesactualizado ? (
                <Aviso tono="atencion" titulo="La medida cambió">
                  El código que está elegido no cubre esta medida. Tocá el que corresponde de la
                  lista para actualizar el precio.
                </Aviso>
              ) : null}

              {sinCodigo ? (
                <Aviso tono="atencion">
                  No hay ningún código que cubra esa medida. Revisá el valor, o cargalo a mano si el
                  trabajo es especial.
                </Aviso>
              ) : null}

              <MensajeError>{errores.codigos_computo}</MensajeError>
            </View>
          )
        }

        // El resto son medidas y precios: todos numéricos.
        const anchoCampo =
          campo === 'precio_total' || campo === 'precio_por_diente' ? 'mitad' : 'tercio'
        return campoNumerico(campo, ETIQUETAS[campo], anchoCampo)
      })}
    </>
  )
}

function rotuloServicio(s: TipoServicio): string {
  switch (s) {
    case 'reparacion':
      return 'REPARAR'
    case 'rectificado':
      return 'RECTIFICAR'
    case 'hermanado':
      return 'HERMANAR'
    case 'rebaje':
      return 'REBAJAR'
    default:
      return 'AFILAR'
  }
}

const estilos = StyleSheet.create({
  tercio: { maxWidth: 190 },
  mitad: { maxWidth: 240 },

  herramientaFija: {
    backgroundColor: colores.panelClaro,
    borderWidth: 2,
    borderColor: colores.negro,
    borderRadius: radios.sm,
    padding: espaciado.md,
    alignItems: 'center',
  },
  herramientaFijaRotulo: {
    fontFamily: tipografia.familia.cuerpo,
    fontSize: tipografia.tamano.xs,
    color: colores.tintaSuave,
  },
  herramientaFijaValor: {
    fontFamily: tipografia.familia.subtitulo,
    fontSize: tipografia.tamano.base,
    color: colores.tinta,
  },

  bloqueCodigos: { gap: espaciado.xs },
  rotulo: {
    fontFamily: tipografia.familia.cuerpo,
    fontSize: tipografia.tamano.base,
    color: colores.tinta,
  },
  buscando: { flexDirection: 'row', alignItems: 'center', gap: espaciado.sm },
  buscandoTexto: {
    fontFamily: tipografia.familia.liviana,
    fontSize: tipografia.tamano.xs,
    color: colores.tintaSuave,
  },
  elegidos: { flexDirection: 'row', gap: espaciado.xs, flexWrap: 'wrap' },

  opciones: {
    borderWidth: 2,
    borderColor: colores.negro,
    borderRadius: radios.sm,
    backgroundColor: colores.campoBlanco,
    overflow: 'hidden',
  },
  opcion: {
    paddingHorizontal: espaciado.md,
    paddingVertical: espaciado.sm,
    borderBottomWidth: 1,
    borderBottomColor: colores.panelOscuro,
    minHeight: 58,
    justifyContent: 'center',
    gap: 2,
  },
  opcionElegida: { backgroundColor: 'rgba(0,200,83,0.12)' },
  tocado: { opacity: 0.7 },
  opcionFila: { flexDirection: 'row', justifyContent: 'space-between', gap: espaciado.sm },
  opcionCodigo: {
    fontFamily: tipografia.familia.subtitulo,
    fontSize: tipografia.tamano.sm,
    color: colores.tinta,
  },
  opcionPrecio: {
    fontFamily: tipografia.familia.fuerte,
    fontSize: tipografia.tamano.sm,
    color: colores.verdeOscuro,
  },
  opcionDesc: {
    fontFamily: tipografia.familia.liviana,
    fontSize: tipografia.tamano.xs,
    color: colores.tintaSuave,
  },
  opcionNota: {
    fontFamily: tipografia.familia.liviana,
    fontSize: tipografia.tamano.micro,
    color: colores.tintaTenue,
  },
})
