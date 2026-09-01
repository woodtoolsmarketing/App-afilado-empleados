-- =============================================================================
-- LA AGENDA DE LA SEMANA: quien hay que ver, que dia, y a que hora.
--
-- ── Que habia ───────────────────────────────────────────────────────────────
--
-- El rol maestro sabe a quien visitar y cada cuantos dias. `candidatos_del_dia`
-- contesta con eso una sola pregunta: a quien te toca HOY. Y `roles_visita`
-- guarda lo que ya esta armado, dia por dia.
--
-- Lo que no habia era la pregunta de la semana. El vendedor podia reaccionar
-- —abrir la app a la manana y ver lo de hoy— pero no planificar: para saber si
-- el jueves le iba a tocar Moron tenia que esperar al jueves.
--
-- ── Que devuelve ────────────────────────────────────────────────────────────
--
-- Dos cosas mezcladas en una sola lista, marcadas con `tipo`:
--
--   'agendada'  Una parada que ya existe. Puede venir del rol de visita que
--               armo la oficina, de lo que el vendedor agendo para ese dia, o
--               de un envio comprometido. Tiene hora si se le puso.
--
--   'sugerida'  Un cliente del rol maestro al que le toca esa fecha segun su
--               frecuencia, y que todavia NO es una parada. Es lo que el
--               vendedor decide si hace o no.
--
-- ── Por que cada cliente sugerido aparece UNA sola vez ──────────────────────
--
-- Un cliente que se visita cada 3 dias cae dos o tres veces en una semana. Ver
-- al mismo taller tres veces en el calendario no informa nada nuevo y ademas
-- es mentira: se lo visita una vez y el reloj se reinicia. Se muestra la
-- primera fecha que le toca dentro de la ventana y nada mas.
--
-- ── Por que se excluye al que ya esta agendado ──────────────────────────────
--
-- Porque ya dejo de ser una sugerencia: es un compromiso. Si apareciera en los
-- dos lados, agendarlo de nuevo crearia una segunda parada del mismo cliente
-- el mismo dia.
-- =============================================================================

/*
 * Que dia es hoy para el vendedor, que esta en Argentina.
 *
 * El servidor corre en UTC, asi que a partir de las 21:00 `current_date` ya
 * devuelve manana. Sin esto, un vendedor que a las 21:30 quiere agendar algo
 * para el dia siguiente recibe "no se puede agendar para un dia que ya paso".
 */
create or replace function interno.hoy_ar()
returns date
language sql
stable
set search_path to 'pg_catalog', 'pg_temp'
as $fn$
  select (now() at time zone 'America/Argentina/Buenos_Aires')::date;
$fn$;


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
  -- La ventana se acota a proposito: pedir seis meses de proyeccion no es una
  -- agenda, es una lista de deseos, y la cuenta se vuelve cara sin que nadie
  -- mire el resultado.
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

  -- La ultima vez que se visito a cada cliente. Es la misma cuenta que hace
  -- `candidatos_del_dia` —si no coincidieran, el vendedor veria una cosa en el
  -- calendario y otra en CLIENTES DE HOY—, con una sola diferencia: el "hoy"
  -- se toma en hora de Argentina y no en UTC. Ver `interno.hoy_ar`.
  ultimas as (
    select v.cliente_id, max(rv.fecha) as fecha
      from public.visitas v
      join public.roles_visita rv on rv.id = v.rol_visita_id
     where v.visitado
       and v.cliente_id is not null
     group by v.cliente_id
  ),

  /*
   * La primera fecha, dentro de la ventana, en la que le toca a cada cliente.
   *
   * `proximo` es cuando le tocaria si nada se hubiera atrasado. Al que nunca
   * se visito le toca hoy; al que ya se visito, a los `cada_cuantos_dias` de
   * esa visita.
   *
   * Si ese `proximo` quedo ANTES de la ventana —el cliente esta atrasado— no
   * se lo empuja a su siguiente ciclo: se lo muestra el primer dia de la
   * ventana. Un cliente que se paso por tres semanas tiene que aparecer YA, no
   * dentro de otros quince dias.
   */
  toca as (
    select
      rm.cliente_id,
      rm.cada_cuantos_dias,
      u.fecha as ultima_visita,
      case when u.fecha is null then null
           else (interno.hoy_ar() - u.fecha)::int end as dias_desde,
      greatest(
        v.desde,
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

  sugeridas as (
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
      /*
       * Ya comprometido en la ventana: dejo de ser una sugerencia.
       *
       * Lo OMITIDO no cuenta como comprometido a proposito. Omitir es decir
       * "hoy no", no "nunca": si el vendedor lo saco de la agenda del martes,
       * el plan tiene que poder volver a proponerlo el viernes.
       */
      and not exists (
        select 1 from agendadas a
         where a.cliente_id = t.cliente_id
           and a.estado <> 'omitida'
      )
  )

  select * from agendadas
  union all
  select * from sugeridas
  -- Por posicion y no por nombre: los nombres de `returns table` son
  -- parametros de la funcion y taparian a las columnas del resultado.
  -- 1 fecha · 2 tipo ('agendada' antes que 'sugerida') · 14 orden · 7 razon social
  order by 1, 2, 14 nulls last, 7;
$fn$;

comment on function public.agenda_semanal is
  'Lo agendado y lo que sugiere el rol maestro, dia por dia, entre dos fechas. Los sugeridos aparecen una sola vez: la primera que les toca.';

grant execute on function public.agenda_semanal(date, date, uuid) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- Modificar la agenda
-- ─────────────────────────────────────────────────────────────────────────────

/*
 * La jornada de una fecha, creandola si no existe.
 *
 * Lo mismo que hace la app en `asegurarJornadaDe`, pero del lado del servidor,
 * porque mover una parada de dia tiene que ser una sola operacion: si se
 * partiera en "crear la jornada" y despues "mover", una senal que se corta en
 * el medio deja la parada en el dia viejo y una jornada vacia en el nuevo.
 */
create or replace function public.jornada_del_dia(p_fecha date)
returns uuid
language plpgsql
security invoker
set search_path to 'public', 'pg_temp'
as $fn$
declare
  encontrada uuid;
begin
  select id into encontrada
    from public.roles_visita
   where vendedor_id = auth.uid() and fecha = p_fecha;

  if encontrada is not null then
    return encontrada;
  end if;

  insert into public.roles_visita (vendedor_id, fecha, estado)
  values (auth.uid(), p_fecha, 'planificado')
  returning id into encontrada;

  return encontrada;
exception
  -- Dos agendas del mismo dia a la vez chocan contra el unico por vendedor y
  -- fecha. La segunda no falla: lee la que acaba de crear la primera.
  when unique_violation then
    select id into encontrada
      from public.roles_visita
     where vendedor_id = auth.uid() and fecha = p_fecha;
    return encontrada;
end;
$fn$;

comment on function public.jornada_del_dia is
  'El rol de visita del vendedor para esa fecha. Lo crea si no existe.';

grant execute on function public.jornada_del_dia(date) to authenticated;


/*
 * Mover una parada de dia, ponerle hora, o las dos cosas.
 *
 * ── Por que el orden se recalcula ───────────────────────────────────────────
 *
 * `orden` es unico dentro de la jornada y es lo que define el recorrido. Una
 * parada que llega de otro dia con su orden viejo choca con la que ya estaba
 * en ese lugar. Se la manda al final: donde va de verdad lo decide despues la
 * optimizacion de la ruta, que es la que sabe de distancias.
 *
 * ── Por que solo se mueve lo que todavia no paso ────────────────────────────
 *
 * Una parada visitada tiene una visita colgada, con su hora, su observacion y
 * su ubicacion. Moverla de dia haria que un trabajo hecho el martes figure
 * como hecho el jueves.
 */
create or replace function public.mover_parada(
  p_parada_id uuid,
  p_fecha     date default null,
  p_hora      timestamptz default null,
  p_borrar_hora boolean default false
)
returns public.paradas
language plpgsql
security invoker
set search_path to 'public', 'pg_temp'
as $fn$
declare
  actual        public.paradas;
  fecha_actual  date;
  destino       uuid;
  ultimo        integer;
  resultado     public.paradas;
begin
  select * into actual from public.paradas where id = p_parada_id;
  if actual.id is null then
    raise exception 'Ese destino ya no esta en tu agenda.' using errcode = '23514';
  end if;

  select fecha into fecha_actual from public.roles_visita where id = actual.rol_visita_id;

  if actual.estado not in ('pendiente', 'en_camino') then
    raise exception 'Ese destino ya se resolvio: no se puede mover ni reprogramar.'
      using errcode = '23514';
  end if;

  destino := actual.rol_visita_id;

  if p_fecha is not null and p_fecha is distinct from fecha_actual then
    if p_fecha < interno.hoy_ar() then
      raise exception 'No se puede agendar para un dia que ya paso.' using errcode = '23514';
    end if;

    destino := public.jornada_del_dia(p_fecha);

    select coalesce(max(orden), 0) + 1 into ultimo
      from public.paradas where rol_visita_id = destino;

    update public.paradas
       set rol_visita_id = destino,
           orden = ultimo
     where id = p_parada_id;
  end if;

  if p_borrar_hora then
    update public.paradas set hora_estimada = null where id = p_parada_id;
  elsif p_hora is not null then
    update public.paradas set hora_estimada = p_hora where id = p_parada_id;
  end if;

  select * into resultado from public.paradas where id = p_parada_id;
  return resultado;
end;
$fn$;

comment on function public.mover_parada is
  'Cambia de dia y/o de hora una parada que todavia esta pendiente. La manda al final del dia destino.';

grant execute on function public.mover_parada(uuid, date, timestamptz, boolean) to authenticated;


/*
 * Agendar para un dia a un cliente que hoy es solo una sugerencia.
 *
 * Es `agregar_parada` con dos diferencias que importan: resuelve sola la
 * direccion principal del cliente —el que agenda desde el calendario no eligio
 * ninguna— y acepta una hora.
 *
 * La prioridad es siempre baja: el orden del dia lo decide la optimizacion de
 * la ruta. La prioridad alta existe para lo que aparece en el camino, hoy, no
 * para lo que se planifica con dias de anticipacion.
 */
create or replace function public.agendar_visita(
  p_cliente_id uuid,
  p_fecha      date,
  p_hora       timestamptz default null
)
returns public.paradas
language plpgsql
security invoker
set search_path to 'public', 'pg_temp'
as $fn$
declare
  direccion  uuid;
  jornada    uuid;
  nueva      public.paradas;
begin
  if p_fecha < interno.hoy_ar() then
    raise exception 'No se puede agendar para un dia que ya paso.' using errcode = '23514';
  end if;

  select dd.id into direccion
    from public.direcciones dd
   where dd.cliente_id = p_cliente_id
   order by dd.principal desc, dd.creado_en
   limit 1;

  if direccion is null then
    raise exception 'Ese cliente todavia no esta ubicado en el mapa. Ubicalo desde AGREGAR DESTINO antes de agendarlo.'
      using errcode = '23514';
  end if;

  jornada := public.jornada_del_dia(p_fecha);

  -- Ya agendado ese dia: se devuelve el que hay en vez de duplicarlo. Tocar
  -- dos veces el mismo boton con la señal lenta es lo mas facil del mundo.
  select * into nueva
    from public.paradas
   where rol_visita_id = jornada
     and cliente_id = p_cliente_id
     and estado in ('pendiente', 'en_camino')
   limit 1;

  if nueva.id is null then
    nueva := public.agregar_parada(jornada, direccion, 'baja'::prioridad_parada, p_cliente_id);
  end if;

  if p_hora is not null then
    update public.paradas set hora_estimada = p_hora where id = nueva.id;
    select * into nueva from public.paradas where id = nueva.id;
  end if;

  return nueva;
end;
$fn$;

comment on function public.agendar_visita is
  'Agenda a un cliente del rol maestro para una fecha. Si ya estaba agendado ese dia devuelve la parada que hay.';

grant execute on function public.agendar_visita(uuid, date, timestamptz) to authenticated;


/*
 * Sacar un destino de la agenda.
 *
 * No se borra: se marca omitido. El vendedor no tiene —ni va a tener— permiso
 * de borrar paradas, porque el recorrido que armo la oficina no es suyo para
 * hacerlo desaparecer. Omitida es la forma honesta de decir "esto estaba y
 * decidi no hacerlo", y asi queda en el historial.
 */
create or replace function public.quitar_de_la_agenda(p_parada_id uuid)
returns public.paradas
language plpgsql
security invoker
set search_path to 'public', 'pg_temp'
as $fn$
declare
  resultado public.paradas;
begin
  update public.paradas
     set estado = 'omitida'
   where id = p_parada_id
     and estado in ('pendiente', 'en_camino')
  returning * into resultado;

  if resultado.id is null then
    raise exception 'Ese destino ya se resolvio: no se puede sacar de la agenda.'
      using errcode = '23514';
  end if;

  return resultado;
end;
$fn$;

comment on function public.quitar_de_la_agenda is
  'Marca omitida una parada pendiente. No borra: el vendedor no borra paradas.';

grant execute on function public.quitar_de_la_agenda(uuid) to authenticated;
