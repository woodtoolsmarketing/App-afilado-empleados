-- =============================================================================
-- BRIEF para Claude Code: el puente entre un reporte y el que lo arregla.
--
-- "Reportar un problema" junta motivo + detalle + audio + fotos. Esta tabla
-- guarda el BRIEF que arma la API de Claude a partir de ese reporte: una orden
-- de trabajo en texto (markdown) lista para pegar en una sesion de Claude Code,
-- que es la que tiene el repo y hace el fix. La API de Claude NO toca el repo;
-- solo traduce el reporte (motivo + lo que se escribio + lo que se dijo por
-- audio + lo que se ve en las fotos) a una orden de trabajo clara.
--
-- Por que una tabla aparte y no columnas en reportes_problema:
--   - El brief es tecnico e interno (hipotesis, donde mirar en el codigo). NO
--     tiene por que viajar al telefono del vendedor, y `misReportes()` hace
--     `select('*')`. En una tabla aparte con RLS solo-admin el brief no sale
--     nunca de la oficina.
--   - Un reporte tiene a lo sumo un brief (se regenera encima). `reporte_id` es
--     la PK => relacion uno-a-uno, que el panel lee embebida.
--
-- La escribe la Edge Function `triar-reporte` con la service key (saltea RLS);
-- la lee el panel como admin.
-- =============================================================================

create table if not exists public.reportes_brief (
  -- Uno por reporte: regenerar pisa el anterior (upsert por reporte_id).
  reporte_id    uuid primary key references public.reportes_problema (id) on delete cascade,

  -- La orden de trabajo en markdown, tal cual la devolvio el modelo.
  brief_md      text not null,

  -- Con que modelo se genero (para auditar costo/calidad si se cambia el modelo).
  modelo        text,
  -- Si se le mandaron las fotos del reporte (vision) o solo el texto. Las fotos
  -- son opt-in porque pueden arrastrar datos de clientes a la API externa.
  incluye_fotos boolean not null default false,

  -- Quien apreto "Preparar para Claude Code".
  generado_por  uuid references public.perfiles (id) on delete set null,
  generado_en   timestamptz not null default now()
);

comment on table public.reportes_brief is
  'Brief/orden-de-trabajo que arma la API de Claude a partir de un reporte, para pegar en Claude Code. Solo-admin: no viaja al telefono del vendedor.';

alter table public.reportes_brief enable row level security;

-- Solo la oficina que resuelve los problemas (admin) ve y maneja los briefs. El
-- vendedor NO: es contenido tecnico interno. La funcion igual escribe con la
-- service key, que saltea RLS.
drop policy if exists reportes_brief_admin on public.reportes_brief;
create policy reportes_brief_admin on public.reportes_brief
  for all to authenticated
  using (interno.es_admin()) with check (interno.es_admin());
