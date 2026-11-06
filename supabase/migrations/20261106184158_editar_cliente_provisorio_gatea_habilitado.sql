-- =============================================================================
-- Endurecimiento de editar_cliente_provisorio / ficha_cliente_provisorio.
--
-- Dos agujeros detectados en la revisión de la migración anterior:
--
--   1) Ninguna de las dos (SECURITY DEFINER, saltean RLS) gateaba por
--      `interno.esta_habilitado()`. Un usuario autenticado pero NO aprobado
--      (pendiente / rechazado / suspendido / baja) con el JWT todavía vigente
--      (~1 h) podía leer y REESCRIBIR su propio provisorio. Es la misma fuga que
--      la migración 20260925170542 cerró en las funciones DEFINER de lectura; el
--      create (crear_cliente_provisorio) sí la tiene cubierta por la policy RLS
--      `clientes_crear_en_ruta`, pero estas dos, al ser DEFINER, no tenían el
--      respaldo. Se agrega el gate a las dos.
--
--   2) TOCTOU: el candado (provisorio/activo/creado_por) se evaluaba sobre un
--      SELECT sin bloqueo y el UPDATE filtraba sólo por id. Si entre medio la
--      oficina confirmaba el cliente, el UPDATE lo pisaba igual. Se agrega
--      `for update` al SELECT —mismo patrón que editar_cliente_con_permiso y
--      anular_nota_pedido— para que el re-chequeo corra sobre la fila ya tomada.
-- =============================================================================

create or replace function public.ficha_cliente_provisorio(p_cliente_id uuid)
returns table (
  razon_social          text,
  nombre_fantasia       text,
  documento             text,
  email                 text,
  telefono              text,
  contacto_nombre       text,
  direccion_fiscal      text,
  direccion_id          uuid,
  direccion_formateada  text,
  codigo_postal         text,
  localidad             text,
  provincia             text,
  lat                   double precision,
  lng                   double precision,
  google_place_id       text
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select
    c.razon_social,
    c.nombre_fantasia,
    coalesce(c.cuit, c.documento) as documento,
    c.email,
    c.telefono,
    c.contacto_nombre,
    c.direccion_fiscal,
    d.id,
    d.direccion_formateada,
    d.codigo_postal,
    d.localidad,
    d.provincia,
    d.lat,
    d.lng,
    d.google_place_id
  from public.clientes c
  left join lateral (
    select dd.*
    from public.direcciones dd
    where dd.cliente_id = c.id and dd.principal
    order by dd.creado_en
    limit 1
  ) d on true
  where c.id = p_cliente_id
    and c.provisorio
    and c.activo
    and c.creado_por = auth.uid()
    and interno.esta_habilitado();
$function$;


create or replace function public.editar_cliente_provisorio(
  p_cliente_id           uuid,
  p_razon_social         text,
  p_documento            text default null::text,
  p_direccion_formateada text default null::text,
  p_codigo_postal        text default null::text,
  p_lat                  double precision default null::double precision,
  p_lng                  double precision default null::double precision,
  p_telefonos            text default null::text,
  p_email                text default null::text,
  p_nombre_fantasia      text default null::text,
  p_google_place_id      text default null::text,
  p_localidad            text default null::text,
  p_provincia            text default null::text,
  p_contacto             text default null::text,
  p_direccion_fiscal     text default null::text
)
returns public.clientes
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  actual    public.clientes;
  dir_id    uuid;
  doc       text;
  solo_num  text;
  es_cuit   boolean;
begin
  -- `for update`: toma el candado sobre la fila para que el chequeo de abajo no
  -- corra sobre una foto vieja (TOCTOU). Si la oficina la confirma en paralelo,
  -- este SELECT espera y re-lee la fila ya confirmada -> el candado la frena.
  select * into actual from public.clientes where id = p_cliente_id for update;

  if not found then
    raise exception 'No encontramos el cliente.' using errcode = 'P0002';
  end if;

  -- Cuenta no aprobada (pendiente / rechazado / suspendido / baja): aunque el
  -- JWT siga vigente, no puede escribir. Mismo gate que el resto de las
  -- funciones DEFINER (ver 20260925170542).
  if not interno.esta_habilitado() then
    raise exception 'Tu cuenta no esta habilitada para editar clientes.'
      using errcode = '42501';
  end if;

  -- El candado: sólo mientras sigue provisorio y activo, y sólo quien lo cargó.
  if not actual.provisorio or not actual.activo then
    raise exception 'La oficina ya le puso el codigo a este cliente: sus datos ya no se editan desde la app.'
      using errcode = '42501';
  end if;

  if actual.creado_por is distinct from auth.uid() then
    raise exception 'Solo quien cargo el cliente puede editar sus datos.'
      using errcode = '42501';
  end if;

  if length(trim(coalesce(p_razon_social, ''))) < 3 then
    raise exception 'Escribi el nombre y apellido o la razon social del cliente.'
      using errcode = '23514';
  end if;

  doc      := nullif(trim(coalesce(p_documento, '')), '');
  solo_num := regexp_replace(coalesce(doc, ''), '[^0-9]', '', 'g');
  es_cuit  := length(solo_num) = 11;

  if doc is not null and not es_cuit and length(solo_num) not in (7, 8) then
    raise exception 'Un DNI tiene 7 u 8 digitos y un CUIT 11. Revisa el documento.'
      using errcode = '23514';
  end if;

  update public.clientes set
    razon_social     = trim(p_razon_social),
    nombre_fantasia  = nullif(trim(coalesce(p_nombre_fantasia, '')), ''),
    cuit             = case when es_cuit then doc else null end,
    documento        = case when es_cuit then null else doc end,
    telefono         = nullif(trim(coalesce(p_telefonos, '')), ''),
    email            = nullif(trim(coalesce(p_email, '')), ''),
    contacto_nombre  = nullif(trim(coalesce(p_contacto, '')), ''),
    direccion_fiscal = nullif(trim(coalesce(p_direccion_fiscal, '')), ''),
    actualizado_en   = now()
  where id = p_cliente_id
  returning * into actual;

  if coalesce(trim(p_direccion_formateada), '') <> '' and p_lat is not null then
    select dd.id into dir_id
    from public.direcciones dd
    where dd.cliente_id = p_cliente_id and dd.principal
    order by dd.creado_en
    limit 1;

    if dir_id is not null then
      update public.direcciones set
        direccion_formateada = trim(p_direccion_formateada),
        codigo_postal        = nullif(trim(coalesce(p_codigo_postal, '')), ''),
        localidad            = p_localidad,
        provincia            = p_provincia,
        lat                  = p_lat,
        lng                  = p_lng,
        google_place_id      = p_google_place_id,
        verificada           = p_google_place_id is not null
      where id = dir_id;
    else
      insert into public.direcciones (
        cliente_id, direccion_formateada, codigo_postal, localidad, provincia,
        lat, lng, google_place_id, verificada, principal, etiqueta
      )
      values (
        p_cliente_id, trim(p_direccion_formateada),
        nullif(trim(coalesce(p_codigo_postal, '')), ''),
        p_localidad, p_provincia, p_lat, p_lng, p_google_place_id,
        p_google_place_id is not null, true, 'Principal'
      );
    end if;
  end if;

  return actual;
end;
$function$;
