-- El panel mostraba en "RECORRIDO" la distancia/duracion del ESTIMADO de la ruta
-- optimizada (Google), que se dispara a miles de km si hay un cliente lejisimo
-- en el rol (p.ej. Esquel). Se agregan a la vista la distancia y la duracion
-- REALES, calculadas de los puntos GPS (`posiciones`) dentro de la franja 8-19h
-- local, filtrando saltos de GPS (velocidad > 150 km/h) y huecos de senal > 5 min.
-- No cambia el estimado (`distancia_total_m`/`duracion_total_seg`), que el movil
-- sigue usando como "recorrido estimado" del plan.
create or replace view public.vista_resumen_jornada as
 SELECT rv.id AS rol_visita_id,
    rv.vendedor_id,
    rv.fecha,
    rv.estado,
    rv.iniciado_en,
    rv.finalizado_en,
    rv.distancia_total_m,
    rv.duracion_total_seg,
    count(pa.id) AS total_paradas,
    count(pa.id) FILTER (WHERE pa.estado = 'pendiente'::estado_parada) AS pendientes,
    count(pa.id) FILTER (WHERE pa.estado = 'en_camino'::estado_parada) AS en_camino,
    count(pa.id) FILTER (WHERE pa.estado = 'visitada'::estado_parada) AS visitadas,
    count(pa.id) FILTER (WHERE pa.estado = 'no_visitada'::estado_parada) AS no_visitadas,
    count(pa.id) FILTER (WHERE pa.estado = 'omitida'::estado_parada) AS omitidas,
    count(v.id) FILTER (WHERE v.vendio) AS con_venta,
    count(v.id) FILTER (WHERE v.cobro) AS con_cobro,
    count(v.id) FILTER (WHERE v.retiro_afilado) AS con_retiro_afilado,
    count(v.id) FILTER (WHERE v.entrego) AS con_entrega,
    ( SELECT round(sum(s.metros) FILTER (
               WHERE s.seg_delta BETWEEN 1 AND 300 AND s.metros <= 42 * s.seg_delta))::int
      FROM ( SELECT extract(epoch FROM (pos.registrado_en - lag(pos.registrado_en) OVER w)) AS seg_delta,
                    6371000 * acos(least(1.0, greatest(-1.0,
                      cos(radians(lag(pos.lat) OVER w)) * cos(radians(pos.lat)) * cos(radians(pos.lng) - radians(lag(pos.lng) OVER w))
                      + sin(radians(lag(pos.lat) OVER w)) * sin(radians(pos.lat))))) AS metros
             FROM posiciones pos
             WHERE pos.rol_visita_id = rv.id
               AND (pos.registrado_en AT TIME ZONE 'America/Argentina/Buenos_Aires')::time >= '08:00'::time
               AND (pos.registrado_en AT TIME ZONE 'America/Argentina/Buenos_Aires')::time <  '19:00'::time
             WINDOW w AS (ORDER BY pos.registrado_en)) s) AS distancia_real_m,
    ( SELECT extract(epoch FROM (max(pos.registrado_en) - min(pos.registrado_en)))::int
      FROM posiciones pos
      WHERE pos.rol_visita_id = rv.id
        AND (pos.registrado_en AT TIME ZONE 'America/Argentina/Buenos_Aires')::time >= '08:00'::time
        AND (pos.registrado_en AT TIME ZONE 'America/Argentina/Buenos_Aires')::time <  '19:00'::time) AS duracion_real_seg
   FROM roles_visita rv
     LEFT JOIN paradas pa ON pa.rol_visita_id = rv.id
     LEFT JOIN visitas v ON v.parada_id = pa.id
  GROUP BY rv.id;
