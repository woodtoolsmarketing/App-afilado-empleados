-- =============================================================================
-- LA LISTA SEMANAL DEL VENDEDOR: a quién visita cada día, todas las semanas.
--
-- ── Qué es ────────────────────────────────────────────────────────────────
--
-- Una lista FIJA por día de la semana que arma, edita y borra el vendedor: "los
-- lunes veo a estos, los martes a estos otros". Se repite todas las semanas
-- hasta que el vendedor la cambie.
--
-- ── Cómo llega al calendario ──────────────────────────────────────────────
--
-- No crea paradas. Aparece en el CALENDARIO DE VISITAS como SUGERIDA, igual que
-- lo que propone el rol maestro de la oficina: el vendedor ve la sugerencia el
-- día que le toca y decide si la agenda al recorrido. Así una semana en la que
-- no sale a la calle no queda con destinos que nunca visitó.
--
-- ── Por qué es del vendedor ───────────────────────────────────────────────
--
-- El rol maestro lo carga la oficina y es de sólo lectura para el vendedor.
-- Esta lista es la de él: la maneja entero. Por eso la RLS la ata a su usuario
-- —la ve y la escribe él, y la oficina la puede leer— y borrar una fila es
-- borrarla de verdad: no hay paradas ni historial que preservar.
-- =============================================================================

create table if not exists public.lista_visitas_vendedor (
  id             uuid primary key default extensions.gen_random_uuid(),
  vendedor_id    uuid not null references public.perfiles (id) on delete cascade,
  cliente_id     uuid not null references public.clientes (id) on delete cascade,
  -- Día de la semana ISO: 1 lunes … 7 domingo (igual que extract(isodow)).
  dia_semana     smallint not null,
  -- En qué orden se prefieren cuando caen el mismo día.
  orden          integer,
  activo         boolean not null default true,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),

  constraint lvv_dia_valido check (dia_semana between 1 and 7),
  constraint lvv_uno_por_cliente_y_dia unique (vendedor_id, cliente_id, dia_semana)
);

comment on table public.lista_visitas_vendedor is
  'Lista semanal fija que arma el vendedor: a quién visitar cada día. Recurrente: aparece como sugerida en el calendario todas las semanas hasta que la saque.';

create index if not exists lvv_vendedor_dia_idx
  on public.lista_visitas_vendedor (vendedor_id, dia_semana) where activo;

alter table public.lista_visitas_vendedor enable row level security;

-- La ve el vendedor (la suya) y la oficina (todas).
drop policy if exists lvv_leer on public.lista_visitas_vendedor;
create policy lvv_leer on public.lista_visitas_vendedor
  for select to authenticated
  using (interno.puede_ver_todo() or vendedor_id = auth.uid());

-- La escribe sólo el vendedor dueño.
drop policy if exists lvv_propia on public.lista_visitas_vendedor;
create policy lvv_propia on public.lista_visitas_vendedor
  for all to authenticated
  using (vendedor_id = auth.uid()) with check (vendedor_id = auth.uid());

drop trigger if exists lvv_tocar_actualizado on public.lista_visitas_vendedor;
create trigger lvv_tocar_actualizado
  before update on public.lista_visitas_vendedor
  for each row execute function interno.tocar_actualizado_en();


-- ── La lista de un día, para verla y editarla ───────────────────────────────
--
-- Invoker: la RLS de `clientes` deja a cualquier vendedor habilitado ver los
-- clientes activos, así que resuelve nombre y dirección sin permisos extra.

create or replace function public.lista_semanal_de(p_dia_semana smallint)
returns table (
  cliente_id   uuid,
  codigo       text,
  razon_social text,
  direccion    text,
  lat          double precision,
  lng          double precision,
  orden        integer
)
language sql
stable
security invoker
set search_path to 'public', 'pg_temp'
as $fn$
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
  order by lv.orden nulls last, c.razon_social;
$fn$;

comment on function public.lista_semanal_de is
  'Los clientes de la lista semanal del vendedor para un día ISO (1 lunes … 7 domingo).';

grant execute on function public.lista_semanal_de(smallint) to authenticated;


-- ── Guardar la lista de un día (reemplazo atómico) ──────────────────────────
--
-- Borra lo que había para ese día e inserta lo elegido, en el orden en que
-- viene el arreglo. Pasar un arreglo vacío deja el día sin nada. Es del
-- vendedor: la RLS `lvv_propia` asegura que sólo toca sus filas.

create or replace function public.guardar_lista_semanal(
  p_dia_semana  smallint,
  p_cliente_ids uuid[]
)
returns void
language plpgsql
security invoker
set search_path to 'public', 'pg_temp'
as $fn$
declare
  quien uuid := auth.uid();
begin
  if quien is null then
    raise exception 'No hay sesion' using errcode = '42501';
  end if;
  if p_dia_semana is null or p_dia_semana < 1 or p_dia_semana > 7 then
    raise exception 'Dia de la semana invalido.' using errcode = '23514';
  end if;

  delete from public.lista_visitas_vendedor
   where vendedor_id = quien and dia_semana = p_dia_semana;

  insert into public.lista_visitas_vendedor (vendedor_id, cliente_id, dia_semana, orden)
  select quien, t.cid, p_dia_semana, t.ord::int
    from unnest(coalesce(p_cliente_ids, array[]::uuid[])) with ordinality as t(cid, ord)
  on conflict (vendedor_id, cliente_id, dia_semana) do nothing;
end;
$fn$;

comment on function public.guardar_lista_semanal is
  'Reemplaza la lista semanal del vendedor para un día ISO con los clientes dados, en ese orden. Arreglo vacío = día sin nada.';

grant execute on function public.guardar_lista_semanal(smallint, uuid[]) to authenticated;


-- ── agenda_semanal: suma la lista semanal como una tercera fuente de sugeridas
--
-- Se reescribe entera para no perder de vista la lógica que ya tenía (el
-- atrasado que cae en hoy, lo omitido que no se re-sugiere el mismo día). Lo
-- nuevo es `sugeridas_lista`: la lista del vendedor proyectada sobre cada día
-- de la ventana que coincide con su día de la semana, y el `distinct on` que
-- evita que un cliente que está en el rol maestro Y en la lista aparezca dos
-- veces el mismo día.

create or replace function public.agenda_semanal(
  p_desde       date,
  p_hasta       date,
  p_vendedor_id uuid default null
)
returns table (
  fecha             date,
  tipo              text,
  parada_id         uuid,
  rol_visita_id     uuid,
  cliente_id        uuid,
  codigo            text,
  razon_social      text,
  direccion         text,
  lat               double precision,
  lng               double precision,
  hora              timestamptz,
  estado            text,
  prioridad         text,
  orden             integer,
  cada_cuantos_dias integer,
  dias_desde        integer
)
language sql
stable
security invoker
set search_path to 'public', 'pg_temp'
as $fn$
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
      d.direccion_formateada                       as direccion,
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

  /*
   * La lista semanal del vendedor, proyectada por día de la semana.
   *
   * Para cada día de la ventana (de hoy en adelante) cuyo `isodow` coincide con
   * el `dia_semana` de una fila, ese cliente es sugerido ese día. Se repite
   * cada semana: es una lista fija, no una frecuencia.
   *
   * Se saltea el día en que el cliente ya tiene una parada —de cualquier
   * estado—: si está agendado, ya es un compromiso; y si lo omitió ESE día, no
   * hay que re-sugerirlo en el mismo casillero (semana que viene reaparece).
   */
  sugeridas_lista as (
    select
      g.dd::date                                   as fecha,
      'sugerida'::text                             as tipo,
      null::uuid                                   as parada_id,
      null::uuid                                   as rol_visita_id,
      lv.cliente_id,
      c.codigo,
      c.razon_social,
      d.direccion_formateada                       as direccion,
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
      and lv.dia_semana = extract(isodow from g.dd)::int
      and g.dd::date >= interno.hoy_ar()
      and not exists (
        select 1 from agendadas a
         where a.cliente_id = lv.cliente_id
           and a.fecha = g.dd::date
      )
  ),

  /*
   * Un cliente que está en el rol maestro Y en la lista del vendedor no puede
   * aparecer dos veces el mismo día. Se queda con la fila del rol —trae la
   * frecuencia, "cada N días"— cuando las dos caen en la misma fecha.
   */
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
$fn$;

comment on function public.agenda_semanal is
  'Lo agendado, lo que sugiere el rol maestro y la lista semanal del vendedor, día por día. El atrasado cae en hoy; la lista se repite cada semana; un cliente no aparece dos veces el mismo día.';

grant execute on function public.agenda_semanal(date, date, uuid) to authenticated;
