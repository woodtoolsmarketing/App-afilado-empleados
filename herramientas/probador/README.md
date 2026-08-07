# Probador de escritorio

Un solo archivo HTML para recorrer los circuitos de la app del vendedor desde la
PC, conectado al Supabase de verdad, sin compilar un APK.

```bash
npm run probador
```

Genera `herramientas/probador/probador.html`. Se abre con doble clic: no
necesita servidor, ni `npm install`, ni internet más allá de Supabase. Todo va
embebido — el cliente de Supabase, el paquete compartido y los estilos.

---

## Qué es y qué no

**No es la app.** Es un banco de pruebas que habla con el **mismo** Supabase y
usa el **mismo** `packages/compartido`: tokens de marca, validaciones,
`CAMPOS_POR_HERRAMIENTA`, el cálculo del total y los templates de impresión son
literalmente el mismo código que corre en el teléfono.

Lo que sí es una reimplementación es la capa de pantallas: la app está en React
Native y esto es DOM pelado. Por eso sirve para dos cosas —**ver los circuitos**
y **verificar que el backend responde**— y no para una tercera: un error acá no
es necesariamente un error de la app, ni al revés.

## Qué queda afuera, y por qué

| Función | Por qué no está |
|---|---|
| Mapa y navegación | Necesitan GPS y el Maps nativo |
| Dictado por Gemini | Micrófono + Edge Function de transcripción |
| Impresión directa por IPP | El navegador no abre un socket contra la impresora |
| Autocompletado de direcciones | Places corre con la clave restringida a Android |

Ninguna de las cuatro se simula. Un botón que finge imprimir es peor que un
botón que no está: haría creer que el circuito quedó probado.

La impresión **sí** arma el PDF real con el template compartido y abre el
diálogo del navegador, así que el papel se puede revisar.

## Los tres candados

El probador pasa por los mismos que el teléfono:

1. Usuario y contraseña contra Supabase Auth (con la misma regla de
   `usuario` → `usuario@woodtools.com.ar`).
2. El alta tiene que estar **aprobada** por un administrador.
3. La PC queda registrada como **un dispositivo más**, sin autorizar, hasta que
   un admin la habilite desde el panel → Usuarios.

Ese tercer punto es a propósito: es la forma de probar el circuito de
autorización de dispositivos sin tener que reinstalar la app en un teléfono. El
ID de instalación se muestra en pantalla para poder encontrarlo en el panel.

**El ID lo fija el build**, no el navegador. La primera versión lo generaba al
azar y lo guardaba en `localStorage`; desde un `file://` eso se pierde solo, y
cada pérdida creaba un dispositivo nuevo que había que volver a autorizar —se
autorizaba una PC que dejaba de existir al rato. Ahora vive en
`herramientas/probador/.instalacion-id`, sobrevive a las reconstrucciones y es
el mismo en cualquier copia del HTML: se autoriza una vez y listo.

Si borrás ese archivo, el próximo build genera uno nuevo y lo avisa por consola.

## Diagnóstico

El botón **"Ver diagnóstico del backend"** —disponible antes de entrar— chequea
qué está puesto y qué falta: conexión, catálogo de precios, IP de la impresora,
Edge Function de cotización y usuarios habilitados.

Sirve para distinguir un "no aparece nada" causado por una migración sin aplicar
de uno causado por no haber cargado datos todavía. Varios chequeos necesitan
sesión iniciada: RLS los bloquea y **eso es el backend funcionando bien**, así
que se marcan en amarillo, no en rojo.

## Impresora

La IP sale de `configuracion.impresora_oficina`, la misma fila que lee la app.
Para las pruebas está en **`192.168.1.167:631/ipp/print`**. Cambiarla no
requiere reconstruir el probador ni recompilar la app: se lee en cada uso.

El diagnóstico incluye un chequeo de **alcance**: intenta un `fetch` con
`no-cors` contra esa IP. No puede leer la respuesta —la impresora no manda
cabeceras CORS— pero sí distingue "contestó algo" de "no hay nadie", que alcanza
para saber si la IP está bien cargada.

Si dice que no responde puede ser la impresora apagada, estar en otra red, **o
el navegador bloqueando el acceso a la red local desde un archivo abierto con
doble clic**. Esa última restricción no existe en el teléfono, así que un "no
responde" acá no significa que la app no vaya a imprimir.

## Credenciales

Van embebidas en el HTML **la URL del proyecto y la clave anónima**. Son
públicas por diseño —viajan dentro del APK— y no dan más permisos que los que
RLS le conceda al usuario que inicie sesión.

**No van**, y no es una limitación del probador sino cómo está construido el
sistema:

| Credencial | Por qué no |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Saltea RLS por completo: quien tuviera el archivo podría leer y borrar toda la base |
| `GEMINI_API_KEY` | Se gasta por uso. Vive en las Edge Functions |
| `GOOGLE_MAPS_SERVER_KEY` | Ídem |
| `GOOGLE_MAPS_ANDROID_KEY` | Está restringida al paquete y al SHA-1 de la app: en un navegador no funciona |

La app tampoco las lleva. Cuando necesita dictar o geocodificar llama a una Edge
Function y el secreto se queda del lado del servidor.

El script de construcción **frena el build** si `SUPABASE_ANON_KEY` resulta ser
una clave de service role: un `.env` mal pegado no puede terminar en un archivo
que se manda por mail.

Para apuntar a otro proyecto, se cambia el `.env` y se vuelve a correr
`npm run probador`. Por eso `probador.html` está en `.gitignore`: este repo no
guarda claves.

## Publicarlo en un servidor

Sirve para probar desde el celular o desde afuera de la oficina sin pasarse el
archivo por mail. Es el mismo HTML contra el mismo Supabase, pero servido por
`http` en vez de abierto como archivo, y eso arregla dos cosas que molestaban:

- **La sesión persiste.** El navegador trata cada archivo `file://` como un
  origen distinto, así que la sesión se perdía al reabrirlo. Con un dominio
  propio, no.
- **La impresión deja de pelear.** Los bloqueos de ventanas y de red local que
  el navegador aplica a los archivos locales no aplican a un sitio.

Lo que **no** cambia: mapa, dictado e impresión directa por IPP siguen
necesitando el teléfono.

### En Render

El repositorio trae [`render.yaml`](../../render.yaml). Desde el panel:
**New → Blueprint**, se elige este repo, y quedan por cargar cuatro variables:

| Variable | Valor |
|---|---|
| `SUPABASE_URL` | La del proyecto |
| `SUPABASE_ANON_KEY` | La anon / publishable. **Nunca la service_role** |
| `DOMINIO_USUARIO` | `woodtools.com.ar` |
| `PROBADOR_INSTALACION_ID` | Un UUID fijo, generado una sola vez |

Ese último hace falta porque en un servidor el archivo `.instalacion-id` no
existe: cada despliegue arranca de cero desde el repositorio y, sin la
variable, generaría un dispositivo nuevo que habría que volver a autorizar.
Se genera una vez con:

```bash
node -e "console.log(crypto.randomUUID())"
```

El build es `node herramientas/probador/construir.mjs --salida publico/index.html`,
que deja el HTML solo en una carpeta —sin el código fuente al lado— y con el
nombre que espera un servidor estático.

### Lo que hay que tener presente

Publicado, el probador queda detrás de una URL que cualquiera puede abrir.
Entrar sigue exigiendo usuario y contraseña y RLS sigue mandando, así que la
postura de seguridad es la misma que la del APK.

Pero el **dispositivo es uno solo**: al autorizarlo desde el panel queda
autorizado para todo el que tenga la URL y credenciales, porque todas las
visitas comparten el mismo `PROBADOR_INSTALACION_ID`. Mientras sea para probar
está bien; conviene desautorizarlo cuando la prueba termine.
