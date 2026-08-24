-- Precios acordados con un cliente, que pisan la lista.
--
-- ── Por que un IMPORTE y no un porcentaje ───────────────────────────────────
--
-- La planilla que los define ("PRECIOS ESPECIALES: 01/08/2026") da importes, no
-- descuentos. Y tres de ellos son EXACTAMENTE el precio de lista de hoy, lo que
-- solo tiene sentido leido como un congelamiento: ese cliente se queda en ese
-- numero cuando la lista suba.
--
-- Guardar un porcentaje daria lo contrario —subiria con la lista— y no hay
-- forma de deducir cual de las dos cosas se quiso con solo mirar los numeros.
-- Se guarda lo que dice el papel.
--
-- La contra, asumida y anotada acá para que no sorprenda: cuando entre una
-- lista nueva, estos precios NO se mueven solos. El 8001 ya paso de 226,10 a
-- 248,85 entre marzo y junio; con precio especial cargado, ese cliente se
-- hubiera quedado en el viejo sin que nadie se entere. Por eso esta
-- `vigente_desde`: para poder preguntar cuales quedaron atras.

create table if not exists public.precios_especiales (
  id            uuid primary key default extensions.gen_random_uuid(),
  cliente_id    uuid not null references public.clientes (id) on delete cascade,
  codigo        text not null,
  precio        numeric(14, 2) not null,
  moneda        char(3) not null default 'ARS',
  vigente_desde date not null,
  observaciones text,
  creado_en     timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),

  constraint precios_especiales_precio_positivo check (precio > 0),
  constraint precios_especiales_uno_por_codigo unique (cliente_id, codigo)
);

comment on table public.precios_especiales is
  'Precio acordado con un cliente para un codigo de computo. Pisa el de la lista. Importe fijo: no sube solo cuando sube la lista.';

create index if not exists precios_especiales_cliente_idx on public.precios_especiales (cliente_id);

alter table public.precios_especiales enable row level security;

-- El vendedor los lee: son los precios que tiene que cobrar. Escribirlos es de
-- Administracion, igual que el catalogo.
drop policy if exists precios_especiales_leer on public.precios_especiales;
create policy precios_especiales_leer on public.precios_especiales
  for select to authenticated
  using (interno.esta_habilitado());

drop policy if exists precios_especiales_admin on public.precios_especiales;
create policy precios_especiales_admin on public.precios_especiales
  for all to authenticated
  using (interno.es_admin())
  with check (interno.es_admin());

create trigger precios_especiales_tocar_actualizado
  before update on public.precios_especiales
  for each row execute function interno.tocar_actualizado_en();

-- ── La consulta que usa la app ──────────────────────────────────────────────
--
-- Devuelve solo los codigos que se le preguntan. Asi el telefono pide los dos o
-- tres que tiene el renglon en la mano y no se baja la tabla entera.

create or replace function public.precios_especiales_de(p_cliente_id uuid, p_codigos text[])
returns table (codigo text, precio numeric, moneda char(3))
language sql
stable
set search_path to 'public', 'pg_temp'
as $$
  select pe.codigo, pe.precio, pe.moneda
    from public.precios_especiales pe
   where pe.cliente_id = p_cliente_id
     and pe.codigo = any(p_codigos);
$$;

comment on function public.precios_especiales_de is
  'Los precios acordados con ese cliente para esos codigos. Vacio si no tiene ninguno.';
