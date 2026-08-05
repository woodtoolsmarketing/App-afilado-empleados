-- =============================================================================
-- WoodTools · Paso 2
-- Alta de cliente desde "GENERAR NUEVO CLIENTE"
--
-- Junta todo lo que Administración necesita para darlo de alta en el sistema,
-- así no tienen que llamar al vendedor para pedirle el CUIT o la dirección.
--
-- Se diferencia de `agregar_destino_cliente_nuevo` en que ésa además mete al
-- cliente en el recorrido del día; acá sólo se lo da de alta.
-- =============================================================================

create or replace function public.crear_cliente_provisorio(
  p_razon_social         text,
  p_documento            text default null,
  p_direccion_formateada text default null,
  p_codigo_postal        text default null,
  p_lat                  double precision default null,
  p_lng                  double precision default null,
  p_telefonos            text default null,
  p_email                text default null,
  p_nombre_fantasia      text default null,
  p_google_place_id      text default null,
  p_localidad            text default null,
  p_provincia            text default null
)
returns public.clientes
language plpgsql
security invoker
set search_path = public, pg_temp
as $fn$
declare
  nuevo public.clientes;
begin
  if length(trim(coalesce(p_razon_social, ''))) < 3 then
    raise exception 'Escribí el nombre y apellido o la razón social del cliente.'
      using errcode = '23514';
  end if;

  insert into public.clientes (
    codigo, razon_social, nombre_fantasia, cuit, telefono, email,
    vendedor_id, creado_por, provisorio, activo
  )
  values (
    'P-' || lpad(nextval('public.clientes_codigo_provisorio_seq')::text, 6, '0'),
    trim(p_razon_social),
    nullif(trim(coalesce(p_nombre_fantasia, '')), ''),
    -- El campo acepta DNI o CUIT: el CHECK de formato sólo matchea los CUIT,
    -- así que un DNI suelto se guarda sin guiones y pasa igual.
    nullif(trim(coalesce(p_documento, '')), ''),
    nullif(trim(coalesce(p_telefonos, '')), ''),
    nullif(trim(coalesce(p_email, '')), ''),
    auth.uid(), auth.uid(), true, true
  )
  returning * into nuevo;

  -- La dirección es opcional: sin coordenadas el cliente igual sirve para la
  -- nota de pedido, sólo no se lo puede meter en un recorrido.
  if coalesce(trim(p_direccion_formateada), '') <> '' and p_lat is not null then
    insert into public.direcciones (
      cliente_id, direccion_formateada, codigo_postal, localidad, provincia,
      lat, lng, google_place_id, verificada, principal, etiqueta
    )
    values (
      nuevo.id, trim(p_direccion_formateada),
      nullif(trim(coalesce(p_codigo_postal, '')), ''),
      p_localidad, p_provincia, p_lat, p_lng, p_google_place_id,
      p_google_place_id is not null, true, 'Taller'
    );
  end if;

  return nuevo;
end;
$fn$;

comment on function public.crear_cliente_provisorio is
  'Alta de cliente provisorio con su dirección. Lo usa "GENERAR NUEVO CLIENTE" de la nota de pedido.';
