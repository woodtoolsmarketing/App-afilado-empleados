-- "Entregué" en el rol: marca de entrega REAL de una nota de pedido.
-- Hoy el estado 'entregada' existe en el enum pero nada lo alcanza (lo máximo
-- es 'impresa'). Esta columna guarda CUÁNDO se entregó de verdad; la RPC la
-- setea desde el panel.
alter table public.notas_pedido
  add column if not exists entregada_en timestamptz;

comment on column public.notas_pedido.entregada_en is
  'Cuándo se marcó entregada desde el panel (RPC marcar_nota_entregada). NULL = todavía no entregada.';

-- Marca/desmarca una nota como entregada. La oficina la llama desde el rol de
-- visita. SECURITY DEFINER + es_admin(): marcar una entrega es acción de
-- administración. Sólo se entrega algo ya impreso (la nota física existe); al
-- desmarcar vuelve a 'impresa'.
create or replace function public.marcar_nota_entregada(p_nota_id uuid, p_entregada boolean)
returns table(id uuid, estado public.estado_nota_pedido, entregada_en timestamptz)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if not interno.es_admin() then
    raise exception 'No tenes permiso para esto.' using errcode = '42501';
  end if;

  if p_entregada then
    update public.notas_pedido n
       set estado = 'entregada', entregada_en = now(), actualizado_en = now()
     where n.id = p_nota_id and n.estado in ('impresa', 'entregada');
  else
    update public.notas_pedido n
       set estado = 'impresa', entregada_en = null, actualizado_en = now()
     where n.id = p_nota_id and n.estado in ('entregada', 'impresa');
  end if;

  if not found then
    raise exception 'La nota no existe o no está impresa (sólo se entrega algo ya impreso).'
      using errcode = 'P0002';
  end if;

  return query
    select n.id, n.estado, n.entregada_en
      from public.notas_pedido n
     where n.id = p_nota_id;
end;
$function$;

-- anon no la puede invocar (el revoke de public NO saca el grant a anon; va aparte).
revoke execute on function public.marcar_nota_entregada(uuid, boolean) from anon, public;
grant execute on function public.marcar_nota_entregada(uuid, boolean) to authenticated;
