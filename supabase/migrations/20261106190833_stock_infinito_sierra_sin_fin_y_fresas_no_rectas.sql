-- Stock "infinito" (siempre disponible) para sierra sin fin y fresas NO rectas.
--
-- La sierra sin fin es POR ENCARGO y la fresa no recta también se hace a pedido:
-- no tiene sentido que el stock (que arranca en 0 en la lista) las bloquee en la
-- venta con "SIN STOCK". `buscar_articulos` devuelve `stock=null` para esas
-- familias, que `nivelDeStock` (compartido) lee como "hay" (verde): quedan
-- siempre elegibles. El resto sigue con su stock real.
--
-- "Fresa no recta" se resuelve por TEXTO de la descripción (no hay subtipo en el
-- catálogo): fresa cuya descripción NO dice "recta". Es heurística, pero sólo
-- afecta a si se muestra "SIN STOCK" (no al precio ni al código), y hoy las
-- fresas no trackean stock, así que en la práctica recién pesa cuando empiecen.
--
-- Es lógica de la RPC, no un dato del catálogo: sobrevive a las recargas de la
-- lista de precios y NO necesita versión nueva de la app ni del panel.
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
    -- Sierra sin fin (producto) y fresa no recta: siempre disponibles (stock
    -- null = "hay"). El afilado de sierra sin fin (es_servicio) no entra acá.
    case
      when (c.familia = 'sierra_sin_fin' and not c.es_servicio)
        or (c.familia = 'fresa' and c.descripcion not ilike '%recta%')
      then null
      else s.cantidad
    end
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
