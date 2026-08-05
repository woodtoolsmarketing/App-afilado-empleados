# Puesta en marcha — checklist

Los pasos que quedan, en orden, con los enlaces directos. Marcá a medida que
avanzás.

Proyecto: **`wafszjoebefmbuufmula`** · https://supabase.com/dashboard/project/wafszjoebefmbuufmula

---

## 1 · Cargar los secretos de las Edge Functions

Dos caminos, elegí uno.

### Opción A — por consola (más rápido)

El CLI ya quedó instalado en el proyecto:

```bash
npx supabase login
```

```bash
npx supabase link --project-ref wafszjoebefmbuufmula
```

```bash
npx supabase secrets set --env-file .env
```

> `secrets set --env-file .env` sube todo lo que tenga valor en el archivo.
> Las variables `SUPABASE_*` las ignora porque ya son propias de la plataforma.

### Opción B — por el panel

🔗 https://supabase.com/dashboard/project/wafszjoebefmbuufmula/functions/secrets

**Add new secret**, tres veces:

| Nombre | Valor |
|---|---|
| `GOOGLE_MAPS_SERVER_KEY` | la clave de Maps (está en `.env`) |
| `GEMINI_API_KEY` | la clave de Gemini (ídem) |
| `GEMINI_MODELO` | `gemini-3.5-flash-lite` |

---

No hace falta redesplegar: los secretos se leen en cada invocación.

- [ ] Hecho

---

## 2 · Activar el hook de claims

🔗 https://supabase.com/dashboard/project/wafszjoebefmbuufmula/auth/hooks

*Customize Access Token (JWT) Claims* → **Enable** → elegir
`public.custom_access_token_hook` → Save.

> Si algún día hay problemas de login, se desactiva desde esta misma pantalla.
> La función tiene un `exception when others` que la hace inofensiva ante
> errores, pero conviene saber dónde está el interruptor.

- [ ] Hecho

---

## 3 · Cerrar el registro abierto

🔗 https://supabase.com/dashboard/project/wafszjoebefmbuufmula/auth/providers

**Email** → desactivar *Allow new users to sign up* → Save.

> Sin esto, cualquiera con la URL y la clave publicable puede crearse una cuenta.
> Quedaría en `pendiente` sin poder ver nada, pero no hay motivo para dejar la
> puerta abierta.

- [ ] Hecho

---

## 4 · Crear el primer administrador

🔗 https://supabase.com/dashboard/project/wafszjoebefmbuufmula/auth/users

**Add user → Create new user**:

- Email: por ejemplo `admin@woodtools.com.ar`
- Password: la que elijas — **no me la digas, no la necesito**
- ✅ Marcá *Auto Confirm User*

El trigger lo va a crear como vendedor pendiente. Después, en el SQL Editor:

🔗 https://supabase.com/dashboard/project/wafszjoebefmbuufmula/sql/new

```sql
update public.perfiles
   set rol             = 'admin',
       estado          = 'aprobado',
       aprobado_en     = now(),
       nombre_completo = 'Nombre y Apellido',
       codigo_vendedor = null
 where email = 'admin@woodtools.com.ar';

-- Verificación
select email, rol, estado, nombre_completo from public.perfiles;
```

> Creá **dos** administradores. Si el único pierde el acceso, no queda nadie que
> pueda aprobar a nadie — ni siquiera a sí mismo.

### Si te dice "Failed to create user: {}"

Ese error vacío lo daba un CHECK mal puesto: `perfiles_vendedor_necesita_codigo`
exigía código de vendedor a **todo** perfil con rol `vendedor`, pero el trigger
crea cada alta como `vendedor` + `pendiente` y sin código, porque el código lo
asigna el administrador recién al aprobar. El CHECK rechazaba el insert, el
trigger reventaba y el alta en `auth.users` se revertía entera.

No se podía crear **ningún** usuario, ni desde el panel ni desde la app.

Lo arregla `20260805191846_perfiles_codigo_al_aprobar.sql`, que deja la regla
como el circuito ya la usaba: un vendedor **aprobado** necesita código; uno que
espera aprobación, no. De paso, `resolver_alta_usuario` ahora avisa con palabras
en vez de dejar escapar un 23514 crudo al panel.

- [ ] Hecho

---

## 5 · Restringir la clave de Maps actual

🔗 https://console.cloud.google.com/apis/credentials

Es la que ya tenés y hoy está **abierta**: funciona desde cualquier IP y
cualquier aplicación. Sobre esa clave:

1. **Restricciones de aplicación** → *Ninguna* (las Edge Functions no tienen IP
   fija) o *Direcciones IP* si algún día usás IPs fijas.
2. **Restricciones de API** → *Restringir clave* → marcar **solo**:
   - Routes API
   - Places API (New)
3. Renombrala a algo como `woodtools-servidor` para no confundirla después.

- [ ] Hecho

---

## 6 · Crear la clave de Maps para Android

En la misma pantalla → **Crear credenciales → Clave de API**.

1. Nombre: `woodtools-android`
2. **Restricciones de aplicación** → *Apps para Android* → Agregar:
   - Nombre del paquete: `com.woodtools.roldevisita`
   - Huella SHA-1: la del paso 7
3. **Restricciones de API** → *Restringir clave* → marcar **solo**
   **Maps SDK for Android**
4. Pegala en `.env`, en `GOOGLE_MAPS_ANDROID_KEY=`

> Son dos claves distintas a propósito. La del APK es extraíble (Hermes no
> ofusca los strings del bundle), así que sólo puede dibujar mapas. La que
> calcula rutas y consulta direcciones nunca sale del servidor.

- [ ] Hecho

---

## 7 · Crear la cuenta y el proyecto de EAS

```bash
npx eas-cli login
```

Si no tenés cuenta de Expo, se crea gratis en https://expo.dev/signup.

```bash
cd apps/movil
npx eas-cli init
```

Esto crea el proyecto en el servidor de Expo y te devuelve un **Project ID**.
Copialo al `.env` de la raíz:

```
EAS_PROJECT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

> ⚠️ `eas init` normalmente escribe el ID dentro de `app.json`. Acá la
> configuración es `app.config.ts` y lo lee del `.env`, así que hay que pegarlo
> a mano. Si no lo hacés, `eas build` va a decir que el proyecto no está
> vinculado.

- [ ] Hecho

---

## 8 · Obtener la huella SHA-1 (y con eso, terminar el paso 6)

```bash
cd apps/movil
npx eas-cli credentials
```

En el menú: **Android → production → Keystore: Manage everything needed to build
your project → Set up a new keystore**. Al terminar muestra la huella **SHA-1**.

Pegala en la restricción de la clave de Android del paso 6.

> Es un huevo y la gallina: la clave de Android necesita el SHA-1, y el SHA-1
> sale del keystore que crea EAS. Por eso este paso va después del 7 aunque la
> clave se cree en el 6.

- [ ] Hecho

---

## 9 · Cargar las variables en EAS

**Este paso es fácil de saltear y hace fallar el build.** El `.env` está en
`.gitignore` —y así tiene que ser—, o sea que **no se sube a EAS**. Las
variables hay que cargarlas aparte:

```bash
cd apps/movil
npx eas-cli env:create --name SUPABASE_URL --value "https://wafszjoebefmbuufmula.supabase.co" --environment production --visibility plaintext
```

```bash
npx eas-cli env:create --name SUPABASE_ANON_KEY --value "sb_publishable_0ZTvicHANgE5DwN-yOBOqg_uSuVOcEt" --environment production --visibility plaintext
```

```bash
npx eas-cli env:create --name GOOGLE_MAPS_ANDROID_KEY --value "LA_CLAVE_DEL_PASO_6" --environment production --visibility sensitive
```

Si te olvidás de alguna, el build corta con un mensaje que te dice cuál falta y
el comando exacto para cargarla — no vas a terminar con un APK roto sin darte
cuenta.

Para verificar qué quedó cargado:

```bash
npx eas-cli env:list --environment production
```

- [ ] Hecho

---

## 10 · Las imágenes

Reemplazar los cuatro PNG vacíos de `apps/movil/assets/`. Los tamaños están en
[`../apps/movil/assets/LEEME.md`](../apps/movil/assets/LEEME.md).

- [ ] Hecho

---

## 11 · Probar en un teléfono antes de compilar

Vale la pena antes de gastar una cola de build. Con el celular en la misma red
Wi-Fi:

```bash
cd apps/movil
npx expo start
```

> El mapa y el seguimiento de ubicación **no** funcionan en Expo Go: necesitan
> código nativo. Para probarlos hace falta un *development build*
> (`npx eas-cli build --profile desarrollo --platform android`). El login, los
> formularios y el historial sí se prueban con Expo Go.

- [ ] Hecho

---

## 12 · Primer build

```bash
cd apps/movil
npx expo install --fix
```

```bash
npm run compilar:interno
```

⚠️ Antes de repartir el link: en el dashboard de EAS → **Project settings** →
desactivar *Unauthenticated access to internal builds*. Por defecto ese link es
público. Ver [`DISTRIBUCION-PRIVADA.md`](DISTRIBUCION-PRIVADA.md).

- [ ] Hecho

---

## 10 · Carga inicial de datos

Desde el panel de escritorio (`npm run escritorio`):

1. **Usuarios** → aprobar cada vendedor y asignarle el código que ya usa en la
   planilla de papel.
2. **Clientes** → cargar la cartera. Cada uno necesita dirección **con latitud y
   longitud**: sin coordenadas no entra en ningún recorrido.
3. **SQL Editor** → el punto de partida de cada vendedor:

```sql
update public.perfiles
   set origen_lat = -34.6512,
       origen_lng = -58.6234,
       origen_descripcion = 'Depósito WoodTools'
 where codigo_vendedor = '27';
```

4. **Roles de visita** → elegir vendedor y fecha, crear el rol, agregar clientes.

> Para sacar lat/lng de una dirección: Google Maps web → clic derecho sobre el
> punto → el primer renglón del menú son las coordenadas, se copian con un clic.

- [ ] Hecho

---

## 10 bis · La impresora de la oficina

**Ya está cargada para las pruebas: `192.168.1.167`, puerto 631, ruta
`/ipp/print`.** La leen la app y el probador de la misma fila, así que cambiarla
no requiere recompilar nada:

```sql
update public.configuracion
   set valor = jsonb_build_object('ip', '192.168.1.167', 'puerto', 631, 'ruta', '/ipp/print')
 where clave = 'impresora_oficina';
```

Sólo un admin puede modificarla; cualquier usuario habilitado puede leerla.

- [x] Hecho

---

## 10 ter · Probar desde la PC

`npm run probador` arma un HTML suelto que se conecta al mismo Supabase y
recorre los circuitos sin compilar un APK. Sirve sobre todo al principio: su
pantalla de **Diagnóstico** dice qué está puesto y qué falta de esta misma
checklist.

Ojo con un detalle: la PC queda registrada como **un dispositivo más**, sin
autorizar, y hay que habilitarla en el panel → Usuarios igual que un teléfono.
Es a propósito — es la forma de probar ese candado sin reinstalar nada.

Detalles en [`herramientas/probador/README.md`](../herramientas/probador/README.md).

- [ ] Hecho

---

## 11 · Rotar las claves

Una vez que todo funcione, rotá en Google Cloud y AI Studio las dos claves que
pasaron por el chat, y actualizá el secreto de Supabase y el `.env`. Dos minutos
y queda cerrado el tema.

- [ ] Hecho
