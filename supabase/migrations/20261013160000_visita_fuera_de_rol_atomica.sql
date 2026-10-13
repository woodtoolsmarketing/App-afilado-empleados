-- Endurece registrar_visita_fuera_de_rol tras la revisión adversarial:
--
--  1) ENGANCHE ATÓMICO. Antes la app creaba la nota, llamaba la RPC (que horneaba
--     el resumen en la observación) y, en un segundo viaje, hacía el `update
--     notas_pedido set parada_id`. Si ese segundo viaje fallaba (señal cortada en
--     el galpón), la nota quedaba suelta con la visita ya horneada: el panel la
--     mostraba DOS veces (observación horneada + enganche por cliente del "resumen
--     suelto"). Ahora la RPC recibe los ids de las notas y las engancha ella misma,
--     en la misma transacción. Y como corre SECURITY DEFINER validando
--     vendedor_id = auth.uid(), un request manipulado no puede colgar la nota de la
--     parada de otro vendedor.
--
--  2) PARADA EXISTENTE NO 'visitada'. Si el cliente ya tenía una parada hoy pero
--     quedó 'no_visitada' (se marcó "no se pudo visitar") u 'omitida' (se finalizó
--     el recorrido sin pasar) —o sigue 'pendiente'—, antes la RPC la devolvía intacta
--     y la venta no aparecía (o peor: contra una parada marcada "no visitó"). Ahora
--     la cierra como 'visitada' con su parte. Sólo respeta una visita DE VERDAD
--     (visitado=true), para no pisar un parte cargado a mano.
--
--  3) DIRECCIÓN DEL CLIENTE. Igual que agendar_visita/agregar_cliente_al_recorrido,
--     si la dirección que llega no es del cliente se cae a la principal (o sin ubicar).
--
--  4) CARRERA DE ORDEN. Dos notas fuera de ruta simultáneas del mismo vendedor
--     calculaban el mismo max(orden)+1 y una chocaba contra la UNIQUE(rol,orden)
--     DEFERRABLE recién en el COMMIT. Un advisory lock por rol las serializa.
--
-- Se agrega el parámetro p_nota_ids, así que es DROP + CREATE (no CREATE OR REPLACE):
-- cambiar la firma con OR REPLACE dejaría la sobrecarga vieja viva y ambigua.

drop function if exists public.registrar_visita_fuera_de_rol(uuid, uuid, text, boolean, boolean, boolean, boolean);

create function public.registrar_visita_fuera_de_rol(
  p_cliente_id     uuid,
  p_direccion_id   uuid default null,
  p_observacion    text default '',
  p_vendio         boolean default true,
  p_cobro          boolean default false,
  p_retiro_afilado boolean default false,
  p_entrego        boolean default false,
  p_nota_ids       uuid[] default '{}'
)
returns public.paradas
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_fecha       date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_rol_id      uuid;
  v_dir         uuid := p_direccion_id;
  v_parada      public.paradas;
  v_orden       integer;
  snap_dir      text;
  snap_cli      text;
  v_obs         text := btrim(coalesce(p_observacion, ''));
  v_ya_visitada boolean;
begin
  if not interno.esta_habilitado() then
    raise exception 'Tu cuenta no esta habilitada.' using errcode = '42501';
  end if;

  if p_cliente_id is null then
    raise exception 'Falta el cliente.' using errcode = '23514';
  end if;

  -- La observación tiene CHECK (observacion_valida). Si el resumen que mandó la app
  -- no alcanza, se le antepone una frase que sí cumple, sin perder el resumen.
  if not interno.observacion_valida(v_obs) then
    v_obs := btrim('Visita fuera de recorrido. ' || v_obs);
  end if;

  -- El CHECK visitas_tipo_obligatorio exige al menos un tipo si está visitado. Una
  -- nota de pedido es, como mínimo, una venta; si no vino ningún tipo, va 'vendió'.
  if not (p_vendio or p_cobro or p_retiro_afilado or p_entrego) then
    p_vendio := true;
  end if;

  -- El rol de hoy. No se reabre si estaba 'finalizado': una nota suelta registra la
  -- visita, no reinicia el recorrido.
  insert into public.roles_visita (vendedor_id, fecha, estado)
  values (auth.uid(), v_fecha, 'planificado')
  on conflict (vendedor_id, fecha) do nothing;

  select id into v_rol_id
    from public.roles_visita
   where vendedor_id = auth.uid()
     and fecha = v_fecha;

  -- Serializa a dos notas fuera de ruta simultáneas del mismo vendedor: el "¿ya hay
  -- parada?" y el orden (max+1) se calculan sin que otra transacción inserte una
  -- parada en el medio (la UNIQUE(rol,orden) es DEFERRABLE y chequea al COMMIT, así
  -- que sin esto las dos calcularían el mismo orden y una reventaría al comitear).
  perform pg_advisory_xact_lock(hashtextextended('registrar_visita_fuera_de_rol:' || v_rol_id::text, 0));

  -- La dirección tiene que ser del cliente (mismo criterio que agregar_cliente_al_recorrido).
  -- Si no lo es, se resuelve la principal; si no hay ninguna, la parada entra sin ubicar.
  if v_dir is not null and not exists (
    select 1 from public.direcciones where id = v_dir and cliente_id = p_cliente_id
  ) then
    v_dir := null;
  end if;
  if v_dir is null then
    select id into v_dir
      from public.direcciones
     where cliente_id = p_cliente_id
     order by principal desc, creado_en
     limit 1;
  end if;

  -- ¿Ya hay una parada de este cliente hoy? (visita en ruta, una que quedó
  -- 'no_visitada'/'omitida', o una 'pendiente' que todavía no se tocó). Se prefiere
  -- la de la misma dirección de la nota, igual que el trigger de enganche.
  select * into v_parada
    from public.paradas
   where rol_visita_id = v_rol_id
     and cliente_id = p_cliente_id
   order by (direccion_id is not distinct from p_direccion_id) desc, orden
   limit 1;

  if found then
    -- Si ya tiene una visita DE VERDAD (visitado=true) no se pisa: puede haber un
    -- parte cargado a mano con más datos. Si no (pendiente / no_visitada / omitida),
    -- la venta fuera de ruta la cierra como visitada con su parte.
    select exists (select 1 from public.visitas where parada_id = v_parada.id and visitado)
      into v_ya_visitada;

    if not v_ya_visitada then
      insert into public.visitas (
        parada_id, rol_visita_id, vendedor_id, cliente_id,
        visitado, vendio, cobro, retiro_afilado, entrego, motivo_no_visita,
        observacion, observacion_origen
      )
      values (
        v_parada.id, v_rol_id, auth.uid(), p_cliente_id,
        true, p_vendio, p_cobro, p_retiro_afilado, p_entrego, null,
        v_obs, 'texto'
      )
      -- Upsert: si había una visita 'no visitado', se pasa a visitada y se le limpia
      -- el motivo (el CHECK visitas_motivo_solo_si_no_visito exige motivo null si visitado).
      on conflict (parada_id) do update set
        visitado           = true,
        vendio             = excluded.vendio,
        cobro              = excluded.cobro,
        retiro_afilado     = excluded.retiro_afilado,
        entrego            = excluded.entrego,
        motivo_no_visita   = null,
        observacion        = excluded.observacion,
        observacion_origen = excluded.observacion_origen,
        actualizado_en     = now();

      update public.paradas
         set estado     = 'visitada',
             llegada_en = coalesce(llegada_en, now()),
             salida_en  = now()
       where id = v_parada.id
       returning * into v_parada;
    end if;
  else
    -- No hay parada: snapshot del nombre/domicilio (mismo criterio que agregar_parada).
    if v_dir is null then
      select c.razon_social,
             nullif(btrim(concat_ws(', ',
               nullif(btrim(coalesce(c.direccion, '')), ''),
               nullif(btrim(coalesce(c.localidad, '')), '')
             )), '')
        into snap_cli, snap_dir
        from public.clientes c
       where c.id = p_cliente_id;
    else
      select d.direccion_formateada, c.razon_social
        into snap_dir, snap_cli
        from public.direcciones d
        left join public.clientes c on c.id = coalesce(p_cliente_id, d.cliente_id)
       where d.id = v_dir;
    end if;

    select coalesce(max(orden), 0) + 1 into v_orden
      from public.paradas
     where rol_visita_id = v_rol_id;

    insert into public.paradas (
      rol_visita_id, cliente_id, direccion_id, orden, prioridad, origen, estado,
      razon_social_snapshot, direccion_snapshot, agregada_por, llegada_en, salida_en
    )
    values (
      v_rol_id, p_cliente_id, v_dir, v_orden, 'baja', 'agregada_en_ruta', 'visitada',
      snap_cli, snap_dir, auth.uid(), now(), now()
    )
    returning * into v_parada;

    insert into public.visitas (
      parada_id, rol_visita_id, vendedor_id, cliente_id,
      visitado, vendio, cobro, retiro_afilado, entrego,
      observacion, observacion_origen
    )
    values (
      v_parada.id, v_rol_id, auth.uid(), p_cliente_id,
      true, p_vendio, p_cobro, p_retiro_afilado, p_entrego,
      v_obs, 'texto'
    );
  end if;

  -- Engancha las notas recién creadas a esta parada, en la misma transacción. Sólo
  -- las propias y las que quedaron sueltas: si el trigger ya enganchó alguna a una
  -- parada del cliente, no se pisa.
  update public.notas_pedido
     set parada_id = v_parada.id
   where id = any (p_nota_ids)
     and vendedor_id = auth.uid()
     and parada_id is null;

  return v_parada;
end;
$function$;

-- Sólo autenticados. OJO: Supabase le da EXECUTE a `anon` DIRECTO (no por `public`),
-- así que revocar de `public` no alcanza; hay que revocar de `anon` también.
revoke all     on function public.registrar_visita_fuera_de_rol(uuid, uuid, text, boolean, boolean, boolean, boolean, uuid[]) from public;
revoke execute on function public.registrar_visita_fuera_de_rol(uuid, uuid, text, boolean, boolean, boolean, boolean, uuid[]) from anon;
grant  execute on function public.registrar_visita_fuera_de_rol(uuid, uuid, text, boolean, boolean, boolean, boolean, uuid[]) to authenticated;

comment on function public.registrar_visita_fuera_de_rol(uuid, uuid, text, boolean, boolean, boolean, boolean, uuid[]) is
  'Materializa/cierra una parada visitada + su visita para una nota de pedido hecha fuera del recorrido y engancha las notas (p_nota_ids) a esa parada, atomico. Si el cliente ya tenia una parada no visitada hoy, la cierra; si ya estaba visitada de verdad, no la pisa.';
