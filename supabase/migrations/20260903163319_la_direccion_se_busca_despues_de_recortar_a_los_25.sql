-- =============================================================================
-- Intento de optimización: buscar la dirección después de recortar
--
-- La idea era filtrar y cortar en 25 primero, y recién ahí buscar la dirección
-- de esos veinticinco, en vez de traerla para cada candidato. Para conservar
-- el orden se usó `row_number() over (order by …)`.
--
-- SALIÓ PEOR y se revierte en la migración siguiente. Queda escrita para que
-- nadie la vuelva a intentar por el mismo camino. El detalle está allá.
--
-- No se reproduce el cuerpo: la migración que sigue restaura la versión buena
-- y es la que vale. Esta existe sólo para que la numeración local coincida con
-- la del servidor.
-- =============================================================================

select 1;
