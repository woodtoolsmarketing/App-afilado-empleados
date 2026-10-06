-- Los cuatro codigos del mecanizado del agujero, clasificados por herramienta y
-- operacion, con el precio ya en pesos.
--
-- No se cotizan por medida: ninguno tiene rango de diametro cargado, y buscarlos
-- por medida no devuelve nada. Los elige la herramienta (sierra o fresa) y la
-- operacion (buje = achicar / agrandado = agrandar), que la app deduce de
-- comparar el agujero que la pieza tiene con el que hay que dejarle. El precio es
-- PLANO por pieza. Es el mismo mecanismo que codigos_afilado_mecha.
--
--   buje sierra circular:  6105  (BUJE DE S.C.)
--   agrandado sierra:      6103  (AGRANDAR DIAMETRO S.C.)
--   buje fresas:           7903  (BUJES DE FRESAS COMUN)
--   agrandado fresas:      7902  (AGRANDAR DIAMETRO INT. FRESA)
create or replace function public.codigos_mecanizado()
returns table (
  codigo       text,
  descripcion  text,
  precio       numeric,
  moneda       text,
  precio_pesos numeric,
  a_cotizar    boolean,
  herramienta  text,
  operacion    text
)
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
  select
    c.codigo,
    c.descripcion,
    c.precio,
    c.moneda,
    round(public.precio_en_pesos(c.precio, c.moneda, current_date), 2),
    c.precio_a_confirmar,
    t.herramienta,
    t.operacion
  from (values
    ('6105', 'sierra', 'buje'),
    ('6103', 'sierra', 'agrandado'),
    ('7903', 'fresa',  'buje'),
    ('7902', 'fresa',  'agrandado')
  ) as t(codigo, herramienta, operacion)
  join public.vista_catalogo_vigente c on c.codigo = t.codigo
  -- Primero las sierras, despues las fresas; adentro buje y agrandado.
  order by t.herramienta, t.operacion;
$function$;

comment on function public.codigos_mecanizado() is
  'Los cuatro codigos de mecanizado del agujero (buje/agrandado de sierra y fresa) con su precio en pesos. Espejo de codigos_afilado_mecha.';

grant execute on function public.codigos_mecanizado() to anon, authenticated;
