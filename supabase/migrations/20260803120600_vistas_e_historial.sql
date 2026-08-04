-- =============================================================================
-- WoodTools · Rol de Visita
-- 0007 · Vistas de consulta, historial y archivado a los 90 días
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- vista_rol_de_visita — la planilla completa, tal cual el PDF en papel
-- ─────────────────────────────────────────────────────────────────────────────
create or replace view public.vista_rol_de_visita
with (security_invoker = true) as
select
  rv.id                       as rol_visita_id,
  rv.fecha,
  rv.estado                   as estado_jornada,
  p.id                        as vendedor_id,
  p.nombre_completo           as vendedor,
  p.codigo_vendedor           as codigo,

  pa.id                       as parada_id,
  pa.orden                    as nro,
  pa.estado                   as estado_parada,
  pa.prioridad,
  pa.origen                   as origen_parada,
  pa.llegada_en               as hora,
  pa.hora_estimada,
  pa.distancia_desde_anterior_m,
  pa.duracion_desde_anterior_seg,

  c.codigo                    as cliente_nro,
  coalesce(c.razon_social, pa.razon_social_snapshot, 'Destino sin cliente') as razon_social,
  coalesce(d.direccion_formateada, pa.direccion_snapshot) as direccion,
  d.codigo_postal,
  d.lat, d.lng,

  v.visitado,
  v.vendio,
  v.cobro,
  v.retiro_afilado,
  v.entrego,
  v.motivo_no_visita,
  coalesce(v.contacto_nombre, c.contacto_nombre) as contacto,
  v.observacion,
  v.observacion_origen,
  v.observacion_audio_url,
  v.desvio_m,
  v.registrado_en
from public.roles_visita rv
join public.perfiles     p  on p.id = rv.vendedor_id
join public.paradas      pa on pa.rol_visita_id = rv.id
join public.direcciones  d  on d.id = pa.direccion_id
left join public.clientes c on c.id = pa.cliente_id
left join public.visitas  v on v.parada_id = pa.id;
-- Sin ORDER BY en la vista: cada consumidor ordena como necesita, y así el
-- planificador no arrastra un sort que después se descarta.

comment on view public.vista_rol_de_visita is
  'Reproduce la planilla "Rol de Visita" completa: Nº, hora, cliente, razón social, tipo de visita, contacto y observaciones.';


-- ─────────────────────────────────────────────────────────────────────────────
-- vista_envios_de_hoy — lo que la app muestra en "TUS ENVÍOS DE HOY SON: 13"
-- ─────────────────────────────────────────────────────────────────────────────
create or replace view public.vista_resumen_jornada
with (security_invoker = true) as
select
  rv.id                                              as rol_visita_id,
  rv.vendedor_id,
  rv.fecha,
  rv.estado,
  rv.iniciado_en,
  rv.finalizado_en,
  rv.distancia_total_m,
  rv.duracion_total_seg,
  count(pa.id)                                       as total_paradas,
  count(pa.id) filter (where pa.estado = 'pendiente')   as pendientes,
  count(pa.id) filter (where pa.estado = 'en_camino')   as en_camino,
  count(pa.id) filter (where pa.estado = 'visitada')    as visitadas,
  count(pa.id) filter (where pa.estado = 'no_visitada') as no_visitadas,
  count(pa.id) filter (where pa.estado = 'omitida')     as omitidas,
  count(v.id)  filter (where v.vendio)                  as con_venta,
  count(v.id)  filter (where v.cobro)                   as con_cobro,
  count(v.id)  filter (where v.retiro_afilado)          as con_retiro_afilado,
  count(v.id)  filter (where v.entrego)                 as con_entrega
from public.roles_visita rv
left join public.paradas pa on pa.rol_visita_id = rv.id
left join public.visitas v  on v.parada_id = pa.id
group by rv.id;


-- ─────────────────────────────────────────────────────────────────────────────
-- historial_envios — agrupado por día, para la pantalla "HISTORIAL DE ENVÍOS"
--
-- Devuelve como máximo los últimos `retencion_historial_dias` (90 por defecto).
-- Un admin puede pedir más atrás; a un vendedor se le recorta el rango.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.historial_envios(
  p_desde       date default null,
  p_hasta       date default null,
  p_vendedor_id uuid default null
)
returns table (
  fecha            date,
  rol_visita_id    uuid,
  vendedor_id      uuid,
  vendedor         text,
  total_paradas    bigint,
  visitadas        bigint,
  no_visitadas     bigint,
  detalle          jsonb
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  retencion int;
  piso      date;
  objetivo  uuid;
begin
  select coalesce((valor)::int, 90) into retencion
    from public.configuracion where clave = 'retencion_historial_dias';

  -- Los vendedores sólo pueden mirar hacia atrás hasta el límite de retención.
  piso := case when interno.puede_ver_todo()
               then coalesce(p_desde, current_date - retencion)
               else greatest(coalesce(p_desde, current_date - retencion), current_date - retencion)
          end;

  objetivo := case when interno.puede_ver_todo()
                   then coalesce(p_vendedor_id, auth.uid())
                   else auth.uid()
              end;

  return query
  select
    rv.fecha,
    rv.id,
    rv.vendedor_id,
    pf.nombre_completo,
    count(pa.id),
    count(pa.id) filter (where pa.estado = 'visitada'),
    count(pa.id) filter (where pa.estado = 'no_visitada'),
    jsonb_agg(
      jsonb_build_object(
        'parada_id',    pa.id,
        'nro',          pa.orden,
        'cliente',      coalesce(c.razon_social, pa.razon_social_snapshot, 'Destino sin cliente'),
        'cliente_nro',  c.codigo,
        'direccion',    coalesce(d.direccion_formateada, pa.direccion_snapshot),
        'estado',       pa.estado,
        'hora',         pa.llegada_en,
        'visitado',     v.visitado,
        'vendio',       v.vendio,
        'cobro',        v.cobro,
        'retiro_afilado', v.retiro_afilado,
        'entrego',      v.entrego,
        'motivo',       v.motivo_no_visita,
        'contacto',     coalesce(v.contacto_nombre, c.contacto_nombre),
        'observacion',  v.observacion
      ) order by pa.orden
    )
  from public.roles_visita rv
  join public.perfiles pf     on pf.id = rv.vendedor_id
  left join public.paradas pa on pa.rol_visita_id = rv.id
  left join public.direcciones d on d.id = pa.direccion_id
  left join public.clientes c on c.id = pa.cliente_id
  left join public.visitas v  on v.parada_id = pa.id
  where rv.vendedor_id = objetivo
    and rv.fecha >= piso
    and rv.fecha <= coalesce(p_hasta, current_date)
  group by rv.id, rv.fecha, rv.vendedor_id, pf.nombre_completo
  order by rv.fecha desc;
end;
$$;

comment on function public.historial_envios is
  'Historial agrupado por día para la pantalla "HISTORIAL DE ENVÍOS". A los vendedores se les recorta el rango a la retención vigente (90 días).';


-- ─────────────────────────────────────────────────────────────────────────────
-- Archivado a los 90 días
--
-- La Edge Function `archivar-historial` llama a esta función, arma el Excel con
-- lo que devuelve, lo sube al bucket privado `archivos-historial` y recién ahí
-- confirma el borrado. Sólo los administradores acceden a ese bucket.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.archivos_historial (
  id             uuid primary key default extensions.gen_random_uuid(),
  desde          date not null,
  hasta          date not null,
  ruta_storage   text not null,
  filas          integer not null,
  generado_por   uuid references public.perfiles (id) on delete set null,
  generado_en    timestamptz not null default now()
);

alter table public.archivos_historial enable row level security;

create policy archivos_historial_admin on public.archivos_historial
  for all to authenticated
  using (interno.es_admin())
  with check (interno.es_admin());


create or replace function public.exportar_historial(p_desde date, p_hasta date)
returns setof public.vista_rol_de_visita
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select * from public.vista_rol_de_visita
   where fecha between p_desde and p_hasta;
$$;


-- Poda lo que ya quedó fuera de la ventana de retención. La Edge Function la
-- invoca DESPUÉS de haber subido el Excel correspondiente.
create or replace function public.podar_historial(p_hasta date)
returns table (jornadas_borradas bigint, posiciones_borradas bigint)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  n_jornadas   bigint;
  n_posiciones bigint;
begin
  if not interno.es_admin() then
    raise exception 'Sólo un administrador puede podar el historial' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.archivos_historial where hasta >= p_hasta
  ) then
    raise exception 'No hay un archivo de respaldo que cubra hasta %. Generá el Excel antes de podar.', p_hasta
      using errcode = 'P0001';
  end if;

  with borradas as (
    delete from public.posiciones
     where registrado_en < p_hasta
    returning 1
  )
  select count(*) into n_posiciones from borradas;

  with borradas as (
    delete from public.roles_visita
     where fecha < p_hasta
    returning 1
  )
  select count(*) into n_jornadas from borradas;

  insert into public.auditoria (actor_id, accion, entidad, datos)
  values (auth.uid(), 'historial.podado', 'roles_visita',
          jsonb_build_object('hasta', p_hasta, 'jornadas', n_jornadas, 'posiciones', n_posiciones));

  return query select n_jornadas, n_posiciones;
end;
$$;

comment on function public.podar_historial is
  'Borra el historial anterior a la fecha de corte. Se niega a correr si antes no se generó el Excel de respaldo.';
