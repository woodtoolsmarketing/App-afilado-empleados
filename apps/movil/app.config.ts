import { config as cargarDotenv } from 'dotenv'
import type { ExpoConfig } from 'expo/config'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Configuración de la app móvil.
 *
 * ─── Por qué la carga del .env está acá adentro y no en un módulo aparte ─────
 *
 * Expo transpila este archivo de forma aislada y NO resuelve imports relativos
 * de TypeScript: un `import { x } from './entorno'` falla con "Cannot find
 * module". Por eso todo vive en un solo archivo, aunque quede más largo.
 *
 * ─── Por qué se corta el build si falta una variable ─────────────────────────
 *
 * Expo busca el `.env` en el directorio de la app, pero en este monorepo el
 * archivo vive en la raíz, compartido con el panel de escritorio. Sin cargarlo
 * explícitamente, TODAS las variables llegan como `undefined` y el resultado es
 * un APK que compila perfecto y no funciona: sin URL de Supabase no hay login,
 * y sin `googleMaps.apiKey` el mapa se ve gris.
 *
 * Ese modo de fallar —silencioso, y recién visible con el APK ya instalado en
 * el teléfono— es lo que justifica cortar el build acá en vez de sólo avisar.
 */

const RAIZ_MONOREPO = path.resolve(__dirname, '../..')

// Precedencia, de mayor a menor:
//   1. Variables ya presentes en el entorno  (es como llegan en EAS Build)
//   2. apps/movil/.env                       (para probar contra otro proyecto)
//   3. .env de la raíz del monorepo          (el compartido con el escritorio)
//
// Sin `override`, dotenv no pisa lo que ya está definido. Es la precedencia
// correcta y no una preferencia de estilo: con `override: true`, un renglón
// vacío en el .env tapaba la variable real inyectada por EAS y el build salía
// sin claves.
for (const archivo of [path.join(__dirname, '.env'), path.join(RAIZ_MONOREPO, '.env')]) {
  if (fs.existsSync(archivo)) cargarDotenv({ path: archivo })
}

const esProduccion = process.env.APP_VARIANTE === 'produccion'

/**
 * Variables sin las cuales la app se instala pero no sirve.
 *
 * En EAS Build el `.env` no viaja (está en .gitignore, y así tiene que ser),
 * así que allá tienen que estar cargadas como variables del proyecto de EAS.
 *
 * `GOOGLE_MAPS_ANDROID_KEY` está sólo en producción, y la diferencia importa:
 * sin ella el mapa se ve gris, pero TODO lo demás anda —notas de pedido, rol de
 * visita, clientes, impresión—. Exigirla siempre significaba no poder probar
 * nada hasta tener una clave de Google con facturación habilitada; no exigirla
 * nunca significaba mandar a la calle una app con el mapa roto. Obligatoria en
 * la variante que se reparte, un aviso ruidoso en la interna.
 */
const OBLIGATORIAS = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  ...(esProduccion ? (['GOOGLE_MAPS_ANDROID_KEY'] as const) : []),
] as const

const faltantes = OBLIGATORIAS.filter((v) => !process.env[v])

if (!esProduccion && !process.env.GOOGLE_MAPS_ANDROID_KEY) {
  console.warn(
    [
      '',
      '  ⚠  Sin GOOGLE_MAPS_ANDROID_KEY: el mapa y el recorrido se van a ver grises.',
      '     El resto de la app anda igual. Para producción la clave es obligatoria.',
      '',
    ].join('\n'),
  )
}

if (faltantes.length > 0) {
  const enEas = !!process.env.EAS_BUILD

  throw new Error(
    [
      '',
      '───────────────────────────────────────────────────────────────',
      '  No se puede compilar: faltan variables de entorno',
      '───────────────────────────────────────────────────────────────',
      '',
      `  Faltan: ${faltantes.join(', ')}`,
      '',
      enEas
        ? [
            '  Estás compilando en EAS, donde el archivo .env NO se sube.',
            '  Cargalas como variables del proyecto:',
            '',
            ...OBLIGATORIAS.map(
              (v) => `    eas env:create --name ${v} --value "..." --environment production`,
            ),
          ].join('\n')
        : [
            '  Completá el .env de la raíz del proyecto:',
            `    ${path.join(RAIZ_MONOREPO, '.env')}`,
            '',
            '  Los pasos están en docs/PUESTA-EN-MARCHA.md',
          ].join('\n'),
      '',
      '───────────────────────────────────────────────────────────────',
      '',
    ].join('\n'),
  )
}

const easUpdateUrl = process.env.EAS_UPDATE_URL
const easProjectId = process.env.EAS_PROJECT_ID

const config: ExpoConfig = {
  name: esProduccion ? 'WoodTools Visitas' : 'WoodTools Visitas (interno)',

  /**
   * El slug tiene que coincidir con el del proyecto en expo.dev.
   *
   * EAS identifica el proyecto por el ID, pero además verifica el slug, y si no
   * coinciden corta el build. El proyecto en expo.dev puede haberse creado con
   * otro nombre —el que uno tipeó en la web— así que se deja pisar por el .env
   * en vez de obligar a renombrarlo de un lado o del otro.
   */
  slug: process.env.EAS_SLUG || 'woodtools-rol-de-visita',

  /**
   * De quién es el proyecto en expo.dev.
   *
   * El proyecto vive en la cuenta de la organización, y quien compila entra con
   * su cuenta personal. Sin este campo, `eas` compara las dos, no coinciden y
   * corta —con un mensaje que además aparece como un error del comando, no como
   * un problema de configuración—. Con `owner` puesto, cualquier miembro de la
   * organización puede compilar con su propio usuario.
   */
  owner: process.env.EAS_OWNER || 'woodtoolssrls-team',
  scheme: 'woodtoolsvisitas',
  version: '1.0.0',
  orientation: 'portrait',
  userInterfaceStyle: 'light',
  primaryColor: '#B30F0F',

  icon: './assets/icono.png',
  splash: {
    image: './assets/splash.png',
    resizeMode: 'contain',
    backgroundColor: '#B30F0F',
  },

  assetBundlePatterns: ['**/*'],

  android: {
    package: esProduccion ? 'com.woodtools.roldevisita' : 'com.woodtools.roldevisita.interno',
    versionCode: 1,
    adaptiveIcon: {
      foregroundImage: './assets/icono-adaptativo.png',
      backgroundColor: '#B30F0F',
    },
    // Sin esta clave el mapa se ve gris. Es distinta de la del servidor: ésta
    // va dentro del APK y está restringida por package name + huella SHA-1.
    //
    // El bloque entero se omite cuando no está: `apiKey: undefined` deja en el
    // manifiesto una entrada vacía, que es peor que no tener ninguna.
    ...(process.env.GOOGLE_MAPS_ANDROID_KEY
      ? { config: { googleMaps: { apiKey: process.env.GOOGLE_MAPS_ANDROID_KEY } } }
      : {}),
    permissions: [
      'ACCESS_COARSE_LOCATION',
      'ACCESS_FINE_LOCATION',
      // Necesario para que el seguimiento siga funcionando con la pantalla
      // apagada mientras el vendedor maneja.
      'ACCESS_BACKGROUND_LOCATION',
      'FOREGROUND_SERVICE',
      'FOREGROUND_SERVICE_LOCATION',
      'RECORD_AUDIO',
      'INTERNET',
      'ACCESS_NETWORK_STATE',
      'VIBRATE',
      'WAKE_LOCK',
      // No se pide REQUEST_INSTALL_PACKAGES a propósito: las actualizaciones
      // van por EAS Update (OTA), no bajando e instalando un APK a mano. Esa
      // permission está prohibida por la política de Google Play para apps que
      // se auto-actualizan, y nos cerraría la puerta a Managed Google Play.
    ],
    blockedPermissions: ['com.google.android.gms.permission.AD_ID'],
  },

  plugins: [
    [
      'expo-location',
      {
        locationAlwaysAndWhenInUsePermission:
          'WoodTools Visitas usa tu ubicación para armar el recorrido más corto y para que la oficina sepa dónde estás mientras el recorrido está en curso.',
        locationWhenInUsePermission:
          'WoodTools Visitas usa tu ubicación para ordenar los destinos del día por cercanía.',
        locationAlwaysPermission:
          'Permitir "siempre" hace que el seguimiento no se corte cuando apagás la pantalla durante el recorrido.',
        isAndroidBackgroundLocationEnabled: true,
        isAndroidForegroundServiceEnabled: true,
      },
    ],
    [
      'expo-audio',
      {
        microphonePermission:
          'WoodTools Visitas usa el micrófono para que puedas dictar las observaciones de cada visita en lugar de escribirlas.',
      },
    ],
    [
      'expo-build-properties',
      {
        android: {
          minSdkVersion: 26,
          compileSdkVersion: 35,
          targetSdkVersion: 35,
          // R8: minifica y ofusca la capa Java/Kotlin en release.
          // Ojo: NO ofusca el bundle de JavaScript (ver docs/DISTRIBUCION-PRIVADA.md).
          //
          // En expo-build-properties 0.13 (SDK 52) la propiedad se llama
          // `enableProguardInReleaseBuilds`; en versiones más nuevas pasó a
          // llamarse `enableMinifyInReleaseBuilds`. Si al actualizar el SDK el
          // build se queja, es este par de líneas.
          enableProguardInReleaseBuilds: true,
          enableShrinkResourcesInReleaseBuilds: true,
        },
      },
    ],
    'expo-secure-store',
    'expo-font',
    // Las actualizaciones por aire son opcionales: sin EAS_UPDATE_URL la app
    // anda igual, sólo hay que reinstalar el APK para actualizarla.
    ...(easUpdateUrl ? ['expo-updates'] : []),
  ],

  ...(easUpdateUrl
    ? {
        updates: {
          url: easUpdateUrl,
          fallbackToCacheTimeout: 0,
          checkAutomatically: 'ON_LOAD' as const,
        },
        runtimeVersion: { policy: 'appVersion' as const },
      }
    : {}),

  extra: {
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
    googleMapsApiKey: process.env.GOOGLE_MAPS_ANDROID_KEY,
    dominioUsuario: process.env.DOMINIO_USUARIO ?? 'woodtools.com.ar',
    variante: esProduccion ? 'produccion' : 'interno',
    ...(easProjectId ? { eas: { projectId: easProjectId } } : {}),
  },
}

export default config
