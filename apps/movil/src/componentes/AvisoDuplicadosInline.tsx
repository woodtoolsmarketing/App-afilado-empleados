import { espaciado, radios } from '@woodtools/compartido'
import * as Clipboard from 'expo-clipboard'
import { useState } from 'react'
import { ActivityIndicator, Pressable, Text, View } from 'react-native'

import { hojaDeTema } from '../nucleo/tema'
import type { PosibleDuplicado } from '../servicios/clientes'
import { Aviso } from './Estado'

/**
 * Aviso INLINE de duplicados, que aparece MIENTRAS el vendedor completa el alta
 * (no recién al guardar): apenas pone el CUIT, el email o el nombre, se chequea
 * contra el padrón y, si ya existe, se avisa acá — para no perder el tiempo de
 * cargar todo un cliente que ya está.
 *
 * Si hay un match 'fuerte' (mismo CUIT/DNI, email, o teléfono+nombre) el aviso es
 * ROJO y fuerte (el caso del CUIT, sobre todo, que es exacto). Si son sólo
 * parecidos por nombre, es una ADVERTENCIA ámbar. En los dos casos el número se
 * puede copiar. El bloqueo de verdad lo sigue haciendo el cartel al guardar
 * ([[ModalDuplicados]]): esto es sólo el aviso temprano.
 */
export function AvisoDuplicadosInline({
  candidatos,
  chequeando,
}: {
  candidatos: PosibleDuplicado[] | null
  chequeando?: boolean
}) {
  const estilos = usarEstilos()
  const [copiado, setCopiado] = useState<string | null>(null)

  if (!candidatos || candidatos.length === 0) {
    if (!chequeando) return null
    return (
      <View style={estilos.buscando}>
        <ActivityIndicator size="small" />
        <Text style={estilos.buscandoTexto}>Fijándonos si ya existe…</Text>
      </View>
    )
  }

  const hayFuerte = candidatos.some((c) => c.fuerza === 'fuerte')
  // Si hay match fuerte (CUIT/email/tel+nombre) se muestran sólo esos; si son
  // todos parecidos, se muestran los parecidos. Tope de 4 para no tapar el form.
  const aMostrar = (hayFuerte ? candidatos.filter((c) => c.fuerza === 'fuerte') : candidatos).slice(0, 4)

  async function copiar(codigo: string) {
    try {
      await Clipboard.setStringAsync(codigo)
      setCopiado(codigo)
    } catch {
      // El número igual queda a la vista para anotarlo.
    }
  }

  return (
    <Aviso
      tono={hayFuerte ? 'error' : 'atencion'}
      titulo={hayFuerte ? 'Ojo: este cliente ya existe' : 'Hay clientes parecidos'}
    >
      <View style={estilos.lista}>
        {aMostrar.map((c, i) => (
          <View key={`${c.codigo}|${i}`} style={estilos.fila}>
            <View style={estilos.datos}>
              <Text style={estilos.nombre} numberOfLines={1}>
                {c.razon_social}
              </Text>
              <Text style={estilos.motivo} numberOfLines={1}>
                N° {c.codigo} · {c.motivo}
                {c.provisorio ? ' (pendiente)' : ''}
              </Text>
            </View>
            <Pressable
              onPress={() => copiar(c.codigo)}
              hitSlop={8}
              style={({ pressed }) => [estilos.copiar, pressed && estilos.copiarTocado]}
            >
              <Text style={estilos.copiarTexto}>{copiado === c.codigo ? '✓' : 'Copiar'}</Text>
            </Pressable>
          </View>
        ))}
        {hayFuerte ? (
          <Text style={estilos.pie}>Usá su número en vez de cargarlo de nuevo.</Text>
        ) : null}
      </View>
    </Aviso>
  )
}

const usarEstilos = hojaDeTema((t) => ({
  buscando: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaciado.xs,
    paddingVertical: espaciado.xs,
  },
  buscandoTexto: {
    fontFamily: t.tipografia.familia.cuerpo,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.tintaSuave,
  },
  lista: { gap: espaciado.xs, marginTop: espaciado.xs },
  fila: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: espaciado.sm,
  },
  datos: { flex: 1 },
  nombre: {
    fontFamily: t.tipografia.familia.fuerte,
    fontSize: t.tipografia.tamano.sm,
    color: t.colores.tinta,
  },
  motivo: {
    fontFamily: t.tipografia.familia.cuerpo,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.tintaSuave,
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
  pie: {
    fontFamily: t.tipografia.familia.cuerpo,
    fontSize: t.tipografia.tamano.xs,
    color: t.colores.tintaSuave,
    marginTop: espaciado.xs,
  },
}))
