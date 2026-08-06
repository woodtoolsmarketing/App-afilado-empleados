-- =============================================================================
-- El código de cómputo depende del SERVICIO y de la HERRAMIENTA, no sólo de la
-- medida.
--
-- La familia `afilado_general` mezcla las dos cosas: los códigos 6xxx/77xx son
-- REPARACIÓN y los 8xxx/91xx son AFILADO, y adentro de cada grupo hay unos de
-- sierra y otros de fresa. El buscador filtraba sólo por familia y medida, así
-- que a una sierra para afilar le ofrecía primero "REP.PARCIAL DTE. S.C." y
-- llegaba a proponerle el código de una FRESA.
--
-- La lista no trae esos datos en columnas: están en el texto de la descripción.
-- Se clasifican una vez acá, quedan a la vista en la tabla, y Administración
-- puede corregir a mano lo que haga falta.
-- =============================================================================

alter table public.catalogo_articulos
  add column if not exists servicio_sugerido    text,
  add column if not exists herramienta_sugerida text;

comment on column public.catalogo_articulos.servicio_sugerido is
  'afilado / reparacion / rectificado / hermanado / rebaje, deducido de la descripción. NULL = no se pudo deducir y el artículo se ofrece para cualquier servicio.';
comment on column public.catalogo_articulos.herramienta_sugerida is
  'sierra / fresa / cabezal / incisor, deducido de la descripción. NULL = se ofrece para cualquier herramienta.';

update public.catalogo_articulos set
  servicio_sugerido = case
    when descripcion ~* '^(afil|afilado)' then 'afilado'
    when descripcion ~* '^rep'            then 'reparacion'
    when descripcion ~* 'rectific'        then 'rectificado'
    when descripcion ~* 'herman'          then 'hermanado'
    when descripcion ~* 'rebaj'           then 'rebaje'
  end,
  herramienta_sugerida = case
    -- "SIERRA" sin exigir final de palabra, para que entre "SIERRAS".
    when descripcion ~* '(^|[^A-Z])(S\.?C\.?([^A-Z]|$)|SIERRA)'   then 'sierra'
    when descripcion ~* 'FRESA|(^|[^A-Z])FR\.'                    then 'fresa'
    when descripcion ~* 'INCISOR'                                 then 'incisor'
    when descripcion ~* '(^|[^A-Z])CB([^A-Z]|$)|CABEZAL'          then 'cabezal'
  end
where familia = 'afilado_general';

create index if not exists catalogo_servicio_herramienta_idx
  on public.catalogo_articulos (familia, servicio_sugerido, herramienta_sugerida)
  where rango_min is not null;

drop view if exists public.vista_catalogo_vigente cascade;
create view public.vista_catalogo_vigente
with (security_invoker = true) as
select distinct on (codigo)
  id, codigo, descripcion, medida, precio, moneda, precio_a_confirmar,
  familia, rango_min, rango_max, rango_dimension, lista_origen, lista_fecha,
  servicio_sugerido, herramienta_sugerida
from public.catalogo_articulos
order by codigo, lista_fecha desc, creado_en desc;
