-- Un destino 'baja' agregado con la jornada EN CURSO reordenaba toda la ruta por
-- cercania desde el origen de la manana, pisando el orden optimizado y pudiendo
-- cambiar en silencio el proximo destino (hasta mandar al final la parada
-- 'en_camino'). Ahora, con la jornada en curso, el 'baja' entra al final (su
-- destino_orden ya se calcula al final) y NO se reordena. En 'planificado' se
-- sigue reordenando (optimizacion previa a arrancar, sin parada en camino que
-- mover); una jornada reabierta queda 'en_curso' y tampoco reordena.
create or replace function public.agregar_parada(p_rol_visita_id uuid, p_direccion_id uuid, p_prioridad prioridad_parada, p_cliente_id uuid default null::uuid)
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
  v_en_curso      boolean;
begin
  update public.roles_visita
     set estado = 'en_curso', finalizado_en = null
   where id = p_rol_visita_id
     and estado = 'finalizado';

  select (estado = 'en_curso') into v_en_curso
    from public.roles_visita where id = p_rol_visita_id;

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

  if p_prioridad = 'baja' and not v_en_curso then
    perform public.ordenar_paradas_por_cercania(p_rol_visita_id);
    select * into nueva from public.paradas where id = nueva.id;
  end if;

  return nueva;
end;
$function$;
