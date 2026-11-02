-- Historial de clientes confirmados y rechazados (panel, para administración y admin).
--
-- Los RECHAZADOS ya quedaban registrados en la ficha (rechazado_en / motivo_rechazo /
-- rechazado_por). Los CONFIRMADOS no dejaban rastro: al confirmar, el provisorio
-- pasaba a cliente real sin marca de cuándo ni quién. Se agrega esa marca para
-- poder armar el historial de ahora en más.

alter table public.clientes
  add column if not exists confirmado_en  timestamptz,
  add column if not exists confirmado_por uuid;

comment on column public.clientes.confirmado_en is
  'Cuándo se confirmó (dejó de ser provisorio) el cliente que cargó un vendedor. Lo pone confirmar_cliente_provisorio.';
comment on column public.clientes.confirmado_por is
  'Quién confirmó el cliente provisorio (auth.uid de administración/admin).';

-- La confirmación ahora deja su marca de cuándo y quién. Mismo cuerpo que ya
-- estaba, sólo se agregan confirmado_en/confirmado_por al update.
create or replace function public.confirmar_cliente_provisorio(p_cliente_id uuid, p_codigo text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_cod text := upper(btrim(coalesce(p_codigo, '')));
begin
  if not interno.es_administracion() then
    raise exception 'Sólo administración o un administrador puede confirmar clientes.' using errcode = '42501';
  end if;
  if v_cod = '' then
    raise exception 'Escribí el código de cliente definitivo.' using errcode = '23514';
  end if;
  if v_cod like 'P-%' then
    raise exception 'Ese es el código provisorio. Poné el código definitivo (sin "P-").' using errcode = '23514';
  end if;

  update public.clientes
     set codigo = v_cod, provisorio = false, habilitado = true,
         confirmado_en = now(), confirmado_por = auth.uid()
   where id = p_cliente_id and provisorio = true;

  if not found then
    raise exception 'Ese cliente no existe o ya estaba confirmado.' using errcode = 'P0002';
  end if;
exception
  when unique_violation then
    raise exception 'Ya existe un cliente con ese código.' using errcode = '23505';
end;
$function$;

-- Backfill: los clientes que un vendedor cargó desde la calle y la oficina ya
-- confirmó quedan identificados porque tienen `creado_por` (el padrón importado y
-- los que carga el admin a mano NO lo tienen: la columna no tiene default). No
-- sabemos la fecha exacta de confirmación, así que se usa la de creación como
-- aproximación, y quién confirmó queda en null (histórico, previo a esta marca).
update public.clientes
   set confirmado_en = creado_en
 where provisorio = false and activo = true
   and creado_por is not null and confirmado_en is null;

-- La sección del panel. La ve administración (por este permiso) y admin (ve todo).
insert into public.funciones (clave, etiqueta, descripcion, orden, roles_habilitados, ambito)
values (
  'panel_clientes_historial',
  'Historial de clientes',
  'Clientes confirmados y rechazados que pasaron por "Clientes a confirmar", con buscador',
  95,
  '{administracion}',
  'panel'
)
on conflict (clave) do nothing;
