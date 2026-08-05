-- =============================================================================
-- WoodTools · Rol de Visita
-- "Envíos" pasa a llamarse "Visitas" en toda la app.
--
-- El nombre de esta función es interno y no lo ve nadie, pero dejarlo
-- desalineado con el vocabulario del dominio es como se acumula la deuda que
-- después nadie entiende.
-- =============================================================================

alter function public.historial_envios(date, date, uuid)
  rename to historial_visitas;

comment on function public.historial_visitas is
  'Historial agrupado por día para la pantalla "HISTORIAL DE VISITAS". A los vendedores se les recorta el rango a la retención vigente (90 días).';
