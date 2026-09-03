-- =============================================================================
-- Los tres cepilladores sin `Z=` quedan confirmados a mano
--
-- De los siete cabezales cepilladores, cuatro traen el `Z=` escrito en la
-- medida de la lista y de ahí se corrigieron —tres estaban mal, cargados con
-- los últimos dígitos del código—. Los otros tres no lo traen:
--
--     CB0500640   ancho 55    sin Z= en la lista
--     CB0750660   ancho 75    sin Z= en la lista
--     CB1801280   ancho 180   sin Z= en la lista
--
-- Su número había salido del código, que es exactamente el método que estaba
-- equivocado en los otros: `CB` + ancho + `b` + los dígitos finales, y en
-- CB13006100 esos dígitos finales eran 100 cuando los dientes son 96.
--
-- La oficina los verificó uno por uno el 3 de septiembre de 2026 y da la
-- casualidad de que en estos tres el método coincide: son 40, 60 y 80.
--
-- Esta migración no cambia una sola fila hoy. Se escribe igual por dos
-- razones: deja el dato afirmado en vez de heredado —el que lea la tabla
-- mañana no tiene forma de saber cuáles se verificaron y cuáles se dedujeron—
-- y si alguna vez se recarga el catálogo desde la lista, vuelve a fijar los
-- tres valores buenos sin depender de que el importador acierte.
--
-- Los cuatro con `Z=` no se tocan acá: los corrige la migración que lee la
-- medida, que es su fuente y no hace falta repetir.
-- =============================================================================

update public.catalogo_medidas set cantidad_dientes = 40 where codigo = 'CB0500640';
update public.catalogo_medidas set cantidad_dientes = 60 where codigo = 'CB0750660';
update public.catalogo_medidas set cantidad_dientes = 80 where codigo = 'CB1801280';
