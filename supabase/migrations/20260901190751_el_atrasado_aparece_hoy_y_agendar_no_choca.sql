-- =============================================================================
-- Cuatro cosas que la revision de la agenda encontro, y que se ven todas desde
-- la misma pantalla.
--
-- 1. EL ATRASADO CAIA EN UN DIA QUE YA PASO. La primera fecha sugerida era
--    `greatest(v.desde, <proximo>)`, y `v.desde` es el LUNES de la semana que
--    se esta mirando, no hoy. Un cliente que se paso por tres semanas aparecia
--    el lunes -en gris, sin poder tocarlo- y el dia de hoy quedaba vacio. Peor
--    todavia: mirando una semana ya pasada, TODOS los atrasados se pintaban
--    como sugeridos en el lunes de esa semana, como si hubiera que visitarlos
--    en el pasado.
--
-- 2. SACAR ALGO DE LA AGENDA LO VOLVIA A PROPONER EN EL ACTO. Lo omitido no
--    cuenta como comprometido -eso esta bien, omitir es "hoy no", no "nunca"-
--    pero la fecha propuesta no se corria, asi que el cliente reaparecia en el
--    mismo casillero: una fila OMITIDA arriba y una SUGERIDO abajo. Parecia que
--    el boton no habia hecho nada.
--
-- 3. EL DESPLEGABLE QUE APRENDE NUNCA APRENDIA. `cuando_se_da_frecuente` corria
--    con los permisos del que llama, y la politica de lectura deja al vendedor
--    ver SOLO sus reportes. Sumado al minimo de dos repeticiones, la funcion
--    que existe para ofrecer "lo que ya contestaron los demas" volvia vacia
--    siempre. Con `security definer` lee todos los reportes y sigue sin exponer
--    nada de nadie: devuelve la frase y cuantas veces se dijo, nunca quien.
--
-- 4. AGENDAR O MOVER PODIA ESCUPIR UN ERROR DE POSTGRES EN LA CARA. Existe
--    `paradas_un_cliente_por_jornada`, un unico sobre (rol_visita_id,
--    cliente_id) que NO mira el estado. Las dos funciones esquivaban el
--    duplicado buscando solo paradas pendientes, asi que con una omitida o una
--    visitada del mismo cliente ese dia el INSERT chocaba con el indice y al
--    vendedor le llegaba "duplicate key value violates unique constraint" tal
--    cual.
-- =============================================================================


-- ── 1 y 2 · La agenda de la semana ──────────────────────────────────────────

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

  /*
   * La primera fecha, dentro de la ventana, en la que le toca a cada cliente.
   *
   * `interno.hoy_ar()` entra en el greatest y ese es el arreglo. Sin el, el
   * atrasado se anclaba al lunes de la ventana: en la semana en curso caia en
   * un dia que ya paso, y en una semana anterior caia entera en el pasado.
   * Ahora un atrasado cae SIEMPRE en hoy si hoy esta a la vista, y una semana
   * que ya paso no propone nada (primera queda despues de su domingo).
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
       * Lo OMITIDO no cuenta como comprometido -omitir es "hoy no", no
       * "nunca"- salvo el mismo dia en que se lo omitio. Sin esa salvedad,
       * sacar un destino de la agenda lo devolvia al instante al mismo
       * casillero como sugerido, con la fila omitida al lado: el boton parecia
       * no hacer nada.
       */
      and not exists (
        select 1 from agendadas a
         where a.cliente_id = t.cliente_id
           and (a.estado <> 'omitida' or a.fecha = t.primera)
      )
  )

  select * from agendadas
  union all
  select * from sugeridas
  -- Por posicion y no por nombre: los nombres de `returns table` son
  -- parametros de la funcion y taparian a las columnas del resultado.
  order by 1, 2, 14 nulls last, 7;
$fn$;

comment on function public.agenda_semanal is
  'Lo agendado y lo que sugiere el rol maestro, dia por dia. El atrasado cae en hoy; una semana ya pasada no propone nada.';

grant execute on function public.agenda_semanal(date, date, uuid) to authenticated;


-- ── 3 · El desplegable que aprende, aprendiendo de verdad ───────────────────

create or replace function public.cuando_se_da_frecuente(
  p_motivo text default null,
  p_limite int default 8
)
returns table (texto text, veces bigint)
language sql
stable
/*
 * `security definer` y no invoker.
 *
 * La politica de lectura de `reportes_problema` deja al vendedor ver solo los
 * suyos, y esta funcion existe justamente para ofrecerle lo que escribieron
 * LOS DEMAS. Con los permisos del que llama volvia vacia siempre.
 *
 * No filtra nada: devuelve la frase agrupada y cuantas veces se dijo. Nunca
 * quien la escribio, ni cuando, ni de que telefono. Y el minimo de dos
 * repeticiones agrega otra capa: una frase que escribio una sola persona no
 * sale nunca de aca.
 */
security definer
set search_path to 'public', 'pg_temp'
as $fn$
  -- Las columnas de adentro NO se llaman `texto` ni `veces` a proposito: esos
  -- son los nombres de las columnas que devuelve la funcion, y en una funcion
  -- SQL esos nombres son parametros.
  with dichas as (
    select
      btrim(r.cuando_se_da) as frase,
      lower(translate(btrim(r.cuando_se_da),
                      'áéíóúüñÁÉÍÓÚÜÑ',
                      'aeiouunAEIOUUN')) as clave
    from public.reportes_problema r
    where r.cuando_se_da is not null
      and length(btrim(r.cuando_se_da)) between 3 and 120
      and (p_motivo is null or r.motivo = p_motivo)
  ),
  agrupadas as (
    select
      d.clave,
      count(*) as repeticiones,
      (array_agg(d.frase order by d.frase))[1] as frase
    from dichas d
    group by d.clave
  )
  select a.frase, a.repeticiones
    from agrupadas a
   where a.repeticiones >= 2
   order by a.repeticiones desc, a.frase
   limit least(coalesce(p_limite, 8), 30);
$fn$;

comment on function public.cuando_se_da_frecuente is
  'Las respuestas de "cuando suele darse" que ya escribieron otros. Definer: devuelve la frase y el conteo, nunca quien.';

revoke all on function public.cuando_se_da_frecuente(text, int) from public;
grant execute on function public.cuando_se_da_frecuente(text, int) to authenticated;


-- ── 4a · Agendar sin chocar contra el unico por jornada ─────────────────────

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

  /*
   * Se busca CUALQUIER parada de ese cliente ese dia, no solo las pendientes.
   *
   * `paradas_un_cliente_por_jornada` es un unico sobre (rol_visita_id,
   * cliente_id) que no mira el estado. Mirando solo las pendientes, una parada
   * omitida del mismo cliente pasaba desapercibida, se intentaba insertar otra,
   * y el vendedor recibia el texto crudo del indice violado.
   */
  select * into nueva
    from public.paradas
   where rol_visita_id = jornada
     and cliente_id = p_cliente_id
   limit 1;

  if nueva.id is not null then
    if nueva.estado = 'omitida' then
      -- La habia sacado de la agenda y la vuelve a poner: se reabre en vez de
      -- crear otra. Es lo mismo que quiso hacer, y no deja dos filas del mismo
      -- cliente el mismo dia.
      update public.paradas set estado = 'pendiente' where id = nueva.id;
      select * into nueva from public.paradas where id = nueva.id;

    elsif nueva.estado not in ('pendiente', 'en_camino') then
      raise exception 'A ese cliente ya lo tenes resuelto ese dia: no se puede volver a agendar.'
        using errcode = '23514';
    end if;
    -- Pendiente o en camino: ya estaba agendado, se devuelve el que hay. Tocar
    -- dos veces el mismo boton con la senal lenta es lo mas facil del mundo.

  else
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
  'Agenda a un cliente para una fecha. Si ese dia ya tenia una parada, la devuelve; si estaba omitida, la reabre.';

grant execute on function public.agendar_visita(uuid, date, timestamptz) to authenticated;


-- ── 4b · Mover sin chocar contra el unico por jornada ───────────────────────

create or replace function public.mover_parada(
  p_parada_id   uuid,
  p_fecha       date default null,
  p_hora        timestamptz default null,
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
  cambio_de_dia boolean := false;
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

    /*
     * El dia destino no puede tener ya una parada de este cliente.
     *
     * `paradas_un_cliente_por_jornada` es un unico que no mira el estado, asi
     * que sin esta guarda el update chocaba contra el indice y el vendedor
     * recibia el texto crudo de Postgres. Se corta antes, con un mensaje que
     * se entiende y que ademas es la verdad: ese cliente ya esta ahi.
     */
    if actual.cliente_id is not null and exists (
      select 1 from public.paradas x
       where x.rol_visita_id = destino
         and x.cliente_id = actual.cliente_id
         and x.id <> p_parada_id
    ) then
      raise exception 'Ese cliente ya esta en la agenda de ese dia.' using errcode = '23514';
    end if;

    cambio_de_dia := true;

    -- `orden` es unico dentro de la jornada: el que traia del dia viejo
    -- chocaria con el de la parada que ya ocupa ese lugar. Va al final; donde
    -- va de verdad lo decide despues la optimizacion de la ruta.
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

  elsif cambio_de_dia and actual.hora_estimada is not null then
    -- Se conserva la hora del dia y se le cambia la fecha. El que puso "16:30"
    -- para el martes y lo pasa al jueves quiere las 16:30 del jueves.
    update public.paradas
       set hora_estimada = (
             (p_fecha + (actual.hora_estimada at time zone 'America/Argentina/Buenos_Aires')::time)
             at time zone 'America/Argentina/Buenos_Aires'
           )
     where id = p_parada_id;
  end if;

  select * into resultado from public.paradas where id = p_parada_id;
  return resultado;
end;
$fn$;

comment on function public.mover_parada is
  'Cambia de dia y/o de hora una parada pendiente. La manda al final del dia destino, le muda la hora, y corta con un mensaje claro si el cliente ya esta agendado ahi.';

grant execute on function public.mover_parada(uuid, date, timestamptz, boolean) to authenticated;
