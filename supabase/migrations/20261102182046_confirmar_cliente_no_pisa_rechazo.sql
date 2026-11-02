-- Confirmar un cliente no debe poder convivir con un rechazo.
--
-- confirmar_cliente_provisorio filtraba sólo por provisorio=true, sin exigir
-- activo=true (asimetría con rechazar_cliente_provisorio, que sí lo exige) y sin
-- limpiar los sellos de rechazo. Con la marca confirmado_en nueva, un cliente
-- rechazado y luego reactivado + confirmado quedaba con confirmado_en Y
-- rechazado_en a la vez, apareciendo en las dos pestañas del historial. Ahora:
-- sólo se confirma un provisorio ACTIVO, y confirmar limpia el rechazo (la
-- confirmación lo revierte).

create or replace function public.confirmar_cliente_provisorio(p_cliente_id uuid, p_codigo text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_cod text := upper(btrim(coalesce(p_codigo, '')));
begin
  if not interno.es_administracion() then
    raise exception 'Sólo administración o un administrador puede confirmar clientes.' using errcode = '42501';
  end if;
  if v_cod = '' then
    raise exception 'Escribí el código de cliente definitivo.' using errcode = '23514';
  end if;
  if v_cod like 'P-%' then
    raise exception 'Ese es el código provisorio. Poné el código definitivo (sin "P-").' using errcode = '23514';
  end if;

  update public.clientes
     set codigo = v_cod, provisorio = false, habilitado = true,
         confirmado_en = now(), confirmado_por = auth.uid(),
         rechazado_en = null, motivo_rechazo = null, rechazado_por = null
   where id = p_cliente_id and provisorio = true and activo = true;

  if not found then
    raise exception 'Ese cliente no existe, ya estaba confirmado o no está activo.' using errcode = 'P0002';
  end if;
exception
  when unique_violation then
    raise exception 'Ya existe un cliente con ese código.' using errcode = '23505';
end;
$function$;
