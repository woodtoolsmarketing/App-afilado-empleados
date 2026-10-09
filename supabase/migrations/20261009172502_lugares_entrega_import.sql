-- Staging del reporte "LUGARES DE ENTREGA" del Gestión: el texto crudo por
-- cliente, para que la oficina lo vea y para geocodificar/cargar los lugares de
-- entrega como filas de `direcciones`. Separado de clientes.notas a propósito.
create table if not exists public.lugares_entrega_import (
  id uuid primary key default extensions.gen_random_uuid(),
  cliente_id uuid references public.clientes(id) on delete set null,
  cliente_codigo text not null,
  razon_archivo text,
  texto text,
  telefono text,
  tiene_direccion boolean not null default false,
  -- Se completa cuando de este texto se crea un lugar de entrega geocodificado.
  direccion_id uuid references public.direcciones(id) on delete set null,
  estado text not null default 'crudo', -- crudo | geocodificado | descartado | sin_cliente
  creado_en timestamptz not null default now()
);

comment on table public.lugares_entrega_import is
  'Importación del reporte LUGARES DE ENTREGA del Gestión (texto crudo por cliente). Fuente para cargar/geocodificar los lugares de entrega.';

create index if not exists lugares_import_cliente_idx on public.lugares_entrega_import (cliente_id);

alter table public.lugares_entrega_import enable row level security;

create policy lugares_import_leer on public.lugares_entrega_import
  for select using ((select interno.esta_habilitado()));

create policy lugares_import_admin on public.lugares_entrega_import
  for all using ((select interno.es_admin())) with check ((select interno.es_admin()));
