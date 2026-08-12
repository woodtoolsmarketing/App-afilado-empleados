-- =============================================================================
-- Las mechas se agrupan por código, no por descripción
--
-- El primer intento cruzaba el prefijo con la descripción, y dejaba afuera
-- cuatro modelos que sí son del tipo pero no lo dicen en el texto:
--
--   MCARI0840  "MECHA C/AVELLANADOR IZQ. M.D."   ← su gemela derecha,
--              MCARD0840, sí dice "MECHA CIEGA C/AVELLANADOR"
--   MCDL0870   "MECHA DERECHA LASER"             ← MCDL08 dice "MECHA CIEGA
--   MCIL0570   "MECHA IZQUIERDA LASER"              DERECHA LASER"
--   MCIL0870   "MECHA IZQUIERDA LASER"
--
-- La descripción la tipeó una persona y le falta la palabra en la mitad de los
-- casos. El código es sistemático. Se agrupa por código y se excluyen a mano
-- las dos familias que comparten prefijo sin ser del tipo:
--
--   MBA…  "MECHA PARA BARRENO"  → no es bisagra
--   MCE…  "MECHA ESPECIAL"      → no es ciega
--
-- Las dos exclusiones están verificadas contra el catálogo entero: son los
-- únicos MB y MC que no pertenecen a su tipo.
--
-- Resultado: 124 modelos repartidos en ciega 50, pasante 32, bisagra 25,
-- integral 15 y compresión 2, sin ningún código en dos tipos a la vez.
-- =============================================================================

create or replace function public.mechas_del_tipo(p_tipo text)
returns table (
  codigo text, descripcion text, medida text, precio numeric, moneda text,
  precio_pesos numeric, a_cotizar boolean
)
language sql stable security invoker
set search_path = public, pg_temp
as $fn$
  select
    c.codigo, c.descripcion, coalesce(c.medida, ''), c.precio, c.moneda,
    round(public.precio_en_pesos(c.precio, c.moneda, current_date), 2),
    c.precio_a_confirmar
  from public.vista_catalogo_vigente c
  where c.familia = 'mecha'
    and case p_tipo
      when 'bisagra'        then c.codigo like 'MB%'  and c.codigo not like 'MBA%'
      when 'ciega'          then c.codigo like 'MC%'  and c.codigo not like 'MCE%'
      when 'pasante'        then c.codigo like 'MP%'
      -- MIDN es prefijo de MID: la compresion se saca antes que la integral.
      when 'compresion'     then c.codigo like 'MIDN%'
      when 'integral_widia' then c.codigo like 'MID%' and c.codigo not like 'MIDN%'
      else false
    end
  -- Los que tienen precio primero; despues por codigo, que agrupa los
  -- diametros en orden.
  order by c.precio_a_confirmar, c.codigo;
$fn$;

comment on function public.mechas_del_tipo is
  'Modelos de mecha de un tipo (bisagra, ciega, pasante, integral_widia, compresion) con su precio ya convertido a pesos. Agrupa por codigo: la descripcion de la lista no siempre nombra el tipo.';
