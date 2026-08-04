-- =============================================================================
-- WoodTools · Rol de Visita
-- 0004 · Seguimiento en vivo, configuración y auditoría
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- posiciones_actuales — una fila por vendedor: el pin que ve el admin
--
-- Se hace UPSERT cada ~20 s mientras el recorrido está en curso. Al ser una
-- sola fila por vendedor, el admin puede suscribirse por Postgres Changes sin
-- riesgo de inundar el canal.
-- ─────────────────────────────────────────────────────────────────────────────
create table public.posiciones_actuales (
  vendedor_id     uuid primary key references public.perfiles (id) on delete cascade,
  rol_visita_id   uuid references public.roles_visita (id) on delete set null,

  lat             double precision not null,
  lng             double precision not null,
  precision_m     real,
  velocidad_mps   real,
  rumbo           real,
  bateria_pct     smallint,

  -- Se apaga al finalizar el recorrido: el admin deja de verlo en el mapa.
  en_recorrido    boolean not null default false,

  actualizado_en  timestamptz not null default now(),

  constraint posiciones_actuales_lat_rango check (lat between -90 and 90),
  constraint posiciones_actuales_lng_rango check (lng between -180 and 180),
  constraint posiciones_actuales_bateria   check (bateria_pct is null or bateria_pct between 0 and 100)
);

create index posiciones_actuales_en_recorrido_idx
  on public.posiciones_actuales (actualizado_en desc) where en_recorrido;

comment on table public.posiciones_actuales is 'Última posición conocida de cada vendedor. Es lo que el panel de administración muestra en vivo.';


-- ─────────────────────────────────────────────────────────────────────────────
-- posiciones — histórico del recorrido (append-only)
--
-- Sirve para dibujar "por dónde anduvo" al reproducir una jornada pasada.
-- Se poda automáticamente junto con el archivado a los 90 días.
-- ─────────────────────────────────────────────────────────────────────────────
create table public.posiciones (
  id             bigint generated always as identity primary key,
  rol_visita_id  uuid not null references public.roles_visita (id) on delete cascade,
  vendedor_id    uuid not null references public.perfiles (id) on delete cascade,

  lat            double precision not null,
  lng            double precision not null,
  precision_m    real,
  velocidad_mps  real,
  rumbo          real,
  bateria_pct    smallint,

  registrado_en  timestamptz not null default now(),

  constraint posiciones_lat_rango check (lat between -90 and 90),
  constraint posiciones_lng_rango check (lng between -180 and 180)
);

create index posiciones_rol_visita_idx on public.posiciones (rol_visita_id, registrado_en);
create index posiciones_fecha_idx      on public.posiciones (registrado_en);

comment on table public.posiciones is 'Traza histórica del recorrido. Append-only, se poda a los 90 días.';


-- ─────────────────────────────────────────────────────────────────────────────
-- sesiones_app — telemetría de "¿están entrando a la app?"
-- ─────────────────────────────────────────────────────────────────────────────
create table public.sesiones_app (
  id             uuid primary key default extensions.gen_random_uuid(),
  perfil_id      uuid not null references public.perfiles (id) on delete cascade,
  dispositivo_id uuid references public.dispositivos (id) on delete set null,

  abierta_en     timestamptz not null default now(),
  ultimo_latido  timestamptz not null default now(),
  cerrada_en     timestamptz,

  version_app    text,
  recordar_hasta timestamptz   -- vencimiento del "Recordar mi cuenta por 30 días"
);

create index sesiones_app_perfil_idx on public.sesiones_app (perfil_id, abierta_en desc);
create index sesiones_app_activas_idx on public.sesiones_app (ultimo_latido desc) where cerrada_en is null;

comment on table public.sesiones_app is 'Registro de aperturas de la app. Permite al admin ver quién está entrando y desde qué versión.';


-- ─────────────────────────────────────────────────────────────────────────────
-- configuracion — parámetros operativos editables sin desplegar
-- ─────────────────────────────────────────────────────────────────────────────
create table public.configuracion (
  clave          text primary key,
  valor          jsonb not null,
  descripcion    text,
  actualizado_por uuid references public.perfiles (id) on delete set null,
  actualizado_en timestamptz not null default now()
);

insert into public.configuracion (clave, valor, descripcion) values
  ('tracking_intervalo_seg',      '20',    'Cada cuántos segundos la app reporta su posición durante el recorrido.'),
  ('tracking_distancia_min_m',    '30',    'Distancia mínima recorrida para reportar una nueva posición.'),
  ('llegada_radio_m',             '150',   'Radio en metros dentro del cual se considera que el vendedor llegó al destino.'),
  ('desvio_maximo_alerta_m',      '500',   'Si el parte se firma a más de esta distancia del cliente, se marca para revisión.'),
  ('retencion_historial_dias',    '90',    'Días de historial visibles en la app. Pasado ese plazo se archiva a Excel.'),
  ('recordar_sesion_dias',        '30',    'Duración del "Recordar mi cuenta".'),
  ('prioridad_media_offset',      '3',     'Cuántos destinos más adelante se inserta una parada de prioridad media.'),
  ('maximo_paradas_por_jornada',  '25',    'Tope de paradas por jornada (límite de la optimización de Google Routes API).')
on conflict (clave) do nothing;


-- ─────────────────────────────────────────────────────────────────────────────
-- auditoria — quién hizo qué
-- ─────────────────────────────────────────────────────────────────────────────
create table public.auditoria (
  id          bigint generated always as identity primary key,
  actor_id    uuid references public.perfiles (id) on delete set null,
  accion      text not null,
  entidad     text not null,
  entidad_id  text,
  datos       jsonb,
  creado_en   timestamptz not null default now()
);

create index auditoria_entidad_idx on public.auditoria (entidad, entidad_id, creado_en desc);
create index auditoria_actor_idx   on public.auditoria (actor_id, creado_en desc);
