-- =============================================================================
-- WoodTools · el stock entra al buscador de la venta (semáforo)
--
-- El vendedor arma la nota eligiendo el producto en el buscador del catálogo
-- (buscar_articulos). Hasta ahora el buscador no sabía nada del stock. Ahora la
-- búsqueda devuelve el stock de cada producto para que el teléfono pueda pintar
-- el semáforo en la venta: verde con stock de sobra, amarillo con 5 o menos, y
-- rojo + opaco cuando está agotado (0), caso en que ni se puede elegir.
--
-- `stock` es nullable a propósito:
--   · número  → la oficina trackea ese producto (puede ser 0 = agotado).
--   · null    → no está trackeado (no hay fila en stock_articulos): stock
--               desconocido, NO se marca (queda como está hoy, en verde).
--
-- Cómo lo lee el móvil: la policy `stock_leer` deja leer stock_articulos a
-- cualquier usuario habilitado, así que el LEFT JOIN funciona con la RLS del que
-- consulta (la función sigue siendo SECURITY INVOKER, no DEFINER). Un producto
-- con varias medidas comparte el stock del código (el join es por codigo).
--
-- Agregar una columna al RETURNS TABLE obliga a DROP + CREATE (no se puede
-- CREATE OR REPLACE cambiando el tipo de retorno). Se recrea idéntica salvo el
-- JOIN y la columna nueva; el grant por defecto (PUBLIC execute) reproduce el
-- que tenía.
-- =============================================================================

drop function if exists public.buscar_articulos(text, date, integer, text);

create function public.buscar_articulos(
  p_texto   text,
  p_fecha   date    default current_date,
  p_limite  integer default 20,
  p_familia text    default null
)
returns table(
  codigo text, descripcion text, medida text, precio numeric, moneda text,
  precio_pesos numeric, familia text, sin_precio boolean,
  diametro_exterior numeric, ancho_corte numeric, diametro_interior numeric,
  dientes integer, stock integer
)
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
  select
    c.codigo, c.descripcion, c.medida, c.precio, c.moneda,
    round(public.precio_en_pesos(c.precio, c.moneda, p_fecha), 2),
    c.familia, c.precio_a_confirmar,
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

comment on function public.buscar_articulos(text, date, integer, text) is
  'Busca productos del catalogo vigente por codigo/descripcion, con su stock por codigo (null = no trackeado, numero = cantidad, 0 = agotado) para el semaforo de stock de la venta. SECURITY INVOKER: lee stock_articulos con la RLS del vendedor (policy stock_leer).';
