-- =============================================================================
-- WoodTools · stock de productos del catálogo
--
-- Un stock por PRODUCTO vendible (es_servicio = false). Los servicios de taller
-- —afilado, reparación, rectificado, soldadura, laminado, etc.— quedan afuera
-- solos: `es_servicio` (columna generada del catálogo) ya los distingue, y se
-- filtra igual que la búsqueda de la venta (`buscar_articulos`), así el stock
-- cubre exactamente lo que el vendedor puede vender.
--
-- ── Por qué una tabla aparte y no una columna en catalogo_articulos ──────────
-- El catálogo ACUMULA listas de precios: cada lista nueva inserta filas nuevas
-- por código (otro lista_origen, otro id) y la vista vigente pasa a mostrar la
-- más nueva (cargar-catalogo.cjs usa Prefer: resolution=ignore-duplicates). Una
-- columna de stock viviría pegada a una fila que mañana deja de ser la vigente y
-- el stock se perdería en silencio en cada actualización de precios. Por eso vive
-- en su propia tabla, con clave el `codigo` (la clave de negocio estable). Es la
-- misma razón por la que precio_a_confirmar y es_servicio son GENERADAS.
-- =============================================================================

create table if not exists public.stock_articulos (
  codigo          text primary key,
  -- Unidades enteras: los productos (sierras, fresas, mechas, muelas, insumos) se
  -- cuentan de a uno. Carga manual de la oficina; no se descuenta solo (todavía).
  cantidad        integer not null default 0 check (cantidad >= 0),
  actualizado_en  timestamptz not null default now(),
  actualizado_por uuid references public.perfiles (id) on delete set null
);

comment on table public.stock_articulos is
  'Stock por producto vendible del catalogo (es_servicio=false). Clave = codigo. Carga manual de la oficina. Sin FK a catalogo_articulos: codigo no es unico ahi; lo valida fijar_stock.';

alter table public.stock_articulos enable row level security;

-- Leer: cualquier usuario habilitado, igual que el catálogo (catalogo_leer). No
-- es dato sensible y el panel lo necesita; el móvil no lo consulta.
drop policy if exists stock_leer on public.stock_articulos;
create policy stock_leer on public.stock_articulos
  for select to authenticated using (interno.esta_habilitado());

-- Escribir: NADIE directo. Todo pasa por fijar_stock (SECURITY DEFINER), que
-- aplica la regla del negocio (sólo Administración, sólo productos vendibles).
-- Mismo patrón que completar_articulo: la autoridad es la guardia de la función,
-- no una policy de la tabla.


-- ─────────────────────────────────────────────────────────────────────────────
-- El apartado de productos: el catálogo vigente VENDIBLE con su stock.
-- security_invoker para heredar el RLS del que consulta (igual que
-- vista_catalogo_vigente). Un renglón por (codigo, medida); el stock es por
-- codigo, así que las pocas variantes de medida de un mismo código comparten el
-- stock del código.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace view public.vista_stock with (security_invoker = true) as
  select
    v.codigo,
    v.descripcion,
    v.medida,
    v.familia,
    v.precio,
    v.moneda,
    v.precio_a_confirmar,
    coalesce(s.cantidad, 0) as stock,
    s.actualizado_en        as stock_actualizado_en
  from public.vista_catalogo_vigente v
  left join public.stock_articulos s on s.codigo = v.codigo
  where v.es_servicio = false;

comment on view public.vista_stock is
  'Productos vendibles del catalogo vigente (es_servicio=false) con su stock (0 si no se cargo). Un renglon por (codigo, medida); el stock es por codigo.';


-- ─────────────────────────────────────────────────────────────────────────────
-- Fijar el stock de un producto. Clona el patrón de completar_articulo:
-- SECURITY DEFINER + guardia es_administracion() + validación + control
-- post-escritura + auditoría.
-- ─────────────────────────────────────────────────────────────────────────────
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
  if not interno.es_administracion() then
    raise exception 'Solo el Dpto. de Administracion puede cargar stock'
      using errcode = '42501';
  end if;

  if p_cantidad is null or p_cantidad < 0 then
    raise exception 'La cantidad no puede ser negativa' using errcode = '23514';
  end if;

  -- Sólo productos VENDIBLES: los servicios (es_servicio=true) no llevan stock.
  -- Mismo criterio que la búsqueda de la venta (= false excluye también los
  -- es_servicio NULL, que el vendedor tampoco ve).
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

comment on function public.fijar_stock(text, integer) is
  'Fija el stock de un producto vendible. SECURITY DEFINER: la regla es la guardia es_administracion(), no una policy. Rechaza servicios y codigos inexistentes.';

revoke all on function public.fijar_stock(text, integer) from public, anon;
grant execute on function public.fijar_stock(text, integer) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- La sección del panel, configurable por rol (como las demás). Arranca admin-only
-- (roles_habilitados vacío), igual que "A confirmar"; el admin puede habilitar
-- Administración desde Permisos. admin ve todo siempre.
-- ─────────────────────────────────────────────────────────────────────────────
insert into public.funciones (clave, etiqueta, descripcion, orden, roles_habilitados, ambito) values
  ('panel_stock', 'Stock', 'Stock de productos del catalogo', 135, array[]::public.rol_usuario[], 'panel')
on conflict (clave) do nothing;
