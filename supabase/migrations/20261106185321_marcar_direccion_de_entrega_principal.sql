-- =============================================================================
-- El vendedor deja una sucursal / lugar de entrega como la dirección de entrega
-- POR DEFECTO del cliente (la principal).
--
-- Cuando elige una sucursal distinta de la principal para un pedido, puede
-- dejarla fijada como la de entrega por defecto desde ahí mismo. Sólo reordena
-- entre las direcciones que el cliente YA tiene (no crea ni edita direcciones:
-- eso sigue yendo por cambios_direccion, que la oficina aplica).
--
-- SECURITY DEFINER: el vendedor no hace UPDATE directo de `direcciones`. Gatea
-- `interno.esta_habilitado()`, como el resto de las funciones DEFINER.
-- =============================================================================

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

  -- Una sola principal por cliente: la elegida queda en true y el resto en false
  -- en un solo statement (el índice único parcial se chequea al final del mismo).
  update public.direcciones
  set principal = (id = p_direccion_id)
  where cliente_id = v_cliente;
end;
$function$;

revoke all on function public.marcar_direccion_de_entrega_principal(uuid) from public, anon;
grant execute on function public.marcar_direccion_de_entrega_principal(uuid) to authenticated;
