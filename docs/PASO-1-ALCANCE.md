# Paso 1 — Alcance

> Iniciar sesión, menú principal y todo el circuito de "Envíos".

---

## Lo que quedó implementado

### Inicio de sesión

| Requisito | Estado | Dónde |
|---|---|---|
| Pedir usuario y contraseña | ✅ | [`IniciarSesion.tsx`](../apps/movil/src/pantallas/IniciarSesion.tsx) |
| Obligar a completar ambos campos, señalando cuál falta | ✅ | `validarLogin()` en [`validaciones.ts`](../packages/compartido/src/validaciones.ts) |
| "Recordar mi cuenta por 30 días" | ✅ | [`sesion.ts`](../apps/movil/src/nucleo/sesion.ts) |
| Volver a pedir el login pasados los 30 días | ✅ | Ídem |
| El acceso lo aprueba un administrador | ✅ | `perfiles.estado` + RLS + panel → Usuarios |
| Datos de usuarios en SQL de Supabase | ✅ | `supabase/migrations/` |
| Olvidé mi contraseña | ✅ | `recuperarContrasena()` |

**Cómo funcionan los 30 días.** Al tildar la casilla se guarda un vencimiento en
el Keystore del teléfono. En cada arranque la app lo compara con la fecha actual:
si venció, cierra la sesión y vuelve a pedir las credenciales. Si **no** se tildó,
la sesión no sobrevive al cierre de la app.

> Se implementó del lado de la app y no con el *time-box* nativo de Supabase
> porque esa función requiere plan Pro (USD 25/mes). Si en algún momento pasan a
> Pro, conviene activarlo también, como refuerzo del lado del servidor.

### Menú principal

| Requisito | Estado |
|---|---|
| Todas las opciones del mockup | ✅ |
| Nombre, foto y "Vendedor #27" cargados del perfil | ✅ |
| Botón "CONTINUAR" | ⚠️ **Se quitó a propósito** — ver más abajo |

Los módulos que se implementan en pasos siguientes (Notas de pedido, Calendario,
Mapa de envíos, Comunicación interna) aparecen atenuados y con la leyenda de
cuándo se habilitan, en vez de estar ocultos.

### Envíos

| Requisito | Estado |
|---|---|
| "TUS ENVÍOS DE HOY SON: N" | ✅ |
| Ver recorrido del día con Google Maps | ✅ |
| Rol de visita cargado desde la base | ✅ |
| Orden por cercanía desde el punto de partida | ✅ (Routes API + PostGIS de respaldo) |
| Iniciar recorrido | ✅ |
| Ubicación visible para el administrador, con la foto del vendedor | ✅ |
| Formulario "¿Destino visitado?" | ✅ |
| Con "NO": desplegable de motivo | ✅ |
| Micrófono ligado a Gemini | ✅ |
| Campos obligatorios, señalando los incompletos | ✅ |
| Rechazar observaciones tipo "." o de una sola palabra | ✅ (en la app **y** en la base) |
| Agregar nuevo destino con autocompletado de Google | ✅ |
| CP completado automáticamente | ✅ |
| Prioridad alta / media / baja | ✅ |
| Historial de envíos hasta 90 días | ✅ |
| Detalle del envío con observaciones | ✅ |
| Archivado a Excel pasados los 90 días, sólo para administradores | ✅ |

### Panel de escritorio

| Función | Estado |
|---|---|
| Ingreso de administradores y supervisores | ✅ |
| Aprobar / rechazar altas | ✅ |
| Habilitar teléfonos | ✅ |
| Alta, baja y edición de clientes | ✅ |
| Armar el rol de visita del día | ✅ |
| Imprimir la planilla en A4 | ✅ |
| Mapa en vivo con la foto de cada vendedor | ✅ |
| Ver quién está entrando a la app | ✅ |

---

## Dos decisiones que cambian el mockup

### 1. Se quitó el botón "CONTINUAR" del menú

El mockup mostraba una lista de opciones más un botón de confirmación. Con
botones grandes y separados, exigir "elegir y después confirmar" duplica los
toques sin evitar ningún error: no hay un estado intermedio visible que revisar.
Y el vendedor usa esto parado en la calle, con una mano.

Cada opción entra directo al tocarla. Si preferís el flujo original, se
reincorpora en un rato.

### 2. La navegación va tramo a tramo

> Esto responde la pregunta que dejaste abierta sobre cargar más de 10
> direcciones.

Hay que separar dos cosas:

**Calcular el recorrido: sí, entran los 13 y bastante más.** Routes API acepta
hasta **25 paradas intermedias** además del origen y el destino. Está resuelto y
no hace falta buscarle la vuelta.

**Abrir Google Maps con todas las paradas cargadas: no se puede.** La URL
universal de Google Maps admite **9 waypoints como máximo**, y sólo **3 en
navegadores móviles**, con un tope de 2.048 caracteres. No es una limitación que
se pueda esquivar: es el límite del formato.

La solución implementada es lanzar la navegación **al próximo destino nada más**.
Cuando el vendedor llega y completa el parte, se le ofrece navegar al siguiente.

Vale aclarar que esto no es un parche: es mejor que meter 13 paradas en un solo
enlace.

- La ruta se recalcula con el tránsito **de ese momento**, no con el de las 8 de
  la mañana.
- Si entra un destino de prioridad alta a media mañana, se intercala sin rearmar
  nada.
- Si el vendedor se desvía, Google recalcula sobre un único destino y no se
  pierde el resto del recorrido.

El recorrido completo se ve igual dentro de la app, dibujado sobre el mapa con la
polilínea de Routes API. Ahí no hay límite de puntos.

**Si en algún momento hacen falta más de 25 paradas por jornada**, existe la
Route Optimization API de Google, que maneja volúmenes mucho mayores (5.000
paradas gratis por mes en el SKU de vehículo único). Requiere autenticación con
cuenta de servicio en vez de clave de API, así que es un cambio acotado en la
Edge Function `optimizar-ruta` cuando haga falta.

---

## Lo que falta para poder usarlo

✅ **Supabase ya está.** Proyecto `WoodTools-Rol-de-Visita`
(`wafszjoebefmbuufmula`, São Paulo) con las 9 migraciones aplicadas, 13 tablas
con RLS, los buckets creados y las claves cargadas en los `.env`.

Queda:

1. **Dos ajustes en el panel de Supabase** que no se pueden hacer por SQL:
   activar el *Custom Access Token Hook* y desactivar el registro abierto.
2. **Los cuatro archivos gráficos** de `apps/movil/assets/` — hoy están vacíos.
3. **Las claves** de Google Maps (dos: Android y servidor) y Gemini, más el
   despliegue de las Edge Functions.
4. **El primer administrador**, creado desde el panel de Supabase.
5. **La carga inicial**: vendedores, clientes con coordenadas y el punto de
   partida de cada vendedor.

Todo el detalle, paso a paso, está en [`CONFIGURACION.md`](CONFIGURACION.md).

---

## Un tema que conviene resolver antes de salir a la calle

El seguimiento de ubicación de empleados tiene implicancias laborales en
Argentina. Antes de repartir los celulares conviene dejar por escrito y firmado:

- Que sólo se rastrea **mientras el recorrido está en curso** — así está
  implementado: el seguimiento arranca con "Iniciar recorrido" y se corta al
  finalizarlo.
- Cuál es la finalidad (optimizar recorridos y coordinar entregas).
- Cuánto se conservan los datos (90 días, después se archivan).
- Quiénes pueden verlos (administradores y supervisores).

La app ya muestra un aviso permanente mientras el seguimiento está activo y
permite detenerlo desde Configuración, pero el respaldo documental es una
decisión de la empresa, no algo que el código pueda resolver.

---

## Para el paso 2

La memoria del proyecto queda en este documento, en
[`ARQUITECTURA.md`](ARQUITECTURA.md) y en el esquema de `supabase/migrations/`.
Cuando arranquemos el paso siguiente, el modelo de datos y los componentes ya
están listos para extenderse sin tocar lo que anda:

- Los módulos pendientes ya tienen su lugar en el menú.
- La tabla `configuracion` permite ajustar parámetros sin desplegar.
- `packages/compartido` centraliza tipos, colores y validaciones: agregar una
  pantalla nueva no implica reescribir nada.
