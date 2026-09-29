/*
 * Si el cliente no está en el mapa, mostrar igual el domicilio escrito.
 *
 * ─── Por qué ─────────────────────────────────────────────────────────────────
 *
 * Desde que la parada puede entrar SIN UBICAR (migración
 * 20260929172416), las listas donde el vendedor arma el recorrido muestran
 * clientes que no tienen ninguna fila en `direcciones`. Esas listas sacaban el
 * domicilio de ahí y de ningún otro lado, así que la fila quedaba con el nombre,
 * la pastilla SIN UBICAR… y NADA de dirección.
 *
 * Justo en el caso nuevo, y justo donde más falta hace: el vendedor elige a
 * quién visitar leyendo la calle. Son 6.386 clientes de los 6.536 sin ubicar los
 * que SÍ tienen el domicilio como texto en `clientes.direccion` —lo que vino del
 * sistema de gestión viejo—, o sea que el dato estaba y no se estaba mirando.
 *
 * `agendadas` en `agenda_semanal` ya hacía este COALESCE (contra el snapshot de
 * la parada). Lo que faltaba era el mismo criterio en las dos ramas de
 * `sugeridas` y en `candidatos_del_dia`.
 *
 * El `nullif(btrim(...), '')` es para que una cadena vacía o de espacios no se
 * cuele como si fuera una dirección: el que consume esto decide qué poner cuando
 * no hay nada, y para eso necesita un NULL de verdad.
 */

create or replace function public.candidatos_del_dia(p_vendedor_id uuid default null)
returns table(
  cliente_id uuid, codigo text, razon_social text, direccion text,
  lat double precision, lng double precision, cada_cuantos_dias integer,
  ultima_visita date, dias_desde integer, orden integer
)
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
    -- El domicilio de la ficha cuando no hay punto en el mapa.
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
    and (u.fecha is null or rm.cada_cuantos_dias is null or current_date - u.fecha >= rm.cada_cuantos_dias)
    and not exists (select 1 from ya_en_ruta r where r.cliente_id = c.id)
  order by rm.orden nulls last, u.fecha nulls first, c.razon_social;
$function$;

create or replace function public.agenda_semanal(p_desde date, p_hasta date, p_vendedor_id uuid default null)
returns table(
  fecha date, tipo text, parada_id uuid, rol_visita_id uuid, cliente_id uuid,
  codigo text, razon_social text, direccion text, lat double precision,
  lng double precision, hora timestamp with time zone, estado text,
  prioridad text, orden integer, cada_cuantos_dias integer, dias_desde integer
)
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
      -- Sin punto en el mapa, el domicilio escrito de la ficha.
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
      -- Idem: el texto de la ficha cuando no hay fila en direcciones.
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
