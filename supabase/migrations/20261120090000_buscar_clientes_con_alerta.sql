-- con_alerta: bandera "Cuidado con este cliente". Se prende en los clientes que
-- en el padrón figuran Inhabilitados pero SIN el "OK" (los que tienen OK pasan a
-- ocultos). El vendedor los sigue viendo, pero en amarillo con un aviso de
-- peligro. La columna ya existía en la base pero no estaba en ninguna migración:
-- se formaliza acá (idempotente).
alter table public.clientes
  add column if not exists con_alerta boolean not null default false;

-- buscar_clientes ahora devuelve con_alerta, para que el móvil pueda pintar la
-- alerta en la fila del cliente. Cambia el RETURNS TABLE, así que va DROP+CREATE.
drop function if exists public.buscar_clientes(text, integer);

create function public.buscar_clientes(p_texto text, p_limite integer default 15)
 returns table(
   cliente_id uuid, codigo text, razon_social text, nombre_fantasia text, cuit text,
   contacto_nombre text, telefono text, email text, provisorio boolean, con_alerta boolean,
   vendedor_id uuid, direccion_id uuid, direccion text, codigo_postal text,
   lat double precision, lng double precision, localidad text, provincia text)
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
  with q as (
    select
      btrim(regexp_replace(
        regexp_replace(interno.normalizar_busqueda(p_texto), '[^a-z0-9 ]', '', 'g'),
        '\s+', ' ', 'g')) as t,
      regexp_replace(coalesce(p_texto, ''), '[^0-9]', '', 'g') as digitos
  ),
  p as (
    select
      q.t,
      q.digitos,
      array_remove(string_to_array(q.t, ' '), '') as palabras,
      (select w from unnest(string_to_array(q.t, ' ')) w
        where w <> '' order by length(w) desc, w limit 1) as mayor,
      case when length(q.digitos) >= 3 then '%' || q.digitos || '%' end as pat_cuit,
      case when length(q.digitos) >= 6 then '%' || right(q.digitos, 6) || '%' end as pat_tel
    from q
  )
  select
    c.id, c.codigo, c.razon_social, c.nombre_fantasia, c.cuit,
    c.contacto_nombre, c.telefono, c.email, c.provisorio, c.con_alerta, c.vendedor_id,
    d.id,
    coalesce(d.direccion_formateada, c.direccion),
    coalesce(d.codigo_postal, c.codigo_postal),
    d.lat, d.lng,
    coalesce(d.localidad, c.localidad),
    d.provincia
  from public.clientes c
  cross join p
  left join lateral (
    select * from public.direcciones dd
     where dd.cliente_id = c.id
     order by dd.principal desc, dd.creado_en
     limit 1
  ) d on true
  where (select interno.esta_habilitado() or interno.puede_ver_todo())
    and c.activo
    and (c.habilitado or (select interno.puede_ver_todo()))
    and (not c.provisorio or (select interno.puede_ver_todo()))
    and (
      (
        p.mayor is not null
        and c.busqueda_plana like '%' || p.mayor || '%'
        and not exists (
          select 1 from unnest(p.palabras) w
           where c.busqueda_plana not like '%' || w || '%'
        )
      )
      or (
        p.t ~ '[a-z]'
        and p.mayor is not null and length(p.mayor) >= 4
        -- Equivale al `busqueda_plana %> mayor` de antes (que usaba el GUC
        -- pg_trgm.word_similarity_threshold=0.4, imposible de SETear desde acá):
        -- `a %> b` == `word_similarity(b, a) >= umbral`.
        and extensions.word_similarity(p.mayor, c.busqueda_plana) >= 0.4
        and not exists (
          select 1 from unnest(p.palabras) w
           where length(w) >= 3
             and c.busqueda_plana not like '%' || w || '%'
             and extensions.word_similarity(w, c.busqueda_plana) < 0.5
        )
      )
      or regexp_replace(coalesce(c.cuit, ''), '[^0-9]', '', 'g') like p.pat_cuit
      or regexp_replace(
           regexp_replace(
             regexp_replace(coalesce(c.telefono, ''), '[ ()+.-]', '', 'g'),
             '([0-9]{6})[^0-9]+', '\1 ', 'g'),
           '[^0-9 ]', '', 'g')
         like p.pat_tel
    )
  order by
    (c.codigo = btrim(coalesce(p_texto, ''))) desc,
    (p.pat_cuit is not null
      and regexp_replace(coalesce(c.cuit, ''), '[^0-9]', '', 'g') <> ''
      and regexp_replace(coalesce(c.cuit, ''), '[^0-9]', '', 'g') = p.digitos) desc,
    (c.codigo like btrim(coalesce(p_texto, '')) || '%') desc,
    (c.busqueda_plana like p.t || '%') desc,
    (case
       when p.t ~ '^[0-9]+$'
       then c.busqueda_plana ~ ('(^|[^0-9])' || p.t || '([^0-9]|$)')
     end) desc,
    (c.codigo like '%' || btrim(coalesce(p_texto, '')) || '%') desc,
    (p.mayor is not null and c.busqueda_plana like '%' || p.mayor || '%'
      and not exists (select 1 from unnest(p.palabras) w where c.busqueda_plana not like '%' || w || '%')) desc,
    extensions.word_similarity(p.t, c.busqueda_plana) desc,
    case
      when c.codigo like '%' || btrim(coalesce(p_texto, '')) || '%'
      then lpad(c.codigo, 8, '0')
    end,
    c.razon_social,
    lpad(c.codigo, 8, '0')
  limit least(coalesce(p_limite, 15), 50);
$function$;

revoke all on function public.buscar_clientes(text, integer) from public, anon;
grant execute on function public.buscar_clientes(text, integer) to authenticated;
