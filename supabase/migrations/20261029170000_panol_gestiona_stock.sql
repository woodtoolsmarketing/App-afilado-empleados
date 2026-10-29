-- =============================================================================
-- WoodTools · el rol panol gestiona el stock
--
-- "panol" (pañolero / depósito de herramientas) puede VER y EDITAR el stock y
-- ver las alertas de stock bajo, pero NADA más: no hereda los poderes de
-- Administración (notas, clientes, precios, impresora…). Por eso una guardia
-- propia —puede_gestionar_stock()— en vez de sumarlo a es_administracion().
--
-- Qué toca:
--  · Guardia nueva interno.puede_gestionar_stock() = admin/administracion/panol.
--  · fijar_stock y fijar_stock_masivo pasan a usarla (antes es_administracion).
--  · alertas_stock: panol también las lee y las marca vistas (suma a puede_ver_todo).
--  · funciones.panel_stock: panol queda habilitado (ve la sección Stock del panel).
--  · total_herramientas_disponibles(): suma de unidades, para el tablero del panol.
-- =============================================================================

-- ── Guardia: quién gestiona el stock ────────────────────────────────────────
create or replace function interno.puede_gestionar_stock()
returns boolean language sql stable
set search_path = public, pg_temp
as $fn$
  select interno.rol_actual() in ('administracion', 'admin', 'panol')
     and interno.esta_habilitado();
$fn$;

grant execute on function interno.puede_gestionar_stock() to authenticated;

comment on function interno.puede_gestionar_stock() is
  'TRUE para admin, administracion y panol habilitados. Guardia de la carga de stock y de ver/marcar las alertas, sin dar el resto de los poderes de administracion.';


-- ── fijar_stock: la guardia ahora es puede_gestionar_stock ──────────────────
create or replace function public.fijar_stock(
  p_codigo   text,
  p_cantidad integer
) returns public.stock_articulos
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  fila public.stock_articulos;
begin
  if not interno.puede_gestionar_stock() then
    raise exception 'No tenes permiso para cargar stock'
      using errcode = '42501';
  end if;

  if p_cantidad is null or p_cantidad < 0 then
    raise exception 'La cantidad no puede ser negativa' using errcode = '23514';
  end if;

  -- Sólo productos VENDIBLES: los servicios (es_servicio=true) no llevan stock.
  if not exists (
    select 1 from public.vista_catalogo_vigente
     where codigo = p_codigo and es_servicio = false
  ) then
    raise exception 'No es un producto vendible del catalogo: %', p_codigo
      using errcode = '23514';
  end if;

  insert into public.stock_articulos (codigo, cantidad, actualizado_en, actualizado_por)
       values (p_codigo, p_cantidad, now(), auth.uid())
  on conflict (codigo) do update
       set cantidad        = excluded.cantidad,
           actualizado_en  = now(),
           actualizado_por = auth.uid()
  returning * into fila;

  insert into public.auditoria (actor_id, accion, entidad, entidad_id, datos)
  values (auth.uid(), 'stock.fijado', 'stock_articulos', p_codigo,
          jsonb_build_object('cantidad', p_cantidad));

  return fila;
end;
$$;


-- ── fijar_stock_masivo: misma guardia ───────────────────────────────────────
create or replace function public.fijar_stock_masivo(
  p_items jsonb,
  p_cero_faltantes boolean default false,
  p_dry_run boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_prod int; v_serv int; v_nocat int; v_cero int;
  v_faltan jsonb;
begin
  if not interno.puede_gestionar_stock() then
    raise exception 'No tenes permiso para cargar stock' using errcode = '42501';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Los items tienen que ser un arreglo JSON' using errcode = '22023';
  end if;

  drop table if exists _items;
  drop table if exists _clasif;

  -- Normaliza y deduplica (por si el cliente mando repetidos): codigo -> cantidad.
  create temporary table _items on commit drop as
    select codigo, max(cantidad) as cantidad
    from (
      select btrim(e->>'codigo') as codigo,
             greatest(round(coalesce(nullif(e->>'cantidad', ''), '0')::numeric)::int, 0) as cantidad
      from jsonb_array_elements(p_items) e
      where coalesce(btrim(e->>'codigo'), '') <> ''
    ) q
    group by codigo;

  -- Clasifica cada codigo del Excel contra el catalogo.
  create temporary table _clasif on commit drop as
    select i.codigo, i.cantidad,
      case when c.codigo is null then 'no_catalogo'
           when c.es_servicio then 'servicio'
           else 'producto' end as clase
    from _items i
    left join (
      select codigo, bool_or(es_servicio) as es_servicio
      from public.catalogo_articulos group by codigo
    ) c on c.codigo = i.codigo;

  select count(*) filter (where clase = 'producto'),
         count(*) filter (where clase = 'servicio'),
         count(*) filter (where clase = 'no_catalogo')
    into v_prod, v_serv, v_nocat
    from _clasif;

  -- Lista (acotada) de los que estan en el Excel pero NO en el catalogo.
  select coalesce(jsonb_agg(codigo order by codigo), '[]'::jsonb) into v_faltan
    from (select codigo from _clasif where clase = 'no_catalogo' order by codigo limit 100) t;

  -- Cuantos productos vendibles con stock <> 0 quedarian/quedaron en 0.
  select count(*) into v_cero
    from public.stock_articulos s
    where p_cero_faltantes
      and s.cantidad <> 0
      and exists (select 1 from public.vista_catalogo_vigente v where v.codigo = s.codigo and v.es_servicio = false)
      and not exists (select 1 from _items i where i.codigo = s.codigo);

  if not p_dry_run then
    insert into public.stock_articulos (codigo, cantidad, actualizado_en, actualizado_por)
      select codigo, cantidad, now(), auth.uid() from _clasif where clase = 'producto'
      on conflict (codigo) do update
        set cantidad = excluded.cantidad, actualizado_en = now(), actualizado_por = auth.uid();

    if p_cero_faltantes then
      update public.stock_articulos s
        set cantidad = 0, actualizado_en = now(), actualizado_por = auth.uid()
      where s.cantidad <> 0
        and exists (select 1 from public.vista_catalogo_vigente v where v.codigo = s.codigo and v.es_servicio = false)
        and not exists (select 1 from _items i where i.codigo = s.codigo);
    end if;

    insert into public.auditoria (actor_id, accion, entidad, entidad_id, datos)
    values (auth.uid(), 'stock.carga_masiva', 'stock_articulos', null,
            jsonb_build_object('productos', v_prod, 'servicios', v_serv, 'no_catalogo', v_nocat,
                               'puestos_en_cero', v_cero, 'cero_faltantes', p_cero_faltantes));
  end if;

  return jsonb_build_object(
    'dry_run', p_dry_run,
    'cero_faltantes', p_cero_faltantes,
    'recibidos', (select count(*) from _items),
    'productos', v_prod,
    'servicios', v_serv,
    'no_catalogo', v_nocat,
    'puestos_en_cero', v_cero,
    'faltan_en_catalogo', v_faltan
  );
end;
$$;


-- ── alertas_stock: panol también las ve y las marca vistas ──────────────────
-- Se SUMA a puede_ver_todo (no lo reemplaza), así supervisor/administración
-- siguen viéndolas y panol se agrega.
drop policy if exists alertas_stock_leer on public.alertas_stock;
create policy alertas_stock_leer on public.alertas_stock
  for select to authenticated
  using (interno.puede_ver_todo() or interno.puede_gestionar_stock());

create or replace function public.marcar_alertas_stock_vistas()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_n int;
begin
  if not (interno.puede_ver_todo() or interno.puede_gestionar_stock()) then
    raise exception 'Solo la oficina puede marcar las alertas de stock.' using errcode = '42501';
  end if;
  update public.alertas_stock set visto_en = now() where visto_en is null;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;


-- ── funciones: panol ve la seccion Stock del panel ──────────────────────────
-- panel_stock arranca admin-only (array vacío); se le suma panol para que vea la
-- sección. El resto de las secciones del panel quedan sin panol: sólo ve Stock.
update public.funciones
   set roles_habilitados = array_append(roles_habilitados, 'panol'::public.rol_usuario)
 where clave = 'panel_stock'
   and not ('panol'::public.rol_usuario = any (roles_habilitados));


-- ── Contador para el tablero del panol: unidades totales en stock ───────────
create or replace function public.total_herramientas_disponibles()
returns integer
language sql stable
security invoker
set search_path = public, pg_temp
as $fn$
  select coalesce(sum(cantidad), 0)::int from public.stock_articulos;
$fn$;

grant execute on function public.total_herramientas_disponibles() to authenticated;

comment on function public.total_herramientas_disponibles() is
  'Suma de unidades de stock de todos los productos (herramientas disponibles). SECURITY INVOKER: lee stock_articulos con la RLS del que consulta (stock_leer: cualquier habilitado).';
