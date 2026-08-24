-- Entrada y salida del vendedor, con su ubicacion.
--
-- ── Que es y que NO es ──────────────────────────────────────────────────────
--
-- Es un FICHAJE: dos momentos por dia, cada uno con su coordenada, mas cuantas
-- veces abrio la app. No es seguimiento continuo.
--
-- La diferencia no es de implementacion, es de lo que se le prometio al
-- vendedor. El texto del permiso que ya acepto dice que la oficina lo ve
-- "mientras el recorrido este en curso", y el aviso de Configuracion repite lo
-- mismo. Un servicio prendido diez horas contradice las dos cosas, y eso ya no
-- es control de presencia: es rastreo encubierto de un empleado.
--
-- ── Una fila por dia, no un evento por toque ────────────────────────────────
--
-- La entrada es la primera actividad de la jornada y la salida la ultima. Con
-- una fila por evento habria que reconstruirlas cada vez que alguien pregunta a
-- que hora entro, y la respuesta dependeria de como se hizo la consulta.
--
-- `aperturas` y `ultima_actividad_en` son lo que distingue "estuvo trabajando"
-- de "fichó a las 8 y dejo el telefono en el auto".

create table if not exists public.presencias (
  vendedor_id         uuid not null references public.perfiles (id) on delete cascade,
  fecha               date not null,

  entrada_en          timestamptz,
  entrada_lat         double precision,
  entrada_lng         double precision,

  salida_en           timestamptz,
  salida_lat          double precision,
  salida_lng          double precision,

  /* Cuantas veces la app paso al frente. Es la senal de uso mas barata que hay. */
  aperturas           integer not null default 0,
  ultima_actividad_en timestamptz,

  creado_en           timestamptz not null default now(),
  actualizado_en      timestamptz not null default now(),

  primary key (vendedor_id, fecha),
  constraint presencias_entrada_completa check ((entrada_lat is null) = (entrada_lng is null)),
  constraint presencias_salida_completa  check ((salida_lat is null) = (salida_lng is null)),
  constraint presencias_salida_posterior check (salida_en is null or entrada_en is null or salida_en >= entrada_en)
);

comment on table public.presencias is
  'Fichaje diario del vendedor: entrada, salida y uso de la app. Una fila por vendedor y dia.';

alter table public.presencias enable row level security;

drop policy if exists presencias_propias_leer on public.presencias;
create policy presencias_propias_leer on public.presencias
  for select to authenticated
  using (interno.puede_ver_todo() or vendedor_id = auth.uid());

drop policy if exists presencias_admin on public.presencias;
create policy presencias_admin on public.presencias
  for all to authenticated
  using (interno.es_admin()) with check (interno.es_admin());

create trigger presencias_tocar_actualizado
  before update on public.presencias
  for each row execute function interno.tocar_actualizado_en();

-- ── Fichar ──────────────────────────────────────────────────────────────────
--
-- SECURITY DEFINER porque el vendedor no escribe la tabla directo: si pudiera,
-- podria corregirse la hora de entrada, que es exactamente lo que un fichaje no
-- tiene que permitir. La funcion siempre usa `auth.uid()` y `now()`; ni el
-- vendedor ni la app eligen de quien ni de cuando es el registro.
--
-- La ventana 8:00-18:00 decide que mueve la ENTRADA y la SALIDA. Fuera de esa
-- franja la actividad se sigue anotando —sirve para saber que estuvo— pero no
-- corre el horario: un vendedor que mira el telefono a las 22:00 no fichó a las
-- 22:00.

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
    -- La entrada se escribe UNA vez: es la primera actividad de la jornada.
    entrada_en  = coalesce(p.entrada_en,  excluded.entrada_en),
    entrada_lat = coalesce(p.entrada_lat, excluded.entrada_lat),
    entrada_lng = coalesce(p.entrada_lng, excluded.entrada_lng),
    -- La salida se corre con cada actividad: la ultima es la que vale.
    salida_en   = coalesce(excluded.salida_en,  p.salida_en),
    salida_lat  = coalesce(excluded.salida_lat, p.salida_lat),
    salida_lng  = coalesce(excluded.salida_lng, p.salida_lng),
    aperturas   = p.aperturas + 1,
    ultima_actividad_en = ahora
  returning * into fila;

  return fila;
end;
$function$;

revoke all on function public.fichar(double precision, double precision) from public;
grant execute on function public.fichar(double precision, double precision) to authenticated;

comment on function public.fichar is
  'Registra actividad del vendedor. La primera del dia entre las 8 y las 18 fija la entrada; la ultima, la salida. Fuera de esa franja solo cuenta como uso.';
