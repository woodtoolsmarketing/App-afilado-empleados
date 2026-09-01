-- =============================================================================
-- Los carteles de la agenda, escritos como se lee la app.
--
-- Los `raise exception` de las funciones de la agenda salieron sin acentos, y
-- esos textos NO son mensajes de servidor: viajan tal cual a un Alert de la
-- app. El vendedor abre el calendario y lee "Ese cliente ya esta en la agenda
-- de ese dia" al lado de una pantalla que escribe "está" y "día" en todos los
-- demás carteles. Se nota, y lo que se nota es que ese pedazo lo escribió otro.
--
-- Sólo cambian los textos. La lógica queda igual que en la migración anterior.
-- =============================================================================

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
    raise exception 'No se puede agendar para un día que ya pasó.' using errcode = '23514';
  end if;

  select dd.id into direccion
    from public.direcciones dd
   where dd.cliente_id = p_cliente_id
   order by dd.principal desc, dd.creado_en
   limit 1;

  if direccion is null then
    raise exception 'Ese cliente todavía no está ubicado en el mapa. Ubicalo desde AGREGAR DESTINO antes de agendarlo.'
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
      raise exception 'A ese cliente ya lo tenés resuelto ese día: no se puede volver a agendar.'
        using errcode = '23514';
    end if;
    -- Pendiente o en camino: ya estaba agendado, se devuelve el que hay.

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

grant execute on function public.agendar_visita(uuid, date, timestamptz) to authenticated;


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
    raise exception 'Ese destino ya no está en tu agenda.' using errcode = '23514';
  end if;

  select fecha into fecha_actual from public.roles_visita where id = actual.rol_visita_id;

  if actual.estado not in ('pendiente', 'en_camino') then
    raise exception 'Ese destino ya se resolvió: no se puede mover ni reprogramar.'
      using errcode = '23514';
  end if;

  destino := actual.rol_visita_id;

  if p_fecha is not null and p_fecha is distinct from fecha_actual then
    if p_fecha < interno.hoy_ar() then
      raise exception 'No se puede agendar para un día que ya pasó.' using errcode = '23514';
    end if;

    destino := public.jornada_del_dia(p_fecha);

    -- El dia destino no puede tener ya una parada de este cliente: el unico
    -- `paradas_un_cliente_por_jornada` no mira el estado, asi que sin esta
    -- guarda el update chocaba y salia el texto crudo de Postgres.
    if actual.cliente_id is not null and exists (
      select 1 from public.paradas x
       where x.rol_visita_id = destino
         and x.cliente_id = actual.cliente_id
         and x.id <> p_parada_id
    ) then
      raise exception 'Ese cliente ya está en la agenda de ese día.' using errcode = '23514';
    end if;

    cambio_de_dia := true;

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
    -- Se conserva la hora del dia y se le cambia la fecha: el que puso "16:30"
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

grant execute on function public.mover_parada(uuid, date, timestamptz, boolean) to authenticated;


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
    raise exception 'Ese destino ya se resolvió: no se puede sacar de la agenda.'
      using errcode = '23514';
  end if;

  return resultado;
end;
$fn$;

grant execute on function public.quitar_de_la_agenda(uuid) to authenticated;


create or replace function public.reportar_problema(
  p_motivo       text,
  p_detalle      text default null,
  p_cuando_se_da text default null,
  p_pantalla     text default null,
  p_version_app  text default null,
  p_instalacion  text default null,
  p_modelo       text default null
)
returns public.reportes_problema
language plpgsql
security invoker
set search_path to 'public', 'extensions', 'pg_temp'
as $fn$
declare
  guardado public.reportes_problema;
begin
  if coalesce(btrim(p_motivo), '') = '' then
    raise exception 'Elegí cuál es el problema antes de enviarlo.'
      using errcode = '23514';
  end if;

  insert into public.reportes_problema (
    vendedor_id, motivo, detalle, cuando_se_da,
    pantalla, version_app, instalacion, modelo
  )
  values (
    auth.uid(),
    btrim(p_motivo),
    nullif(btrim(coalesce(p_detalle, '')), ''),
    nullif(btrim(coalesce(p_cuando_se_da, '')), ''),
    nullif(btrim(coalesce(p_pantalla, '')), ''),
    nullif(btrim(coalesce(p_version_app, '')), ''),
    nullif(btrim(coalesce(p_instalacion, '')), ''),
    nullif(btrim(coalesce(p_modelo, '')), '')
  )
  returning * into guardado;

  return guardado;
end;
$fn$;

grant execute on function public.reportar_problema(text, text, text, text, text, text, text)
  to authenticated;
