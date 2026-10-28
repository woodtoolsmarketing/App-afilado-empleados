-- ============================================================================
-- Ajustes post-revisión de la telemetría de tiempos
--
-- (1) Ingesta robusta: duracion_ms se lee como `numeric` y recién se clampa a
--     int, para que un reloj saltado (duración > 2^31 ms) no reviente el lote y
--     trabe la cola offline (poison pill).
-- (2) El mapa de calor agrupa por día en hora LOCAL (America/Argentina/
--     Buenos_Aires), no en UTC: antes los eventos de la tardecita caían en el
--     día siguiente.
-- (3) Se cierra la lectura/escritura CRUDA: sólo se inserta por la RPC (SECURITY
--     DEFINER, que corre como dueño y saltea RLS) y sólo leen la tabla quienes
--     tienen ve_reporte_tiempos (o su propia fila). Se quitan la policy de insert
--     directo y la policy ALL de admin, que dejaba a CUALQUIER admin leer los
--     tiempos crudos de toda la flota salteando el flag (justo lo que no se quiere).
--     La poda futura se hará por una función SECURITY DEFINER o el service role.
-- ============================================================================

-- (1) registrar_eventos_telemetria: duracion_ms como numeric antes del clamp
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
    least(greatest(coalesce(e.duracion_ms, 0), 0), 86400000)::int,
    coalesce(e.metadata, '{}'::jsonb),
    e.version_app,
    e.dispositivo_id
  from jsonb_to_recordset(p_eventos) as e(
    plataforma text, seccion text, paso text, inicio timestamptz,
    duracion_ms numeric, metadata jsonb, version_app text, dispositivo_id uuid
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

-- (2) heatmap_telemetria: filtro por día en hora local
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
    where (p_desde is null or (e.inicio at time zone 'America/Argentina/Buenos_Aires')::date >= p_desde)
      and (p_hasta is null or (e.inicio at time zone 'America/Argentina/Buenos_Aires')::date <= p_hasta)
      and (p_plataforma is null or e.plataforma = p_plataforma)
      and (p_perfil_id is null or e.perfil_id = p_perfil_id)
    group by e.perfil_id, p.nombre_completo, p.codigo_vendedor, e.plataforma, e.seccion, e.paso, o.objetivo_ms
    order by sum(e.duracion_ms) desc;
end;
$$;
revoke execute on function public.heatmap_telemetria(date, date, text, uuid) from anon;
revoke execute on function public.heatmap_telemetria(date, date, text, uuid) from public;
grant execute on function public.heatmap_telemetria(date, date, text, uuid) to authenticated;

-- (3) cerrar la lectura/escritura cruda: sólo RPC inserta; sólo el flag (o la
-- propia fila) lee. La RPC es SECURITY DEFINER (dueño) y no necesita policy de insert.
drop policy if exists eventos_telemetria_insertar on public.eventos_telemetria;
drop policy if exists eventos_telemetria_admin on public.eventos_telemetria;
revoke insert on public.eventos_telemetria from authenticated;
