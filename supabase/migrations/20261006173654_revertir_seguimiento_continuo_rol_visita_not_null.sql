-- Revierte el seguimiento continuo (Fase 1): posiciones vuelve a exigir
-- rol_visita_id. El rastreo de jornada (rol_visita_id NULL) se elimino; la app
-- volvio a rastrear solo durante el recorrido.
alter table public.posiciones alter column rol_visita_id set not null;
