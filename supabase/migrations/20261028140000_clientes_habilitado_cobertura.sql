-- Filtro de habilitados: cobertura completa.
--
-- La primera migración (…_filtro) puso el filtro en las 3 funciones de BÚSQUEDA
-- del vendedor (buscar_clientes, clientes_en_mapa, ficha_cliente). Pero el
-- vendedor llega al padrón por más caminos. Acá se cierran:
--   • Descubrimiento: candidatos_del_dia ("Clientes de hoy"), lista_semanal_de
--     ("Lista semanal") y las sugerencias de agenda_semanal ("Calendario" /
--     "Próximas visitas"). (Las paradas YA agendadas se dejan como están: el
--     trabajo en curso no se esconde a mitad de camino.)
--   • Operación: agregar_parada (el embudo por el que pasan "importar visitas de
--     otro día", agregar_cliente_al_recorrido y el alta de provisorio),
--     registrar_visita_fuera_de_rol y crear_notas_pedido NO dejan operar sobre
--     un cliente no habilitado. La oficina (puede_ver_todo) y los provisorios
--     (el cliente que el vendedor acaba de cargar en la calle) SÍ pueden.

-- Helper: ¿se puede operar sobre este cliente?
-- true si: no hay cliente (nota "a mano"), o es oficina, o está habilitado, o es
-- provisorio (alta en la calle todavía sin confirmar). security definer para no
-- depender de la RLS de quien llame.
create or replace function interno.cliente_operable(p_cliente_id uuid)
returns boolean
language sql
stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select p_cliente_id is null
      or (select interno.puede_ver_todo())
      or exists (
           select 1 from public.clientes c
            where c.id = p_cliente_id
              and (c.habilitado or c.provisorio)
         );
$$;

-- ── candidatos_del_dia ("Clientes de hoy") ───────────────────────────────────
create or replace function public.candidatos_del_dia(p_vendedor_id uuid default null::uuid)
returns table(cliente_id uuid, codigo text, razon_social text, direccion text, lat double precision, lng double precision, cada_cuantos_dias integer, ultima_visita date, dias_desde integer, orden integer)
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
  with quien as (select coalesce(p_vendedor_id, auth.uid()) as id),
  ultimas as (
    select v.cliente_id, max(rv.fecha) as fecha
      from public.visitas v
      join public.roles_visita rv on rv.id = v.rol_visita_id
     where v.visitado
       and v.cliente_id is not null
     group by v.cliente_id
  ),
  ya_en_ruta as (
    select distinct pa.cliente_id
      from public.paradas pa
      join public.roles_visita rv on rv.id = pa.rol_visita_id
      join quien q on q.id = rv.vendedor_id
     where rv.fecha = current_date
       and pa.cliente_id is not null
  )
  select
    c.id,
    c.codigo,
    c.razon_social,
    coalesce(d.direccion_formateada, nullif(btrim(c.direccion), '')),
    d.lat,
    d.lng,
    rm.cada_cuantos_dias,
    u.fecha,
    case when u.fecha is null then null
         else (current_date - u.fecha)::int end,
    rm.orden
  from public.rol_maestro rm
  join quien q on q.id = rm.vendedor_id
  join public.clientes c on c.id = rm.cliente_id
  left join lateral (
    select dd.direccion_formateada, dd.lat, dd.lng
      from public.direcciones dd
     where dd.cliente_id = c.id
     order by dd.principal desc, dd.creado_en
     limit 1
  ) d on true
  left join ultimas u on u.cliente_id = c.id
  where rm.activo
    and c.activo
    and (c.habilitado or (select interno.puede_ver_todo()))
    and (u.fecha is null or rm.cada_cuantos_dias is null or current_date - u.fecha >= rm.cada_cuantos_dias)
    and not exists (select 1 from ya_en_ruta r where r.cliente_id = c.id)
  order by rm.orden nulls last, u.fecha nulls first, c.razon_social;
$function$;

-- ── lista_semanal_de ("Lista semanal") ───────────────────────────────────────
create or replace function public.lista_semanal_de(p_dia_semana smallint)
returns table(cliente_id uuid, codigo text, razon_social text, direccion text, lat double precision, lng double precision, orden integer)
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
  select
    lv.cliente_id,
    c.codigo,
    c.razon_social,
    d.direccion_formateada,
    d.lat,
    d.lng,
    lv.orden
  from public.lista_visitas_vendedor lv
  join public.clientes c on c.id = lv.cliente_id
  left join lateral (
    select dd.direccion_formateada, dd.lat, dd.lng
      from public.direcciones dd
     where dd.cliente_id = c.id
     order by dd.principal desc, dd.creado_en
     limit 1
  ) d on true
  where lv.vendedor_id = auth.uid()
    and lv.dia_semana = p_dia_semana
    and lv.activo
    and (c.habilitado or (select interno.puede_ver_todo()))
  order by lv.orden nulls last, c.razon_social;
$function$;

-- ── agenda_semanal ("Calendario" / "Próximas visitas") ───────────────────────
-- Las SUGERENCIAS (toca, sugeridas_lista) se filtran por habilitado; las
-- paradas ya AGENDADAS se dejan como están (no se esconde el trabajo en curso).
create or replace function public.agenda_semanal(p_desde date, p_hasta date, p_vendedor_id uuid default null::uuid)
returns table(fecha date, tipo text, parada_id uuid, rol_visita_id uuid, cliente_id uuid, codigo text, razon_social text, direccion text, lat double precision, lng double precision, hora timestamp with time zone, estado text, prioridad text, orden integer, cada_cuantos_dias integer, dias_desde integer)
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
  with quien as (
    select coalesce(p_vendedor_id, auth.uid()) as id
  ),
  ventana as (
    select p_desde as desde,
           least(p_hasta, p_desde + 62) as hasta
  ),

  agendadas as (
    select
      rv.fecha,
      'agendada'::text                                        as tipo,
      p.id                                                    as parada_id,
      rv.id                                                   as rol_visita_id,
      p.cliente_id,
      c.codigo,
      coalesce(c.razon_social, p.razon_social_snapshot, 'Sin nombre') as razon_social,
      coalesce(d.direccion_formateada, p.direccion_snapshot)  as direccion,
      d.lat,
      d.lng,
      p.hora_estimada                                         as hora,
      p.estado::text                                          as estado,
      p.prioridad::text                                       as prioridad,
      p.orden,
      null::integer                                           as cada_cuantos_dias,
      null::integer                                           as dias_desde
    from public.roles_visita rv
    join quien q on q.id = rv.vendedor_id
    cross join ventana v
    join public.paradas p on p.rol_visita_id = rv.id
    left join public.clientes c on c.id = p.cliente_id
    left join public.direcciones d on d.id = p.direccion_id
    where rv.fecha between v.desde and v.hasta
  ),

  ultimas as (
    select v.cliente_id, max(rv.fecha) as fecha
      from public.visitas v
      join public.roles_visita rv on rv.id = v.rol_visita_id
     where v.visitado
       and v.cliente_id is not null
     group by v.cliente_id
  ),

  toca as (
    select
      rm.cliente_id,
      rm.cada_cuantos_dias,
      u.fecha as ultima_visita,
      case when u.fecha is null then null
           else (interno.hoy_ar() - u.fecha)::int end as dias_desde,
      greatest(
        v.desde,
        interno.hoy_ar(),
        case when u.fecha is null then interno.hoy_ar()
             else u.fecha + rm.cada_cuantos_dias end
      ) as primera
    from public.rol_maestro rm
    join quien q on q.id = rm.vendedor_id
    cross join ventana v
    join public.clientes c on c.id = rm.cliente_id
    left join ultimas u on u.cliente_id = rm.cliente_id
    where rm.activo
      and c.activo
      and (c.habilitado or (select interno.puede_ver_todo()))
  ),

  sugeridas_rol as (
    select
      t.primera                                    as fecha,
      'sugerida'::text                             as tipo,
      null::uuid                                   as parada_id,
      null::uuid                                   as rol_visita_id,
      t.cliente_id,
      c.codigo,
      c.razon_social,
      coalesce(d.direccion_formateada, nullif(btrim(c.direccion), '')) as direccion,
      d.lat,
      d.lng,
      null::timestamptz                            as hora,
      null::text                                   as estado,
      null::text                                   as prioridad,
      null::integer                                as orden,
      t.cada_cuantos_dias,
      t.dias_desde
    from toca t
    cross join ventana v
    join public.clientes c on c.id = t.cliente_id
    left join lateral (
      select dd.direccion_formateada, dd.lat, dd.lng
        from public.direcciones dd
       where dd.cliente_id = c.id
       order by dd.principal desc, dd.creado_en
       limit 1
    ) d on true
    where t.primera <= v.hasta
      and not exists (
        select 1 from agendadas a
         where a.cliente_id = t.cliente_id
           and (a.estado <> 'omitida' or a.fecha = t.primera)
      )
  ),

  sugeridas_lista as (
    select
      g.dd::date                                   as fecha,
      'sugerida'::text                             as tipo,
      null::uuid                                   as parada_id,
      null::uuid                                   as rol_visita_id,
      lv.cliente_id,
      c.codigo,
      c.razon_social,
      coalesce(d.direccion_formateada, nullif(btrim(c.direccion), '')) as direccion,
      d.lat,
      d.lng,
      null::timestamptz                            as hora,
      null::text                                   as estado,
      null::text                                   as prioridad,
      lv.orden,
      null::integer                                as cada_cuantos_dias,
      case when u.fecha is null then null
           else (interno.hoy_ar() - u.fecha)::int end as dias_desde
    from public.lista_visitas_vendedor lv
    join quien q on q.id = lv.vendedor_id
    cross join ventana v
    join public.clientes c on c.id = lv.cliente_id
    cross join lateral generate_series(v.desde::timestamp, v.hasta::timestamp, interval '1 day') as g(dd)
    left join lateral (
      select dd.direccion_formateada, dd.lat, dd.lng
        from public.direcciones dd
       where dd.cliente_id = c.id
       order by dd.principal desc, dd.creado_en
       limit 1
    ) d on true
    left join ultimas u on u.cliente_id = lv.cliente_id
    where lv.activo
      and c.activo
      and (c.habilitado or (select interno.puede_ver_todo()))
      and lv.dia_semana = extract(isodow from g.dd)::int
      and g.dd::date >= interno.hoy_ar()
      and not exists (
        select 1 from agendadas a
         where a.cliente_id = lv.cliente_id
           and a.fecha = g.dd::date
      )
  ),

  sugeridas as (
    select distinct on (fecha, cliente_id)
      fecha, tipo, parada_id, rol_visita_id, cliente_id, codigo, razon_social,
      direccion, lat, lng, hora, estado, prioridad, orden, cada_cuantos_dias, dias_desde
    from (
      select * from sugeridas_rol
      union all
      select * from sugeridas_lista
    ) u
    order by fecha, cliente_id, (cada_cuantos_dias is null)
  )

  select * from agendadas
  union all
  select * from sugeridas
  order by 1, 2, 14 nulls last, 7;
$function$;

-- ── agregar_parada (embudo de alta de paradas) ───────────────────────────────
-- Guard al principio: no deja sumar al recorrido un cliente no operable. Pasa
-- por acá "importar visitas de otro día", agregar_cliente_al_recorrido y el alta
-- de provisorio (el provisorio es operable, así que ese alta sigue andando).
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
  if p_cliente_id is not null and not interno.cliente_operable(p_cliente_id) then
    raise exception 'Ese cliente no está habilitado para sumarlo al recorrido. Avisá a la oficina.'
      using errcode = '42501';
  end if;

  -- Si la jornada estaba cerrada, sumar un destino la reabre (y le devuelve un
  -- iniciado_en si no lo tenia: una jornada en curso no puede estar sin inicio).
  update public.roles_visita
     set estado = 'en_curso', finalizado_en = null,
         iniciado_en = coalesce(iniciado_en, now())
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

  destino_orden := case
    when p_direccion_id is null then ultima_resuelta + total_pendiente + 1
    else case p_prioridad
      when 'alta'  then ultima_resuelta + 1
      when 'media' then ultima_resuelta + least(coalesce(offset_media, 3), total_pendiente + 1)
      else              ultima_resuelta + total_pendiente + 1
    end
  end;

  if p_direccion_id is null then
    select c.razon_social,
           nullif(btrim(concat_ws(', ',
             nullif(btrim(coalesce(c.direccion, '')), ''),
             nullif(btrim(coalesce(c.localidad, '')), '')
           )), '')
      into snapshot_cli, snapshot_dir
      from public.clientes c
     where c.id = p_cliente_id;
  else
    select d.direccion_formateada, c.razon_social
      into snapshot_dir, snapshot_cli
      from public.direcciones d
      left join public.clientes c on c.id = coalesce(p_cliente_id, d.cliente_id)
     where d.id = p_direccion_id;
  end if;

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

-- ── registrar_visita_fuera_de_rol ────────────────────────────────────────────
create or replace function public.registrar_visita_fuera_de_rol(p_cliente_id uuid, p_direccion_id uuid default null::uuid, p_observacion text default ''::text, p_vendio boolean default true, p_cobro boolean default false, p_retiro_afilado boolean default false, p_entrego boolean default false, p_nota_ids uuid[] default '{}'::uuid[])
returns paradas
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

  if not interno.cliente_operable(p_cliente_id) then
    raise exception 'Ese cliente no está habilitado. Avisá a la oficina.' using errcode = '42501';
  end if;

  if not interno.observacion_valida(v_obs) then
    v_obs := btrim('Visita fuera de recorrido. ' || v_obs);
  end if;

  if not (p_vendio or p_cobro or p_retiro_afilado or p_entrego) then
    p_vendio := true;
  end if;

  insert into public.roles_visita (vendedor_id, fecha, estado)
  values (auth.uid(), v_fecha, 'planificado')
  on conflict (vendedor_id, fecha) do nothing;

  select id into v_rol_id
    from public.roles_visita
   where vendedor_id = auth.uid()
     and fecha = v_fecha;

  perform pg_advisory_xact_lock(hashtextextended('registrar_visita_fuera_de_rol:' || v_rol_id::text, 0));

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

  select * into v_parada
    from public.paradas
   where rol_visita_id = v_rol_id
     and cliente_id = p_cliente_id
   order by (direccion_id is not distinct from p_direccion_id) desc, orden
   limit 1;

  if found then
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

  update public.notas_pedido
     set parada_id = v_parada.id
   where id = any (p_nota_ids)
     and vendedor_id = auth.uid()
     and parada_id is null;

  return v_parada;
end;
$function$;

-- ── crear_notas_pedido ───────────────────────────────────────────────────────
-- Guard por nota: no se le puede hacer una nota a un cliente no operable. La
-- nota "a mano" (sin cliente_id) y el provisorio recién cargado siguen andando.
create or replace function public.crear_notas_pedido(p_notas jsonb)
returns table(orden_nota integer, nota_id uuid, nota_numero bigint, nota_estado text)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  vendedor  uuid := auth.uid();
  a_numerar int;
  siguiente bigint;
  elem      jsonb;
  it        jsonb;
  n         public.notas_pedido;
  renglon   public.notas_pedido_items;
  i         int := 0;
  j         int;
  ids       uuid[] := '{}';
begin
  if vendedor is null then
    raise exception 'No hay sesion' using errcode = '42501';
  end if;
  if not interno.esta_habilitado() then
    raise exception 'Tu usuario todavia no esta habilitado' using errcode = '42501';
  end if;
  if p_notas is null
     or jsonb_typeof(p_notas) <> 'array'
     or jsonb_array_length(p_notas) = 0 then
    raise exception 'No hay notas para crear' using errcode = '22023';
  end if;

  -- Las que quedan esperando el codigo de cliente no gastan numero.
  select count(*) into a_numerar
    from jsonb_array_elements(p_notas) e
   where coalesce(e -> 'nota' ->> 'estado', 'pendiente') <> 'pendiente_cliente';

  -- Un solo pedido al talonario: los numeros salen seguidos y nadie se mete
  -- en el medio.
  if a_numerar > 0 then
    siguiente := interno.tomar_numeros(a_numerar);
  end if;

  for elem in select value from jsonb_array_elements(p_notas)
  loop
    i := i + 1;

    n := jsonb_populate_record(null::public.notas_pedido, elem -> 'nota');

    -- No se le hace nota a un cliente no habilitado (salvo oficina o provisorio).
    if not interno.cliente_operable(n.cliente_id) then
      raise exception 'No se puede hacer una nota a un cliente no habilitado (%). Avisá a la oficina.',
        coalesce(n.cliente_codigo, n.cliente_nombre, n.cliente_id::text)
        using errcode = '42501';
    end if;

    -- El vendedor sale de la sesion, no del pedido: es lo que antes garantizaba
    -- la politica de RLS y no se puede aflojar por estar del lado del servidor.
    n.id          := extensions.gen_random_uuid();
    n.vendedor_id := vendedor;
    n.estado      := coalesce(n.estado, 'pendiente');
    n.variante    := coalesce(n.variante, 'produccion');

    n.datos_cliente_origen           := coalesce(n.datos_cliente_origen, 'texto');
    n.descripcion_herramienta_origen := coalesce(n.descripcion_herramienta_origen, 'texto');
    n.observaciones                  := coalesce(n.observaciones, '{}');
    n.servicios                      := coalesce(n.servicios, '{}');

    -- El instante exacto de ESTA nota, al microsegundo.
    n.creado_en      := clock_timestamp();
    n.actualizado_en := n.creado_en;

    if n.estado = 'pendiente_cliente' then
      n.numero := null;
    else
      n.numero  := siguiente;
      siguiente := siguiente + 1;
    end if;

    insert into public.notas_pedido select (n).*;
    ids := ids || n.id;

    j := 0;
    for it in select value from jsonb_array_elements(coalesce(elem -> 'items', '[]'::jsonb))
    loop
      j := j + 1;
      renglon := jsonb_populate_record(null::public.notas_pedido_items, it);
      renglon.id              := extensions.gen_random_uuid();
      renglon.nota_id         := n.id;
      renglon.orden           := coalesce(renglon.orden, j);
      renglon.cantidad        := coalesce(renglon.cantidad, 1);
      renglon.moneda          := coalesce(renglon.moneda, 'ARS');
      renglon.codigos_computo := coalesce(renglon.codigos_computo, '{}');
      renglon.promocion       := coalesce(renglon.promocion, false);
      renglon.dientes_rotos   := coalesce(renglon.dientes_rotos, false);
      renglon.detalle         := coalesce(renglon.detalle, '{}'::jsonb);
      renglon.creado_en       := clock_timestamp();
      insert into public.notas_pedido_items select (renglon).*;
    end loop;

    -- Una nota sin renglones no sirve para nada y ensucia la lista de
    -- pendientes. Aca deshace la carga entera, que es lo que corresponde.
    if j = 0 then
      raise exception 'La nota % quedo sin renglones', i using errcode = '22023';
    end if;

    orden_nota  := i;
    nota_id     := n.id;
    nota_numero := n.numero;
    nota_estado := n.estado::text;
    return next;
  end loop;

  -- "Va con nota de pedido 02-0011, 02-0012".
  if a_numerar > 1 then
    update public.notas_pedido destino
       set observaciones = destino.observaciones || array[
             'Va con nota de pedido ' || (
               select string_agg(
                        interno.numero_de_nota_impreso(otras.numero, otras.vendedor_numero),
                        ', ' order by otras.numero)
                 from public.notas_pedido otras
                where otras.id = any(ids)
                  and otras.numero is not null
                  and otras.id <> destino.id
             )
           ]
     where destino.id = any(ids)
       and destino.numero is not null;
  end if;
end;
$function$;
