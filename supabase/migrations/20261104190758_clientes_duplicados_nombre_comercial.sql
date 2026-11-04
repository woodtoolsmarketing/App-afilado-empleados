-- Hallazgo de la re-revision: comparar el nombre contra razon_social SOLA perdia
-- los duplicados por nombre_fantasia (el nombre comercial que el vendedor tipea;
-- ~12% del padron). El inflador de falsos positivos era el CODIGO dentro de
-- busqueda_plana, no la fantasia. Solucion:
--   * BLOQUEO ('fuerte' por telefono+nombre): usa razon_social normalizada (el
--     nombre legal, confiable) -> no se bloquea de mas por una nota en fantasia.
--   * AVISO ('parecido'): compara contra razon_social + nombre_fantasia (SIN el
--     codigo) -> se ve el duplicado comercial, overrideable con "crear igual".

drop index if exists public.clientes_dup_razon;

-- Indice del nombre: trgm sobre (razon_social + nombre_fantasia) normalizado, SIN
-- el codigo, igual que lo arma la funcion para buscar candidatos.
create index if not exists clientes_dup_nombre on public.clientes using gin (
  btrim(regexp_replace(regexp_replace(interno.normalizar_busqueda(coalesce(razon_social,'') || ' ' || coalesce(nombre_fantasia,'')), '[^a-z0-9 ]', '', 'g'), '\s+', ' ', 'g'))
  extensions.gin_trgm_ops
) where activo;

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
  v_dni text := case
                  when char_length(v_doc) = 8 then v_doc
                  when char_length(v_doc) = 11 and left(v_doc, 2) in ('20','23','24','27') then substr(v_doc, 3, 8)
                  else null
                end;
begin
  return query
  with ids as (
    select c.id from public.clientes c
      where c.activo and c.rechazado_en is null and v_doc <> ''
        and regexp_replace(coalesce(c.documento,''), '[^0-9]', '', 'g') = v_doc
    union
    select c.id from public.clientes c
      where c.activo and c.rechazado_en is null and v_doc <> ''
        and regexp_replace(coalesce(c.cuit,''), '[^0-9]', '', 'g') = v_doc
    union  -- DNI tipeado vs DNI embebido en un CUIT de persona
    select c.id from public.clientes c
      where c.activo and c.rechazado_en is null and v_dni is not null
        and left(regexp_replace(coalesce(c.cuit,''), '[^0-9]', '', 'g'), 2) in ('20','23','24','27')
        and substr(regexp_replace(coalesce(c.cuit,''), '[^0-9]', '', 'g'), 3, 8) = v_dni
    union  -- CUIT tipeado cuyo DNI matchea un documento del padron
    select c.id from public.clientes c
      where c.activo and c.rechazado_en is null and v_dni is not null and char_length(v_doc) = 11
        and regexp_replace(coalesce(c.documento,''), '[^0-9]', '', 'g') = v_dni
    union
    select c.id from public.clientes c
      where c.activo and c.rechazado_en is null and v_email <> '' and lower(btrim(c.email)) = v_email
    union
    select c.id from public.clientes c
      where c.activo and c.rechazado_en is null and v_tels8 is not null
        and right(regexp_replace(coalesce(c.telefono,''), '[^0-9]', '', 'g'), 8) = any(v_tels8)
    union  -- nombre contra razon_social + nombre_fantasia (sin codigo), indice clientes_dup_nombre
    select c.id from public.clientes c
      where c.activo and c.rechazado_en is null and v_nombre <> ''
        and btrim(regexp_replace(regexp_replace(interno.normalizar_busqueda(coalesce(c.razon_social,'') || ' ' || coalesce(c.nombre_fantasia,'')), '[^a-z0-9 ]', '', 'g'), '\s+', ' ', 'g'))
            operator(extensions.%>) v_nombre
  ),
  base as (
    select
      c.id, c.codigo, c.razon_social, c.nombre_fantasia, c.provisorio, c.localidad,
      (v_doc <> '' and (
          regexp_replace(coalesce(c.documento,''), '[^0-9]', '', 'g') = v_doc
          or regexp_replace(coalesce(c.cuit,''), '[^0-9]', '', 'g') = v_doc
          or (v_dni is not null and left(regexp_replace(coalesce(c.cuit,''), '[^0-9]', '', 'g'), 2) in ('20','23','24','27')
              and substr(regexp_replace(coalesce(c.cuit,''), '[^0-9]', '', 'g'), 3, 8) = v_dni)
          or (v_dni is not null and char_length(v_doc) = 11
              and regexp_replace(coalesce(c.documento,''), '[^0-9]', '', 'g') = v_dni))) as m_doc,
      (v_email <> '' and lower(btrim(c.email)) = v_email) as m_email,
      (v_tels8 is not null
        and char_length(regexp_replace(coalesce(c.telefono,''), '[^0-9]', '', 'g')) >= 8
        and right(regexp_replace(coalesce(c.telefono,''), '[^0-9]', '', 'g'), 8) = any(v_tels8)) as m_tel,
      -- sim_razon: nombre legal (para el BLOQUEO). sim_full: + fantasia (para el AVISO).
      case when v_nombre <> '' then extensions.word_similarity(
             v_nombre,
             btrim(regexp_replace(regexp_replace(interno.normalizar_busqueda(coalesce(c.razon_social,'')), '[^a-z0-9 ]', '', 'g'), '\s+', ' ', 'g'))
           ) else 0 end as sim_razon,
      case when v_nombre <> '' then extensions.word_similarity(
             v_nombre,
             btrim(regexp_replace(regexp_replace(interno.normalizar_busqueda(coalesce(c.razon_social,'') || ' ' || coalesce(c.nombre_fantasia,'')), '[^a-z0-9 ]', '', 'g'), '\s+', ' ', 'g'))
           ) else 0 end as sim_full
    from public.clientes c join ids on ids.id = c.id
  )
  select
    b.codigo, b.razon_social, b.nombre_fantasia,
    coalesce(
      (select dd.localidad from public.direcciones dd
         where dd.cliente_id = b.id and dd.localidad is not null
         order by dd.principal desc, dd.creado_en limit 1),
      b.localidad, '') as localidad,
    b.provisorio,
    case when b.m_doc or b.m_email or (b.m_tel and b.sim_razon >= 0.65) then 'fuerte' else 'parecido' end as fuerza,
    case
      when b.m_doc then 'Mismo CUIT/DNI'
      when b.m_email then 'Mismo email'
      when b.m_tel and b.sim_full >= 0.6 then 'Mismo telefono y nombre parecido'
      else 'Nombre muy parecido'
    end as motivo
  from base b
  where b.m_doc or b.m_email or (b.m_tel and b.sim_razon >= 0.65) or b.sim_full >= 0.6
  order by (case when b.m_doc or b.m_email or (b.m_tel and b.sim_razon >= 0.65) then 0 else 1 end), b.sim_full desc
  limit 8;
end;
$fn$;

revoke all on function public.clientes_posibles_duplicados(text,text,text,text[]) from public;
revoke all on function public.clientes_posibles_duplicados(text,text,text,text[]) from anon;
grant execute on function public.clientes_posibles_duplicados(text,text,text,text[]) to authenticated;
