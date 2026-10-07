-- =============================================================================
-- Anular una nota de pedido desde el panel (sólo administradores, por ahora)
--
-- No se borra: queda con estado 'anulada' y el registro de quién y cuándo, para
-- que la fábrica y la oficina sepan que esa nota no va. Se puede anular en
-- cualquier estado (incluso impresa), que es lo pedido: una nota ya impresa que
-- el cliente canceló tiene que poder sacarse del circuito.
-- =============================================================================

alter table public.notas_pedido
  add column if not exists anulada_por      uuid references public.perfiles(id),
  add column if not exists anulada_en       timestamptz,
  add column if not exists motivo_anulacion text;

create or replace function public.anular_nota_pedido(
  p_nota_id uuid,
  p_motivo  text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_estado public.estado_nota_pedido;
begin
  -- Por ahora, sólo administradores. Cuando se abra a administración, se cambia
  -- este chequeo por el permiso correspondiente.
  if not interno.es_admin() then
    raise exception 'Sólo un administrador puede anular notas.' using errcode = 'P0001';
  end if;

  select estado into v_estado from public.notas_pedido where id = p_nota_id;
  if v_estado is null then
    raise exception 'No existe esa nota.' using errcode = 'P0001';
  end if;
  if v_estado = 'anulada' then
    raise exception 'Esa nota ya estaba anulada.' using errcode = 'P0001';
  end if;

  update public.notas_pedido
     set estado           = 'anulada',
         anulada_por      = auth.uid(),
         anulada_en       = now(),
         motivo_anulacion = nullif(btrim(coalesce(p_motivo, '')), '')
   where id = p_nota_id;

  -- Si estaba esperando el papel, se saca de la cola para que no se imprima una
  -- nota ya anulada (la columna de la cola es `nota_id`).
  update public.ordenes_impresion
     set estado = 'cancelada'
   where nota_id = p_nota_id
     and estado in ('pendiente', 'imprimiendo');
end;
$$;

revoke all on function public.anular_nota_pedido(uuid, text) from public;
revoke all on function public.anular_nota_pedido(uuid, text) from anon;
grant execute on function public.anular_nota_pedido(uuid, text) to authenticated;
