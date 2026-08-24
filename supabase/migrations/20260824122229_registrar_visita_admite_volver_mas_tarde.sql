-- Se reemplaza en vez de sobrecargar: dos funciones con el mismo nombre y un
-- parametro de diferencia dejan a PostgREST sin poder elegir cual, y las
-- llamadas de 14 argumentos que hacen los telefonos de hoy quedarian ambiguas.
-- El parametro nuevo tiene default, asi que esas llamadas siguen andando.
drop function if exists public.registrar_visita(
  uuid, boolean, boolean, boolean, boolean, boolean, public.motivo_no_visita,
  text, text, public.origen_observacion, text, double precision, double precision, real);

create function public.registrar_visita(
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

  update public.paradas
     set estado = 'en_camino'
   where id = (
     select id from public.paradas
      where rol_visita_id = parada.rol_visita_id
        and estado = 'pendiente'
        and (not vuelve or id <> p_parada_id)
      order by orden
      limit 1
   );

  return registro;
end;
$function$;

comment on function public.registrar_visita(
  uuid, boolean, boolean, boolean, boolean, boolean, public.motivo_no_visita,
  text, text, public.origen_observacion, text, double precision, double precision, real, timestamptz) is
  'Registra el parte de una visita y cierra la parada. Con motivo visitar_mas_tarde la deja pendiente con su hora, para que vuelva a aparecer en el recorrido. Atomica.';
