-- FIX (revisión adversarial): marcar_direccion_de_entrega_principal (#9) hacía
-- el cambio en UN solo UPDATE (`set principal = (id = p_direccion_id)`), confiando
-- en que el índice único parcial `direcciones_una_principal_idx` se chequeaba al
-- final del statement. En Postgres NO es así: un índice único NO diferible se
-- verifica fila por fila. Si el scan toca la fila ELEGIDA antes que la principal
-- vigente, quedan dos filas con principal=true un instante → 23505
-- (duplicate key). Falla de forma intermitente según el orden físico (ctid):
-- en particular, siempre que la elegida se creó ANTES que la principal actual.
--
-- Se hace en dos pasos para no tener nunca dos principales a la vez: primero se
-- apagan las demás, después se prende la elegida. El estado intermedio (ninguna
-- principal) sí lo permite el índice.
create or replace function public.marcar_direccion_de_entrega_principal(p_direccion_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_cliente uuid;
begin
  if not interno.esta_habilitado() then
    raise exception 'Tu cuenta no esta habilitada para cambiar la direccion de entrega.'
      using errcode = '42501';
  end if;

  select cliente_id into v_cliente
  from public.direcciones
  where id = p_direccion_id
  for update;

  if v_cliente is null then
    raise exception 'No encontramos esa direccion de entrega.' using errcode = 'P0002';
  end if;

  -- Una sola principal por cliente, en dos pasos para no violar el índice único
  -- parcial (ver cabecera). 1) apagar las demás; 2) prender la elegida.
  update public.direcciones
     set principal = false
   where cliente_id = v_cliente and principal and id <> p_direccion_id;

  update public.direcciones
     set principal = true
   where id = p_direccion_id and not principal;
end;
$function$;

revoke all on function public.marcar_direccion_de_entrega_principal(uuid) from public, anon;
grant execute on function public.marcar_direccion_de_entrega_principal(uuid) to authenticated;
