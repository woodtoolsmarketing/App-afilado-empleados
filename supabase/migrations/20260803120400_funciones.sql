-- =============================================================================
-- WoodTools · Rol de Visita
-- 0005 · Funciones, triggers y lógica de negocio
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Utilidades
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function interno.tocar_actualizado_en()
returns trigger
language plpgsql
as $$
begin
  new.actualizado_en := now();
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'perfiles', 'clientes', 'direcciones', 'roles_visita', 'paradas', 'visitas'
  ] loop
    execute format(
      'create trigger %I_tocar_actualizado before update on public.%I
         for each row execute function interno.tocar_actualizado_en()',
      t, t
    );
  end loop;
end;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- Helpers de identidad
--
-- Son SECURITY DEFINER a propósito: leen public.perfiles salteándose RLS, y así
-- las políticas pueden usarlos sin caer en recursión infinita. Además leen
-- siempre el estado actual de la base, no el que quedó congelado en el JWT
-- (importante: si un admin suspende a alguien, deja de entrar al instante y no
-- dentro de una hora, cuando venza el token).
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function interno.rol_actual()
returns public.rol_usuario
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select rol from public.perfiles where id = auth.uid();
$$;

create or replace function interno.estado_actual()
returns public.estado_usuario
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select estado from public.perfiles where id = auth.uid();
$$;

create or replace function interno.esta_habilitado()
returns boolean
language sql
stable
as $$
  select interno.estado_actual() = 'aprobado';
$$;

create or replace function interno.es_admin()
returns boolean
language sql
stable
as $$
  select interno.rol_actual() = 'admin' and interno.esta_habilitado();
$$;

-- Admin o supervisor: puede ver todo, pero el supervisor no modifica altas.
create or replace function interno.puede_ver_todo()
returns boolean
language sql
stable
as $$
  select interno.rol_actual() in ('admin', 'supervisor') and interno.esta_habilitado();
$$;

-- Las políticas de RLS y los CHECK que llaman a estas funciones se evalúan con
-- el rol que ejecuta la consulta: sin estos permisos, cualquier SELECT falla con
-- "permission denied for function". El esquema sigue cerrado para todo lo demás.
grant usage on schema interno to authenticated;
grant execute on function
  interno.rol_actual(),
  interno.estado_actual(),
  interno.esta_habilitado(),
  interno.es_admin(),
  interno.puede_ver_todo(),
  interno.observacion_valida(text)
to authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- Alta de usuarios
--
-- Todo usuario que se registra queda en estado 'pendiente'. No entra a la app
-- hasta que un administrador lo apruebe.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.manejar_nuevo_usuario()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.perfiles (id, email, nombre_completo, codigo_vendedor, rol, estado)
  values (
    new.id,
    new.email,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'nombre_completo'), ''), split_part(new.email, '@', 1)),
    nullif(trim(new.raw_user_meta_data ->> 'codigo_vendedor'), ''),
    'vendedor',
    'pendiente'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

create trigger al_crear_usuario
  after insert on auth.users
  for each row execute function public.manejar_nuevo_usuario();


-- Claims extra en el JWT (rol y estado), para que la app sepa qué mostrar sin
-- pedir el perfil primero. La autorización real igual se decide en RLS.
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  perfil   public.perfiles;
  claims   jsonb;
begin
  select * into perfil from public.perfiles where id = (event ->> 'user_id')::uuid;

  claims := coalesce(event -> 'claims', '{}'::jsonb);

  if perfil.id is not null then
    claims := jsonb_set(claims, '{rol}',             to_jsonb(perfil.rol::text));
    claims := jsonb_set(claims, '{estado}',          to_jsonb(perfil.estado::text));
    claims := jsonb_set(claims, '{codigo_vendedor}', to_jsonb(coalesce(perfil.codigo_vendedor, '')));
  else
    claims := jsonb_set(claims, '{rol}',    '"vendedor"'::jsonb);
    claims := jsonb_set(claims, '{estado}', '"pendiente"'::jsonb);
  end if;

  return jsonb_set(event, '{claims}', claims);

exception when others then
  -- Si este hook lanza una excepción, NADIE puede iniciar sesión ni refrescar
  -- el token, incluidos los administradores. Ante cualquier error devolvemos el
  -- evento sin tocar: se pierden los claims extra, no el acceso al sistema.
  -- La autorización real la decide RLS, no estos claims.
  return event;
end;
$$;

grant usage  on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;
grant select on table public.perfiles to supabase_auth_admin;


-- Aprobar / rechazar un alta. Sólo administradores.
create or replace function public.resolver_alta_usuario(
  p_perfil_id uuid,
  p_aprobar   boolean,
  p_rol       public.rol_usuario default 'vendedor',
  p_codigo    text default null,
  p_motivo    text default null
)
returns public.perfiles
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  resultado public.perfiles;
begin
  if not interno.es_admin() then
    raise exception 'Sólo un administrador puede resolver altas de usuario'
      using errcode = '42501';
  end if;

  update public.perfiles
     set estado          = case when p_aprobar then 'aprobado' else 'rechazado' end,
         rol             = case when p_aprobar then p_rol else rol end,
         codigo_vendedor = coalesce(nullif(trim(p_codigo), ''), codigo_vendedor),
         aprobado_por    = auth.uid(),
         aprobado_en     = now(),
         motivo_rechazo  = case when p_aprobar then null else p_motivo end
   where id = p_perfil_id
  returning * into resultado;

  if resultado.id is null then
    raise exception 'No existe el perfil %', p_perfil_id using errcode = 'P0002';
  end if;

  insert into public.auditoria (actor_id, accion, entidad, entidad_id, datos)
  values (
    auth.uid(),
    case when p_aprobar then 'usuario.aprobado' else 'usuario.rechazado' end,
    'perfiles', p_perfil_id::text,
    jsonb_build_object('rol', p_rol, 'codigo', p_codigo, 'motivo', p_motivo)
  );

  return resultado;
end;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- Orden por cercanía (vecino más cercano)
--
-- Es el orden que se usa cuando no hay conexión para llamar a Google, y también
-- como semilla de la optimización. Recorre las paradas eligiendo siempre la más
-- próxima a la anterior, arrancando desde el origen del vendedor.
-- ─────────────────────────────────────────────────────────────────────────────

-- Rango de numeración temporal usado al reordenar. Está muy por encima de
-- cualquier orden real (el tope operativo son 25 paradas por jornada), así que
-- una fila a medio reordenar nunca choca con una definitiva.
create or replace function interno.orden_temporal()
returns integer
language sql
immutable
parallel safe
as $$ select 1000000; $$;

grant execute on function interno.orden_temporal() to authenticated;


create or replace function public.ordenar_paradas_por_cercania(
  p_rol_visita_id uuid,
  p_desde_lat     double precision default null,
  p_desde_lng     double precision default null
)
returns void
language plpgsql
security invoker
set search_path = public, extensions, pg_temp
as $$
declare
  punto_actual extensions.geography;
  siguiente    uuid;
  posicion     integer;
  colocadas    uuid[] := '{}';
begin
  -- Las paradas ya resueltas conservan su lugar; sólo se reordena lo pendiente,
  -- que se numera a continuación de ellas.
  select coalesce(count(*), 0) into posicion
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

  -- Sin origen conocido no hay forma de ordenar por cercanía: se deja como está.
  if punto_actual is null then
    return;
  end if;

  -- Se numera en dos tiempos, usando un rango temporal muy por encima de
  -- cualquier orden real. El índice único (rol_visita_id, orden) es DEFERRABLE,
  -- pero así ninguna fila intermedia colisiona ni viola el CHECK de orden > 0
  -- (los CHECK no se pueden diferir).
  loop
    -- Prioridad alta primero (siempre van adelante), después el más cercano.
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
$$;

comment on function public.ordenar_paradas_por_cercania is
  'Ordena las paradas pendientes por vecino más cercano usando PostGIS. Respeta las paradas ya visitadas y las de prioridad alta.';


-- ─────────────────────────────────────────────────────────────────────────────
-- Agregar un destino en ruta, respetando la prioridad
--
--  · alta  → próximo destino, sin importar la cercanía
--  · media → 2-3 destinos más adelante (configurable)
--  · baja  → se reordena por cercanía junto con el resto
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.agregar_parada(
  p_rol_visita_id uuid,
  p_direccion_id  uuid,
  p_prioridad     public.prioridad_parada,
  p_cliente_id    uuid default null
)
returns public.paradas
language plpgsql
security invoker
set search_path = public, extensions, pg_temp
as $$
declare
  ultima_resuelta integer;
  offset_media    integer;
  destino_orden   integer;
  total_pendiente integer;
  nueva           public.paradas;
  snapshot_dir    text;
  snapshot_cli    text;
begin
  -- Posición de la última parada ya resuelta: nada se inserta antes de eso.
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
    when 'media' then ultima_resuelta + least(offset_media, total_pendiente + 1)
    else              ultima_resuelta + total_pendiente + 1
  end;

  select d.direccion_formateada, c.razon_social
    into snapshot_dir, snapshot_cli
    from public.direcciones d
    left join public.clientes c on c.id = coalesce(p_cliente_id, d.cliente_id)
   where d.id = p_direccion_id;

  -- Hueco para la nueva parada (el índice único es DEFERRABLE).
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

  -- La prioridad baja se acomoda por cercanía junto al resto.
  if p_prioridad = 'baja' then
    perform public.ordenar_paradas_por_cercania(p_rol_visita_id);
    select * into nueva from public.paradas where id = nueva.id;
  end if;

  return nueva;
end;
$$;

comment on function public.agregar_parada is
  'Inserta un destino en el recorrido según la prioridad elegida en "AGREGAR NUEVO DESTINO".';


-- ─────────────────────────────────────────────────────────────────────────────
-- Ciclo de vida del recorrido
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.iniciar_recorrido(
  p_rol_visita_id uuid,
  p_lat           double precision,
  p_lng           double precision
)
returns public.roles_visita
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  jornada public.roles_visita;
begin
  update public.roles_visita
     set estado      = 'en_curso',
         iniciado_en = coalesce(iniciado_en, now()),
         origen_lat  = p_lat,
         origen_lng  = p_lng
   where id = p_rol_visita_id
     and estado in ('planificado', 'en_curso')
  returning * into jornada;

  if jornada.id is null then
    raise exception 'No se pudo iniciar el recorrido % (¿ya está finalizado?)', p_rol_visita_id
      using errcode = 'P0002';
  end if;

  -- Se reordena con la ubicación real de arranque.
  perform public.ordenar_paradas_por_cercania(p_rol_visita_id, p_lat, p_lng);

  update public.paradas
     set estado = 'en_camino'
   where rol_visita_id = p_rol_visita_id
     and estado = 'pendiente'
     and orden = (
       select min(orden) from public.paradas
        where rol_visita_id = p_rol_visita_id and estado = 'pendiente'
     );

  insert into public.posiciones_actuales (vendedor_id, rol_visita_id, lat, lng, en_recorrido, actualizado_en)
  values (jornada.vendedor_id, p_rol_visita_id, p_lat, p_lng, true, now())
  on conflict (vendedor_id) do update
     set rol_visita_id = excluded.rol_visita_id,
         lat = excluded.lat, lng = excluded.lng,
         en_recorrido = true, actualizado_en = now();

  return jornada;
end;
$$;


create or replace function public.finalizar_recorrido(p_rol_visita_id uuid)
returns public.roles_visita
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  jornada public.roles_visita;
begin
  update public.paradas
     set estado = 'omitida'
   where rol_visita_id = p_rol_visita_id
     and estado in ('pendiente', 'en_camino');

  update public.roles_visita
     set estado        = 'finalizado',
         finalizado_en = now()
   where id = p_rol_visita_id
  returning * into jornada;

  update public.posiciones_actuales
     set en_recorrido = false, actualizado_en = now()
   where rol_visita_id = p_rol_visita_id;

  return jornada;
end;
$$;


-- Registra el parte de una parada y avanza el recorrido, todo en una operación
-- atómica: o queda registrada la visita y la siguiente parada pasa a
-- 'en_camino', o no pasa nada.
create or replace function public.registrar_visita(
  p_parada_id        uuid,
  p_visitado         boolean,
  p_vendio           boolean default false,
  p_cobro            boolean default false,
  p_retiro_afilado   boolean default false,
  p_entrego          boolean default false,
  p_motivo           public.motivo_no_visita default null,
  p_contacto         text default null,
  p_observacion      text default '',
  p_observacion_origen public.origen_observacion default 'texto',
  p_audio_url        text default null,
  p_lat              double precision default null,
  p_lng              double precision default null,
  p_precision_m      real default null
)
returns public.visitas
language plpgsql
security invoker
set search_path = public, extensions, pg_temp
as $$
declare
  parada    public.paradas;
  jornada   public.roles_visita;
  registro  public.visitas;
  desvio    integer;
begin
  select * into parada from public.paradas where id = p_parada_id;
  if parada.id is null then
    raise exception 'No existe la parada %', p_parada_id using errcode = 'P0002';
  end if;

  select * into jornada from public.roles_visita where id = parada.rol_visita_id;

  if not interno.observacion_valida(p_observacion) then
    raise exception 'La observación es obligatoria: escribí al menos una frase describiendo qué pasó en la visita.'
      using errcode = '23514';
  end if;

  -- Distancia entre donde se firmó el parte y la dirección del cliente.
  if p_lat is not null then
    select round(extensions.st_distance(
             d.ubicacion,
             extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography
           ))::int
      into desvio
      from public.direcciones d
     where d.id = parada.direccion_id;
  end if;

  insert into public.visitas (
    parada_id, rol_visita_id, vendedor_id, cliente_id,
    visitado, vendio, cobro, retiro_afilado, entrego,
    motivo_no_visita, contacto_nombre,
    observacion, observacion_origen, observacion_audio_url,
    lat, lng, precision_m, desvio_m
  ) values (
    p_parada_id, parada.rol_visita_id, jornada.vendedor_id, parada.cliente_id,
    p_visitado,
    p_visitado and p_vendio,
    p_visitado and p_cobro,
    p_visitado and p_retiro_afilado,
    p_visitado and p_entrego,
    case when p_visitado then null else p_motivo end,
    nullif(trim(p_contacto), ''),
    trim(p_observacion), p_observacion_origen, p_audio_url,
    p_lat, p_lng, p_precision_m, desvio
  )
  on conflict (parada_id) do update set
    visitado = excluded.visitado,
    vendio = excluded.vendio, cobro = excluded.cobro,
    retiro_afilado = excluded.retiro_afilado, entrego = excluded.entrego,
    motivo_no_visita = excluded.motivo_no_visita,
    contacto_nombre = excluded.contacto_nombre,
    observacion = excluded.observacion,
    observacion_origen = excluded.observacion_origen,
    observacion_audio_url = excluded.observacion_audio_url,
    lat = excluded.lat, lng = excluded.lng,
    precision_m = excluded.precision_m, desvio_m = excluded.desvio_m,
    actualizado_en = now()
  returning * into registro;

  update public.paradas
     set estado     = case when p_visitado then 'visitada' else 'no_visitada' end,
         llegada_en = coalesce(llegada_en, now()),
         salida_en  = now()
   where id = p_parada_id;

  -- La siguiente parada pendiente pasa a "en camino".
  update public.paradas
     set estado = 'en_camino'
   where id = (
     select id from public.paradas
      where rol_visita_id = parada.rol_visita_id
        and estado = 'pendiente'
      order by orden
      limit 1
   );

  return registro;
end;
$$;

comment on function public.registrar_visita is
  'Guarda el formulario "¿Destino visitado?" y avanza el recorrido de forma atómica.';
