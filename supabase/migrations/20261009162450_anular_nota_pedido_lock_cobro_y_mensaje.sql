-- Endurece anular_nota_pedido tras la revision:
--  * SELECT ... FOR UPDATE: serializa contra la oficina (imprimir/anular) para
--    que el guard no autorice sobre una fila vieja (TOCTOU) y el anulado sea
--    idempotente.
--  * el mensaje "ya estaba anulada" se da antes que "ya salio en papel" (para la
--    nota propia que la oficina anulo), sin filtrar notas ajenas.
--  * el vendedor no puede eliminar una nota que ya tiene un cobro registrado:
--    eso es plata, lo concilia la oficina.
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
  -- FOR UPDATE: si la oficina esta imprimiendo/anulando esta misma nota, se
  -- espera y se re-lee el estado ya actualizado, en vez de decidir con datos viejos.
  select estado, vendedor_id, impresa_en
    into v_estado, v_vendedor, v_impresa
    from public.notas_pedido
   where id = p_nota_id
   for update;

  if v_estado is null then
    raise exception 'No existe esa nota.' using errcode = 'P0001';
  end if;

  if interno.es_admin() then
    -- El admin anula cualquiera; lo unico que no tiene sentido es re-anular.
    if v_estado = 'anulada' then
      raise exception 'Esa nota ya estaba anulada.' using errcode = 'P0001';
    end if;
  else
    -- El vendedor, solo las SUYAS. El orden de los chequeos da el mensaje exacto.
    if v_vendedor is distinct from auth.uid() then
      raise exception 'Solo podes eliminar tus propias notas.' using errcode = 'P0001';
    end if;
    if v_estado = 'anulada' then
      raise exception 'Esa nota ya estaba anulada.' using errcode = 'P0001';
    end if;
    if v_impresa is not null or v_estado not in ('pendiente', 'pendiente_cliente') then
      raise exception 'Esta nota ya salio en papel; no se puede eliminar. Avisa a la oficina.' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.cobranzas where nota_id = p_nota_id) then
      raise exception 'Esta nota tiene un cobro registrado; no se puede eliminar desde el telefono. Avisa a la oficina.' using errcode = 'P0001';
    end if;
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
