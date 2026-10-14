-- Endurecimiento de "Permitir editar" (post-revision adversarial).
--
-- 1) La auditoria de clientes_modificaciones cubria solo razon_social y
--    nombre_fantasia. Como administracion ahora edita 7 campos con permiso (y el
--    admin tambien los toca), se amplia el trigger para dejar rastro de cuit,
--    telefono, correo, contacto y notas. Beneficia a TODO cambio de cliente.
-- 2) editar_cliente_con_permiso vuelve a chequear que el que edita siga siendo
--    administracion (no solo que tenga el permiso): si lo degradaron a vendedor
--    despues de la aprobacion, el permiso deja de servir.
-- 3) solicitar_edicion_cliente se vuelve idempotente cuando ya hay un permiso
--    aprobado y vigente: devuelve ese en vez de chocar contra el indice unico.
-- 4) La policy de lectura envuelve los helpers en (select ...) (InitPlan), igual
--    que el resto de las tablas (anti-patron rls-por-fila).

-- ── 1) Auditoria completa de los datos del cliente ──────────────────────────
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
    values (new.id, new.codigo, 'Razón social', old.razon_social, new.razon_social, auth.uid());
  end if;

  if new.nombre_fantasia is distinct from old.nombre_fantasia then
    insert into public.clientes_modificaciones
      (cliente_id, cliente_codigo, campo, valor_anterior, valor_nuevo, modificado_por)
    values (new.id, new.codigo, 'Nombre de fantasía', old.nombre_fantasia, new.nombre_fantasia, auth.uid());
  end if;

  if new.cuit is distinct from old.cuit then
    insert into public.clientes_modificaciones
      (cliente_id, cliente_codigo, campo, valor_anterior, valor_nuevo, modificado_por)
    values (new.id, new.codigo, 'CUIT', old.cuit, new.cuit, auth.uid());
  end if;

  if new.telefono is distinct from old.telefono then
    insert into public.clientes_modificaciones
      (cliente_id, cliente_codigo, campo, valor_anterior, valor_nuevo, modificado_por)
    values (new.id, new.codigo, 'Teléfono', old.telefono, new.telefono, auth.uid());
  end if;

  if new.email is distinct from old.email then
    insert into public.clientes_modificaciones
      (cliente_id, cliente_codigo, campo, valor_anterior, valor_nuevo, modificado_por)
    values (new.id, new.codigo, 'Correo', old.email, new.email, auth.uid());
  end if;

  if new.contacto_nombre is distinct from old.contacto_nombre then
    insert into public.clientes_modificaciones
      (cliente_id, cliente_codigo, campo, valor_anterior, valor_nuevo, modificado_por)
    values (new.id, new.codigo, 'Contacto', old.contacto_nombre, new.contacto_nombre, auth.uid());
  end if;

  if new.notas is distinct from old.notas then
    insert into public.clientes_modificaciones
      (cliente_id, cliente_codigo, campo, valor_anterior, valor_nuevo, modificado_por)
    values (new.id, new.codigo, 'Notas', old.notas, new.notas, auth.uid());
  end if;

  return new;
end;
$fn$;

-- ── 2) + 3) RPCs endurecidas ────────────────────────────────────────────────
create or replace function public.solicitar_edicion_cliente(p_cliente_id uuid, p_motivo text default '')
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

  -- Un aprobado vencido libera el lugar del indice unico: se marca vencido.
  update public.permisos_edicion_cliente
     set estado = 'vencido'
   where cliente_id = p_cliente_id and solicitado_por = auth.uid()
     and estado = 'aprobado' and vence_en is not null and vence_en < now();

  -- Si ya hay un permiso aprobado y vigente, no hace falta pedir de nuevo: se
  -- devuelve ese (la ficha ya deja editar). Evita chocar contra el indice unico.
  select * into fila
    from public.permisos_edicion_cliente
   where cliente_id = p_cliente_id and solicitado_por = auth.uid()
     and estado = 'aprobado' and (vence_en is null or vence_en > now())
   limit 1;
  if fila.id is not null then
    return fila;
  end if;

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

create or replace function public.editar_cliente_con_permiso(
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
  -- El rol se vuelve a chequear al editar, no solo al pedir: si lo degradaron
  -- despues de la aprobacion, el permiso deja de servir.
  if (select rol from public.perfiles where id = auth.uid()) <> 'administracion' then
    raise exception 'Solo administracion edita con permiso.' using errcode = '42501';
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

-- ── 4) RLS con los helpers en InitPlan ──────────────────────────────────────
drop policy permisos_edicion_cliente_leer on public.permisos_edicion_cliente;
create policy permisos_edicion_cliente_leer on public.permisos_edicion_cliente
  for select to authenticated
  using (
    (select interno.es_admin())
    or (solicitado_por = (select auth.uid()) and (select interno.esta_habilitado()))
  );
