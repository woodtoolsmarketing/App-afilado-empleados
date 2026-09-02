-- =============================================================================
-- `servicio_sugerido` vuelve a NULL en los quince codigos de la lista de mechas.
--
-- La migracion anterior (20260902133154) los marco con 'afilado' pensando que
-- eso decia "esto es un trabajo, no un articulo". No es lo que esa columna
-- quiere decir, y ya habia pasado antes: la migracion 20260826124835
-- —"un trabajo no es un articulo que se venda"— existe justamente para deshacer
-- ese mismo error sobre las sierras sin fin, y deja escrito por que.
--
-- Un NULL ahi no significa "no es un servicio": significa "sirve para cualquier
-- trabajo". Escribir 'afilado' saca el codigo de todos los demas, porque el
-- filtro de la app es `servicio_sugerido is null or servicio_sugerido = <el del
-- renglon>`.
--
-- El efecto medido: un RECLAMO sobre una mecha se quedaba con CERO codigos.
-- Nueve codigos de afilado cargados y el vendedor sin ninguno a la vista.
--
-- Lo que si hace falta —y alcanza— es `herramienta_sugerida`, que contesta otra
-- pregunta: de que herramienta es este codigo. Esa se queda:
--
--   · 'mecha' en los nueve de afilado de mecha, que los sube al principio de la
--     lista de escape del vendedor.
--   · 'cuchilla' en los seis CHC*, que es lo que los saca de la lista de una
--     mecha. Venian en la misma lista de precios —el rubro se llama
--     "Afil.Mechas Insertos Cuchillas"— y por eso quedaron con familia 'mecha'.
--     La familia no se toca: `codigos_afilado_cuchilla` los busca por codigo, y
--     moverlos de familia deja esa RPC sin filas.
-- =============================================================================

update public.catalogo_articulos set
  servicio_sugerido = null
where codigo in ('MEHSS010AF','MEHSSAF','MEMD005AF','MEMD010AF','MEMDBIAF','MEMDMAAF',
                 '10101','10102','10103',
                 'CHC100HSSAF','CHC100MDAF','CHCRAFHSS','CHCRAFMD','CHCRPERHSS','CHCRPERMD')
  and servicio_sugerido is not null;
