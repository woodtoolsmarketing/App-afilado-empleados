-- =============================================================================
-- Dónde se hizo la nota de pedido, y quién puede saberlo
--
-- ── Qué se guarda ───────────────────────────────────────────────────────────
--
-- Cuando el vendedor manda la nota, el teléfono adjunta dónde estaba parado.
-- Comparado contra la dirección del cliente, eso dice si la nota se hizo en el
-- local o en otro lado.
--
-- ── Por qué en una tabla aparte y no en dos columnas de `notas_pedido` ──────
--
-- Porque tiene que estar ESCONDIDO, y RLS no sabe esconder columnas: sabe
-- esconder filas. Dos columnas más en `notas_pedido` viajarían con cada
-- `select *` que hoy hace el panel, y quedarían a la vista de cualquiera que
-- abra las herramientas del navegador —que en el panel se abren con
-- Ctrl+Shift+I, porque es Chromium—. Esconderlo en la pantalla no lo esconde:
-- lo disimula.
--
-- En una tabla propia, la política de lectura decide de verdad. Quien no tiene
-- el permiso no recibe la fila; no hay nada que inspeccionar.
--
-- ── Quién puede verlo ───────────────────────────────────────────────────────
--
-- Un permiso por usuario, apagado para todos. Se prende de a uno y a mano.
--
-- No se ata al email ni al rol: hardcodear "woodtoolsmarketing@gmail.com"
-- dejaría ese literal adentro del instalador que se reparte por mail, y atarlo
-- al rol `admin` se lo daría a todos los administradores de una.
-- =============================================================================

-- ── El permiso ──────────────────────────────────────────────────────────────

alter table public.perfiles
  add column if not exists ve_ubicacion_de_notas boolean not null default false;

comment on column public.perfiles.ve_ubicacion_de_notas is
  'Si este usuario puede consultar donde se emitio una nota de pedido. Apagado '
  'para todos por defecto; se prende de a uno.';

create or replace function interno.puede_ver_ubicacion_de_notas()
returns boolean
language sql
stable
set search_path to 'public', 'pg_temp'
as $$
  select coalesce(
    (select p.ve_ubicacion_de_notas
       from public.perfiles p
      where p.id = auth.uid()
        and p.estado = 'aprobado'),
    false);
$$;

-- ── Dónde estaba el vendedor ────────────────────────────────────────────────

create table if not exists public.notas_pedido_ubicacion (
  nota_id     uuid primary key references public.notas_pedido (id) on delete cascade,
  lat         double precision not null,
  lng         double precision not null,
  precision_m real,
  creado_en   timestamptz not null default now(),

  constraint notas_pedido_ubicacion_lat_rango check (lat between -90 and 90),
  constraint notas_pedido_ubicacion_lng_rango check (lng between -180 and 180)
);

comment on table public.notas_pedido_ubicacion is
  'Donde estaba el vendedor al emitir cada nota. Tabla aparte de notas_pedido '
  'porque RLS esconde filas, no columnas.';

alter table public.notas_pedido_ubicacion enable row level security;

-- El vendedor escribe la suya y nada más. No la puede leer ni corregir: si
-- pudiera, bastaría con mirar para saber que se lo está midiendo.
drop policy if exists notas_pedido_ubicacion_reportar on public.notas_pedido_ubicacion;
create policy notas_pedido_ubicacion_reportar on public.notas_pedido_ubicacion
  for insert to authenticated
  with check (
    interno.esta_habilitado()
    and exists (
      select 1 from public.notas_pedido n
       where n.id = nota_id and n.vendedor_id = auth.uid()
    )
  );

drop policy if exists notas_pedido_ubicacion_leer on public.notas_pedido_ubicacion;
create policy notas_pedido_ubicacion_leer on public.notas_pedido_ubicacion
  for select to authenticated
  using (interno.puede_ver_ubicacion_de_notas());

-- ── El veredicto ────────────────────────────────────────────────────────────
--
-- SECURITY DEFINER porque tiene que medir contra `direcciones`, que el que
-- consulta puede no ver. El control de acceso se hace acá adentro, primero y
-- explícito: sin el permiso, la función ni siquiera mira.
--
-- El radio sale de `configuracion.llegada_radio_m` —el mismo con el que se
-- decide que el vendedor llegó a un destino— para que las dos cosas no puedan
-- decir lo contrario una de la otra.

create or replace function public.ubicacion_de_nota(p_nota_id uuid)
returns table (veredicto text, metros integer)
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  radio     integer;
  distancia integer;
  hay_nota  boolean;
begin
  if not interno.puede_ver_ubicacion_de_notas() then
    raise exception 'No tenes permiso para consultar esto.' using errcode = '42501';
  end if;

  select true into hay_nota from public.notas_pedido where id = p_nota_id;
  if not coalesce(hay_nota, false) then
    raise exception 'No existe la nota %', p_nota_id using errcode = 'P0002';
  end if;

  select (valor)::int into radio from public.configuracion where clave = 'llegada_radio_m';
  radio := coalesce(radio, 150);

  select round(extensions.st_distance(
           d.ubicacion,
           extensions.st_setsrid(extensions.st_makepoint(u.lng, u.lat), 4326)::extensions.geography
         ))::int
    into distancia
    from public.notas_pedido n
    join public.notas_pedido_ubicacion u on u.nota_id = n.id
    join public.direcciones d on d.cliente_id = n.cliente_id
   where n.id = p_nota_id
   order by d.principal desc, d.creado_en
   limit 1;

  if distancia is null then
    -- Puede ser que el teléfono no haya tenido señal, o que el cliente no esté
    -- geolocalizado. Se dicen las dos como una sola cosa: no hay con qué
    -- comparar, y afirmar cualquiera de las dos seria inventar.
    return query select 'Sin dato de ubicación'::text, null::integer;
    return;
  end if;

  return query select
    case when distancia <= radio
         then 'Hizo la nota de pedido en el lugar'
         else 'No hizo la nota de pedido en el lugar'
    end::text,
    distancia;
end;
$function$;

revoke all on function public.ubicacion_de_nota(uuid) from public;
grant execute on function public.ubicacion_de_nota(uuid) to authenticated;

comment on function public.ubicacion_de_nota is
  'Dice si la nota se emitio en el domicilio del cliente. Exige el permiso '
  've_ubicacion_de_notas; sin el, levanta 42501.';
