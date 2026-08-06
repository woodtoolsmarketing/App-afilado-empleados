-- =============================================================================
-- El buscador de clientes devuelve también localidad y provincia.
--
-- La nota de pedido asigna la zona sola a partir de la ubicación del cliente, y
-- para eso necesita saber la localidad. Con la dirección formateada sola no
-- alcanza: "Las Heras" es un partido de Buenos Aires y también una avenida en
-- media Argentina, así que la provincia es lo único que desempata.
-- =============================================================================

drop function if exists public.buscar_clientes(text, int);

create function public.buscar_clientes(p_texto text, p_limite int default 15)
returns table (
  cliente_id uuid, codigo text, razon_social text, nombre_fantasia text,
  cuit text, contacto_nombre text, telefono text, email text, provisorio boolean,
  vendedor_id uuid, direccion_id uuid, direccion text, codigo_postal text,
  lat double precision, lng double precision,
  localidad text, provincia text
)
language sql stable security invoker
set search_path = public, pg_temp
as $fn$
  with t as (select trim(coalesce(p_texto, '')) as q),
  -- El CUIT se compara sin guiones: la gente lo tipea de las dos formas.
  n as (select regexp_replace((select q from t), '[^0-9]', '', 'g') as solo_digitos)
  select
    c.id, c.codigo, c.razon_social, c.nombre_fantasia, c.cuit,
    c.contacto_nombre, c.telefono, c.email, c.provisorio, c.vendedor_id,
    d.id, d.direccion_formateada, d.codigo_postal, d.lat, d.lng,
    d.localidad, d.provincia
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
$fn$;

comment on function public.buscar_clientes is
  'Buscador de clientes por codigo, razon social, nombre de fantasia o CUIT (con o sin guiones). Devuelve la direccion principal, con localidad y provincia, para autocompletar la nota y asignarle la zona.';
