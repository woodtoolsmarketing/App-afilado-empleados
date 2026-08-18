-- ── La cola de impresión ─────────────────────────────────────────────────────
--
-- El celular pide, la PC de la oficina imprime.
--
-- Imprimir desde el teléfono depende de cosas que la oficina no controla: el
-- ajuste de letra del equipo, qué impresora tenga a mano el vendedor, y si esa
-- impresora contesta. Encolando, el papel lo saca siempre la misma máquina con
-- el mismo navegador, y la nota sale igual todas las veces.
--
-- La orden es un pedido, no una impresión: recién cuando la PC confirma que
-- salió se sella la nota como impresa.

create table if not exists public.ordenes_impresion (
  id uuid primary key default gen_random_uuid(),
  nota_id uuid not null references public.notas_pedido (id) on delete cascade,
  pedida_por uuid not null references public.perfiles (id) default auth.uid(),

  -- pendiente → imprimiendo → impresa | fallida        (o cancelada de una)
  estado text not null default 'pendiente',

  -- El rol de visita del día se imprime junto con las notas, como en el celular.
  con_rol_de_visita boolean not null default false,

  motivo_fallo text,
  tomada_en timestamptz,
  resuelta_en timestamptz,
  creado_en timestamptz not null default now(),

  constraint ordenes_impresion_estado_valido
    check (estado in ('pendiente', 'imprimiendo', 'impresa', 'fallida', 'cancelada'))
);

comment on table public.ordenes_impresion is
  'Pedidos de impresión que resuelve la PC de la oficina. Ver resolver_orden_impresion.';

-- La cola se lee por estado y en orden de llegada.
create index if not exists ordenes_impresion_por_atender
  on public.ordenes_impresion (estado, creado_en);

-- Una nota no puede estar dos veces en la cola. Tocar el botón dos veces
-- —porque no pasó nada visible— encolaba dos y salían dos juegos de papel.
create unique index if not exists ordenes_impresion_una_por_nota
  on public.ordenes_impresion (nota_id)
  where estado in ('pendiente', 'imprimiendo');

alter table public.ordenes_impresion enable row level security;

-- El vendedor ve y encola lo suyo; la oficina ve todo y es la única que resuelve.
create policy ordenes_impresion_ver on public.ordenes_impresion
  for select to authenticated
  using (pedida_por = auth.uid() or interno.puede_ver_todo());

create policy ordenes_impresion_encolar on public.ordenes_impresion
  for insert to authenticated
  with check (
    pedida_por = auth.uid()
    and interno.esta_habilitado()
    and estado = 'pendiente'
  );

create policy ordenes_impresion_resolver on public.ordenes_impresion
  for update to authenticated
  using (interno.puede_ver_todo())
  with check (interno.puede_ver_todo());

-- El vendedor puede arrepentirse mientras nadie la haya tomado.
create policy ordenes_impresion_cancelar_propia on public.ordenes_impresion
  for update to authenticated
  using (pedida_por = auth.uid() and estado = 'pendiente')
  with check (pedida_por = auth.uid() and estado = 'cancelada');


-- ── Cerrar la orden ──────────────────────────────────────────────────────────
--
-- Junta en un solo lugar las dos cosas que tienen que pasar juntas: cerrar la
-- orden y sellar la nota. Si se hicieran por separado, un corte entre las dos
-- dejaría papel impreso y la nota figurando como pendiente —o al revés—.
--
-- La regla de qué se sella es la MISMA que usa el celular y no es obvia: una
-- nota que todavía no tiene código de cliente conserva su estado
-- `pendiente_cliente` —sigue esperando que Administración le asigne el número—
-- pero igual se le graba la fecha, porque es cierto que se imprimió. Pasarla a
-- `impresa` la sacaría de la cola de Administración para siempre, con el
-- trabajo hecho y sin numerar, y nadie se enteraría.
create or replace function public.resolver_orden_impresion(
  p_orden_id uuid,
  p_ok boolean,
  p_motivo text default null
)
returns void
language plpgsql
security invoker
set search_path to 'public', 'pg_temp'
as $$
declare
  v_nota_id uuid;
begin
  if not interno.puede_ver_todo() then
    raise exception 'Sólo la oficina resuelve órdenes de impresión';
  end if;

  update public.ordenes_impresion
     set estado       = case when p_ok then 'impresa' else 'fallida' end,
         motivo_fallo = case when p_ok then null else p_motivo end,
         resuelta_en  = now()
   where id = p_orden_id
     and estado in ('pendiente', 'imprimiendo')
  returning nota_id into v_nota_id;

  if v_nota_id is null then
    raise exception 'La orden no existe o ya estaba resuelta';
  end if;

  if not p_ok then
    return;
  end if;

  update public.notas_pedido
     set estado = 'impresa', impresa_en = now()
   where id = v_nota_id and estado = 'pendiente';

  update public.notas_pedido
     set impresa_en = now()
   where id = v_nota_id and estado = 'pendiente_cliente';
end;
$$;

comment on function public.resolver_orden_impresion is
  'Cierra una orden y sella la nota. Sólo la oficina.';
