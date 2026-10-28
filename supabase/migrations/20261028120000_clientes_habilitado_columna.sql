-- Columna que marca si un cliente está habilitado para operar en la app móvil.
-- Default false: un cliente recién aparecido (padrón o alta en la calle) queda
-- oculto para el vendedor hasta que algo lo habilite (import del Gestión o la
-- confirmación de la oficina). La oficina (puede_ver_todo) lo ve igual.
alter table public.clientes
  add column if not exists habilitado boolean not null default false;

comment on column public.clientes.habilitado is
  'Habilitado para operar en la app móvil (vendedores). Lo setea el import del listado de habilitados del Gestión, la confirmación de un provisorio, o el toggle del panel. La oficina (puede_ver_todo) ve a todos igual.';

-- OJO: QUIÉN está habilitado es DATO, no esquema. El default es false, así que
-- esta migración por sí sola deja a todos ocultos para el vendedor. La carga
-- inicial (y cada actualización) se hace con herramientas/importar-habilitados
-- a partir del listado del Gestión; corrió una vez el 28/10/2026 (13.721
-- habilitados). En la base viva ya está cargado; si alguna vez se resetea en
-- limpio, hay que volver a correr ese import antes de que el filtro valga.
