-- =============================================================================
-- Se vuelve atrás el recorte previo a la dirección, y queda la versión buena
--
-- La migración anterior intentaba filtrar y cortar en 25 primero, y recién ahí
-- buscar la dirección de esos veinticinco, en vez de traerla para cada
-- candidato. Para conservar el orden usaba `row_number() over (order by …)`, y
-- eso obliga a Postgres a ordenar TODAS las filas candidatas: la ventana se
-- calcula sobre el conjunto entero antes de que el `limit` pueda descartar
-- nada.
--
-- Lo que había antes, `order by … limit 25`, deja que el planificador use un
-- top-N: se va quedando con los mejores veinticinco a medida que recorre, sin
-- ordenar el resto. Sale bastante más barato que el `lateral` que se quería
-- evitar.
--
-- Medido, con el mismo padrón y en la misma sesión:
--
--                 con lateral primero    con row_number
--     "to"                117 ms              403 ms
--     "tor"                98 ms              431 ms
--
-- Queda anotado para el que lo intente de nuevo: el camino no es `row_number`,
-- es repetir el `order by` en la consulta de afuera sobre las veinticinco
-- filas que sobrevivieron.
--
-- ── Ésta es la versión que vale ─────────────────────────────────────────────
--
-- Junta las tres cosas de esta tanda: buscar por palabras y sin acentos contra
-- la columna guardada, y no calcular el CUIT ni el teléfono cuando no hay
-- dígitos tipeados.
--
-- Contra el padrón de hoy, los cuatro casos que antes no encontraban nada:
--
--     "ACUNA"          8   (antes 1)
--     "RODISER S.A."   1   (antes 0)
--     "ACUÑA CLAUDIO"  1   (antes 0)
--     "david acuna"    1   (antes 0)
-- =============================================================================

create or replace function public.buscar_clientes(p_texto text, p_limite integer default 15)
returns table (
  cliente_id uuid, codigo text, razon_social text, nombre_fantasia text, cuit text,
  contacto_nombre text, telefono text, email text, provisorio boolean, vendedor_id uuid,
  direccion_id uuid, direccion text, codigo_postal text, lat double precision,
  lng double precision, localidad text, provincia text
)
language sql
stable
set search_path to 'public', 'pg_temp'
as $fn$
  with q as (
    select
      interno.normalizar_busqueda(p_texto) as t,
      regexp_replace(coalesce(p_texto, ''), '[^0-9]', '', 'g') as digitos
  ),
  p as (
    select
      q.t,
      q.digitos,
      array_remove(string_to_array(q.t, ' '), '') as palabras,
      -- La palabra más larga es la que se le pide al índice: es la que menos
      -- filas devuelve. Las demás filtran después, sobre esas pocas.
      (select w from unnest(string_to_array(q.t, ' ')) w
        where w <> '' order by length(w) desc, w limit 1) as mayor
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
  where c.activo
    and (
      -- Todas las palabras, en cualquier orden, contra el nombre ya guardado
      -- en minúsculas y sin acentos.
      (
        p.mayor is not null
        and c.busqueda like '%' || p.mayor || '%'
        and not exists (
          select 1 from unnest(p.palabras) w
           where c.busqueda not like '%' || w || '%'
        )
      )
      -- Tres dígitos o más: puede ser un CUIT.
      or (
        length(p.digitos) >= 3
        and regexp_replace(coalesce(c.cuit, ''), '[^0-9]', '', 'g')
              like '%' || p.digitos || '%'
      )
      -- Seis o más: puede ser un teléfono, y se busca por los últimos seis.
      or (
        length(p.digitos) >= 6
        and regexp_replace(
              regexp_replace(
                regexp_replace(coalesce(c.telefono, ''), '[ ()+.-]', '', 'g'),
                '([0-9]{6})[^0-9]+', '\1 ', 'g'),
              '[^0-9 ]', '', 'g')
            like '%' || right(p.digitos, 6) || '%'
      )
    )
  order by
    (c.codigo = btrim(coalesce(p_texto, ''))) desc,
    (length(p.digitos) >= 3
      and regexp_replace(coalesce(c.cuit, ''), '[^0-9]', '', 'g') <> ''
      and regexp_replace(coalesce(c.cuit, ''), '[^0-9]', '', 'g') = p.digitos) desc,
    (c.codigo like btrim(coalesce(p_texto, '')) || '%') desc,
    (c.busqueda like p.t || '%') desc,
    (case
       when p.t ~ '^[0-9]+$'
       then c.busqueda ~ ('(^|[^0-9])' || p.t || '([^0-9]|$)')
     end) desc,
    (c.codigo like '%' || btrim(coalesce(p_texto, '')) || '%') desc,
    case
      when c.codigo like '%' || btrim(coalesce(p_texto, '')) || '%'
      then lpad(c.codigo, 8, '0')
    end,
    c.razon_social,
    lpad(c.codigo, 8, '0')
  limit least(coalesce(p_limite, 15), 50);
$fn$;

comment on function public.buscar_clientes(text, integer) is
  'Busca por codigo, razon social, nombre de fantasia, CUIT o telefono. El texto se normaliza —sin acentos, espacios colapsados— y se exigen TODAS las palabras en cualquier orden.';

grant execute on function public.buscar_clientes(text, integer) to authenticated;
