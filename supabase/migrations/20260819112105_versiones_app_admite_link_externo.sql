-- ── El instalador puede vivir afuera ─────────────────────────────────────────
--
-- La idea original era guardar el APK en el bucket `instaladores` y servirlo
-- con un link firmado. No se puede: el plan del proyecto no acepta subidas de
-- más de 50 MB y el APK pesa 78. Está medido, no supuesto —1 MB y 40 MB entran,
-- 55 MB devuelve 413— así que no es un problema de permisos ni del bucket, que
-- está declarado en 300 MB y funciona.
--
-- Entonces la fila anota DÓNDE está el instalador, y puede estar en dos lados:
-- en el bucket (`archivo`) cuando entra, o en el servidor de compilación
-- (`url_externa`) cuando no. Lo que no puede es no estar en ninguno: una fila
-- que no apunta a nada es peor que no tener la fila, porque promete una
-- descarga que no existe.

alter table public.versiones_app
  add column if not exists url_externa text;

comment on column public.versiones_app.url_externa is
  'Link al instalador cuando no está en el bucket (APK > 50 MB). Excluyente con archivo.';

alter table public.versiones_app
  alter column archivo drop not null;

alter table public.versiones_app
  drop constraint if exists versiones_app_tiene_donde_bajarlo;

alter table public.versiones_app
  add constraint versiones_app_tiene_donde_bajarlo
  check (archivo is not null or url_externa is not null);
