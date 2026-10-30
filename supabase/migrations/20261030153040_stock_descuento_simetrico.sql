-- =============================================================================
-- WoodTools · descuento de stock SIMÉTRICO (arregla el inventario inflado)
--
-- Revisión pre-publicación: el descuento al vender y la reposición al anular/
-- corregir eran ASIMÉTRICOS y no quedaba registro de cuánto se había descontado,
-- así que el stock se INFLABA y eso se empujaba a la tienda online (sobreventa):
--   · Un producto NO trackeado al emitir (sin fila en stock_articulos) no
--     descontaba; si después la oficina cargaba stock, al anular la nota se
--     reponía igual → stock de más.
--   · El clamp a 0 "se comía" lo sobrevendido al descontar, pero la reposición
--     devolvía la cantidad COMPLETA → stock de más.
--
-- Arreglo: cada renglón de venta guarda cuánto descontó DE VERDAD del stock
-- (`stock_movido`), y la reposición devuelve EXACTAMENTE eso (0 si no descontó).
-- El stock nunca se infla ni baja de 0.
--
-- La tabla stock_articulos está vacía hasta hoy (el feature es no-op hasta que
-- la oficina carga el Excel), así que ningún renglón existente descontó nada:
-- stock_movido = 0 por defecto es correcto y NO hace falta backfill.
-- =============================================================================

alter table public.notas_pedido_items
  add column if not exists stock_movido integer not null default 0;

comment on column public.notas_pedido_items.stock_movido is
  'Unidades que este renglón descontó DE VERDAD del stock (con clamp y sólo si el producto estaba trackeado). La reposición al anular/corregir devuelve exactamente esto. 0 = no descontó (servicio != venta, nota anulada, o producto no trackeado).';

-- Reemplazada por descontar_stock + reponer_stock (asimétricas a propósito).
drop function if exists interno.mover_stock_por_venta(text, integer, integer);

-- Descuenta del stock lo que se pueda (nunca baja de 0, sólo si hay fila) y
-- devuelve cuánto bajó DE VERDAD. 0 si el producto no está trackeado.
create or replace function interno.descontar_stock(p_codigo text, p_cantidad int)
returns int
language plpgsql
security definer
set search_path = public, interno, pg_temp
as $$
declare
  v_actual int;
  v_bajado int;
begin
  if p_codigo is null or coalesce(p_cantidad, 0) <= 0 then
    return 0;
  end if;
  select cantidad into v_actual
    from public.stock_articulos
   where codigo = p_codigo
   for update;
  if not found then
    return 0;  -- producto no trackeado: no se inventan filas
  end if;
  v_bajado := least(p_cantidad, greatest(v_actual, 0));
  update public.stock_articulos
     set cantidad        = v_actual - v_bajado,
         actualizado_en  = now(),
         actualizado_por = auth.uid()
   where codigo = p_codigo;
  return v_bajado;
end;
$$;

-- Devuelve al stock EXACTAMENTE lo que se había descontado (p_unidades), sólo si
-- el producto sigue trackeado. No clampa: p_unidades ya es ≤ lo que había.
create or replace function interno.reponer_stock(p_codigo text, p_unidades int)
returns void
language plpgsql
security definer
set search_path = public, interno, pg_temp
as $$
begin
  if p_codigo is null or coalesce(p_unidades, 0) <= 0 then
    return;
  end if;
  update public.stock_articulos
     set cantidad        = cantidad + p_unidades,
         actualizado_en  = now(),
         actualizado_por = auth.uid()
   where codigo = p_codigo;
end;
$$;

-- ── Por renglón (BEFORE): descuenta al insertar, repone al borrar, ajusta al
--    cambiar; guarda en stock_movido lo que descontó de verdad. ──
create or replace function interno.stock_por_renglon_de_nota()
returns trigger
language plpgsql
security definer
set search_path = public, interno, pg_temp
as $$
declare
  v_estado public.estado_nota_pedido;
begin
  -- Cascada desde el trigger de estado (anular/des-anular): ese ya reacomoda el
  -- stock de toda la nota, así que acá no recalculamos (evita doble movimiento).
  if pg_trigger_depth() > 1 then
    return coalesce(new, old);
  end if;

  select estado into v_estado
    from public.notas_pedido
   where id = coalesce(new.nota_id, old.nota_id);

  if tg_op = 'DELETE' then
    if old.servicio = 'venta' then
      perform interno.reponer_stock(old.codigo_herramienta, old.stock_movido);
    end if;
    return old;
  end if;

  -- INSERT o UPDATE. En UPDATE revierto primero lo que el renglón viejo había
  -- descontado; en INSERT no hay viejo.
  if tg_op = 'UPDATE' and old.servicio = 'venta' then
    perform interno.reponer_stock(old.codigo_herramienta, old.stock_movido);
  end if;

  -- Una nota anulada no descuenta: el renglón queda en 0.
  if new.servicio = 'venta' and coalesce(v_estado, 'pendiente') <> 'anulada' then
    new.stock_movido := interno.descontar_stock(new.codigo_herramienta, new.cantidad);
  else
    new.stock_movido := 0;
  end if;

  return new;
end;
$$;

drop trigger if exists notas_items_stock on public.notas_pedido_items;
create trigger notas_items_stock
  before insert or update or delete on public.notas_pedido_items
  for each row execute function interno.stock_por_renglon_de_nota();

-- ── Por estado: al ANULAR repone lo que cada renglón había descontado (y lo
--    deja en 0); al des-anular (defensivo) vuelve a descontar y re-registra. ──
create or replace function interno.stock_por_estado_de_nota()
returns trigger
language plpgsql
security definer
set search_path = public, interno, pg_temp
as $$
declare
  r record;
  v_mov int;
begin
  if new.estado = old.estado then
    return new;
  end if;

  if new.estado = 'anulada' and old.estado <> 'anulada' then
    for r in
      select id, codigo_herramienta, stock_movido
        from public.notas_pedido_items
       where nota_id = new.id and servicio = 'venta' and stock_movido <> 0
    loop
      perform interno.reponer_stock(r.codigo_herramienta, r.stock_movido);
      -- El UPDATE corre el trigger de renglón a profundidad 2 → se saltea.
      update public.notas_pedido_items set stock_movido = 0 where id = r.id;
    end loop;
  elsif old.estado = 'anulada' and new.estado <> 'anulada' then
    for r in
      select id, codigo_herramienta, cantidad
        from public.notas_pedido_items
       where nota_id = new.id and servicio = 'venta'
    loop
      v_mov := interno.descontar_stock(r.codigo_herramienta, r.cantidad);
      update public.notas_pedido_items set stock_movido = v_mov where id = r.id;
    end loop;
  end if;

  return new;
end;
$$;

drop trigger if exists notas_estado_stock on public.notas_pedido;
create trigger notas_estado_stock
  after update of estado on public.notas_pedido
  for each row execute function interno.stock_por_estado_de_nota();
