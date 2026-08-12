-- =============================================================================
-- El talonario arranca de cero
--
-- Las notas que había eran todas de prueba: trece de "Prueba 1" del 5 al 7 de
-- agosto —cargadas desde el probador, que escribía en el talonario real por no
-- declarar su variante— y las de los ensayos del 12. Ninguna corresponde a un
-- trabajo hecho.
--
-- Se borran y los tres contadores vuelven a 0, así la primera nota de verdad
-- es la 000001. Los renglones se van con ellas: la clave foránea es
-- `on delete cascade`.
--
-- Los registros de auditoría NO se tocan. Son el diario de lo que pasó, y que
-- las notas se hayan borrado también es algo que pasó.
-- =============================================================================

delete from public.notas_pedido;

update public.talonarios
   set ultimo_numero  = 0,
       actualizado_en = now();
