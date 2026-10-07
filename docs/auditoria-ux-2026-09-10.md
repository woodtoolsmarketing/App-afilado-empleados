# Auditoría UX + automatización — app móvil WoodTools

_Fecha: 2026-09-10 · 30 pantallas, ~16.500 líneas · auditoría por 6 dominios en paralelo._

## Panorama

La app está **muy bien construida**. Los automatismos grandes ya están resueltos: orden por
cercanía y optimización de ruta, detección de llegada a un destino, autocompletado de direcciones
con Google, tendencia histórica de facturación por cliente, códigos de cómputo por medida, sesión
persistente protegida por el desbloqueo del teléfono, impresora que se autodescubre en la red.

Lo que aparece son **huecos puntuales**, y buena parte son **inconsistencias**: un patrón bueno ya
existe en una pantalla pero no se replicó en la hermana. Casi todo es de bajo esfuerzo y reusa
código ya probado.

## Verificación

No hay emulador viable en esta PC (sin SDK; el APK es arm64-only y un emulador x86_64 no lo corre).
La verificación real es el **teléfono físico por adb** — la app se maneja por adb, la pantalla de
sesión (huella/PIN) la pasa el usuario.

---

## ✅ Batch 1 — HECHO (bugs claros, sin decisión de diseño)

Implementado y con `tsc` en verde. Falta probarlo en el teléfono y publicar OTA.

| # | Qué | Dónde |
|---|-----|-------|
| B1.1 | El título de PENDIENTES muestra "0" en rojo mientras carga (afirma "no tenés notas" con mala señal). Se aplicó el patrón `isLoading || error` que ya usa NotasPedido. | `NotasPendientes.tsx:168` |
| B1.2 | Idem en IMPRESAS. | `NotasImpresas.tsx:49` |
| B1.3 | Registrar un cobro no mostraba spinner y "Cancelar" seguía activo → riesgo de **cobro duplicado**. Ahora `cargando` + Cancelar deshabilitado mientras guarda. | `Cobranzas.tsx:263-268` |
| B1.4 | Ninguna pantalla se refrescaba al volver del segundo plano: faltaba conectar `focusManager` de React Query a `AppState`. Ahora todas se refrescan solas al volver al frente (con `staleTime` 30s). **Verificar en teléfono.** | `App.tsx` |

---

## ✅ Mecanizado — HECHO, PROBADO y PUBLICADO (feature nuevo, fuera de los 37 hallazgos)

_Registrado el 2026-10-07. Pedido aparte de la auditoría; queda acá para no perder el rastro._

Nuevo servicio **MECANIZADO** del agujero (achicar con buje / agrandar), sólo para sierras y fresas. La
operación se **deriva** de comparar el Ø interior actual con el que hay que hacer (más chico = buje, más
grande = agrandado); con eso y la herramienta sale el código fijo (6105/6103 sierra, 7903/7902 fresa) y el
precio **plano por pieza** del catálogo. Calcado del patrón del afilado de mecha: un `SelectorMecanizado`
resuelve código + precio en un `useEffect`, sin pedir confirmación porque no hay nada ambiguo que revisar.

- **Dónde:** `packages/compartido/src/mecanizado.ts` (nuevo), `notas-pedido.ts`, `tipos.ts`,
  `nota-pedido-impresion.ts`; `GenerarNota/Renglon.tsx` (`SelectorMecanizado`) y `Encabezado.tsx`;
  `servicios/notasPedido.ts`. Base: enum `tipo_servicio` += `mecanizado` + RPC `codigos_mecanizado`.
- **Estado:** `tsc` en verde en los 4 proyectos · **probado en el teléfono (1.3.0)** por adb (agrandar
  30→40 = 6103 / $ 53.988, buje 30→25 = 6105 / $ 22.249,60) · **OTA publicado** a interno 1.3.0 y 1.2.1 ·
  nota en el changelog de la 1.3.0.
- Un bug propio, encontrado por la revisión adversarial del diff y arreglado: al reabrir una nota de
  mecanizado el Ø interior actual se blanqueaba (lógica del afilado, donde el agujero es opcional) y eso
  borraba el código y el precio ya cotizados. — `servicios/notasPedido.ts` (`itemDeFila`)
- Commits `bcd750f` (+ auto `2ec355e`) · migraciones `20261006192410`, `20261006192442`, `20261007121648`.

---

## ✅ Afilado de sierra: 8005 por default en 4,4 y 4,5 mm — HECHO, PROBADO y PUBLICADO (fuera de los 37 hallazgos)

_Registrado el 2026-10-07._

A 4,5 mm el catálogo proponía el **8006** (AFIL. DTE. CÓNCAVO 4,5–5,5, $ 768) por tener rango más ajustado
que el **8005** (AFILADO S.C. MD 3,6–5, $ 307,20) —el mismo problema que ya resolvía la regla fija del 8001
en 3,1/3,2—. Se generalizó `promoverCodigoSierra` a una tabla ancho→código para forzar el afilado común al
frente en 4,4 y 4,5 mm (a 4,4 el 8005 ya era el único afilado). La **confirmación obligatoria** del código
sigue igual: se propone, pero el vendedor lo tilda; y si de verdad es diente cóncavo toca el 8006.

- **Dónde:** `apps/movil/src/pantallas/GenerarNota/Renglon.tsx` (`CODIGO_SIERRA_POR_ANCHO` / `promoverCodigoSierra`).
  Es UI del móvil únicamente. Sumar otro default = una línea más en la tabla.
- **Estado:** `tsc` verde · premisa confirmada contra el catálogo real · **probado en el teléfono (1.3.0)** por
  adb (4,4 y 4,5 → 8005, con la confirmación obligatoria) · **OTA publicado** a interno 1.3.0 y 1.2.1 · nota en
  el changelog de la 1.3.0.
- Commit `35f4751` · migración `20261007123643` (changelog).

---

## ✅ Seguridad y permisos — HECHO, PROBADO y PUBLICADO (1.4.0 + 1.5.0, fuera de los 37 hallazgos)

_Registrado el 2026-10-07. Pedido aparte de la auditoría; queda acá para no perder el rastro._

Lote de cambios de seguridad/UX pedidos por la oficina, en dos APK (1.4.0 y 1.5.0). Nada sale por OTA
desde la 1.4.0 en adelante: el bloqueo de captura es un módulo nativo nuevo, así que **todo viaja
horneado en el APK** (publicar el bundle por OTA a un runtime viejo lo reventaría).

- **Sin PDF ni diálogo de impresión** en notas de pedido y rol de visita: la única salida es la
  impresora de la oficina por IPP (se sacó `expo-sharing`/`Print.printAsync` de esos caminos; sigue en
  Modificaciones para el CSV). — `servicios/impresion.ts`, `NotasPendientes.tsx`, `VistaPreviaNota.tsx`,
  `RolDeVisita.tsx`, `DetalleNota.tsx`
- **Buscador en "Clientes de hoy"** (filtra la lista del día por nombre/código con `comparable()`). — `ClientesDelDia.tsx`
- **Buscador único en el Mapa** (nombre / razón social / número; centra el pin y abre acciones; marca
  SIN UBICAR). Reusa `buscarClientes` difuso. — `MapaClientes.tsx`
- **Reordenar a mano el recorrido en el Calendario** (subir/bajar/primero/último), con update optimista,
  reusando `reordenar_paradas`. Opera sólo sobre las paradas SIN hora (las de hora las ubica el reloj). — `CalendarioVisitas.tsx`
- **Bloqueo de captura de pantalla (#5, NATIVO):** `expo-screen-capture` (import diferido) pone
  FLAG_SECURE para **vendedor y administración**; la captura sale en negro y la app no aparece en
  recientes. admin/supervisor no se bloquean. — `servicios/bloqueoDeCaptura.ts` (nuevo), `Navegacion.tsx`
- **Sistema de permisos por rol, configurable desde el panel (#1, #2, #3):** tabla `funciones`
  (opción→roles) + RLS (sólo admin modifica); hook `usarPermisos()` esconde cada opción del menú por
  rol (admin ve todo). **Mapa (todos los clientes) y Cobranzas arrancan admin-only** (#1). Panel: página
  **Permisos** (matriz Opciones × Roles) y selector de **rol** en Usuarios (RPC `cambiar_rol_usuario`,
  con guardas). — `servicios/permisos.ts`, `compartido/tipos.ts`, `Menu.tsx`, `MenuLateral.tsx`,
  `Navegacion.tsx`, `DetalleNota.tsx`; panel `Permisos.tsx` (nuevo), `Usuarios.tsx`, `App.tsx`. Base:
  migraciones `20261007145733`, `20261007145750`.
- **Estado:** `tsc` verde en los 4 proyectos · dos pasadas de revisión adversarial (hallazgos reales
  corregidos) · **probado en el teléfono** (1.5.0, por adb): arranca sin crash en admin/supervisor/
  vendedor; Mapa y Cobranzas ocultos para no-admin; captura en negro en vendedor; matriz de Permisos
  verificada en el panel · **publicado**: APK interno 1.5.0 en `versiones_app` (auto-instala a la flota),
  panel 0.8.1 en GitHub (auto-actualiza).
- **Gotcha de testing** (anotado en memoria): FLAG_SECURE bloquea también `uiautomator dump`; para ver
  el gating del menú en no-admin se usa el rol `supervisor` (gateado pero no bloqueado para captura).
- Commits `1171a6e` (1.4.0 OTA batch), `53a39ba` (#5 + 1.4.0), `e1bbf51` (permisos + 1.5.0), `6dd99bb`
  (panel 0.8.1).

---

## 🟢 Listo para hacer — sin riesgo (reuso de patrones ya existentes)

Todo esto es de bajo esfuerzo y copia código que ya funciona en otra parte de la app.

- **Buscador en las 3 listas de notas** (PENDIENTES, IMPRESAS, HISTORIAL): hoy sólo se puede
  scrollear. Reusar `comparable()` que ya normaliza tildes. — `NotasPendientes.tsx`, `NotasImpresas.tsx`, `HistorialNotas.tsx` · **alta**
- **"Clientes de hoy": fila "SIN UBICAR" apagada.** El atajo "UBICARLO EN EL MAPA" ya existe en
  Calendario; falta cablear el `onPress`. — `ClientesDelDia.tsx:160-164` · **alta**
- **Agendar un destino para otro día no dice para qué día es** (la barra siempre marca hoy).
  Pasar `fecha` a `BarraPanel` + línea en el cartel de éxito. — `AgregarDestino.tsx:329,878` · **alta**
- **4 pantallas sin botón "Reintentar"** en error (Visitas, ClientesDelDia, HistorialVisitas,
  CalendarioVisitas): obligan a salir y volver a entrar. Recorrido y DetalleVisita ya lo tienen. · **media**
- **"Deslizar para actualizar" (RefreshControl)** en las listas: hoy no hay forma de forzar
  relectura si la consulta ya resolvió con datos viejos. — `Pantalla.tsx` (prop) · **baja**
- **Al sumar un renglón con un dato faltante, la pantalla no sube** a mostrar el error en rojo. — `GenerarNota/index.tsx:1193-1196` · **media**
- **Checkbox de selección en PENDIENTES es 30×30** (el estándar de la app es 56 / el componente `Casilla` es 36). — `NotasPendientes.tsx:371-379` · **media**
- **DNI/CUIT no se formatea al escribir** (el placeholder muestra guiones que hay que tipear a mano). — `NuevoCliente.tsx:204-213` · **media**
- **Con el usuario recordado, el foco no salta a la contraseña.** — `IniciarSesion.tsx:46-48` · **baja**
- **"CAMBIAR" (cliente/zona) usa la letra más chica de la app**, siendo el único camino para
  corregir. Subir un escalón. — `Encabezado.tsx:1114,1195` · **baja**
- **`registrarCobranza` no traduce el error 23514** a español como los demás servicios. — `cobranzas.ts:44-77` · **media (preventivo)**
- **La placa "!" del mensaje de error no crece con la letra grande** (queda recortada al máximo). — `Formulario.tsx:840-851` · **media**
- **`BotonSecundario` ignora `accessibilityLabel`** (los otros dos botones la respetan). — `Botones.tsx:126` · **baja**
- **`cobranzas.ts` recalcula "hoy" a mano** en vez de usar `fechaLocalISO` compartido. — `cobranzas.ts:134-138` · **baja**
- **Código muerto:** `ITEMS_PRIORIDAD` quedó de cuando la prioridad se elegía a mano. — `AgregarDestino.tsx:985-989` · **baja**

---

## 🔵 Automatización de mayor valor (esfuerzo medio, alto impacto)

- **La nota de pedido no arranca con el cliente de la parada que la originó.** Es el camino más
  transitado (la mayoría de las notas nacen del rol de visita) y el vendedor llega a una pantalla
  vacía y tiene que volver a buscar al cliente que la app ya le mostró. Precargar desde `paradaId`
  (los datos ya viajan en `parada.cliente`/`parada.direccion`), dejando "✕ CAMBIAR". — `DestinoVisitado.tsx:465`, `GenerarNota/index.tsx` · **alta**
- **Cargar un cobro desde el menú obliga a tipear cliente y código a mano**, sin el buscador que ya
  existe en GenerarNota; además el cobro queda sin `cliente_id`. Reusar `buscarClientes` + `CampoConOpciones`. — `Cobranzas.tsx:197-212` · **alta**
- **La pantalla de cuenta bloqueada dice "avisá a la oficina" pero no da ningún botón** para llamar
  ni escribir. Reusar `CONTACTOS_INTERNOS`/`enlaceWhatsapp` (funcionan sin sesión). Y prellenar el
  código de habilitación en el WhatsApp. — `EstadoCuenta.tsx:79-146` · **alta**
- **Las casillas VENDIÓ/RETIRÓ/ENTREGÓ no se completan solas** aunque ya haya una nota cargada en
  esa visita: si el vendedor se olvida de tildar, la oficina no cuenta la operación. Versión
  conservadora: recordatorio "Ya cargaste una nota con venta acá. ¿Marco VENDIÓ?". — `DestinoVisitado.tsx:379-403` · **alta**
- **Los servicios de uso diario no usan la detección de "sin señal"** que ya existe: el vendedor ve
  el error crudo de Supabase ("Network request failed", en inglés) en vez de "No hay conexión". — `clientes.ts`, `agenda.ts`, `jornada.ts`… · **alta**
- **Buscar un cliente sin resultados obliga a retipear el nombre** en el alta. Botón "Cargar '…'
  como cliente nuevo" que lleve el texto. — `AgregarDestino.tsx:423-434` · **media**
- **"Nuevo cliente" no ofrece geolocalizar con el GPS** (existe en AgregarDestino): un taller sobre
  una ruta no aparece en Google y hoy no se puede dar de alta parado ahí. — `NuevoCliente.tsx:215-261` · **media**
- **Reportar un problema desde el menú lateral no manda la pantalla de origen** (Configuración sí lo
  hace): a Marketing le llega sin saber dónde falló. — `MenuLateral.tsx:76` · **media**
- **El candado biométrico exige un toque de más** ("DESBLOQUEAR") antes del diálogo nativo. Disparar
  el diálogo solo, dejando el botón como reintento. **Probar en la calle** (con guantes/de reojo). — `Navegacion.tsx:115-132` · **alta**

---

## 🟡 Necesitan tu decisión (el comportamiento actual podría ser a propósito)

- **"Agregar otro artículo" (venta) no hereda la herramienta** como sí lo hace "sumar otra" en
  servicio. ¿Querés que arranque preseleccionado el mismo artículo (caso "dos mechas iguales") o
  quedó vacío a propósito porque una venta suele mezclar artículos distintos? — `GenerarNota/index.tsx:1409`
- **Reimprimir varias notas ya impresas** exige abrirlas una por una (PENDIENTES sí tiene selección
  múltiple). ¿Pasa seguido reimprimir en lote (impresora atascada) o es una excepción? — `NotasImpresas.tsx`
- **Dos botones del menú de notas** ("VER PENDIENTES" e "IMPRIMIR PENDIENTES") van a la misma
  pantalla. ¿Los unifico, o el mockup pedía dos a propósito? — `NotasPedido.tsx:67-90`
- **"Mostrar contraseña"**: ojito dentro del campo en login vs. botón ancho en cambio de contraseña.
  ¿Unifico el gesto? (el botón muestra las dos a la vez para comparar). — `CambiarContrasena.tsx:132`
- **FACTURA/PRESUPUESTO** comparten color gris mientras CHEQUE/EFECTIVO tienen color propio. ¿Les
  doy color, o el neutro es a propósito para que no compitan con la plata? — `Cobranzas.tsx:79-82`

## ⛔ No tocar (decisión intencional documentada)

- **"Olvidé mi contraseña" → llamá a la oficina.** El envío de correo ya está escrito pero apagado a
  propósito: prometer un correo que no llega es peor. Reactivarlo exige una pantalla nueva de deep
  link probada en los dos runtimes de OTA. Alto esfuerzo; sólo si el volumen de llamados lo justifica. — `IniciarSesion.tsx:71-93`
