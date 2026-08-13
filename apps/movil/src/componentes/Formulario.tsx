import {
  colores,
  espaciado,
  radios,
  tipografia,
  TOQUE_MINIMO,
} from '@woodtools/compartido'
import { forwardRef, useMemo, useState, type ReactNode } from 'react'
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native'

/**
 * Controles de formulario.
 *
 * Todos comparten el mismo tratamiento del error: borde rojo + mensaje debajo,
 * porque la consigna pide señalar exactamente qué campo está mal.
 */

export function Etiqueta({
  children,
  sobreRojo = false,
  obligatorio = false,
  centrada = false,
}: {
  children: ReactNode
  /** Cuando la etiqueta va sobre el fondo rojo (pantalla de login). */
  sobreRojo?: boolean
  obligatorio?: boolean
  /** Para los selectores que encabezan una pantalla, como el PERIODO. */
  centrada?: boolean
}) {
  return (
    <Text
      style={[
        estilos.etiqueta,
        sobreRojo && estilos.etiquetaSobreRojo,
        centrada && estilos.etiquetaCentrada,
      ]}
    >
      {children}
      {obligatorio ? <Text style={estilos.asterisco}> *</Text> : null}
    </Text>
  )
}

export function MensajeError({ children }: { children?: string | null }) {
  if (!children) return null
  return (
    <View style={estilos.errorCaja} accessibilityLiveRegion="polite">
      <Text style={estilos.errorIcono}>!</Text>
      <Text style={estilos.errorTexto}>{children}</Text>
    </View>
  )
}

export interface PropsCampo extends TextInputProps {
  etiqueta?: string
  error?: string | null
  sobreRojo?: boolean
  obligatorio?: boolean
  contenedorStyle?: StyleProp<ViewStyle>
  /** Se dibuja pegado al borde derecho del campo (por ejemplo, el micrófono). */
  accesorio?: ReactNode
  ayuda?: string
}

export const Campo = forwardRef<TextInput, PropsCampo>(function Campo(
  {
    etiqueta,
    error,
    sobreRojo = false,
    obligatorio = false,
    contenedorStyle,
    accesorio,
    ayuda,
    style,
    ...props
  },
  ref,
) {
  const [enfocado, setEnfocado] = useState(false)

  return (
    <View style={[estilos.campoContenedor, contenedorStyle]}>
      {etiqueta ? (
        <Etiqueta sobreRojo={sobreRojo} obligatorio={obligatorio}>
          {etiqueta}
        </Etiqueta>
      ) : null}

      {/*
        Un campo que no se puede escribir tiene que verse distinto.
        `editable={false}` lo bloquea pero lo deja idéntico a los demás, así
        que quedaba un casillero que invitaba a tocarlo y no respondía. Los
        calculados —el PRECIO TOTAL de un afilado— se muestran apagados: son un
        resultado, no un lugar donde escribir.
      */}
      <View
        style={[
          estilos.campoCaja,
          props.multiline && estilos.campoCajaMultilinea,
          props.editable === false && estilos.campoCalculado,
          enfocado && estilos.campoEnfocado,
          !!error && estilos.campoConError,
        ]}
      >
        <TextInput
          ref={ref}
          {...props}
          onFocus={(e) => {
            setEnfocado(true)
            props.onFocus?.(e)
          }}
          onBlur={(e) => {
            setEnfocado(false)
            props.onBlur?.(e)
          }}
          placeholderTextColor={colores.tintaTenue}
          style={[estilos.campoTexto, props.multiline && estilos.campoTextoMultilinea, style]}
          accessibilityLabel={etiqueta}
        />
        {accesorio ? <View style={estilos.accesorio}>{accesorio}</View> : null}
      </View>

      {ayuda && !error ? <Text style={[estilos.ayuda, sobreRojo && estilos.ayudaSobreRojo]}>{ayuda}</Text> : null}
      <MensajeError>{error}</MensajeError>
    </View>
  )
})

/** Casilla cuadrada con borde negro, como en "TIPO DE VISITA". */
export function Casilla({
  etiqueta,
  valor,
  alCambiar,
  deshabilitada,
  compacta = false,
}: {
  etiqueta: string
  valor: boolean
  alCambiar: (valor: boolean) => void
  deshabilitada?: boolean
  /**
   * Para las casillas que van de a dos por fila.
   *
   * En media pantalla, descontando la caja de 36 px, a la etiqueta le quedan
   * unos 125 px: "RECTIFICADO" en el tamaño normal no entra y se monta sobre
   * el tilde. Con esto la letra baja un escalón y, si aún así no entra, se
   * achica sola en vez de desbordar.
   */
  compacta?: boolean
}) {
  return (
    <Pressable
      onPress={() => alCambiar(!valor)}
      disabled={deshabilitada}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: valor, disabled: !!deshabilitada }}
      accessibilityLabel={etiqueta}
      style={({ pressed }) => [
        estilos.casillaFila,
        pressed && estilos.filaPresionada,
        deshabilitada && estilos.deshabilitado,
      ]}
      hitSlop={8}
    >
      <Text
        style={[estilos.casillaEtiqueta, compacta && estilos.casillaEtiquetaCompacta]}
        numberOfLines={1}
        adjustsFontSizeToFit={compacta}
        minimumFontScale={0.75}
      >
        {etiqueta}
      </Text>
      <View style={[estilos.casillaCaja, valor && estilos.casillaMarcada]}>
        {valor ? <Text style={estilos.casillaTilde}>✓</Text> : null}
      </View>
    </Pressable>
  )
}

/** Botón de radio, para listas donde se elige una sola opción. */
export function Opcion({
  etiqueta,
  descripcion,
  seleccionada,
  alSeleccionar,
}: {
  etiqueta: string
  descripcion?: string
  seleccionada: boolean
  alSeleccionar: () => void
}) {
  return (
    <Pressable
      onPress={alSeleccionar}
      accessibilityRole="radio"
      accessibilityState={{ selected: seleccionada }}
      accessibilityLabel={etiqueta}
      style={({ pressed }) => [
        estilos.opcion,
        seleccionada && estilos.opcionSeleccionada,
        pressed && estilos.filaPresionada,
      ]}
    >
      <View style={[estilos.radio, seleccionada && estilos.radioActivo]}>
        {seleccionada ? <View style={estilos.radioPunto} /> : null}
      </View>
      <View style={estilos.opcionTextos}>
        <Text style={estilos.opcionEtiqueta}>{etiqueta}</Text>
        {descripcion ? <Text style={estilos.opcionDescripcion}>{descripcion}</Text> : null}
      </View>
    </Pressable>
  )
}

export interface OpcionDeCampo {
  /** El valor que se escribe en el campo. */
  valor: string
  /** Cuántas herramientas del catálogo tienen ese valor. */
  cantidad?: number
}

/**
 * Campo escribible que además sugiere lo que existe.
 *
 * El vendedor sigue tipeando la medida —a veces la sabe y es más rápido— pero a
 * medida que escribe se va quedando con las que el catálogo realmente tiene. Y
 * si no la sabe, toca el campo y las ve todas.
 *
 * Las opciones no son una lista fija: salen de la cascada, así que después de
 * elegir diámetro 300 la lista de dientes ya no ofrece los 24 que no existen en
 * esa medida. Escribir un valor que no está tampoco se bloquea: la lista puede
 * no tener la herramienta que el cliente trajo, y el renglón tiene que poder
 * cargarse igual.
 */
export function CampoConOpciones({
  opciones,
  valor,
  alElegir,
  sinCoincidencias = 'Ninguna medida del catálogo coincide. Podés dejarla igual.',
  ...propsCampo
}: Omit<PropsCampo, 'value'> & {
  opciones: OpcionDeCampo[]
  valor: string
  /** Cuando el vendedor toca una sugerencia en vez de escribirla. */
  alElegir: (valor: string) => void
  sinCoincidencias?: string
}) {
  const [enfocado, setEnfocado] = useState(false)

  // Con el campo vacío se ofrecen todas; con algo escrito, las que empiezan
  // así primero —"3" antes que "13"— porque es lo que uno espera al tipear.
  const sugeridas = useMemo(() => {
    const q = valor.trim().replace(',', '.')
    if (!q) return opciones
    const empiezan = opciones.filter((o) => o.valor.startsWith(q))
    const contienen = opciones.filter((o) => !o.valor.startsWith(q) && o.valor.includes(q))
    return [...empiezan, ...contienen]
  }, [opciones, valor])

  const exacta = opciones.some((o) => o.valor === valor.trim().replace(',', '.'))
  const abierta = enfocado && opciones.length > 0 && !exacta

  return (
    <View style={estilos.conOpciones}>
      <Campo
        {...propsCampo}
        value={valor}
        onFocus={() => setEnfocado(true)}
        // Se cierra con demora: sin eso, el toque en una sugerencia llega
        // después del blur y la lista ya no está para recibirlo.
        onBlur={() => setTimeout(() => setEnfocado(false), 150)}
      />

      {abierta ? (
        <View style={estilos.opcionesCaja}>
          {sugeridas.length === 0 ? (
            <Text style={estilos.opcionesVacio}>{sinCoincidencias}</Text>
          ) : (
            <ScrollView
              style={estilos.opcionesLista}
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled
              bounces={false}
            >
              {sugeridas.map((o) => (
                <Pressable
                  key={o.valor}
                  onPress={() => {
                    alElegir(o.valor)
                    setEnfocado(false)
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`${o.valor}${o.cantidad ? `, ${o.cantidad} opciones` : ''}`}
                  style={({ pressed }) => [estilos.opcionValor, pressed && estilos.filaPresionada]}
                >
                  <Text style={estilos.opcionValorTexto}>{o.valor}</Text>
                  {o.cantidad ? (
                    <Text style={estilos.opcionValorCantidad}>{o.cantidad}</Text>
                  ) : null}
                </Pressable>
              ))}
            </ScrollView>
          )}
        </View>
      ) : null}
    </View>
  )
}

export interface ItemDesplegable<T extends string> {
  valor: T
  etiqueta: string
  descripcion?: string
  /**
   * Texto extra por el que se puede encontrar la opción, sin ocupar lugar en
   * pantalla. La zona 107 muestra cuatro localidades pero cubre treinta y seis:
   * acá van todas, así escribir "Castelar" la encuentra igual.
   */
  buscarEn?: string
}

/**
 * A partir de esta cantidad de opciones la hoja aparece con buscador.
 *
 * Ocho es lo que entra cómodo de un vistazo. Las zonas son treinta y las
 * medidas de una sierra pueden ser cientos: ahí desplazarse hasta encontrar la
 * que uno ya sabe es peor que escribirla.
 */
const OPCIONES_PARA_BUSCADOR = 8

/** Sin tildes y en minúsculas, para que "Morón" se encuentre escribiendo "moron". */
function comparable(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

/**
 * Desplegable. Abre una hoja modal en lugar del selector nativo: se ve igual en
 * todos los teléfonos y las opciones entran con el tamaño de toque que
 * necesitamos.
 *
 * ─── Por qué la hoja tiene alto en píxeles y no en porcentaje ───────────────
 *
 * Tenía `maxHeight: '70%'` y un ScrollView adentro sin permiso de encogerse.
 * Con pocas opciones no se notaba, pero el desplegable de ZONA tiene treinta y
 * cada una con su lista de localidades: la hoja crecía con el contenido, se iba
 * fuera de la pantalla y lo único que quedaba visible era el velo. El vendedor
 * tocaba ZONA, la pantalla se ponía negra y no había nada para elegir.
 *
 * Ahora el alto sale de la ventana real, en píxeles, y tanto la hoja como el
 * ScrollView pueden encogerse. Un porcentaje contra un padre sin alto definido
 * es justamente el caso donde Yoga no tiene contra qué calcularlo.
 */
export function Desplegable<T extends string>({
  etiqueta,
  marcador = 'Seleccioná una opción',
  valor,
  items,
  alCambiar,
  error,
  obligatorio,
  deshabilitado,
  etiquetaCentrada,
  buscable,
  marcadorBusqueda = 'Escribí para filtrar…',
  vacio = 'No hay ninguna opción que coincida.',
}: {
  etiqueta?: string
  marcador?: string
  valor: T | null
  items: ItemDesplegable<T>[]
  alCambiar: (valor: T) => void
  error?: string | null
  obligatorio?: boolean
  deshabilitado?: boolean
  /**
   * Centra el rótulo. Lo usan los dos historiales, donde el PERIODO no es un
   * campo más de un formulario sino el control que manda en la pantalla.
   */
  etiquetaCentrada?: boolean
  /**
   * Fuerza el buscador. Si no se dice nada aparece solo cuando hay muchas
   * opciones, que es cuando hace falta.
   */
  buscable?: boolean
  marcadorBusqueda?: string
  /** Qué decir cuando el filtro no deja nada. */
  vacio?: string
}) {
  const [abierto, setAbierto] = useState(false)
  const [filtro, setFiltro] = useState('')
  const { height: altoVentana } = useWindowDimensions()

  const elegido = items.find((i) => i.valor === valor)
  const conBuscador = buscable ?? items.length > OPCIONES_PARA_BUSCADOR

  // Se filtra por etiqueta y por descripción: en las zonas la descripción son
  // las localidades, así que escribir "castelar" encuentra la 107 aunque el
  // nombre de la zona no diga Castelar.
  const visibles = useMemo(() => {
    const q = comparable(filtro)
    if (!q) return items
    return items.filter((i) =>
      comparable([i.etiqueta, i.descripcion, i.buscarEn].filter(Boolean).join(' ')).includes(q),
    )
  }, [items, filtro])

  function cerrar() {
    setAbierto(false)
    setFiltro('')
  }

  return (
    <View style={estilos.campoContenedor}>
      {etiqueta ? (
        <Etiqueta obligatorio={obligatorio} centrada={etiquetaCentrada}>
          {etiqueta}
        </Etiqueta>
      ) : null}

      {/*
        El triángulo va FUERA de la caja blanca, como en el mockup, pero DENTRO
        de lo que se toca: es el gesto más obvio para abrir un desplegable y
        dejarlo sin toque sería peor que el desvío visual que se corrige.

        Por eso el Pressable es la fila entera —caja + triángulo— y el recuadro
        pasó a ser un View adentro. El borde rojo del error sigue en la caja,
        que es lo que el vendedor mira.
      */}
      <Pressable
        onPress={() => setAbierto(true)}
        disabled={deshabilitado}
        accessibilityRole="button"
        accessibilityLabel={`${etiqueta ?? 'Opción'}: ${elegido?.etiqueta ?? marcador}`}
        style={({ pressed }) => [
          estilos.desplegableFila,
          pressed && estilos.filaPresionada,
          deshabilitado && estilos.deshabilitado,
        ]}
      >
        <View
          style={[estilos.campoCaja, estilos.desplegableCaja, !!error && estilos.campoConError]}
        >
          <Text style={[estilos.campoTexto, !elegido && estilos.marcador]} numberOfLines={1}>
            {elegido?.etiqueta ?? marcador}
          </Text>
        </View>
        <Text style={estilos.flecha}>▼</Text>
      </Pressable>

      <MensajeError>{error}</MensajeError>

      <Modal visible={abierto} transparent animationType="fade" onRequestClose={cerrar}>
        <Pressable style={estilos.velo} onPress={cerrar}>
          {/* El alto sale de la ventana, en píxeles: con porcentaje la hoja se
              iba de pantalla cuando había muchas opciones. */}
          <Pressable
            style={[estilos.hoja, { maxHeight: Math.round(altoVentana * 0.75) }]}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={estilos.hojaCabecera}>
              <Text style={estilos.hojaTitulo}>{etiqueta ?? 'Elegí una opción'}</Text>
              <Pressable
                onPress={cerrar}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="Cerrar"
                style={({ pressed }) => [estilos.hojaCerrar, pressed && estilos.filaPresionada]}
              >
                <Text style={estilos.hojaCerrarTexto}>✕</Text>
              </Pressable>
            </View>

            {conBuscador ? (
              <TextInput
                style={estilos.buscador}
                value={filtro}
                onChangeText={setFiltro}
                placeholder={marcadorBusqueda}
                placeholderTextColor={colores.tintaSuave}
                autoCorrect={false}
                autoCapitalize="none"
                accessibilityLabel={`Buscar en ${etiqueta ?? 'las opciones'}`}
              />
            ) : null}

            <ScrollView
              style={estilos.hojaLista}
              contentContainerStyle={estilos.hojaListaContenido}
              bounces={false}
              keyboardShouldPersistTaps="handled"
            >
              {visibles.length === 0 ? (
                <Text style={estilos.hojaVacia}>{vacio}</Text>
              ) : (
                visibles.map((item) => (
                  <Opcion
                    key={item.valor}
                    etiqueta={item.etiqueta}
                    descripcion={item.descripcion}
                    seleccionada={item.valor === valor}
                    alSeleccionar={() => {
                      alCambiar(item.valor)
                      cerrar()
                    }}
                  />
                ))
              )}
            </ScrollView>

            {conBuscador ? (
              <Text style={estilos.hojaConteo}>
                {visibles.length === items.length
                  ? `${items.length} opciones`
                  : `${visibles.length} de ${items.length}`}
              </Text>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  )
}

const estilos = StyleSheet.create({
  campoContenedor: {
    gap: espaciado.xs,
  },
  etiqueta: {
    fontFamily: tipografia.familia.cuerpo,
    fontSize: tipografia.tamano.base,
    color: colores.tinta,
  },
  etiquetaCentrada: { textAlign: 'center' },
  etiquetaSobreRojo: {
    color: colores.blanco,
    fontSize: tipografia.tamano.xl,
    fontFamily: tipografia.familia.fuerte,
    textShadowColor: 'rgba(0,0,0,0.35)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  asterisco: {
    color: colores.rojoAccion,
    fontFamily: tipografia.familia.subtitulo,
  },

  campoCaja: {
    minHeight: TOQUE_MINIMO,
    backgroundColor: colores.campo,
    borderWidth: 2,
    borderColor: colores.negro,
    borderRadius: radios.sm,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: espaciado.md,
  },
  campoCajaMultilinea: {
    minHeight: 150,
    alignItems: 'stretch',
    backgroundColor: colores.campoBlanco,
    paddingVertical: espaciado.sm,
  },
  campoEnfocado: {
    borderColor: colores.azul,
  },
  campoConError: {
    borderColor: colores.rojoAccion,
    borderWidth: 2.5,
  },
  /** Resultado de una cuenta: se lee, no se escribe. */
  campoCalculado: {
    backgroundColor: colores.panelOscuro,
    borderStyle: 'dashed',
  },
  campoTexto: {
    flex: 1,
    fontFamily: tipografia.familia.cuerpo,
    fontSize: tipografia.tamano.base,
    color: colores.tinta,
    paddingVertical: espaciado.sm,
  },
  campoTextoMultilinea: {
    textAlignVertical: 'top',
    minHeight: 120,
  },
  accesorio: {
    paddingLeft: espaciado.sm,
    alignSelf: 'flex-end',
    paddingBottom: espaciado.xs,
  },
  marcador: {
    color: colores.tintaTenue,
  },
  ayuda: {
    fontFamily: tipografia.familia.liviana,
    fontSize: tipografia.tamano.xs,
    color: colores.tintaSuave,
  },
  ayudaSobreRojo: {
    color: 'rgba(255,255,255,0.85)',
  },

  errorCaja: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: espaciado.sm,
    backgroundColor: 'rgba(224,27,36,0.12)',
    borderLeftWidth: 4,
    borderLeftColor: colores.rojoAccion,
    borderRadius: radios.sm,
    paddingVertical: espaciado.sm,
    paddingHorizontal: espaciado.sm,
  },
  errorIcono: {
    fontFamily: tipografia.familia.titulo,
    fontSize: tipografia.tamano.sm,
    color: colores.blanco,
    backgroundColor: colores.rojoAccion,
    width: 20,
    height: 20,
    borderRadius: 10,
    textAlign: 'center',
    lineHeight: 20,
    overflow: 'hidden',
  },
  errorTexto: {
    flex: 1,
    fontFamily: tipografia.familia.cuerpo,
    fontSize: tipografia.tamano.xs,
    color: '#8A0B0B',
    lineHeight: tipografia.tamano.xs * tipografia.interlineado.normal,
  },

  casillaFila: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: TOQUE_MINIMO,
    paddingVertical: espaciado.xs,
    paddingRight: espaciado.xs,
  },
  casillaEtiqueta: {
    fontFamily: tipografia.familia.cuerpo,
    fontSize: tipografia.tamano.lg,
    color: colores.tinta,
    letterSpacing: 0.3,
    // Que ceda el espacio a la caja del tilde en vez de empujarla afuera.
    flexShrink: 1,
    marginRight: espaciado.xs,
  },
  casillaEtiquetaCompacta: {
    fontSize: tipografia.tamano.base,
    letterSpacing: 0,
  },
  casillaCaja: {
    width: 36,
    height: 36,
    borderWidth: 2.5,
    borderColor: colores.negro,
    borderRadius: radios.sm,
    backgroundColor: colores.campoBlanco,
    alignItems: 'center',
    justifyContent: 'center',
  },
  casillaMarcada: {
    backgroundColor: colores.verde,
  },
  casillaTilde: {
    fontFamily: tipografia.familia.titulo,
    fontSize: 22,
    lineHeight: 26,
    color: colores.negro,
  },

  filaPresionada: {
    opacity: 0.65,
  },
  deshabilitado: {
    opacity: 0.45,
  },

  desplegableFila: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: TOQUE_MINIMO,
  },
  desplegableCaja: {
    flex: 1,
    backgroundColor: colores.campoBlanco,
  },
  flecha: {
    fontSize: tipografia.tamano.xl,
    color: colores.tintaSuave,
    // Padding y no margen: es lo que le da ancho propio dentro del área táctil.
    paddingHorizontal: espaciado.sm,
  },

  conOpciones: {
    // La lista se dibuja encima de lo que sigue, no empujándolo: si el
    // formulario se reacomodara en cada tecla, el campo se movería debajo del
    // dedo mientras se escribe.
    position: 'relative',
    zIndex: 10,
  },
  opcionesCaja: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    marginTop: 2,
    backgroundColor: colores.campoBlanco,
    borderWidth: 2,
    borderColor: colores.negro,
    borderRadius: radios.sm,
    overflow: 'hidden',
    elevation: 8,
    shadowColor: colores.negro,
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
  opcionesLista: {
    maxHeight: 200,
  },
  opcionValor: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: espaciado.sm,
    minHeight: 42,
    paddingHorizontal: espaciado.md,
    borderBottomWidth: 1,
    borderBottomColor: colores.panelClaro,
  },
  opcionValorTexto: {
    fontFamily: tipografia.familia.fuerte,
    fontSize: tipografia.tamano.base,
    color: colores.tinta,
  },
  opcionValorCantidad: {
    fontFamily: tipografia.familia.liviana,
    fontSize: tipografia.tamano.xs,
    color: colores.tintaSuave,
  },
  opcionesVacio: {
    fontFamily: tipografia.familia.cuerpo,
    fontSize: tipografia.tamano.xs,
    color: colores.tintaSuave,
    padding: espaciado.md,
  },

  velo: {
    flex: 1,
    backgroundColor: colores.velo,
    justifyContent: 'flex-end',
  },
  hoja: {
    backgroundColor: colores.panelClaro,
    borderTopWidth: 3,
    borderColor: colores.negro,
    borderTopLeftRadius: radios.lg,
    borderTopRightRadius: radios.lg,
    padding: espaciado.base,
    // El maxHeight en píxeles lo pone el componente con el alto real de la
    // ventana. `flexShrink` es lo que le permite respetarlo: sin él, el
    // contenido manda y la hoja se va de pantalla.
    flexShrink: 1,
    gap: espaciado.sm,
  },
  hojaCabecera: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaciado.sm,
  },
  hojaTitulo: {
    flex: 1,
    fontFamily: tipografia.familia.subtitulo,
    fontSize: tipografia.tamano.lg,
    color: colores.tinta,
    textAlign: 'center',
  },
  hojaCerrar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colores.campoBlanco,
    borderWidth: 2,
    borderColor: colores.negro,
  },
  hojaCerrarTexto: {
    fontFamily: tipografia.familia.subtitulo,
    fontSize: tipografia.tamano.base,
    color: colores.tinta,
  },
  buscador: {
    minHeight: TOQUE_MINIMO,
    backgroundColor: colores.campoBlanco,
    borderWidth: 2,
    borderColor: colores.negro,
    borderRadius: radios.sm,
    paddingHorizontal: espaciado.md,
    fontFamily: tipografia.familia.cuerpo,
    fontSize: tipografia.tamano.base,
    color: colores.tinta,
  },
  hojaLista: {
    flexShrink: 1,
  },
  hojaListaContenido: {
    paddingBottom: espaciado.xs,
  },
  hojaVacia: {
    fontFamily: tipografia.familia.cuerpo,
    fontSize: tipografia.tamano.base,
    color: colores.tintaSuave,
    textAlign: 'center',
    paddingVertical: espaciado.base,
  },
  hojaConteo: {
    fontFamily: tipografia.familia.liviana,
    fontSize: tipografia.tamano.xs,
    color: colores.tintaSuave,
    textAlign: 'center',
  },

  opcion: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaciado.md,
    minHeight: TOQUE_MINIMO,
    paddingHorizontal: espaciado.md,
    paddingVertical: espaciado.sm,
    borderWidth: 2,
    borderColor: 'transparent',
    borderRadius: radios.sm,
    backgroundColor: colores.campoBlanco,
    marginBottom: espaciado.sm,
  },
  opcionSeleccionada: {
    borderColor: colores.negro,
    backgroundColor: colores.panelClaro,
  },
  radio: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2.5,
    borderColor: colores.negro,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioActivo: {
    borderColor: colores.rojo,
  },
  radioPunto: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colores.rojo,
  },
  opcionTextos: {
    flex: 1,
  },
  opcionEtiqueta: {
    fontFamily: tipografia.familia.fuerte,
    fontSize: tipografia.tamano.base,
    color: colores.tinta,
  },
  opcionDescripcion: {
    fontFamily: tipografia.familia.liviana,
    fontSize: tipografia.tamano.xs,
    color: colores.tintaSuave,
    marginTop: 2,
  },
})
