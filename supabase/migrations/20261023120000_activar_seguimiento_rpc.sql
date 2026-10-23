-- Prende/apaga el seguimiento (por horario laboral, divulgado) de un vendedor,
-- por su codigo. Lo llama el comando de la consola del panel. SECURITY DEFINER
-- porque escribir perfiles es admin-only por RLS; exige es_admin() adentro
-- (activar el seguimiento de un empleado es una accion de admin). El vendedor
-- igual ve la notificacion honesta en su telefono: es divulgado, no oculto.
create or replace function public.activar_seguimiento(p_codigo text, p_activar boolean)
returns table(codigo text, nombre text, activo boolean)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if not interno.es_admin() then
    raise exception 'No tenes permiso para esto.' using errcode = '42501';
  end if;

  update public.perfiles set seguimiento_24_7 = p_activar
   where codigo_vendedor = p_codigo;

  if not found then
    raise exception 'No hay ningun vendedor con el codigo %', p_codigo using errcode = 'P0002';
  end if;

  return query
    select p.codigo_vendedor, p.nombre_completo, p.seguimiento_24_7
      from public.perfiles p
     where p.codigo_vendedor = p_codigo;
end;
$function$;

-- anon no la puede ni invocar (revoke de public NO saca el grant a anon; va aparte).
revoke execute on function public.activar_seguimiento(text, boolean) from anon, public;
grant execute on function public.activar_seguimiento(text, boolean) to authenticated;
