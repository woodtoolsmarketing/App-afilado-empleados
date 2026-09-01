import { espaciado, radios } from '@woodtools/compartido'
import { Image } from 'expo-image'
import { useState } from 'react'
import { Pressable, Text, View } from 'react-native'

import { MenuLateral } from './MenuLateral'
import { usarFotoDePerfil } from '../nucleo/foto'
import { etiquetaVendedor, usarSesion } from '../nucleo/sesion'
import { hojaDeTema } from '../nucleo/tema'

/**
 * Encabezado fijo sobre el fondo de la marca: las tres rayas, foto y nombre del
 * vendedor a la izquierda, logo de WoodTools a la derecha.
 *
 * El menú desplegable vive acá adentro, y esa es la razón por la que existe en
 * las 27 pantallas: el encabezado ya estaba en todas. Si el estado de "abierto"
 * lo llevara cada pantalla, cada una tendría que acordarse de pasarlo, y la que
 * se olvide se queda sin menú sin que se entere nadie.
 */

export function Encabezado({ alAbrirMenu }: { alAbrirMenu?: () => void }) {
  const estilos = usarEstilos()
  const perfil = usarSesion((s) => s.perfil)
  const [menuAbierto, setMenuAbierto] = useState(false)
  // La foto vive en un bucket privado: lo que hay guardado es la ruta, no una
  // dirección. Hasta que llega la URL firmada se muestran las iniciales.
  const foto = usarFotoDePerfil(perfil?.foto_url)

  return (
    <View style={estilos.contenedor}>
      <Pressable
        onPress={alAbrirMenu ?? (() => setMenuAbierto(true))}
        hitSlop={14}
        accessibilityRole="button"
        accessibilityLabel="Abrir menú"
        style={({ pressed }) => [estilos.hamburguesa, pressed && estilos.presionado]}
      >
        <View style={estilos.linea} />
        <View style={estilos.linea} />
        <View style={estilos.linea} />
      </Pressable>

      <View style={estilos.identidad}>
        <View style={estilos.avatarMarco}>
          {foto ? (
            <Image
              source={{ uri: foto }}
              style={estilos.avatar}
              contentFit="cover"
              transition={200}
              accessibilityLabel={`Foto de ${perfil?.nombre_completo ?? 'el vendedor'}`}
            />
          ) : (
            <View style={[estilos.avatar, estilos.avatarVacio]}>
              <Text style={estilos.iniciales}>{iniciales(perfil?.nombre_completo)}</Text>
            </View>
          )}
        </View>

        <View style={estilos.textos}>
          <Text style={estilos.nombre} numberOfLines={1}>
            {perfil?.nombre_completo ?? '—'}
          </Text>
          <Text style={estilos.rol} numberOfLines={1}>
            {etiquetaVendedor(perfil)}
          </Text>
        </View>
      </View>

      <Image
        source={require('../../assets/logo-woodtools.png')}
        style={estilos.logo}
        contentFit="contain"
        accessibilityLabel="WoodTools S.R.L."
      />

      <MenuLateral abierto={menuAbierto} alCerrar={() => setMenuAbierto(false)} />
    </View>
  )
}

function iniciales(nombre?: string | null): string {
  if (!nombre) return '?'
  return nombre
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
}

const usarEstilos = hojaDeTema((t) => ({
  contenedor: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: espaciado.base,
    paddingVertical: espaciado.sm,
    gap: espaciado.md,
  },
  hamburguesa: {
    width: 34,
    height: 30,
    justifyContent: 'space-between',
    paddingVertical: 3,
  },
  linea: {
    height: 3.5,
    borderRadius: 2,
    backgroundColor: t.colores.blanco,
  },
  presionado: { opacity: 0.6 },

  identidad: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaciado.sm,
  },
  avatarMarco: {
    width: 54,
    height: 54,
    borderRadius: 27,
    borderWidth: 2,
    borderColor: t.colores.blanco,
    overflow: 'hidden',
    backgroundColor: t.colores.panelOscuro,
  },
  avatar: {
    width: '100%',
    height: '100%',
  },
  avatarVacio: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.colores.rojoOscuro,
  },
  iniciales: {
    fontFamily: t.tipografia.familia.subtitulo,
    fontSize: t.tipografia.tamano.lg,
    color: t.colores.blanco,
  },
  textos: {
    flex: 1,
  },
  nombre: {
    fontFamily: t.tipografia.familia.subtitulo,
    fontSize: t.tipografia.tamano.base,
    color: t.colores.blanco,
  },
  rol: {
    fontFamily: t.tipografia.familia.cuerpo,
    fontSize: t.tipografia.tamano.xs,
    color: 'rgba(255,255,255,0.9)',
  },
  logo: {
    width: 104,
    height: 46,
    backgroundColor: t.colores.blanco,
    borderRadius: radios.sm,
  },
}))
