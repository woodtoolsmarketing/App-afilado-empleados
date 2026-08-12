-- =============================================================================
-- Dos cosas del catálogo
--
-- 1. Los artículos sin precio dejan de estar escondidos. Son 108 y hasta ahora
--    el buscador de códigos los filtraba, así que el vendedor no podía ni
--    verlos: la medida "no daba ningún código" y no había forma de saber que
--    el código existía y lo que faltaba era el importe. Ahora aparecen
--    marcados como "a cotizar" y el vendedor pone el precio a mano.
--
--    Van últimos en el orden: el que tiene precio se propone primero.
--
-- 2. Las mechas se eligen por TIPO y modelo, no por medida. La familia entera
--    tiene un solo código con rango, así que buscar por diámetro nunca
--    devolvía nada y el vendedor terminaba tipeando el código de memoria.
-- =============================================================================

drop function if exists public.buscar_codigo_computo(text, numeric, text, date, text, text);

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
  precio_pesos numeric, rango_min numeric, rango_max numeric, amplitud numeric,
  a_cotizar boolean
)
language sql stable security invoker
set search_path = public, pg_temp
as $fn$
  select
    c.codigo, c.descripcion, c.precio, c.moneda,
    round(public.precio_en_pesos(c.precio, c.moneda, p_fecha), 2),
    c.rango_min, c.rango_max,
    coalesce(c.rango_max, 99999) - c.rango_min,
    c.precio_a_confirmar
  from public.vista_catalogo_vigente c
  where c.familia = p_familia
    and c.rango_min is not null
    and coalesce(c.rango_dimension, 'ancho_corte') = p_dimension
    and p_medida >= c.rango_min
    and (c.rango_max is null or p_medida <= c.rango_max)
    and (p_servicio    is null or c.servicio_sugerido    is null or c.servicio_sugerido    = p_servicio)
    and (p_herramienta is null or c.herramienta_sugerida is null or c.herramienta_sugerida = p_herramienta)
  -- Primero los que tienen precio, y dentro de ellos el rango mas ajustado:
  -- es el que describe mejor la herramienta. Un codigo a cotizar nunca se
  -- propone solo por delante de uno con importe.
  order by c.precio_a_confirmar, coalesce(c.rango_max, 99999) - c.rango_min, c.codigo;
$fn$;

comment on function public.buscar_codigo_computo is
  'Codigos de computo que cubren la medida, filtrados por servicio y herramienta. Los que estan a cotizar van al final, marcados.';


-- ─────────────────────────────────────────────────────────────────────────────
-- Los modelos de mecha de un tipo
--
-- Primera versión, corregida enseguida en la migración siguiente: agrupaba
-- cruzando el prefijo del código con la descripción y eso dejaba afuera cuatro
-- modelos reales. Se deja tal cual quedó aplicada.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.mechas_del_tipo(p_tipo text)
returns table (
  codigo text, descripcion text, medida text, precio numeric, moneda text,
  precio_pesos numeric, a_cotizar boolean
)
language sql stable security invoker
set search_path = public, pg_temp
as $fn$
  select
    c.codigo, c.descripcion, coalesce(c.medida, ''), c.precio, c.moneda,
    round(public.precio_en_pesos(c.precio, c.moneda, current_date), 2),
    c.precio_a_confirmar
  from public.vista_catalogo_vigente c
  where c.familia = 'mecha'
    and case p_tipo
      when 'bisagra'        then c.codigo like 'MB%'   and c.descripcion ilike '%bisagra%'
      when 'ciega'          then c.codigo like 'MC%'   and c.descripcion ilike '%ciega%'
      when 'pasante'        then c.codigo like 'MP%'   and c.descripcion ilike '%pasante%'
      when 'compresion'     then c.codigo like 'MIDN%'
      when 'integral_widia' then c.codigo like 'MID%'  and c.codigo not like 'MIDN%'
      else false
    end
  order by c.precio_a_confirmar, c.codigo;
$fn$;

grant execute on function public.mechas_del_tipo(text) to authenticated;
