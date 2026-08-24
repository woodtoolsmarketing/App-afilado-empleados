-- =============================================================================
-- El descuento del renglón deja de ser un texto y pasa a ser plata
--
-- ── Lo que había ────────────────────────────────────────────────────────────
--
-- `notas_pedido_items.promocion` es un booleano, y al lado, adentro de
-- `detalle`, un texto libre: "llevando 3", "por cantidad". Ninguno de los dos
-- tocaba jamás un precio. Ni siquiera llegaban al papel: la promoción se
-- guardaba, se mostraba como pastilla en el detalle de la app, y la nota que
-- firmaba el cliente no la mencionaba en ninguna parte.
--
-- ── Lo que hay ahora ────────────────────────────────────────────────────────
--
-- Un porcentaje que se elige de una lista cerrada (de 5 en 5, hasta 65) y que
-- se descuenta de verdad. `promocion` queda como el interruptor —hay descuento
-- o no— y esta columna dice cuánto.
--
-- Va como columna y no adentro de `detalle` justamente porque es plata: la
-- oficina tiene que poder preguntar cuánto se descontó este mes sin abrir un
-- jsonb renglón por renglón.
--
-- ── Por qué se puede agregar sola ───────────────────────────────────────────
--
-- `crear_notas_pedido` y `actualizar_nota_pedido` arman el renglón con
-- `jsonb_populate_record(null::public.notas_pedido_items, ...)` y lo insertan
-- entero con `select (renglon).*`. Una columna nueva la toman sin tocarles una
-- línea. Pero eso mismo obliga a que sea NULLABLE: `jsonb_populate_record`
-- sobre un registro nulo deja en null lo que el JSON no traiga, y los defaults
-- de la tabla no llegan a aplicarse. Con `not null default 0` la primera nota
-- sin descuento explotaría.
--
-- NULL y 0 quieren decir lo mismo acá —sin descuento— y el cliente manda NULL,
-- que es lo que las notas viejas ya tienen.
--
-- ── El rango ────────────────────────────────────────────────────────────────
--
-- El CHECK va hasta 100 y no hasta 65. El 65 es una decisión comercial y vive
-- en el desplegable; si mañana autorizan un 70 no tiene por qué hacer falta una
-- migración. Lo que la base tiene que impedir es lo que no puede ser
-- descuento en ningún escenario: un negativo, que subiría el precio, y un
-- número mayor que 100, que lo daría vuelta.
-- =============================================================================

alter table public.notas_pedido_items
  add column if not exists descuento_porcentaje numeric(5, 2);

alter table public.notas_pedido_items
  drop constraint if exists notas_pedido_items_descuento_rango;

alter table public.notas_pedido_items
  add constraint notas_pedido_items_descuento_rango
  check (descuento_porcentaje is null or (descuento_porcentaje >= 0 and descuento_porcentaje <= 100));

-- ── Dónde queda cada número ─────────────────────────────────────────────────
--
-- `precio_unitario` y `precio_total` viven los dos en precio de LISTA. El
-- descuento NO se les aplica, y no es un descuido: `precio_total` vuelve a
-- entrar como dato cuando se reimprime una nota de mecha, cuchilla o sierra sin
-- fin —son las que no se cobran por diente y sacan el importe de ahí—, así que
-- guardarlo ya descontado haría que la reimpresión descontara una segunda vez y
-- el papel nuevo no coincidiera con el que firmó el cliente.
--
-- Lo que se cobra de verdad está en `notas_pedido.total`, que es la suma de los
-- renglones ya descontados. Y en la hoja se imprimen los tres: precio de lista,
-- porcentaje, y total abajo. Con eso la cuenta se puede rehacer a mano.

comment on column public.notas_pedido_items.descuento_porcentaje is
  'Cuanto se le descuenta al renglon, en por ciento. NULL = sin descuento. '
  'precio_unitario y precio_total quedan en precio de LISTA: lo que se cobra '
  'sale de aplicarles este porcentaje, y el total ya descontado de la nota '
  'esta en notas_pedido.total.';
