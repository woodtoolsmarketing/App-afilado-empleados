-- =============================================================================
-- Los nueve codigos de afilado de mecha, clasificados por lo que los elige.
--
-- ── Que estaba pasando ──────────────────────────────────────────────────────
--
-- Que no habia forma de llegar a ellos. La app, para afilar una mecha, usaba la
-- RPC `mechas_del_tipo`, que devuelve el catalogo de PRODUCTO: codigos MPD04,
-- MCD05, MBD15, con el precio de comprar la mecha nueva y en dolares. Ese
-- codigo y ese precio terminaban en el renglon de afilado.
--
-- Con la cotizacion de hoy, afilar una pasante de 4 mm salia $ 31.406,10 —lo
-- que sale la mecha— en vez de $ 10.528, que es lo que dice la lista de
-- afilado. Una integral de tres filos salia $ 202.236,25 en vez de $ 39.764,50.
--
-- ── Como se elige el codigo ─────────────────────────────────────────────────
--
-- No por medida: ninguno de los nueve tiene rango de diametro cargado, y
-- buscarlos por medida no devolvia nada. Los eligen dos respuestas, y una
-- tercera en las integrales:
--
--   tipo de mecha  ·  material (HSS o metal duro)  ·  filos (2, 3 o 4)
--
-- El material es el que parte la tabla: en HSS toda la linea se afila al mismo
-- precio; en metal duro va de $ 10.528 a $ 47.480 segun el tipo.
--
-- Es el mismo mecanismo de `codigos_afilado_cuchilla`, y esta copiado de ahi a
-- proposito: ya funciona y el vendedor ya lo conoce.
--
-- ── De donde sale la clasificacion ──────────────────────────────────────────
--
-- De la descripcion de cada codigo en la LISTA PRECIO AFIL MEHAS del
-- 02/06/2026, sub-rubros 030 y 031. No se dedujo nada: cada uno dice de que
-- mecha habla.
--
--   MEHSS010AF  AFILADO DE MECHA HSS                  -> HSS, cualquier tipo
--   MEHSSAF     AFILADO MECHA ASS                     -> idem, mismo precio
--   MEMD005AF   AFIL. MECHA CIEGA M.D.                -> ciega, metal duro
--   MEMD010AF   AFILADO MECHA PASANTE DE M.D.         -> pasante, metal duro
--   MEMDBIAF    AFIL.MECHA P/BISAGRA M.D.             -> bisagra, metal duro
--   MEMDMAAF    AFIL.MECHA MALLET. M.D. 10/20         -> malletadora, metal duro
--   10101/2/3   Afilado Mecha Integral MD Z=2 / 3 / 4 -> integral, por filos
--
-- El "MALLET." de MEMDMAAF es MALLETADORA: lo dice el Catalogo General en la
-- pagina 23, cuando presenta la linea como "mechas en HSS y HM para bisagra,
-- agujeros ciegos, pasantes, malletadoras y mandriles". El "10/20" es el rango
-- de diametro en milimetros, no el cabo.
--
-- ── Lo que queda para que confirme la oficina ───────────────────────────────
--
-- MEHSS010AF y MEHSSAF tienen el mismo precio y dicen lo mismo, salvo que el
-- segundo escribe "ASS" donde el primero dice "HSS". Parecen el mismo servicio
-- cargado dos veces. La funcion devuelve los dos —esconder un codigo que la
-- oficina factura seria peor— pero la app propone el primero, que es el que
-- esta bien escrito.
-- =============================================================================

create or replace function public.codigos_afilado_mecha()
returns table (
  codigo       text,
  descripcion  text,
  precio       numeric,
  moneda       text,
  precio_pesos numeric,
  a_cotizar    boolean,
  material     text,
  tipos        text[],
  dientes      smallint
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
    t.material,
    t.tipos,
    t.dientes
  from (values
    -- En HSS no importa el tipo: `tipos` en null quiere decir "cualquiera".
    ('MEHSS010AF', 'hss', null::text[],                                              null::smallint),
    ('MEHSSAF',    'hss', null::text[],                                              null::smallint),
    ('MEMD005AF',  'md',  array['ciega'],                                            null::smallint),
    ('MEMD010AF',  'md',  array['pasante'],                                          null::smallint),
    ('MEMDBIAF',   'md',  array['bisagra'],                                          null::smallint),
    ('MEMDMAAF',   'md',  array['malletadora'],                                      null::smallint),
    ('10101',      'md',  array['integral_widia','compresion','caja_cerradura'],      2::smallint),
    ('10102',      'md',  array['integral_widia','compresion','caja_cerradura'],      3::smallint),
    ('10103',      'md',  array['integral_widia','compresion','caja_cerradura'],      4::smallint)
  ) as t(codigo, material, tipos, dientes)
  join public.vista_catalogo_vigente c on c.codigo = t.codigo
  -- Primero el HSS, que es el caso simple; despues el metal duro por tipo, y
  -- las integrales al final en orden de filos.
  order by t.material, coalesce(t.dientes, 0), c.codigo;
$function$;

comment on function public.codigos_afilado_mecha() is
  'Los codigos de afilado de mecha con lo que los elige: material, tipos que cubre y filos. Espejo de codigos_afilado_cuchilla.';

grant execute on function public.codigos_afilado_mecha() to anon, authenticated;

-- ── Que estos nueve son de AFILAR una MECHA queda escrito ───────────────────
--
-- Estaba en null en los quince codigos de la lista, y por eso `codigosSinRango`
-- para una mecha devolvia la familia entera ordenada por codigo: mandriles,
-- pinzas, mechas de router y los seis codigos de afilado de CUCHILLA, todos
-- mezclados como si fueran opciones para afilar una mecha.
-- OJO: la primera version de esta migracion escribia tambien
-- `servicio_sugerido = 'afilado'`, y eso estaba mal. Lo deshace la migracion
-- siguiente, que explica por que: un NULL ahi significa "sirve para cualquier
-- trabajo", y ponerle 'afilado' dejaba un RECLAMO sobre una mecha con cero
-- codigos. Se deja escrito para que no se vuelva a intentar.
update public.catalogo_articulos set
  herramienta_sugerida = 'mecha'
where codigo in ('MEHSS010AF','MEHSSAF','MEMD005AF','MEMD010AF','MEMDBIAF','MEMDMAAF',
                 '10101','10102','10103');

-- Los seis CHC* vienen en la misma lista de precios —el rubro se llama
-- "Afil.Mechas Insertos Cuchillas"— y por eso quedaron con familia 'mecha'. La
-- familia no se toca: `codigos_afilado_cuchilla` los busca por codigo y moverlos
-- de familia la dejaria vacia. Lo que se escribe es de que herramienta son, que
-- es lo que los saca de la lista de una mecha.
update public.catalogo_articulos set
  herramienta_sugerida = 'cuchilla'
where codigo in ('CHC100HSSAF','CHC100MDAF','CHCRAFHSS','CHCRAFMD','CHCRPERHSS','CHCRPERMD');
