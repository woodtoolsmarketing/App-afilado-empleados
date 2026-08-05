-- =============================================================================
-- WoodTools · Paso 2
-- Permisos y lógica de las notas de pedido
-- =============================================================================

create or replace function interno.es_administracion()
returns boolean language sql stable
set search_path = public, pg_temp
as $fn$
  select interno.rol_actual() in ('administracion', 'admin') and interno.esta_habilitado();
$fn$;

grant execute on function interno.es_administracion() to authenticated;

-- El panel de escritorio es para admin, supervisor y administración.
create or replace function interno.puede_ver_todo()
returns boolean language sql stable
set search_path = public, pg_temp
as $fn$
  select interno.rol_actual() in ('admin', 'supervisor', 'administracion')
     and interno.esta_habilitado();
$fn$;


-- ─────────────────────────────────────────────────────────────────────────────
-- Numeración
--
-- El número se asigna recién cuando la nota tiene cliente. Mientras no lo
-- tenga, la app la muestra opaca con "(Pendiente)": la nota existe y el trabajo
-- quedó registrado, pero todavía no es un comprobante numerado.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function interno.asignar_numero_nota()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $fn$
begin
  if new.numero is null and new.estado <> 'pendiente_cliente' then
    new.numero := nextval('public.notas_pedido_numero_seq');
  end if;
  return new;
end;
$fn$;

create trigger notas_pedido_numerar
  before insert or update on public.notas_pedido
  for each row execute function interno.asignar_numero_nota();

revoke execute on function interno.asignar_numero_nota() from anon, authenticated, public;


-- ─────────────────────────────────────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.notas_pedido       enable row level security;
alter table public.notas_pedido_items enable row level security;

create policy notas_leer on public.notas_pedido
  for select to authenticated
  using (interno.puede_ver_todo() or vendedor_id = auth.uid());

create policy notas_crear_propias on public.notas_pedido
  for insert to authenticated
  with check (vendedor_id = auth.uid() and interno.esta_habilitado());

-- El vendedor corrige su nota mientras no esté impresa ni entregada.
create policy notas_editar_propias on public.notas_pedido
  for update to authenticated
  using (
    vendedor_id = auth.uid()
    and interno.esta_habilitado()
    and estado in ('pendiente', 'pendiente_cliente')
  )
  with check (vendedor_id = auth.uid());

create policy notas_administracion on public.notas_pedido
  for all to authenticated
  using (interno.es_administracion())
  with check (interno.es_administracion());

create policy items_leer on public.notas_pedido_items
  for select to authenticated
  using (
    interno.puede_ver_todo()
    or exists (
      select 1 from public.notas_pedido n
       where n.id = notas_pedido_items.nota_id and n.vendedor_id = auth.uid()
    )
  );

create policy items_escribir_propios on public.notas_pedido_items
  for all to authenticated
  using (
    exists (
      select 1 from public.notas_pedido n
       where n.id = notas_pedido_items.nota_id
         and n.vendedor_id = auth.uid()
         and n.estado in ('pendiente', 'pendiente_cliente')
    )
  )
  with check (
    exists (
      select 1 from public.notas_pedido n
       where n.id = notas_pedido_items.nota_id and n.vendedor_id = auth.uid()
    )
  );

create policy items_administracion on public.notas_pedido_items
  for all to authenticated
  using (interno.es_administracion())
  with check (interno.es_administracion());


-- ─────────────────────────────────────────────────────────────────────────────
-- Administración le asigna el código de cliente a una nota
--
-- Es el momento en que la nota deja de estar "pendiente" y recibe su número.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.asignar_cliente_a_nota(
  p_nota_id    uuid,
  p_cliente_id uuid
)
returns public.notas_pedido
language plpgsql security invoker
set search_path = public, pg_temp
as $fn$
declare
  nota public.notas_pedido;
  cli  public.clientes;
begin
  if not interno.es_administracion() then
    raise exception 'Sólo el Dpto. de Administración puede asignar el código de cliente'
      using errcode = '42501';
  end if;

  select * into cli from public.clientes where id = p_cliente_id;
  if cli.id is null then
    raise exception 'No existe ese cliente' using errcode = 'P0002';
  end if;
  -- Un cliente provisorio no tiene código real: asignarlo dejaría la nota con
  -- un número de cliente inventado (P-000123) en un comprobante.
  if cli.provisorio then
    raise exception 'El cliente % todavía es provisorio: asignale el código definitivo antes de usarlo en una nota.', cli.codigo
      using errcode = 'P0001';
  end if;

  update public.notas_pedido
     set cliente_id           = p_cliente_id,
         cliente_codigo       = cli.codigo,
         cliente_nombre       = cli.razon_social,
         cliente_cuit         = coalesce(cli.cuit, cliente_cuit),
         estado               = case when estado = 'pendiente_cliente' then 'pendiente' else estado end,
         cliente_asignado_por = auth.uid(),
         cliente_asignado_en  = now()
   where id = p_nota_id
  returning * into nota;

  if nota.id is null then
    raise exception 'No existe la nota %', p_nota_id using errcode = 'P0002';
  end if;

  insert into public.auditoria (actor_id, accion, entidad, entidad_id, datos)
  values (auth.uid(), 'nota.cliente_asignado', 'notas_pedido', p_nota_id::text,
          jsonb_build_object('cliente', cli.codigo, 'numero', nota.numero));

  return nota;
end;
$fn$;


-- Historial de notas de pedido, con la misma lógica que el de visitas.
create or replace function public.historial_notas_pedido(
  p_desde date default null,
  p_hasta date default null
)
returns table (fecha date, cantidad bigint, detalle jsonb)
language plpgsql security invoker
set search_path = public, pg_temp
as $fn$
declare
  retencion int;
  piso date;
begin
  select coalesce((valor)::int, 90) into retencion
    from public.configuracion where clave = 'retencion_historial_dias';
  retencion := coalesce(retencion, 90);

  piso := case when interno.puede_ver_todo()
               then coalesce(p_desde, current_date - retencion)
               else greatest(coalesce(p_desde, current_date - retencion), current_date - retencion)
          end;

  return query
  select
    n.creado_en::date,
    count(*),
    jsonb_agg(
      jsonb_build_object(
        'nota_id',        n.id,
        'numero',         n.numero,
        'tipo_nota',      n.tipo_nota,
        'estado',         n.estado,
        'cliente_codigo', n.cliente_codigo,
        'cliente_nombre', n.cliente_nombre,
        'hora',           n.creado_en,
        'total',          n.total,
        'servicios',      n.servicios
      ) order by n.creado_en desc
    )
  from public.notas_pedido n
  where (interno.puede_ver_todo() or n.vendedor_id = auth.uid())
    and n.creado_en::date >= piso
    and n.creado_en::date <= coalesce(p_hasta, current_date)
  group by n.creado_en::date
  order by n.creado_en::date desc;
end;
$fn$;

comment on function public.historial_notas_pedido is
  'Historial agrupado por día para "HISTORIAL DE NOTAS DE PEDIDO": tipo, cliente y hora de emisión.';
