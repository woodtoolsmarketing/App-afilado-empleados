import { colores, espaciado, radios, tipografia } from '@woodtools/compartido'
import { Image } from 'expo-image'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { usarFotoDePerfil } from '../nucleo/foto'
import { etiquetaVendedor, usarSesion } from '../nucleo/sesion'

/**
 * Encabezado fijo sobre el fondo rojo: menú lateral, foto y nombre del
 * vendedor a la izquierda, logo de WoodTools a la derecha.
 */

export function Encabezado({ alAbrirMenu }: { alAbrirMenu: () => void }) {
  const perfil = usarSesion((s) => s.perfil)
  // La foto vive en un bucket privado: lo que hay guardado es la ruta, no una
  // dirección. Hasta que llega la URL firmada se muestran las iniciales.
  const foto = usarFotoDePerfil(perfil?.foto_url)

  return (
    <View style={estilos.contenedor}>
      <Pressable
        onPress={alAbrirMenu}
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

const estilos = StyleSheet.create({
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
    backgroundColor: colores.blanco,
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
    borderColor: colores.blanco,
    overflow: 'hidden',
    backgroundColor: colores.panelOscuro,
  },
  avatar: {
    width: '100%',
    height: '100%',
  },
  avatarVacio: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colores.rojoOscuro,
  },
  iniciales: {
    fontFamily: tipografia.familia.subtitulo,
    fontSize: tipografia.tamano.lg,
    color: colores.blanco,
  },
  textos: {
    flex: 1,
  },
  nombre: {
    fontFamily: tipografia.familia.subtitulo,
    fontSize: tipografia.tamano.base,
    color: colores.blanco,
  },
  rol: {
    fontFamily: tipografia.familia.cuerpo,
    fontSize: tipografia.tamano.xs,
    color: 'rgba(255,255,255,0.9)',
  },
  logo: {
    width: 104,
    height: 46,
    backgroundColor: colores.blanco,
    borderRadius: radios.sm,
  },
})
