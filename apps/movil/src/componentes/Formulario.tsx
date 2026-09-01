import { espaciado, radios, TOQUE_MINIMO } from '@woodtools/compartido'
import { forwardRef, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native'
import { hojaDeTema, usarTema } from '../nucleo/tema'

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
  const estilos = usarEstilos()
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
  const estilos = usarEstilos()
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
  const { colores } = usarTema()
  const estilos = usarEstilos()
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
  const estilos = usarEstilos()
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
  const estilos = usarEstilos()
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
  const estilos = usarEstilos()
  const [abierta, setAbierta] = useState(false)

  /**
   * La lista va en una hoja modal, NO flotando sobre el campo.
   *
   * Flotando no se veía nunca, y el motivo es de Android: los campos de medida
   * se dibujan de a dos por fila, y una capa que se sale de su fila queda
   * recortada por el borde del contenedor. El vendedor tocaba el campo, no
   * pasaba nada, y seguía completando a mano. Una hoja modal se dibuja sobre
   * todo lo demás y no la puede tapar ningún contenedor.
   */
  return (
    <>
      <Campo
        {...propsCampo}
        value={valor}
        accesorio={
          opciones.length > 0 ? (
            <Pressable
              onPress={() => setAbierta(true)}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={`Ver las ${opciones.length} medidas del catálogo`}
              style={({ pressed }) => [estilos.verOpciones, pressed && estilos.filaPresionada]}
            >
              <Text style={estilos.verOpcionesTexto}>▼</Text>
            </Pressable>
          ) : (
            propsCampo.accesorio
          )
        }
      />

      <HojaDeOpciones
        visible={abierta}
        titulo={propsCampo.etiqueta ?? 'Elegí una medida'}
        // Se abre filtrada por lo que ya venía escrito: si tipeó "30", que no
        // tenga que volver a escribirlo para encontrar el 300.
        filtroInicial={valor.trim().replace(',', '.')}
        marcadorBusqueda="Escribí para filtrar…"
        vacio={sinCoincidencias}
        items={opciones.map((o) => ({
          valor: o.valor,
          etiqueta: o.valor,
          descripcion: o.cantidad ? `${o.cantidad} en el catálogo` : undefined,
        }))}
        elegido={valor.trim().replace(',', '.')}
        alElegir={(v) => {
          alElegir(v)
          setAbierta(false)
        }}
        alCerrar={() => setAbierta(false)}
      />
    </>
  )
}

/**
 * La hoja que se abre desde abajo con las opciones.
 *
 * La usan el desplegable y los campos de medida, así que hay un solo lugar
 * donde puede fallar el alto —y un solo lugar donde arreglarlo—.
 *
 * ─── Por qué el alto es fijo y no un máximo ─────────────────────────────────
 *
 * Con `maxHeight` el alto lo decide el contenido, y el contenido es un
 * ScrollView, que puede achicarse hasta cero porque para eso se desplaza.
 * Resultado: con treinta zonas la hoja se colapsaba y lo único que quedaba en
 * pantalla era el velo negro. Con las listas largas el alto se fija y el
 * ScrollView llena lo que sobra; con las cortas se deja que mida el contenido,
 * que ahí no hay nada que colapsar.
 */
function HojaDeOpciones({
  visible,
  titulo,
  items,
  elegido,
  alElegir,
  alCerrar,
  filtroInicial = '',
  forzarBuscador,
  marcadorBusqueda = 'Escribí para filtrar…',
  vacio = 'No hay ninguna opción que coincida.',
}: {
  visible: boolean
  titulo: string
  items: Array<{ valor: string; etiqueta: string; descripcion?: string; buscarEn?: string }>
  elegido: string | null
  alElegir: (valor: string) => void
  alCerrar: () => void
  filtroInicial?: string
  /** Fuerza el buscador aunque haya pocas opciones. */
  forzarBuscador?: boolean
  marcadorBusqueda?: string
  vacio?: string
}) {
  const { colores } = usarTema()
  const estilos = usarEstilos()
  const [filtro, setFiltro] = useState(filtroInicial)
  const { height: altoVentana } = useWindowDimensions()

  // Cada vez que se abre arranca del texto que tenía el campo.
  useEffect(() => {
    if (visible) setFiltro(filtroInicial)
  }, [visible, filtroInicial])

  const conBuscador = forzarBuscador ?? items.length > OPCIONES_PARA_BUSCADOR
  // El alto se fija cuando hay muchas opciones, que es cuando el ScrollView
  // puede colapsar.
  const listaLarga = items.length > OPCIONES_PARA_BUSCADOR
  const alto = Math.round(altoVentana * 0.7)

  const visibles = useMemo(() => {
    const q = comparable(filtro)
    if (!q) return items
    return items.filter((i) =>
      comparable([i.etiqueta, i.descripcion, i.buscarEn].filter(Boolean).join(' ')).includes(q),
    )
  }, [items, filtro])

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={alCerrar}>
      <Pressable style={estilos.velo} onPress={alCerrar}>
        <Pressable
          style={[estilos.hoja, listaLarga ? { height: alto } : { maxHeight: alto }]}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={estilos.hojaCabecera}>
            <Text style={estilos.hojaTitulo}>{titulo}</Text>
            <Pressable
              onPress={alCerrar}
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
              accessibilityLabel={`Buscar en ${titulo}`}
            />
          ) : null}

          <ScrollView
            style={listaLarga ? estilos.hojaListaFija : undefined}
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
                  seleccionada={item.valor === elegido}
                  alSeleccionar={() => alElegir(item.valor)}
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
 * El alto de la hoja y el buscador viven en `HojaDeOpciones`, que comparte con
 * los campos de medida: un solo lugar donde puede fallar el alto.
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
  const estilos = usarEstilos()
  const [abierto, setAbierto] = useState(false)
  const elegido = items.find((i) => i.valor === valor)

  function cerrar() {
    setAbierto(false)
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

      <HojaDeOpciones
        visible={abierto}
        titulo={etiqueta ?? 'Elegí una opción'}
        items={items}
        elegido={valor}
        alElegir={(v) => {
          alCambiar(v as T)
          cerrar()
        }}
        alCerrar={cerrar}
        forzarBuscador={buscable}
        marcadorBusqueda={marcadorBusqueda}
        vacio={vacio}
      />
    </View>
  )
}

/**
 * Desplegable de varias opciones a la vez.
 *
 * Es el TIPO DE OPERACIÓN. Antes eran siete casillas sueltas, en dos columnas,
 * que ocupaban media pantalla y se leían como siete preguntas distintas cuando
 * en realidad son una sola: qué vino a hacer el cliente. Acá se ve como
 * cualquier otro campo —una caja con el ▼— y adentro se marcan las que hagan
 * falta.
 *
 * Cada toque se aplica al instante; el botón de abajo sólo cierra. Así, si la
 * hoja se cierra tocando afuera, lo marcado queda igual: un "LISTO" que además
 * confirma es un botón que se puede perder.
 */
export function DesplegableMultiple<T extends string>({
  etiqueta,
  marcador = 'Elegí una o más',
  valores,
  items,
  alCambiar,
  error,
  obligatorio,
  deshabilitado,
  ayuda,
}: {
  etiqueta?: string
  marcador?: string
  valores: T[]
  items: ItemDesplegable<T>[]
  alCambiar: (valores: T[]) => void
  error?: string | null
  obligatorio?: boolean
  deshabilitado?: boolean
  ayuda?: string
}) {
  const estilos = usarEstilos()
  const [abierto, setAbierto] = useState(false)
  const { height: altoVentana } = useWindowDimensions()

  // En el orden de la lista, no en el que se fueron tocando: así el rótulo del
  // campo dice siempre lo mismo para la misma selección.
  const elegidos = items.filter((i) => valores.includes(i.valor))
  const resumen = elegidos.map((i) => i.etiqueta).join(' · ')

  function alternar(valor: T) {
    alCambiar(
      valores.includes(valor) ? valores.filter((v) => v !== valor) : [...valores, valor],
    )
  }

  const listaLarga = items.length > OPCIONES_PARA_BUSCADOR
  const alto = Math.round(altoVentana * 0.7)

  return (
    <View style={estilos.campoContenedor}>
      {etiqueta ? <Etiqueta obligatorio={obligatorio}>{etiqueta}</Etiqueta> : null}

      <Pressable
        onPress={() => setAbierto(true)}
        disabled={deshabilitado}
        accessibilityRole="button"
        accessibilityLabel={`${etiqueta ?? 'Opciones'}: ${resumen || marcador}`}
        style={({ pressed }) => [
          estilos.desplegableFila,
          pressed && estilos.filaPresionada,
          deshabilitado && estilos.deshabilitado,
        ]}
      >
        <View
          style={[estilos.campoCaja, estilos.desplegableCaja, !!error && estilos.campoConError]}
        >
          <Text style={[estilos.campoTexto, !resumen && estilos.marcador]} numberOfLines={2}>
            {resumen || marcador}
          </Text>
        </View>
        <Text style={estilos.flecha}>▼</Text>
      </Pressable>

      {ayuda && !error ? <Text style={estilos.ayuda}>{ayuda}</Text> : null}
      <MensajeError>{error}</MensajeError>

      <Modal
        visible={abierto}
        transparent
        animationType="fade"
        onRequestClose={() => setAbierto(false)}
      >
        <Pressable style={estilos.velo} onPress={() => setAbierto(false)}>
          <Pressable
            style={[estilos.hoja, listaLarga ? { height: alto } : { maxHeight: alto }]}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={estilos.hojaCabecera}>
              <Text style={estilos.hojaTitulo}>{etiqueta ?? 'Elegí una o más'}</Text>
              <Pressable
                onPress={() => setAbierto(false)}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="Cerrar"
                style={({ pressed }) => [estilos.hojaCerrar, pressed && estilos.filaPresionada]}
              >
                <Text style={estilos.hojaCerrarTexto}>✕</Text>
              </Pressable>
            </View>

            <ScrollView
              style={listaLarga ? estilos.hojaListaFija : undefined}
              contentContainerStyle={estilos.hojaListaContenido}
              bounces={false}
              keyboardShouldPersistTaps="handled"
            >
              {items.map((item) => {
                const marcado = valores.includes(item.valor)
                return (
                  <Pressable
                    key={item.valor}
                    onPress={() => alternar(item.valor)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: marcado }}
                    accessibilityLabel={item.etiqueta}
                    style={({ pressed }) => [
                      estilos.opcion,
                      marcado && estilos.opcionSeleccionada,
                      pressed && estilos.filaPresionada,
                    ]}
                  >
                    <View style={[estilos.casillaCaja, marcado && estilos.casillaMarcada]}>
                      {marcado ? <Text style={estilos.casillaTilde}>✓</Text> : null}
                    </View>
                    <View style={estilos.opcionTextos}>
                      <Text style={estilos.opcionEtiqueta}>{item.etiqueta}</Text>
                      {item.descripcion ? (
                        <Text style={estilos.opcionDescripcion}>{item.descripcion}</Text>
                      ) : null}
                    </View>
                  </Pressable>
                )
              })}
            </ScrollView>

            <Pressable
              onPress={() => setAbierto(false)}
              accessibilityRole="button"
              style={({ pressed }) => [estilos.hojaListo, pressed && estilos.filaPresionada]}
            >
              <Text style={estilos.hojaListoTexto}>
                {valores.length === 0
                  ? 'CERRAR'
                  : `LISTO · ${valores.length} ${valores.length === 1 ? 'ELEGIDA' : 'ELEGIDAS'}`}
              </Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  )
}

const usarEstilos = hojaDeTema((t) => ({
  campoContenedor: {
    gap: espaciado.xs,
  },
  etiqueta: {
    fontFamily: t.tipografia.familia.cuerpo,
    fontSize: t.tipografia.tamano.base,
    color: t.colores.tinta,
  },
  etiquetaCentrada: { textAlign: 'center' },
  etiquetaSobreRojo: {
    color: t.colores.blanco,
    fontSize: t.tipografia.tamano.xl,
    fontFamily: t.tipografia.familia.fuerte,
    textShadowColor: 'rgba(0,0,0,0.35)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  asterisco: {
    color: t.colores.rojoAccion,
    fontFamily: t.tipografia.familia.subtitulo,
  },

  campoCaja: {
    minHeight: TOQUE_MINIMO,
    backgroundColor: t.colores.campo,
    borderWidth: 2,
    borderColor: t.colores.borde,
    borderRadius: radios.sm,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: espaciado.md,
  },
  campoCajaMultilinea: {
    minHeight: 150,
    alignItems: 'stretch',
    backgroundColor: t.colores.campoBlanco,
    paddingVertical: espaciado.sm,
  },
  campoEnfocado: {
    borderColor: t.colores.azul,
  },
  campoConError: {
    borderColor: t.colores.rojoAccion,
    borderWidth: 2.5,
  },
  /** Resultado de una cuenta: se lee, no se escribe. */
  campoCalculado: {
    backgroundColor: t.colores.panelOscuro,
    borderStyle: 'dashed',
  },
  campoTexto: {
    flex: 1,
    fontFamily: t.tipografia.familia.cuerpo,
    fontSize: t.tipografia.tamano.base,
    color: t.colores.tinta,
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
    color: t.colores.tintaTenue,
  },
  ayuda: {
    fontFamily: t.tipografia.familia.liviana,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.tintaSuave,
  },
  ayudaSobreRojo: {
    color: 'rgba(255,255,255,0.85)',
  },

  errorCaja: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: espaciado.sm,
    // Teñido, no pintado: el fondo tiene que dejar ver sobre qué está apoyado
    // el error. En el tema oscuro un rojo al 12 % sobre el panel negro daba un
    // marrón sobre el que el rojo oscuro de abajo no se leía, así que el tinte
    // se levanta y la letra se aclara.
    backgroundColor: t.oscuro ? 'rgba(255,90,90,0.16)' : 'rgba(224,27,36,0.12)',
    borderLeftWidth: 4,
    borderLeftColor: t.colores.rojoAccion,
    borderRadius: radios.sm,
    paddingVertical: espaciado.sm,
    paddingHorizontal: espaciado.sm,
  },
  errorIcono: {
    fontFamily: t.tipografia.familia.titulo,
    fontSize: t.tipografia.tamano.sm,
    color: t.colores.blanco,
    backgroundColor: t.colores.rojoAccion,
    width: 20,
    height: 20,
    borderRadius: 10,
    textAlign: 'center',
    lineHeight: 20,
    overflow: 'hidden',
  },
  errorTexto: {
    flex: 1,
    fontFamily: t.tipografia.familia.cuerpo,
    fontSize: t.tipografia.tamano.xs,
    // El rojo oscuro de siempre en el tema claro; uno claro en el oscuro. Es
    // el mensaje que le dice al vendedor qué campo está mal: si no se lee, el
    // borde rojo del campo queda sin explicación.
    color: t.oscuro ? '#FFB3B3' : '#8A0B0B',
    lineHeight: t.tipografia.tamano.xs * t.tipografia.interlineado.normal,
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
    fontFamily: t.tipografia.familia.cuerpo,
    fontSize: t.tipografia.tamano.lg,
    color: t.colores.tinta,
    letterSpacing: 0.3,
    // Que ceda el espacio a la caja del tilde en vez de empujarla afuera.
    flexShrink: 1,
    marginRight: espaciado.xs,
  },
  casillaEtiquetaCompacta: {
    fontSize: t.tipografia.tamano.base,
    letterSpacing: 0,
  },
  casillaCaja: {
    width: 36,
    height: 36,
    borderWidth: 2.5,
    borderColor: t.colores.borde,
    borderRadius: radios.sm,
    backgroundColor: t.colores.campoBlanco,
    alignItems: 'center',
    justifyContent: 'center',
  },
  casillaMarcada: {
    backgroundColor: t.colores.verde,
  },
  casillaTilde: {
    fontFamily: t.tipografia.familia.titulo,
    fontSize: 22,
    lineHeight: 26,
    color: t.colores.negro,
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
    backgroundColor: t.colores.campoBlanco,
  },
  flecha: {
    fontSize: t.tipografia.tamano.xl,
    color: t.colores.tintaSuave,
    // Padding y no margen: es lo que le da ancho propio dentro del área táctil.
    paddingHorizontal: espaciado.sm,
  },

  /** El triangulito que abre las medidas del catálogo, dentro del campo. */
  verOpciones: {
    paddingHorizontal: espaciado.xs,
  },
  verOpcionesTexto: {
    fontSize: t.tipografia.tamano.base,
    color: t.colores.rojo,
  },

  velo: {
    flex: 1,
    backgroundColor: t.colores.velo,
    justifyContent: 'flex-end',
  },
  hoja: {
    backgroundColor: t.colores.panelClaro,
    borderTopWidth: 3,
    borderColor: t.colores.borde,
    borderTopLeftRadius: radios.lg,
    borderTopRightRadius: radios.lg,
    padding: espaciado.base,
    // El alto lo pone HojaDeOpciones con el alto real de la ventana: fijo
    // cuando hay muchas opciones, al contenido cuando son pocas.
    gap: espaciado.sm,
  },
  hojaCabecera: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaciado.sm,
  },
  hojaTitulo: {
    flex: 1,
    fontFamily: t.tipografia.familia.subtitulo,
    fontSize: t.tipografia.tamano.lg,
    color: t.colores.tinta,
    textAlign: 'center',
  },
  hojaCerrar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.colores.campoBlanco,
    borderWidth: 2,
    borderColor: t.colores.borde,
  },
  hojaCerrarTexto: {
    fontFamily: t.tipografia.familia.subtitulo,
    fontSize: t.tipografia.tamano.base,
    color: t.colores.tinta,
  },
  buscador: {
    minHeight: TOQUE_MINIMO,
    backgroundColor: t.colores.campoBlanco,
    borderWidth: 2,
    borderColor: t.colores.borde,
    borderRadius: radios.sm,
    paddingHorizontal: espaciado.md,
    fontFamily: t.tipografia.familia.cuerpo,
    fontSize: t.tipografia.tamano.base,
    color: t.colores.tinta,
  },
  /**
   * Con alto fijo en la hoja, el ScrollView llena lo que sobra entre el
   * buscador y el pie. `flex: 1` contra un padre de alto definido siempre
   * resuelve; `flexShrink` contra uno de alto automático puede dar cero.
   */
  hojaListaFija: {
    flex: 1,
  },
  hojaListaContenido: {
    paddingBottom: espaciado.xs,
  },
  hojaVacia: {
    fontFamily: t.tipografia.familia.cuerpo,
    fontSize: t.tipografia.tamano.base,
    color: t.colores.tintaSuave,
    textAlign: 'center',
    paddingVertical: espaciado.base,
  },
  hojaConteo: {
    fontFamily: t.tipografia.familia.liviana,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.tintaSuave,
    textAlign: 'center',
  },
  /** El pie de la hoja de varias opciones: cierra y dice cuántas quedaron. */
  hojaListo: {
    minHeight: TOQUE_MINIMO,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.colores.rojoSolido,
    borderWidth: 2,
    borderColor: t.colores.borde,
    borderRadius: radios.sm,
  },
  hojaListoTexto: {
    fontFamily: t.tipografia.familia.subtitulo,
    fontSize: t.tipografia.tamano.base,
    color: t.colores.blanco,
    letterSpacing: 0.8,
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
    backgroundColor: t.colores.campoBlanco,
    marginBottom: espaciado.sm,
  },
  opcionSeleccionada: {
    borderColor: t.colores.borde,
    backgroundColor: t.colores.panelClaro,
  },
  radio: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2.5,
    borderColor: t.colores.borde,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioActivo: {
    borderColor: t.colores.rojo,
  },
  radioPunto: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: t.colores.rojo,
  },
  opcionTextos: {
    flex: 1,
  },
  opcionEtiqueta: {
    fontFamily: t.tipografia.familia.fuerte,
    fontSize: t.tipografia.tamano.base,
    color: t.colores.tinta,
  },
  opcionDescripcion: {
    fontFamily: t.tipografia.familia.liviana,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.tintaSuave,
    marginTop: 2,
  },
}))
