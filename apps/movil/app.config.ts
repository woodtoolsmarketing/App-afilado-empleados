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

/**
 * Tres variantes, tres apps distintas para Android.
 *
 * Cada una tiene su `package`, así que Android las trata como programas
 * separados: se pueden instalar las tres en el mismo teléfono y ninguna ve los
 * datos de la otra. Eso es justamente lo que permite probar una versión sin
 * arriesgar lo que el vendedor ya tiene cargado en la que usa todos los días.
 */
type Variante = 'produccion' | 'interno' | 'beta'

const VARIANTE: Variante = (['produccion', 'interno', 'beta'] as const).includes(
  process.env.APP_VARIANTE as Variante,
)
  ? (process.env.APP_VARIANTE as Variante)
  : 'interno'

const esProduccion = VARIANTE === 'produccion'

const NOMBRE: Record<Variante, string> = {
  produccion: 'WoodTools Visitas',
  interno: 'WoodTools Visitas (interno)',
  beta: 'WoodTools Visitas (beta)',
}

const PAQUETE: Record<Variante, string> = {
  produccion: 'com.woodtools.roldevisita',
  interno: 'com.woodtools.roldevisita.interno',
  beta: 'com.woodtools.roldevisita.beta',
}

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
  name: NOMBRE[VARIANTE],

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
    package: PAQUETE[VARIANTE],
    versionCode: 1,
    adaptiveIcon: {
      foregroundImage: './assets/icono-adaptativo.png',
      // Blanco, no el rojo de la marca: el logo lleva el texto en negro y la
      // sierra en gris, y sobre rojo no se lee ninguno de los dos. El logo está
      // hecho para fondo claro y el ícono lo respeta.
      backgroundColor: '#FFFFFF',
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
      /**
       * Sin esto, dictar mientras hay un recorrido en curso no funciona.
       *
       * Desde Android 14 los servicios en primer plano tienen que declarar de
       * qué tipo son, y el permiso de micrófono se evalúa contra esa lista.
       * Mientras el seguimiento de ubicación mantiene su servicio activo, el
       * sistema trata la captura de audio como si viniera de ahí: prepara la
       * grabadora sin quejarse y después no entrega nada.
       *
       * El síntoma era exactamente ése: el micrófono andaba en la nota de
       * pedido y no andaba al terminar una entrega, que es la única pantalla
       * que se usa con el recorrido en marcha.
       */
      'FOREGROUND_SERVICE_MICROPHONE',
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
          /**
           * Sin esto el build muere compilando `expo-modules-core`.
           *
           * React Native 0.76.6 fija Kotlin 1.9.24, pero el
           * `expo-modules-core` que viene con el SDK 52.0.49 trae el compilador
           * de Compose 1.5.15, que exige 1.9.25. El error que se ve es:
           *
           *   e: This version (1.5.15) of the Compose Compiler requires Kotlin
           *      version 1.9.25 but you appear to be using 1.9.24
           *   ksp-1.9.25-1.0.20 is too new for kotlin-1.9.24
           *
           * Es una discrepancia entre dos dependencias, no del código de la
           * app, y no se nota hasta que se compila el APK entero: en
           * desarrollo el bundle de JavaScript no pasa por el compilador de
           * Kotlin.
           */
          kotlinVersion: '1.9.25',
          /**
           * Sin esto la app NO puede imprimir, y el motivo no es evidente.
           *
           * Android bloquea el tráfico HTTP sin cifrar desde que las apps
           * apuntan a la API 28, y esa política no distingue "internet" de "la
           * red de tu oficina". La impresora habla IPP sobre HTTP plano —no
           * tiene certificado ni forma de tenerlo— así que el pedido muere
           * antes de salir del teléfono, con un error de política de red que
           * en la pantalla se ve como "no se pudo imprimir".
           *
           * Se nota sólo en el APK que se reparte: en desarrollo Android deja
           * pasar el texto plano, así que esto compila y anda hasta que se
           * instala la versión de verdad.
           *
           * Lo ideal sería permitirlo únicamente contra la impresora, pero eso
           * se declara por dirección exacta y la asigna el router por DHCP: la
           * lista quedaría vieja el día que cambie. Lo que sí acota el riesgo
           * es que la app no tiene otro tráfico sin cifrar — todo lo demás va
           * por HTTPS a Supabase.
           */
          usesCleartextTraffic: true,
          /**
           * R8 y el shrinking de recursos, APAGADOS.
           *
           * Estaban prendidos para ofuscar la capa Java/Kotlin. El problema es
           * que R8 elimina y renombra clases mirando quién las referencia, y en
           * React Native media plataforma se referencia por reflexión: los
           * módulos nativos se registran por nombre, en tiempo de ejecución. Lo
           * que R8 no ve referenciado, lo borra — y la app queda esperando algo
           * que ya no existe.
           *
           * Eso explica exactamente el síntoma: en desarrollo anda, y el APK
           * que se reparte se queda en la pantalla roja hasta que Android
           * ofrece cerrarla. Es release-only por definición, así que no hay
           * forma de verlo antes de compilar el APK entero.
           *
           * Expo los trae apagados por defecto justamente por esto. Volver a
           * prenderlos exige escribir reglas `-keep` para cada módulo nativo y
           * probar el APK una por una; la ofuscación que dan a cambio no
           * protege el bundle de JavaScript, que es donde está la lógica
           * (ver docs/DISTRIBUCION-PRIVADA.md).
           */
          enableProguardInReleaseBuilds: false,
          enableShrinkResourcesInReleaseBuilds: false,
        },
      },
    ],
    'expo-secure-store',
    'expo-font',
    // Las actualizaciones por aire son opcionales: sin EAS_UPDATE_URL la app
    // anda igual, sólo hay que reinstalar el APK para actualizarla.
    ...(easUpdateUrl ? ['expo-updates'] : []),
  ],

  /**
   * Actualizaciones por aire.
   *
   * Cuando no hay URL, `enabled: false` **explícito**. `expo-updates` está en
   * las dependencias, así que el módulo nativo se enlaza igual y queda activo
   * por defecto: la app arranca buscando un manifiesto contra una URL que no
   * existe, y ese es tiempo que el vendedor mira una pantalla quieta.
   *
   * Antes acá no había nada, que no es lo mismo que apagarlo.
   */
  ...(easUpdateUrl
    ? {
        updates: {
          url: easUpdateUrl,
          fallbackToCacheTimeout: 0,
          checkAutomatically: 'ON_LOAD' as const,
        },
        runtimeVersion: { policy: 'appVersion' as const },
      }
    : { updates: { enabled: false } }),

  extra: {
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
    googleMapsApiKey: process.env.GOOGLE_MAPS_ANDROID_KEY,
    dominioUsuario: process.env.DOMINIO_USUARIO ?? 'woodtools.com.ar',
    variante: VARIANTE,
    ...(easProjectId ? { eas: { projectId: easProjectId } } : {}),
  },
}

export default config
