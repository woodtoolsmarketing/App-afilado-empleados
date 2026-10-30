-- Permiso por vendedor: imprimir la rendición de cobranzas del día DESDE EL
-- TELÉFONO, directo a la impresora de la oficina por IPP (igual que el rol de
-- visita). Molde: `imprime_roles`.
--
-- Diferencia con imprime_roles: arranca en FALSE (opt-in). Hoy el teléfono sólo
-- MANDA la rendición a la cola de la oficina (encolarCobranzas); este permiso le
-- habilita, a los vendedores que la oficina elija, el botón para imprimirla
-- ellos mismos. No aplica a admin/supervisor: ellos imprimen siempre (la app no
-- mira la bandera para ellos).

alter table public.perfiles
  add column if not exists imprime_cobranzas boolean not null default false;

comment on column public.perfiles.imprime_cobranzas is
  'Si el vendedor puede imprimir la rendición de cobranzas del día desde la app (directo por IPP). La oficina lo togglea en el panel; no aplica a admin/supervisor. Default false (opt-in).';

-- `imprime_cobranzas` no se la puede auto-conceder el vendedor: se suma a la
-- lista de columnas sensibles de `solo_edita_lo_propio`, igual que imprime_roles
-- y ve_reporte_tiempos. La policy perfiles_editar_propio depende de la función,
-- así que se recrean las dos (DROP + CREATE porque cambia la firma; CREATE OR
-- REPLACE dejaría una sobrecarga ambigua). El admin la sigue cambiando por
-- `perfiles_admin_todo`.
drop policy if exists perfiles_editar_propio on public.perfiles;
drop function if exists interno.solo_edita_lo_propio(
  rol_usuario, estado_usuario, boolean, text, text[], text, text,
  uuid, timestamptz, text, boolean, boolean);

create function interno.solo_edita_lo_propio(
  p_rol rol_usuario, p_estado estado_usuario, p_ve_ubicacion boolean,
  p_codigo text, p_zonas text[], p_email text, p_usuario text,
  p_aprobado_por uuid, p_aprobado_en timestamptz, p_motivo text,
  p_imprime_roles boolean, p_ve_reporte_tiempos boolean default false,
  p_imprime_cobranzas boolean default false
) returns boolean
language sql stable security definer
set search_path to 'public', 'pg_temp'
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
      and ve_reporte_tiempos is not distinct from p_ve_reporte_tiempos
      and imprime_cobranzas is not distinct from p_imprime_cobranzas
  )
$$;

create policy perfiles_editar_propio on public.perfiles
  for update to public
  using ((id = auth.uid()) and interno.esta_habilitado())
  with check ((id = auth.uid()) and interno.solo_edita_lo_propio(
    rol, estado, ve_ubicacion_de_notas, codigo_vendedor, zonas, email, usuario,
    aprobado_por, aprobado_en, motivo_rechazo, imprime_roles, ve_reporte_tiempos,
    imprime_cobranzas));
