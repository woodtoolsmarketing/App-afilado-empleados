-- =============================================================================
-- El vendedor puede corregir una ubicación, no sólo completar la que falta
--
-- La versión anterior se negaba a pisar una dirección existente: si el cliente
-- ya tenía una, devolvía esa. El razonamiento era que corregir desde el
-- teléfono, sin que la oficina se entere, podía romper el reparto en silencio.
--
-- La decisión fue la contraria, y tiene sentido: el vendedor es el que está
-- parado en la puerta del cliente. Si la ficha dice una cosa y el local está en
-- otra, el que sabe es él. Pisa y listo.
--
-- Sigue siendo idempotente en el caso de completar (mismo lugar, no duplica
-- filas): siempre hay a lo sumo una dirección principal por cliente. Lo que
-- cambia es que ahora la ACTUALIZA en vez de ignorar el pedido.
--
-- `verificada` vuelve a true en cada corrección: si la dirección venía del
-- geocodificado en lote y quedó marcada para revisar, que alguien la haya
-- confirmado en la calle es exactamente la revisión que faltaba.
-- =============================================================================

create or replace function public.ubicar_cliente(
  p_cliente_id           uuid,
  p_direccion_formateada text,
  p_lat                  double precision,
  p_lng                  double precision,
  p_codigo_postal        text default null,
  p_google_place_id      text default null,
  p_localidad            text default null,
  p_provincia            text default null
)
returns public.direcciones
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  existente public.direcciones;
  resultado public.direcciones;
begin
  if p_lat is null or p_lng is null then
    raise exception 'Elegi la direccion de la lista de sugerencias de Google.'
      using errcode = '23514';
  end if;

  if length(trim(coalesce(p_direccion_formateada, ''))) < 5 then
    raise exception 'La direccion esta vacia o es demasiado corta.'
      using errcode = '23514';
  end if;

  select * into existente
    from public.direcciones
   where cliente_id = p_cliente_id
   order by principal desc, creado_en
   limit 1;

  if found then
    update public.direcciones
       set direccion_formateada = trim(p_direccion_formateada),
           codigo_postal        = nullif(trim(coalesce(p_codigo_postal, '')), ''),
           localidad            = p_localidad,
           provincia            = p_provincia,
           lat                  = p_lat,
           lng                  = p_lng,
           google_place_id      = p_google_place_id,
           verificada           = true,
           -- La nota del geocodificado en lote ("revisar") ya no aplica: la
           -- acaba de confirmar alguien que estuvo ahí.
           observaciones        = null
     where id = existente.id
     returning * into resultado;

    return resultado;
  end if;

  insert into public.direcciones (
    cliente_id, direccion_formateada, codigo_postal, localidad, provincia,
    lat, lng, google_place_id, verificada, principal, etiqueta
  )
  values (
    p_cliente_id, trim(p_direccion_formateada),
    nullif(trim(coalesce(p_codigo_postal, '')), ''),
    p_localidad, p_provincia, p_lat, p_lng, p_google_place_id,
    true, true, 'Principal'
  )
  returning * into resultado;

  return resultado;
end;
$function$;

comment on function public.ubicar_cliente is
  'Ubica o corrige la direccion de un cliente. Si ya tenia una, la actualiza: manda el vendedor que esta en la puerta.';
