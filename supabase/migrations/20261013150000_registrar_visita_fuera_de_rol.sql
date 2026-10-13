-- Una nota de pedido hecha FUERA del recorrido (el vendedor visitó un cliente que
-- no estaba como parada del día) no aparecía en el rol de visita: el rol se arma
-- de `paradas`+`visitas`, nunca de `notas_pedido`, y para un cliente sin parada no
-- hay ningún renglón donde colgar lo que se hizo. El trigger
-- `interno.enganchar_nota_a_la_visita_del_dia` sólo engancha la nota a una parada
-- que YA existe; si no existe, la nota queda suelta y el trabajo no se ve.
--
-- Esta función materializa esa visita: asegura el rol de hoy y crea una PARADA ya
-- 'visitada' con su fila de `visitas` (el "qué se hizo": vendió + la observación
-- con el resumen de la nota). Así el rol —impreso, historial y mapa— muestra la
-- visita como cualquier otra. La app la llama después de crear la nota y le engancha
-- la nota a la parada devuelta.
--
-- Se crea la parada DIRECTAMENTE en 'visitada' (no 'pendiente' + registrar_visita) a
-- propósito: una visita suelta fuera de ruta no tiene que tocar el flujo del
-- recorrido en curso —no reordena ni promueve el próximo destino a 'en_camino'—.
-- Los únicos triggers de paradas/visitas tocan `actualizado_en`, así que el insert
-- directo no dispara ningún efecto lateral.
--
-- Si el cliente YA tiene una parada hoy (visita en ruta, o una segunda nota del
-- mismo cliente), se devuelve esa y no se crea otra ni se pisa su visita: la nota se
-- engancha a la existente, igual que hoy.

create or replace function public.registrar_visita_fuera_de_rol(
  p_cliente_id     uuid,
  p_direccion_id   uuid default null,
  p_observacion    text default '',
  p_vendio         boolean default true,
  p_cobro          boolean default false,
  p_retiro_afilado boolean default false,
  p_entrego        boolean default false
)
returns public.paradas
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_fecha    date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_rol_id   uuid;
  v_dir      uuid := p_direccion_id;
  v_parada   public.paradas;
  v_orden    integer;
  snap_dir   text;
  snap_cli   text;
  v_obs      text := btrim(coalesce(p_observacion, ''));
begin
  if not interno.esta_habilitado() then
    raise exception 'Tu cuenta no esta habilitada.' using errcode = '42501';
  end if;

  if p_cliente_id is null then
    raise exception 'Falta el cliente.' using errcode = '23514';
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

  -- ¿Ya hay una parada de este cliente hoy? (visita en ruta, u otra nota del mismo
  -- cliente). Se devuelve esa; la nota se engancha ahí, sin duplicar ni pisar nada.
  -- Se prefiere la de la misma dirección de la nota, igual que el trigger.
  select * into v_parada
    from public.paradas
   where rol_visita_id = v_rol_id
     and cliente_id = p_cliente_id
   order by (direccion_id is not distinct from p_direccion_id) desc, orden
   limit 1;
  if found then
    return v_parada;
  end if;

  -- Dirección: la que eligió el vendedor, o la principal del cliente. Puede quedar
  -- null (cliente sin dirección cargada): la parada entra SIN UBICAR, permitido por
  -- el check paradas_sin_direccion_tiene_cliente (siempre hay cliente acá).
  if v_dir is null then
    select id into v_dir
      from public.direcciones
     where cliente_id = p_cliente_id
     order by principal desc, creado_en
     limit 1;
  end if;

  -- Snapshot del nombre y el domicilio, con el mismo criterio que agregar_parada.
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

  -- Al final de la hoja. La UNIQUE(rol_visita_id, orden) es DEFERRABLE, pero acá no
  -- hace falta: max+1 nunca choca.
  select coalesce(max(orden), 0) + 1 into v_orden
    from public.paradas
   where rol_visita_id = v_rol_id;

  -- La observación tiene un CHECK (observacion_valida: >=12 alfanuméricos y >=3
  -- palabras). Si el resumen que mandó la app no alcanza, se le antepone una frase
  -- que sí cumple, sin perder el resumen.
  if not interno.observacion_valida(v_obs) then
    v_obs := btrim('Visita fuera de recorrido. ' || v_obs);
  end if;

  -- El check visitas_tipo_obligatorio exige al menos un tipo si está visitado. Una
  -- nota de pedido es, como mínimo, una venta; si no vino ningún tipo, va 'vendió'.
  if not (p_vendio or p_cobro or p_retiro_afilado or p_entrego) then
    p_vendio := true;
  end if;

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

  return v_parada;
end;
$function$;

-- Sólo para usuarios autenticados: anon no arma recorridos. (Igual la función corta
-- con esta_habilitado(), pero cerrarle el EXECUTE a anon/public es la línea de base.)
-- OJO: Supabase le da EXECUTE a `anon` DIRECTO (no por `public`), así que revocar de
-- `public` no alcanza; hay que revocar de `anon` también. (Se verificó el proacl.)
revoke all on function public.registrar_visita_fuera_de_rol(uuid, uuid, text, boolean, boolean, boolean, boolean) from public;
revoke execute on function public.registrar_visita_fuera_de_rol(uuid, uuid, text, boolean, boolean, boolean, boolean) from anon;
grant execute on function public.registrar_visita_fuera_de_rol(uuid, uuid, text, boolean, boolean, boolean, boolean) to authenticated;

comment on function public.registrar_visita_fuera_de_rol(uuid, uuid, text, boolean, boolean, boolean, boolean) is
  'Materializa una parada visitada + su visita para una nota de pedido hecha fuera del recorrido, para que el trabajo aparezca en el rol de visita. Devuelve la parada (nueva, o la existente del cliente si ya tenia una hoy). Atomica.';
