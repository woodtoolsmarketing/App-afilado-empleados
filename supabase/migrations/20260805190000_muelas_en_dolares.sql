-- =============================================================================
-- WoodTools · Paso 2
-- MUELAS: la lista no declara la moneda, y son dólares
--
-- `LISTA PRECIO MUELAS 300425` es la única de las 19 cuyo encabezado no dice
-- "Precios sin I.V.A. En Pesos/Dólares", así que el extractor la dejó en NULL
-- —nunca inventa una moneda— y los 4 artículos quedaron fuera de la app,
-- esperando que Administración los completara.
--
-- El cliente confirmó que van en dólares. Los valores lo respaldan: 204 a 356
-- para una muela de diamante son dólares; en pesos serían el precio de un café.
--
-- Esto no es salida del extractor sino una decisión de negocio encima de un
-- dato que el PDF no trae, por eso va en su propia migración y no editando
-- `catalogo_datos.sql`. El extractor lleva la misma decisión para que una
-- reextracción no la pise (ver herramientas/extraer_listas.py).
-- =============================================================================

update public.catalogo_articulos
   set moneda = 'USD'
 where familia = 'muela'
   and moneda is null;

-- `precio_a_confirmar` es una columna generada `(precio = 0 or moneda is null)`:
-- al quedar la moneda declarada, los 4 salen solos del grupo "a confirmar" y
-- pasan a cotizarse con `precio × tipo de cambio`.
