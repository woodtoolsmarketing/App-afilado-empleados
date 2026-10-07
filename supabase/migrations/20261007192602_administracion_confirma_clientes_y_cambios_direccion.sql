-- =============================================================================
-- Administración también confirma clientes nuevos y resuelve cambios de dirección
--
-- Es su trabajo de oficina. Hasta ahora estas tres acciones eran sólo de admin;
-- se abren a `interno.es_administracion()` (que ya incluye admin + administración).
-- Las de cambio de dirección son SECURITY DEFINER, así que alcanza con cambiar
-- el chequeo de adentro. Para confirmar un cliente se arma un RPC propio en vez
-- de abrir la RLS de `clientes` entera (sería mucho más de lo que hace falta).
-- =============================================================================

-- ── Confirmar un cliente provisorio (código definitivo + dejar de ser provisorio) ──
create or replace function public.confirmar_cliente_provisorio(
  p_cliente_id uuid,
  p_codigo     text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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
     set codigo = v_cod, provisorio = false
   where id = p_cliente_id and provisorio = true;

  if not found then
    raise exception 'Ese cliente no existe o ya estaba confirmado.' using errcode = 'P0002';
  end if;
exception
  when unique_violation then
    raise exception 'Ya existe un cliente con ese código.' using errcode = '23505';
end;
$$;

revoke all on function public.confirmar_cliente_provisorio(uuid, text) from public;
revoke all on function public.confirmar_cliente_provisorio(uuid, text) from anon;
grant execute on function public.confirmar_cliente_provisorio(uuid, text) to authenticated;

-- ── Cambios de dirección: aplicar / rechazar también desde administración ──
create or replace function public.aplicar_cambio_direccion(p_id uuid)
 returns public.direcciones
 language plpgsql security definer set search_path to 'public', 'pg_temp'
as $$
declare c public.cambios_direccion; d public.direcciones;
begin
  if not interno.es_administracion() then
    raise exception 'Sólo administración o un administrador puede aplicar cambios de direccion.' using errcode = '42501';
  end if;
  select * into c from public.cambios_direccion where id = p_id;
  if c.id is null then
    raise exception 'No existe el cambio %', p_id using errcode = 'P0002';
  end if;
  if c.estado <> 'pendiente' then
    raise exception 'Ese cambio ya fue resuelto.' using errcode = '23514';
  end if;

  if c.direccion_id is not null then
    update public.direcciones
       set direccion_formateada = c.direccion_propuesta,
           lat = coalesce(c.lat_propuesta, lat),
           lng = coalesce(c.lng_propuesta, lng),
           verificada = true
     where id = c.direccion_id
    returning * into d;
  else
    insert into public.direcciones (cliente_id, etiqueta, direccion_formateada, lat, lng, principal, verificada)
    values (c.cliente_id, 'Principal', c.direccion_propuesta, c.lat_propuesta, c.lng_propuesta, true, true)
    returning * into d;
  end if;

  update public.cambios_direccion
     set estado = 'aplicado', resuelto_por = auth.uid(), resuelto_en = now()
   where id = p_id;

  return d;
end;
$$;

create or replace function public.rechazar_cambio_direccion(p_id uuid, p_motivo text default null)
 returns public.cambios_direccion
 language plpgsql security definer set search_path to 'public', 'pg_temp'
as $$
declare fila public.cambios_direccion;
begin
  if not interno.es_administracion() then
    raise exception 'Sólo administración o un administrador puede rechazar cambios de direccion.' using errcode = '42501';
  end if;
  update public.cambios_direccion
     set estado = 'rechazado', resuelto_por = auth.uid(), resuelto_en = now(),
         motivo_rechazo = nullif(trim(p_motivo), '')
   where id = p_id and estado = 'pendiente'
  returning * into fila;
  if fila.id is null then
    raise exception 'Ese cambio no existe o ya fue resuelto.' using errcode = 'P0002';
  end if;
  return fila;
end;
$$;
