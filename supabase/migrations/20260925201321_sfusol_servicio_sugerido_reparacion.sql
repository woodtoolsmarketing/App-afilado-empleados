-- Los codigos SFUSOL* son de SOLDADURA de sierra sin fin, pero tenian
-- servicio_sugerido null, asi que buscar_codigo_computo los proponia tambien en
-- un AFILADO (y con rango mas ajustado que SFU090AF, ganaban). Se les pone
-- servicio_sugerido = 'reparacion' (soldar es una reparacion): salen del afilado
-- y, para 51-90mm, el afilado propone SFU090AF.
-- NOTA oficina: el afilado de SSF de 91-100mm queda sin codigo sugerido
-- (SFU090AF cubre "hasta 90mm"); ahi el vendedor carga el codigo a mano hasta
-- que se defina/cargue un codigo de afilado para ese tramo.
update public.catalogo_articulos
   set servicio_sugerido = 'reparacion'
 where codigo like 'SFUSOL%'
   and servicio_sugerido is distinct from 'reparacion';
