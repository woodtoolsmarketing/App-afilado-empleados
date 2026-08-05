-- =============================================================================
-- WoodTools · Paso 2
-- Artículos a confirmar: los completa Administración a mano
--
-- Dos casos distintos que se arreglan igual:
--   · precio 0,00 — la lista los trae así (discontinuados o "a consultar")
--   · sin moneda declarada — el PDF no dice si es en pesos o en dólares.
--     Es el caso de MUELAS: tiene precio, pero cotizarlo sin saber la moneda
--     puede errar por un factor de mil.
--
-- Mientras estén acá, el vendedor no los ve en el buscador: preferimos que
-- falte un artículo a que salga un precio inventado en una nota de pedido.
-- =============================================================================

create or replace function public.completar_articulo(
  p_codigo text,
  p_precio numeric,
  p_moneda text
)
returns public.catalogo_articulos
language plpgsql security invoker
set search_path = public, pg_temp
as $fn$
declare
  objetivo uuid;
  fila     public.catalogo_articulos;
begin
  if not interno.es_administracion() then
    raise exception 'Sólo el Dpto. de Administración puede completar precios del catálogo'
      using errcode = '42501';
  end if;

  if p_moneda not in ('ARS', 'USD') then
    raise exception 'La moneda tiene que ser ARS o USD' using errcode = '23514';
  end if;

  if p_precio is null or p_precio <= 0 then
    raise exception 'El precio tiene que ser mayor a cero' using errcode = '23514';
  end if;

  -- Se escribe sobre la edición vigente del código (la de la lista más nueva),
  -- que es la que lee la app.
  select id into objetivo
    from public.catalogo_articulos
   where codigo = p_codigo
   order by lista_fecha desc, creado_en desc
   limit 1;

  if objetivo is null then
    raise exception 'No existe el artículo %', p_codigo using errcode = 'P0002';
  end if;

  update public.catalogo_articulos
     set precio = p_precio, moneda = p_moneda
   where id = objetivo
  returning * into fila;

  insert into public.auditoria (actor_id, accion, entidad, entidad_id, datos)
  values (auth.uid(), 'catalogo.precio_completado', 'catalogo_articulos', p_codigo,
          jsonb_build_object('precio', p_precio, 'moneda', p_moneda));

  return fila;
end;
$fn$;


create or replace function public.articulos_a_confirmar()
returns table (
  codigo text, descripcion text, medida text, precio numeric,
  moneda text, familia text, lista_origen text, lista_fecha date, motivo text
)
language sql stable security invoker
set search_path = public, pg_temp
as $fn$
  select
    c.codigo, c.descripcion, c.medida, c.precio, c.moneda,
    c.familia, c.lista_origen, c.lista_fecha,
    case
      when c.precio = 0 and c.moneda is null then 'Sin precio y sin moneda declarada'
      when c.precio = 0                      then 'La lista lo trae en 0,00'
      else 'La lista no declara si es en pesos o en dólares'
    end
  from public.vista_catalogo_vigente c
  where c.precio_a_confirmar
  order by c.familia, c.codigo;
$fn$;

comment on function public.articulos_a_confirmar is
  'Artículos que la app no cotiza: sin precio o sin moneda declarada. Administración los completa desde el panel.';
