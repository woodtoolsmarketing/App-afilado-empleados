-- =============================================================================
-- WoodTools · Rol de Visita
-- 0003 · La jornada: roles_visita → paradas → visitas
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Validación de observaciones
--
-- La consigna es explícita: no se acepta una observación vacía, ni un ".", ni
-- una sola palabra. Se valida acá (última línea de defensa) y también en el
-- cliente, para poder mostrar el mensaje de error mientras el vendedor escribe.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function interno.observacion_valida(texto text)
returns boolean
language sql
immutable
parallel safe
as $$
  select
    texto is not null
    -- Al menos 12 caracteres útiles (sin contar espacios ni puntuación suelta).
    and length(regexp_replace(texto, '[^[:alnum:]áéíóúüñÁÉÍÓÚÜÑ]', '', 'g')) >= 12
    -- Al menos 3 palabras de 2 o más letras: descarta ".", "ok", "-", "nada".
    and (
      select count(*)
      from regexp_matches(texto, '[[:alpha:]áéíóúüñÁÉÍÓÚÜÑ]{2,}', 'g')
    ) >= 3;
$$;

comment on function interno.observacion_valida is
  'Rechaza observaciones vacías o simbólicas ("." , "ok", una sola palabra). Exige ≥12 caracteres alfanuméricos y ≥3 palabras.';


-- ─────────────────────────────────────────────────────────────────────────────
-- roles_visita — una fila por vendedor y por día. Es la planilla del PDF.
-- ─────────────────────────────────────────────────────────────────────────────
create table public.roles_visita (
  id                     uuid primary key default extensions.gen_random_uuid(),
  vendedor_id            uuid not null references public.perfiles (id) on delete cascade,
  fecha                  date not null,

  estado                 public.estado_rol_visita not null default 'planificado',

  iniciado_en            timestamptz,
  finalizado_en          timestamptz,

  -- Origen desde el que se calculó el recorrido (GPS real al iniciar, o el
  -- origen habitual del perfil si todavía no arrancó).
  origen_lat             double precision,
  origen_lng             double precision,

  -- Resultado de la optimización de Google (Routes API).
  distancia_total_m      integer,
  duracion_total_seg     integer,
  polilinea              text,          -- polyline codificada del recorrido completo
  optimizado_en          timestamptz,

  observaciones_jornada  text,

  creado_por             uuid references public.perfiles (id) on delete set null,
  creado_en              timestamptz not null default now(),
  actualizado_en         timestamptz not null default now(),

  unique (vendedor_id, fecha),

  constraint roles_visita_origen_completo
    check ((origen_lat is null) = (origen_lng is null)),

  constraint roles_visita_iniciado_antes_de_finalizar
    check (finalizado_en is null or iniciado_en is null or finalizado_en >= iniciado_en),

  constraint roles_visita_en_curso_tiene_inicio
    check (estado <> 'en_curso' or iniciado_en is not null),

  constraint roles_visita_finalizado_tiene_cierre
    check (estado <> 'finalizado' or finalizado_en is not null)
);

create index roles_visita_vendedor_fecha_idx on public.roles_visita (vendedor_id, fecha desc);
create index roles_visita_fecha_idx          on public.roles_visita (fecha desc);
create index roles_visita_en_curso_idx       on public.roles_visita (vendedor_id) where estado = 'en_curso';

comment on table public.roles_visita is 'Equivale a una hoja de la planilla "Rol de Visita": un vendedor, un día.';


-- ─────────────────────────────────────────────────────────────────────────────
-- paradas — cada renglón numerado de la planilla
-- ─────────────────────────────────────────────────────────────────────────────
create table public.paradas (
  id                        uuid primary key default extensions.gen_random_uuid(),
  rol_visita_id             uuid not null references public.roles_visita (id) on delete cascade,

  cliente_id                uuid references public.clientes (id) on delete set null,
  direccion_id              uuid not null references public.direcciones (id) on delete restrict,

  -- Columna "Nº" de la planilla. Se recalcula cada vez que se optimiza la ruta.
  orden                     integer not null,
  prioridad                 public.prioridad_parada not null default 'baja',
  origen                    public.origen_parada    not null default 'planificada',
  estado                    public.estado_parada    not null default 'pendiente',

  -- Estimaciones que devuelve Google al optimizar.
  hora_estimada             timestamptz,
  distancia_desde_anterior_m   integer,
  duracion_desde_anterior_seg  integer,

  -- Columna "HORA" de la planilla: cuándo llegó realmente.
  llegada_en                timestamptz,
  salida_en                 timestamptz,

  -- Congela el nombre del cliente al momento de armar el rol, para que el
  -- histórico no cambie si después se edita la ficha del cliente.
  razon_social_snapshot     text,
  direccion_snapshot        text,

  agregada_por              uuid references public.perfiles (id) on delete set null,
  creado_en                 timestamptz not null default now(),
  actualizado_en            timestamptz not null default now(),

  constraint paradas_orden_positivo check (orden > 0),
  constraint paradas_salida_posterior check (salida_en is null or llegada_en is null or salida_en >= llegada_en)
);

-- El orden es único dentro de la jornada. DEFERRABLE porque al reordenar la
-- ruta se reescriben todas las filas dentro de la misma transacción.
create unique index paradas_orden_unico_idx on public.paradas (rol_visita_id, orden);
alter table public.paradas
  add constraint paradas_orden_unico unique using index paradas_orden_unico_idx deferrable initially deferred;

-- No hace falta un índice por (rol_visita_id, orden): el índice único de arriba
-- ya lo cubre.
create index paradas_cliente_idx    on public.paradas (cliente_id);
create index paradas_pendientes_idx on public.paradas (rol_visita_id, orden) where estado in ('pendiente', 'en_camino');

comment on table  public.paradas         is 'Cada renglón numerado del rol de visita.';
comment on column public.paradas.orden   is 'Columna "Nº" de la planilla. Lo recalcula la optimización de ruta.';
comment on column public.paradas.llegada_en is 'Columna "HORA" de la planilla: hora real de llegada al destino.';


-- ─────────────────────────────────────────────────────────────────────────────
-- visitas — el formulario "¿DESTINO VISITADO?"
-- ─────────────────────────────────────────────────────────────────────────────
create table public.visitas (
  id                    uuid primary key default extensions.gen_random_uuid(),
  parada_id             uuid not null unique references public.paradas (id) on delete cascade,

  -- Denormalizados para poder consultar el histórico sin joins encadenados.
  rol_visita_id         uuid not null references public.roles_visita (id) on delete cascade,
  vendedor_id           uuid not null references public.perfiles (id) on delete cascade,
  cliente_id            uuid references public.clientes (id) on delete set null,

  -- SI / NO
  visitado              boolean not null,

  -- "TIPO DE VISITA" de la planilla
  vendio                boolean not null default false,
  cobro                 boolean not null default false,
  retiro_afilado        boolean not null default false,
  entrego               boolean not null default false,

  -- Sólo cuando visitado = false
  motivo_no_visita      public.motivo_no_visita,

  -- "ATENDIDO / CONTACTO"
  contacto_nombre       text,

  -- "RESULTADO (OBSERVACIONES)" — obligatorio siempre
  observacion           text not null,
  observacion_origen    public.origen_observacion not null default 'texto',
  observacion_audio_url text,

  -- Dónde se registró el parte (para auditar que estuvo en el domicilio).
  lat                   double precision,
  lng                   double precision,
  precision_m           real,
  -- Distancia entre donde se registró y la dirección del cliente.
  desvio_m              integer,

  registrado_en         timestamptz not null default now(),
  creado_en             timestamptz not null default now(),
  actualizado_en        timestamptz not null default now(),

  -- ── Reglas del formulario ────────────────────────────────────────────────
  -- Si visitó, tiene que marcar al menos un tipo de visita.
  constraint visitas_tipo_obligatorio
    check (not visitado or (vendio or cobro or retiro_afilado or entrego)),

  -- Si NO visitó, tiene que indicar el motivo y no puede marcar tipos de visita.
  constraint visitas_motivo_obligatorio
    check (visitado or motivo_no_visita is not null),
  constraint visitas_no_visitada_sin_tipos
    check (visitado or not (vendio or cobro or retiro_afilado or entrego)),
  constraint visitas_motivo_solo_si_no_visito
    check (visitado is false or motivo_no_visita is null),

  -- La observación nunca puede ser un "." ni una sola palabra.
  constraint visitas_observacion_significativa
    check (interno.observacion_valida(observacion)),

  constraint visitas_coordenadas_completas
    check ((lat is null) = (lng is null))
);

create index visitas_rol_visita_idx on public.visitas (rol_visita_id);
create index visitas_vendedor_fecha_idx on public.visitas (vendedor_id, registrado_en desc);
create index visitas_cliente_idx on public.visitas (cliente_id, registrado_en desc);

comment on table  public.visitas             is 'Formulario "¿Destino visitado?". Una fila por parada resuelta.';
comment on column public.visitas.desvio_m    is 'Metros entre el lugar donde se firmó el parte y la dirección del cliente. Sirve para auditar.';
comment on column public.visitas.observacion is 'Columna "RESULTADO (OBSERVACIONES)". Obligatoria y validada: nunca vacía ni de una sola palabra.';
