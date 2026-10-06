-- Seguimiento continuo (Fase 1): el histórico de posiciones puede existir sin un
-- recorrido. Hasta ahora `posiciones.rol_visita_id` era NOT NULL porque sólo se
-- rastreaba durante un recorrido; con el seguimiento continuo en horario laboral
-- hay puntos "de jornada" sin recorrido asociado. La RLS es por `vendedor_id`
-- (no por rol_visita), así que admitir nulo no la afecta.
alter table public.posiciones alter column rol_visita_id drop not null;
