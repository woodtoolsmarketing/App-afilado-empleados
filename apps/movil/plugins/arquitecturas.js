const { withAppBuildGradle, withGradleProperties } = require('@expo/config-plugins')

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
 * El instalador NO se baja de Supabase Storage —eso sí tiene tope de 50 MB en
 * este plan—: lo sirve el panel de la oficina por la red local, y de respaldo
 * queda el enlace de EAS para datos móviles (ver servicios/actualizacionApk.ts).
 * Así que el tamaño ya no traba la entrega; lo que se cuida es la descarga del
 * vendedor con datos móviles y el tiempo de compilación. Por eso se llevan las
 * dos arquitecturas de teléfono y se sacan las de emulador (x86/x86_64), que
 * eran 32 de los 78 MB y ningún teléfono ejecuta jamás.
 *
 * Y de paso la compilación tarda menos: no se compila lo que no se manda.
 *
 * ─── Por qué hacen falta DOS perillas, y cuál es la que manda ────────────────
 *
 * `reactNativeArchitectures` (en gradle.properties) **no alcanza**. La consume
 * el plugin de React Native para decidir qué compila desde el código fuente,
 * pero las bibliotecas nativas vienen ya compiladas adentro de los paquetes:
 * cambiar esa propiedad no evita que se empaqueten. Está comprobado en papel —
 * se compiló con la propiedad puesta y el APK salió igual, con las cuatro
 * arquitecturas y 75,8 MB.
 *
 * La que manda es `abiFilters`, de Android: es la que decide qué se mete en el
 * archivo final, venga de donde venga. Se dejan las dos porque hacen cosas
 * distintas y las dos suman: una evita compilar de más, la otra evita empaquetar
 * de más.
 *
 * ─── Por qué un plugin y no editar gradle.properties ─────────────────────────
 *
 * Porque `apps/movil/android` se regenera entero en cada compilación —el panel
 * corre `expo prebuild --clean` antes de cada APK, y está ignorado por git— así
 * que cualquier cambio a mano ahí dura hasta la próxima vez y desaparece sin
 * que nada avise. Un plugin corre COMO PARTE de esa regeneración.
 *
 * ─── Por qué SÍ va `armeabi-v7a` ─────────────────────────────────────────────
 *
 * `armeabi-v7a` es para teléfonos de 32 bits. Cualquier equipo vendido de 2019
 * en adelante es de 64, así que en la mayoría de los teléfonos estos 10,6 MB no
 * se ejecutan nunca — pero en un equipo de 32 bits el APK sólo-arm64 NO se
 * instala, y no falla en silencio: Android lo rechaza con "aplicación no
 * instalada". Como el tamaño ya no traba la entrega —el APK queda cerca de
 * 46 MB y lo sirve el panel de la oficina, no Supabase Storage— se incluye para
 * que la app entre en cualquier teléfono, de cualquier gama y antigüedad.
 *
 * Siguen afuera x86 y x86_64 (los otros 32 MB): son para emuladores de PC y
 * ninguna app de un teléfono real los ejecuta.
 *
 * Para ver la arquitectura de un teléfono:  adb shell getprop ro.product.cpu.abi
 *
 * ─── Si algún día hace falta un emulador ─────────────────────────────────────
 *
 * Para probar en un emulador de PC hay que agregar `x86_64` acá, o compilar con
 * `-PreactNativeArchitectures=x86_64`. El desarrollo en un teléfono de verdad
 * —que es como se trabajó siempre en este proyecto— no se ve afectado.
 */
const PARA_TELEFONOS = 'arm64-v8a,armeabi-v7a'

/** La que decide qué entra en el APK. Sin esto, lo demás no cambia nada. */
function conFiltroDeAbi(config) {
  return withAppBuildGradle(config, (config) => {
    const gradle = config.modResults

    if (gradle.language !== 'groovy') {
      throw new Error(
        'El build.gradle de la app no es groovy y este plugin no sabe editarlo. ' +
          'Sin esto el APK sale con las cuatro arquitecturas y pesa el doble.',
      )
    }

    if (gradle.contents.includes('abiFilters')) return config

    // Dentro de defaultConfig, que es donde Android lo espera.
    const ancla = /(defaultConfig\s*\{)/
    if (!ancla.test(gradle.contents)) {
      throw new Error('No encontré defaultConfig en build.gradle para poner abiFilters.')
    }

    gradle.contents = gradle.contents.replace(
      ancla,
      `$1
        // Sólo las arquitecturas de teléfono: ver plugins/arquitecturas.js
        ndk {
            abiFilters ${PARA_TELEFONOS.split(',')
        .map((a) => `"${a.trim()}"`)
        .join(', ')}
        }`,
    )

    return config
  })
}

module.exports = function conArquitecturasDeTelefono(config) {
  config = conFiltroDeAbi(config)
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
