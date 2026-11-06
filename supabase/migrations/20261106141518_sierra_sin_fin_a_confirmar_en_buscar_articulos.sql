-- Las sierras sin fin son POR ENCARGO: no llevan precio de lista, el vendedor
-- las cotiza y pone el precio. buscar_articulos las devuelve siempre "a
-- confirmar" (sin_precio=true, precio=0, sin precio en pesos), conservando su
-- MONEDA para que el vendedor cargue el importe en la moneda que corresponda
-- (US$ las importadas, $ las nacionales). Es logica de la RPC, no un dato del
-- catalogo, asi que sobrevive a las recargas de la lista de precios y NO
-- necesita nueva version de la app ni del panel. Solo afecta a los PRODUCTOS
-- (not es_servicio); el afilado de sierra sin fin no se toca. Las fresas y el
-- resto quedan igual.
create or replace function public.buscar_articulos(
  p_texto text,
  p_fecha date default current_date,
  p_limite integer default 20,
  p_familia text default null
)
returns table(codigo text, descripcion text, medida text, precio numeric, moneda text, precio_pesos numeric, familia text, sin_precio boolean, diametro_exterior numeric, ancho_corte numeric, diametro_interior numeric, dientes integer, stock integer)
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
  select
    c.codigo, c.descripcion, c.medida,
    case when c.familia = 'sierra_sin_fin' and not c.es_servicio then 0 else c.precio end,
    c.moneda,
    case when c.familia = 'sierra_sin_fin' and not c.es_servicio
         then null
         else round(public.precio_en_pesos(c.precio, c.moneda, p_fecha), 2) end,
    c.familia,
    (c.precio_a_confirmar or (c.familia = 'sierra_sin_fin' and not c.es_servicio)),
    c.diametro_exterior, c.ancho_corte, c.diametro_interior, c.dientes,
    s.cantidad
  from public.vista_catalogo_vigente c
  left join public.stock_articulos s on s.codigo = c.codigo
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
  limit least(coalesce(p_limite, 20), 1000);
$function$;
