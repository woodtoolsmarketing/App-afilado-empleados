-- Las ubicaciones nuevas que cargan los vendedores también se ven en el panel.
--
-- Hasta ahora, cuando un vendedor ubicaba por primera vez un cliente que estaba
-- sin mapa (`ubicar_cliente`), la dirección se guardaba DIRECTO en `direcciones`
-- y no quedaba rastro en el panel: la oficina no se enteraba de que ese cliente
-- recién se ubicó. (Las CORRECCIONES de clientes ya ubicados sí aparecen: entran
-- como propuesta pendiente a "Cambios de dirección".)
--
-- Ahora cada ubicación cargada por un vendedor deja un registro informativo en
-- `cambios_direccion`, marcado con `es_ubicacion_nueva`, con el vendedor que la
-- cargó y el estado 'aplicado' (ya quedó firme: no hay que aprobar nada). El
-- panel lo muestra como aviso aparte de las correcciones a revisar.
--
-- El registro es BEST-EFFORT: si por lo que sea no se puede dejar el aviso, la
-- ubicación IGUAL se guarda. Ubicar un cliente —que es lo que destraba el
-- recorrido— no puede fallar por no poder avisarle a la oficina.

alter table public.cambios_direccion
  add column if not exists es_ubicacion_nueva boolean not null default false;

comment on column public.cambios_direccion.es_ubicacion_nueva is
  'true = no es una corrección a revisar, es una ubicación nueva que el vendedor '
  'ya dejó cargada (ubicar_cliente). El panel la muestra como aviso, no para aprobar.';

create or replace function public.ubicar_cliente(
  p_cliente_id uuid,
  p_direccion_formateada text,
  p_lat double precision,
  p_lng double precision,
  p_codigo_postal text default null,
  p_google_place_id text default null,
  p_localidad text default null,
  p_provincia text default null
)
returns direcciones
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
           observaciones        = null
     where id = existente.id
     returning * into resultado;
  else
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
  end if;

  if resultado.id is null then
    raise exception 'No pudimos guardar la ubicacion del cliente.'
      using errcode = '42501',
            hint = 'Revisa las policies de public.direcciones.';
  end if;

  -- El aviso para el panel: queda registrado quién ubicó este cliente y cuándo.
  -- Best-effort: si falla, la ubicación igual queda guardada.
  begin
    insert into public.cambios_direccion (
      cliente_id, direccion_id, direccion_propuesta, lat_propuesta, lng_propuesta,
      vendedor_id, estado, resuelto_en, resuelto_por, es_ubicacion_nueva, motivo
    )
    values (
      p_cliente_id, resultado.id, resultado.direccion_formateada, resultado.lat, resultado.lng,
      auth.uid(), 'aplicado', now(), auth.uid(), true, 'Ubicación cargada desde la calle'
    );
  exception when others then
    null;
  end;

  return resultado;
end;
$function$;
