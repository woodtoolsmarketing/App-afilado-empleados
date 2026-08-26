-- =============================================================================
-- Tres cosas que decide el catálogo y que la app venía adivinando mal.
--
-- 1. "AFILADO ØEXT." es un RECTIFICADO. La lista de Administración nombra dos
--    trabajos del mismo tipo con dos palabras distintas: "RECTIFICADO DE
--    LATERAL S.C." y "AFILADO ØEXT. S.C.". El clasificador buscaba la palabra
--    "rectific", así que agarró el primero y se le escapó el segundo.
--
--    Consecuencia: al contestar "sí, reparar los dientes" el renglón pasa a
--    rectificado —los rotos se reparan y los sanos se rectifican—, la búsqueda
--    por medida no devolvía NADA, y el respaldo caía en el primer código sin
--    rango por orden alfabético: 6005, "AGREGADO RASCADOR CORTO 45mm",
--    $ 92.153,60 por diente.
--
-- 2. Un código que NOMBRA la herramienta le gana a uno genérico. Con un ancho
--    de corte de 3,1 o 3,2 el orden por rango más ajustado proponía el 8002
--    —"AFILADO DTE. CONCAVO #3 A 4mm", $ 355,50—, que es una geometría de
--    diente especial y no dice de qué herramienta es. El afilado corriente de
--    una sierra circular de esa medida es el 8001, $ 248,85. Se cotizaba un
--    43 % de más sobre el trabajo más común que entra al taller.
--
-- 3. Los códigos de SERVICIO que viven adentro de las familias de PRODUCTO.
--    La familia `mecha` tiene 181 filas y 15 son afilados de mecha o de
--    cuchilla; `sierra_sin_fin` tiene dos. Sin marcarlos, filtrar el buscador
--    de la venta por familia le ofrece al vendedor "AFILADO MECHA PASANTE DE
--    M.D." como si fuera una mecha para vender.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- El punto 3 SE CORRIGE ENTERO en 20260826140000. Dos cosas estaban mal y se
-- dejan acá tal como se aplicaron:
--
--   · `sierra_sin_fin` no tiene dos servicios, tiene OCHO. El laminado y las
--     cinco soldaduras no empiezan con "afil" ni con "rep", que era lo único
--     que había mirado la cuenta, y quedaron ofreciéndose como sierras.
--
--   · Escribir la respuesta en `servicio_sugerido` fue usar la columna
--     equivocada, y rompió la búsqueda del código de cómputo: un RECLAMO sobre
--     una sierra sin fin pasó a proponer una SOLDADURA de $ 13.200 en vez del
--     afilado de $ 11.400.
-- ─────────────────────────────────────────────────────────────────────────────
-- =============================================================================

-- ── 1. El diámetro exterior se rectifica ─────────────────────────────────────
--
-- Vale para todas las herramientas, no sólo para la sierra: el mismo trabajo
-- está en la lista como 8003/8007/8012 (S.C.), 9111 a 9120 (fresa), 9122
-- (incisor), 9302/9304 (cabezal) y 9402/9404/9406 (fresa de machimbradora).
-- La expresión es la misma con la que se contaron: 19 filas, todas ØEXT/D.EXT.
update public.catalogo_articulos
   set servicio_sugerido = 'rectificado'
 where familia = 'afilado_general'
   and descripcion ~* '(Ø|D\.?\s?)EXT';

-- ── 3. Servicios archivados en familias de producto ──────────────────────────
--
-- Se listan por código y no con una expresión sobre la descripción a propósito:
-- "REPLAN CON 5 TIPOS DE PERFIL" (TD21M GB3) empieza con "REP" y es un cabezal
-- que se vende. Son pocos y están contados; una regla de texto acá escondería
-- productos del buscador de la venta sin que nadie se entere.
update public.catalogo_articulos
   set servicio_sugerido = coalesce(servicio_sugerido, 'afilado')
 where codigo in (
   -- Afilado de mecha, archivado en la familia `mecha`.
   '10101', '10102', '10103',
   'MEHSS010AF', 'MEHSSAF', 'MEMD005AF', 'MEMD010AF', 'MEMDBIAF', 'MEMDMAAF',
   -- Afilado y perfilado de cuchilla: el rubro de la lista es
   -- "Afil.Mechas Insertos Cuchillas", así que también caen en `mecha`.
   'CHC100HSSAF', 'CHC100MDAF', 'CHCRAFHSS', 'CHCRAFMD',
   'CHCRPERHSS', 'CHCRPERMD',
   -- Afilado del trabado de la sierra sin fin.
   'SFU050AF', 'SFU090AF'
 );

-- ── 2. El código que nombra la herramienta va primero ────────────────────────
--
-- Sólo dos códigos del catálogo tienen rango y NO dicen de qué herramienta son
-- —8002 y 8006, los de diente cóncavo—, así que este orden mueve exactamente
-- esos dos y nada más. Siguen apareciendo en la lista: el vendedor los elige
-- cuando la pieza de verdad tiene el diente cóncavo.
create or replace function public.buscar_codigo_computo(
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
  order by
    -- Primero los que tienen precio: uno a cotizar no se propone solo por
    -- delante de uno con importe.
    c.precio_a_confirmar,
    -- Después el que NOMBRA la herramienta. El filtro de arriba ya dejó pasar
    -- sólo los que coinciden o los que no dicen nada, así que "no es nulo"
    -- significa "es de esta herramienta".
    (c.herramienta_sugerida is null),
    -- Y recién ahí el rango más ajustado, que describe mejor la medida.
    coalesce(c.rango_max, 99999) - c.rango_min,
    c.codigo;
$fn$;

comment on function public.buscar_codigo_computo is
  'Codigos de computo que cubren la medida, filtrados por servicio y herramienta. Primero los que tienen precio, despues los que nombran la herramienta, despues el rango mas ajustado.';


-- ── El buscador de la venta filtra por familia ───────────────────────────────
--
-- Elegir "MECHA" en QUÉ SE VENDE y tener que tipear igual para que aparezcan
-- las mechas era pedirle al vendedor que supiera de memoria cómo las nombra la
-- lista. Con la familia puesta, el buscador arranca mostrando lo que hay.
--
-- `p_familia` es opcional: sin ella la función se comporta igual que antes, que
-- es lo que necesita el botón de "ver toda la lista" cuando el artículo está
-- archivado en otra familia —una muela, un bidón de resinol, un pote de
-- soldadura—.
--
-- Los códigos de servicio quedan afuera: en una VENTA no se cotiza un afilado.
--
-- Se BORRA la de tres parámetros antes de crear la de cuatro. `create or
-- replace` con una firma distinta no reemplaza: deja las dos, y como la nueva
-- trae `p_familia` con default, llamarla con tres argumentos pasa a ser
-- ambiguo y PostgREST devuelve error en vez de artículos.
drop function if exists public.buscar_articulos(text, date, int);

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
    and (p_familia is null or c.servicio_sugerido is null)
  order by
    (c.codigo ilike trim(p_texto)) desc,
    -- Los que no se pueden cotizar van al final: se ven, pero no estorban.
    c.precio_a_confirmar,
    c.codigo
  limit least(coalesce(p_limite, 20), 100);
$fn$;

comment on function public.buscar_articulos is
  'Articulos del catalogo vigente que coinciden con el texto. Con p_familia se limita a esa familia y se dejan afuera los codigos de servicio: es el buscador de la venta.';

grant execute on function public.buscar_articulos(text, date, int, text) to authenticated;
