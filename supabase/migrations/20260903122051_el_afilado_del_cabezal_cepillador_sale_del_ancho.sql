-- =============================================================================
-- El afilado del cabezal cepillador sale del ancho, como en las sierras
--
-- Cargar el ancho de corte de un cabezal no devolvía ningún código: de los dos
-- de afilado que tiene la herramienta —9301 y 9303— ninguno traía rango. Las
-- sierras tienen 3 de 7 con rango y las fresas 10 de 12, y por eso ésas sí
-- andan.
--
-- Lo que decide el código NO es el ancho de corte sino `b`, el ancho del
-- diente, que la lista escribe con almohadilla: "AFILADO CB. #6mm" y "AFILADO
-- CB #12mm" (sub-rubro 093 de la lista del 02/06/2026).
--
-- Y `b` se deduce del ancho, que es lo que el vendedor sí puede medir. Lo
-- dicen dos fuentes que no se copiaron entre sí:
--
--   * El Catálogo General, en la ficha del cabezal cepillador: "b = 6 mm hasta
--     el de 130, 12 mm de ahí en más".
--   * Los códigos de producto, que llevan la `b` adentro:
--       CB0500640  = CB + 055 + 06 + 40      ancho 55,  b 6
--       CB0750660  = CB + 075 + 06 + 60      ancho 75,  b 6
--       CB13006100 = CB + 130 + 06 + 100     ancho 130, b 6
--       CB1601272  = CB + 160 + 12 + 72      ancho 160, b 12
--       CB1801280  = CB + 180 + 12 + 80      ancho 180, b 12
--       CB2001286  = CB + 200 + 12 + 86      ancho 200, b 12
--       CB22012100 = CB + 220 + 12 + 100     ancho 220, b 12
--
-- El corte queda en 130: hasta ahí b = 6, de 131 en adelante b = 12. No hay
-- ningún modelo entre 130 y 160, así que el punto exacto del corte no cambia
-- ninguna cotización real.
--
-- Sólo toca los cuatro códigos de cepillador, que ya están marcados
-- `herramienta_sugerida = 'cabezal'`: ninguna sierra ni ninguna fresa los ve,
-- ni antes ni después de esto.
-- =============================================================================

update public.catalogo_articulos
   set rango_min       = 0,
       rango_max       = 130,
       rango_dimension = 'ancho_corte'
 where codigo in ('9301', '9302');

update public.catalogo_articulos
   set rango_min       = 130.01,
       rango_max       = 999,
       rango_dimension = 'ancho_corte'
 where codigo in ('9303', '9304');
