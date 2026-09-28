-- Un vendedor en la calle propone corregir la direccion/ubicacion de un cliente.
-- NO se pisa la direccion oficial: queda como pedido pendiente; su recorrido usa
-- la coordenada nueva (lo resuelve la app) y la oficina lo aplica desde el panel.

create type public.estado_cambio_direccion as enum ('pendiente', 'aplicado', 'rechazado');

create table public.cambios_direccion (
  id                  uuid primary key default extensions.gen_random_uuid(),
  cliente_id          uuid not null references public.clientes(id) on delete cascade,
  direccion_id        uuid references public.direcciones(id) on delete set null,
  direccion_propuesta text not null,
  lat_propuesta       double precision,
  lng_propuesta       double precision,
  motivo              text,
  vendedor_id         uuid not null default auth.uid() references public.perfiles(id),
  estado              public.estado_cambio_direccion not null default 'pendiente',
  creado_en           timestamptz not null default now(),
  resuelto_por        uuid references public.perfiles(id),
  resuelto_en         timestamptz,
  motivo_rechazo      text
);

create index cambios_direccion_pendientes_idx on public.cambios_direccion (estado, creado_en desc);
create index cambios_direccion_cliente_idx on public.cambios_direccion (cliente_id);
create unique index cambios_direccion_un_pendiente
  on public.cambios_direccion (cliente_id, vendedor_id) where estado = 'pendiente';

alter table public.cambios_direccion enable row level security;

create policy cambios_direccion_crear_propio on public.cambios_direccion
  for insert with check (vendedor_id = auth.uid() and interno.esta_habilitado());

create policy cambios_direccion_leer on public.cambios_direccion
  for select using (interno.puede_ver_todo() or (vendedor_id = auth.uid() and interno.esta_habilitado()));

create policy cambios_direccion_oficina on public.cambios_direccion
  for update using (interno.es_admin()) with check (interno.es_admin());

create function public.proponer_cambio_direccion(
  p_cliente_id uuid, p_direccion_id uuid, p_direccion text,
  p_lat double precision default null, p_lng double precision default null, p_motivo text default null
) returns public.cambios_direccion
 language plpgsql security definer set search_path to 'public', 'pg_temp'
as $$
declare fila public.cambios_direccion;
begin
  if not interno.esta_habilitado() then
    raise exception 'Tu cuenta no esta habilitada.' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_direccion, ''))) < 5 then
    raise exception 'Escribi la direccion nueva.' using errcode = '23514';
  end if;
  if not exists (select 1 from public.clientes where id = p_cliente_id) then
    raise exception 'No existe ese cliente.' using errcode = 'P0002';
  end if;

  update public.cambios_direccion
     set direccion_id = p_direccion_id, direccion_propuesta = trim(p_direccion),
         lat_propuesta = p_lat, lng_propuesta = p_lng,
         motivo = nullif(trim(p_motivo), ''), creado_en = now()
   where cliente_id = p_cliente_id and vendedor_id = auth.uid() and estado = 'pendiente'
  returning * into fila;

  if fila.id is null then
    insert into public.cambios_direccion
      (cliente_id, direccion_id, direccion_propuesta, lat_propuesta, lng_propuesta, motivo, vendedor_id)
    values
      (p_cliente_id, p_direccion_id, trim(p_direccion), p_lat, p_lng, nullif(trim(p_motivo), ''), auth.uid())
    returning * into fila;
  end if;

  return fila;
end;
$$;

create function public.aplicar_cambio_direccion(p_id uuid)
 returns public.direcciones
 language plpgsql security definer set search_path to 'public', 'pg_temp'
as $$
declare c public.cambios_direccion; d public.direcciones;
begin
  if not interno.es_admin() then
    raise exception 'Solo un administrador puede aplicar cambios de direccion.' using errcode = '42501';
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

create function public.rechazar_cambio_direccion(p_id uuid, p_motivo text default null)
 returns public.cambios_direccion
 language plpgsql security definer set search_path to 'public', 'pg_temp'
as $$
declare fila public.cambios_direccion;
begin
  if not interno.es_admin() then
    raise exception 'Solo un administrador puede rechazar cambios de direccion.' using errcode = '42501';
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

revoke execute on function public.proponer_cambio_direccion(uuid, uuid, text, double precision, double precision, text) from anon;
revoke execute on function public.aplicar_cambio_direccion(uuid) from anon;
revoke execute on function public.rechazar_cambio_direccion(uuid, text) from anon;
