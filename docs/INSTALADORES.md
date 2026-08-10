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
npx eas-cli@latest login
```

Pide el usuario y la contraseña de la cuenta de Expo de la empresa. Es la única
parte que no puede quedar automatizada, y está bien que así sea: esa cuenta es
la dueña de la firma de la app.

### 2. Subir las variables

```bash
npm run eas:variables
```

El `.env` está en `.gitignore` y **no viaja a EAS**: allá se compila desde el
repositorio, sin él. Este comando lee el `.env` de la raíz y carga en el
proyecto de Expo las tres variables que el APK necesita:

| Variable | Para qué |
|---|---|
| `SUPABASE_URL` | Sin ella no hay login |
| `SUPABASE_ANON_KEY` | Ídem |
| `GOOGLE_MAPS_ANDROID_KEY` | Sin ella el mapa se ve gris |

No sube `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY` ni
`GOOGLE_MAPS_SERVER_KEY`, y no las va a subir aunque estén en el `.env`: ésas
viven en las Edge Functions (`npm run secretos`) y no tienen nada que hacer en un
teléfono. Los valores tampoco se imprimen en pantalla.

Se corre una sola vez, y de nuevo sólo si cambia alguna clave.

### 3. Compilar

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

### 4. Instalarlo en el teléfono

El APK se baja desde el enlace y se abre. Android va a pedir permiso para
instalar aplicaciones de esa fuente; se lo da una vez y queda.

Después de instalar, **el teléfono todavía no entra**: queda registrado como un
dispositivo más y espera que un administrador lo habilite desde el panel →
Usuarios. Es el tercero de los tres candados, y funcionar así es lo que se buscó.

---

## Sin instalar nada: el probador

Para probar los circuitos desde una PC o un celular sin compilar nada, está el
probador —un solo archivo HTML contra el mismo Supabase—. Ver
[`herramientas/probador/README.md`](../herramientas/probador/README.md). No
reemplaza a la app: mapa, dictado e impresión directa por IPP siguen
necesitando el teléfono.
