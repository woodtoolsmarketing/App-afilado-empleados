# Puesta en marcha

Guía de punta a punta. Calculá una tarde para la primera vez.

---

## 0. Lo que hace falta tener

- **Node.js 20 o superior** — https://nodejs.org
- **Supabase CLI** — `npm install -g supabase`
- **EAS CLI** — `npm install -g eas-cli`
- Una cuenta de **Google Cloud** con facturación activada (aunque el consumo
  caiga dentro del tramo gratuito, Google exige tarjeta para habilitar las APIs).
- Una cuenta de **Expo** (gratis) para compilar y distribuir.

```bash
cd App-afilado-empleados
npm install
```

---

## 1. Supabase — ✅ ya está hecho

El proyecto está creado y el esquema aplicado. Estos son los datos:

| | |
|---|---|
| **Proyecto** | `WoodTools-Rol-de-Visita` |
| **Project ID** | `wafszjoebefmbuufmula` |
| **URL** | `https://wafszjoebefmbuufmula.supabase.co` |
| **Región** | `sa-east-1` (São Paulo) |
| **Clave publicable** | `sb_publishable_0ZTvicHANgE5DwN-yOBOqg_uSuVOcEt` |
| **Panel** | https://supabase.com/dashboard/project/wafszjoebefmbuufmula |

Ya quedaron cargados en `.env` y en `apps/escritorio/.env`.

### Qué se aplicó

- Las 9 migraciones de `supabase/migrations/`: extensiones (PostGIS incluido),
  tipos, tablas, rol de visita, seguimiento, funciones, RLS, vistas,
  endurecimiento y Storage.
- **13 tablas, todas con RLS activo.**
- Los 8 parámetros de `configuracion`.
- Los dos buckets privados: `archivos-historial` y `fotos-vendedores`, con sus
  políticas.

Para volver a aplicar todo desde cero en otro proyecto:

```bash
supabase link --project-ref TU_PROJECT_ID
supabase db push
```

### 1.1 Activar el hook de claims — ⚠️ pendiente, se hace a mano

Dashboard → **Authentication → Hooks** → *Custom Access Token* → seleccionar
`public.custom_access_token_hook` → Enable.

> No se puede activar por SQL: es configuración de Auth, no de la base.

> Si algo saliera mal con el hook, se desactiva **desde esta misma pantalla**.
> La función está protegida con un `exception when others`, así que un error no
> bloquea los inicios de sesión, pero conviene saber dónde está el interruptor.

### 1.2 Desactivar el registro abierto — ⚠️ pendiente, se hace a mano

Dashboard → **Authentication → Sign In / Providers → Email** → desactivar
*Allow new users to sign up*.

> Es importante: sin esto, cualquiera con la URL y la clave publicable puede
> crearse una cuenta. Igual quedaría en estado `pendiente` sin poder ver nada,
> pero no hay motivo para dejar la puerta abierta.

### 1.3 Crear el primer administrador

Dashboard → **Authentication → Users → Add user**. Con correo y contraseña,
marcando *Auto Confirm User*.

Después, en **SQL Editor**, ascendelo a administrador (el trigger lo creó como
vendedor pendiente):

```sql
update public.perfiles
   set rol = 'admin',
       estado = 'aprobado',
       aprobado_en = now(),
       nombre_completo = 'Nombre del administrador'
 where email = 'admin@woodtools.com.ar';
```

> Creá **dos** administradores. Si el único pierde el acceso, no queda nadie que
> pueda aprobar a nadie.

---

## 2. Google Cloud

Consola → https://console.cloud.google.com → crear proyecto **WoodTools Visitas**.

### 2.1 Habilitar las APIs

**APIs y servicios → Biblioteca**, habilitar:

- **Routes API**
- **Places API (New)**
- **Maps SDK for Android**

> No busques *Directions API*: pasó a *Legacy* el 1/3/2025 y ya no se puede
> habilitar en proyectos nuevos. Routes API es su reemplazo.

### 2.2 Crear **dos** claves separadas

**Credenciales → Crear credenciales → Clave de API.**

**Clave 1 — Android** (va dentro del APK):
- Restricción de aplicación: *Apps para Android*
- Nombre del paquete: **dos entradas**, una por variante —
  `com.woodtools.roldevisita.interno` y `com.woodtools.roldevisita`. Son dos
  apps distintas para Android a propósito (se pueden tener las dos instaladas
  en el mismo teléfono), y una restricción que sólo nombre a una deja a la otra
  con el mapa gris.
- Huella SHA-1: se obtiene con `eas credentials` (ver paso 4). Es la misma para
  las dos entradas: EAS firma con un solo keystore por proyecto.
- Restricción de API: sólo **Maps SDK for Android**

> El keystore recién existe después de la primera compilación, así que la SHA-1
> no se puede saber antes. El orden que funciona es: compilar una vez sin la
> clave —el APK sale igual, con el mapa gris—, pedir la huella, crear la clave y
> volver a compilar. Sólo el perfil `produccion` exige la clave de entrada.

**Clave 2 — Servidor** (sólo Edge Functions):
- Restricción de aplicación: ninguna, o por IP si tenés IP fija
- Restricción de API: **Routes API** y **Places API (New)**

> Están separadas a propósito: la clave del APK es extraíble (Hermes no ofusca
> strings), así que sólo puede dibujar mapas. La que calcula rutas y consulta
> direcciones nunca sale del servidor.

---

## 3. Gemini

https://aistudio.google.com/apikey → **Create API key**, asociándola al mismo
proyecto de Google Cloud.

### Cargar los secretos — ⚠️ pendiente, se hace a mano

Sin CLI instalado, la vía es el panel:
**Dashboard → Edge Functions → Secrets → Add new secret**

| Nombre | Valor |
|---|---|
| `GOOGLE_MAPS_SERVER_KEY` | la clave de servidor (ver `.env`) |
| `GEMINI_API_KEY` | la clave de Gemini (ver `.env`) |
| `GEMINI_MODELO` | `gemini-3.5-flash-lite` |

Con el CLI:

```bash
npm run secretos
```

Lee esas tres del `.env` y las manda. No las pasa por la línea de comandos, así
que no quedan en el historial de la terminal.

> No sirve `supabase secrets set --env-file .env`: el `.env` tiene variables
> `SUPABASE_*`, Supabase las rechaza por el prefijo y el comando aborta sin subir
> ninguna.

Los secretos se leen en cada invocación: **no hace falta redesplegar** después
de cargarlos.

### Edge Functions — ✅ ya desplegadas

Las cuatro están activas y verificadas, todas con `verify_jwt` activado:

| Función | Estado |
|---|---|
| `transcribir-audio` | v2 · ACTIVE |
| `optimizar-ruta` | v2 · ACTIVE |
| `geocodificar` | v2 · ACTIVE |
| `archivar-historial` | v1 · ACTIVE |

Comprobado: sin token devuelven 401, y con la clave publicable devuelven
"Sesión inválida" — el guardia de autenticación corre **antes** que cualquier
otra cosa, así que no filtran ni siquiera qué secretos están configurados.

Para volver a desplegarlas desde el repo:

```bash
supabase functions deploy transcribir-audio optimizar-ruta geocodificar archivar-historial
```

> Ninguna se despliega con `--no-verify-jwt`. Todas manejan datos de clientes o
> ubicaciones de empleados y validan quién llama.

---

## 4. App móvil

### 4.1 Variables

`.env` (el de la raíz del monorepo) ya tiene las de Supabase. Falta completar
`GOOGLE_MAPS_ANDROID_KEY`.

**Cómo llegan las variables a la app.** `app.config.ts` carga el `.env` de la
raíz explícitamente, porque Expo por sí solo busca el `.env` en `apps/movil/` y
en este monorepo el archivo está compartido con el panel de escritorio.
Precedencia, de mayor a menor:

1. Variables ya presentes en el entorno (así llegan en EAS Build)
2. `apps/movil/.env` (opcional, para probar contra otro proyecto)
3. `.env` de la raíz

**Si falta alguna de las obligatorias** (`SUPABASE_URL`, `SUPABASE_ANON_KEY`,
`GOOGLE_MAPS_ANDROID_KEY`), el build **se corta** con un mensaje que dice cuál
falta y el comando para cargarla. Es a propósito: sin esas variables el APK
compila igual y no sirve —no hay login y el mapa se ve gris—, y eso recién se
descubre con la app instalada en el teléfono.

**Para las compilaciones en la nube**, el `.env` no se sube (está en
`.gitignore`). Hay que cargarlas en el proyecto de EAS:

```bash
cd apps/movil
npx eas-cli env:create --name SUPABASE_URL --value "https://wafszjoebefmbuufmula.supabase.co" --environment production --visibility plaintext
npx eas-cli env:create --name SUPABASE_ANON_KEY --value "sb_publishable_..." --environment production --visibility plaintext
npx eas-cli env:create --name GOOGLE_MAPS_ANDROID_KEY --value "AIza..." --environment production --visibility sensitive
```

> `eas init` guarda el Project ID en `app.json`, pero acá la configuración es
> `app.config.ts` y lo lee de `EAS_PROJECT_ID`. Después de `eas init`, copiá el
> ID al `.env` a mano.

### 4.2 Alinear las versiones de los paquetes

Las versiones del `package.json` son una base. Antes de compilar por primera vez:

```bash
cd apps/movil
npx expo install --fix
```

Eso ajusta cada dependencia de Expo a la versión que corresponde al SDK
instalado. **Hacelo siempre antes del primer build**, o vas a perseguir errores
de compatibilidad que no son del código.

### 4.3 Recursos gráficos

Faltan por poner en `apps/movil/assets/`:

| Archivo | Tamaño | Qué es |
|---|---|---|
| `logo-woodtools.png` | ~1024×400, fondo transparente | El logo del encabezado y el login |
| `icono.png` | 1024×1024 | Ícono de la app |
| `icono-adaptativo.png` | 1024×1024, margen del 25 % | Capa frontal del ícono adaptativo |
| `splash.png` | 1284×2778 | Pantalla de arranque |

### 4.4 Obtener la huella SHA-1

```bash
cd apps/movil
eas credentials
```

Elegí Android → *production* → *Keystore: Manage everything* → se muestra la
huella SHA-1. Pegala en la restricción de la **Clave 1** de Google.

### 4.5 Compilar

```bash
npm run compilar:interno
```

Seguí después [`DISTRIBUCION-PRIVADA.md`](DISTRIBUCION-PRIVADA.md) — hay un paso
de seguridad obligatorio en el dashboard de EAS antes de repartir el link.

---

## 5. Panel de escritorio

`apps/escritorio/.env` ya está creado con las claves del proyecto.

```bash
npm run escritorio            # desarrollo
npm run empaquetar --workspace=@woodtools/escritorio   # instalador .exe
```

El instalador queda en `apps/escritorio/release/`.

---

## 6. Carga inicial de datos

En este orden, desde el panel:

1. **Usuarios** → aprobar a cada vendedor y asignarle su código (el mismo que
   usan hoy en la planilla en papel).
2. **Clientes** → cargar la cartera. Cada cliente necesita **una dirección con
   latitud y longitud**: sin coordenadas no entra en ningún recorrido.
3. **SQL Editor** → cargar el punto de partida de cada vendedor, que es el origen
   por defecto al optimizar la ruta:

```sql
update public.perfiles
   set origen_lat = -34.6512,
       origen_lng = -58.6234,
       origen_descripcion = 'Depósito WoodTools'
 where codigo_vendedor = '27';
```

4. **Roles de visita** → elegir vendedor y fecha, crear el rol y agregar los
   clientes del día.

### Cómo obtener latitud y longitud de una dirección

Google Maps web → clic derecho sobre el punto → el primer renglón del menú son
las coordenadas; se copian al portapapeles con un clic.

---

## 7. Mantenimiento: archivado a los 90 días

Cuando el historial pase los 90 días:

```bash
curl -X POST "https://TU_PROJECT.supabase.co/functions/v1/archivar-historial" \
  -H "Authorization: Bearer TOKEN_DE_UN_ADMIN" \
  -H "Content-Type: application/json" \
  -d '{"retencion_dias": 90}'
```

Genera el Excel, lo sube al bucket privado y devuelve un link de descarga válido
por 15 minutos. Recién después se puede podar:

```sql
select * from public.podar_historial('2026-05-05');
```

`podar_historial` **se niega a borrar** si no encuentra un respaldo que cubra esa
fecha, así que el orden no se puede invertir por error.

---

## Problemas frecuentes

| Síntoma | Causa | Solución |
|---|---|---|
| "Faltan SUPABASE_URL..." en la app | El `.env` no se leyó | Reiniciar Metro con `npx expo start -c` |
| El mapa de la app se ve gris | `GOOGLE_MAPS_ANDROID_KEY` mal restringida | Verificar package name y SHA-1 en Google Cloud |
| "Google no pudo calcular la ruta" | Routes API sin habilitar, o sin facturación | Habilitar la API y activar facturación |
| El autocompletado no sugiere nada | Places API (New) sin habilitar | Habilitarla; ojo que la vieja *Places API* es otra |
| El dictado devuelve error | `GEMINI_API_KEY` sin cargar | `supabase secrets set GEMINI_API_KEY=...` |
| El seguimiento se corta al bloquear la pantalla | Optimización de batería del fabricante | Ajustes → Batería → Sin restricciones |
| El vendedor no puede entrar | Falta aprobar la cuenta o el teléfono | Panel → Usuarios |
| `permission denied for table` | RLS bloqueando | Revisar `rol` y `estado` del perfil |
