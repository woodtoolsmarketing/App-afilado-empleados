-- =============================================================================
-- WoodTools · Paso 2
-- Rangos de medida, conversión de moneda y búsqueda del código de cómputo
--
-- Reglas confirmadas con el cliente:
--   · Los precios en dólares se convierten: precio × tipo de cambio = pesos.
--   · Los artículos sin precio NO se le ofrecen al vendedor. Quedan visibles
--     para que Administración les cargue el precio a mano desde el panel.
--   · "#3 A 4mm" es el rango de ancho de corte en milímetros, y de ahí sale el
--     código de cómputo.
-- =============================================================================

alter table public.catalogo_articulos
  add column if not exists rango_min       numeric(10,2),
  add column if not exists rango_max       numeric(10,2),
  -- Qué dimensión mide el rango. "d=150" habla de diámetro, no de ancho de
  -- corte: confundirlos elegiría el código de otra herramienta.
  add column if not exists rango_dimension text;

create index if not exists catalogo_rango_idx
  on public.catalogo_articulos (familia, rango_dimension, rango_min, rango_max)
  where rango_min is not null;

comment on column public.catalogo_articulos.rango_min is
  'Límite inferior de la medida que cubre el código. NULL si la lista no expresa un rango confiable.';
comment on column public.catalogo_articulos.rango_dimension is
  'ancho_corte o diametro. Determina contra qué medida del formulario se compara.';

drop view if exists public.vista_catalogo_vigente;
create view public.vista_catalogo_vigente
with (security_invoker = true) as
select distinct on (codigo)
  id, codigo, descripcion, medida, precio, moneda, precio_a_confirmar,
  familia, rango_min, rango_max, rango_dimension, lista_origen, lista_fecha
from public.catalogo_articulos
order by codigo, lista_fecha desc, creado_en desc;


-- ─────────────────────────────────────────────────────────────────────────────
-- Conversión a pesos
--
-- Se usa la cotización del día de la nota, no la de hoy: una nota de la semana
-- pasada tiene que poder reimprimirse con el tipo de cambio que se le cotizó al
-- cliente, no con el de la reimpresión.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.precio_en_pesos(
  p_precio numeric,
  p_moneda text,
  p_fecha  date default current_date
)
returns numeric
language sql stable security invoker
set search_path = public, pg_temp
as $fn$
  select case
    when p_precio is null or p_moneda is null then null
    when p_moneda = 'ARS' then p_precio
    -- Sin cotización cargada devuelve NULL a propósito: es preferible que la
    -- app avise "falta la cotización" a que cotice con un valor inventado.
    else p_precio * (
      select venta from public.cotizaciones
       where fecha <= p_fecha
       order by fecha desc
       limit 1
    )
  end;
$fn$;


-- ─────────────────────────────────────────────────────────────────────────────
-- Búsqueda del código de cómputo por medida
--
-- Devuelve los códigos cuyo rango contiene la medida, del más ajustado al más
-- amplio. Excluye los que no tienen precio.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.buscar_codigo_computo(
  p_familia   text,
  p_medida    numeric,
  p_dimension text default 'ancho_corte',
  p_fecha     date default current_date
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
  -- El rango más ajustado primero: es el que describe mejor la herramienta.
  order by coalesce(c.rango_max, 99999) - c.rango_min, c.codigo;
$fn$;

comment on function public.buscar_codigo_computo is
  'Códigos de cómputo cuyo rango cubre la medida dada, del más ajustado al más amplio, con el precio ya convertido a pesos.';


-- Búsqueda por texto, para cuando el vendedor prefiere tipear el código.
create or replace function public.buscar_articulos(
  p_texto  text,
  p_fecha  date default current_date,
  p_limite int default 20
)
returns table (
  codigo text, descripcion text, medida text, precio numeric, moneda text,
  precio_pesos numeric, familia text, sin_precio boolean
)
language sql stable security invoker
set search_path = public, pg_temp
as $fn$
  select
    c.codigo, c.descripcion, c.medida, c.precio, c.moneda,
    round(public.precio_en_pesos(c.precio, c.moneda, p_fecha), 2),
    c.familia, c.precio_a_confirmar
  from public.vista_catalogo_vigente c
  where coalesce(nullif(trim(p_texto), ''), '') = ''
     or c.codigo ilike '%' || trim(p_texto) || '%'
     or c.descripcion ilike '%' || trim(p_texto) || '%'
  order by
    (c.codigo ilike trim(p_texto)) desc,
    -- Los que no se pueden cotizar van al final: se ven, pero no estorban.
    c.precio_a_confirmar,
    c.codigo
  limit least(coalesce(p_limite, 20), 100);
$fn$;


-- ─────────────────────────────────────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.catalogo_articulos enable row level security;

create policy catalogo_leer on public.catalogo_articulos
  for select to authenticated
  using (interno.esta_habilitado());

create policy catalogo_admin on public.catalogo_articulos
  for all to authenticated
  using (interno.es_admin())
  with check (interno.es_admin());

alter table public.cotizaciones enable row level security;

create policy cotizaciones_leer on public.cotizaciones
  for select to authenticated
  using (interno.esta_habilitado());

create policy cotizaciones_admin on public.cotizaciones
  for all to authenticated
  using (interno.es_admin())
  with check (interno.es_admin());
