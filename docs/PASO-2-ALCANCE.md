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

Va apretado a propósito: Cód. Cliente + Nombre en una fila, CUIT + Zona en otra,
y los siete tipos de servicio en dos columnas. El vendedor queda como una línea
de texto y no como un campo deshabilitado, porque no se edita nunca y ocupaba
media pantalla. En el paso 2, los numéricos cortos van de a dos por fila: una
medida son cinco caracteres y se comía el ancho entero.

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
- **Precio total = precio por diente × dientes × cantidad de herramientas**,
  recalculado solo. El factor de cantidad faltaba: los dientes son *por*
  herramienta, así que dos sierras de 96 son 192 dientes para afilar y la nota
  cobraba la mitad. El probador tenía además una copia de la cuenta que se
  quedó vieja cuando se arregló la de la app — ahora los dos llaman a
  `calcularTotalPorDientes` del paquete compartido, que es el punto de tenerlo.
- **Varias herramientas de la misma medida** van en un renglón. Medidas
  distintas, no: cada ancho da un código de cómputo y un precio distintos, así
  que el botón "no todas son de la misma medida" **parte el renglón en dos
  grupos**, cada uno con su cantidad. Meterlas en un solo renglón obligaría a
  inventar un precio promedio, y en el talonario de papel cada medida es una
  fila aparte igual.
- **"Agregar otras herramientas"** es una lista con casillas: agrega un renglón
  por cada una marcada.
- Las **medidas se escriben con coma** y el punto se toma como coma —el teclado
  de Android da uno u otro según el teléfono— y se muestran con su unidad:
  `3,2 mm`.
- Cada código de cómputo muestra **su rango** al lado (`de 3 mm a 4 mm`), que es
  lo que explica por qué ése y no otro, y hay un desplegable **"¿qué medidas
  hay?"** que lista los rangos cargados para esa herramienta. Antes, cuando una
  medida no caía en ninguno, la única salida era probar números.
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

## Zonas de venta

[`packages/compartido/src/zonas.ts`](../packages/compartido/src/zonas.ts) tiene
la planilla de zonas de la empresa: 31 entradas con su código, su nombre y sus
localidades. **La zona dejó de ser un campo de texto libre.** Era el dato que la
oficina usa para repartir el trabajo y llegaba escrito como "Oeste", "oeste" o
"Z. Oeste", que para cualquier planilla son tres zonas distintas.

Ahora es un selector, y **se completa solo con la ubicación del cliente**: al
elegirlo en la nota se busca su localidad en las listas y la zona sale sola, con
un renglón que dice por qué ("Asignada sola por Ramos Mejía"). La migración
`20260806165031_buscar_clientes_con_localidad` agrega localidad y provincia a lo
que devuelve `buscar_clientes`; sin eso no había con qué buscar.

Tres cosas que el dato obliga a manejar y no son obvias:

- **El código no es único.** El 121 está dos veces en la planilla (Cañada de
  Gómez y Santa Fe Capital). Cada zona tiene un `id` propio y lo que se guarda
  en la nota es el `codigo`, que es lo que la oficina lee. Cuando las dos
  candidatas comparten código no se pregunta nada: la respuesta es la misma.
- **Hay localidades repetidas entre zonas**, y no por error: "Las Heras" es
  Buenos Aires (116) y Mendoza (126); "Maipú", Buenos Aires (120) y Mendoza
  (126); "Victoria" en Entre Ríos aparece en la 136 y en la 143. La provincia
  desempata cuando se la conoce; cuando no alcanza, **se ofrecen las dos y elige
  el vendedor**. Poner un número que nadie miró en un comprobante es peor que
  preguntar.
- **Sólo las zonas que SON una provincia entera** (110 CABA, 146 Noroeste, 147
  Sur, 150 Litoral, 151 Chaco/Formosa) se reconocen por el nombre de la
  provincia. Sin esa distinción, la 121 "Santa Fe Capital" se llevaba puesto
  todo lo que estuviera en la provincia de Santa Fe —Rosario incluido— y la 148
  se quedaba con cualquier dirección de Neuquén.

Probado contra 19 casos: Ramos Mejía → 107, Quilmes → 102, Banfield → 104, City
Bell → 103, San Isidro → 101, CABA → 110, Las Heras/Mendoza → 126, Las
Heras/Buenos Aires → 116, Rosario/Santa Fe → 142, Rosario del Tala/Entre Ríos →
143, San Justo/Santa Fe → 149, San Justo/Buenos Aires → 107, Junín de los
Andes → 152. Y "Victoria" sin provincia queda ambigua, que es lo correcto.

> **Para revisar con la empresa.** Las cuatro zonas que la planilla marcaba
> "(Todos)" —101 Norte, 103 La Plata, 107 Oeste, 110 CABA— vinieron sin listado
> de localidades. Se armó uno con los partidos habituales de cada una para que
> la asignación automática funcione; están marcadas con `listadoEstimado` en el
> catálogo. Conviene que alguien de la casa las mire.

## Una nota de pedido por forma de facturar

El afilado se cobra en pesos y la venta se cotiza en dólares: **no pueden ir en
el mismo comprobante**. El vendedor carga todo junto, como lo trae el cliente, y
`agruparParaNotas` reparte en cuatro grupos posibles:

| Grupo | Qué cae ahí | Tipo de cambio |
|---|---|---|
| `servicio` | Afilado, reparación, rectificado, hermanado, rebaje, reclamo | **vacío** — se cobra en pesos |
| `venta_general` | Venta de sierras, cabezales, cuchillas, mechas y fresas importadas | sí |
| `venta_sierra_sin_fin` | Venta de sierras sin fin | sí |
| `venta_fresa_nacional` | Venta de fresas de producción nacional | **vacío** — se facturan en pesos |

La pantalla avisa **antes** de crear ("ESTO SALE EN 2 NOTAS DE PEDIDO", con el
total de cada una), y al terminar dice con qué número quedó cada una. Si falla
la segunda, se borran las que ya se habían creado: medio pedido cargado es peor
que ninguno.

Para poder repartir, la venta ahora pide **qué se vende** (antes no tenía
herramienta) y, si es una fresa, **si es nacional o importada**. Y el precio de
la venta pasó a ser **unitario**: antes se guardaba como total y tres unidades a
$100 se facturaban $100.

## Dientes rotos

Un diente roto no se afila. Al marcar "¿TIENE DIENTES ROTOS?" aparecen dos
campos: **cuántos** (sólo números enteros) y **"¿DESEA REPARAR LOS DIENTES?"**,
que arranca sin contestar a propósito — la respuesta cambia el precio, así que
un "no" silencioso sería cobrarle de menos al cliente sin que nadie lo haya
decidido.

- **No los repara** → los rotos se descuentan del total a afilar y no se cobran.
- **Sí los repara** → además se busca el código de cómputo de **reparación** por
  el mismo ancho de corte, y esa reparación se computa aparte, en su propio
  renglón de la nota.

```
2 sierras × 96 dientes = 192, con 5 rotos que se reparan
  8002   187 dientes × $    355,50  = $  66.478,50    (afilado)
  6001     5 dientes × $ 15.003,52  = $  75.017,60    (reparación)
```

La cuenta vive en `lineasDeComputo` del paquete compartido y la llaman los
cuatro lugares que la necesitan —formulario, vista previa, alta en la base e
impresión—: ya pasó una vez que una copia se quedara atrás y cotizara la mitad.

## Columnas de precio en el talonario

La tabla comercial pasó de `Precio` a **`Precio unitario` + `Precio total`**, con
los rótulos apilados en dos renglones para no comerse el ancho. El unitario es
lo que sale de la lista de precios (el precio por diente en el afilado) y el
total es la multiplicación. El código de cómputo cedió el espacio: bajó de 20% a
14%, que le sobraba.

Medido sobre el render: la hoja sigue en 190 × 258 mm y ninguna celda desborda,
ni con un total de ocho cifras ni con dos códigos separados por coma. El
duplicado no cambia —sigue siendo código y cantidad— y sigue llenando los
281 mm de la A4.

## Vista previa antes de imprimir

Botón "👁 Ver antes de imprimir" en las notas pendientes, en el detalle de la
nota y apenas se crea una.

En el **probador** se muestra la hoja de verdad dentro de un iframe: en una
pantalla de PC la A4 entra y se lee. En la **app** se muestran los mismos datos
apilados en el orden del talonario, porque una A4 encogida a un teléfono no se
lee; para ver la hoja tal cual está "Guardar como PDF", que genera el documento
real. Los dos salen de `notaImprimibleDesdeFila`, la misma función que arma el
HTML que se imprime: si ahí dice 187 dientes, eso es lo que sale en papel.

## El catálogo estaba mal importado

Se revisaron las 19 listas en PDF contra la base y aparecieron **tres errores de
extracción**, todos silenciosos. El extractor es
[`herramientas/extraer_listas.py`](../herramientas/extraer_listas.py) y quedó
corregido; la carga se regenera con `--sql`.

**1. El código perdía su variante.** `FI14M AA3` se cargaba como `FI14M` y el
`AA3` se iba a la descripción. Son artículos distintos con precios distintos:

```
TM06M AB3   U$S   924,00   CC D=125 B=78.5  d=40 Z=12
TM06M AD3   U$S 1.254,75   CC D=125 B=130   d=40 Z=21
TM06M AH3   U$S 1.645,77   CC D=125 B=183.5 d=40 Z=30
TM06M AL3   U$S 2.310,00   CC D=125 B=217.5 d=40 Z=36
TM06M CG3   U$S 1.686,30   CB D=120 B=166   d=40 Z=27
```

La base tenía **un solo `TM06M`**: cuatro de cada cinco cotizaciones de ese
cabezal salían con el precio de otra pieza. Son 200 artículos así. La forma de
la variante salió de los datos, no de una suposición: 3 a 5 caracteres
alfanuméricos con al menos un dígito, sin puntos y en mayúscula, que deja afuera
`S.C.`, `INS.` y las descripciones en minúscula.

**2. Se perdían las medidas.** En estas listas las medidas van en una fila
propia, debajo del artículo y **sin precio**, y el extractor descartaba toda
fila sin precio. Por eso cuchillas (0 de 143), sierras sin fin (0 de 138) y
mechas (8 de 181) no tenían una sola medida cargada.

**3. Tres expresiones regulares tenían un byte de control adentro.** `\b` había
quedado guardado como el carácter *backspace* (0x08) en vez de como límite de
palabra, así que `R_HASTA`, `R_MAYOR` y `R_DIAM` **nunca coincidían con nada**.
Consecuencias: los códigos cuyo rango se expresa como "HASTA 4.9" o "MAYOR A
d=150" quedaron sin rango y eran invisibles para el buscador, y `rango_dimension`
nunca podía valer `diametro`.

| | Antes | Ahora |
|---|---|---|
| Renglones | 1.315 | **1.883** |
| Códigos distintos | 1.315 | **1.498** |
| Con variante en el código | 0 | **471** |
| Con medidas | 151 | **913** |
| Con rango de medida | 36 | **83** |

### La clave de un artículo

Era `(codigo, lista_origen)`. No alcanza: la lista de herramientas de diamante
repite el mismo código para dos productos y lo único que los separa es la altura
del diente, que va en la medida.

```
SCCD150322   Ø=125-200 B=3.2-4.2 Z=24 H=4   U$S 1.164,00
SCCD150322   Ø=125-200 B=3.2-4.2 Z=24 H=5   U$S 1.450,00
```

Con la clave vieja uno de los dos se perdía. Son 14 casos, todos dentro de la
misma lista: ningún código aparece repetido entre listas distintas, así que
sumar la medida a la clave no arrastra ediciones viejas.

### Cabezales: la lista decía pesos y estaba en dólares

`LISTA PRECIO CABEZALES INSERTOS` declara "En Pesos" en su encabezado. Comparte
**172 códigos** con `CABEZALES FREUD 10-07-25`, que declara dólares, y la razón
entre los precios de los dos archivos va de **1,000 a 1,307** (mediana 1,27): es
la misma lista con un aumento del 27%. Si una estuviera en pesos, la razón
rondaría 1500.

Están las dos en dólares. Tomar la de Insertos como pesos cotizaba un cabezal de
US$ 227 a $237. La corrección vive en `MONEDA_CORREGIDA`, que **pisa al
encabezado** — por eso cada entrada de esa tabla lleva la evidencia escrita al
lado.

Esa lista tampoco trae fecha en el nombre. La fecha de modificación del PDF es
**2026-03-20**, el mismo día que `CUCHILLAS 200326`, `AFIL MECHAS 200326` y
`AFILADOS SC FRESAS INSERTOS 200326`: es una tanda que el Gestión exportó junta
y a ésta le faltó la fecha en el nombre. Con eso deja de ser un dato adivinado y
gana como edición vigente, que es lo correcto — es la más nueva.

Para las listas que **sí** quedan sin fecha establecida, la columna
`fecha_estimada` las marca y la vista las ordena último: una fecha deducida del
archivo no puede decidir qué precio se cotiza.

## Reparación de dientes: se cobra por diente

La pregunta era si `REP.PARCIAL DTE. S.C.` a $15.003,52 es por diente o por
trabajo. Lo resuelve la propia lista:

```
Rubro 006 · Reposicion Dientes de S.C.
  Sub-rubro 060 · Rep. Dientes y Rascadores
     6001  REP.PARCIAL DTE. S.C. #3 A 4mm     $ 15.003,52
  Sub-rubro 061 · Reparaciones Especiales
     6106  REP.TOTAL DE S.C. HASTA #4.9       $  5.971,40
```

`REP.TOTAL` sale **más barato** que `REP.PARCIAL`. Eso es imposible si los dos
fueran precios por trabajo —reparar la sierra entera no puede costar menos que
reparar una parte— y es lo normal si los dos son **por diente**: el precio por
unidad baja cuando se reponen todos. El rubro se llama "Reposición **Dientes**".

Así que el cálculo por diente que hace la app es el correcto, y ahora el vendedor
ve las dos opciones: `6001` para reponer algunos y `6106` para reponerlos todos
a la tarifa por volumen. `6106` era invisible hasta que se arregló `R_HASTA`.

## Mechas y cuchillas no se cotizan por medida

Medido sobre el catálogo: **mecha 0 de 181** y **cuchilla 0 de 143** códigos con
rango. No es que falten datos —es que el precio no depende de una medida. El
afilado de mechas va por tipo y cantidad de filos (`Afilado Mecha Integral MD
Z=2`, `AFIL. MECHA CIEGA M.D.`, `AFIL.MECHA P/BISAGRA M.D.`) y la lista de
cuchillas es un catálogo de producto, no de servicio.

El formulario pedía un diámetro y prometía un código que nunca podía llegar.
Ahora, cuando la familia no tiene ningún código con rango, la lista de "¿Qué
códigos hay?" muestra los que sí existen con su precio y **se elige uno tocándolo**;
el aviso explica por qué no hay búsqueda por medida en vez de mandar a probar
números.

## Cosas que ahora se completan solas

**La descripción del renglón.** Sale de la herramienta y del servicio, y se
escribe siempre igual —que es lo que la fábrica lee para saber qué le llegó:

| | Servicio | Venta |
|---|---|---|
| Sierra | `S.C.` | `S.C. nueva` |
| Fresa | `Fresa` | `Fresa nueva` |
| Mecha | `Mecha` | `Mecha nueva` |
| Cuchilla | `Cuchilla` | `Cuchilla nueva` |
| Cabezal | `Cabezal` | `Cabezal nuevo` |
| Sierra sin fin | `SSF` | `SSF nueva` |

Sólo se pisa lo que puso la app: si el vendedor escribió algo suyo, queda. Antes
se tipeaba a mano en cada renglón y la misma cosa entraba como "sierra",
"Sierra", "s.c." y "SC".

**El diámetro interior.** En una **venta** se completa solo con el del artículo
elegido y no se pregunta nada: la herramienta sale nueva, con el agujero que
trae de fábrica, y no hay ninguna pieza contra la cual compararlo.

El campo para cargarlo a mano es de los renglones de **servicio**, que es donde
el cliente puede traer una herramienta con el agujero tocado. Es opcional —la
lista ya trae el de fábrica— y se completa sólo cuando difiere, que es
justamente el dato que le cambia el trabajo al taller:

- más grande → **agujero agrandado**
- más chico → **buje reductor**

El aviso va a la **descripción general de la herramienta**, no a la tabla de
cómputo: es información del taller, no un precio. `S.C. con agujero agrandado:
35 mm (de fábrica 30 mm)`. Si se deja vacío, la nota sale con la medida de
fábrica; si se escribe la misma que la de fábrica, también queda escrita.

**De dónde sale el agujero de fábrica.** En una venta, del artículo elegido. En
un renglón de afilado no hay artículo, pero la pieza está en la lista igual:
**122 de las 130 sierras** traen `D=` y `d=` en su descripción, así que se la
reconoce por sus medidas y de ahí se saca el agujero.

Ante la duda no se elige. Con Ø300 hay veinte sierras en la lista y **no todas
comparten agujero**: casi todas son `d=30`, la `LT16MD CD3` es `d=130` y la
`LU5E 0600` es `d=25.4`. Si las mejores candidatas no coinciden en el agujero se
devuelve nada, porque un "de fábrica" equivocado inventaría un buje reductor que
nadie pidió. Con el ancho de corte y los dientes cargados el desempate es
inmediato.

Cabezales reconoce 27 de 232 y el resto de las familias ninguno: mechas,
cuchillas y sierras sin fin no traen diámetros en la lista. Ahí el campo sigue
funcionando, se escribe lo que se cargue, y no se dice ni agrandado ni buje
reductor porque no hay contra qué comparar.

**El número de vendedor** se guarda en la nota al emitirla, en vez de leerse del
perfil al imprimir. Un comprobante emitido no puede cambiar porque después se
edite el perfil. Se imprime sin los ceros de relleno del Gestión: `007` sale 7,
`010` sale 10, `100` queda 100.

> **Pendiente.** Valentín y Carlos conservan el cero de adelante. La lista
> `VENDEDORES_CON_CERO` está vacía hasta saber cuáles son sus códigos exactos;
> mientras tanto todos se imprimen sin relleno.

**Las notas hermanas se nombran entre sí.** Cuando una misma carga produce
varias notas —afilado y venta no van en el mismo comprobante— cada una lleva en
Observaciones `Va con nota de pedido 000011, 000012`. Se escribe después de
crearlas todas, porque el número lo asigna la base al insertar. Sin eso, las
tres notas de un mismo cliente llegan a fábrica sin ninguna referencia entre sí.

---

## Para que esto corra

```bash
npx supabase db push
```

Las migraciones del catálogo y de storage ya están aplicadas. Quedan por
aplicar, si se levanta el proyecto de cero, las tres últimas:

| Migración | Qué hace |
|---|---|
| `20260806135141_catalogo_clasificar_servicio_y_herramienta` | Clasifica los artículos por servicio y herramienta. Sin esto, a una sierra para afilar le salían códigos de reparación |
| `20260806135159_buscar_codigo_computo_por_servicio` | El buscador filtra por servicio y herramienta |
| `20260806165031_buscar_clientes_con_localidad` | `buscar_clientes` devuelve localidad y provincia, para asignar la zona sola |
| `20260806173054_notas_pedido_observaciones` | La columna "Observaciones" del talonario |
| `20260806190000_catalogo_datos_corregido` | El catálogo entero, regenerado por el extractor corregido |
| `20260807134646_notas_pedido_condicion_venta` | La condición de venta, como opción cerrada |
| `20260807170111_notas_pedido_vendedor_numero` | El número de vendedor queda congelado en la nota |

> **`db push` no funciona en la máquina de la oficina.** El CLI nunca se linkeó
> al proyecto (no existe `supabase/.temp/`) y falla con
> `LegacyDbConfigIpv6Error`. Todo lo aplicado hasta hoy entró por el MCP de
> Supabase o por PostgREST. Antes de dar una migración por aplicada, verificar
> contra `supabase_migrations.schema_migrations`.
>
> Para dejarlo andando: `npx supabase login`, después
> `npx supabase link --project-ref wafszjoebefmbuufmula` (pide la contraseña de
> la base) y recién ahí `npx supabase db push`.

Los nombres de archivo de las migraciones ya aplicadas se reconciliaron con las
versiones que tiene el servidor. Sin eso, `db push` volvía a correr migraciones
ya aplicadas y fallaba en el primer `create policy`.
