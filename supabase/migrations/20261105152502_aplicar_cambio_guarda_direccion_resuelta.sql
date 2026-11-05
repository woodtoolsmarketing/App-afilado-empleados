-- Al APLICAR un cambio de dirección, poder guardar un texto de dirección ya
-- resuelto en vez del propuesto.
--
-- Por qué: cuando el vendedor corrige la ubicación de un cliente en el campo
-- (una ruta, sin numeración), Google devuelve la dirección como un PLUS CODE
-- ilegible ("XCC7+W7 Puerto Esperanza, Misiones, Argentina"), y eso es lo que
-- quedaba en `cambios_direccion.direccion_propuesta`. El panel ahora resuelve el
-- nombre de calle legible ("Ruta Nacional 12, Puerto Esperanza") desde las
-- coordenadas del pin y lo muestra. Al aplicar conviene guardar ESE texto como
-- la dirección oficial del cliente, no el plus code.
--
-- Se agrega el parámetro opcional `p_direccion`: si viene (el panel resolvió una
-- calle legible), es el que se guarda; si no (null/vacío, o un panel viejo que
-- no lo manda), se usa `direccion_propuesta` como siempre. `cambios_direccion`
-- NO se toca: el historial sigue mostrando lo que de verdad propuso el vendedor.
--
-- Sumar un parámetro a una función es DROP + CREATE, no CREATE OR REPLACE.

drop function if exists public.aplicar_cambio_direccion(uuid);

create function public.aplicar_cambio_direccion(p_id uuid, p_direccion text default null)
returns public.direcciones
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  c public.cambios_direccion;
  d public.direcciones;
  v_direccion text;
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

  -- El texto resuelto por el panel manda; si no vino, el propuesto por el vendedor.
  v_direccion := coalesce(nullif(btrim(p_direccion), ''), c.direccion_propuesta);

  if c.direccion_id is not null then
    update public.direcciones
       set direccion_formateada = v_direccion,
           lat = coalesce(c.lat_propuesta, lat),
           lng = coalesce(c.lng_propuesta, lng),
           verificada = true
     where id = c.direccion_id
    returning * into d;
  else
    insert into public.direcciones (cliente_id, etiqueta, direccion_formateada, lat, lng, principal, verificada)
    values (c.cliente_id, 'Principal', v_direccion, c.lat_propuesta, c.lng_propuesta, true, true)
    returning * into d;
  end if;

  update public.cambios_direccion
     set estado = 'aplicado', resuelto_por = auth.uid(), resuelto_en = now()
   where id = p_id;

  return d;
end;
$function$;

-- Replica los permisos del original: nadie anónimo, sólo sesiones autenticadas
-- (el RPC ya chequea adentro que sea administración/admin). CREATE vuelve a dar
-- EXECUTE a PUBLIC por defecto, así que hay que revocarlo de nuevo.
revoke execute on function public.aplicar_cambio_direccion(uuid, text) from public, anon;
grant execute on function public.aplicar_cambio_direccion(uuid, text) to authenticated, service_role;
