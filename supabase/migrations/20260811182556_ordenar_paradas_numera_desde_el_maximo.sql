-- =============================================================================
-- Ordenar por cercanía numeraba desde la CANTIDAD de destinos cerrados, no
-- desde el último número usado
--
-- `ordenar_paradas_por_cercania` arrancaba en `count(*)` de las paradas ya
-- resueltas y numeraba las pendientes a partir de ahí. Eso sólo funciona si las
-- resueltas ocupan exactamente los órdenes 1..N, y no hay nada que lo garantice:
-- la lista "DESTINOS DEL DÍA" deja tocar cualquier parada pendiente, no sólo la
-- próxima, así que el vendedor puede cerrar el Nº2 antes que el Nº1.
--
-- Con tres destinos y el del medio cerrado, `count(*)` da 1, las dos pendientes
-- se renumeran 2 y 3, y el 2 ya lo tiene la que está cerrada. La restricción
-- `paradas_orden_unico` es DEFERRABLE INITIALLY DEFERRED, así que no salta en el
-- UPDATE: espera al commit y ahí voltea la transacción entera.
--
-- Reproducido antes de tocar nada: 23505 duplicate key value violates unique
-- constraint "paradas_orden_unico". Lo que rompe en la calle es INICIAR
-- RECORRIDO, que es la primera cosa que hace el vendedor a la mañana.
--
-- `agregar_parada` ya lo hacía bien —usa `max(orden)`— así que esto sólo alinea
-- las dos con el mismo criterio. Pueden quedar huecos en la numeración (si una
-- pendiente tenía un orden menor que una cerrada), y eso está bien: el orden
-- expresa la secuencia del recorrido, no un contador sin agujeros.
-- =============================================================================

create or replace function public.ordenar_paradas_por_cercania(
  p_rol_visita_id uuid,
  p_desde_lat double precision default null::double precision,
  p_desde_lng double precision default null::double precision
)
returns void
language plpgsql
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  punto_actual extensions.geography;
  siguiente    uuid;
  posicion     integer;
  colocadas    uuid[] := '{}';
begin
  -- El último número YA USADO por un destino cerrado, no cuántos hay cerrados.
  select coalesce(max(orden), 0) into posicion
    from public.paradas
   where rol_visita_id = p_rol_visita_id
     and estado not in ('pendiente', 'en_camino');

  if p_desde_lat is not null then
    punto_actual := extensions.st_setsrid(extensions.st_makepoint(p_desde_lng, p_desde_lat), 4326)::extensions.geography;
  else
    select coalesce(
             extensions.st_setsrid(extensions.st_makepoint(rv.origen_lng, rv.origen_lat), 4326)::extensions.geography,
             extensions.st_setsrid(extensions.st_makepoint(p.origen_lng, p.origen_lat), 4326)::extensions.geography
           )
      into punto_actual
      from public.roles_visita rv
      join public.perfiles p on p.id = rv.vendedor_id
     where rv.id = p_rol_visita_id;
  end if;

  if punto_actual is null then
    return;
  end if;

  -- Se numera en dos tiempos con un rango temporal muy por encima de cualquier
  -- orden real: ninguna fila intermedia colisiona ni viola el CHECK orden > 0
  -- (los CHECK no se pueden diferir).
  loop
    select pa.id
      into siguiente
      from public.paradas pa
      join public.direcciones d on d.id = pa.direccion_id
     where pa.rol_visita_id = p_rol_visita_id
       and pa.estado in ('pendiente', 'en_camino')
       and not (pa.id = any (colocadas))
     order by (pa.prioridad = 'alta') desc,
              d.ubicacion <-> punto_actual
     limit 1;

    exit when siguiente is null;

    posicion  := posicion + 1;
    colocadas := colocadas || siguiente;

    update public.paradas
       set orden = interno.orden_temporal() + posicion
     where id = siguiente;

    select d.ubicacion
      into punto_actual
      from public.paradas pa
      join public.direcciones d on d.id = pa.direccion_id
     where pa.id = siguiente;
  end loop;

  update public.paradas
     set orden = orden - interno.orden_temporal()
   where rol_visita_id = p_rol_visita_id
     and orden > interno.orden_temporal();
end;
$function$;
