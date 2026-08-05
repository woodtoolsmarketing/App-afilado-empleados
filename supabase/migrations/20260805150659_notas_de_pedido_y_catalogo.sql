-- =============================================================================
-- WoodTools · Paso 2
-- 0011 · Catálogo de precios, cotización del dólar y notas de pedido
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Catálogo de artículos
--
-- Sale de las 19 listas de precios del "Gestión Comercial" (PDF). Los precios
-- son SIN IVA y en pesos, salvo los pocos artículos que la propia lista marca
-- en dólares.
--
-- Varias listas son reediciones de la misma con otra fecha, así que un mismo
-- código aparece más de una vez. Por eso la unicidad es por (codigo, lista) y
-- lo que consume la app es `vista_catalogo_vigente`, que se queda con la
-- edición más reciente de cada código.
-- ─────────────────────────────────────────────────────────────────────────────

create table public.catalogo_articulos (
  id             uuid primary key default extensions.gen_random_uuid(),

  codigo         text not null,
  descripcion    text not null,
  -- Medida tal como figura en la lista: "12x12x1.5", "250x30", "3.5mm".
  medida         text,

  precio         numeric(14,2) not null,
  moneda         char(3) not null default 'ARS',

  lista_origen   text not null,
  lista_fecha    date not null,

  -- Familia de herramienta a la que aplica. Es lo que permite ofrecer sólo los
  -- códigos de cómputo que tienen sentido para lo que el vendedor eligió.
  familia        text,

  creado_en      timestamptz not null default now(),

  unique (codigo, lista_origen),
  constraint catalogo_precio_positivo check (precio >= 0)
);

create index catalogo_codigo_idx      on public.catalogo_articulos (codigo);
create index catalogo_familia_idx     on public.catalogo_articulos (familia);
create index catalogo_busqueda_idx    on public.catalogo_articulos
  using gin ((codigo || ' ' || descripcion || ' ' || coalesce(medida, '')) extensions.gin_trgm_ops);

comment on table public.catalogo_articulos is
  'Artículos y códigos de cómputo importados de las listas de precios en PDF. Precios sin IVA.';


-- Edición vigente de cada código: la de la lista más nueva.
create or replace view public.vista_catalogo_vigente
with (security_invoker = true) as
select distinct on (codigo)
  id, codigo, descripcion, medida, precio, moneda, familia, lista_origen, lista_fecha
from public.catalogo_articulos
order by codigo, lista_fecha desc, creado_en desc;

comment on view public.vista_catalogo_vigente is
  'Un renglón por código, con el precio de la lista más reciente. Es lo que consulta la app.';


-- ─────────────────────────────────────────────────────────────────────────────
-- Cotización del dólar oficial
--
-- La nota de pedido guarda el tipo de cambio del día en que se generó, no el
-- de hoy: una nota de la semana pasada tiene que poder reimprimirse con el
-- valor que se le cotizó al cliente.
-- ─────────────────────────────────────────────────────────────────────────────

create table public.cotizaciones (
  fecha          date primary key,
  compra         numeric(14,4),
  venta          numeric(14,4) not null,
  fuente         text not null default 'dolarapi',
  obtenido_en    timestamptz not null default now(),

  constraint cotizaciones_venta_positiva check (venta > 0)
);

comment on table public.cotizaciones is
  'Dólar oficial por día. La Edge Function `cotizacion-dolar` la completa y la cachea.';


-- ─────────────────────────────────────────────────────────────────────────────
-- Notas de pedido
-- ─────────────────────────────────────────────────────────────────────────────

create type public.tipo_servicio as enum (
  'venta', 'afilado', 'reparacion', 'rectificado', 'hermanado', 'rebaje', 'reclamo'
);

create type public.tipo_nota_pedido as enum ('factura', 'presupuesto');

create type public.estado_nota_pedido as enum (
  -- El vendedor la cargó para un cliente que todavía no existe en el sistema:
  -- la nota existe pero no tiene número definitivo hasta que Administración le
  -- asigne el código de cliente.
  'pendiente_cliente',
  'pendiente',
  'impresa',
  'entregada',
  'anulada'
);

-- Numeración correlativa de las notas ya confirmadas.
create sequence public.notas_pedido_numero_seq;
grant usage, select on sequence public.notas_pedido_numero_seq to authenticated;

create table public.notas_pedido (
  id                 uuid primary key default extensions.gen_random_uuid(),

  -- NULL mientras el estado sea 'pendiente_cliente'. En la app se muestra
  -- opaco y con la leyenda "(Pendiente)".
  numero             bigint unique,

  vendedor_id        uuid not null references public.perfiles (id) on delete restrict,
  cliente_id         uuid references public.clientes (id) on delete set null,

  -- Datos congelados al momento de emitir. Se completan igual cuando el
  -- cliente todavía no existe, así la nota no se pierde.
  cliente_codigo     text,
  cliente_nombre     text not null,
  cliente_cuit       text,
  zona               text,

  -- Los dos campos que se pueden dictar por voz.
  datos_cliente             text,
  datos_cliente_origen      public.origen_observacion not null default 'texto',
  descripcion_herramienta   text,
  descripcion_herramienta_origen public.origen_observacion not null default 'texto',

  servicios          public.tipo_servicio[] not null,
  tipo_nota          public.tipo_nota_pedido,
  estado             public.estado_nota_pedido not null default 'pendiente',

  fecha_entrega      date,

  -- Cotización congelada del día de emisión.
  tipo_cambio        numeric(14,4),
  cotizacion_fecha   date,

  total              numeric(14,2),

  -- Auditoría del alta del cliente por parte de Administración.
  cliente_asignado_por uuid references public.perfiles (id) on delete set null,
  cliente_asignado_en  timestamptz,

  impresa_en         timestamptz,
  creado_en          timestamptz not null default now(),
  actualizado_en     timestamptz not null default now(),

  constraint notas_servicios_no_vacio check (array_length(servicios, 1) >= 1),

  -- Una nota sin cliente cargado no puede tener número, y una con cliente sí.
  constraint notas_numero_segun_estado check (
    (estado = 'pendiente_cliente' and numero is null)
    or (estado <> 'pendiente_cliente' and numero is not null)
  )
);

create index notas_vendedor_idx  on public.notas_pedido (vendedor_id, creado_en desc);
create index notas_estado_idx    on public.notas_pedido (estado, creado_en desc);
create index notas_cliente_idx   on public.notas_pedido (cliente_id, creado_en desc);
create index notas_pendientes_cliente_idx
  on public.notas_pedido (creado_en desc) where estado = 'pendiente_cliente';

comment on column public.notas_pedido.numero is
  'Correlativo. NULL mientras el cliente no exista en el sistema: la app lo muestra opaco con "(Pendiente)".';


-- ─────────────────────────────────────────────────────────────────────────────
-- Renglones de la nota
--
-- Cada tipo de herramienta pide campos distintos (una cuchilla tiene largo,
-- ancho y espesor; una mecha tiene diámetro, largo útil y mano; una sierra sin
-- fin tiene ancho y paso). Los comunes están tipados y los específicos van en
-- `detalle`, para no terminar con una tabla de cuarenta columnas casi siempre
-- vacías.
-- ─────────────────────────────────────────────────────────────────────────────

create table public.notas_pedido_items (
  id                 uuid primary key default extensions.gen_random_uuid(),
  nota_id            uuid not null references public.notas_pedido (id) on delete cascade,

  orden              integer not null default 1,

  servicio           public.tipo_servicio not null,
  -- "sierra", "fresa", "cabezal", "mecha", "cuchilla", "sierra_sin_fin", "incisor"…
  herramienta        text,

  codigo_herramienta text,
  descripcion        text,

  cantidad           integer not null default 1,
  -- Para afilados: cuántos dientes/filos se cobran.
  cantidad_dientes   integer,

  precio_unitario    numeric(14,2),
  precio_total       numeric(14,2),
  moneda             char(3) not null default 'ARS',

  -- Códigos de cómputo del catálogo que se aplicaron a este renglón.
  codigos_computo    text[] not null default '{}',

  promocion          boolean not null default false,
  dientes_rotos      boolean not null default false,

  -- Medidas y campos propios de cada herramienta.
  detalle            jsonb not null default '{}'::jsonb,

  creado_en          timestamptz not null default now(),

  constraint items_cantidad_positiva check (cantidad > 0),
  unique (nota_id, orden)
);

create index items_nota_idx on public.notas_pedido_items (nota_id, orden);

comment on column public.notas_pedido_items.detalle is
  'Campos propios de cada herramienta: largo, ancho, espesor, paso, diámetro, mano, tipo de mecha…';
