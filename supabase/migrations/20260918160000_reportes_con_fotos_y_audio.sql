-- =============================================================================
-- REPORTAR UN PROBLEMA con fotos y audio.
--
-- Hasta hoy el reporte era texto y contexto. Pero "la nota sale cortada" o "el
-- boton no responde" se entienden en un segundo con una foto de la pantalla, y
-- un vendedor en la calle explica mejor hablando que tipeando con una mano. Se
-- agregan dos adjuntos:
--   · Fotos (camara o galeria), para que Marketing VEA lo que pasa.
--   · Un audio, que ademas Gemini transcribe a texto (la misma funcion
--     `transcribir-audio` que ya usa el dictado de las notas). Se guarda el
--     audio Y su transcripcion: uno para escuchar, la otra para leer y buscar.
--
-- Los archivos van a un bucket privado nuevo, `reportes-adjuntos`, servido con
-- URLs firmadas de vida corta. A diferencia de los otros buckets —que son de
-- solo-admin— este deja subir al VENDEDOR, pero unicamente adentro de su propia
-- carpeta (`<vendedor_id>/...`): un vendedor no puede escribir sobre lo de otro.
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. El bucket de los adjuntos
-- ─────────────────────────────────────────────────────────────────────────────

insert into storage.buckets (id, name, public, file_size_limit)
values ('reportes-adjuntos', 'reportes-adjuntos', false, 26214400)  -- 25 MB
on conflict (id) do nothing;

-- Sube el vendedor habilitado, pero SOLO a su carpeta: la primera parte de la
-- ruta tiene que ser su propio id. Asi un reporte no puede pisar los adjuntos
-- de otro ni subir a nombre ajeno.
drop policy if exists "reportes adjuntos subir propio" on storage.objects;
create policy "reportes adjuntos subir propio" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'reportes-adjuntos'
    and interno.esta_habilitado()
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Lee el que atiende (admin/administracion/supervisor) y el dueño de la carpeta:
-- el vendedor tiene que poder ver lo que el mismo adjunto.
drop policy if exists "reportes adjuntos leer" on storage.objects;
create policy "reportes adjuntos leer" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'reportes-adjuntos'
    and (interno.puede_ver_todo() or (storage.foldername(name))[1] = auth.uid()::text)
  );

-- Borrar es de la oficina (limpieza). El vendedor no borra adjuntos ya subidos.
drop policy if exists "reportes adjuntos borrar admin" on storage.objects;
create policy "reportes adjuntos borrar admin" on storage.objects
  for delete to authenticated
  using (bucket_id = 'reportes-adjuntos' and interno.es_admin());


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Las columnas nuevas en el reporte
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.reportes_problema
  -- Array de { tipo: 'foto' | 'audio', ruta: text }. La `ruta` es el object path
  -- dentro del bucket `reportes-adjuntos`, no una URL: se firma al leer, igual
  -- que las fotos de los vendedores.
  add column if not exists adjuntos jsonb not null default '[]'::jsonb,
  -- Lo que Gemini saco del audio. Aparte del `detalle` que se tipea: uno es lo
  -- que dijo hablando, el otro lo que escribio.
  add column if not exists transcripcion_audio text;

comment on column public.reportes_problema.adjuntos is
  'Adjuntos del reporte: [{ tipo: foto|audio, ruta }]. `ruta` es el object path en el bucket reportes-adjuntos.';
comment on column public.reportes_problema.transcripcion_audio is
  'Transcripcion (Gemini) del audio adjunto, si hay.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. La RPC, ahora con adjuntos y transcripcion
--
-- Se DROPEA y se recrea porque cambia la firma (dos parametros nuevos): un
-- `create or replace` con distinta lista de argumentos crea una sobrecarga en
-- vez de reemplazar, y despues las llamadas quedan ambiguas.
-- ─────────────────────────────────────────────────────────────────────────────

drop function if exists public.reportar_problema(text, text, text, text, text, text, text);

create or replace function public.reportar_problema(
  p_motivo             text,
  p_detalle            text default null,
  p_cuando_se_da       text default null,
  p_pantalla           text default null,
  p_version_app        text default null,
  p_instalacion        text default null,
  p_modelo             text default null,
  p_adjuntos           jsonb default '[]'::jsonb,
  p_transcripcion_audio text default null
)
returns public.reportes_problema
language plpgsql
security invoker
set search_path to 'public', 'extensions', 'pg_temp'
as $fn$
declare
  guardado public.reportes_problema;
begin
  if coalesce(btrim(p_motivo), '') = '' then
    raise exception 'Elegi cual es el problema antes de enviarlo.'
      using errcode = '23514';
  end if;

  insert into public.reportes_problema (
    vendedor_id, motivo, detalle, cuando_se_da,
    pantalla, version_app, instalacion, modelo,
    adjuntos, transcripcion_audio
  )
  values (
    auth.uid(),
    btrim(p_motivo),
    nullif(btrim(coalesce(p_detalle, '')), ''),
    nullif(btrim(coalesce(p_cuando_se_da, '')), ''),
    nullif(btrim(coalesce(p_pantalla, '')), ''),
    nullif(btrim(coalesce(p_version_app, '')), ''),
    nullif(btrim(coalesce(p_instalacion, '')), ''),
    nullif(btrim(coalesce(p_modelo, '')), ''),
    -- Un array vacio o null quedan como '[]': la columna no admite null.
    coalesce(p_adjuntos, '[]'::jsonb),
    nullif(btrim(coalesce(p_transcripcion_audio, '')), '')
  )
  returning * into guardado;

  return guardado;
end;
$fn$;

comment on function public.reportar_problema is
  'Guarda un problema reportado desde la app, con adjuntos (fotos/audio) y la transcripcion del audio. El vendedor sale de la sesion, no del parametro.';

grant execute on function public.reportar_problema(
  text, text, text, text, text, text, text, jsonb, text
) to authenticated;
