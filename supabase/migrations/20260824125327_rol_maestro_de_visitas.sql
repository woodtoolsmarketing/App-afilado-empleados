-- El plan de visitas: a quien hay que ver, y cada cuantos dias.
--
-- ── Lo que no existia ───────────────────────────────────────────────────────
--
-- "Cada cuantos dias se visita a un cliente" no estaba en ninguna parte del
-- sistema: cero columnas, cero tablas. El recorrido se armaba a mano todos los
-- dias, o la oficina cargaba las paradas una por una.
--
-- ── Por que es un plan y no paradas ─────────────────────────────────────────
--
-- Cargar el Excel NO crea paradas. Crea candidatos. El vendedor ve la lista del
-- dia, toda deseleccionada, y elige cuales hace; recien ahi se crean las
-- paradas de su jornada.
--
-- Tenia que ser asi: el vendedor no tiene permiso de BORRAR paradas —y no se lo
-- vamos a dar, porque borrar el recorrido que armo la oficina es otra cosa— asi
-- que si el Excel creara las paradas directamente, "deseleccionar" no podria
-- borrarlas. A lo sumo marcarlas omitidas, y quedarian igual en el rol del dia
-- como destinos que nunca se visitaron.

create table if not exists public.rol_maestro (
  id                uuid primary key default extensions.gen_random_uuid(),
  vendedor_id       uuid not null references public.perfiles (id) on delete cascade,
  cliente_id        uuid not null references public.clientes (id) on delete cascade,
  cada_cuantos_dias integer not null,
  /* En que orden se prefiere visitarlos cuando caen el mismo dia. */
  orden             integer,
  activo            boolean not null default true,
  cargado_por       uuid references public.perfiles (id) on delete set null,
  creado_en         timestamptz not null default now(),
  actualizado_en    timestamptz not null default now(),

  constraint rol_maestro_frecuencia_razonable check (cada_cuantos_dias between 1 and 365),
  constraint rol_maestro_uno_por_cliente unique (vendedor_id, cliente_id)
);

comment on table public.rol_maestro is
  'Plan de visitas por vendedor: a quien visitar y cada cuantos dias. Genera candidatos, no paradas.';

create index if not exists rol_maestro_vendedor_idx on public.rol_maestro (vendedor_id) where activo;

alter table public.rol_maestro enable row level security;

drop policy if exists rol_maestro_leer on public.rol_maestro;
create policy rol_maestro_leer on public.rol_maestro
  for select to authenticated
  using (interno.puede_ver_todo() or vendedor_id = auth.uid());

drop policy if exists rol_maestro_admin on public.rol_maestro;
create policy rol_maestro_admin on public.rol_maestro
  for all to authenticated
  using (interno.es_admin()) with check (interno.es_admin());

create trigger rol_maestro_tocar_actualizado
  before update on public.rol_maestro
  for each row execute function interno.tocar_actualizado_en();

-- ── A quien toca visitar hoy ────────────────────────────────────────────────
--
-- Un cliente entra en la lista de hoy si nunca se lo visito, o si desde la
-- ultima vez pasaron al menos los dias que dice su frecuencia.
--
-- `dias_desde` viene en el resultado porque es lo que le permite al vendedor
-- decidir: no es lo mismo uno que se paso por un dia que uno que se paso por
-- tres semanas.

create or replace function public.candidatos_del_dia(p_vendedor_id uuid default null)
returns table (
  cliente_id      uuid,
  codigo          text,
  razon_social    text,
  direccion       text,
  lat             double precision,
  lng             double precision,
  cada_cuantos_dias integer,
  ultima_visita   date,
  dias_desde      integer,
  orden           integer
)
language sql
stable
set search_path to 'public', 'pg_temp'
as $$
  with quien as (select coalesce(p_vendedor_id, auth.uid()) as id),
  ultimas as (
    select v.cliente_id, max(rv.fecha) as fecha
      from public.visitas v
      join public.roles_visita rv on rv.id = v.rol_visita_id
     where v.visitado
       and v.cliente_id is not null
     group by v.cliente_id
  )
  select
    c.id,
    c.codigo,
    c.razon_social,
    d.direccion_formateada,
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
    and (u.fecha is null or current_date - u.fecha >= rm.cada_cuantos_dias)
  order by rm.orden nulls last, u.fecha nulls first, c.razon_social;
$$;

comment on function public.candidatos_del_dia is
  'Los clientes del rol maestro a los que toca visitar hoy. Sin direccion cargada vienen con lat/lng en null: no se pueden agregar al recorrido hasta geolocalizarlos.';
