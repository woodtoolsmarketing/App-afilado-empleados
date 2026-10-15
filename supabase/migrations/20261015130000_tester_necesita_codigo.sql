-- =============================================================================
-- WoodTools · el rol `tester` es un vendedor y necesita su código igual
--
-- `tester` es un vendedor que además puede sacar capturas de pantalla, para
-- probar la app. Hace todo lo que hace un vendedor: carga notas, imprime el
-- rol de visita, cobra. Esas impresiones llevan el código de vendedor, así que
-- un tester aprobado tiene que tener código igual que cualquier vendedor.
--
-- 1) El CHECK que obliga el código al aprobar ahora también cubre a `tester`.
-- 2) `resolver_alta_usuario` exige el código al aprobar un `tester`.
-- =============================================================================

alter table public.perfiles
  drop constraint if exists perfiles_vendedor_necesita_codigo;

alter table public.perfiles
  add constraint perfiles_vendedor_necesita_codigo
  check (rol not in ('vendedor', 'tester') or estado <> 'aprobado' or codigo_vendedor is not null);

comment on constraint perfiles_vendedor_necesita_codigo on public.perfiles is
  'Un vendedor (o tester) aprobado necesita su código de la planilla. Antes de la aprobación todavía no lo tiene.';


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

  -- El tester es un vendedor con capturas habilitadas: también imprime notas y
  -- rol con su código, así que se le exige igual que al vendedor.
  if p_aprobar and p_rol in ('vendedor', 'tester') and codigo_final is null then
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
