-- Anti-duplicados al crear un cliente nuevo desde el movil.
-- Criterio "coincidencia fuerte": bloquea con CUIT/DNI exacto, email exacto, o
-- (telefono + nombre parecido, word_similarity >= 0.5). Nombre muy parecido solo
-- (word_similarity >= 0.6, el umbral por defecto del operador %>) = aviso, no bloquea.
-- Se compara contra TODO el padron activo no rechazado (incluye provisorios y
-- no-habilitados que el buscador del vendedor no ve), por eso SECURITY DEFINER.
-- NOTA: no se puede fijar pg_trgm.word_similarity_threshold como atributo de la
-- funcion via apply_migration (permiso denegado); por eso el %> usa el default 0.6,
-- que justo coincide con el umbral de aviso por nombre.

-- Indices para que el chequeo sea un bitmap-OR de index scans y no un seq scan
-- con word_similarity sobre las ~16k filas.
create index if not exists clientes_dup_cuit_dig
  on public.clientes (regexp_replace(coalesce(cuit,''), '[^0-9]', '', 'g')) where activo;
create index if not exists clientes_dup_doc_dig
  on public.clientes (regexp_replace(coalesce(documento,''), '[^0-9]', '', 'g')) where activo;
create index if not exists clientes_dup_email
  on public.clientes (lower(btrim(email))) where activo;
create index if not exists clientes_dup_tel8
  on public.clientes (right(regexp_replace(coalesce(telefono,''), '[^0-9]', '', 'g'), 8)) where activo;

create or replace function public.clientes_posibles_duplicados(
  p_razon_social text,
  p_documento text default null,
  p_email text default null,
  p_telefonos text[] default null
)
returns table(codigo text, razon_social text, nombre_fantasia text, localidad text,
              provisorio boolean, fuerza text, motivo text)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_nombre text := btrim(regexp_replace(
                     regexp_replace(interno.normalizar_busqueda(coalesce(p_razon_social,'')),
                                    '[^a-z0-9 ]', '', 'g'),
                     '\s+', ' ', 'g'));
  v_doc   text := regexp_replace(coalesce(p_documento,''), '[^0-9]', '', 'g');
  v_email text := lower(btrim(coalesce(p_email,'')));
  v_tels8 text[] := (
    select array_agg(r) from (
      select right(regexp_replace(coalesce(t,''), '[^0-9]', '', 'g'), 8) as r
      from unnest(coalesce(p_telefonos, '{}'::text[])) as t
      where char_length(regexp_replace(coalesce(t,''), '[^0-9]', '', 'g')) >= 8
    ) s
  );
begin
  return query
  with base as (
    select
      c.id, c.codigo, c.razon_social, c.nombre_fantasia, c.provisorio, c.localidad,
      (v_doc <> '' and (
          v_doc = regexp_replace(coalesce(c.documento,''), '[^0-9]', '', 'g')
          or v_doc = regexp_replace(coalesce(c.cuit,''), '[^0-9]', '', 'g'))) as m_doc,
      (v_email <> '' and v_email = lower(btrim(coalesce(c.email,'')))) as m_email,
      (v_tels8 is not null
        and char_length(regexp_replace(coalesce(c.telefono,''), '[^0-9]', '', 'g')) >= 8
        and right(regexp_replace(coalesce(c.telefono,''), '[^0-9]', '', 'g'), 8) = any(v_tels8)) as m_tel,
      case when v_nombre <> '' then extensions.word_similarity(v_nombre, c.busqueda_plana) else 0 end as sim
    from public.clientes c
    where c.activo and c.rechazado_en is null and (
         (v_doc <> '' and (
            v_doc = regexp_replace(coalesce(c.documento,''), '[^0-9]', '', 'g')
            or v_doc = regexp_replace(coalesce(c.cuit,''), '[^0-9]', '', 'g')))
      or (v_email <> '' and v_email = lower(btrim(coalesce(c.email,''))))
      or (v_tels8 is not null
          and char_length(regexp_replace(coalesce(c.telefono,''), '[^0-9]', '', 'g')) >= 8
          and right(regexp_replace(coalesce(c.telefono,''), '[^0-9]', '', 'g'), 8) = any(v_tels8))
      or (v_nombre <> '' and c.busqueda_plana operator(extensions.%>) v_nombre)
    )
  )
  select
    b.codigo, b.razon_social, b.nombre_fantasia,
    coalesce(
      (select dd.localidad from public.direcciones dd
         where dd.cliente_id = b.id and dd.localidad is not null
         order by dd.principal desc, dd.creado_en limit 1),
      b.localidad, '') as localidad,
    b.provisorio,
    case when b.m_doc or b.m_email or (b.m_tel and b.sim >= 0.5) then 'fuerte' else 'parecido' end as fuerza,
    case
      when b.m_doc then 'Mismo CUIT/DNI'
      when b.m_email then 'Mismo email'
      when b.m_tel and b.sim >= 0.5 then 'Mismo telefono y nombre parecido'
      else 'Nombre muy parecido'
    end as motivo
  from base b
  where b.m_doc or b.m_email or (b.m_tel and b.sim >= 0.5) or b.sim >= 0.6
  order by (case when b.m_doc or b.m_email or (b.m_tel and b.sim >= 0.5) then 0 else 1 end), b.sim desc
  limit 8;
end;
$fn$;

revoke all on function public.clientes_posibles_duplicados(text,text,text,text[]) from public;
revoke all on function public.clientes_posibles_duplicados(text,text,text,text[]) from anon;
grant execute on function public.clientes_posibles_duplicados(text,text,text,text[]) to authenticated;
