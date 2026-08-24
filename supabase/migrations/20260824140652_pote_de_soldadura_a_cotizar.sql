-- El pote de soldadura pasa a "a cotizar" hasta que Administración confirme en
-- qué moneda está su precio.
--
-- SOL030 «SOLD.P/SSF POTE 30gr.DOLARES» entró con precio 2310 y moneda ARS
-- desde LISTA PRECIO AFIL SSF 020626. Esa lista tiene nueve filas: ocho son
-- servicios —afilado, laminado y soldadura de sierra sin fin, todas con rango
-- de ancho_corte— y ésta es la única que es un producto, y la única sin rango.
-- Es además el único artículo de los 1.513 vigentes cuya descripción nombra una
-- moneda. Todas las listas del catálogo son de una sola moneda, así que no
-- había manera de marcar una fila en dólares adentro de una lista en pesos:
-- escribirlo en la descripción es el único recurso que quedaba.
--
-- El número no cierra en ninguna de las dos lecturas. 2.310 pesos son menos de
-- dos dólares por treinta gramos de aleación de plata, y dejan el consumible a
-- un sexto del servicio de soldar de su propia lista (13.200). 2.310 dólares
-- son setenta y siete dólares el gramo. Mientras no haya respuesta, el precio
-- que la app no puede saber lo pone el vendedor.
--
-- No se toca `precio_a_confirmar`: es una columna GENERADA como
-- `precio = 0 or moneda is null`, así que poner el precio en cero ES marcarlo
-- a cotizar. Intentar asignarla da 428C9. Por eso los 108 artículos que ya
-- estaban a cotizar tienen todos precio cero: no es una convención que alguien
-- siguió, es la definición de la columna.
--
-- La moneda queda en ARS a propósito. El renglón hereda la del artículo, así
-- que el importe que tipee el vendedor se toma como pesos —que es lo que él va
-- a cobrar—. Pasarla a USD sería dar por contestada justamente la pregunta que
-- está abierta.
--
-- El "DOLARES" de la descripción se saca, y no por prolijidad: con el precio
-- vacío el vendedor tipea el importe, y esa palabra al lado de un campo en
-- blanco lo invita a tipear dólares que entrarían como pesos. La duda queda
-- documentada acá, que es donde sirve; en la descripción sólo hacía daño.
--
-- Nunca se vendió: cero notas de pedido lo incluyen, así que no hay ningún
-- comprobante emitido que corregir.

update public.catalogo_articulos
set precio = 0,
    descripcion = 'SOLD.P/SSF POTE 30gr.'
where codigo = 'SOL030'
  and lista_origen = 'LISTA PRECIO AFIL SSF 020626';
