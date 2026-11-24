-- =============================================================================
-- Zona del Gestión por cliente (fuente de verdad para la zona de la nota).
--
-- Hasta ahora la zona de la nota se DEDUCÍA de la dirección (text-matching de la
-- localidad contra listas en packages/compartido/src/zonas.ts). Eso erraba en
-- muchos casos: no subdivide CABA, confunde Tres de Febrero con la zona Norte,
-- y falla con localidades ambiguas o faltantes. Pero el Gestión YA tiene la zona
-- correcta de cada cliente: venía en el padrón como texto (p.ej. "ZONA OESTE",
-- "R5 VEDIA, JUNIN, LOS TOLDOS") y el importador la guardaba en clientes.notas
-- como "Zona (Gestión): ...".
--
-- Esta migración:
--   1. Agrega clientes.zona (el código numérico de zonas.ts, p.ej. "107").
--   2. Agrega interno.codigo_zona_desde_gestion(texto): mapea el texto del
--      Gestión al código. Tolera los truncados del export y deja SIN zona a las
--      categorías no geográficas (WEB, EXTERIOR, REVENDEDORES, "NO EXISTEN MAS")
--      y a los textos ambiguos, que caen al respaldo (la deducción por dirección).
--
-- El backfill de los clientes existentes, el cambio del importador y el uso en la
-- app van aparte. La app usará clientes.zona como fuente de verdad; la deducción
-- por texto queda sólo de respaldo para clientes sin zona del Gestión.
-- =============================================================================

alter table public.clientes add column if not exists zona text;

comment on column public.clientes.zona is
  'Código de zona de venta (ver packages/compartido/src/zonas.ts), tomado del Gestión. Fuente de verdad para la zona de la nota; si es null, la app deduce la zona de la dirección.';


-- Texto del Gestión -> código numérico de la planilla. IMMUTABLE y pura: no toca
-- tablas, sólo normaliza y matchea por prefijo (tolera los truncados del export).
create or replace function interno.codigo_zona_desde_gestion(txt text)
returns text
language plpgsql
immutable
as $function$
declare
  t text := upper(trim(regexp_replace(coalesce(txt, ''), '\s+', ' ', 'g')));
begin
  return case
    when t like 'ZONA CAPITAL%'      then '110'
    when t like 'ZONA NORTE%'        then '101'
    when t like 'ZONA OESTE%'        then '107'
    when t like 'ZONA SUR TITULAR%'  then '104'  -- Lanús / Lomas / Alte. Brown
    when t like 'ZONA SUR MITRE%'    then '102'  -- Avellaneda / Quilmes
    when t like 'ZONA LA PLATA%'     then '103'
    when t like 'CORDOBA%'           then '137'
    when t like 'RIO IV%'            then '137'
    when t like 'LITORAL%'           then '150'
    when t like 'ER,%' or t like 'ER.%' or t like 'ER %' then '136'
    when t like 'SALTA%'             then '146'
    when t like 'CHACO%'             then '151'
    when t like 'MDZA%'              then '126'
    when t like 'R5%'                then '130'
    when t like 'SANTA FE. C GOMEZ%' then '121'
    when t like 'SANTA FE%'          then '121'
    when t like 'ROSARIO%'           then '142'
    when t like 'SA ARECO%'          then '140'
    when t like 'CHIVILCOY%'         then '140'
    when t like 'EL VALLE%'          then '148'
    when t like 'MDP%'               then '122'
    when t like 'BB.%' or t like 'BB %' or t like 'BB-%' then '132'
    when t like 'BARILOCHE-ZAPALA%'  then '152'
    when t = 'BARILOCHE'             then '154'
    when t like 'PILAR%'             then '141'
    when t like 'ESPERANZA%'         then '149'
    when t like 'PARANA%'            then '143'
    when t like 'RTA2%'              then '120'
    when t like 'PTO MADRYN%'        then '147'
    when t like 'SM DEL MONTE%'      then '115'
    when t like 'CAÑUELAS%'          then '116'
    else null  -- WEB, EXTERIOR, REVENDEDORES, "NO EXISTEN MAS" y truncados ambiguos
  end;
end;
$function$;

comment on function interno.codigo_zona_desde_gestion(text) is
  'Texto de zona del Gestión (p.ej. "ZONA OESTE", "R5 VEDIA, JUNIN, LOS TOLDOS") -> código numérico de zonas.ts. Tolera truncados del export; devuelve null para categorías no geográficas.';
