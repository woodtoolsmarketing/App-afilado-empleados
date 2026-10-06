-- `imprime_roles` no se la puede auto-conceder el vendedor.
--
-- `perfiles_editar_propio` deja que un vendedor edite su propia fila, pero
-- `interno.solo_edita_lo_propio` chequea que las columnas sensibles no cambien.
-- `imprime_roles` es nueva y no estaba en esa lista: sin esto, un vendedor podría
-- prenderse solo el permiso de imprimir. Se suma a la lista bloqueada, igual que
-- rol, estado, zonas o ve_ubicacion_de_notas. El admin sigue pudiéndola cambiar
-- por `perfiles_admin_todo`.

drop policy perfiles_editar_propio on public.perfiles;

drop function if exists interno.solo_edita_lo_propio(
  rol_usuario, estado_usuario, boolean, text, text[], text, text,
  uuid, timestamptz, text
);

create function interno.solo_edita_lo_propio(
  p_rol rol_usuario, p_estado estado_usuario, p_ve_ubicacion boolean,
  p_codigo text, p_zonas text[], p_email text, p_usuario text,
  p_aprobado_por uuid, p_aprobado_en timestamptz, p_motivo text,
  p_imprime_roles boolean
) returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.perfiles
    where id = auth.uid()
      and rol = p_rol
      and estado = p_estado
      and ve_ubicacion_de_notas is not distinct from p_ve_ubicacion
      and codigo_vendedor is not distinct from p_codigo
      and zonas is not distinct from p_zonas
      and email is not distinct from p_email
      and usuario is not distinct from p_usuario
      and aprobado_por is not distinct from p_aprobado_por
      and aprobado_en is not distinct from p_aprobado_en
      and motivo_rechazo is not distinct from p_motivo
      and imprime_roles is not distinct from p_imprime_roles
  )
$$;

create policy perfiles_editar_propio on public.perfiles
  for update
  using (id = auth.uid() and interno.esta_habilitado())
  with check (
    id = auth.uid()
    and interno.solo_edita_lo_propio(
      rol, estado, ve_ubicacion_de_notas, codigo_vendedor, zonas, email, usuario,
      aprobado_por, aprobado_en, motivo_rechazo, imprime_roles
    )
  );
