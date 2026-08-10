-- =============================================================================
-- Dos columnas nuevas en `perfiles`
--
--  1. `usuario` — el nombre corto con el que la oficina conoce a cada uno
--     ("asosa"). Hasta ahora el ingreso lo armaba el teléfono pegándole el
--     dominio: "asosa" → "asosa@woodtools.com.ar". Eso funciona mientras TODAS
--     las cuentas vivan en ese dominio; el día que se dé de alta a alguien con
--     otro correo, su nombre de usuario deja de entrar y nadie va a saber por
--     qué. Con la columna, el nombre corto y el correo de la cuenta son datos
--     separados y cualquiera de los dos sirve para entrar.
--
--  2. `zonas` — qué zonas de venta cubre cada vendedor. Con eso la nota de
--     pedido puede completar sola el número de vendedor cuando quien la carga
--     no tiene uno propio (la oficina cargando por teléfono, por ejemplo).
--
-- Las funciones que las usan van en la migración siguiente.
-- =============================================================================

alter table public.perfiles add column if not exists usuario text;

-- Los que ya existen toman la parte de adelante de su correo, que es
-- exactamente lo que venían tipeando para entrar.
update public.perfiles set usuario = lower(split_part(email, '@', 1)) where usuario is null;

-- Único, sin distinguir mayúsculas: "ASosa" y "asosa" harían ambiguo el
-- ingreso, que es el único lugar donde esta columna se lee.
create unique index if not exists perfiles_usuario_unico
  on public.perfiles (lower(usuario)) where usuario is not null;

alter table public.perfiles add column if not exists zonas text[] not null default '{}';

comment on column public.perfiles.usuario is 'Nombre corto de ingreso ("asosa"). Alternativa al email: con cualquiera de los dos se entra.';
comment on column public.perfiles.zonas is 'Codigos de zona de venta que cubre el vendedor. Con esto la nota de pedido puede completar sola el numero de vendedor.';
