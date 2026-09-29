/*
 * Una parada sin ubicar tiene que enterarse si el cliente se ubicó después.
 *
 * ─── El agujero ──────────────────────────────────────────────────────────────
 *
 * `agregar_parada` resuelve la dirección UNA VEZ, cuando se crea la parada. Si
 * en ese momento el cliente no estaba en el mapa, la parada nace con
 * `direccion_id` NULL — y se queda así para siempre, porque nada la vuelve a
 * mirar.
 *
 * El problema aparece en cuanto hay distancia entre agendar y visitar:
 *
 *   Martes   el vendedor agenda 8 clientes para el jueves, 5 sin ubicar.
 *   Miércol. la oficina les carga la dirección a los 5. Que es exactamente lo
 *            que va a pasar ahora que el tema está sobre la mesa: la app misma
 *            se lo viene pidiendo.
 *   Jueves   los 5 siguen con la pastilla SIN UBICAR. Van al final aunque
 *            queden de camino, no tienen pin en el mapa, no entran en "ver el
 *            recorrido en Google Maps" y `optimizar-ruta` los deja afuera.
 *
 * O sea: el dato bueno ya estaba en la base y el vendedor manejaba peor igual.
 *
 * ─── El arreglo ──────────────────────────────────────────────────────────────
 *
 * Antes de ordenar, se rellenan las paradas ABIERTAS que no tienen dirección y
 * cuyo cliente sí tiene una. Va colgado de `ordenar_paradas_por_cercania`, que
 * es por donde pasa `iniciar_recorrido` todas las mañanas: el momento exacto en
 * que la lista se arma para el día y en que conviene tener la mejor información
 * disponible.
 *
 * Es idempotente —la segunda corrida no toca ninguna fila— y sólo mira las
 * pendientes y en camino: una visita ya cerrada no se reescribe, porque su
 * `direccion_id` es parte del registro histórico de a dónde se fue.
 */

create or replace function interno.enganchar_direcciones_pendientes(p_rol_visita_id uuid)
returns integer
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_cuantas integer;
begin
  update public.paradas pa
     set direccion_id       = d.id,
         direccion_snapshot = d.direccion_formateada
    from public.direcciones d
   where pa.rol_visita_id = p_rol_visita_id
     and pa.direccion_id is null
     and pa.cliente_id is not null
     and pa.estado in ('pendiente', 'en_camino')
     and d.id = (
       select dd.id
         from public.direcciones dd
        where dd.cliente_id = pa.cliente_id
        order by dd.principal desc, dd.creado_en
        limit 1
     );

  get diagnostics v_cuantas = row_count;
  return v_cuantas;
end;
$function$;

create or replace function public.ordenar_paradas_por_cercania(
  p_rol_visita_id uuid,
  p_desde_lat double precision default null,
  p_desde_lng double precision default null
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
  sin_ubicar   uuid;
begin
  /*
   * Primero, la mejor información disponible.
   *
   * Va ANTES de todo lo demás —incluso antes del corte por falta de punto de
   * partida— porque una parada que ya se puede ubicar tiene que dejar de estar
   * sin ubicar aunque hoy no se reordene nada.
   */
  perform interno.enganchar_direcciones_pendientes(p_rol_visita_id);

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

  -- Sin punto de partida no se reordena nada, y por lo tanto tampoco hay
  -- renumeración que pueda chocar: se sale antes de tocar una sola fila.
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

  /*
   * Las sin ubicar, después de todas las ubicadas.
   *
   * Entre ellas se conserva el orden que ya tenían (y el de carga como
   * desempate), que es lo más parecido a "como las fue agregando".
   */
  for sin_ubicar in
    select pa.id
      from public.paradas pa
     where pa.rol_visita_id = p_rol_visita_id
       and pa.estado in ('pendiente', 'en_camino')
       and pa.direccion_id is null
     order by pa.orden, pa.creado_en
  loop
    posicion := posicion + 1;
    update public.paradas
       set orden = interno.orden_temporal() + posicion
     where id = sin_ubicar;
  end loop;

  update public.paradas
     set orden = orden - interno.orden_temporal()
   where rol_visita_id = p_rol_visita_id
     and orden > interno.orden_temporal();
end;
$function$;
