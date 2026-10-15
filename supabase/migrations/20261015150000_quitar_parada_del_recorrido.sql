-- =============================================================================
-- WoodTools · quitar un destino del recorrido y renumerar lo que queda
--
-- Antes, quitar un destino lo marcaba 'omitida' (`quitar_de_la_agenda`) y las
-- que quedaban conservaban su número: sacado el 1, la lista arrancaba en "2".
--
-- Esta función hace las dos cosas en una sola operación atómica: marca la
-- parada 'omitida' y renumera las que siguen abiertas para que arranquen
-- pegadas (1, 2, …), sin el hueco de la que se sacó.
--
-- El "piso" (desde dónde numerar las abiertas) cuenta SÓLO las resueltas
-- (visitada / no_visitada), que conservan su lugar. Las omitidas NO cuentan
-- para el piso —si contaran, la recién sacada dejaría el hueco igual— pero sí se
-- renumeran, aparcadas por encima de las abiertas, porque el índice único
-- (rol_visita_id, orden) no tolera dos paradas con el mismo número.
--
-- Corre como el que llama (no SECURITY DEFINER), igual que `reordenar_paradas`:
-- la RLS ya deja que el vendedor toque las paradas de su propia jornada.
-- =============================================================================

create or replace function public.quitar_parada_del_recorrido(p_parada_id uuid)
returns void
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
declare
  v_rol  uuid;
  v_piso integer;
  v_ids  uuid[];
  v_i    integer;
begin
  -- Marcar omitida, sólo si todavía está abierta, y capturar su jornada.
  update public.paradas
     set estado = 'omitida'
   where id = p_parada_id
     and estado in ('pendiente', 'en_camino')
  returning rol_visita_id into v_rol;

  if v_rol is null then
    raise exception 'Ese destino ya se resolvió: no se puede sacar del recorrido.'
      using errcode = '23514';
  end if;

  -- Piso = última resuelta; las omitidas no cuentan.
  select coalesce(max(orden), 0) into v_piso
    from public.paradas
   where rol_visita_id = v_rol
     and estado in ('visitada', 'no_visitada');

  -- Orden de renumeración: primero las ABIERTAS (en su orden actual) y después
  -- las OMITIDAS. Así las abiertas toman piso+1, piso+2, … y las omitidas quedan
  -- por encima, sin chocar con el índice único.
  select array_agg(id order by (estado in ('pendiente', 'en_camino')) desc, orden)
    into v_ids
    from public.paradas
   where rol_visita_id = v_rol
     and estado in ('pendiente', 'en_camino', 'omitida');

  -- Dos pasadas por el índice único, igual que `reordenar_paradas`: primero a un
  -- rango temporal alto, después se baja al número definitivo.
  for v_i in 1 .. coalesce(array_length(v_ids, 1), 0) loop
    update public.paradas
       set orden = interno.orden_temporal() + v_piso + v_i
     where id = v_ids[v_i];
  end loop;

  update public.paradas
     set orden = orden - interno.orden_temporal()
   where rol_visita_id = v_rol
     and orden > interno.orden_temporal();
end;
$$;
