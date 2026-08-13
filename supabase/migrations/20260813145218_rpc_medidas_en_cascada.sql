-- ─────────────────────────────────────────────────────────────────────────────
-- La cascada de medidas
--
-- Se le pasa la herramienta y lo que el vendedor ya eligió; devuelve, para cada
-- campo que queda, SÓLO los valores que siguen dando resultados. Elegido
-- D=300 mm, la lista de dientes deja de ofrecer 24 y ofrece los que existen con
-- ese diámetro. Es literalmente el filtro que hasta ahora hacía el vendedor de
-- memoria, y que cuando fallaba dejaba el renglón sin código de cómputo.
--
-- **Sin orden fijo, a propósito.** El vendedor a veces se acuerda del diámetro
-- y a veces de los dientes. Cualquier campo que complete achica todos los
-- demás; obligarlo a empezar por uno sería obligarlo a saber cuál.
--
-- Devuelve tres cosas en una sola ida al servidor —importa, porque esto corre
-- en la calle con datos móviles—: cuántos códigos quedan, qué valores siguen
-- siendo posibles en cada campo, y cuáles son esos códigos con su precio.
-- El precio sale de `vista_catalogo_vigente`, que es la lista del Gestión
-- Comercial: las medidas son del catálogo técnico, los importes no.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.medidas_en_cascada(
  p_herramienta text,
  p_filtros     jsonb default '{}'::jsonb,
  p_limite      integer default 30
)
returns jsonb
language sql
stable
security invoker
set search_path to 'public', 'pg_temp'
as $$
with f as (
  select
    (p_filtros->>'diametro_exterior')::numeric as diametro_exterior,
    (p_filtros->>'ancho_corte')::numeric       as ancho_corte,
    (p_filtros->>'diametro_interior')::numeric as diametro_interior,
    (p_filtros->>'cantidad_dientes')::numeric  as cantidad_dientes,
    (p_filtros->>'largo')::numeric             as largo,
    (p_filtros->>'ancho')::numeric             as ancho,
    (p_filtros->>'espesor')::numeric           as espesor,
    (p_filtros->>'paso')::numeric              as paso,
    (p_filtros->>'diametro')::numeric          as diametro,
    (p_filtros->>'largo_total')::numeric       as largo_total,
    (p_filtros->>'largo_util')::numeric        as largo_util,
    (p_filtros->>'cabo')::numeric              as cabo,
    nullif(p_filtros->>'mano', '')             as mano,
    nullif(p_filtros->>'geometria', '')        as geometria
),
base as (
  select m.*
    from public.catalogo_medidas m, f
   where m.herramienta = p_herramienta
     and (f.diametro_exterior is null or m.diametro_exterior = f.diametro_exterior)
     -- El ancho de corte de una incisora regulable es un rango: pedir 5,0 mm
     -- exactos a una que se regula de 4,5 a 5,7 no devolvería la que sirve.
     and (f.ancho_corte is null
          or m.ancho_corte = f.ancho_corte
          or (m.ancho_corte_min is not null and m.ancho_corte_max is not null
              and f.ancho_corte between m.ancho_corte_min and m.ancho_corte_max))
     and (f.diametro_interior is null or m.diametro_interior = f.diametro_interior)
     and (f.cantidad_dientes  is null or m.cantidad_dientes  = f.cantidad_dientes)
     and (f.largo             is null or m.largo             = f.largo)
     and (f.ancho             is null or m.ancho             = f.ancho)
     and (f.espesor           is null or m.espesor           = f.espesor)
     and (f.paso              is null or m.paso              = f.paso)
     and (f.diametro          is null or m.diametro          = f.diametro)
     and (f.largo_total       is null or m.largo_total       = f.largo_total)
     and (f.largo_util        is null or m.largo_util        = f.largo_util)
     and (f.cabo              is null or m.cabo              = f.cabo)
     and (f.mano              is null or m.mano              = f.mano)
     and (f.geometria         is null or m.geometria         = f.geometria)
),
numericas as (
             select 'diametro_exterior'::text campo, diametro_exterior valor from base where diametro_exterior is not null
  union all  select 'ancho_corte',              ancho_corte              from base where ancho_corte is not null
  union all  select 'diametro_interior',        diametro_interior        from base where diametro_interior is not null
  union all  select 'cantidad_dientes',         cantidad_dientes::numeric from base where cantidad_dientes is not null
  union all  select 'largo',                    largo                    from base where largo is not null
  union all  select 'ancho',                    ancho                    from base where ancho is not null
  union all  select 'espesor',                  espesor                  from base where espesor is not null
  union all  select 'paso',                     paso                     from base where paso is not null
  union all  select 'diametro',                 diametro                 from base where diametro is not null
  union all  select 'largo_total',              largo_total              from base where largo_total is not null
  union all  select 'largo_util',               largo_util               from base where largo_util is not null
  union all  select 'cabo',                     cabo                     from base where cabo is not null
),
textuales as (
             select 'mano'::text campo, mano valor from base where mano is not null
  union all  select 'geometria',        geometria  from base where geometria is not null
),
opciones as (
  select campo, jsonb_agg(jsonb_build_object('valor', valor, 'cantidad', c) order by valor) as v
    from (select campo, valor, count(*) c from numericas group by 1, 2) n
   group by campo
  union all
  select campo, jsonb_agg(jsonb_build_object('valor', valor, 'cantidad', c) order by valor)
    from (select campo, valor, count(*) c from textuales group by 1, 2) t
   group by campo
),
articulos as (
  select jsonb_strip_nulls(jsonb_build_object(
           'codigo',            b.codigo,
           'descripcion',       coalesce(c.descripcion, b.familia_descripcion),
           'marca',             b.marca,
           'subrubro_nombre',   b.subrubro_nombre,
           'notas',             b.notas,
           'mano',              b.mano,
           'geometria',         b.geometria,
           'diametro_exterior', b.diametro_exterior,
           'ancho_corte',       b.ancho_corte,
           'ancho_corte_min',   b.ancho_corte_min,
           'ancho_corte_max',   b.ancho_corte_max,
           'cuerpo',            b.cuerpo,
           'diametro_interior', b.diametro_interior,
           'cantidad_dientes',  b.cantidad_dientes,
           'largo',             b.largo,
           'ancho',             b.ancho,
           'espesor',           b.espesor,
           'paso',              b.paso,
           'diametro',          b.diametro,
           'largo_total',       b.largo_total,
           'largo_util',        b.largo_util,
           'cabo',              b.cabo,
           'precio',            c.precio,
           'moneda',            c.moneda,
           'a_cotizar',         c.precio_a_confirmar
         )) as a
    from base b
    left join public.vista_catalogo_vigente c on c.codigo = b.codigo
   order by b.codigo
   limit greatest(coalesce(p_limite, 30), 1)
)
select jsonb_build_object(
  'total',     (select count(*) from base),
  'opciones',  coalesce((select jsonb_object_agg(campo, v) from opciones), '{}'::jsonb),
  'articulos', coalesce((select jsonb_agg(a) from articulos), '[]'::jsonb)
);
$$;

comment on function public.medidas_en_cascada(text, jsonb, integer) is
  'Para la herramienta y los filtros dados: cuantos codigos quedan, que valores siguen siendo posibles en cada campo, y los articulos con su precio.';

revoke all on function public.medidas_en_cascada(text, jsonb, integer) from public;
grant execute on function public.medidas_en_cascada(text, jsonb, integer) to authenticated;
