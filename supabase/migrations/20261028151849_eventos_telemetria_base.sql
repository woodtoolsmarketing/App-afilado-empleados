-- ============================================================================
-- Telemetria de tiempos de uso + mapa de calor
--
-- Mide cuanto tiempo pasa cada usuario en cada opcion de la app y en cada
-- seccion del panel (append-only, estilo `posiciones`). La MEDICION es para
-- todos; el REPORTE agregado (mapa de calor) lo ven SOLO quienes tengan el
-- flag `perfiles.ve_reporte_tiempos` (hoy: Admin Master #27 y Ariel Sosa #12).
--
-- Esto es cronometraje de USO (pantallas, pasos, duraciones), NO ubicacion:
-- no agrega permisos de GPS ni nada del seguimiento 24/7.
-- ============================================================================

-- 1) Flag por-usuario: quien ve el reporte agregado --------------------------
alter table public.perfiles
  add column if not exists ve_reporte_tiempos boolean not null default false;

comment on column public.perfiles.ve_reporte_tiempos is
  'Si true, el usuario ve el reporte/mapa de calor de tiempos de uso de TODA la flota. Se administra desde el panel (Usuarios). Default false.';

-- Admin Master (#27) y Ariel Sosa (#12), por id (hay otro "Ariel Sosa" #99).
update public.perfiles
   set ve_reporte_tiempos = true
 where id in ('0d457f67-3e0a-4dfd-806c-73a7092f39e9',
              '6c44b113-2a46-4169-a769-7f9c7ed4c74f');

-- 2) Guard de auto-edicion: que un no-admin no se auto-otorgue el flag --------
-- La policy perfiles_editar_propio depende de esta funcion: recreamos ambas
-- (DROP + CREATE; no CREATE OR REPLACE porque cambia la firma).
drop policy if exists perfiles_editar_propio on public.perfiles;
drop function if exists interno.solo_edita_lo_propio(rol_usuario, estado_usuario, boolean, text, text[], text, text, uuid, timestamptz, text, boolean);

create function interno.solo_edita_lo_propio(
  p_rol rol_usuario, p_estado estado_usuario, p_ve_ubicacion boolean,
  p_codigo text, p_zonas text[], p_email text, p_usuario text,
  p_aprobado_por uuid, p_aprobado_en timestamptz, p_motivo text,
  p_imprime_roles boolean, p_ve_reporte_tiempos boolean default false
) returns boolean
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select exists (
    select 1 from public.perfiles
    where id = auth.uid()
      and rol = p_rol
      and estado = p_estado
      and ve_ubicacion_de_notas is not distinct from p_ve_ubicacion
      and codigo_vendedor is not distinct from p_codigo
      and zonas is not distinct from p_zonas
      and email is not distinct from p_email
      and usuario is not distinct from p_usuario
      and aprobado_por is not distinct from p_aprobado_por
      and aprobado_en is not distinct from p_aprobado_en
      and motivo_rechazo is not distinct from p_motivo
      and imprime_roles is not distinct from p_imprime_roles
      and ve_reporte_tiempos is not distinct from p_ve_reporte_tiempos
  )
$$;

create policy perfiles_editar_propio on public.perfiles
  for update to public
  using ((id = auth.uid()) and interno.esta_habilitado())
  with check ((id = auth.uid()) and interno.solo_edita_lo_propio(
    rol, estado, ve_ubicacion_de_notas, codigo_vendedor, zonas, email, usuario,
    aprobado_por, aprobado_en, motivo_rechazo, imprime_roles, ve_reporte_tiempos));

-- 3) Helper de visibilidad del reporte (molde: puede_ver_ubicacion_de_notas) -
create or replace function interno.ve_reporte_tiempos()
returns boolean
language sql stable
set search_path to 'public', 'pg_temp'
as $$
  select coalesce(
    (select p.ve_reporte_tiempos
       from public.perfiles p
      where p.id = auth.uid()
        and p.estado = 'aprobado'),
    false);
$$;
comment on function interno.ve_reporte_tiempos() is
  'True si el usuario puede ver el reporte/mapa de calor de tiempos de uso (flag perfiles.ve_reporte_tiempos). Molde: puede_ver_ubicacion_de_notas.';

-- 4) Tabla append-only de eventos de uso (molde: posiciones) -----------------
create table if not exists public.eventos_telemetria (
  id             bigint generated always as identity primary key,
  perfil_id      uuid not null references public.perfiles(id) on delete cascade,
  plataforma     text not null check (plataforma in ('app', 'panel')),
  seccion        text not null,
  paso           text,
  inicio         timestamptz not null,
  duracion_ms    integer not null check (duracion_ms >= 0 and duracion_ms <= 86400000),
  metadata       jsonb not null default '{}'::jsonb,
  version_app    text,
  dispositivo_id uuid references public.dispositivos(id) on delete set null,
  registrado_en  timestamptz not null default now()
);
comment on table public.eventos_telemetria is
  'Cronometro de uso: un renglon por tramo que el usuario paso en una opcion/seccion (app o panel). Append-only, se poda a los 90 dias. La duracion la mide el equipo; registrado_en lo pone el servidor.';

create index if not exists eventos_telemetria_perfil_inicio_idx on public.eventos_telemetria (perfil_id, inicio desc);
create index if not exists eventos_telemetria_opcion_idx on public.eventos_telemetria (plataforma, seccion, paso);
create index if not exists eventos_telemetria_registrado_idx on public.eventos_telemetria (registrado_en);

alter table public.eventos_telemetria enable row level security;
revoke all on public.eventos_telemetria from anon;
grant select, insert on public.eventos_telemetria to authenticated;

create policy eventos_telemetria_insertar on public.eventos_telemetria
  for insert to authenticated
  with check (perfil_id = (select auth.uid()) and (select interno.esta_habilitado()));

create policy eventos_telemetria_leer on public.eventos_telemetria
  for select to authenticated
  using ((select interno.ve_reporte_tiempos()) or perfil_id = (select auth.uid()));

create policy eventos_telemetria_admin on public.eventos_telemetria
  for all to authenticated
  using ((select interno.es_admin())) with check ((select interno.es_admin()));

-- 5) RPC de ingesta en lote (molde: crear_notas_pedido) ----------------------
create or replace function public.registrar_eventos_telemetria(p_eventos jsonb)
returns integer
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_uid uuid := auth.uid();
  v_insertados integer;
begin
  if v_uid is null then
    raise exception 'No hay sesion' using errcode = '42501';
  end if;
  if not interno.esta_habilitado() then
    raise exception 'Usuario no habilitado' using errcode = '42501';
  end if;
  if p_eventos is null or jsonb_typeof(p_eventos) <> 'array' then
    return 0;
  end if;

  insert into public.eventos_telemetria
    (perfil_id, plataforma, seccion, paso, inicio, duracion_ms, metadata, version_app, dispositivo_id)
  select
    v_uid,
    e.plataforma,
    e.seccion,
    nullif(e.paso, ''),
    coalesce(e.inicio, now()),
    least(greatest(coalesce(e.duracion_ms, 0), 0), 86400000),
    coalesce(e.metadata, '{}'::jsonb),
    e.version_app,
    e.dispositivo_id
  from jsonb_to_recordset(p_eventos) as e(
    plataforma text, seccion text, paso text, inicio timestamptz,
    duracion_ms integer, metadata jsonb, version_app text, dispositivo_id uuid
  )
  where e.plataforma in ('app', 'panel')
    and e.seccion is not null;

  get diagnostics v_insertados = row_count;
  return v_insertados;
end;
$$;
revoke execute on function public.registrar_eventos_telemetria(jsonb) from anon;
revoke execute on function public.registrar_eventos_telemetria(jsonb) from public;
grant execute on function public.registrar_eventos_telemetria(jsonb) to authenticated;

-- 6) Objetivos de tiempo (parametrizar) + RPC de edicion ---------------------
create table if not exists public.objetivos_tiempo_uso (
  id              bigint generated always as identity primary key,
  plataforma      text not null check (plataforma in ('app', 'panel')),
  seccion         text not null,
  paso            text,
  objetivo_ms     integer not null check (objetivo_ms > 0 and objetivo_ms <= 86400000),
  actualizado_por uuid references public.perfiles(id) on delete set null,
  actualizado_en  timestamptz not null default now()
);
comment on table public.objetivos_tiempo_uso is
  'Tiempo objetivo (parametro) por opcion/paso, para colorear el mapa de calor (rojo = supera el objetivo). Lo editan quienes tienen ve_reporte_tiempos.';
create unique index if not exists objetivos_tiempo_uso_opcion_key
  on public.objetivos_tiempo_uso (plataforma, seccion, coalesce(paso, ''));

alter table public.objetivos_tiempo_uso enable row level security;
revoke all on public.objetivos_tiempo_uso from anon;
grant select on public.objetivos_tiempo_uso to authenticated;

create policy objetivos_tiempo_uso_leer on public.objetivos_tiempo_uso
  for select to authenticated
  using ((select interno.ve_reporte_tiempos()));

create or replace function public.fijar_objetivo_tiempo(
  p_plataforma text, p_seccion text, p_paso text, p_objetivo_ms integer
) returns void
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if not interno.ve_reporte_tiempos() then
    raise exception 'No tenes permiso' using errcode = '42501';
  end if;
  if p_plataforma not in ('app', 'panel') then
    raise exception 'Plataforma invalida' using errcode = '22023';
  end if;
  if p_objetivo_ms is null or p_objetivo_ms <= 0 then
    delete from public.objetivos_tiempo_uso
     where plataforma = p_plataforma and seccion = p_seccion
       and coalesce(paso, '') = coalesce(nullif(p_paso, ''), '');
    return;
  end if;
  insert into public.objetivos_tiempo_uso (plataforma, seccion, paso, objetivo_ms, actualizado_por, actualizado_en)
  values (p_plataforma, p_seccion, nullif(p_paso, ''), least(p_objetivo_ms, 86400000), auth.uid(), now())
  on conflict (plataforma, seccion, coalesce(paso, ''))
  do update set objetivo_ms = excluded.objetivo_ms, actualizado_por = excluded.actualizado_por, actualizado_en = now();
end;
$$;
revoke execute on function public.fijar_objetivo_tiempo(text, text, text, integer) from anon;
revoke execute on function public.fijar_objetivo_tiempo(text, text, text, integer) from public;
grant execute on function public.fijar_objetivo_tiempo(text, text, text, integer) to authenticated;

-- 7) RPC de agregacion para el mapa de calor (admin master + #12) ------------
create or replace function public.heatmap_telemetria(
  p_desde date default null,
  p_hasta date default null,
  p_plataforma text default null,
  p_perfil_id uuid default null
) returns table (
  perfil_id       uuid,
  nombre          text,
  codigo_vendedor text,
  plataforma      text,
  seccion         text,
  paso            text,
  eventos         bigint,
  total_ms        bigint,
  promedio_ms     numeric,
  mediana_ms      double precision,
  p95_ms          double precision,
  objetivo_ms     integer,
  ultimo          timestamptz
)
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if not interno.ve_reporte_tiempos() then
    raise exception 'No tenes permiso para ver el reporte de tiempos' using errcode = '42501';
  end if;
  return query
    select
      e.perfil_id,
      p.nombre_completo,
      p.codigo_vendedor,
      e.plataforma,
      e.seccion,
      e.paso,
      count(*)::bigint,
      sum(e.duracion_ms)::bigint,
      round(avg(e.duracion_ms), 0),
      percentile_cont(0.5) within group (order by e.duracion_ms),
      percentile_cont(0.95) within group (order by e.duracion_ms),
      o.objetivo_ms,
      max(e.inicio)
    from public.eventos_telemetria e
    join public.perfiles p on p.id = e.perfil_id
    left join public.objetivos_tiempo_uso o
      on o.plataforma = e.plataforma
     and o.seccion = e.seccion
     and coalesce(o.paso, '') = coalesce(e.paso, '')
    where (p_desde is null or e.inicio >= p_desde)
      and (p_hasta is null or e.inicio < (p_hasta + 1))
      and (p_plataforma is null or e.plataforma = p_plataforma)
      and (p_perfil_id is null or e.perfil_id = p_perfil_id)
    group by e.perfil_id, p.nombre_completo, p.codigo_vendedor, e.plataforma, e.seccion, e.paso, o.objetivo_ms
    order by sum(e.duracion_ms) desc;
end;
$$;
revoke execute on function public.heatmap_telemetria(date, date, text, uuid) from anon;
revoke execute on function public.heatmap_telemetria(date, date, text, uuid) from public;
grant execute on function public.heatmap_telemetria(date, date, text, uuid) to authenticated;
