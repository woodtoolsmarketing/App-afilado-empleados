-- Cuatro defectos del lado del servidor que encontro la auditoria.
--
--  1. `registrar_visita` promovia a 'en_camino' una parada diferida antes de
--     su hora: la hora se escribia y no la leia nadie.
--  2. La misma promocion podia dejar DOS paradas 'en_camino' a la vez.
--  3. `fichar` emparejaba la hora de un momento con la coordenada de otro.
--  4. `candidatos_del_dia` seguia ofreciendo clientes que ya estaban en el
--     recorrido de hoy, y armar el recorrido dos veces creaba paradas dobles.
--
-- El detalle de cada uno va pegado al codigo que lo arregla.

create or replace function public.registrar_visita(
  p_parada_id         uuid,
  p_visitado          boolean,
  p_vendio            boolean default false,
  p_cobro             boolean default false,
  p_retiro_afilado    boolean default false,
  p_entrego           boolean default false,
  p_motivo            public.motivo_no_visita default null,
  p_contacto          text default null,
  p_observacion       text default '',
  p_observacion_origen public.origen_observacion default 'texto',
  p_audio_url         text default null,
  p_lat               double precision default null,
  p_lng               double precision default null,
  p_precision_m       real default null,
  p_volver_a_las      timestamptz default null
)
returns public.visitas
language plpgsql
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  parada    public.paradas;
  jornada   public.roles_visita;
  registro  public.visitas;
  desvio    integer;
  vuelve    boolean;
begin
  select * into parada from public.paradas where id = p_parada_id;
  if parada.id is null then
    raise exception 'No existe la parada %', p_parada_id using errcode = 'P0002';
  end if;

  select * into jornada from public.roles_visita where id = parada.rol_visita_id;

  if not interno.observacion_valida(p_observacion) then
    raise exception 'La observacion es obligatoria: escribi al menos una frase describiendo que paso en la visita.'
      using errcode = '23514';
  end if;

  vuelve := (p_visitado is false and p_motivo = 'visitar_mas_tarde');

  if vuelve and p_volver_a_las is null then
    raise exception 'Decinos a que hora volves.' using errcode = '23514';
  end if;

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

  if vuelve then
    update public.paradas
       set estado        = 'pendiente'::public.estado_parada,
           hora_estimada = p_volver_a_las,
           salida_en     = now()
     where id = p_parada_id;
  else
    update public.paradas
       set estado     = (case when p_visitado then 'visitada' else 'no_visitada' end)::public.estado_parada,
           llegada_en = coalesce(llegada_en, now()),
           salida_en  = now()
     where id = p_parada_id;
  end if;

  -- ── A quien se promueve a 'en_camino' ────────────────────────────────────
  --
  -- Dos condiciones nuevas, las dos por defectos reales:
  --
  --  · `hora_estimada`: una parada diferida a las 16:30 NO puede volver a la
  --    cabeza del recorrido a las 14:00. La hora se escribia y no la leia
  --    nadie, asi que cerrar el destino siguiente promovia al diferido dos
  --    horas y media antes, con "PROXIMO DESTINO" y el boton de navegar. La
  --    promesa que el vendedor le hizo al cliente no existia para la app.
  --    Las que todavia no vencieron quedan afuera, y entre las elegibles van
  --    primero las que nunca se difirieron.
  --
  --  · `not exists ... en_camino`: cerrar una parada que no era la proxima
  --    dejaba DOS destinos con la pastilla "En camino" a la vez, el contador
  --    de la jornada devolvia 2, y la oficina veia al vendedor yendo a dos
  --    lugares al mismo tiempo. En el cierre normal la parada ya paso a
  --    visitada/no_visitada, y cuando vuelve mas tarde paso a 'pendiente', asi
  --    que la promocion legitima sigue funcionando igual.
  update public.paradas
     set estado = 'en_camino'
   where id = (
     select id from public.paradas
      where rol_visita_id = parada.rol_visita_id
        and estado = 'pendiente'
        and (not vuelve or id <> p_parada_id)
        and (hora_estimada is null or hora_estimada <= now())
      order by (hora_estimada is not null), orden
      limit 1
   )
     and not exists (
       select 1 from public.paradas
        where rol_visita_id = parada.rol_visita_id
          and estado = 'en_camino'
     );

  return registro;
end;
$function$;

comment on function public.registrar_visita(
  uuid, boolean, boolean, boolean, boolean, boolean, public.motivo_no_visita,
  text, text, public.origen_observacion, text, double precision, double precision, real, timestamptz) is
  'Registra el parte de una visita y cierra la parada. Con motivo visitar_mas_tarde la deja pendiente con su hora, para que vuelva a aparecer en el recorrido. Atomica.';


create or replace function public.fichar(
  p_lat double precision default null,
  p_lng double precision default null
)
returns public.presencias
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  quien   uuid := auth.uid();
  ahora   timestamptz := now();
  arg     timestamp := (now() at time zone 'America/Argentina/Buenos_Aires');
  hoy     date := arg::date;
  en_hora boolean := arg::time between time '08:00' and time '18:00';
  fila    public.presencias;
begin
  if quien is null then
    raise exception 'No hay sesion' using errcode = '42501';
  end if;
  if not interno.esta_habilitado() then
    raise exception 'Tu usuario todavia no esta habilitado' using errcode = '42501';
  end if;

  insert into public.presencias as p (
    vendedor_id, fecha,
    entrada_en, entrada_lat, entrada_lng,
    salida_en, salida_lat, salida_lng,
    aperturas, ultima_actividad_en
  )
  values (
    quien, hoy,
    case when en_hora then ahora end,
    case when en_hora then p_lat end,
    case when en_hora then p_lng end,
    case when en_hora then ahora end,
    case when en_hora then p_lat end,
    case when en_hora then p_lng end,
    1, ahora
  )
  on conflict (vendedor_id, fecha) do update set
    -- ── Cada coordenada va con SU hora, no por separado ──────────────────
    --
    -- Antes las seis columnas se resolvian con `coalesce` una por una, y eso
    -- las desincronizaba. El caso: el vendedor abre la app a las 08:10 en el
    -- subte, sin senal de GPS —se ficha la hora, la coordenada va en null— y a
    -- las 11:30 la vuelve a abrir en un cliente. `coalesce(p.entrada_lat,
    -- excluded.entrada_lat)` rellenaba entonces la coordenada de la ENTRADA
    -- con donde estaba tres horas despues: la ficha decia que habia entrado a
    -- las 08:10 parado en la puerta de un cliente al que llego a media manana.
    --
    -- Lo mismo del otro lado: la salida avanzaba de hora pero se quedaba con
    -- la coordenada de la actividad anterior.
    --
    -- Ahora la coordenada se mueve solo cuando se mueve su hora. Si ese
    -- momento no tuvo fix queda en null —que es la verdad— en vez de tomar
    -- prestada la de otro momento.
    entrada_en  = coalesce(p.entrada_en, excluded.entrada_en),
    entrada_lat = case when p.entrada_en is null then excluded.entrada_lat else p.entrada_lat end,
    entrada_lng = case when p.entrada_en is null then excluded.entrada_lng else p.entrada_lng end,
    -- La salida se corre con cada actividad: la ultima es la que vale.
    salida_en   = coalesce(excluded.salida_en, p.salida_en),
    salida_lat  = case when excluded.salida_en is not null then excluded.salida_lat else p.salida_lat end,
    salida_lng  = case when excluded.salida_en is not null then excluded.salida_lng else p.salida_lng end,
    aperturas   = p.aperturas + 1,
    ultima_actividad_en = ahora
  returning * into fila;

  return fila;
end;
$function$;


-- ── Un cliente que ya esta en el recorrido de hoy deja de ser candidato ────
--
-- CLIENTES DE HOY mostraba la lista completa cada vez que se entraba, sin
-- mirar la jornada en curso. Tildar de nuevo a alguien que ya se habia
-- agregado creaba una SEGUNDA parada del mismo cliente: aparecia dos veces en
-- DESTINOS DEL DIA y dos veces en el mapa, habia que cargar dos partes de
-- visita por el mismo trabajo, y el rol del dia quedaba con un destino
-- inventado. Ni `agregar_parada` ni la pantalla verificaban nada.
--
-- Se resuelve donde nace la lista. Se miran TODAS las paradas de la jornada,
-- incluidas las visitadas y las omitidas: volver a ofrecer a alguien que ya se
-- visito hoy tampoco esta bien.

create or replace function public.candidatos_del_dia(p_vendedor_id uuid default null)
returns table (
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
    and not exists (select 1 from ya_en_ruta r where r.cliente_id = c.id)
  order by rm.orden nulls last, u.fecha nulls first, c.razon_social;
$function$;

-- La red de seguridad, por si la parada se crea por otro camino: un cliente no
-- puede estar dos veces en la misma jornada. Parcial porque hay paradas sin
-- cliente —las direcciones sueltas— y esas si pueden repetirse.
create unique index if not exists paradas_un_cliente_por_jornada
  on public.paradas (rol_visita_id, cliente_id)
  where cliente_id is not null;