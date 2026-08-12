-- =============================================================================
-- El afilado de cuchillas
--
-- Los seis códigos vienen de la lista "AFIL MECHAS", cuyo rubro 003 es
-- "Afil.Mechas Insertos Cuchillas". El importador los archivó con familia
-- `mecha`, así que hoy son inalcanzables: al cargar una cuchilla la app busca
-- en la familia `cuchilla`, que son 143 artículos de PRODUCTO —el catálogo de
-- lo que se vende— y no de servicio.
--
-- No se toca la familia: la fila es la que trajo la lista y moverla haría que
-- la próxima importación la vuelva a poner donde estaba. Se los expone por su
-- código, que es lo estable.
--
-- Qué distingue a uno de otro son tres cosas, y ninguna es una medida:
--
--   tipo      plana  /  dorso ranurado
--   material  HSS    /  M.D.
--   trabajo   afilado /  perfilado      ← el perfilado sólo existe en ranurado
--
-- El largo NO elige el código: multiplica. Los precios son "x100", por cada
-- 100 mm de cuchilla, y así lo dice la descripción de la propia lista.
-- =============================================================================

create or replace function public.codigos_afilado_cuchilla()
returns table (
  codigo text, descripcion text, precio numeric, moneda text,
  precio_pesos numeric, a_cotizar boolean,
  tipo text, material text, trabajo text
)
language sql stable security invoker
set search_path = public, pg_temp
as $fn$
  select
    c.codigo, c.descripcion, c.precio, c.moneda,
    round(public.precio_en_pesos(c.precio, c.moneda, current_date), 2),
    c.precio_a_confirmar,
    case when c.codigo like 'CHCR%' then 'dorso_ranurado' else 'plana' end,
    case when c.codigo like '%MD%'  then 'md'             else 'hss'   end,
    case when c.codigo like '%PER%' then 'perfilado'      else 'afilado' end
  from public.vista_catalogo_vigente c
  where c.codigo in (
    'CHC100HSSAF', 'CHC100MDAF',
    'CHCRAFHSS',   'CHCRAFMD',
    'CHCRPERHSS',  'CHCRPERMD'
  )
  order by 7, 9, 8;
$fn$;

comment on function public.codigos_afilado_cuchilla is
  'Los seis codigos de afilado de cuchilla, clasificados por tipo, material y trabajo. El precio es por cada 100 mm de largo.';

grant execute on function public.codigos_afilado_cuchilla() to authenticated;
