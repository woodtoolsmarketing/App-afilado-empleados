-- =============================================================================
-- WoodTools · Rol de Visita
-- 0010 · Alta de clientes desde la calle
--
-- "AGREGAR NUEVO DESTINO" pasa a tener dos caminos: cliente existente y cliente
-- nuevo. El segundo exige que un vendedor pueda crear un cliente, cosa que
-- hasta ahora sólo podía hacer un administrador.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Clientes provisorios
--
-- Un cliente cargado en la calle no tiene código de la empresa, ni CUIT, ni
-- condición de pago. Nace marcado como provisorio y con un código automático
-- `P-000123`, para que la oficina lo complete después sin que se pierda la
-- visita ni el parte que el vendedor ya cargó.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.clientes
  add column if not exists provisorio boolean not null default false;

create index if not exists clientes_provisorios_idx
  on public.clientes (creado_en desc) where provisorio;

comment on column public.clientes.provisorio is
  'Cliente creado por un vendedor durante el recorrido. La oficina tiene que completarle el código real y los datos fiscales.';

create sequence if not exists public.clientes_codigo_provisorio_seq;
grant usage, select on sequence public.clientes_codigo_provisorio_seq to authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- Los vendedores pueden buscar en todo el padrón activo
--
-- Antes sólo veían su propia cartera. No alcanza: un vendedor que cubre a un
-- compañero, o que pasa por un cliente todavía sin asignar, tiene que poder
-- encontrarlo para agregarlo al recorrido. Los datos que se exponen son los de
-- la ficha comercial, no hay nada sensible.
-- ─────────────────────────────────────────────────────────────────────────────

drop policy if exists clientes_leer on public.clientes;

create policy clientes_leer on public.clientes
  for select to authenticated
  using (
    interno.puede_ver_todo()
    or (interno.esta_habilitado() and activo)
    -- Los inactivos siguen visibles si ya figuran en alguna jornada del
    -- vendedor: si no, el historial mostraría "Destino sin cliente".
    or (
      interno.esta_habilitado()
      and exists (
        select 1
          from public.paradas pa
          join public.roles_visita rv on rv.id = pa.rol_visita_id
         where pa.cliente_id = clientes.id
           and rv.vendedor_id = auth.uid()
      )
    )
  );


-- ─────────────────────────────────────────────────────────────────────────────
-- Los vendedores pueden crear clientes, sólo provisorios y a su nombre
-- ─────────────────────────────────────────────────────────────────────────────

create policy clientes_crear_en_ruta on public.clientes
  for insert to authenticated
  with check (
    interno.esta_habilitado()
    and provisorio
    and vendedor_id = auth.uid()
    and creado_por  = auth.uid()
  );


-- ─────────────────────────────────────────────────────────────────────────────
-- Alta de un destino con cliente nuevo, en una sola transacción
--
-- Crea el cliente, su dirección y la parada. Si algo falla, no queda ni el
-- cliente huérfano ni la dirección suelta.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.agregar_destino_cliente_nuevo(
  p_rol_visita_id        uuid,
  p_razon_social         text,
  p_direccion_formateada text,
  p_codigo_postal        text,
  p_lat                  double precision,
  p_lng                  double precision,
  p_prioridad            public.prioridad_parada,
  p_google_place_id      text default null,
  p_localidad            text default null,
  p_provincia            text default null,
  p_telefono             text default null,
  p_contacto             text default null
)
returns public.paradas
language plpgsql
security invoker
set search_path = public, pg_temp
as $fn$
declare
  nuevo_cliente   public.clientes;
  nueva_direccion public.direcciones;
  parada          public.paradas;
begin
  if length(trim(coalesce(p_razon_social, ''))) < 3 then
    raise exception 'Escribí el nombre o la razón social del cliente.'
      using errcode = '23514';
  end if;

  if p_lat is null or p_lng is null then
    raise exception 'Elegí la dirección de la lista de sugerencias de Google.'
      using errcode = '23514';
  end if;

  insert into public.clientes (
    codigo, razon_social, telefono, contacto_nombre,
    vendedor_id, creado_por, provisorio, activo
  )
  values (
    'P-' || lpad(nextval('public.clientes_codigo_provisorio_seq')::text, 6, '0'),
    trim(p_razon_social),
    nullif(trim(coalesce(p_telefono, '')), ''),
    nullif(trim(coalesce(p_contacto, '')), ''),
    auth.uid(), auth.uid(), true, true
  )
  returning * into nuevo_cliente;

  insert into public.direcciones (
    cliente_id, direccion_formateada, codigo_postal, localidad, provincia,
    lat, lng, google_place_id, verificada, principal, etiqueta
  )
  values (
    nuevo_cliente.id, trim(p_direccion_formateada),
    nullif(trim(coalesce(p_codigo_postal, '')), ''),
    p_localidad, p_provincia, p_lat, p_lng, p_google_place_id,
    p_google_place_id is not null, true, 'Principal'
  )
  returning * into nueva_direccion;

  parada := public.agregar_parada(
    p_rol_visita_id, nueva_direccion.id, p_prioridad, nuevo_cliente.id
  );

  return parada;
end;
$fn$;

comment on function public.agregar_destino_cliente_nuevo is
  'Crea cliente provisorio + dirección + parada en una transacción. Lo usa el formulario "Cliente nuevo" de la app.';


-- ─────────────────────────────────────────────────────────────────────────────
-- Búsqueda de clientes para el formulario "Cliente existente"
--
-- Busca por código o por razón social indistintamente y devuelve la dirección
-- principal, que es lo que autocompleta el formulario. Devuelve pocas filas a
-- propósito: es un buscador con sugerencias, no un listado.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.buscar_clientes(p_texto text, p_limite int default 15)
returns table (
  cliente_id       uuid,
  codigo           text,
  razon_social     text,
  nombre_fantasia  text,
  contacto_nombre  text,
  telefono         text,
  provisorio       boolean,
  direccion_id     uuid,
  direccion        text,
  codigo_postal    text,
  lat              double precision,
  lng              double precision
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $fn$
  select
    c.id, c.codigo, c.razon_social, c.nombre_fantasia,
    c.contacto_nombre, c.telefono, c.provisorio,
    d.id, d.direccion_formateada, d.codigo_postal, d.lat, d.lng
  from public.clientes c
  left join lateral (
    select * from public.direcciones dd
     where dd.cliente_id = c.id
     order by dd.principal desc, dd.creado_en
     limit 1
  ) d on true
  where c.activo
    and (
      coalesce(nullif(trim(p_texto), ''), '') = ''
      or c.codigo ilike '%' || trim(p_texto) || '%'
      or c.razon_social ilike '%' || trim(p_texto) || '%'
      or coalesce(c.nombre_fantasia, '') ilike '%' || trim(p_texto) || '%'
    )
  order by
    -- Coincidencia exacta de código primero: es lo que el vendedor tipea
    -- cuando ya sabe a quién busca.
    (c.codigo ilike trim(p_texto)) desc,
    c.razon_social
  limit least(coalesce(p_limite, 15), 50);
$fn$;

comment on function public.buscar_clientes is
  'Buscador del formulario "Cliente existente": código o razón social, con la dirección principal para autocompletar.';
