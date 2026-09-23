drop function if exists public.buscar_articulos(text, date, integer, text);

create or replace function public.buscar_articulos(
  p_texto text, p_fecha date default current_date, p_limite integer default 20, p_familia text default null::text)
 returns table(codigo text, descripcion text, medida text, precio numeric, moneda text,
   precio_pesos numeric, familia text, sin_precio boolean,
   diametro_exterior numeric, ancho_corte numeric, diametro_interior numeric, dientes integer)
 language sql stable
 set search_path to 'public', 'pg_temp'
as $function$
  select
    c.codigo, c.descripcion, c.medida, c.precio, c.moneda,
    round(public.precio_en_pesos(c.precio, c.moneda, p_fecha), 2),
    c.familia, c.precio_a_confirmar,
    c.diametro_exterior, c.ancho_corte, c.diametro_interior, c.dientes
  from public.vista_catalogo_vigente c
  where (
      coalesce(nullif(trim(p_texto), ''), '') = ''
      or c.codigo ilike '%' || trim(p_texto) || '%'
      or c.descripcion ilike '%' || trim(p_texto) || '%'
    )
    and (p_familia is null or c.familia = p_familia)
    and (p_familia is null or not c.es_servicio)
  order by
    (c.codigo ilike trim(p_texto)) desc,
    c.precio_a_confirmar,
    c.codigo
  limit least(coalesce(p_limite, 20), 100);
$function$;
