import { espaciado, radios } from '@woodtools/compartido'
import * as Clipboard from 'expo-clipboard'
import { useState } from 'react'
import { Modal, Pressable, ScrollView, Text, View } from 'react-native'

import { hojaDeTema } from '../nucleo/tema'
import type { PosibleDuplicado } from '../servicios/clientes'
import { BotonPrincipal, BotonSecundario } from './Botones'
import { Aviso } from './Estado'
import { Pantalla, Panel, TituloPanel } from './Pantalla'

/**
 * El cartel de "este cliente ya existe" / "¿no será alguno de estos?".
 *
 * Se abre cuando, al crear un cliente nuevo, el servidor encuentra posibles
 * repetidos. Si hay al menos uno 'fuerte' (mismo CUIT/DNI, email, o teléfono +
 * nombre parecido) BLOQUEA: el vendedor usa el número que ya existe en vez de
 * crear otro. Si son todos 'parecido' (sólo el nombre se parece) AVISA pero deja
 * seguir con "Es otro, crear igual".
 *
 * El número de cada candidato se puede COPIAR para pegarlo en la nota o pasárselo
 * a la oficina. Un provisorio ya tiene número (P-000123), pero está pendiente de
 * que la oficina lo confirme; se aclara.
 */
export function ModalDuplicados({
  candidatos,
  alCerrar,
  alContinuar,
}: {
  candidatos: PosibleDuplicado[] | null
  alCerrar: () => void
  /** Crear igual. Sólo se ofrece cuando NO hay ningún candidato 'fuerte'. */
  alContinuar: () => void
}) {
  const estilos = usarEstilos()
  const [copiado, setCopiado] = useState<string | null>(null)

  const visible = !!candidatos && candidatos.length > 0
  const bloquea = !!candidatos && candidatos.some((c) => c.fuerza === 'fuerte')

  async function copiar(codigo: string) {
    try {
      await Clipboard.setStringAsync(codigo)
      setCopiado(codigo)
    } catch {
      // Si el portapapeles falla, el número igual está a la vista para anotarlo.
    }
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={alCerrar}>
      <Pantalla>
        <Panel desplazable={false} contentStyle={estilos.contenido}>
          <TituloPanel>{bloquea ? 'ESTE CLIENTE\nYA EXISTE' : '¿NO SERÁ ALGUNO\nDE ESTOS?'}</TituloPanel>

          <Aviso tono={bloquea ? 'error' : 'atencion'}>
            {bloquea
              ? 'Ya hay un cliente cargado con estos datos. Usá su número en lugar de crear uno repetido.'
              : 'Encontramos clientes parecidos. Fijate que no sea uno de estos antes de crear uno nuevo.'}
          </Aviso>

          <ScrollView style={estilos.lista} contentContainerStyle={estilos.listaContenido}>
            {(candidatos ?? []).map((c, i) => (
              <View key={`${c.codigo}|${i}`} style={estilos.tarjeta}>
                <Text style={estilos.nombre} numberOfLines={2}>
                  {c.razon_social}
                </Text>
                {c.localidad ? <Text style={estilos.dato}>{c.localidad}</Text> : null}
                <Text style={estilos.motivo}>
                  {c.motivo}
                  {c.provisorio ? ' · pendiente de confirmar' : ''}
                </Text>
                <View style={estilos.filaCodigo}>
                  <Text style={estilos.codigo}>N° {c.codigo}</Text>
                  <Pressable
                    onPress={() => copiar(c.codigo)}
                    hitSlop={8}
                    style={({ pressed }) => [estilos.copiar, pressed && estilos.copiarTocado]}
                  >
                    <Text style={estilos.copiarTexto}>
                      {copiado === c.codigo ? '✓ Copiado' : 'Copiar número'}
                    </Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </ScrollView>

          <View style={estilos.botones}>
            {bloquea ? (
              <BotonPrincipal titulo="Entendido" alTocar={alCerrar} />
            ) : (
              <>
                <BotonSecundario titulo="Es otro, crear igual" alTocar={alContinuar} />
                <BotonPrincipal titulo="Volver" alTocar={alCerrar} />
              </>
            )}
          </View>
        </Panel>
      </Pantalla>
    </Modal>
  )
}

const usarEstilos = hojaDeTema((t) => ({
  contenido: { flex: 1, padding: espaciado.base, gap: espaciado.base },
  lista: { flex: 1 },
  listaContenido: { gap: espaciado.sm, paddingBottom: espaciado.xs },
  tarjeta: {
    backgroundColor: t.colores.panelClaro,
    borderRadius: radios.sm,
    padding: espaciado.sm,
    gap: espaciado.xs,
  },
  nombre: {
    fontFamily: t.tipografia.familia.fuerte,
    fontSize: t.tipografia.tamano.sm,
    color: t.colores.tinta,
  },
  dato: {
    fontFamily: t.tipografia.familia.cuerpo,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.tintaSuave,
  },
  motivo: {
    fontFamily: t.tipografia.familia.cuerpo,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.tintaSuave,
  },
  filaCodigo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: espaciado.xs,
  },
  codigo: {
    fontFamily: t.tipografia.familia.fuerte,
    fontSize: t.tipografia.tamano.base,
    color: t.colores.rojoAccion,
  },
  copiar: {
    borderWidth: 1,
    borderColor: t.colores.rojoAccion,
    borderRadius: radios.sm,
    paddingVertical: espaciado.xs,
    paddingHorizontal: espaciado.sm,
  },
  copiarTocado: { opacity: 0.6 },
  copiarTexto: {
    fontFamily: t.tipografia.familia.fuerte,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.rojoAccion,
  },
  botones: { gap: espaciado.sm },
}))
