-- =============================================================================
-- WoodTools · Paso 2
-- Moneda del catálogo y artículos que no se pueden cotizar
--
-- Hallazgo al importar las listas: **10 de las 19 están en dólares**, no en
-- pesos. El encabezado de cada PDF lo declara ("Precios sin I.V.A. En Dolares")
-- y el extractor ahora lo lee de ahí.
--
-- Por eso `moneda` deja de tener default y pasa a ser nullable: un 'ARS'
-- silencioso cotizaría una cuchilla de USD 11,63 como $11,63 — tres órdenes de
-- magnitud abajo. Prefiero que falte el dato a que esté mal.
-- =============================================================================

alter table public.catalogo_articulos
  alter column moneda drop default,
  alter column moneda drop not null;

-- 124 de 1.887 artículos vienen con precio 0,00 en la lista (discontinuados o
-- "a consultar"), y 4 sin moneda declarada. Ninguno de esos se puede cotizar
-- solo: quedan marcados para que la app los muestre pero no los presupueste.
alter table public.catalogo_articulos
  add column if not exists precio_a_confirmar boolean
    generated always as (precio = 0 or moneda is null) stored;

comment on column public.catalogo_articulos.moneda is
  'ARS o USD según el encabezado de la lista. NULL cuando la lista no lo declara: hay que confirmarlo antes de cotizar.';
comment on column public.catalogo_articulos.precio_a_confirmar is
  'true si el precio es 0,00 o la moneda no está declarada.';

create index catalogo_a_confirmar_idx
  on public.catalogo_articulos (familia) where precio_a_confirmar;

-- Se recrea la vista porque cambia el orden de las columnas.
drop view if exists public.vista_catalogo_vigente;

create view public.vista_catalogo_vigente
with (security_invoker = true) as
select distinct on (codigo)
  id, codigo, descripcion, medida, precio, moneda, precio_a_confirmar,
  familia, lista_origen, lista_fecha
from public.catalogo_articulos
order by codigo, lista_fecha desc, creado_en desc;
