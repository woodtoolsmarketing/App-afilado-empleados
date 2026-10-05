-- =============================================================================
-- Alta de cliente nuevo unificada: condición IVA, dirección fiscal, contacto, y
-- (opcional) sumar la parada al recorrido en la misma transacción.
--
-- El alta de cliente nuevo se unifica en un solo formulario, que se usa tanto
-- desde la nota de pedido como desde "agregar al recorrido". Por eso
-- `crear_cliente_provisorio` ahora:
--   * guarda dos datos nuevos: `condicion_iva` y `direccion_fiscal`,
--   * recibe `contacto` (que antes sólo tenía el alta del recorrido),
--   * y si viene un `p_rol_visita_id`, suma la parada en la misma transacción
--     (reemplaza, desde la app nueva, a `agregar_destino_cliente_nuevo`).
--
-- Por qué DROP + CREATE y no CREATE OR REPLACE: sumar parámetros cambia la firma,
-- y CREATE OR REPLACE crearía una SEGUNDA función (sobrecarga). Con las dos
-- conviviendo, una llamada con los 12 argumentos viejos coincide con ambas y
-- Postgres la rechaza por ambigua, rompiendo a los teléfonos que todavía tienen
-- el bundle anterior. Dejando UNA sola función (la nueva, con defaults), esa
-- misma llamada de 12 argumentos resuelve a la nueva y sigue andando: sin
-- ventana de rotura para la flota.
-- =============================================================================

alter table public.clientes
  add column if not exists condicion_iva text,
  add column if not exists direccion_fiscal text;

comment on column public.clientes.condicion_iva is
  'Condición frente al IVA: responsable_inscripto | monotributo | exento | consumidor_final. Null en el padrón viejo.';
comment on column public.clientes.direccion_fiscal is
  'Domicilio fiscal (texto libre, para la factura). Distinto de la dirección de entrega, que vive en `direcciones` con coordenadas.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'clientes_condicion_iva_chk') then
    alter table public.clientes
      add constraint clientes_condicion_iva_chk
      check (condicion_iva is null or condicion_iva in
        ('responsable_inscripto', 'monotributo', 'exento', 'consumidor_final'));
  end if;
end $$;

drop function if exists public.crear_cliente_provisorio(
  text, text, text, text, double precision, double precision,
  text, text, text, text, text, text
);

create function public.crear_cliente_provisorio(
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
  p_provincia text default null::text,
  p_contacto text default null::text,
  p_condicion_iva text default null::text,
  p_direccion_fiscal text default null::text,
  p_rol_visita_id uuid default null::uuid,
  p_prioridad prioridad_parada default null::prioridad_parada
)
returns clientes
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  nuevo     public.clientes;
  dir       public.direcciones;
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
  -- Once digitos es un CUIT; siete u ocho, un DNI.
  es_cuit  := length(solo_num) = 11;

  if doc is not null and not es_cuit and length(solo_num) not in (7, 8) then
    raise exception 'Un DNI tiene 7 u 8 digitos y un CUIT 11. Revisa el documento.'
      using errcode = '23514';
  end if;

  if p_condicion_iva is not null and p_condicion_iva not in
       ('responsable_inscripto', 'monotributo', 'exento', 'consumidor_final') then
    raise exception 'Condicion frente al IVA invalida.' using errcode = '23514';
  end if;

  insert into public.clientes (
    codigo, razon_social, nombre_fantasia, cuit, documento, telefono, email,
    contacto_nombre, condicion_iva, direccion_fiscal,
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
    nullif(trim(coalesce(p_contacto, '')), ''),
    p_condicion_iva,
    nullif(trim(coalesce(p_direccion_fiscal, '')), ''),
    auth.uid(), auth.uid(), true, true
  )
  returning * into nuevo;

  -- La direccion de ENTREGA (con coordenadas) vive en `direcciones`. Es opcional
  -- para una nota, pero obligatoria si el cliente va a entrar a un recorrido.
  if coalesce(trim(p_direccion_formateada), '') <> '' and p_lat is not null then
    insert into public.direcciones (
      cliente_id, direccion_formateada, codigo_postal, localidad, provincia,
      lat, lng, google_place_id, verificada, principal, etiqueta
    )
    values (
      nuevo.id, trim(p_direccion_formateada),
      nullif(trim(coalesce(p_codigo_postal, '')), ''),
      p_localidad, p_provincia, p_lat, p_lng, p_google_place_id,
      p_google_place_id is not null, true, 'Principal'
    )
    returning * into dir;
  end if;

  -- Si viene un rol de visita, el alta tambien suma la parada: es el camino de
  -- "agregar al recorrido" un cliente nuevo, en una sola transaccion.
  if p_rol_visita_id is not null then
    if dir.id is null then
      raise exception 'Para sumarlo al recorrido falta la ubicacion del cliente.'
        using errcode = '23514';
    end if;
    perform public.agregar_parada(
      p_rol_visita_id, dir.id, coalesce(p_prioridad, 'baja'::prioridad_parada), nuevo.id
    );
  end if;

  return nuevo;
end;
$function$;

grant execute on function public.crear_cliente_provisorio(
  text, text, text, text, double precision, double precision,
  text, text, text, text, text, text, text, text, text, uuid, prioridad_parada
) to authenticated;
