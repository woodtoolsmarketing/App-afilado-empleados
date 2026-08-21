-- =============================================================================
-- `registrar_visita` no podía cerrar una sola visita
--
-- ── El síntoma ──────────────────────────────────────────────────────────────
--
-- `visitas` tenía 0 filas. No pocas: cero, desde el primer día, contra 5 roles
-- de visita y 12 paradas. Ninguna parada llegó nunca al estado "visitada":
-- quedaron 10 en "omitida", 1 pendiente y 1 en camino.
--
-- ── La causa ────────────────────────────────────────────────────────────────
--
-- En `20260803183705_funciones_y_logica.sql:590`:
--
--     update public.paradas
--        set estado = case when p_visitado then 'visitada' else 'no_visitada' end
--
-- Un `case` cuyas dos ramas son literales sin tipo NO se queda en `unknown`:
-- Postgres lo resuelve a `text`. Y de `text` a un enum no hay cast de
-- asignación — hay que pedirlo explícito. Resultado:
--
--     42804: column "estado" is of type estado_parada
--            but expression is of type text
--
-- El `update` de tres líneas más abajo (`set estado = 'en_camino'`) nunca dio
-- problema, y por eso el error pasó desapercibido tanto tiempo: ahí el literal
-- va solo, se queda en `unknown` y el coercionador lo resuelve contra la
-- columna sin quejarse. Es el `case` el que fuerza el tipo antes de que la
-- columna pueda opinar.
--
-- El orden de las operaciones explica por qué no quedó ni rastro: el `insert`
-- en `visitas` sale bien, este `update` explota, y la transacción entera se
-- revierte. Del lado del teléfono se veía "no se pudo guardar la visita" sin
-- ninguna pista de por qué.
--
-- ── El arreglo ──────────────────────────────────────────────────────────────
--
-- Un cast. El resto del cuerpo queda igual que en la 20260803183705.
--
-- Se escribe el enum una sola vez y afuera del `case`, no `'visitada'::x` en
-- cada rama: si mañana se agrega un tercer estado, el cast sigue siendo uno.
-- =============================================================================

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
  p_precision_m       real default null
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

  -- El desvío sólo se puede medir si el teléfono trajo coordenadas. Sin señal
  -- la visita se registra igual, sin punto y sin desvío.
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

  -- El cast que faltaba: sin él, `case` devuelve text y el update no compila
  -- contra una columna enum.
  update public.paradas
     set estado     = (case when p_visitado then 'visitada' else 'no_visitada' end)::public.estado_parada,
         llegada_en = coalesce(llegada_en, now()),
         salida_en  = now()
   where id = p_parada_id;

  -- La siguiente parada pendiente pasa a "en camino".
  update public.paradas
     set estado = 'en_camino'
   where id = (
     select id from public.paradas
      where rol_visita_id = parada.rol_visita_id
        and estado = 'pendiente'
      order by orden
      limit 1
   );

  return registro;
end;
$function$;

comment on function public.registrar_visita is
  'Registra el parte de una visita y cierra la parada. Atomica: si algo falla, '
  'no queda ni la visita ni el cambio de estado.';
