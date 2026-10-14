-- Permiso temporal para que ADMINISTRACION edite un cliente.
--
-- Administracion ve la ficha del cliente (solo lectura) y, si necesita corregir
-- un dato, pide permiso con "Permitir editar". El pedido le llega al admin, que
-- lo aprueba o lo rechaza desde el panel. Aprobado, administracion queda
-- habilitada a editar ESE cliente UNA sola vez, dentro de 48 h; al guardar, el
-- permiso se marca usado. Nada se pisa hasta que administracion guarda.
--
-- Modela el patron de cambios_direccion (pedido -> la oficina resuelve), pero
-- aca el que edita es el que pidio, no el que aprueba. El admin edita siempre
-- directo (no necesita esto). Edita los DATOS del cliente (razon social,
-- fantasia, cuit, telefono, email, contacto, notas); el codigo, el vendedor y la
-- direccion siguen siendo del admin / del flujo de cambios de direccion.

create type public.estado_permiso_edicion as enum
  ('pendiente', 'aprobado', 'rechazado', 'usado', 'vencido');

create table public.permisos_edicion_cliente (
  id             uuid primary key default extensions.gen_random_uuid(),
  cliente_id     uuid not null references public.clientes(id) on delete cascade,
  solicitado_por uuid not null default auth.uid() references public.perfiles(id),
  motivo         text,
  estado         public.estado_permiso_edicion not null default 'pendiente',
  creado_en      timestamptz not null default now(),
  resuelto_por   uuid references public.perfiles(id),
  resuelto_en    timestamptz,
  motivo_rechazo text,
  vence_en       timestamptz,
  usado_en       timestamptz
);

create index permisos_edicion_cliente_pendientes_idx
  on public.permisos_edicion_cliente (estado, creado_en desc);
create index permisos_edicion_cliente_cliente_idx
  on public.permisos_edicion_cliente (cliente_id);
-- Un solo pedido ABIERTO (pendiente o aprobado-sin-usar) por cliente y persona.
create unique index permisos_edicion_cliente_uno_abierto
  on public.permisos_edicion_cliente (cliente_id, solicitado_por)
  where estado in ('pendiente', 'aprobado');

alter table public.permisos_edicion_cliente enable row level security;

-- El admin ve todos los pedidos (la cola); administracion ve los suyos (para
-- saber si ya se lo aprobaron). La escritura es SOLO por las RPC de abajo (no
-- hay policy de insert/update/delete a proposito).
create policy permisos_edicion_cliente_leer on public.permisos_edicion_cliente
  for select to authenticated
  using (
    interno.es_admin()
    or (solicitado_por = (select auth.uid()) and interno.esta_habilitado())
  );

-- ── Pedir permiso (administracion) ──────────────────────────────────────────
create function public.solicitar_edicion_cliente(p_cliente_id uuid, p_motivo text default '')
 returns public.permisos_edicion_cliente
 language plpgsql security definer set search_path to 'public', 'pg_temp'
as $$
declare fila public.permisos_edicion_cliente;
begin
  if not interno.esta_habilitado() then
    raise exception 'Tu cuenta no esta habilitada.' using errcode = '42501';
  end if;
  if (select rol from public.perfiles where id = auth.uid()) <> 'administracion' then
    raise exception 'Solo administracion puede pedir permiso de edicion.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.clientes where id = p_cliente_id) then
    raise exception 'No existe ese cliente.' using errcode = 'P0002';
  end if;

  -- Un aprobado que ya vencio libera el lugar del indice unico: se marca vencido
  -- para poder volver a pedir.
  update public.permisos_edicion_cliente
     set estado = 'vencido'
   where cliente_id = p_cliente_id and solicitado_por = auth.uid()
     and estado = 'aprobado' and vence_en is not null and vence_en < now();

  -- Si ya hay un pendiente, se refresca el motivo; si no, se crea.
  update public.permisos_edicion_cliente
     set motivo = nullif(trim(p_motivo), ''), creado_en = now()
   where cliente_id = p_cliente_id and solicitado_por = auth.uid() and estado = 'pendiente'
  returning * into fila;

  if fila.id is null then
    insert into public.permisos_edicion_cliente (cliente_id, solicitado_por, motivo)
    values (p_cliente_id, auth.uid(), nullif(trim(p_motivo), ''))
    returning * into fila;
  end if;

  return fila;
end;
$$;

-- ── Aprobar (admin) ─────────────────────────────────────────────────────────
create function public.aprobar_edicion_cliente(p_id uuid)
 returns public.permisos_edicion_cliente
 language plpgsql security definer set search_path to 'public', 'pg_temp'
as $$
declare fila public.permisos_edicion_cliente;
begin
  if not interno.es_admin() then
    raise exception 'Solo un administrador puede aprobar.' using errcode = '42501';
  end if;
  update public.permisos_edicion_cliente
     set estado = 'aprobado', resuelto_por = auth.uid(), resuelto_en = now(),
         vence_en = now() + interval '48 hours', motivo_rechazo = null
   where id = p_id and estado = 'pendiente'
  returning * into fila;
  if fila.id is null then
    raise exception 'Ese pedido no existe o ya fue resuelto.' using errcode = 'P0002';
  end if;
  return fila;
end;
$$;

-- ── Rechazar (admin) ────────────────────────────────────────────────────────
create function public.rechazar_edicion_cliente(p_id uuid, p_motivo text default '')
 returns public.permisos_edicion_cliente
 language plpgsql security definer set search_path to 'public', 'pg_temp'
as $$
declare fila public.permisos_edicion_cliente;
begin
  if not interno.es_admin() then
    raise exception 'Solo un administrador puede rechazar.' using errcode = '42501';
  end if;
  update public.permisos_edicion_cliente
     set estado = 'rechazado', resuelto_por = auth.uid(), resuelto_en = now(),
         motivo_rechazo = nullif(trim(p_motivo), '')
   where id = p_id and estado = 'pendiente'
  returning * into fila;
  if fila.id is null then
    raise exception 'Ese pedido no existe o ya fue resuelto.' using errcode = 'P0002';
  end if;
  return fila;
end;
$$;

-- ── Editar con el permiso aprobado (administracion) ─────────────────────────
-- De un solo uso: consume el permiso al guardar. Corre como definer, asi que
-- pisa la RLS de clientes (que es solo-admin); el trigger de auditoria igual
-- registra el cambio a nombre de quien llama (auth.uid() = administracion).
create function public.editar_cliente_con_permiso(
  p_cliente_id      uuid,
  p_razon_social    text,
  p_nombre_fantasia text,
  p_cuit            text,
  p_telefono        text,
  p_email           text,
  p_contacto_nombre text,
  p_notas           text
) returns public.clientes
 language plpgsql security definer set search_path to 'public', 'pg_temp'
as $$
declare permiso public.permisos_edicion_cliente; cli public.clientes;
begin
  if not interno.esta_habilitado() then
    raise exception 'Tu cuenta no esta habilitada.' using errcode = '42501';
  end if;

  select * into permiso
    from public.permisos_edicion_cliente
   where cliente_id = p_cliente_id and solicitado_por = auth.uid()
     and estado = 'aprobado' and (vence_en is null or vence_en > now())
   order by resuelto_en desc nulls last
   limit 1
   for update;

  if permiso.id is null then
    raise exception 'No tenes un permiso aprobado y vigente para editar este cliente.'
      using errcode = '42501';
  end if;

  if length(trim(coalesce(p_razon_social, ''))) = 0 then
    raise exception 'La razon social no puede quedar vacia.' using errcode = '23514';
  end if;

  update public.clientes
     set razon_social    = trim(p_razon_social),
         nombre_fantasia = nullif(trim(coalesce(p_nombre_fantasia, '')), ''),
         cuit            = nullif(trim(coalesce(p_cuit, '')), ''),
         telefono        = nullif(trim(coalesce(p_telefono, '')), ''),
         email           = nullif(trim(coalesce(p_email, '')), ''),
         contacto_nombre = nullif(trim(coalesce(p_contacto_nombre, '')), ''),
         notas           = nullif(trim(coalesce(p_notas, '')), ''),
         actualizado_en  = now()
   where id = p_cliente_id
  returning * into cli;

  if cli.id is null then
    raise exception 'No existe ese cliente.' using errcode = 'P0002';
  end if;

  update public.permisos_edicion_cliente
     set estado = 'usado', usado_en = now()
   where id = permiso.id;

  return cli;
end;
$$;

-- Cerrarle la puerta a anon: se revoca de public Y de anon (el grant por defecto
-- es a public, que incluye anon) y se habilita solo a authenticated.
revoke execute on function public.solicitar_edicion_cliente(uuid, text) from public, anon;
revoke execute on function public.aprobar_edicion_cliente(uuid) from public, anon;
revoke execute on function public.rechazar_edicion_cliente(uuid, text) from public, anon;
revoke execute on function public.editar_cliente_con_permiso(uuid, text, text, text, text, text, text, text) from public, anon;

grant execute on function public.solicitar_edicion_cliente(uuid, text) to authenticated;
grant execute on function public.aprobar_edicion_cliente(uuid) to authenticated;
grant execute on function public.rechazar_edicion_cliente(uuid, text) to authenticated;
grant execute on function public.editar_cliente_con_permiso(uuid, text, text, text, text, text, text, text) to authenticated;

-- Para que administracion pueda VER la ficha del cliente (y desde ahi pedir
-- editar), se le habilita la seccion "Clientes" del panel, que arrancaba
-- admin-only. Aditivo: no pisa otros roles que el admin ya haya habilitado.
update public.funciones
   set roles_habilitados = (
     select array(select distinct unnest(roles_habilitados || array['administracion']::public.rol_usuario[]))
   )
 where clave = 'panel_clientes' and ambito = 'panel'
   and not ('administracion' = any(roles_habilitados));
