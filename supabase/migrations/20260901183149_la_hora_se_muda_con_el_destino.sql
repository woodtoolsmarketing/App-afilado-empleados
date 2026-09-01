-- =============================================================================
-- La hora se muda con el destino.
--
-- `mover_parada` cambiaba el dia y dejaba `hora_estimada` como estaba. Y esa
-- columna no guarda "16:30": guarda una marca de tiempo completa, o sea "el
-- martes a las 16:30". Mover al jueves una parada con hora dejaba el jueves un
-- destino cuya hora seguia apuntando al martes.
--
-- Lo que se rompia con eso no era solo lo que se ve. `todaviaNoLeToca` decide a
-- quien promover a "en camino" comparando esa marca contra el reloj: una hora
-- que quedo en el pasado hace que la parada se considere vencida el mismo dia
-- que se la agenda, y el recorrido la ofrece como proximo destino antes de
-- tiempo.
--
-- Ahora se conserva la HORA DEL DIA y se le cambia la fecha. En hora de
-- Argentina, no en UTC: el servidor esta en UTC y sacar el ":30" de una marca
-- sin convertir primero devuelve la hora de Londres.
-- =============================================================================

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

    cambio_de_dia := true;
    destino := public.jornada_del_dia(p_fecha);

    -- `orden` es unico dentro de la jornada: el que traia del dia viejo chocaria
    -- con el de la parada que ya ocupa ese lugar. Va al final; donde va de
    -- verdad lo decide despues la optimizacion de la ruta.
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
  'Cambia de dia y/o de hora una parada pendiente. La manda al final del dia destino y le muda la hora del dia.';

grant execute on function public.mover_parada(uuid, date, timestamptz, boolean) to authenticated;
