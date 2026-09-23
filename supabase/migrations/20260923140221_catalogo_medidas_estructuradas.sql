-- Medidas estructuradas del catalogo, extraidas del maestro de datos tecnicos
-- (17 listas de precios). Hasta ahora la unica medida era el campo texto
-- `medida`, que el cliente parsea de la descripcion; estas columnas permiten
-- filtrar por medida en forma exacta y confiable. Nullables: no todos los
-- productos tienen todas las medidas (una cuchilla no tiene Ø ni dientes).
alter table public.catalogo_articulos
  add column if not exists diametro_exterior numeric,
  add column if not exists ancho_corte numeric,
  add column if not exists diametro_interior numeric,
  add column if not exists dientes integer;

comment on column public.catalogo_articulos.diametro_exterior is 'Ø exterior en mm (D). Del maestro de datos tecnicos.';
comment on column public.catalogo_articulos.ancho_corte is 'Ancho de corte en mm (B / #). Primer valor si es B=corte/cuerpo.';
comment on column public.catalogo_articulos.diametro_interior is 'Agujero / Ø interior en mm (d).';
comment on column public.catalogo_articulos.dientes is 'Dientes/filos (Z). Total si es compuesto (18+4 = 22).';
