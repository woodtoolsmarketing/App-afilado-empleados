-- ─────────────────────────────────────────────────────────────────────────────
-- Dónde vive el APK y qué versión es la que hay que instalar
--
-- Hasta ahora el APK se pasaba a mano: se compilaba, se bajaba, y viajaba por
-- WhatsApp o por cable. Eso funciona con dos teléfonos y deja de funcionar con
-- diez: nadie sabe cuál es el último archivo ni quién quedó atrás.
--
-- Con esto el circuito queda en un solo lugar. El panel compila, sube el
-- archivo acá, y el vendedor lo baja desde su teléfono con un link.
--
-- El bucket es PRIVADO, igual que el de las fotos: el APK lleva adentro la URL
-- y la clave pública de la base, y aunque esa clave sea la que se puede
-- publicar, un instalador de la app interna colgado de una URL abierta no es
-- algo que haga falta regalar. Se sirve con links firmados que vencen.
-- ─────────────────────────────────────────────────────────────────────────────

insert into storage.buckets (id, name, public, file_size_limit)
values ('instaladores', 'instaladores', false, 314572800)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit;

-- Subir y reemplazar: sólo Administración. Es publicar software en los
-- teléfonos de la empresa.
drop policy if exists "instaladores_escribe_admin" on storage.objects;
create policy "instaladores_escribe_admin"
  on storage.objects for all
  using (bucket_id = 'instaladores' and interno.es_admin())
  with check (bucket_id = 'instaladores' and interno.es_admin());

-- Bajar: cualquier usuario habilitado. Es la app que usa para trabajar.
drop policy if exists "instaladores_lee_habilitado" on storage.objects;
create policy "instaladores_lee_habilitado"
  on storage.objects for select
  using (bucket_id = 'instaladores' and interno.esta_habilitado());

-- ─────────────────────────────────────────────────────────────────────────────
-- El registro de versiones
--
-- Una fila por APK publicado. Sirve para tres cosas que hoy no se pueden
-- contestar: cuál es el último, qué cambió, y desde cuándo está.
--
-- `canal` es el mismo de las actualizaciones por aire —interno, beta,
-- produccion— porque un APK sólo entiende las actualizaciones de su canal, y
-- mezclarlos es publicar al vacío.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.versiones_app (
  id           uuid primary key default extensions.gen_random_uuid(),
  canal        text not null check (canal in ('interno', 'beta', 'produccion')),
  version      text not null,
  -- La ruta dentro del bucket. El link se firma en el momento de bajarlo.
  archivo      text not null,
  tamano_bytes bigint,
  -- Qué trae. Lo escribe quien publica; sale en el teléfono al ofrecer la
  -- actualización, para que bajar 80 MB tenga un motivo visible.
  notas        text,
  commit       text,
  publicado_por uuid references public.perfiles (id),
  publicado_en timestamptz not null default now()
);

create index if not exists versiones_app_canal_fecha
  on public.versiones_app (canal, publicado_en desc);

alter table public.versiones_app enable row level security;

drop policy if exists "versiones_lee_habilitado" on public.versiones_app;
create policy "versiones_lee_habilitado"
  on public.versiones_app for select
  using (interno.esta_habilitado());

drop policy if exists "versiones_escribe_admin" on public.versiones_app;
create policy "versiones_escribe_admin"
  on public.versiones_app for all
  using (interno.es_admin())
  with check (interno.es_admin());

comment on table public.versiones_app is
  'Un APK publicado por canal. El archivo vive en el bucket instaladores y se baja con link firmado.';
