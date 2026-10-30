-- =============================================================================
-- WoodTools · stock: una fila por codigo (no por medida)
--
-- vista_stock salia de vista_catalogo_vigente, que es `distinct on (codigo,
-- medida)`, asi que los ~15 codigos vendibles con varias medidas aparecian
-- DUPLICADOS, cada fila con el MISMO stock (el stock es por codigo). En la
-- pagina eso daba dos filas con la misma key de React y dos inputs que escriben
-- el mismo registro (last-write-wins silencioso). Como el stock ES por codigo,
-- la vista colapsa a UNA fila por codigo (muestra la medida de la lista mas
-- nueva, solo a titulo informativo).
-- =============================================================================

create or replace view public.vista_stock with (security_invoker = true) as
  select distinct on (v.codigo)
    v.codigo,
    v.descripcion,
    v.medida,
    v.familia,
    v.precio,
    v.moneda,
    v.precio_a_confirmar,
    coalesce(s.cantidad, 0) as stock,
    s.actualizado_en        as stock_actualizado_en
  from public.vista_catalogo_vigente v
  left join public.stock_articulos s on s.codigo = v.codigo
  where v.es_servicio = false
  order by v.codigo, v.lista_fecha desc nulls last, coalesce(v.medida, '');

comment on view public.vista_stock is
  'Productos vendibles del catalogo vigente (es_servicio=false) con su stock (0 si no se cargo), UNA fila por codigo (el stock es por codigo; la medida que se muestra es la de la lista mas nueva).';
