-- Donde se registro una visita: igual que `ubicacion_de_nota`, pero para la
-- visita del rol. Dice si el vendedor registro el parte desde la direccion del
-- cliente (dentro del radio), y si NO, distingue dos casos:
--   * el cliente tiene una correccion de direccion registrada (no rechazada) ->
--     "Cambio de dirección" (el desvio se explica por el cambio);
--   * no la tiene -> "No es cerca del cliente".
--
-- Lo destraba el comando `regedit` de la consola del panel, pero el dato real lo
-- protege esta funcion: exige el permiso por usuario `ve_ubicacion_de_notas`
-- (mismo que las notas). Quien no lo tiene recibe 42501 y no ve nada.
create or replace function public.ubicacion_de_visita(p_visita_id uuid)
returns table(veredicto text, metros integer)
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  radio        integer;
  distancia    integer;
  v_cliente_id uuid;
  v_existe     boolean;
  tiene_cambio boolean;
begin
  if not interno.puede_ver_ubicacion_de_notas() then
    raise exception 'No tenes permiso para consultar esto.' using errcode = '42501';
  end if;

  select true, cliente_id into v_existe, v_cliente_id
    from public.visitas where id = p_visita_id;
  if not coalesce(v_existe, false) then
    raise exception 'No existe la visita %', p_visita_id using errcode = 'P0002';
  end if;

  select (valor)::int into radio from public.configuracion where clave = 'llegada_radio_m';
  radio := coalesce(radio, 150);

  -- Distancia contra la direccion de la PARADA visitada (la sucursal); si la
  -- parada no tenia direccion, contra la principal del cliente.
  select round(extensions.st_distance(
           d.ubicacion,
           extensions.st_setsrid(extensions.st_makepoint(v.lng, v.lat), 4326)::extensions.geography
         ))::int
    into distancia
    from public.visitas v
    join public.direcciones d
      on d.id = coalesce(
           (select pa.direccion_id from public.paradas pa where pa.id = v.parada_id),
           (select d2.id
              from public.direcciones d2
             where d2.cliente_id = v.cliente_id
             order by d2.principal desc, d2.creado_en
             limit 1)
         )
   where v.id = p_visita_id
     and v.lat is not null
     and v.lng is not null;

  if distancia is null then
    return query select 'Sin dato de ubicación'::text, null::integer;
    return;
  end if;

  if distancia <= radio then
    return query select 'Visitó en el lugar'::text, distancia;
    return;
  end if;

  -- Lejos del lugar: ¿el cliente tiene una correccion de direccion (no
  -- rechazada) registrada? Si la tiene, el desvio puede explicarse por el cambio
  -- de direccion; si no, el vendedor simplemente no estuvo cerca del cliente.
  select exists (
    select 1
      from public.cambios_direccion cd
     where cd.cliente_id = v_cliente_id
       and cd.es_ubicacion_nueva = false
       and cd.estado <> 'rechazado'
  ) into tiene_cambio;

  if tiene_cambio then
    return query select 'Cambio de dirección'::text, distancia;
  else
    return query select 'No es cerca del cliente'::text, distancia;
  end if;
end;
$function$;

-- Solo usuarios logueados. OJO: en Supabase, `revoke ... from public` NO saca el
-- GRANT EXECUTE EXPLICITO a anon que agregan los default privileges del schema;
-- hay que revocar de anon aparte (ver memoria "SECURITY DEFINER: revocar anon
-- aparte"). Igual la funcion valida el permiso por usuario adentro.
revoke execute on function public.ubicacion_de_visita(uuid) from anon, public;
grant execute on function public.ubicacion_de_visita(uuid) to authenticated;
