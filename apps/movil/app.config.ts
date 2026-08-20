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
 * `EAS_UPDATE_URL` está en la lista por lo que pasa cuando falta, que no es
 * "una función de menos": el APK sale **sordo de fábrica**. Sin ella no se
 * enlaza `expo-updates` y el bloque `updates` queda apagado, así que ese
 * teléfono no puede recibir nunca nada por aire — y por fuera se ve idéntico a
 * uno sano, con el mismo número de versión en la pantalla. Ya pasó seis
 * versiones seguidas: la línea existía en el `.env` pero vacía, que para el
 * código es lo mismo que no estar. Vale para las tres variantes, porque las
 * tres se reparten a teléfonos de verdad.
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
  'EAS_UPDATE_URL',
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

// Está en OBLIGATORIAS, así que si el build llegó hasta acá, está cargada: el
// corte de más arriba es lo que sostiene este `as string`.
const easUpdateUrl = process.env.EAS_UPDATE_URL as string
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

  /**
   * La versión que ve el vendedor en Configuración: `1.0.1`, `1.0.2`, …
   *
   * ─── Se sube A MANO, y es a propósito ────────────────────────────────────
   *
   * EAS sabe incrementar solo, pero no acá: `autoIncrement` reescribe el
   * archivo de configuración, y con `app.config.ts` —que es código, no un
   * JSON— no puede, así que corta con "autoIncrement option is not supported
   * when using app.config.js". Y con `appVersionSource: remote` lo único que
   * incrementa del lado del servidor es el versionCode; el nombre de versión
   * lo lee siempre de este campo.
   *
   * Así que la regla es una línea: **antes de compilar, subir el último
   * número.** Lo que va entre paréntesis —`1.0.1 (2)`— lo pone EAS solo.
   *
   * OJO con las actualizaciones por aire: `runtimeVersion` sigue a esta
   * versión, así que un APK 1.0.1 NO recibe lo publicado para 1.0.0. Después
   * de compilar hay que publicar de nuevo, o el botón del panel manda a un
   * runtime que ya no usa nadie.
   */
  version: '1.0.5',
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
    // Sin versionCode: con `appVersionSource: remote` lo lleva EAS y este campo
    // se ignora —lo avisa en cada compilación—. Dejarlo escrito acá en 1 hacía
    // creer que todas las compilaciones eran la misma.
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
    // El APK va sólo con las arquitecturas de teléfono: las de emulador eran 32
    // de los 78 MB. Ver el propio plugin, que explica por qué importa el peso.
    './plugins/arquitecturas',
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
    // Va siempre. Antes se enlazaba sólo si había EAS_UPDATE_URL, y ese "sólo
    // si" era el que dejaba salir APK sordos sin que nadie se enterara; ahora
    // la variable es obligatoria y esto no tiene por qué preguntar nada.
    'expo-updates',
  ],

  /**
   * Actualizaciones por aire.
   *
   * Acá había un `enabled: false` para cuando faltaba la URL, y hacía falta:
   * `expo-updates` está en las dependencias, así que el módulo nativo se
   * enlazaba igual y quedaba activo por defecto, buscando un manifiesto contra
   * una URL que no existe — tiempo que el vendedor mira una pantalla quieta.
   *
   * Esa rama ya no existe porque `EAS_UPDATE_URL` es obligatoria: el build se
   * corta antes de llegar hasta acá. Apagarlas prolijamente era el remiendo
   * correcto mientras se podía compilar sin ellas, y lo que no arreglaba es
   * que se pudiera compilar sin ellas.
   */
  updates: {
    url: easUpdateUrl,
    fallbackToCacheTimeout: 0,
    checkAutomatically: 'ON_LOAD' as const,
  },
  runtimeVersion: { policy: 'appVersion' as const },

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
