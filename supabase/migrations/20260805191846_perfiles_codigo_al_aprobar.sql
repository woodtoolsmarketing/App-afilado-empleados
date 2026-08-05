-- =============================================================================
-- WoodTools · el código de vendedor se exige al APROBAR, no al registrarse
--
-- El CHECK `perfiles_vendedor_necesita_codigo` pedía código a todo perfil con
-- rol 'vendedor'. Pero el trigger `al_crear_usuario` crea cada alta como
-- 'vendedor' + 'pendiente' y SIN código, porque el código lo asigna el
-- administrador recién al aprobar (`resolver_alta_usuario`).
--
-- Resultado: el CHECK rechazaba el insert, el trigger reventaba, y el alta en
-- auth.users se revertía entera. El panel de Supabase lo mostraba como
-- "Failed to create user: {}", sin decir por qué.
--
-- No se podía crear NINGÚN usuario, ni desde el dashboard ni desde la app.
--
-- La regla correcta es la que ya usaba el circuito: un vendedor APROBADO tiene
-- que tener código; uno que todavía espera aprobación, no.
-- =============================================================================

alter table public.perfiles
  drop constraint if exists perfiles_vendedor_necesita_codigo;

alter table public.perfiles
  add constraint perfiles_vendedor_necesita_codigo
  check (rol <> 'vendedor' or estado <> 'aprobado' or codigo_vendedor is not null);

comment on constraint perfiles_vendedor_necesita_codigo on public.perfiles is
  'Un vendedor aprobado necesita su código de la planilla. Antes de la aprobación todavía no lo tiene.';


-- Aprobar un vendedor sin código dejaba escapar un 23514 crudo al panel. Que
-- lo diga con palabras, que es lo que el administrador necesita leer.
create or replace function public.resolver_alta_usuario(
  p_perfil_id uuid,
  p_aprobar   boolean,
  p_rol       public.rol_usuario default 'vendedor',
  p_codigo    text default null,
  p_motivo    text default null
)
returns public.perfiles
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  resultado public.perfiles;
  codigo_final text;
begin
  if not interno.es_admin() then
    raise exception 'Sólo un administrador puede resolver altas de usuario'
      using errcode = '42501';
  end if;

  select coalesce(nullif(trim(p_codigo), ''), codigo_vendedor)
    into codigo_final
    from public.perfiles where id = p_perfil_id;

  if p_aprobar and p_rol = 'vendedor' and codigo_final is null then
    raise exception 'Para aprobar un vendedor hay que asignarle el código que usa en la planilla.'
      using errcode = '23514';
  end if;

  update public.perfiles
     set estado          = case when p_aprobar then 'aprobado' else 'rechazado' end,
         rol             = case when p_aprobar then p_rol else rol end,
         codigo_vendedor = codigo_final,
         aprobado_por    = auth.uid(),
         aprobado_en     = now(),
         motivo_rechazo  = case when p_aprobar then null else p_motivo end
   where id = p_perfil_id
  returning * into resultado;

  if resultado.id is null then
    raise exception 'No existe el perfil %', p_perfil_id using errcode = 'P0002';
  end if;

  insert into public.auditoria (actor_id, accion, entidad, entidad_id, datos)
  values (
    auth.uid(),
    case when p_aprobar then 'usuario.aprobado' else 'usuario.rechazado' end,
    'perfiles', p_perfil_id::text,
    jsonb_build_object('rol', p_rol, 'codigo', p_codigo, 'motivo', p_motivo)
  );

  return resultado;
end;
$$;
