-- =============================================================================
-- WoodTools · alertas de stock bajo / agotado (sólo panel)
--
-- Cuando un producto CRUZA el umbral de stock bajo (default 10) o se AGOTA (0),
-- se registra una alerta con nombre + código. Es por CRUCE (compara el valor
-- viejo contra el nuevo), así la primera carga del Excel —la línea de base— no
-- dispara nada: recién las cargas siguientes avisan cuando el stock bajó de
-- verdad. Como `stock_articulos` sólo tiene productos vendibles, los servicios
-- quedan afuera solos. El panel lo muestra (toast + globo + lista) y lo marca
-- visto.
-- =============================================================================

insert into public.configuracion (clave, valor, descripcion) values
  ('stock_umbral_bajo', '10'::jsonb,
   'Cantidad en o por debajo de la cual un producto se considera "stock bajo" y avisa en el panel.')
on conflict (clave) do nothing;

create table if not exists public.alertas_stock (
  id        uuid primary key default extensions.gen_random_uuid(),
  codigo    text not null,
  nombre    text not null,
  cantidad  integer not null,
  tipo      text not null check (tipo in ('bajo', 'agotado')),
  creado_en timestamptz not null default now(),
  visto_en  timestamptz
);

comment on table public.alertas_stock is
  'Avisos de stock bajo/agotado para la oficina (panel). Se generan por trigger cuando un producto cruza el umbral; visto_en los marca como leidos.';

create index if not exists alertas_stock_nuevas_idx
  on public.alertas_stock (creado_en desc) where visto_en is null;

alter table public.alertas_stock enable row level security;

-- Leer: la oficina (puede_ver_todo). El trigger escribe salteando RLS
-- (SECURITY DEFINER), así que no hace falta policy de insert.
drop policy if exists alertas_stock_leer on public.alertas_stock;
create policy alertas_stock_leer on public.alertas_stock
  for select to authenticated using (interno.puede_ver_todo());


-- ─────────────────────────────────────────────────────────────────────────────
-- Trigger: detecta el cruce del umbral al actualizar la cantidad.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function interno.avisar_stock_bajo()
returns trigger
language plpgsql
security definer
set search_path = public, interno, pg_temp
as $$
declare
  v_umbral int := coalesce((select (valor #>> '{}')::int from public.configuracion where clave = 'stock_umbral_bajo'), 10);
  v_nombre text;
  v_tipo   text;
begin
  -- Sólo hay cruce si cambió la cantidad. (El trigger es AFTER UPDATE OF cantidad,
  -- así que la primera carga de un código —un INSERT— no pasa por acá.)
  if new.cantidad is not distinct from old.cantidad then
    return new;
  end if;

  -- "agotado" tiene prioridad sobre "bajo".
  if old.cantidad > 0 and new.cantidad = 0 then
    v_tipo := 'agotado';
  elsif old.cantidad > v_umbral and new.cantidad <= v_umbral and new.cantidad > 0 then
    v_tipo := 'bajo';
  else
    return new; -- no cruzó hacia abajo (subió, o ya estaba bajo)
  end if;

  select descripcion into v_nombre
    from public.vista_catalogo_vigente
    where codigo = new.codigo and es_servicio = false
    limit 1;

  insert into public.alertas_stock (codigo, nombre, cantidad, tipo)
  values (new.codigo, coalesce(nullif(btrim(v_nombre), ''), new.codigo), new.cantidad, v_tipo);

  return new;
end;
$$;

drop trigger if exists stock_articulos_avisar on public.stock_articulos;
create trigger stock_articulos_avisar
  after update of cantidad on public.stock_articulos
  for each row execute function interno.avisar_stock_bajo();


-- ─────────────────────────────────────────────────────────────────────────────
-- Marcar las alertas como vistas (botón del panel).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.marcar_alertas_stock_vistas()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_n int;
begin
  if not interno.puede_ver_todo() then
    raise exception 'Solo la oficina puede marcar las alertas de stock.' using errcode = '42501';
  end if;
  update public.alertas_stock set visto_en = now() where visto_en is null;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.marcar_alertas_stock_vistas() from public, anon;
grant execute on function public.marcar_alertas_stock_vistas() to authenticated;
