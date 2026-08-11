-- =============================================================================
-- Ubicar en el mapa a un cliente que ya está en el padrón
--
-- Los 12.181 clientes que se importaron del Gestión traen el domicilio en
-- texto, sin coordenadas. `paradas.direccion_id` es NOT NULL contra
-- `direcciones`, así que ninguno de ellos podía entrar a un recorrido: el
-- vendedor los encontraba en el buscador y ahí se terminaba.
--
-- Esta función cierra ese hueco desde la calle. El vendedor elige el cliente,
-- confirma la dirección contra las sugerencias de Google y queda geolocalizado
-- para siempre — no sólo para la visita de hoy.
--
-- Corre como invocador, no como definidor: la política `direcciones_crear` ya
-- exige `interno.esta_habilitado()`, y esa es exactamente la condición que se
-- quiere. No hay razón para saltear RLS acá.
--
-- Si el cliente YA tiene una dirección, devuelve la que hay en vez de sumar
-- otra. Ubicar es una operación de completar un dato faltante, no de corregir
-- uno cargado: pisar la dirección buena de un cliente desde el teléfono, sin
-- que la oficina se entere, sería una forma silenciosa de romper el reparto.
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
  nueva     public.direcciones;
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
    return existente;
  end if;

  insert into public.direcciones (
    cliente_id, direccion_formateada, codigo_postal, localidad, provincia,
    lat, lng, google_place_id, verificada, principal, etiqueta
  )
  values (
    p_cliente_id, trim(p_direccion_formateada),
    nullif(trim(coalesce(p_codigo_postal, '')), ''),
    p_localidad, p_provincia, p_lat, p_lng, p_google_place_id,
    p_google_place_id is not null, true, 'Principal'
  )
  returning * into nueva;

  return nueva;
end;
$function$;

comment on function public.ubicar_cliente is
  'Geolocaliza un cliente del padron que solo tiene domicilio en texto. Idempotente: si ya tiene direccion, devuelve esa.';
