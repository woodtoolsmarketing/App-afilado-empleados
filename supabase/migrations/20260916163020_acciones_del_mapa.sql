-- =============================================================================
-- Las tres acciones al tocar un cliente en el mapa
--
-- En la pantalla MAPA del celular, tocar un pin abre un menú con tres cosas:
--   1) Agregar como PRÓXIMO DESTINO  -> parada de prioridad 'alta' (adelante).
--   2) Agregar a la COLA DE VIAJES   -> parada de prioridad 'baja' (al final).
--   3) MODIFICAR datos               -> razón social, nombre de fantasía o dirección.
--
-- Las dos primeras son la misma pieza que ya existe (`agregar_parada`), sólo
-- cambia la prioridad. La tercera abre una edición que hoy el vendedor no podía
-- hacer (sólo un admin edita `clientes`), y deja registro de cada cambio para
-- que la oficina saque a fin de mes un listado de lo que se tocó.
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 1 y 2 · Agregar un cliente del mapa al recorrido de hoy
--
-- El mapa muestra el padrón entero (vía `clientes_en_mapa`, SECURITY DEFINER),
-- así que el cliente tocado puede no ser de la cartera del vendedor y su
-- `direccion_id` no viaja en el pin. Esta función, con los permisos del dueño:
--   · resuelve la dirección principal del cliente,
--   · asegura la jornada de hoy del vendedor (la crea si no está),
--   · inserta la parada con la prioridad pedida reusando `agregar_parada`.
--
-- La fecha se toma en hora de Argentina, igual que `asegurarJornadaDeHoy` en el
-- teléfono (que usa la fecha LOCAL): si se usara `current_date` (UTC), de las
-- 21:00 en adelante crearía la jornada de mañana y quedarían dos.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.agregar_cliente_al_recorrido(
  p_cliente_id uuid,
  p_prioridad  prioridad_parada
)
returns public.paradas
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $fn$
declare
  v_direccion_id uuid;
  v_rol_id       uuid;
  v_fecha        date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_parada       public.paradas;
begin
  if not interno.esta_habilitado() then
    raise exception 'Tu cuenta no está habilitada.' using errcode = '42501';
  end if;

  -- La dirección principal del cliente (la que se dibuja en el mapa).
  select id into v_direccion_id
    from public.direcciones
   where cliente_id = p_cliente_id
     and lat is not null
     and lng is not null
   order by principal desc, creado_en
   limit 1;

  if v_direccion_id is null then
    raise exception 'Ese cliente todavía no está ubicado en el mapa.' using errcode = '23514';
  end if;

  -- La jornada de hoy del vendedor, creándola si la oficina no la armó.
  insert into public.roles_visita (vendedor_id, fecha, estado)
  values (auth.uid(), v_fecha, 'planificado')
  on conflict (vendedor_id, fecha) do nothing;

  select id into v_rol_id
    from public.roles_visita
   where vendedor_id = auth.uid()
     and fecha = v_fecha;

  -- Reusa la lógica de siempre: 'alta' entra adelante (próximo destino), 'baja'
  -- al final y reordena por cercanía. El índice de un-cliente-por-jornada tira
  -- 23505 si ya estaba; lo traducimos a algo que el vendedor entienda.
  begin
    v_parada := public.agregar_parada(v_rol_id, v_direccion_id, p_prioridad, p_cliente_id);
  exception when unique_violation then
    raise exception 'Ese cliente ya está en tu recorrido de hoy.' using errcode = '23505';
  end;

  return v_parada;
end;
$fn$;

comment on function public.agregar_cliente_al_recorrido is
  'Agrega un cliente del mapa al recorrido de hoy del vendedor. prioridad alta = próximo destino; baja = cola de viajes.';

revoke all on function public.agregar_cliente_al_recorrido(uuid, prioridad_parada) from public;
grant execute on function public.agregar_cliente_al_recorrido(uuid, prioridad_parada) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3a · La ficha para editar (traer los datos actuales)
--
-- El pin sólo trae razón social y coordenadas. Para abrir el formulario de
-- edición hace falta también el nombre de fantasía y el texto de la dirección,
-- y el cliente tocado puede no ser de la cartera del vendedor (la RLS de
-- `clientes` lo escondería). SECURITY DEFINER, igual que `buscar_clientes` y
-- `clientes_en_mapa`, que ya exponen el padrón entero al vendedor.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.ficha_cliente(p_cliente_id uuid)
returns table (
  razon_social         text,
  nombre_fantasia      text,
  direccion_id         uuid,
  direccion_formateada text
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $fn$
  select c.razon_social, c.nombre_fantasia, d.id, d.direccion_formateada
    from public.clientes c
    left join lateral (
      select id, direccion_formateada
        from public.direcciones
       where cliente_id = c.id
       order by principal desc, creado_en
       limit 1
    ) d on true
   where c.id = p_cliente_id;
$fn$;

comment on function public.ficha_cliente is
  'Datos actuales de un cliente para el formulario de edición del mapa (razón social, nombre de fantasía y dirección principal).';

revoke all on function public.ficha_cliente(uuid) from public;
grant execute on function public.ficha_cliente(uuid) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3b · Registro de modificaciones, para el listado de fin de mes
--
-- Una fila por campo cambiado. La escribe un trigger (no cada punto de
-- escritura), así captura TODAS las vías: la edición del vendedor desde el mapa
-- (RPC de abajo), la corrección de dirección (`ubicar_cliente`) y la edición de
-- la oficina desde el panel, que va por UPDATE directo. `cliente_codigo` es un
-- snapshot: el código de ese momento, aunque después el cliente cambie o se
-- borre.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.clientes_modificaciones (
  id             uuid primary key default extensions.gen_random_uuid(),
  cliente_id     uuid references public.clientes (id) on delete set null,
  cliente_codigo text,
  campo          text not null,
  valor_anterior text,
  valor_nuevo    text,
  modificado_por uuid references public.perfiles (id) on delete set null,
  modificado_en  timestamptz not null default now()
);

create index if not exists clientes_modificaciones_fecha_idx
  on public.clientes_modificaciones (modificado_en desc);
create index if not exists clientes_modificaciones_cliente_idx
  on public.clientes_modificaciones (cliente_id, modificado_en desc);

alter table public.clientes_modificaciones enable row level security;

-- Sólo la oficina (admin o supervisor) ve el listado. La escritura la hace el
-- trigger, que corre como dueño y no pasa por RLS: no hay policy de INSERT a
-- propósito, para que nadie invente filas a mano.
drop policy if exists clientes_modificaciones_leer on public.clientes_modificaciones;
create policy clientes_modificaciones_leer on public.clientes_modificaciones
  for select to authenticated
  using (interno.puede_ver_todo());

comment on table public.clientes_modificaciones is
  'Auditoría de cambios de datos de clientes (razón social, nombre de fantasía, dirección). Alimenta el listado mensual del panel.';


-- Trigger para `clientes`: razón social y nombre de fantasía.
create or replace function public.auditar_cambio_cliente()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
begin
  if new.razon_social is distinct from old.razon_social then
    insert into public.clientes_modificaciones
      (cliente_id, cliente_codigo, campo, valor_anterior, valor_nuevo, modificado_por)
    values
      (new.id, new.codigo, 'Razón social', old.razon_social, new.razon_social, auth.uid());
  end if;

  if new.nombre_fantasia is distinct from old.nombre_fantasia then
    insert into public.clientes_modificaciones
      (cliente_id, cliente_codigo, campo, valor_anterior, valor_nuevo, modificado_por)
    values
      (new.id, new.codigo, 'Nombre de fantasía', old.nombre_fantasia, new.nombre_fantasia, auth.uid());
  end if;

  return new;
end;
$fn$;

drop trigger if exists auditar_cambio_cliente on public.clientes;
create trigger auditar_cambio_cliente
  after update on public.clientes
  for each row
  execute function public.auditar_cambio_cliente();


-- Trigger para `direcciones`: el texto de la dirección.
create or replace function public.auditar_cambio_direccion()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_codigo text;
begin
  if new.direccion_formateada is distinct from old.direccion_formateada
     and new.cliente_id is not null then
    select codigo into v_codigo from public.clientes where id = new.cliente_id;
    insert into public.clientes_modificaciones
      (cliente_id, cliente_codigo, campo, valor_anterior, valor_nuevo, modificado_por)
    values
      (new.cliente_id, v_codigo, 'Dirección', old.direccion_formateada, new.direccion_formateada, auth.uid());
  end if;

  return new;
end;
$fn$;

drop trigger if exists auditar_cambio_direccion on public.direcciones;
create trigger auditar_cambio_direccion
  after update on public.direcciones
  for each row
  execute function public.auditar_cambio_direccion();


-- ─────────────────────────────────────────────────────────────────────────────
-- 3c · Editar los datos del cliente desde el mapa
--
-- El vendedor no puede hacer UPDATE de `clientes` (la RLS es sólo admin), así
-- que va por una función con los permisos del dueño que valida que esté
-- habilitado y escribe sólo los tres campos que el pedido permite. La dirección
-- se corrige sobre la principal; las coordenadas no se tocan (mover el pin es
-- otra cosa). Los triggers de arriba dejan el registro.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.modificar_datos_cliente(
  p_cliente_id      uuid,
  p_razon_social    text,
  p_nombre_fantasia text default null,
  p_direccion       text default null
)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_direccion_id uuid;
begin
  if not interno.esta_habilitado() then
    raise exception 'Tu cuenta no está habilitada.' using errcode = '42501';
  end if;

  if length(trim(coalesce(p_razon_social, ''))) < 3 then
    raise exception 'Escribí el nombre o la razón social del cliente.' using errcode = '23514';
  end if;

  update public.clientes
     set razon_social    = trim(p_razon_social),
         nombre_fantasia = nullif(trim(coalesce(p_nombre_fantasia, '')), '')
   where id = p_cliente_id;

  if not found then
    raise exception 'No encontramos ese cliente.' using errcode = 'P0002';
  end if;

  if coalesce(trim(p_direccion), '') <> '' then
    select id into v_direccion_id
      from public.direcciones
     where cliente_id = p_cliente_id
     order by principal desc, creado_en
     limit 1;

    if v_direccion_id is not null then
      update public.direcciones
         set direccion_formateada = trim(p_direccion)
       where id = v_direccion_id;
    end if;
  end if;
end;
$fn$;

comment on function public.modificar_datos_cliente is
  'Edita razón social, nombre de fantasía y/o el texto de la dirección de un cliente desde el mapa. Deja registro en clientes_modificaciones vía trigger.';

revoke all on function public.modificar_datos_cliente(uuid, text, text, text) from public;
grant execute on function public.modificar_datos_cliente(uuid, text, text, text) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- Cerrar el acceso anónimo
--
-- Supabase agrega, por default privileges, un GRANT EXECUTE explícito a `anon`
-- sobre cada función nueva del esquema `public`; `revoke ... from public` no lo
-- saca. Estas tres son sólo para el vendedor logueado (`authenticated`), así que
-- se le quita a `anon` de forma explícita. Las funciones de trigger no son API:
-- se sacan de todos los roles de la API (el trigger las corre igual, no pasa por
-- el permiso EXECUTE).
-- ─────────────────────────────────────────────────────────────────────────────
revoke execute on function public.agregar_cliente_al_recorrido(uuid, prioridad_parada) from anon;
revoke execute on function public.ficha_cliente(uuid) from anon;
revoke execute on function public.modificar_datos_cliente(uuid, text, text, text) from anon;

revoke execute on function public.auditar_cambio_cliente() from public, anon, authenticated;
revoke execute on function public.auditar_cambio_direccion() from public, anon, authenticated;
