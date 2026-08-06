-- El buscador ahora filtra también por servicio y herramienta. Los artículos
-- sin clasificar (NULL) pasan siempre: es preferible mostrar uno de más que
-- esconder el que corresponde.
drop function if exists public.buscar_codigo_computo(text, numeric, text, date);

create function public.buscar_codigo_computo(
  p_familia     text,
  p_medida      numeric,
  p_dimension   text default 'ancho_corte',
  p_fecha       date default current_date,
  p_servicio    text default null,
  p_herramienta text default null
)
returns table (
  codigo text, descripcion text, precio numeric, moneda text,
  precio_pesos numeric, rango_min numeric, rango_max numeric, amplitud numeric
)
language sql stable security invoker
set search_path = public, pg_temp
as $fn$
  select
    c.codigo, c.descripcion, c.precio, c.moneda,
    round(public.precio_en_pesos(c.precio, c.moneda, p_fecha), 2),
    c.rango_min, c.rango_max,
    coalesce(c.rango_max, 99999) - c.rango_min
  from public.vista_catalogo_vigente c
  where c.familia = p_familia
    and c.rango_min is not null
    and coalesce(c.rango_dimension, 'ancho_corte') = p_dimension
    and p_medida >= c.rango_min
    and (c.rango_max is null or p_medida <= c.rango_max)
    and not c.precio_a_confirmar
    and (p_servicio    is null or c.servicio_sugerido    is null or c.servicio_sugerido    = p_servicio)
    and (p_herramienta is null or c.herramienta_sugerida is null or c.herramienta_sugerida = p_herramienta)
  -- El rango más ajustado primero: es el que describe mejor la herramienta.
  order by coalesce(c.rango_max, 99999) - c.rango_min, c.codigo;
$fn$;

comment on function public.buscar_codigo_computo is
  'Códigos de cómputo que cubren la medida, filtrados por servicio y herramienta, del más ajustado al más amplio y con el precio ya convertido a pesos.';
