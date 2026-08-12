-- =============================================================================
-- El DNI deja de intentar entrar por la puerta del CUIT
--
-- "GENERAR NUEVO CLIENTE" pide un campo rotulado "DNI O CUIT", obligatorio, y
-- el validador acepta 7, 8 u 11 dígitos. Pero `crear_cliente_provisorio`
-- metía lo que fuera en `clientes.cuit`, y esa columna tiene el CHECK
-- `clientes_cuit_formato` que sólo admite 11 dígitos.
--
-- Resultado: un tallerista que factura con DNI no se podía cargar. El vendedor
-- llenaba todo, tocaba GENERAR, y le salía el texto crudo de Postgres —"new row
-- violates check constraint clientes_cuit_formato"— sin ningún campo marcado y
-- sin forma de seguir, con el cliente esperando adelante.
--
-- El comentario que había en la función afirmaba lo contrario: que "el CHECK
-- sólo aplica a los CUIT, así que un DNI suelto pasa igual". No pasa.
--
-- La salida NO es aflojar el CHECK. `cuit` es un dato fiscal y meterle un DNI
-- adentro es una mentira que después paga Administración cuando factura. El DNI
-- tiene ahora su propia columna, y la función manda cada cosa a donde va.
-- =============================================================================

alter table public.clientes
  add column if not exists documento text;

comment on column public.clientes.documento is
  'DNI del cliente cuando no tiene CUIT. El CUIT vive en `cuit`, con su CHECK de formato.';

create index if not exists clientes_documento_idx
  on public.clientes (documento) where documento is not null;

create or replace function public.crear_cliente_provisorio(
  p_razon_social text,
  p_documento text default null::text,
  p_direccion_formateada text default null::text,
  p_codigo_postal text default null::text,
  p_lat double precision default null::double precision,
  p_lng double precision default null::double precision,
  p_telefonos text default null::text,
  p_email text default null::text,
  p_nombre_fantasia text default null::text,
  p_google_place_id text default null::text,
  p_localidad text default null::text,
  p_provincia text default null::text
)
returns clientes
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  nuevo     public.clientes;
  doc       text;
  solo_num  text;
  es_cuit   boolean;
begin
  if length(trim(coalesce(p_razon_social, ''))) < 3 then
    raise exception 'Escribi el nombre y apellido o la razon social del cliente.'
      using errcode = '23514';
  end if;

  doc      := nullif(trim(coalesce(p_documento, '')), '');
  solo_num := regexp_replace(coalesce(doc, ''), '[^0-9]', '', 'g');
  -- Once digitos es un CUIT; siete u ocho, un DNI. Cualquier otra cosa la
  -- rechaza el validador del formulario antes de llegar hasta aca.
  es_cuit  := length(solo_num) = 11;

  if doc is not null and not es_cuit and length(solo_num) not in (7, 8) then
    raise exception 'Un DNI tiene 7 u 8 digitos y un CUIT 11. Revisa el documento.'
      using errcode = '23514';
  end if;

  insert into public.clientes (
    codigo, razon_social, nombre_fantasia, cuit, documento, telefono, email,
    vendedor_id, creado_por, provisorio, activo
  )
  values (
    'P-' || lpad(nextval('public.clientes_codigo_provisorio_seq')::text, 6, '0'),
    trim(p_razon_social),
    nullif(trim(coalesce(p_nombre_fantasia, '')), ''),
    case when es_cuit then doc else null end,
    case when es_cuit then null else doc end,
    nullif(trim(coalesce(p_telefonos, '')), ''),
    nullif(trim(coalesce(p_email, '')), ''),
    auth.uid(), auth.uid(), true, true
  )
  returning * into nuevo;

  -- La direccion es opcional: sin coordenadas el cliente igual sirve para la
  -- nota de pedido, solo no se lo puede meter en un recorrido.
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
$function$;
