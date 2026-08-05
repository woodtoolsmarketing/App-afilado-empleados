-- =============================================================================
-- WoodTools · Rol de Visita
-- 0002 · Tablas base: perfiles, dispositivos, clientes y direcciones
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- perfiles — extiende auth.users con los datos de negocio
-- ─────────────────────────────────────────────────────────────────────────────
create table public.perfiles (
  id                   uuid primary key references auth.users (id) on delete cascade,

  rol                  public.rol_usuario    not null default 'vendedor',
  estado               public.estado_usuario not null default 'pendiente',

  nombre_completo      text not null,
  -- El "Codigo" de la planilla en papel. Es lo que se muestra como "Vendedor #27".
  codigo_vendedor      text unique,
  email                text not null,
  telefono             text,
  foto_url             text,

  -- Punto de partida habitual de la jornada (depósito, sucursal o domicilio).
  -- Se usa como origen cuando se optimiza el recorrido antes de que el vendedor
  -- encienda el GPS.
  origen_lat           double precision,
  origen_lng           double precision,
  origen_descripcion   text,

  -- Auditoría de la aprobación
  aprobado_por         uuid references public.perfiles (id) on delete set null,
  aprobado_en          timestamptz,
  motivo_rechazo       text,

  ultimo_acceso_en     timestamptz,
  creado_en            timestamptz not null default now(),
  actualizado_en       timestamptz not null default now(),

  constraint perfiles_codigo_vendedor_formato
    check (codigo_vendedor is null or codigo_vendedor ~ '^[A-Za-z0-9._-]{1,16}$'),

  constraint perfiles_vendedor_necesita_codigo
    check (rol <> 'vendedor' or codigo_vendedor is not null),

  -- Si está aprobado, tiene que constar quién y cuándo lo aprobó.
  constraint perfiles_aprobacion_completa
    check (estado <> 'aprobado' or aprobado_en is not null),

  constraint perfiles_origen_completo
    check ((origen_lat is null) = (origen_lng is null)),

  constraint perfiles_origen_rango
    check (
      origen_lat is null
      or (origen_lat between -90 and 90 and origen_lng between -180 and 180)
    )
);

create index perfiles_rol_estado_idx      on public.perfiles (rol, estado);
create index perfiles_estado_idx          on public.perfiles (estado) where estado = 'pendiente';
create index perfiles_nombre_busqueda_idx on public.perfiles using gin (nombre_completo extensions.gin_trgm_ops);

comment on table  public.perfiles                 is 'Datos de negocio de cada usuario. Se crea automáticamente al registrarse, en estado "pendiente".';
comment on column public.perfiles.codigo_vendedor is 'Campo "Codigo" de la planilla Rol de Visita. Se muestra en la app como "Vendedor #27".';
comment on column public.perfiles.origen_lat      is 'Punto de partida habitual de la jornada. Origen por defecto al optimizar el recorrido.';


-- ─────────────────────────────────────────────────────────────────────────────
-- dispositivos — celulares habilitados para usar la app
--
-- La app sólo funciona en teléfonos que un admin habilitó. Es la contracara en
-- la base de datos del control de distribución del APK.
-- ─────────────────────────────────────────────────────────────────────────────
create table public.dispositivos (
  id                 uuid primary key default extensions.gen_random_uuid(),
  perfil_id          uuid not null references public.perfiles (id) on delete cascade,

  -- Identificador estable generado por la app y guardado en el almacén seguro
  -- del teléfono (expo-secure-store). Sobrevive a la actualización de la app,
  -- no a la desinstalación.
  instalacion_id     text not null,

  fabricante         text,
  modelo             text,
  version_so         text,
  version_app        text,

  autorizado         boolean not null default false,
  autorizado_por     uuid references public.perfiles (id) on delete set null,
  autorizado_en      timestamptz,

  push_token         text,
  ultimo_visto_en    timestamptz,
  creado_en          timestamptz not null default now(),

  unique (perfil_id, instalacion_id)
);

create index dispositivos_perfil_idx      on public.dispositivos (perfil_id);
create index dispositivos_pendientes_idx  on public.dispositivos (creado_en desc) where not autorizado;

comment on table public.dispositivos is 'Celulares habilitados. Un usuario aprobado igual no entra si el teléfono no está autorizado.';


-- ─────────────────────────────────────────────────────────────────────────────
-- clientes — cartera de clientes de WoodTools
-- ─────────────────────────────────────────────────────────────────────────────
create table public.clientes (
  id                 uuid primary key default extensions.gen_random_uuid(),

  -- "CLIENTE Nº" de la planilla en papel.
  codigo             text not null unique,
  razon_social       text not null,
  nombre_fantasia    text,
  cuit               text,

  telefono           text,
  email              text,
  -- Persona con la que se atiende habitualmente (columna "ATENDIDO / CONTACTO").
  contacto_nombre    text,

  -- Vendedor a cargo de la cuenta.
  vendedor_id        uuid references public.perfiles (id) on delete set null,

  activo             boolean not null default true,
  notas              text,

  creado_por         uuid references public.perfiles (id) on delete set null,
  creado_en          timestamptz not null default now(),
  actualizado_en     timestamptz not null default now(),

  constraint clientes_cuit_formato
    check (cuit is null or cuit ~ '^\d{2}-?\d{8}-?\d$')
);

create index clientes_vendedor_idx  on public.clientes (vendedor_id) where activo;
create index clientes_busqueda_idx  on public.clientes using gin (
  (coalesce(razon_social, '') || ' ' || coalesce(nombre_fantasia, '') || ' ' || codigo)
  extensions.gin_trgm_ops
);

comment on column public.clientes.codigo          is 'Columna "CLIENTE Nº" de la planilla Rol de Visita.';
comment on column public.clientes.contacto_nombre is 'Columna "ATENDIDO / CONTACTO" de la planilla.';


-- ─────────────────────────────────────────────────────────────────────────────
-- direcciones — un cliente puede tener varias (local, depósito, obra…)
-- ─────────────────────────────────────────────────────────────────────────────
create table public.direcciones (
  id                 uuid primary key default extensions.gen_random_uuid(),
  cliente_id         uuid references public.clientes (id) on delete cascade,

  etiqueta           text not null default 'Principal',

  -- Dirección tal cual la devuelve Google Places (formatted_address).
  direccion_formateada text not null,
  calle              text,
  numero             text,
  piso               text,
  depto              text,
  localidad          text,
  provincia          text,
  pais               text not null default 'Argentina',
  codigo_postal      text,

  lat                double precision not null,
  lng                double precision not null,
  -- Columna calculada: permite ordenar por cercanía con índice GiST.
  ubicacion          extensions.geography(Point, 4326)
                       generated always as (
                         extensions.st_setsrid(extensions.st_makepoint(lng, lat), 4326)::extensions.geography
                       ) stored,

  google_place_id    text,
  -- true cuando las coordenadas vienen de Google Places y no de una carga manual.
  verificada         boolean not null default false,
  principal          boolean not null default false,

  observaciones      text,
  creado_en          timestamptz not null default now(),
  actualizado_en     timestamptz not null default now(),

  constraint direcciones_lat_rango check (lat between -90 and 90),
  constraint direcciones_lng_rango check (lng between -180 and 180)
);

create index direcciones_cliente_idx   on public.direcciones (cliente_id);
create index direcciones_ubicacion_idx on public.direcciones using gist (ubicacion);
create index direcciones_place_idx     on public.direcciones (google_place_id) where google_place_id is not null;

-- Una sola dirección principal por cliente.
create unique index direcciones_una_principal_idx
  on public.direcciones (cliente_id)
  where principal and cliente_id is not null;

comment on column public.direcciones.ubicacion is 'Punto geográfico calculado a partir de lat/lng. Se usa con ST_Distance / KNN (<->) para ordenar por cercanía.';
comment on column public.direcciones.cliente_id is 'NULL cuando es un destino suelto cargado desde "AGREGAR NUEVO DESTINO" sin asociarlo a un cliente.';
