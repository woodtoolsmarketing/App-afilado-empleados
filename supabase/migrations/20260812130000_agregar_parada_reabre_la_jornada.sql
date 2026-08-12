-- =============================================================================
-- Agregar un destino a una jornada cerrada la vuelve a abrir
--
-- El vendedor cierra su último destino a las 15:00 y la jornada queda
-- finalizada. A las 16:00 un cliente lo llama y pasa a verlo. Hasta ahora eso
-- no se podía registrar de ninguna manera: con la jornada finalizada,
-- "AGREGAR NUEVO DESTINO" quedaba deshabilitado en las dos pantallas que llevan
-- a él, `iniciar_recorrido` rechaza cualquier jornada cerrada, y las paradas
-- pendientes habían pasado a 'omitida'. La app quedaba entera en gris y la
-- única salida era llamar a la oficina — mientras la pantalla de Visitas le
-- prometía justo lo contrario: "Igual podés agregar un destino a mano".
--
-- Ahora sumar un destino reabre la jornada. Es lo que el gesto significa: si
-- hay un destino nuevo, el día no estaba terminado. Las paradas que quedaron
-- omitidas siguen omitidas —ésas sí se decidieron— y la nueva nace pendiente.
-- =============================================================================

create or replace function public.agregar_parada(
  p_rol_visita_id uuid,
  p_direccion_id uuid,
  p_prioridad prioridad_parada,
  p_cliente_id uuid default null::uuid
)
returns paradas
language plpgsql
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  ultima_resuelta integer;
  offset_media    integer;
  destino_orden   integer;
  total_pendiente integer;
  nueva           public.paradas;
  snapshot_dir    text;
  snapshot_cli    text;
begin
  -- Si la jornada estaba cerrada, sumar un destino la reabre.
  update public.roles_visita
     set estado = 'en_curso', finalizado_en = null
   where id = p_rol_visita_id
     and estado = 'finalizado';

  select coalesce(max(orden), 0) into ultima_resuelta
    from public.paradas
   where rol_visita_id = p_rol_visita_id
     and estado not in ('pendiente', 'en_camino');

  select coalesce(count(*), 0) into total_pendiente
    from public.paradas
   where rol_visita_id = p_rol_visita_id
     and estado in ('pendiente', 'en_camino');

  select coalesce((valor)::int, 3) into offset_media
    from public.configuracion where clave = 'prioridad_media_offset';

  destino_orden := case p_prioridad
    when 'alta'  then ultima_resuelta + 1
    when 'media' then ultima_resuelta + least(coalesce(offset_media, 3), total_pendiente + 1)
    else              ultima_resuelta + total_pendiente + 1
  end;

  select d.direccion_formateada, c.razon_social
    into snapshot_dir, snapshot_cli
    from public.direcciones d
    left join public.clientes c on c.id = coalesce(p_cliente_id, d.cliente_id)
   where d.id = p_direccion_id;

  update public.paradas
     set orden = orden + 1
   where rol_visita_id = p_rol_visita_id
     and orden >= destino_orden;

  insert into public.paradas (
    rol_visita_id, cliente_id, direccion_id, orden, prioridad, origen, estado,
    razon_social_snapshot, direccion_snapshot, agregada_por
  )
  values (
    p_rol_visita_id,
    coalesce(p_cliente_id, (select cliente_id from public.direcciones where id = p_direccion_id)),
    p_direccion_id, destino_orden, p_prioridad, 'agregada_en_ruta', 'pendiente',
    snapshot_cli, snapshot_dir, auth.uid()
  )
  returning * into nueva;

  if p_prioridad = 'baja' then
    perform public.ordenar_paradas_por_cercania(p_rol_visita_id);
    select * into nueva from public.paradas where id = nueva.id;
  end if;

  return nueva;
end;
$function$;
