# Instaladores

Dos programas distintos, dos formas de armarlos:

| | Qué es | Cómo se arma |
|---|---|---|
| **Panel de la PC** | Un `.exe` de Windows | Se compila acá, en la máquina |
| **App del celular** | Un `.apk` de Android | Se compila en los servidores de Expo |

La diferencia no es un capricho: un APK necesita el SDK de Android y un JDK
—unos 3 GB de herramientas— y además una firma digital que hay que guardar y no
perder nunca, porque sin ella el teléfono se niega a actualizar la app. Expo
hace las dos cosas y guarda la firma; por eso el celular se compila allá.

---

## Panel de la PC

```bash
npm run instalador:pc
```

Deja el instalador en `apps/escritorio/release/`:

```
WoodTools-Panel-0.1.0-instalador.exe
```

Ese archivo se puede mandar por mail o copiar a un pendrive. Al abrirlo deja
elegir la carpeta de instalación y crea el acceso directo en el escritorio.

### Lo que hay que saber

**Las credenciales van adentro.** El instalador se arma con la URL de Supabase
y la clave anónima del `.env` de la raíz **grabadas en el ejecutable**. Son las
mismas que viajan dentro del APK: públicas por diseño, y no dan más permisos que
los que RLS le conceda al usuario que inicie sesión. Si el `.env` no las tiene,
el build se corta con un mensaje que dice cuál falta — antes valía la pena
compilar sin ellas y descubrirlo con la app ya instalada en otra máquina.

El build también se corta si `SUPABASE_ANON_KEY` resulta ser una clave de
service role. Esa clave saltea RLS por completo y no puede terminar dentro de un
archivo que se reparte por mail.

**Windows va a desconfiar.** El ejecutable no está firmado con un certificado de
código —cuestan unos cuantos cientos de dólares por año— así que SmartScreen
muestra una pantalla azul que dice "Windows protegió tu PC". Se entra por *Más
información → Ejecutar de todas formas*. Para una app interna que se instala una
vez por máquina es un costo razonable; si algún día se reparte más, ahí conviene
el certificado.

**El antivirus puede borrar una herramienta del build.** `app-builder.exe`, que
usa electron-builder por dentro, es un falso positivo conocido. Si el build
falla con `spawn ... app-builder.exe ENOENT`, se arregla con:

```bash
npm install
```

y volviendo a correr el instalador.

### Los iconos

Salen del logo de la empresa y ya están en el repositorio. Si cambia el logo:

```bash
python herramientas/generar-iconos.py
```

Genera `apps/escritorio/recursos/icono.png` (la ventana) y `icono.ico` (el
instalador, el acceso directo y la barra de tareas, con las siete medidas que
Windows usa según dónde lo dibuje).

---

## App del celular

Se compila en Expo, y por eso hay tres pasos antes del primero.

### 1. Entrar a la cuenta de Expo

```bash
npm run eas:entrar
```

Pide el usuario y la contraseña de la cuenta de Expo de la empresa. Es la única
parte que no puede quedar automatizada, y está bien que así sea: esa cuenta es
la dueña de la firma de la app.

### 2. Enlazar el proyecto

```bash
npm run eas:iniciar
```

Crea el proyecto en Expo —o se engancha a uno que ya exista— e imprime un
**Project ID**. Ese número va al `.env` de la raíz:

```
EAS_PROJECT_ID=el-que-imprimió
```

Normalmente `eas init` lo escribe solo en `app.json`, pero acá la configuración
es un `app.config.ts` que lee del `.env`, así que hay que copiarlo a mano. Una
sola vez.

### 3. Subir las variables

```bash
npm run eas:variables
```

El `.env` está en `.gitignore` y **no viaja a EAS**: allá se compila desde el
repositorio, sin él. Este comando lee el `.env` de la raíz y carga en el
proyecto de Expo lo que el APK necesita:

| Variable | Para qué | ¿Obligatoria? |
|---|---|---|
| `SUPABASE_URL` | Sin ella no hay login | Sí |
| `SUPABASE_ANON_KEY` | Ídem | Sí |
| `GOOGLE_MAPS_ANDROID_KEY` | Sin ella el mapa se ve gris | Sólo en producción |

Si falta la de Maps avisa y sigue: el mapa y el recorrido quedan grises, pero
notas de pedido, rol de visita, clientes e impresión andan igual. Para el
`--profile produccion` sí es obligatoria y el build se corta sin ella.

No sube `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY` ni
`GOOGLE_MAPS_SERVER_KEY`, y no las va a subir aunque estén en el `.env`: ésas
viven en las Edge Functions (`npm run secretos`) y no tienen nada que hacer en un
teléfono. Los valores tampoco se imprimen en pantalla — ni siquiera cuando el
comando falla y muestra el error.

Se corre una sola vez, y de nuevo sólo si cambia alguna clave.

### 4. Compilar

```bash
npm run instalador:apk
```

Sube el código a Expo y compila allá. Tarda entre diez y veinte minutos según la
cola. Al terminar imprime un enlace de descarga del `.apk` y también queda en
`https://expo.dev` → el proyecto → *Builds*.

La primera vez pregunta si generar el **keystore** (la firma de la app). Hay que
decir que sí y dejar que lo guarde Expo. Esa firma es la que le permite al
teléfono reconocer que una actualización es de la misma app: si se pierde, la
única salida es desinstalar y volver a instalar en cada teléfono.

Hay dos perfiles:

```bash
npm run instalador:apk              # variante interna, se instala al lado de la de producción
npm run instalador:apk:produccion   # la definitiva
```

Son dos apps distintas para Android (`...roldevisita.interno` y
`...roldevisita`), así que se pueden tener las dos instaladas en el mismo
teléfono sin pisarse. Eso es a propósito: permite probar una versión nueva sin
sacarle la que funciona al vendedor.

### 5. Instalarlo en el teléfono

El APK se baja desde el enlace y se abre. Android va a pedir permiso para
instalar aplicaciones de esa fuente; se lo da una vez y queda.

Después de instalar, **el teléfono todavía no entra**: queda registrado como un
dispositivo más y espera que un administrador lo habilite desde el panel →
Usuarios. Es el tercero de los tres candados, y funcionar así es lo que se buscó.

---

### Actualizaciones por aire

Para que el botón "Publicar actualización" del panel sirva —y para que los
celulares se pongan al día solos— hay que habilitarlas una vez:

```bash
npm run eas:actualizaciones
```

Eso deja un `EAS_UPDATE_URL` que va al `.env` de la raíz. **Es obligatoria**:
sin ella el APK sale sordo —no se enlaza `expo-updates`— y ese teléfono no
recibe nunca nada por aire, aunque por fuera se vea igual que uno sano. Estuvo
así seis versiones seguidas, así que ahora el build se corta antes de salir.

Para publicar desde la terminal, el canal se pide y no se adivina, porque una
actualización sólo le llega a los teléfonos cuyo APK se compiló para ese canal:

```bash
npm run publicar:ota              # interno
npm run publicar:ota:beta
npm run publicar:ota:produccion
```

Cada uno se corresponde con su `npm run instalador:apk...`. El botón del panel
hace lo mismo con el canal que se elija en pantalla.

Lo que **no** viaja por aire: permisos nuevos, librerías nativas, cambios de la
versión de Android. Eso necesita un APK nuevo sí o sí. Para esos casos está la
**versión mínima** del panel: se sube el número y el celular atrasado ve un
cartel que le pide actualizar en vez de fallar de maneras raras.

### La clave de Maps, cuando haga falta

Va en el **mismo proyecto de Google Cloud** donde ya vive
`GOOGLE_MAPS_SERVER_KEY`: no hay que crear nada nuevo, sólo una segunda clave.

1. [Google Cloud Console](https://console.cloud.google.com/) → el proyecto que
   ya existe → *APIs y servicios* → *Biblioteca* → habilitar **Maps SDK for
   Android** si no lo está.
2. *Credenciales* → *Crear credenciales* → *Clave de API*.
3. Restringirla, que es lo que la hace segura de meter en un APK:
   - **Restricción de aplicación:** *Apps para Android*, con dos entradas —
     `com.woodtools.roldevisita.interno` y `com.woodtools.roldevisita`— las dos
     con la misma huella SHA-1.
   - **Restricción de API:** sólo *Maps SDK for Android*.

La **SHA-1** sale de:

```bash
npx eas credentials
```

Android → el perfil → *Keystore: Manage everything*. Pero el keystore recién
existe después de la primera compilación, así que el orden que funciona es:
compilar una vez sin la clave —el APK sale igual, con el mapa gris—, pedir la
huella, crear la clave y volver a compilar.

Después va al `.env` como `GOOGLE_MAPS_ANDROID_KEY` y se vuelve a correr
`npm run eas:variables`.

**Es otra clave, no la misma.** `GOOGLE_MAPS_SERVER_KEY` vive en las Edge
Functions y calcula rutas y direcciones; nunca sale del servidor. La de Android
va adentro del APK, de donde cualquiera puede sacarla —Hermes no ofusca los
strings—, y por eso lo único que puede hacer es dibujar mapas.

Mostrar el mapa en Android no tiene costo por uso, pero Google igual exige una
cuenta de facturación en el proyecto. Como la clave de servidor ya funciona,
esa parte ya está resuelta.

---

## Sin instalar nada: el probador

Para probar los circuitos desde una PC o un celular sin compilar nada, está el
probador —un solo archivo HTML contra el mismo Supabase—. Ver
[`herramientas/probador/README.md`](../herramientas/probador/README.md). No
reemplaza a la app: mapa, dictado e impresión directa por IPP siguen
necesitando el teléfono.
