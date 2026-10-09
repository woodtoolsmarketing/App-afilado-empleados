-- Permitir elegir la sucursal (direccion_id) al agendar y al agregar desde el mapa.
-- Sumar un parametro es DROP+CREATE para no dejar sobrecarga ambigua.
-- Cuando p_direccion_id es NULL, el comportamiento es identico al anterior (principal).

drop function if exists public.agendar_visita(uuid, date, timestamp with time zone);

create function public.agendar_visita(
  p_cliente_id uuid,
  p_fecha date,
  p_hora timestamp with time zone default null,
  p_direccion_id uuid default null
)
returns paradas
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  direccion  uuid;
  jornada    uuid;
  nueva      public.paradas;
begin
  if p_fecha < interno.hoy_ar() then
    raise exception 'No se puede agendar para un día que ya pasó.' using errcode = '23514';
  end if;

  -- Si el vendedor eligió una sucursal y es de este cliente, se respeta.
  -- Si no, la principal (puede quedar NULL: se agenda sin ubicar y se resuelve al llegar).
  if p_direccion_id is not null then
    select dd.id into direccion
      from public.direcciones dd
     where dd.id = p_direccion_id and dd.cliente_id = p_cliente_id;
  end if;

  if direccion is null then
    select dd.id into direccion
      from public.direcciones dd
     where dd.cliente_id = p_cliente_id
     order by dd.principal desc, dd.creado_en
     limit 1;
  end if;

  jornada := public.jornada_del_dia(p_fecha);

  select * into nueva
    from public.paradas
   where rol_visita_id = jornada
     and cliente_id = p_cliente_id
     and estado in ('pendiente', 'en_camino', 'omitida')
   order by (estado = 'omitida')
   limit 1;

  if nueva.id is not null then
    if nueva.estado = 'omitida' then
      update public.paradas set estado = 'pendiente' where id = nueva.id;
      select * into nueva from public.paradas where id = nueva.id;
    end if;
  else
    nueva := public.agregar_parada(jornada, direccion, 'baja'::prioridad_parada, p_cliente_id);
  end if;

  if p_hora is not null then
    update public.paradas set hora_estimada = p_hora where id = nueva.id;
    select * into nueva from public.paradas where id = nueva.id;
  end if;

  return nueva;
end;
$function$;


drop function if exists public.agregar_cliente_al_recorrido(uuid, prioridad_parada);

create function public.agregar_cliente_al_recorrido(
  p_cliente_id uuid,
  p_prioridad prioridad_parada,
  p_direccion_id uuid default null
)
returns paradas
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_direccion_id uuid;
  v_rol_id       uuid;
  v_fecha        date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_parada       public.paradas;
begin
  if not interno.esta_habilitado() then
    raise exception 'Tu cuenta no esta habilitada.' using errcode = '42501';
  end if;

  -- Sucursal elegida si es de este cliente; si no, la principal (puede ser NULL).
  if p_direccion_id is not null then
    select id into v_direccion_id
      from public.direcciones
     where id = p_direccion_id and cliente_id = p_cliente_id;
  end if;

  if v_direccion_id is null then
    select id into v_direccion_id
      from public.direcciones
     where cliente_id = p_cliente_id
     order by principal desc, creado_en
     limit 1;
  end if;

  insert into public.roles_visita (vendedor_id, fecha, estado)
  values (auth.uid(), v_fecha, 'planificado')
  on conflict (vendedor_id, fecha) do nothing;

  select id into v_rol_id
    from public.roles_visita
   where vendedor_id = auth.uid()
     and fecha = v_fecha;

  -- El mismo cliente puede entrar varias veces (una por sucursal). La app avisa
  -- antes con "¿es otra sucursal?"; acá ya no hay nada que lo bloquee.
  v_parada := public.agregar_parada(v_rol_id, v_direccion_id, p_prioridad, p_cliente_id);

  return v_parada;
end;
$function$;

-- Replicar el candado original: SECURITY DEFINER cerrada a anon/public. El
-- default-privilege de Supabase vuelve a darle EXECUTE a anon al recrearla, asi
-- que hay que revocar de public Y de anon por separado (ver memoria).
revoke execute on function public.agregar_cliente_al_recorrido(uuid, prioridad_parada, uuid) from public;
revoke execute on function public.agregar_cliente_al_recorrido(uuid, prioridad_parada, uuid) from anon;
grant execute on function public.agregar_cliente_al_recorrido(uuid, prioridad_parada, uuid) to authenticated, service_role;
