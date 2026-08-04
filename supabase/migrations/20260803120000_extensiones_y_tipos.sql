-- =============================================================================
-- WoodTools · Rol de Visita
-- 0001 · Extensiones, esquemas y tipos enumerados
-- =============================================================================

create extension if not exists "uuid-ossp"  with schema extensions;
create extension if not exists "pgcrypto"   with schema extensions;
create extension if not exists "postgis"    with schema extensions;
create extension if not exists "pg_trgm"    with schema extensions;

-- Esquema propio para helpers internos que no queremos exponer por PostgREST.
create schema if not exists interno;
revoke all on schema interno from public, anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- Tipos enumerados
-- ─────────────────────────────────────────────────────────────────────────────

-- Rol del usuario dentro del sistema.
--  · vendedor   → usa la app móvil, ve solamente lo suyo
--  · supervisor → ve a todos los vendedores en vivo, pero no da de alta/baja
--  · admin      → control total (escritorio)
create type public.rol_usuario as enum ('vendedor', 'supervisor', 'admin');

-- Estado del alta del usuario. Un usuario recién registrado queda 'pendiente'
-- y NO puede entrar hasta que un admin lo apruebe.
create type public.estado_usuario as enum (
  'pendiente',   -- se registró, espera aprobación
  'aprobado',    -- puede iniciar sesión
  'rechazado',   -- el admin lo rechazó
  'suspendido',  -- baja temporal
  'baja'         -- baja definitiva
);

-- Estado de la jornada (el "Rol de Visita" del día).
create type public.estado_rol_visita as enum (
  'planificado',  -- armado, todavía no arrancó
  'en_curso',     -- el vendedor tocó "INICIAR RECORRIDO"
  'finalizado',
  'cancelado'
);

-- Prioridad con la que se inserta un destino en el recorrido.
--  · alta  → próximo destino, sin importar la cercanía
--  · media → se inserta 2 o 3 destinos más adelante
--  · baja  → se reubica por cercanía junto con el resto
create type public.prioridad_parada as enum ('alta', 'media', 'baja');

-- Estado de cada parada del recorrido.
create type public.estado_parada as enum (
  'pendiente',
  'en_camino',
  'visitada',      -- se completó el formulario con "SI"
  'no_visitada',   -- se completó el formulario con "NO"
  'omitida'        -- quedó sin visitar al cerrar la jornada
);

-- De dónde salió la parada.
create type public.origen_parada as enum (
  'planificada',      -- venía en el rol de visita del día
  'agregada_en_ruta'  -- el vendedor la cargó con "AGREGAR NUEVO DESTINO"
);

-- Motivo por el cual no se concretó la visita (formulario "¿Destino visitado? → NO").
create type public.motivo_no_visita as enum (
  'cliente_ausente',    -- "El cliente no estaba"
  'direccion_erronea'   -- "Dirección errónea"
);

-- Cómo se cargó la observación.
create type public.origen_observacion as enum ('texto', 'voz');


comment on type public.rol_usuario       is 'Rol del usuario: vendedor (app móvil), supervisor (sólo lectura global), admin (control total).';
comment on type public.estado_usuario    is 'Estado del alta. Sólo "aprobado" puede iniciar sesión.';
comment on type public.prioridad_parada  is 'alta = próximo destino; media = 2-3 destinos más adelante; baja = se ordena por cercanía.';
