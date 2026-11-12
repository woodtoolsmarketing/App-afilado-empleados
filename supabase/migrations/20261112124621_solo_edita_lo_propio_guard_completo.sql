-- Restaura el guard completo de auto-edicion de perfiles.
--
-- La migracion anterior (impresora_ip_no_autoeditable, 20261112122839) se baso en
-- la firma LOCAL de solo_edita_lo_propio (11 params), pero la VIGENTE en produccion
-- era de 13 params: habia sumado ve_reporte_tiempos e imprime_cobranzas por
-- apply_migration sin reconciliar al repo local (ver memoria "supabase-cli-sin-linkear").
-- Por eso ese drop no borro nada y la policy quedo llamando a un guard de 12 params
-- que YA NO comparaba esas dos columnas: cualquier usuario no-admin podia
-- auto-concederse imprime_cobranzas (permiso de plata) o ve_reporte_tiempos. Esto
-- rehace el guard con TODAS las columnas sensibles mas impresora_ip, y limpia los
-- dos overloads que habian quedado.
--
-- NOTA: ve_reporte_tiempos e imprime_cobranzas se agregaron a perfiles y al guard
-- por migraciones que NO estan reconciliadas en este repo local. Esta migracion las
-- referencia porque son la verdad en produccion; un `supabase db reset` local no
-- correria hasta reconciliar esas migraciones faltantes.

drop policy perfiles_editar_propio on public.perfiles;

-- El de 12 params (impresora_ip) que metio el bug.
drop function if exists interno.solo_edita_lo_propio(
  rol_usuario, estado_usuario, boolean, text, text[], text, text,
  uuid, timestamptz, text, boolean, text);

-- El de 13 params (ve_reporte_tiempos, imprime_cobranzas), ahora huerfano.
drop function if exists interno.solo_edita_lo_propio(
  rol_usuario, estado_usuario, boolean, text, text[], text, text,
  uuid, timestamptz, text, boolean, boolean, boolean);

create function interno.solo_edita_lo_propio(
  p_rol rol_usuario, p_estado estado_usuario, p_ve_ubicacion boolean,
  p_codigo text, p_zonas text[], p_email text, p_usuario text,
  p_aprobado_por uuid, p_aprobado_en timestamptz, p_motivo text,
  p_imprime_roles boolean, p_ve_reporte_tiempos boolean,
  p_imprime_cobranzas boolean, p_impresora_ip text
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
      and ve_reporte_tiempos is not distinct from p_ve_reporte_tiempos
      and imprime_cobranzas is not distinct from p_imprime_cobranzas
      and impresora_ip is not distinct from p_impresora_ip
  )
$$;

create policy perfiles_editar_propio on public.perfiles
  for update
  using (id = auth.uid() and interno.esta_habilitado())
  with check (
    id = auth.uid()
    and interno.solo_edita_lo_propio(
      rol, estado, ve_ubicacion_de_notas, codigo_vendedor, zonas, email, usuario,
      aprobado_por, aprobado_en, motivo_rechazo, imprime_roles,
      ve_reporte_tiempos, imprime_cobranzas, impresora_ip
    )
  );
