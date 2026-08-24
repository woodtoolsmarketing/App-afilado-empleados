-- Lo que el vendedor cobra en la calle.
--
-- ── Por que una tabla y no un tilde en la nota ──────────────────────────────
--
-- Ya existe un "cobro" en el sistema: un booleano de la VISITA, sin monto y sin
-- comprobante, que se imprime como una X en el rol de visita y se cuenta en el
-- tablero. Reusarlo para esto cambiaria dos papeles y un tablero que hoy
-- funcionan, y seguiria sin poder decir cuanto se cobro.
--
-- ── Por que acumulativa por dia y no una por nota ───────────────────────────
--
-- Porque la planilla de papel que hay que llenar es asi: un encabezado con
-- VENDEDOR N, GIRA ZONA y FECHA, muchos renglones, y un TOTAL GENERAL abajo.
-- Es la rendicion del dia, no un recibo.
--
-- `nota_id` es opcional a proposito: se puede cobrar una factura vieja, o algo
-- que no tiene nota en el sistema. El codigo y el nombre del cliente se copian
-- al momento de cobrar y no se leen despues por relacion, porque la planilla es
-- un comprobante de ese dia y tiene que decir lo que decia ese dia.

create table if not exists public.cobranzas (
  id             uuid primary key default extensions.gen_random_uuid(),
  vendedor_id    uuid not null references public.perfiles (id) on delete cascade,
  fecha          date not null default (now() at time zone 'America/Argentina/Buenos_Aires')::date,

  nota_id        uuid references public.notas_pedido (id) on delete set null,
  cliente_id     uuid references public.clientes (id) on delete set null,
  cliente_codigo text,
  cliente_nombre text not null,

  -- Contra que comprobante se cobro. Viene propuesto de la nota, pero se puede
  -- corregir: un cobro puede ir contra un comprobante distinto del que se
  -- imprimio.
  tipo_comprobante text not null check (tipo_comprobante in ('factura', 'presupuesto')),

  total          numeric(14, 2) not null check (total > 0),
  cheque         numeric(14, 2) not null default 0 check (cheque >= 0),
  efectivo       numeric(14, 2) not null default 0 check (efectivo >= 0),
  comentarios    text,

  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),

  -- Las dos formas tienen que sumar el total. Si no, la planilla no cierra
  -- contra el TOTAL GENERAL, que es lo unico que la oficina compara.
  constraint cobranzas_formas_suman check (cheque + efectivo = total)
);

comment on table public.cobranzas is
  'Cobros que el vendedor hace en la calle. Alimentan la planilla de cobranzas del dia.';

create index if not exists cobranzas_vendedor_fecha_idx on public.cobranzas (vendedor_id, fecha);

alter table public.cobranzas enable row level security;

drop policy if exists cobranzas_propias on public.cobranzas;
create policy cobranzas_propias on public.cobranzas
  for insert to authenticated
  with check (vendedor_id = auth.uid() and interno.esta_habilitado());

drop policy if exists cobranzas_leer on public.cobranzas;
create policy cobranzas_leer on public.cobranzas
  for select to authenticated
  using (interno.puede_ver_todo() or vendedor_id = auth.uid());

-- Corregir un monto mal tipeado el mismo dia: pasa, y no tener como arreglarlo
-- obliga a llamar a la oficina por un error de un digito.
drop policy if exists cobranzas_corregir_hoy on public.cobranzas;
create policy cobranzas_corregir_hoy on public.cobranzas
  for update to authenticated
  using (
    vendedor_id = auth.uid()
    and interno.esta_habilitado()
    and creado_en > now() - interval '18 hours'
  )
  with check (vendedor_id = auth.uid());

drop policy if exists cobranzas_admin on public.cobranzas;
create policy cobranzas_admin on public.cobranzas
  for all to authenticated
  using (interno.es_admin()) with check (interno.es_admin());

create trigger cobranzas_tocar_actualizado
  before update on public.cobranzas
  for each row execute function interno.tocar_actualizado_en();
