-- =============================================================================
-- "COTIZÓ" pasa a ser un tipo de visita más, como VENDIÓ / COBRÓ / RETIRÓ /
-- ENTREGÓ / NO TENÍA NADA / OTRAS.
--
-- Antes era sólo una casilla LOCAL del teléfono (no un campo del parte) que
-- escribía en la observación. Como la base no la conocía, marcarla no contaba
-- como "tipo de visita": el CHECK `visitas_tipo_obligatorio` —y el validador de
-- la app— seguían exigiendo marcar otra cosa, así que tildar COTIZÓ y nada más
-- dejaba el cartel "Marcá al menos un tipo de visita".
--
-- Ahora es una columna propia. Marcarla sola ya alcanza, y anotar QUÉ se cotizó
-- queda opcional (se suma a la observación desde el popup del teléfono).
--
-- Mismo molde con que se agregaron sin_pedido y otras (20260917113347):
-- columna boolean not null default false, los dos CHECK de tipos la incluyen, y
-- registrar_visita suma el parámetro. El default false hace que todo lo que ya
-- existe —filas viejas y clientes viejos que no mandan p_cotizo— siga válido.
-- =============================================================================

alter table public.visitas
  add column if not exists cotizo boolean not null default false;

comment on column public.visitas.cotizo is
  'Se visitó al cliente y se le pasó un precio (cotización), aunque no terminara en nota. Cuenta como tipo de visita.';

-- "Al menos un tipo de visita" ahora incluye cotizó.
alter table public.visitas drop constraint if exists visitas_tipo_obligatorio;
alter table public.visitas add constraint visitas_tipo_obligatorio
  check (not visitado or (vendio or cobro or retiro_afilado or entrego or sin_pedido or otras or cotizo));

-- Y "no visitada" tampoco puede traer ningún tipo, cotizó incluido.
alter table public.visitas drop constraint if exists visitas_no_visitada_sin_tipos;
alter table public.visitas add constraint visitas_no_visitada_sin_tipos
  check (visitado or not (vendio or cobro or retiro_afilado or entrego or sin_pedido or otras or cotizo));


-- ── registrar_visita: acepta el tipo nuevo ──────────────────────────────────
--
-- Sumar un parámetro es DROP + CREATE: `create or replace` con una firma nueva
-- crearía un segundo overload y la llamada quedaría ambigua. El cliente llama
-- por nombre de argumento, así que el orden no importa, y los clientes viejos
-- —que no mandan p_cotizo— siguen andando porque tiene DEFAULT false. El cuerpo
-- es idéntico al de 20261106195653 (preserva geo al corregir) + cotizó.

drop function if exists public.registrar_visita(
  uuid, boolean, boolean, boolean, boolean, boolean, boolean, boolean, text,
  motivo_no_visita, text, text, origen_observacion, text,
  double precision, double precision, real, timestamptz
);

create function public.registrar_visita(
  p_parada_id uuid, p_visitado boolean, p_vendio boolean DEFAULT false,
  p_cobro boolean DEFAULT false, p_retiro_afilado boolean DEFAULT false,
  p_entrego boolean DEFAULT false, p_sin_pedido boolean DEFAULT false,
  p_otras boolean DEFAULT false, p_otras_detalle text DEFAULT NULL::text,
  p_motivo motivo_no_visita DEFAULT NULL::motivo_no_visita,
  p_contacto text DEFAULT NULL::text, p_observacion text DEFAULT ''::text,
  p_observacion_origen origen_observacion DEFAULT 'texto'::origen_observacion,
  p_audio_url text DEFAULT NULL::text, p_lat double precision DEFAULT NULL::double precision,
  p_lng double precision DEFAULT NULL::double precision, p_precision_m real DEFAULT NULL::real,
  p_volver_a_las timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_cotizo boolean DEFAULT false)
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
    visitado, vendio, cobro, retiro_afilado, entrego, sin_pedido, otras, otras_detalle, cotizo,
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
    p_visitado and p_cotizo,
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
    cotizo = excluded.cotizo,
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

-- Supabase otorga EXECUTE a estos roles por defecto al crear funciones en
-- `public`; se re-otorga explícito para que el DROP+CREATE no cambie el acceso
-- (es SECURITY INVOKER: la RLS de visitas/paradas sigue gateando igual).
grant execute on function public.registrar_visita(
  uuid, boolean, boolean, boolean, boolean, boolean, boolean, boolean, text,
  motivo_no_visita, text, text, origen_observacion, text,
  double precision, double precision, real, timestamptz, boolean
) to anon, authenticated, service_role;
