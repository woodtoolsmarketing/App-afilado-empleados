import {
  agujeroDelRenglon,
  aNumero,
  CAMPOS_POR_HERRAMIENTA,
  colores,
  describirRango,
  descripcionSugerida,
  dientesAAfilar,
  esDescripcionSugerida,
  espaciado,
  ETIQUETA_HERRAMIENTA,
  ETIQUETA_TIPO_MECHA,
  formatearMedida,
  formatearPesos,
  HERRAMIENTAS_POR_SERVICIO,
  lineasDelRenglon,
  MECHAS_CON_MANO,
  MEDIDA_PARA_CODIGO,
  normalizarMedida,
  radios,
  SINGULAR_HERRAMIENTA,
  soloNumeros,
  tipografia,
  totalDelRenglon,
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
import {
  agujeroDeFabrica,
  medidasDisponibles,
  resolverCodigoDeItem,
  type CodigoComputo,
} from '../../servicios/notasPedido'

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
  diametro_interior: 'DIÁMETRO INTERIOR (OPCIONAL)',
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
  dientes_rotos_cantidad: '¿CUÁNTOS DIENTES ROTOS?',
  reparar_dientes: '¿DESEA REPARAR LOS DIENTES?',
  afilado_reparacion: '¿AFILADO / REPARACIÓN?',
  codigos_computo: 'CÓDIGO/S DE CÓMPUTO',
  precio_por_diente: 'PRECIO POR DIENTE',
  precio_total: 'PRECIO TOTAL',
}

/**
 * Junta los campos numéricos cortos consecutivos de a dos, para que entren en
 * una fila. Cada elemento del resultado es o un campo suelto o un par.
 *
 * Se agrupan sólo los cortos y sólo si son consecutivos: así el orden que
 * define `CAMPOS_POR_HERRAMIENTA` se mantiene, y en particular el bloque de
 * códigos sigue cayendo justo después de la medida que lo dispara.
 */
function agruparPares(campos: CampoItem[]): Array<CampoItem | [CampoItem, CampoItem]> {
  const salida: Array<CampoItem | [CampoItem, CampoItem]> = []
  for (let i = 0; i < campos.length; i++) {
    const actual = campos[i]
    const siguiente = campos[i + 1]
    if (CORTOS.has(actual) && siguiente && CORTOS.has(siguiente)) {
      salida.push([actual, siguiente])
      i++
    } else {
      salida.push(actual)
    }
  }
  return salida
}

/** Numéricos de pocos caracteres: entran holgados de a dos por fila. */
const CORTOS = new Set<CampoItem>([
  'cantidad', 'diametro_exterior', 'diametro', 'ancho_corte', 'largo', 'ancho',
  'largo_util', 'espesor', 'paso', 'cantidad_dientes',
])

/**
 * Herramientas cuyo catálogo no tiene un solo código con rango de medida.
 *
 * Medido sobre las listas: mechas 0 de 181, cuchillas 0 de 143. El afilado de
 * mechas se cotiza por tipo y cantidad de filos, y la lista de cuchillas es un
 * catálogo de producto, no de servicio. Buscar por medida ahí no devuelve nada
 * y nunca va a devolver nada.
 */
const SIN_RANGOS = new Set<Herramienta>(['mecha', 'cuchilla'])

/** Los campos que son una medida en milímetros, no una cantidad ni un precio. */
const MEDIDAS = new Set<CampoItem>([
  'diametro_exterior', 'diametro', 'ancho_corte', 'largo', 'ancho',
  'largo_util', 'espesor', 'paso',
])

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

  // ── La descripción se completa sola ──────────────────────────────────────
  //
  // "S.C." una sierra circular, "SSF" una sierra sin fin, y "nueva" cuando se
  // vende. Es lo que la fábrica lee para saber qué le llegó y se escribe
  // siempre igual; tipearlo a mano en cada renglón terminaba en "sierra",
  // "Sierra" y "SC" para la misma cosa.
  //
  // Sólo se pisa lo que pusimos nosotros: si el vendedor escribió algo suyo,
  // queda.
  useEffect(() => {
    if (!item.herramienta) return
    const sugerida = descripcionSugerida(item.herramienta, item.servicio)
    if (item.descripcion !== sugerida && esDescripcionSugerida(item.descripcion)) {
      alCambiar({ descripcion: sugerida })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.herramienta, item.servicio])

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

  // ── Precio total ─────────────────────────────────────────────────────────
  //
  // La cuenta vive en el paquete compartido: dientes × cantidad, menos los
  // rotos, más la reparación si la pidieron. Acá sólo se refleja el resultado.
  useEffect(() => {
    if (!campos.includes('precio_por_diente') || !campos.includes('cantidad_dientes')) return
    const total = totalDelRenglon(item)
    const actual = aNumero(item.precio_total)
    if (total > 0 && Math.abs(total - actual) > 0.005) {
      alCambiar({ precio_total: String(total) })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    item.precio_por_diente,
    item.cantidad_dientes,
    item.cantidad,
    item.herramienta,
    item.dientes_rotos,
    item.dientes_rotos_cantidad,
    item.reparar_dientes,
    item.precio_reparacion_por_diente,
  ])

  // ── El código de cómputo de la reparación de los dientes rotos ───────────
  //
  // Es OTRO código y OTRO precio que el del afilado: mismo ancho de corte,
  // pero servicio "reparación". Se busca solo apenas contestan que sí, para
  // que el vendedor no tenga que salir a buscarlo a mano.
  const [buscandoReparacion, setBuscandoReparacion] = useState(false)
  const [sinCodigoReparacion, setSinCodigoReparacion] = useState(false)

  useEffect(() => {
    if (item.reparar_dientes !== true || !item.dientes_rotos) {
      setSinCodigoReparacion(false)
      return
    }
    let cancelado = false
    setBuscandoReparacion(true)
    setSinCodigoReparacion(false)

    void resolverCodigoDeItem(item, 'reparacion')
      .then((encontrados) => {
        if (cancelado) return
        if (!encontrados || encontrados.length === 0) {
          setSinCodigoReparacion(encontrados !== null)
          return
        }
        const mejor = encontrados[0]
        if (mejor.codigo === item.codigo_reparacion) return
        alCambiar({
          codigo_reparacion: mejor.codigo,
          precio_reparacion_por_diente:
            mejor.precio_pesos !== null ? String(mejor.precio_pesos) : '',
        })
      })
      .catch(() => {
        if (!cancelado) setSinCodigoReparacion(true)
      })
      .finally(() => {
        if (!cancelado) setBuscandoReparacion(false)
      })

    return () => {
      cancelado = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.reparar_dientes, item.dientes_rotos, medidaClave, item.herramienta])

  // ── El agujero de fábrica ────────────────────────────────────────────────
  //
  // La herramienta que trajo el cliente está en la lista de precios: se la
  // reconoce por el diámetro exterior y de ahí sale su agujero de fábrica. Es
  // contra ése que se compara el que carga el vendedor para saber si fue
  // agrandado o lleva buje reductor.
  //
  // Sólo se busca si el renglón pide diámetro interior, y nunca se pisa un
  // valor ya encontrado con uno vacío: perder la referencia mientras se
  // corrige una medida haría desaparecer el aviso.
  const [buscandoAgujero, setBuscandoAgujero] = useState(false)

  useEffect(() => {
    if (!campos.includes('diametro_interior') || !item.diametro_exterior.trim()) return

    let cancelado = false
    const reloj = setTimeout(() => {
      setBuscandoAgujero(true)
      void agujeroDeFabrica(item)
        .then((agujero) => {
          if (cancelado || !agujero) return
          if (agujero !== item.diametro_interior_catalogo) {
            alCambiar({ diametro_interior_catalogo: agujero })
          }
        })
        .catch(() => undefined)
        .finally(() => {
          if (!cancelado) setBuscandoAgujero(false)
        })
    }, 400)

    return () => {
      cancelado = true
      clearTimeout(reloj)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.diametro_exterior, item.ancho_corte, item.cantidad_dientes, item.herramienta])

  // ── "¿Qué medidas hay?" ──────────────────────────────────────────────────
  const [medidas, setMedidas] = useState<CodigoComputo[] | null>(null)
  const [verMedidas, setVerMedidas] = useState(false)

  useEffect(() => {
    if (!verMedidas || !item.herramienta || medidas) return
    void medidasDisponibles(item.herramienta, item.servicio)
      .then(setMedidas)
      .catch(() => setMedidas([]))
  }, [verMedidas, item.herramienta, item.servicio, medidas])

  useEffect(() => {
    setMedidas(null)
    setVerMedidas(false)
  }, [item.herramienta, item.servicio])

  /**
   * Tocar una medida de la lista carga su piso en el campo correspondiente.
   * Es la forma corta de "quiero ése": pone una medida que cae dentro del
   * rango y deja que el buscador haga el resto, en vez de que el vendedor
   * tenga que deducir qué número tipear.
   */
  function aplicarMedidaSugerida(m: CodigoComputo): void {
    if (!item.herramienta) return
    setVerMedidas(false)

    // Sin rango no hay medida que cargar: el código SE ELIGE. Es el caso de
    // mechas y cuchillas, donde el precio no depende de una medida. Antes esta
    // función devolvía sin hacer nada y tocar la opción no producía ningún
    // efecto visible.
    if (m.rango_min === null) {
      propuesto.current = m.codigo
      alCambiar({
        codigos_computo: [m.codigo],
        ...(m.precio_pesos !== null ? { precio_por_diente: String(m.precio_pesos) } : {}),
      })
      return
    }

    const campo = MEDIDA_PARA_CODIGO[item.herramienta]
    if (!campo) return
    alCambiar({
      [campo]: String(m.rango_min).replace('.', ','),
      codigos_computo: [],
    } as Partial<FormularioItemNota>)
  }

  function campoNumerico(campo: CampoItem, etiqueta: string, ancho?: 'tercio' | 'mitad') {
    const valor = (item as unknown as Record<string, string>)[campo] ?? ''
    const esPrecio = campo === 'precio_por_diente' || campo === 'precio_total'
    const esMedida = MEDIDAS.has(campo)

    /**
     * El PRECIO TOTAL de un afilado no se tipea: sale de la cuenta.
     *
     * En las herramientas que se cobran por diente, el efecto de más arriba
     * recalcula el total en cuanto cambia cualquier cosa. El campo igual se
     * dibujaba como uno más, editable: el vendedor podía borrarlo, escribir el
     * importe que había arreglado con el cliente, ver cómo se le corregía solo
     * al toque siguiente y no entender por qué. Lo que escribía se descartaba.
     *
     * Ahora se muestra como resultado. Para mover el precio está PRECIO POR
     * DIENTE, que es el que la cuenta respeta.
     *
     * En mechas, cuchillas y sierras sin fin no se cobra por diente: ahí el
     * total SÍ es lo que el vendedor tipea, y el campo sigue abierto.
     */
    const esTotalCalculado =
      campo === 'precio_total' &&
      campos.includes('precio_por_diente') &&
      campos.includes('cantidad_dientes')

    return (
      <Campo
        key={campo}
        etiqueta={etiqueta}
        obligatorio
        value={valor}
        editable={!esTotalCalculado}
        onChangeText={(t) =>
          alCambiar({
            // Las medidas van con coma: el punto se toma como coma, porque el
            // teclado numérico de Android da uno u otro según el teléfono y
            // los dos quieren decir lo mismo.
            [campo]: esMedida ? normalizarMedida(t) : soloNumeros(t),
          } as Partial<FormularioItemNota>)
        }
        keyboardType="decimal-pad"
        error={errores[campo]}
        contenedorStyle={ancho === 'tercio' ? estilos.tercio : ancho === 'mitad' ? estilos.mitad : undefined}
        ayuda={
          esTotalCalculado
            ? `${formatearPesos(aNumero(valor))} · sale de la cuenta. Para cambiarlo, tocá PRECIO POR DIENTE.`
            : esPrecio && aNumero(valor) > 0
              ? formatearPesos(aNumero(valor))
              : esMedida && aNumero(valor) > 0
                ? formatearMedida(valor)
                : undefined
        }
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

      {/* Campos propios de la herramienta.
          Los numéricos cortos se agrupan de a dos por fila (ver `agruparPares`):
          una medida son cinco caracteres y ocupaba el ancho entero de la
          pantalla, que es la mitad del scroll que había que hacer. */}
      {agruparPares(campos).map((campo) => {
        if (Array.isArray(campo)) {
          return (
            <View key={campo.join('+')} style={estilos.par}>
              {campo.map((c) => campoNumerico(c, ETIQUETAS[c], 'tercio'))}
            </View>
          )
        }
        if (campo === 'tipo_mecha') return null

        if (campo === 'cantidad') {
          return campoNumerico(
            campo,
            `CANTIDAD DE ${item.herramienta ? SINGULAR_HERRAMIENTA[item.herramienta] : 'HERRAMIENTAS'}`,
            'tercio',
          )
        }

        if (campo === 'cantidad_dientes') {
          // Los dientes se cargan POR herramienta. Lo que se computa y se cobra
          // es el total, así que si hay más de una se muestra la cuenta hecha:
          // que el vendedor la vea antes de firmar, no después.
          const porHerramienta = aNumero(item.cantidad_dientes)
          const unidades = aNumero(item.cantidad)
          const totalDientes = porHerramienta * unidades
          const rotos = item.dientes_rotos ? aNumero(item.dientes_rotos_cantidad) : 0
          const aAfilar = dientesAAfilar(item)

          return (
            <View key={campo}>
              {campoNumerico(campo, etiquetaDientes(item.servicio), 'mitad')}
              {unidades > 1 && totalDientes > 0 ? (
                <Text style={estilos.totalDientes}>
                  {`${unidades} × ${porHerramienta} = ${totalDientes} dientes en total`}
                </Text>
              ) : null}
              {/* Los rotos no se afilan: la cuenta que se cobra es ésta. */}
              {rotos > 0 && totalDientes > 0 ? (
                <Text style={estilos.totalDientes}>
                  {`${totalDientes} − ${rotos} rotos = ${aAfilar} dientes a afilar`}
                </Text>
              ) : null}
            </View>
          )
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
              ayuda="Se completa sola con la herramienta. Agregale lo que haga falta."
            />
          )
        }

        if (campo === 'diametro_interior') {
          // Opcional a propósito: la lista de precios ya trae el agujero de
          // fábrica. Sólo se carga cuando la pieza que trae el cliente tiene
          // otro, que es el dato que le cambia el trabajo al taller.
          const agujero = agujeroDelRenglon(item)
          const deFabrica = item.diametro_interior_catalogo.trim()

          return (
            <View key={campo}>
              <Campo
                etiqueta="DIÁMETRO INTERIOR (OPCIONAL)"
                value={item.diametro_interior}
                onChangeText={(t) => alCambiar({ diametro_interior: normalizarMedida(t) })}
                keyboardType="decimal-pad"
                contenedorStyle={estilos.mitad}
                placeholder={deFabrica || 'El agujero de la herramienta'}
                error={errores.diametro_interior}
                ayuda={
                  deFabrica
                    ? `De fábrica: ${formatearMedida(deFabrica)}. Dejalo vacío si es ése.`
                    : buscandoAgujero
                      ? 'Buscando el agujero de fábrica en la lista de precios…'
                      : 'Si lo dejás vacío, la nota sale sin agujero.'
                }
              />

              {agujero.ajuste !== 'de_fabrica' ? (
                <Aviso
                  tono="atencion"
                  titulo={
                    agujero.ajuste === 'agrandado'
                      ? 'Agujero agrandado'
                      : 'Lleva buje reductor'
                  }
                >
                  {`${formatearMedida(agujero.medida)} contra ${formatearMedida(deFabrica)} de fábrica. Va escrito en la descripción general de la nota.`}
                </Aviso>
              ) : null}
            </View>
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

        if (campo === 'afilado_reparacion') {
          return (
            <Casilla
              key={campo}
              etiqueta={etiquetaSiNo(campo, item.servicio)}
              valor={item.afilado_reparacion}
              alCambiar={(v) => alCambiar({ afilado_reparacion: v })}
            />
          )
        }

        if (campo === 'dientes_rotos') {
          return (
            <Casilla
              key={campo}
              etiqueta={etiquetaSiNo(campo, item.servicio)}
              valor={item.dientes_rotos}
              alCambiar={(v) =>
                alCambiar(
                  // Destildar borra todo lo que colgaba de ahí: dejar una
                  // cantidad de rotos escondida descontaría dientes que nadie
                  // volvió a mirar.
                  v
                    ? { dientes_rotos: true }
                    : {
                        dientes_rotos: false,
                        dientes_rotos_cantidad: '',
                        reparar_dientes: null,
                        codigo_reparacion: '',
                        precio_reparacion_por_diente: '',
                      },
                )
              }
            />
          )
        }

        if (campo === 'dientes_rotos_cantidad') {
          if (!item.dientes_rotos) return null
          return (
            <Campo
              key={campo}
              etiqueta={ETIQUETAS[campo]}
              obligatorio
              value={item.dientes_rotos_cantidad}
              // Sólo números enteros: medio diente roto no existe.
              onChangeText={(t) => alCambiar({ dientes_rotos_cantidad: t.replace(/\D/g, '') })}
              keyboardType="number-pad"
              contenedorStyle={estilos.mitad}
              error={errores.dientes_rotos_cantidad}
              ayuda="Se descuentan de los dientes a afilar."
            />
          )
        }

        if (campo === 'reparar_dientes') {
          if (!item.dientes_rotos) return null
          const linea = lineasDelRenglon(item).find((l) => l.concepto === 'reparacion')

          return (
            <View key={campo} style={estilos.bloqueRotos}>
              {/*
                Sin valor por defecto a propósito: la respuesta cambia el
                precio, así que un "no" silencioso sería cobrarle de menos al
                cliente sin que nadie lo haya decidido.
              */}
              <Desplegable<'si' | 'no'>
                etiqueta={ETIQUETAS[campo]}
                obligatorio
                marcador="Contestá sí o no"
                valor={item.reparar_dientes === null ? null : item.reparar_dientes ? 'si' : 'no'}
                items={[
                  {
                    valor: 'si',
                    etiqueta: 'SÍ, REPARARLOS',
                    descripcion: 'Se cobra aparte, con el código de reparación',
                  },
                  {
                    valor: 'no',
                    etiqueta: 'NO',
                    descripcion: 'Sólo se descuentan de los dientes a afilar',
                  },
                ]}
                alCambiar={(v) =>
                  alCambiar(
                    v === 'si'
                      ? { reparar_dientes: true }
                      : {
                          reparar_dientes: false,
                          codigo_reparacion: '',
                          precio_reparacion_por_diente: '',
                        },
                  )
                }
                error={errores.reparar_dientes}
              />

              {buscandoReparacion ? (
                <View style={estilos.buscando}>
                  <ActivityIndicator size="small" color={colores.rojo} />
                  <Text style={estilos.buscandoTexto}>Buscando el código de reparación…</Text>
                </View>
              ) : null}

              {linea ? (
                <View style={estilos.lineaRotos}>
                  <Pastilla texto={linea.codigo || 'sin código'} color={colores.ambarOscuro} />
                  <Text style={estilos.lineaRotosTexto}>
                    {`${linea.cantidad} × ${formatearPesos(linea.precioUnitario)} = ${formatearPesos(linea.total)}`}
                  </Text>
                </View>
              ) : null}

              {sinCodigoReparacion ? (
                <Aviso tono="atencion" titulo="Sin código de reparación">
                  El catálogo no tiene un código de reparación para esa medida. Cargalo a mano o
                  consultá con Administración.
                </Aviso>
              ) : null}

              <MensajeError>{errores.codigo_reparacion}</MensajeError>
            </View>
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
                          {/* El rango va al lado del código: es lo que explica
                              por qué ése y no otro. */}
                          <Text style={estilos.opcionRango}>
                            {describirRango(c.rango_min, c.rango_max)}
                          </Text>
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
                // Mechas y cuchillas no tienen un solo código con rango: no se
                // cotizan por medida. Decirle "probá otra medida" sería mandarlo
                // a buscar algo que no existe.
                SIN_RANGOS.has(item.herramienta as Herramienta) ? (
                  <Aviso tono="atencion" titulo="Esta herramienta no se cotiza por medida">
                    {item.herramienta === 'mecha'
                      ? 'El afilado de mechas va por tipo y cantidad de filos, no por diámetro. Abrí la lista de abajo y elegí el código.'
                      : 'La lista de cuchillas es de producto, no de servicio. Abrí la lista de abajo y elegí el código.'}
                  </Aviso>
                ) : (
                  <Aviso tono="atencion">
                    No hay ningún código que cubra esa medida. Mirá abajo qué medidas tiene cargadas
                    el catálogo.
                  </Aviso>
                )
              ) : null}

              {/* La lista de medidas disponibles: la respuesta a "¿y entonces
                  qué medidas hay?", que antes se contestaba probando números. */}
              <Pressable
                onPress={() => setVerMedidas((v) => !v)}
                accessibilityRole="button"
                accessibilityState={{ expanded: verMedidas }}
                style={estilos.verMedidas}
              >
                <Text style={estilos.verMedidasTexto}>
                  {verMedidas ? '▲' : '▼'}{' '}
                  {SIN_RANGOS.has(item.herramienta as Herramienta) ? '¿Qué códigos' : '¿Qué medidas'}{' '}
                  hay para{' '}
                  {item.herramienta ? ETIQUETA_HERRAMIENTA[item.herramienta] : 'esta herramienta'}?
                </Text>
              </Pressable>

              {verMedidas ? (
                medidas === null ? (
                  <View style={estilos.buscando}>
                    <ActivityIndicator size="small" color={colores.rojo} />
                    <Text style={estilos.buscandoTexto}>Buscando…</Text>
                  </View>
                ) : medidas.length === 0 ? (
                  <Aviso tono="atencion">
                    Esta herramienta no tiene medidas cargadas en el catálogo: sus precios van por
                    modelo, no por rango. Buscá el código por descripción.
                  </Aviso>
                ) : (
                  <View style={estilos.opciones}>
                    {medidas.map((m) => (
                      <Pressable
                        key={m.codigo}
                        onPress={() => aplicarMedidaSugerida(m)}
                        accessibilityRole="button"
                        accessibilityLabel={`Usar ${m.codigo}, ${describirRango(m.rango_min, m.rango_max)}`}
                        style={({ pressed }) => [estilos.opcion, pressed && estilos.tocado]}
                      >
                        <View style={estilos.opcionFila}>
                          <Text style={estilos.opcionCodigo}>{m.codigo}</Text>
                          {/* Sin rango no se muestra "sin rango": lo que sirve
                              ahí es el precio, que es lo que distingue una
                              opción de la otra. */}
                          <Text style={estilos.opcionRango}>
                            {m.rango_min === null
                              ? (m.precio_pesos !== null
                                  ? formatearPesos(Number(m.precio_pesos))
                                  : '')
                              : describirRango(m.rango_min, m.rango_max)}
                          </Text>
                        </View>
                        <Text style={estilos.opcionDesc} numberOfLines={1}>
                          {m.descripcion}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                )
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
  // Los campos cortos van de a dos por fila: una medida ocupa cinco caracteres
  // y antes se comía el ancho entero, obligando a scrollear por nada.
  par: { flexDirection: 'row', gap: espaciado.sm },
  tercio: { flex: 1 },
  mitad: { flex: 1 },

  totalDientes: {
    fontFamily: tipografia.familia.fuerte,
    fontSize: tipografia.tamano.xs,
    color: colores.verdeOscuro,
    marginTop: -espaciado.xs,
  },

  bloqueRotos: { gap: espaciado.xs },
  lineaRotos: { flexDirection: 'row', alignItems: 'center', gap: espaciado.sm, flexWrap: 'wrap' },
  lineaRotosTexto: {
    fontFamily: tipografia.familia.fuerte,
    fontSize: tipografia.tamano.xs,
    color: colores.ambarOscuro,
  },

  verMedidas: { paddingVertical: espaciado.sm },
  verMedidasTexto: {
    fontFamily: tipografia.familia.cuerpo,
    fontSize: tipografia.tamano.xs,
    color: colores.rojo,
    textDecorationLine: 'underline',
  },
  opcionRango: {
    flex: 1,
    fontFamily: tipografia.familia.liviana,
    fontSize: tipografia.tamano.micro,
    color: colores.tintaSuave,
    textAlign: 'center',
  },

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
