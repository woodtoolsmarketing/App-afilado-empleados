-- Antes, un vendedor editando su propia fila solo tenia bloqueados rol y estado:
-- podia subirse ve_ubicacion_de_notas, codigo_vendedor, zonas, email, usuario, etc.
-- Este helper (SECURITY DEFINER STABLE, como rol_actual/estado_actual) compara los
-- valores NUEVOS contra los almacenados y solo deja pasar si las columnas sensibles
-- no cambiaron. La app self-edita ultimo_acceso_en y debe_cambiar_contrasena, que
-- no estan en la lista, asi que siguen permitidos. El admin pasa por perfiles_admin_todo.
create or replace function interno.solo_edita_lo_propio(
  p_rol rol_usuario, p_estado estado_usuario, p_ve_ubicacion boolean,
  p_codigo text, p_zonas text[], p_email text, p_usuario text,
  p_aprobado_por uuid, p_aprobado_en timestamptz, p_motivo text
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
  )
$$;

drop policy perfiles_editar_propio on public.perfiles;
create policy perfiles_editar_propio on public.perfiles
  for update
  using (id = auth.uid() and interno.esta_habilitado())
  with check (
    id = auth.uid()
    and interno.solo_edita_lo_propio(
      rol, estado, ve_ubicacion_de_notas, codigo_vendedor, zonas, email, usuario,
      aprobado_por, aprobado_en, motivo_rechazo
    )
  );
