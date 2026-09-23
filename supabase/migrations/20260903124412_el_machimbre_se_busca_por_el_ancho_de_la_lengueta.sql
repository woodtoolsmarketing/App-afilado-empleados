-- =============================================================================
-- El machimbre se busca por el ancho de la lengüeta
--
-- Los seis códigos del sub-rubro 094 se describen en pulgadas —"½ A 3/4",
-- "½ A 1'", "3/4 A 1¼'"— y eso es el ANCHO DE LA LENGÜETA, que es lo que la
-- fresa corta. En el renglón ese dato es `ancho_corte`, así que cargarles el
-- rango ahí los hace aparecer solos al medir la pieza, como pasa con las
-- sierras y con el resto de las fresas.
--
-- Las pulgadas, pasadas a milímetros:
--
--     ½"  = 12,70      1"   = 25,40
--     ¾"  = 19,05      1¼"  = 31,75
--
-- ── Los tramos se pisan, y está bien ────────────────────────────────────────
--
-- 9401 va de ½ a ¾ y 9403 de ½ a 1": una lengüeta de 15 mm cae en los dos. No
-- es un error de carga — el rango describe hasta dónde llega CADA FRESA, no
-- qué lengüeta tiene la pieza. Con 15 mm los dos juegos sirven, y cuál se usa
-- depende de cuál tiene el taller; por eso los precios son distintos
-- ($ 8.564,80 contra $ 9.372,80).
--
-- La pantalla ya sabe mostrar varios y que el vendedor elija: es exactamente
-- lo que hace una sierra de 3,2 mm, que ve el 8001 y el 8002. Forzar uno solo
-- acá sería elegir por él una fresa que capaz no tiene.
--
-- ── Las sierras ─────────────────────────────────────────────────────────────
--
-- Los seis quedaron marcados `herramienta_sugerida = 'fresa'` en la migración
-- anterior, así que `buscar_codigo_computo` no se los devuelve a una sierra
-- por más que el ancho caiga en el rango. Comprobado con 15 y 20 mm, que están
-- de lleno en el tramo del machimbre, en los tres servicios: ninguno. Y 3,2
-- sigue devolviendo 8001 y 8002.
--
-- Del lado de la fresa, 15 mm devuelve 9103 —la fresa recta de 10 a 19— más
-- 9401 y 9403. Las tres son ciertas: una fresa de 15 mm de ancho puede ser
-- recta o un juego de machimbre, y eso lo sabe el que la tiene en la mano.
-- =============================================================================

update public.catalogo_articulos
   set rango_min = 12.70, rango_max = 19.05, rango_dimension = 'ancho_corte'
 where codigo in ('9401', '9402');

update public.catalogo_articulos
   set rango_min = 12.70, rango_max = 25.40, rango_dimension = 'ancho_corte'
 where codigo in ('9403', '9404');

update public.catalogo_articulos
   set rango_min = 19.05, rango_max = 31.75, rango_dimension = 'ancho_corte'
 where codigo in ('9405', '9406');
