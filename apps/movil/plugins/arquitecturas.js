const { withGradleProperties } = require('@expo/config-plugins')

/**
 * Qué arquitecturas de procesador lleva el APK.
 *
 * ─── Por qué existe este archivo ─────────────────────────────────────────────
 *
 * El APK pesaba 78 MB y **32 de esos MB eran código que ningún teléfono va a
 * ejecutar jamás**. Está medido abriendo el archivo, que por dentro es un zip:
 *
 *     lib/arm64-v8a      14,8 MB   ← los teléfonos de ahora
 *     lib/armeabi-v7a    10,6 MB   ← teléfonos viejos de 32 bits
 *     lib/x86            15,8 MB   ← emuladores de PC
 *     lib/x86_64         16,1 MB   ← emuladores de PC
 *     todo lo demás      20,3 MB
 *
 * `x86` y `x86_64` son para correr Android adentro de una PC. Viajaban porque
 * el valor que trae la plantilla incluye las cuatro y nadie lo tocó.
 *
 * ─── Por qué importa el peso, y no es por prolijidad ─────────────────────────
 *
 * Con 78 MB el instalador no entra en Supabase, que en este plan rechaza
 * subidas de más de 50 MB. Eso obligaba a repartirlo desde la PC de la oficina,
 * y por lo tanto a que el vendedor pasara por la oficina para actualizar la app.
 * Sacando las dos de emulador el archivo queda cerca de 46 MB, entra, y se puede
 * bajar desde cualquier lado con datos móviles.
 *
 * Y de paso la compilación tarda la mitad: no se compila lo que no se manda.
 *
 * ─── Por qué un plugin y no editar gradle.properties ─────────────────────────
 *
 * Porque `apps/movil/android` se regenera entero en cada compilación —el panel
 * corre `expo prebuild --clean` antes de cada APK, y está ignorado por git— así
 * que cualquier cambio a mano ahí dura hasta la próxima vez y desaparece sin
 * que nada avise. Un plugin corre COMO PARTE de esa regeneración.
 *
 * ─── Si algún día hace falta un emulador ─────────────────────────────────────
 *
 * Para probar en un emulador de PC hay que volver a agregar `x86_64` acá, o
 * compilar con `-PreactNativeArchitectures=x86_64`. El desarrollo en un teléfono
 * de verdad —que es como se trabajó siempre en este proyecto— no se ve afectado.
 */
const PARA_TELEFONOS = 'armeabi-v7a,arm64-v8a'

module.exports = function conArquitecturasDeTelefono(config) {
  return withGradleProperties(config, (config) => {
    const propiedades = config.modResults

    const yaEsta = propiedades.find(
      (p) => p.type === 'property' && p.key === 'reactNativeArchitectures',
    )

    if (yaEsta) {
      yaEsta.value = PARA_TELEFONOS
    } else {
      propiedades.push({
        type: 'property',
        key: 'reactNativeArchitectures',
        value: PARA_TELEFONOS,
      })
    }

    return config
  })
}
