-- El vendedor puede ELIMINAR (anular) una nota PROPIA que todavia no salio en
-- papel: mismo limite que "corregir" (impresa_en null y estado pendiente/
-- pendiente_cliente). El admin sigue pudiendo anular cualquiera. Soft-delete:
-- la nota queda 'anulada' con registro de quien y cuando; se saca de pendientes.
create or replace function public.anular_nota_pedido(p_nota_id uuid, p_motivo text default null::text)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_estado   public.estado_nota_pedido;
  v_vendedor uuid;
  v_impresa  timestamptz;
begin
  select estado, vendedor_id, impresa_en
    into v_estado, v_vendedor, v_impresa
    from public.notas_pedido
   where id = p_nota_id;

  if v_estado is null then
    raise exception 'No existe esa nota.' using errcode = 'P0001';
  end if;

  -- El admin anula cualquiera. El vendedor, solo las SUYAS y solo mientras no
  -- salieron en papel: una vez impresa es un comprobante y lo maneja la oficina.
  if not interno.es_admin() then
    if v_vendedor is distinct from auth.uid() then
      raise exception 'Solo podes eliminar tus propias notas.' using errcode = 'P0001';
    end if;
    if v_impresa is not null or v_estado not in ('pendiente', 'pendiente_cliente') then
      raise exception 'Esta nota ya salio en papel; no se puede eliminar. Avisa a la oficina.' using errcode = 'P0001';
    end if;
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

  -- Si estaba esperando el papel, se saca de la cola (nota_id, no nota_pedido_id).
  update public.ordenes_impresion
     set estado = 'cancelada'
   where nota_id = p_nota_id
     and estado in ('pendiente', 'imprimiendo');
end;
$function$;
