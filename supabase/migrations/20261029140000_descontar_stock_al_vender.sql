-- =============================================================================
-- WoodTools · descontar stock al vender (y reponer al anular)
--
-- Cuando el vendedor crea una nota con un renglón de VENTA de un producto, se
-- descuenta la cantidad del stock del sistema. Al ANULAR la nota se repone, y al
-- MODIFICARLA se ajusta por la diferencia. Todo server-side sobre las tablas de
-- notas → NO se toca el móvil (sin APK).
--
-- Decisiones del usuario (29/10):
--  · Factura Y presupuesto descuentan (cualquier renglón 'venta').
--  · Al EMITIR la nota (al insertarse el renglón), no al entregar.
-- Reglas:
--  · Sólo renglones servicio='venta' (los afilados/servicios NO tocan stock).
--  · Sólo productos que la oficina trackea (tienen fila en stock_articulos); un
--    producto sin stock cargado se ignora (no se inventan filas).
--  · Nunca baja de 0 (clamp). El cruce a ≤umbral / 0 dispara la alerta de stock.
-- =============================================================================

-- Aplica el efecto de un renglón de venta: factor -1 descuenta, +1 repone.
create or replace function interno.mover_stock_por_venta(p_codigo text, p_cantidad int, p_factor int)
returns void
language plpgsql
security definer
set search_path = public, interno, pg_temp
as $$
begin
  if p_codigo is null or coalesce(p_cantidad, 0) = 0 then
    return;
  end if;
  -- Sólo pisa una fila existente (producto trackeado); si no hay fila, no hace nada.
  update public.stock_articulos
     set cantidad        = greatest(cantidad + p_factor * p_cantidad, 0),
         actualizado_en  = now(),
         actualizado_por = auth.uid()
   where codigo = p_codigo;
end;
$$;


-- ── Por renglón: descuenta al insertar, repone al borrar, ajusta al cambiar. ──
create or replace function interno.stock_por_renglon_de_nota()
returns trigger
language plpgsql
security definer
set search_path = public, interno, pg_temp
as $$
declare
  v_estado public.estado_nota_pedido;
begin
  select estado into v_estado
    from public.notas_pedido
   where id = coalesce(new.nota_id, old.nota_id);

  -- Una nota anulada la maneja el trigger de estado; no se toca por renglón
  -- (evita descontar/reponer dos veces).
  if v_estado = 'anulada' then
    return coalesce(new, old);
  end if;

  if tg_op = 'INSERT' then
    if new.servicio = 'venta' then
      perform interno.mover_stock_por_venta(new.codigo_herramienta, new.cantidad, -1);
    end if;
  elsif tg_op = 'DELETE' then
    if old.servicio = 'venta' then
      perform interno.mover_stock_por_venta(old.codigo_herramienta, old.cantidad, 1);
    end if;
  else
    -- UPDATE: revertir el viejo y aplicar el nuevo (cubre cambios de cantidad,
    -- código o servicio en una corrección).
    if old.servicio = 'venta' then
      perform interno.mover_stock_por_venta(old.codigo_herramienta, old.cantidad, 1);
    end if;
    if new.servicio = 'venta' then
      perform interno.mover_stock_por_venta(new.codigo_herramienta, new.cantidad, -1);
    end if;
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists notas_items_stock on public.notas_pedido_items;
create trigger notas_items_stock
  after insert or update or delete on public.notas_pedido_items
  for each row execute function interno.stock_por_renglon_de_nota();


-- ── Por estado: al ANULAR repone los renglones de venta; al des-anular, descuenta. ──
create or replace function interno.stock_por_estado_de_nota()
returns trigger
language plpgsql
security definer
set search_path = public, interno, pg_temp
as $$
declare
  r record;
  v_factor int;
begin
  if new.estado = old.estado then
    return new;
  end if;

  if new.estado = 'anulada' and old.estado <> 'anulada' then
    v_factor := 1;   -- repone
  elsif old.estado = 'anulada' and new.estado <> 'anulada' then
    v_factor := -1;  -- des-anula (defensivo): vuelve a descontar
  else
    return new;      -- otras transiciones (pendiente→impresa→entregada) no tocan stock
  end if;

  for r in
    select codigo_herramienta, cantidad
      from public.notas_pedido_items
     where nota_id = new.id and servicio = 'venta'
  loop
    perform interno.mover_stock_por_venta(r.codigo_herramienta, r.cantidad, v_factor);
  end loop;

  return new;
end;
$$;

drop trigger if exists notas_estado_stock on public.notas_pedido;
create trigger notas_estado_stock
  after update of estado on public.notas_pedido
  for each row execute function interno.stock_por_estado_de_nota();
