# Paso 2 — Notas de pedido

Estado al 5/8/2026.

---

## Listo y verificado

### Catálogo de precios

Las 19 listas del Gestión Comercial importadas con **cobertura 100%**: 1.887
artículos, **1.315 códigos vigentes**. La cobertura se mide contra la cantidad
de precios que hay en cada PDF, que es el único número que dice cuántos
artículos debería haber.

El extractor está versionado en
[`herramientas/extraer_listas.py`](../herramientas/extraer_listas.py). Cuando
cambien las listas, se vuelve a correr.

**Tres trampas del formato que hubo que resolver:**

1. En varios PDF el texto sale **por columnas** — todos los códigos juntos,
   después todas las descripciones, después todos los precios. Un parser lineal
   apareaba el precio con el producto equivocado, en silencio. Se reconstruyen
   las filas por coordenada.
2. Algunos precios caen en una banda vertical apenas distinta de su código.
3. En MUELAS el código viene pegado a la descripción: `MB225158300Muela de
   Borazon`.

**Y una que no era del formato sino del negocio: 10 de las 19 listas están en
DÓLARES.** Si se cargaban todas como pesos, una cuchilla de USD 11,63 se
cotizaba como $11,63. La moneda sale del encabezado de cada lista, nunca de un
default: 547 códigos en ARS, 764 en USD.

**MUELAS es la única lista que no declara la moneda.** El cliente confirmó que
va en dólares, y los valores lo respaldan: 204 a 356 por una muela de diamante
son dólares; en pesos serían el precio de un café. Los 4 artículos salieron del
grupo "a confirmar" y ya se cotizan.

La decisión está en dos lugares a propósito:
`herramientas/extraer_listas.py` la lleva en `MONEDA_CONFIRMADA` para que una
reextracción no la pise, y
[`20260805190000_muelas_en_dolares.sql`](../supabase/migrations/20260805190000_muelas_en_dolares.sql)
la aplica sobre los datos ya cargados. **El encabezado del PDF siempre manda**:
la tabla del extractor sólo se consulta cuando la lista no dice nada, así que si
alguna vez MUELAS declara su moneda, gana el PDF.

### Precios y códigos de cómputo

| Regla | Cómo quedó |
|---|---|
| Dólares | `precio × tipo de cambio` con la cotización **del día de la nota**, no la de hoy |
| Sin precio | Los 110 quedan fuera del buscador del vendedor y marcados para que Administración los complete |
| Código por medida | `#3 A 4mm` = rango de ancho de corte; devuelve el rango más ajustado primero |

La Edge Function `cotizacion-dolar` trae el oficial de dolarapi, lo cachea por
día, y para fechas pasadas usa la guardada en vez de pedir la de hoy y
archivarla con la fecha equivocada.

**Un falso positivo que hubiera dado códigos mal:** `FR. 1/4 CIRCULO 1/2 A 3/4`
se leía como "2 a 3 mm", cuando `1/2 A 3/4` son **pulgadas** (el radio de una
fresa). Los rangos ahora sólo se interpretan en las listas de servicio. También
se distingue `d=150` como diámetro: confundirlo con el ancho de corte elegiría
otra herramienta.

Probado contra la base: 40 mm → `SFUSOL`, 55 → `SFUSOL050`, 90 → `SFUSOL080`,
150 → `SFUSOL120`. Cuchilla de USD 13,08 → **$19.881,60**.

### El talonario impreso

[`packages/compartido/src/nota-pedido-impresion.ts`](../packages/compartido/src/nota-pedido-impresion.ts)
reproduce el formulario de Formas Continuas, en el paquete compartido porque lo
usan la app y el panel.

Cuatro variantes, y la diferencia no es cosmética:

- **ORIGINAL con logo** → tipo FACTURA
- **ORIGINAL sin logo** → tipo PRESUPUESTO
- **DUPLICADO** → **sin precios**, sólo código de cómputo y cantidad, más los
  recuadros de Depósito Nº / Nº Movimiento / Fecha / Hora. El taller no tiene
  por qué ver lo que se le cobró al cliente.

El ORIGINAL mantiene las 11 filas en blanco de cada tabla, porque en fábrica las
completan a mano. **El duplicado va más apretado**: 7 filas en vez de 11 y todo
lo que no es espacio para escribir, achicado. Como no lleva precios ni
condiciones, el aire del original ahí es papel desperdiciado. Medido sobre el
render: **256 mm → 230 mm de alto**, mismo ancho de 190 mm.

### Impresión inalámbrica

[`apps/movil/src/servicios/impresion.ts`](../apps/movil/src/servicios/impresion.ts).
Dos caminos, en orden:

1. **Directo por IPP** a la IP de la oficina (puerto 631). El vendedor toca
   imprimir y las notas salen, sin diálogos. Se eligió IPP sobre RAW/JetDirect
   porque devuelve confirmación del trabajo: con RAW, si se acabó el papel
   nunca nos enteramos.
2. **Diálogo del sistema** si lo anterior falla. Android descubre impresoras de
   red igual, así que sigue siendo inalámbrico.

La IP se carga en `configuracion.impresora_oficina`. **Para las pruebas quedó
`192.168.1.167:631/ipp/print`.** Es un dato de configuración, no de esquema: la
app y el probador lo leen de esa fila cada vez, así que cambiarlo no requiere
recompilar nada. La política `configuracion_leer` deja leerlo a cualquier
usuario habilitado, y sólo un admin puede modificarlo.

### Impresión conjunta con el rol de visita

Desde "Ver notas pendientes" se puede tildar **"SUMAR EL ROL DE VISITA DE HOY"**
y sale todo en **un solo trabajo de impresión**: la planilla del día adelante y
las notas atrás. El vendedor toca una vez y se lleva la jornada entera, en vez
de imprimir la planilla en la oficina y las notas por separado.

La planilla vivía sólo en el panel de escritorio, dibujada sobre su propio DOM.
Se llevó a
[`packages/compartido/src/rol-de-visita-impresion.ts`](../packages/compartido/src/rol-de-visita-impresion.ts)
para que la app también pueda generarla.

**Va en A4 vertical, no apaisada como en el escritorio.** Comparte documento con
las notas, y una sola orientación por PDF es lo único que el motor de impresión
de Android respeta de verdad: mezclar orientaciones en un mismo trabajo termina
en hojas rotadas al azar. Las once columnas entran igual — la tabla técnica del
talonario ya tiene doce en el mismo ancho.

Dos decisiones del contenido:

- Cuando el destino **no** se visitó, el motivo va al principio del resultado.
  Un renglón sin ningún tilde de "tipo de visita" y sin explicación no se
  distingue de uno que quedó sin hacer.
- Mantiene **18 renglones en blanco**, por lo mismo que el talonario: el
  vendedor anota a mano el destino que aparece en el día.

Que el rol no salga **no frena la impresión de las notas**. Si el vendedor no
armó recorrido hoy, o falla la consulta, las notas salen igual y el aviso lo
cuenta después. Está parado frente a la impresora: cancelarle el trabajo entero
por el agregado sería lo peor que podríamos hacer.

### Pantallas de la app

- Menú de notas de pedido con el contador de pendientes
- Ver notas pendientes, con selección múltiple, impresión y **exportar a PDF**
  (esa opción existe sólo acá, como se pidió)
- Historial por día, con el mismo acordeón que el historial de visitas

### Historial de notas de pedido

Ajustado contra el mockup del cliente. El día es **texto suelto sobre el panel**,
sin caja ni recuadro, con el triángulo pegado al nombre. El renglón dice sólo
`- NOTA DE PEDIDO Nº 000123`. El rótulo **PERIODO va centrado**, y el **primer
día arranca abierto**: entrar y ver una pila de títulos sin un solo dato no le
dice nada al vendedor, y con uno desplegado queda claro que los otros se abren.

Lo de arrancar abierto se resuelve con `abiertos[fecha] ?? indice === 0` en vez
de precargar el estado: los días llegan después de montar la pantalla y cambian
al cambiar el período, así que lo que se recuerda es lo que el vendedor tocó y
no lo que había cuando entró.

Se había construido mostrando además tipo, cliente, hora e importe, y era peor:
son siete renglones por día y el dato que el vendedor busca —el número— quedaba
compitiendo con otros cuatro. Todo eso sigue a un toque, en el detalle.

El mismo acordeón —día suelto, PERIODO centrado, primer día abierto— se llevó al
**historial de visitas**, para que las dos pantallas se vean igual. Ahí se
conserva el contador `3/8`: dice cuántas de las planificadas se cumplieron, y eso
el historial de notas no lo tiene.

El centrado del rótulo es una prop nueva (`etiquetaCentrada`) del `Desplegable`,
no un cambio global: ese componente lo usan otras ocho veces, donde el selector
sí es un campo más de un formulario y va alineado a la izquierda.

**El triángulo del desplegable salió de la caja blanca**, como en el mockup, sin
perder el toque. El `Pressable` pasó a ser la fila entera —caja + triángulo— y el
recuadro es ahora un `View` adentro. Sacarlo como hermano del `Pressable` habría
sido más simple y estaba mal: el triángulo es el gesto más obvio para abrir un
desplegable, y dejarlo sin área táctil es peor que el desvío visual que se
corrige. El borde rojo del error se quedó en la caja, que es lo que se mira.

Dos cosas que salieron de la auditoría de esta pantalla:

- **Los días salían del más nuevo al más viejo.** El mockup los pide en orden de
  calendario, y las notas dentro de cada día van en la misma dirección, así los
  números quedan ascendentes como en el talonario de papel.
- **El día se calculaba en UTC.** El servidor está en UTC y Argentina es UTC-3,
  así que una nota cargada a las 21:30 caía en el día **siguiente**: el vendedor
  la buscaba donde la hizo y no estaba. Ahora el día se calcula en hora de
  Buenos Aires. El historial de visitas no tenía este problema porque agrupa por
  `roles_visita.fecha`, que ya es un `date` de la jornada.

Y un error de fecha que no venía del mockup: `rangoDelPeriodo('mes')` hacía
`setMonth(mes - 1)`, que **desborda los días 29 a 31**. Un 31 de marzo pedía "31
de febrero" y JavaScript lo normalizaba al 3 de marzo, así que "MES ANTERIOR"
devolvía dos días de historial. Ahora resta 30 días, como los otros períodos.

### Base de datos

- `notas_pedido` + `notas_pedido_items` (medidas propias de cada herramienta en
  `detalle` jsonb, para no tener cuarenta columnas casi siempre vacías)
- Rol **Dpto. de Administración**
- `asignar_cliente_a_nota`: el momento en que la nota deja de estar pendiente y
  recibe su número. Se niega a usar un cliente provisorio, que dejaría un
  código inventado (`P-000123`) en un comprobante.
- Buscador de clientes por **código, nombre o CUIT** (con o sin guiones)

**La nota sin cliente:** nace en `pendiente_cliente`, sin número, y la app la
muestra opaca con "(Pendiente)". Un CHECK garantiza que no pueda tener número
en ese estado. El trabajo queda registrado igual — que el alta del cliente esté
demorada no puede costarle la venta al vendedor.

---

### Generar nueva nota de pedido

[`apps/movil/src/pantallas/GenerarNota/`](../apps/movil/src/pantallas/GenerarNota).
En dos pasos, porque el formulario completo no entra de una en un teléfono y
porque el segundo depende de lo que se elija en el primero.

**Paso 1 — cliente y servicio.** Cód. Cliente, Nombre y CUIT buscan sobre lo
mismo y al elegir un cliente se completan los tres, más los datos de contacto.
Lo que el vendedor ya escribió a mano nunca se pisa.

"REBAJE" aparece recién cuando se tilda AFILADO, como en los mockups; si se
destilda afilado, se va con él.

**Paso 2 — los renglones.** Qué campos se dibujan lo decide
`CAMPOS_POR_HERRAMIENTA`, la **misma tabla que usa el validador**. Así no puede
pasar que la pantalla muestre un campo que el validador ignora, ni que exija uno
que nunca se mostró.

Automatismos:

- El **código de cómputo** se busca solo apenas hay medida, y se propone el
  rango más ajustado. Si hay varios, se pueden elegir varios. El bloque de
  códigos se dibuja **inmediatamente debajo de la medida que lo determina** —el
  ancho de corte en sierras, el diámetro en mechas—, no junto a los precios como
  en el mockup: el ancho es lo único que decide el código, así que la respuesta
  tiene que aparecer donde se hace la pregunta. `CAMPOS_POR_HERRAMIENTA` y
  `MEDIDA_PARA_CODIGO` tienen que seguir coincidiendo.
- El **precio** viene del catálogo, ya convertido a pesos cuando la lista está
  en dólares, y avisa cuando lo hizo.
- **Precio total = precio por diente × cantidad de dientes**, recalculado solo.
- El **tipo de cambio** se trae al abrir y queda congelado en la nota. No es un
  dato que el vendedor tenga que averiguar.
- Los campos de precio sólo aceptan números y muestran el valor formateado.
- Los Si/No arrancan en **no**.
- La **mano** de la mecha sólo se pregunta en pasante, ciega y bisagra:
  preguntarlo en una barreno no significa nada.

**Varios renglones en una nota.** Como el talonario de papel: una nota puede
llevar tres mechas, una sierra y una cuchilla. Se edita **uno por vez** —el
resto queda arriba como tarjetas— porque en un teléfono no entran dos
formularios abiertos y porque así el vendedor siempre sabe cuál está tocando.

- **"SUMAR OTRA MECHA"** repite el sub-formulario conservando servicio y
  herramienta; **"AGREGAR OTRA HERRAMIENTA"** lo deja elegir de nuevo.
- No se copia nada más de la mecha anterior. Repetirle el diámetro sería
  adivinar, y un valor heredado sin querer es más difícil de ver que uno vacío.
- Antes de abrir uno nuevo se valida el que está abierto: apilar renglones a
  medio cargar termina en una nota que no se puede crear y en un vendedor
  buscando cuál de los seis le falta.
- Las tarjetas de los renglones incompletos se marcan, y "CREAR NOTA" salta
  directo al primero que falla.
- Si arriba tildaron **más de un servicio**, cada renglón elige el suyo: una
  misma nota puede tener un afilado y una reparación, que es lo que pasa en la
  realidad. Destildar un servicio arriba no deja renglones huérfanos: pasan al
  primero que siga tildado.

**Un detalle que hubiera pisado precios:** el buscador de códigos propone el más
ajustado apenas hay medida. Al volver a un renglón ya cargado volvía a
proponerlo, **pisando la elección manual del vendedor**. Ahora sólo se pisa lo
que propusimos nosotros; si la medida cambió y el código elegido ya no la cubre,
se avisa en vez de cambiarlo solo.

El micrófono quedó encapsulado en
[`CampoDictado`](../apps/movil/src/componentes/CampoDictado.tsx), que se usa en
los dos textos del encabezado. Lo dictado se **suma** a lo escrito en vez de
pisarlo: el vendedor arranca tipeando y termina hablando, o al revés.

### Artículos a confirmar (panel)

Los 110 que la app no cotiza, separados por motivo, para que Administración les
cargue precio y moneda. Salen del grupo al instante.

---

### Detalle de la nota (app)

[`DetalleNota.tsx`](../apps/movil/src/pantallas/DetalleNota.tsx). Se llega desde
las pendientes y desde el historial, y se adapta: una nota ya impresa ofrece
"volver a imprimir" en vez de "imprimir". Muestra cliente, los dos textos
dictados (con el ícono de micrófono si se dictaron), cada renglón con sus
medidas y códigos de cómputo, y el total.

### Notas de pedido (panel de escritorio)

[`NotasPedido.tsx`](../apps/escritorio/src/paginas/NotasPedido.tsx). El filtro
arranca en **"Sin código de cliente"**, porque ése es el trabajo real de la
pantalla: cada una de esas notas es una venta hecha que todavía no se puede
facturar. El globo de la barra lateral las cuenta.

El botón **"Dar Cod. Cliente"** abre un buscador precargado con lo que escribió
el vendedor (CUIT o nombre), que casi siempre alcanza. Los clientes provisorios
aparecen pero **no se pueden elegir**: asignar uno dejaría un código automático
(`P-000123`) en un comprobante. Primero hay que completarle la ficha.

Al asignar, la nota recibe su número y el vendedor la ve actualizada.

---

### Generar nuevo cliente

[`NuevoCliente.tsx`](../apps/movil/src/pantallas/NuevoCliente.tsx). Se llega
desde "¿Es nuevo cliente?" con lo que el vendedor ya escribió, para no hacerlo
tipear de nuevo.

Junta todo lo que Administración necesita para el alta —nombre o razón social,
DNI o CUIT, dirección del taller con autocompletado de Google (que llena el CP),
varios teléfonos con el botón ⊕, correo y nombre de fantasía— así no tienen que
llamar al vendedor para pedirle un dato.

El cliente nace **provisorio**: existe y es buscable, pero con código
automático. Al volver, el encabezado de la nota se completa solo.

**El punto fino:** una nota con cliente provisorio **igual queda sin número**.
Un `P-000123` no es un código de cliente, y ponerlo en un comprobante sería peor
que dejarlo en blanco. La condición pasó de "¿tiene cliente?" a "¿tiene cliente
con código real?".

Validaciones propias: el documento acepta 7-8 dígitos (DNI) u 11 (CUIT) y lo
dice cuando no coincide, que es el error más común al tipearlo.

---

## Para que esto corra

Cuatro migraciones quedan **pendientes de aplicar** en el proyecto, en este orden:

```bash
npx supabase db push
```

| Migración | Qué hace |
|---|---|
| `20260805185000_storage.sql` | Los dos buckets. Ya existen en el servidor pero no estaban registrados; la migración es idempotente |
| `20260805185500_catalogo_datos.sql` | Los 1.315 códigos. **La tabla está vacía**: hasta que esto corra, la app no cotiza nada |
| `20260805190000_muelas_en_dolares.sql` | MUELAS en USD |
| `20260805200000_historial_notas_orden_y_huso.sql` | Historial en orden de calendario y agrupado por día de Buenos Aires |

Los nombres de archivo de las migraciones ya aplicadas se reconciliaron con las
versiones que tiene el servidor. Sin eso, `db push` volvía a correr cuatro
migraciones ya aplicadas y fallaba en el primer `create policy`.
