-- =============================================================================
-- Dos resultados nuevos del parte "¿DESTINO VISITADO?", cuando SÍ se visitó:
--
--   sin_pedido   "No tenía nada el cliente": se lo visitó, se lo atendió, pero
--                no hubo trabajo ni pedido. Cuenta como visita hecha —el
--                vendedor fue— no como "no visitado".
--   otras        "Otras": pasó otra cosa. Habilita un texto libre (otras_detalle)
--                donde el vendedor cuenta qué.
--
-- Van junto a VENDIÓ / COBRÓ / RETIRÓ / ENTREGÓ, y como aquéllas sólo tienen
-- sentido con visitado = SÍ.
-- =============================================================================

alter table public.visitas
  add column if not exists sin_pedido    boolean not null default false,
  add column if not exists otras         boolean not null default false,
  add column if not exists otras_detalle text;

comment on column public.visitas.sin_pedido    is 'Se visitó al cliente pero no tenía nada (ni trabajo ni pedido). Cuenta como visita hecha.';
comment on column public.visitas.otras         is 'Se visitó al cliente y pasó otra cosa, contada a mano en otras_detalle.';
comment on column public.visitas.otras_detalle is 'Texto libre de "Otras". Obligatorio si otras = true, NULL si no.';

-- "Al menos un tipo de visita" ahora incluye los dos nuevos.
alter table public.visitas drop constraint if exists visitas_tipo_obligatorio;
alter table public.visitas add constraint visitas_tipo_obligatorio
  check (not visitado or (vendio or cobro or retiro_afilado or entrego or sin_pedido or otras));

-- Y "no visitada" tampoco puede traer ninguno de los tipos, ni los nuevos.
alter table public.visitas drop constraint if exists visitas_no_visitada_sin_tipos;
alter table public.visitas add constraint visitas_no_visitada_sin_tipos
  check (visitado or not (vendio or cobro or retiro_afilado or entrego or sin_pedido or otras));

-- El detalle de "Otras" existe si y sólo si "Otras" está marcada, y no vacío.
alter table public.visitas add constraint visitas_otras_con_detalle
  check (
    (otras and otras_detalle is not null and length(btrim(otras_detalle)) > 0)
    or (not otras and otras_detalle is null)
  );


-- ── registrar_visita: acepta los dos resultados nuevos ──────────────────────
--
-- Se borra la versión de 15 argumentos y se crea una de 18: los tres nuevos van
-- pegados a los otros tipos de visita. El cliente llama por nombre de argumento,
-- así que el orden no le afecta.

drop function if exists public.registrar_visita(
  uuid, boolean, boolean, boolean, boolean, boolean, public.motivo_no_visita,
  text, text, public.origen_observacion, text, double precision, double precision, real, timestamptz
);

create function public.registrar_visita(
  p_parada_id          uuid,
  p_visitado           boolean,
  p_vendio             boolean default false,
  p_cobro              boolean default false,
  p_retiro_afilado     boolean default false,
  p_entrego            boolean default false,
  p_sin_pedido         boolean default false,
  p_otras              boolean default false,
  p_otras_detalle      text default null,
  p_motivo             public.motivo_no_visita default null,
  p_contacto           text default null,
  p_observacion        text default '',
  p_observacion_origen public.origen_observacion default 'texto',
  p_audio_url          text default null,
  p_lat                double precision default null,
  p_lng                double precision default null,
  p_precision_m        real default null,
  p_volver_a_las       timestamptz default null
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

  -- "Otras" sin escribir qué pasó no dice nada, y ademas viola el CHECK. Se
  -- corta antes con un mensaje que se entiende.
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

  -- Promoción a 'en_camino' del próximo destino elegible (igual que antes):
  -- respeta la hora de las diferidas y no deja dos en camino a la vez.
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
  uuid, boolean, boolean, boolean, boolean, boolean, boolean, boolean, text,
  public.motivo_no_visita, text, text, public.origen_observacion, text,
  double precision, double precision, real, timestamptz) is
  'Registra el parte de una visita y cierra la parada. Con visitado = SÍ acepta ademas "no tenia nada" (sin_pedido) y "otras" (otras + otras_detalle). Atomica.';
