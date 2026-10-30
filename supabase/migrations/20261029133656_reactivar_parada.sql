-- Reabrir una parada "no visitada" para volver a visitarla.
--
-- Cuando el vendedor marca "no visité" (cliente ausente / dirección errónea), la
-- parada queda en estado terminal `no_visitada` y no hay forma de reabrirla: el
-- recorrido no la deja tocar y ninguna RPC la reactiva. Si después vuelve, o le
-- corrige la dirección, el único camino era re-agregar el cliente (duplicado).
-- Esto la devuelve a `pendiente` para registrar la visita de verdad.
create or replace function public.reactivar_parada(p_parada_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_vendedor uuid;
  v_estado   public.estado_parada;
begin
  select rv.vendedor_id, p.estado
    into v_vendedor, v_estado
    from public.paradas p
    join public.roles_visita rv on rv.id = p.rol_visita_id
   where p.id = p_parada_id;

  if v_vendedor is null then
    raise exception 'No existe esa parada.' using errcode = 'P0002';
  end if;
  -- El vendedor reabre las suyas; la oficina, cualquiera.
  if v_vendedor is distinct from auth.uid() and not interno.puede_ver_todo() then
    raise exception 'Sólo podés reabrir tus propias paradas.' using errcode = '42501';
  end if;
  if v_estado <> 'no_visitada' then
    raise exception 'Esa parada no está en "No visitada".' using errcode = '23514';
  end if;

  -- Borra el "no visité" (visitado=false) y vuelve a pendiente. `visitas` tiene
  -- unique(parada_id): dejar el viejo haría fallar el próximo registrar_visita.
  delete from public.visitas where parada_id = p_parada_id and not visitado;

  update public.paradas
     set estado = 'pendiente', llegada_en = null, salida_en = null
   where id = p_parada_id;
end;
$function$;

revoke execute on function public.reactivar_parada(uuid) from public, anon;
grant execute on function public.reactivar_parada(uuid) to authenticated;
