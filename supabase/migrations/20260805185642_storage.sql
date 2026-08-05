-- =============================================================================
-- WoodTools · Rol de Visita
-- 0009 · Buckets de Storage y sus políticas
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit)
values
  -- Los Excel del historial archivado a los 90 días.
  ('archivos-historial', 'archivos-historial', false, 52428800),   -- 50 MB
  -- Las fotos que se ven en el encabezado de la app y en el mapa del panel.
  ('fotos-vendedores',   'fotos-vendedores',   false,  5242880)    --  5 MB
on conflict (id) do nothing;

-- Los dos buckets son privados: se sirven con URLs firmadas de vida corta.


-- ─────────────────────────────────────────────────────────────────────────────
-- archivos-historial — sólo administradores, en lectura y escritura
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists "historial solo admin" on storage.objects;
create policy "historial solo admin" on storage.objects
  for all to authenticated
  using (bucket_id = 'archivos-historial' and interno.es_admin())
  with check (bucket_id = 'archivos-historial' and interno.es_admin());


-- ─────────────────────────────────────────────────────────────────────────────
-- fotos-vendedores — las lee cualquier usuario habilitado, las administra el admin
--
-- La foto del vendedor aparece en su propio encabezado y en el pin del mapa que
-- ven los supervisores, así que la lectura tiene que estar abierta al equipo.
-- Cambiarla es otra cosa: es identidad, y la maneja la oficina.
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists "fotos lectura habilitados" on storage.objects;
create policy "fotos lectura habilitados" on storage.objects
  for select to authenticated
  using (bucket_id = 'fotos-vendedores' and interno.esta_habilitado());

drop policy if exists "fotos escritura admin" on storage.objects;
create policy "fotos escritura admin" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'fotos-vendedores' and interno.es_admin());

drop policy if exists "fotos borrado admin" on storage.objects;
create policy "fotos borrado admin" on storage.objects
  for delete to authenticated
  using (bucket_id = 'fotos-vendedores' and interno.es_admin());
