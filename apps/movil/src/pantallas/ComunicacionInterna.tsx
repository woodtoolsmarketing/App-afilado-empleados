import {
  CONTACTOS_INTERNOS,
  enlaceLlamada,
  enlaceWhatsapp,
  espaciado,
  radios,
  TOQUE_MINIMO,
  type ContactoInterno,
} from '@woodtools/compartido'
import { Alert, Linking, Pressable, Text, View } from 'react-native'

import { Aviso } from '../componentes/Estado'
import { Encabezado } from '../componentes/Encabezado'
import { BarraPanel, Pantalla, Panel, TituloPanel } from '../componentes/Pantalla'
import { usarSesion } from '../nucleo/sesion'
import { hojaDeTema } from '../nucleo/tema'
import type { PropsPantalla } from '../navegacion/tipos'

/**
 * "COMUNICACIÓN INTERNA"
 *
 * Los cinco teléfonos de la oficina, cada uno con las dos formas de usarlos:
 * el ícono verde abre el chat de WhatsApp, el azul marca.
 *
 * ─── Por qué dos botones y no uno ───────────────────────────────────────────
 *
 * Porque son dos decisiones distintas y el vendedor ya la tomó antes de entrar
 * acá. "Necesito el precio del código 8003" se escribe —queda anotado, se
 * contesta cuando pueden—; "el cliente está adelante mío esperando" se llama.
 * Un solo botón obligaría a elegir después de tocar, que es un toque de más
 * para algo que ya estaba decidido.
 *
 * ─── Por qué el mensaje de WhatsApp viene empezado ──────────────────────────
 *
 * Del otro lado hay cinco personas recibiendo mensajes de todos los que están
 * en la calle, y "Hola" no dice quién escribe. El nombre y el número de vendedor van puestos
 * de entrada, y el resto lo escribe él: es un encabezado, no un formulario.
 */
export function PantallaComunicacionInterna({
  navigation,
}: PropsPantalla<'ComunicacionInterna'>) {
  const estilos = usarEstilos()
  const perfil = usarSesion((s) => s.perfil)

  const saludo = perfil
    ? `Hola, soy ${perfil.nombre_completo}${perfil.codigo_vendedor ? ` (vendedor ${perfil.codigo_vendedor})` : ''}. `
    : ''

  async function abrir(url: string, queFalta: string) {
    try {
      await Linking.openURL(url)
    } catch {
      /*
       * No se pregunta primero con `canOpenURL`.
       *
       * Android 11 en adelante contesta que NO a casi todo lo que no esté
       * declarado en el manifiesto, aunque la app esté instalada. Preguntando
       * antes, el botón de WhatsApp quedaba muerto en los teléfonos donde
       * WhatsApp andaba perfecto. Se intenta abrir y se avisa si falla, que es
       * la única respuesta confiable.
       */
      Alert.alert('No pudimos abrir eso', queFalta)
    }
  }

  return (
    <Pantalla>
      <Encabezado />

      <Panel contentStyle={estilos.contenido}>
        <BarraPanel alVolver={() => navigation.goBack()} />
        <TituloPanel>{'COMUNICACIÓN\nINTERNA'}</TituloPanel>

        <View style={estilos.lista}>
          {CONTACTOS_INTERNOS.map((c) => (
            <Fila
              key={c.id}
              contacto={c}
              alEscribir={() =>
                void abrir(
                  enlaceWhatsapp(c, saludo),
                  'Parece que este teléfono no tiene WhatsApp instalado. Probá con el botón de llamar.',
                )
              }
              alLlamar={() =>
                void abrir(
                  enlaceLlamada(c),
                  `No se pudo abrir el teléfono. El número de ${c.nombre} es ${c.legible}.`,
                )
              }
            />
          ))}
        </View>

        <Aviso tono="info" titulo="Antes de llamar">
          Si es algo de la app —un precio raro, algo que no se guarda, una pantalla que se
          traba— conviene REPORTAR UN PROBLEMA desde el menú: eso llega con la versión y el
          modelo de tu teléfono puestos, que es lo que hace falta para arreglarlo.
        </Aviso>
      </Panel>
    </Pantalla>
  )
}

function Fila({
  contacto,
  alEscribir,
  alLlamar,
}: {
  contacto: ContactoInterno
  alEscribir: () => void
  alLlamar: () => void
}) {
  const estilos = usarEstilos()

  return (
    <View style={estilos.fila}>
      <View style={estilos.quien}>
        <Text style={estilos.nombre} numberOfLines={1}>
          {contacto.nombre}
        </Text>
        {/*
          El número va en su propio renglón.
          Junto al rol no entraba: "Administración · 11 3097-6000" se cortaba
          justo en el número, que es lo único de esta fila que hay que poder
          leer —para dictarlo, para anotarlo, para marcarlo desde otro
          teléfono—.
        */}
        <Text style={estilos.numero} numberOfLines={1}>
          {contacto.legible}
        </Text>
        <Text style={estilos.rol} numberOfLines={1}>
          {contacto.rol}
        </Text>
      </View>

      {/*
        Un globo de mensaje y un tubo de teléfono, no dos teléfonos.
        Los dos primeros que probé —✆ y ☎— Android los dibuja como emoji, y
        los dos quedaban siendo un tubo: dos botones distintos que decían lo
        mismo. Con el globo se lee de un vistazo cuál escribe y cuál llama, que
        es la única pregunta que se hace el que llega a esta pantalla.
      */}
      <Pressable
        onPress={alEscribir}
        accessibilityRole="button"
        accessibilityLabel={`Escribirle por WhatsApp a ${contacto.nombre}`}
        style={({ pressed }) => [estilos.boton, estilos.whatsapp, pressed && estilos.tocado]}
      >
        <Text style={estilos.icono}>💬</Text>
      </Pressable>

      <Pressable
        onPress={alLlamar}
        accessibilityRole="button"
        accessibilityLabel={`Llamar a ${contacto.nombre}`}
        style={({ pressed }) => [estilos.boton, estilos.llamar, pressed && estilos.tocado]}
      >
        <Text style={estilos.icono}>📞</Text>
      </Pressable>
    </View>
  )
}

const usarEstilos = hojaDeTema((t) => ({
  contenido: { gap: espaciado.md },
  lista: { gap: espaciado.sm },

  fila: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaciado.sm,
    backgroundColor: t.colores.panelClaro,
    borderRadius: radios.sm,
    borderWidth: 2,
    borderColor: t.colores.borde,
    padding: espaciado.sm,
  },
  quien: { flex: 1, gap: 1 },
  nombre: {
    fontFamily: t.tipografia.familia.subtitulo,
    fontSize: t.tipografia.tamano.base,
    color: t.colores.tinta,
  },
  numero: {
    fontFamily: t.tipografia.familia.fuerte,
    fontSize: t.tipografia.tamano.sm,
    color: t.colores.tinta,
    letterSpacing: 0.4,
  },
  rol: {
    fontFamily: t.tipografia.familia.liviana,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.tintaSuave,
  },

  boton: {
    width: TOQUE_MINIMO,
    height: TOQUE_MINIMO,
    borderRadius: radios.sm,
    borderWidth: 2,
    borderColor: t.colores.borde,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Los dos verdes de WhatsApp y el azul del teléfono son los del mockup: se
  // reconocen por el color antes de leer nada.
  whatsapp: { backgroundColor: '#25D366' },
  llamar: { backgroundColor: '#0B4F8A' },
  tocado: { opacity: 0.75 },
  // Tamaño fijo: es un emoji, lo dibuja el sistema con su propio color, y
  // agrandarlo con el tema lo sacaría del botón.
  icono: { fontSize: 26 },
}))
