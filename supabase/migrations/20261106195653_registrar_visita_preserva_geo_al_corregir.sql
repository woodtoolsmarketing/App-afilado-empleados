-- #10 (editar el parte hasta imprimir): cuando se REABRE una parada que ya
-- quedó 'visitada' para corregir el parte, la correccion no puede pisar la
-- geolocalizacion ni la hora que se capturaron en el momento real de la visita.
--
-- Antes, el ON CONFLICT pisaba lat/lng/precision/desvio con la posicion ACTUAL
-- del vendedor (que puede estar corrigiendo desde su casa, horas despues) y
-- reseteaba salida_en = now(). Eso corrompia el indicador de "visita en el
-- lugar / no cerca" que muestra el rol.
--
-- El unico camino que llega aca con la parada ya en 'visitada' es la reapertura
-- de #10: el flujo diferir->revisitar guarda mientras la parada sigue
-- 'pendiente', asi que ahi v_correccion es false y se captura la posicion nueva,
-- como debe ser. Por eso alcanza con mirar el estado actual de la parada.
create or replace function public.registrar_visita(
  p_parada_id uuid, p_visitado boolean, p_vendio boolean DEFAULT false,
  p_cobro boolean DEFAULT false, p_retiro_afilado boolean DEFAULT false,
  p_entrego boolean DEFAULT false, p_sin_pedido boolean DEFAULT false,
  p_otras boolean DEFAULT false, p_otras_detalle text DEFAULT NULL::text,
  p_motivo motivo_no_visita DEFAULT NULL::motivo_no_visita,
  p_contacto text DEFAULT NULL::text, p_observacion text DEFAULT ''::text,
  p_observacion_origen origen_observacion DEFAULT 'texto'::origen_observacion,
  p_audio_url text DEFAULT NULL::text, p_lat double precision DEFAULT NULL::double precision,
  p_lng double precision DEFAULT NULL::double precision, p_precision_m real DEFAULT NULL::real,
  p_volver_a_las timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS visitas
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  parada        public.paradas;
  jornada       public.roles_visita;
  registro      public.visitas;
  desvio        integer;
  vuelve        boolean;
  v_correccion  boolean;
begin
  select * into parada from public.paradas where id = p_parada_id;
  if parada.id is null then
    raise exception 'No existe la parada %', p_parada_id using errcode = 'P0002';
  end if;

  -- La parada ya estaba cerrada como visitada: esto es una correccion del parte
  -- (#10), no una visita nueva. No se toca lo que se capturo en el momento.
  v_correccion := (parada.estado = 'visitada'::public.estado_parada);

  select * into jornada from public.roles_visita where id = parada.rol_visita_id;

  if not interno.observacion_valida(p_observacion) then
    raise exception 'La observacion es obligatoria: escribi al menos una frase describiendo que paso en la visita.'
      using errcode = '23514';
  end if;

  if p_visitado and p_otras and (p_otras_detalle is null or btrim(p_otras_detalle) = '') then
    raise exception 'Marcaste "Otras": conta que paso en el campo de al lado.'
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
    visitado, vendio, cobro, retiro_afilado, entrego, sin_pedido, otras, otras_detalle,
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
    p_visitado and p_sin_pedido,
    p_visitado and p_otras,
    case when p_visitado and p_otras then nullif(btrim(p_otras_detalle), '') else null end,
    case when p_visitado then null else p_motivo end,
    nullif(trim(p_contacto), ''),
    trim(p_observacion), p_observacion_origen, p_audio_url,
    p_lat, p_lng, p_precision_m, desvio
  )
  on conflict (parada_id) do update set
    visitado = excluded.visitado,
    vendio = excluded.vendio, cobro = excluded.cobro,
    retiro_afilado = excluded.retiro_afilado, entrego = excluded.entrego,
    sin_pedido = excluded.sin_pedido, otras = excluded.otras,
    otras_detalle = excluded.otras_detalle,
    motivo_no_visita = excluded.motivo_no_visita,
    contacto_nombre = excluded.contacto_nombre,
    observacion = excluded.observacion,
    observacion_origen = excluded.observacion_origen,
    observacion_audio_url = excluded.observacion_audio_url,
    -- En una correccion se conserva lo capturado en la visita real; en una
    -- visita/revisita de verdad se escribe la posicion nueva.
    lat = case when v_correccion then public.visitas.lat else excluded.lat end,
    lng = case when v_correccion then public.visitas.lng else excluded.lng end,
    precision_m = case when v_correccion then public.visitas.precision_m else excluded.precision_m end,
    desvio_m = case when v_correccion then public.visitas.desvio_m else excluded.desvio_m end,
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
           -- Una correccion no mueve la hora de salida que ya quedo registrada.
           salida_en  = case when v_correccion then salida_en else now() end
     where id = p_parada_id;
  end if;

  -- El reacomodo del 'en_camino' es parte de AVANZAR el recorrido; una
  -- correccion de un parte ya cerrado no tiene que cambiar a quien le toca.
  if not v_correccion then
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
  end if;

  return registro;
end;
$function$;
