-- =============================================================================
-- Reordenar los destinos a mano
--
-- El vendedor quiere mandar un destino al principio, al final o correrlo de a
-- uno "a gusto" dentro de su recorrido de hoy, sin depender de "Ordenar por
-- cercanía" (que lo decide Google/PostGIS, no él). Esta función recibe la
-- secuencia COMPLETA de las paradas abiertas en el orden deseado y las renumera.
--
-- Las resueltas (visitada / no_visitada / omitida) NO se tocan: conservan su
-- número adelante, igual que `ordenar_paradas_por_cercania`. El "piso" es el
-- último orden YA USADO por una resuelta, no cuántas hay — una pendiente del
-- medio se puede cerrar antes que la primera, así que contar pisaría números.
--
-- Seguridad: SECURITY INVOKER, igual que `agregar_parada`. La pertenencia la
-- garantiza RLS sobre `paradas` (sólo el dueño habilitado de la jornada puede
-- tocar sus paradas), así que no hace falta chequear `vendedor_id` a mano.
--
-- La secuencia pedida tiene que ser EXACTAMENTE las abiertas (las mismas, sin
-- repetir y sin faltar ninguna). Si el teléfono manda una lista vieja se corta
-- con P0001 y no se renumera nada: así no queda una parada sin lugar ni se pisa
-- a una resuelta.
--
-- Se renumera en dos pasadas con `interno.orden_temporal()` (igual que el resto
-- del archivo): el índice único `paradas_orden_unico` es DEFERRABLE, pero el
-- CHECK `paradas_orden_positivo` (orden > 0) no lo es, así que correr todo por
-- encima de 1.000.000 evita tanto las colisiones como los números fuera de rango
-- en las filas intermedias.
-- =============================================================================

create or replace function public.reordenar_paradas(
  p_rol_visita_id uuid,
  p_orden         uuid[]
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_piso     integer;
  v_abiertas integer;
  v_i        integer;
  v_fila     integer;
begin
  -- El último número ya usado por una parada resuelta (no cuántas hay).
  select coalesce(max(orden), 0) into v_piso
    from public.paradas
   where rol_visita_id = p_rol_visita_id
     and estado not in ('pendiente', 'en_camino');

  select count(*) into v_abiertas
    from public.paradas
   where rol_visita_id = p_rol_visita_id
     and estado in ('pendiente', 'en_camino');

  -- Tiene que venir la lista completa de abiertas, sin repetidos. El conteo de
  -- distintos más el largo igual a `v_abiertas` ya descarta duplicados y
  -- faltantes; que cada id sea realmente una abierta lo verifica el row_count
  -- de la pasada 1.
  if coalesce(array_length(p_orden, 1), 0) <> v_abiertas
     or (select count(distinct x) from unnest(p_orden) x) <> v_abiertas then
    raise exception 'La lista de destinos cambió. Actualizá el recorrido y volvé a intentar.'
      using errcode = 'P0001';
  end if;

  -- Pasada 1: cada parada a su lugar nuevo, corrida por encima del rango real.
  -- El coalesce evita que un arreglo vacío (cota nula) voltee el FOR; con la
  -- validación de arriba sólo pasa cuando además no hay abiertas, y ahí el loop
  -- queda en 1..0 y no corre, que es lo correcto: no hay nada que renumerar.
  for v_i in 1 .. coalesce(array_length(p_orden, 1), 0) loop
    update public.paradas
       set orden = interno.orden_temporal() + v_piso + v_i
     where id = p_orden[v_i]
       and rol_visita_id = p_rol_visita_id
       and estado in ('pendiente', 'en_camino');

    get diagnostics v_fila = row_count;
    -- Un id que no es una parada abierta de esta jornada: lista vieja o ajena.
    if v_fila <> 1 then
      raise exception 'Uno de los destinos ya no está en el recorrido. Actualizá y volvé a intentar.'
        using errcode = 'P0001';
    end if;
  end loop;

  -- Pasada 2: se bajan al rango real (piso + 1 .. piso + N).
  update public.paradas
     set orden = orden - interno.orden_temporal()
   where rol_visita_id = p_rol_visita_id
     and orden > interno.orden_temporal();
end;
$$;

comment on function public.reordenar_paradas is
  'Renumera las paradas ABIERTAS de una jornada según la secuencia exacta que manda el vendedor (reordenar a mano). Respeta las resueltas y usa el rango temporal para no violar el CHECK orden > 0.';
