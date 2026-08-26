-- =============================================================================
-- `servicio_sugerido` estaba contestando dos preguntas distintas, y por eso
-- contestaba mal una de las dos.
--
-- Las preguntas son:
--
--   1. ¿A QUÉ TRABAJO pertenece este código? → la usa `buscar_codigo_computo`
--      para no ofrecerle a una sierra que viene a afilar los códigos de
--      reparación.
--
--   2. ¿Esto es un TRABAJO o un ARTÍCULO que se vende? → la usa el buscador de
--      la venta, que desde 20260826113939 filtra por familia.
--
-- La migración anterior contestó la 2 escribiendo en la columna de la 1: marcó
-- `servicio_sugerido = 'afilado'` en los códigos de servicio que viven en
-- familias de producto. Rompió la 1, y de la peor manera:
--
--   Un RECLAMO sobre una sierra sin fin de 50 mm resolvía SFU050AF —"AFIL.
--   TRAB. SIN FIN HASTA 50mm", $ 11.400—. Con el código marcado 'afilado', el
--   filtro `servicio_sugerido = p_servicio` lo saca de la búsqueda de
--   'reclamo', y el único candidato que queda es SFUSOL, "SOLD.SIERRA SIN FIN
--   HASTA 50mm", **$ 13.200**. El renglón se autocompletaba con el código de
--   una soldadura y ese precio, sin ningún aviso.
--
-- Un NULL en `servicio_sugerido` no significa "no es un servicio": significa
-- "sirve para cualquier trabajo", que es justo lo que tiene que seguir siendo
-- SFU050AF. Así que la 2 se muda a su propia columna.
--
-- Y de paso se completan los que faltaban: la familia `sierra_sin_fin` no
-- tiene dos servicios como decía el comentario anterior, tiene OCHO. El
-- laminado y las cinco soldaduras no empiezan con "afil" ni con "rep", que era
-- lo único que la cuenta anterior había mirado, y quedaron ofreciéndose como
-- sierras para vender: "SOLD.SSF DE 121 A 160mm — $ 39.300" entre las hojas
-- Uddeholm.
-- =============================================================================

-- ── 1. Deshacer lo que se escribió en la columna equivocada ──────────────────
--
-- Vuelven a NULL, que es como estaban: son códigos que se ofrecen para
-- cualquier trabajo. Con eso el reclamo de sierra sin fin vuelve a resolver el
-- afilado.
--
-- Se limpia la familia entera y no los 16 códigos de la lista: `afilado_general`
-- es la única familia que el clasificador por texto tocó alguna vez
-- (20260806135141 y 20260806190000 terminan las dos en `where familia =
-- 'afilado_general'`), así que todo lo que haya afuera de ella lo escribió la
-- migración anterior y no otra cosa.
update public.catalogo_articulos
   set servicio_sugerido = null
 where familia <> 'afilado_general'
   and servicio_sugerido is not null;

-- ── 2. La pregunta 2, en su propia columna ───────────────────────────────────
--
-- Generada y no escrita a mano, por el mismo motivo que `precio_a_confirmar`:
-- el cargador del catálogo importa con `resolution=ignore-duplicates`, así que
-- una lista nueva entra como fila NUEVA. Una columna común se completaría una
-- vez y se perdería en la próxima edición de la lista de precios, en silencio.
-- Calculada desde el código, la edición nueva nace con la marca puesta.
--
-- Se lista por código y no con una regla de texto porque las descripciones no
-- alcanzan, en los dos sentidos: "REPLAN CON 5 TIPOS DE PERFIL" (TD21M GB3)
-- empieza con REP y es un cabezal que se vende, y "SOLD.P/SSF POTE 30gr."
-- (SOL030) dice SOLD y es el pote de soldadura, no la soldadura. Al revés,
-- "AF X100 CUCHILLA PLANA HSS" y "PERx100 CHC DORSO RANURADO MD" son servicios
-- y no dicen "afilado" en ninguna parte.
alter table public.catalogo_articulos
  drop column if exists es_servicio;

alter table public.catalogo_articulos
  add column es_servicio boolean
  generated always as (
    familia = 'afilado_general'
    or codigo = any (array[
      -- ── Afilado de mecha, archivado en la familia `mecha` ────────────────
      '10101', '10102', '10103',
      'MEHSS010AF', 'MEHSSAF', 'MEMD005AF', 'MEMD010AF', 'MEMDBIAF', 'MEMDMAAF',
      -- ── Afilado y perfilado de cuchilla ──────────────────────────────────
      -- El rubro de la lista es "Afil.Mechas Insertos Cuchillas", así que
      -- también caen en `mecha`.
      'CHC100HSSAF', 'CHC100MDAF', 'CHCRAFHSS', 'CHCRAFMD',
      'CHCRPERHSS', 'CHCRPERMD',
      -- ── Los OCHO trabajos sobre la sierra sin fin ────────────────────────
      -- Afilado del trabado, laminado, y las cinco soldaduras por ancho.
      'SFU050AF', 'SFU090AF', 'SFULA',
      'SFUSOL', 'SFUSOL050', 'SFUSOL080', 'SFUSOL100', 'SFUSOL120'
    ])
  ) stored;

comment on column public.catalogo_articulos.es_servicio is
  'El renglon es un TRABAJO de taller, no un articulo que se venda. Distinto de servicio_sugerido, que dice a que trabajo pertenece y cuyo NULL significa "sirve para cualquiera".';

-- ── 3. La vista la devuelve, sin tirar abajo lo que cuelga de ella ───────────
--
-- `create or replace` y NO `drop ... cascade`: de la vista cuelgan
-- `buscar_articulos`, `buscar_codigo_computo`, `mechas_del_tipo` y
-- `codigos_afilado_cuchilla`, y un cascade las borra a las cuatro. Rehacerlas
-- de memoria es como se pierde una corrección: la `mechas_del_tipo` que está
-- viva lleva `not like 'MBA%'` y `not like 'MCE%'` —las barreno no son bisagras
-- y la mecha de diamante especial no es una ciega— y eso no está en el archivo
-- de la migración que la creó, sino en la siguiente.
--
-- Postgres deja agregar columnas al FINAL con `create or replace view`. Por eso
-- `es_servicio` va última y las quince de antes quedan en el mismo orden.
create or replace view public.vista_catalogo_vigente
with (security_invoker = true) as
select distinct on (codigo, coalesce(medida, ''))
  id, codigo, descripcion, medida, precio, moneda, precio_a_confirmar,
  familia, rango_min, rango_max, rango_dimension, lista_origen, lista_fecha,
  servicio_sugerido, herramienta_sugerida,
  es_servicio
from public.catalogo_articulos
order by codigo, coalesce(medida, ''),
         fecha_estimada, lista_fecha desc nulls last, creado_en desc;

-- ── 4. El buscador de la venta pregunta por la columna nueva ─────────────────
--
-- Es el único cambio de la función: antes miraba `servicio_sugerido is null`,
-- que dejaba pasar los seis trabajos de sierra sin fin.
create or replace function public.buscar_articulos(
  p_texto   text,
  p_fecha   date default current_date,
  p_limite  int default 20,
  p_familia text default null
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
  where (
      coalesce(nullif(trim(p_texto), ''), '') = ''
      or c.codigo ilike '%' || trim(p_texto) || '%'
      or c.descripcion ilike '%' || trim(p_texto) || '%'
    )
    and (p_familia is null or c.familia = p_familia)
    -- En una VENTA no se cotiza un trabajo de taller.
    and (p_familia is null or not c.es_servicio)
  order by
    (c.codigo ilike trim(p_texto)) desc,
    -- Los que no se pueden cotizar van al final: se ven, pero no estorban.
    c.precio_a_confirmar,
    c.codigo
  limit least(coalesce(p_limite, 20), 100);
$fn$;

comment on function public.buscar_articulos is
  'Articulos del catalogo vigente que coinciden con el texto. Con p_familia se limita a esa familia y se dejan afuera los trabajos de taller: es el buscador de la venta.';
