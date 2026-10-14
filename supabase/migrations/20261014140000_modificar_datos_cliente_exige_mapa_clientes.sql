-- modificar_datos_cliente (el "MODIFICAR DATOS" del mapa del telefono) chequeaba
-- solo esta_habilitado(): CUALQUIER usuario habilitado podia cambiar razon
-- social, nombre de fantasia y la direccion principal de cualquier cliente
-- llamando la RPC directo, por fuera del gate de la pantalla —y salteando el
-- flujo de "Permitir editar" de administracion para esos campos—.
--
-- Ahora exige, del lado del servidor, el MISMO permiso que la UI: la seccion
-- "Mapa (todos los clientes)" (clave mapa_clientes) habilitada para el rol. admin
-- siempre; el resto, segun lo que la oficina configuro en "Permisos" (hoy:
-- vendedor). Sigue siendo configurable; lo que se cierra es el atajo por RPC.

create or replace function public.modificar_datos_cliente(
  p_cliente_id      uuid,
  p_razon_social    text,
  p_nombre_fantasia text default null,
  p_direccion       text default null
)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_direccion_id uuid;
begin
  if not interno.esta_habilitado() then
    raise exception 'Tu cuenta no está habilitada.' using errcode = '42501';
  end if;

  if not (
    interno.es_admin()
    or exists (
      select 1 from public.funciones f
      where f.clave = 'mapa_clientes' and f.ambito = 'app'
        and (select rol from public.perfiles where id = auth.uid()) = any (f.roles_habilitados)
    )
  ) then
    raise exception 'No tenes permiso para modificar los datos del cliente.' using errcode = '42501';
  end if;

  if length(trim(coalesce(p_razon_social, ''))) < 3 then
    raise exception 'Escribí el nombre o la razón social del cliente.' using errcode = '23514';
  end if;

  update public.clientes
     set razon_social    = trim(p_razon_social),
         nombre_fantasia = nullif(trim(coalesce(p_nombre_fantasia, '')), '')
   where id = p_cliente_id;

  if not found then
    raise exception 'No encontramos ese cliente.' using errcode = 'P0002';
  end if;

  if coalesce(trim(p_direccion), '') <> '' then
    select id into v_direccion_id
      from public.direcciones
     where cliente_id = p_cliente_id
     order by principal desc, creado_en
     limit 1;

    if v_direccion_id is not null then
      update public.direcciones
         set direccion_formateada = trim(p_direccion)
       where id = v_direccion_id;
    end if;
  end if;
end;
$fn$;
