-- =============================================================================
-- El buscador muestra el domicilio geocodificado si existe y, si no, el del
-- listado.
--
-- Antes miraba sólo `direcciones`, así que los 12.181 clientes del padrón
-- aparecían sin domicilio ni localidad. Y sin localidad la nota de pedido
-- tampoco podía asignar la zona sola, que es de lo poco que el vendedor no
-- tiene que pensar.
-- =============================================================================

create or replace function public.buscar_clientes(p_texto text, p_limite integer default 15)
returns table(
  cliente_id uuid, codigo text, razon_social text, nombre_fantasia text, cuit text,
  contacto_nombre text, telefono text, email text, provisorio boolean, vendedor_id uuid,
  direccion_id uuid, direccion text, codigo_postal text, lat double precision,
  lng double precision, localidad text, provincia text)
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
  with t as (select trim(coalesce(p_texto, '')) as q),
  -- El CUIT se compara sin guiones: la gente lo tipea de las dos formas.
  n as (select regexp_replace((select q from t), '[^0-9]', '', 'g') as solo_digitos)
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
  left join lateral (
    select * from public.direcciones dd
     where dd.cliente_id = c.id
     order by dd.principal desc, dd.creado_en
     limit 1
  ) d on true
  cross join t cross join n
  where c.activo
    and (
      t.q = ''
      or c.codigo ilike '%' || t.q || '%'
      or c.razon_social ilike '%' || t.q || '%'
      or coalesce(c.nombre_fantasia, '') ilike '%' || t.q || '%'
      or (
        n.solo_digitos <> ''
        and length(n.solo_digitos) >= 3
        and regexp_replace(coalesce(c.cuit, ''), '[^0-9]', '', 'g') like '%' || n.solo_digitos || '%'
      )
    )
  order by
    (c.codigo ilike (select q from t)) desc,
    (regexp_replace(coalesce(c.cuit, ''), '[^0-9]', '', 'g') = (select solo_digitos from n)) desc,
    c.razon_social
  limit least(coalesce(p_limite, 15), 50);
$function$;
