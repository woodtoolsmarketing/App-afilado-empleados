-- El buscador de clientes esconde los provisorios.
--
-- Un cliente que un vendedor creó queda "provisorio" hasta que la oficina lo
-- confirma (le pone el código definitivo). Hasta entonces el vendedor NO tiene
-- que tener acceso a ese cliente en el sistema: no aparece en el buscador, así no
-- lo puede elegir para una nota o un recorrido nuevos. La nota que lo haya
-- originado se sigue pudiendo hacer —queda atada por id—, pero el cliente como
-- tal no es "buscable" todavía.
--
-- La oficina (puede_ver_todo: admin/supervisor) SÍ los ve en el buscador, para
-- poder encontrarlos si hace falta. Todo lo demás (match, columnas, join, orden)
-- queda igual que en la versión anterior.
create or replace function public.buscar_clientes(p_texto text, p_limite integer default 15)
returns table(cliente_id uuid, codigo text, razon_social text, nombre_fantasia text, cuit text, contacto_nombre text, telefono text, email text, provisorio boolean, vendedor_id uuid, direccion_id uuid, direccion text, codigo_postal text, lat double precision, lng double precision, localidad text, provincia text)
language sql
stable
security definer
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
    c.contacto_nombre, c.telefono, c.email, c.provisorio, c.vendedor_id,
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
    -- Los provisorios no se buscan (salvo que seas la oficina): el vendedor no
    -- tiene acceso al cliente hasta que lo confirmen. `(select ...)` = InitPlan,
    -- se evalúa una sola vez; `not c.provisorio` es por fila pero es barato.
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
    case
      when c.codigo like '%' || btrim(coalesce(p_texto, '')) || '%'
      then lpad(c.codigo, 8, '0')
    end,
    c.razon_social,
    lpad(c.codigo, 8, '0')
  limit least(coalesce(p_limite, 15), 50);
$function$;

revoke execute on function public.buscar_clientes(text, integer) from public, anon;
