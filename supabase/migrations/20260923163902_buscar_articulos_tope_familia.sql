-- Sube el tope de buscar_articulos de 100 a 400 para poder precargar una familia
-- entera en el cliente (sierra 172, sierra sin fin 191) y filtrar localmente.
-- Los llamadores existentes pasan p_limite 20/40, asi que no cambia su comportamiento;
-- solo la precarga de familia del buscador pide mas.
CREATE OR REPLACE FUNCTION public.buscar_articulos(p_texto text, p_fecha date DEFAULT CURRENT_DATE, p_limite integer DEFAULT 20, p_familia text DEFAULT NULL::text)
 RETURNS TABLE(codigo text, descripcion text, medida text, precio numeric, moneda text, precio_pesos numeric, familia text, sin_precio boolean, diametro_exterior numeric, ancho_corte numeric, diametro_interior numeric, dientes integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  limit least(coalesce(p_limite, 20), 400);
$function$;
