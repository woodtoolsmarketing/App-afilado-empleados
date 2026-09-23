create or replace view public.vista_catalogo_vigente as
 select distinct on (codigo, (coalesce(medida, ''::text))) id,
    codigo, descripcion, medida, precio, moneda, precio_a_confirmar, familia,
    rango_min, rango_max, rango_dimension, lista_origen, lista_fecha,
    servicio_sugerido, herramienta_sugerida, es_servicio,
    -- Medidas estructuradas (agregadas al final para poder usar CREATE OR REPLACE).
    diametro_exterior, ancho_corte, diametro_interior, dientes
   from catalogo_articulos
  order by codigo, (coalesce(medida, ''::text)), fecha_estimada, lista_fecha desc nulls last, creado_en desc;
