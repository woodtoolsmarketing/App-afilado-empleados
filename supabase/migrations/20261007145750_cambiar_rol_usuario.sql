-- =============================================================================
-- Cambiar el rol de un usuario desde el panel (sólo administradores)
--
-- Va por RPC y no por un UPDATE directo (que la RLS de perfiles_admin igual
-- permitiría) para meter las guardas en un solo lugar del servidor: que lo pida
-- un admin, que nadie se quite a sí mismo el admin, y que no quede la oficina
-- sin ningún administrador.
-- =============================================================================

create or replace function public.cambiar_rol_usuario(
  p_usuario_id uuid,
  p_rol        public.rol_usuario
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rol_actual public.rol_usuario;
  v_admins     integer;
begin
  if not interno.es_admin() then
    raise exception 'Sólo un administrador puede cambiar roles.' using errcode = 'P0001';
  end if;

  select rol into v_rol_actual from public.perfiles where id = p_usuario_id;
  if v_rol_actual is null then
    raise exception 'No existe ese usuario.' using errcode = 'P0001';
  end if;

  if v_rol_actual = p_rol then
    return; -- nada que cambiar
  end if;

  -- Nadie se saca a sí mismo el admin: evita el autobloqueo.
  if p_usuario_id = auth.uid() and p_rol <> 'admin' then
    raise exception 'No podés quitarte a vos mismo el rol de administrador.' using errcode = 'P0001';
  end if;

  -- Que no quede la oficina sin ningún administrador habilitado.
  if v_rol_actual = 'admin' and p_rol <> 'admin' then
    select count(*) into v_admins
      from public.perfiles
     where rol = 'admin' and estado = 'aprobado';
    if v_admins <= 1 then
      raise exception 'Tiene que quedar al menos un administrador.' using errcode = 'P0001';
    end if;
  end if;

  update public.perfiles set rol = p_rol where id = p_usuario_id;
end;
$$;

revoke all on function public.cambiar_rol_usuario(uuid, public.rol_usuario) from public;
revoke all on function public.cambiar_rol_usuario(uuid, public.rol_usuario) from anon;
grant execute on function public.cambiar_rol_usuario(uuid, public.rol_usuario) to authenticated;
