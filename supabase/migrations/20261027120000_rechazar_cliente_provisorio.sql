-- Rechazar un cliente provisorio desde "Clientes a confirmar" del panel.
--
-- Hasta ahora la oficina sólo podía CONFIRMAR un cliente que cargó un vendedor
-- desde la calle. Faltaba poder RECHAZARLO cuando los datos están mal o el
-- cliente ya existía: antes no había forma y quedaban en la cola para siempre.
--
-- Rechazar lo saca de la cola (activo=false) y guarda el motivo para auditoría;
-- NO lo da de alta y NO lo borra (queda la fila con el motivo). Mismo patrón que
-- confirmar_cliente_provisorio: SECURITY DEFINER + gate es_administracion(), así
-- administración puede sin abrirle la escritura de toda la tabla clientes.

alter table public.clientes
  add column if not exists motivo_rechazo text,
  add column if not exists rechazado_en  timestamptz,
  add column if not exists rechazado_por uuid;

create or replace function public.rechazar_cliente_provisorio(
  p_cliente_id uuid,
  p_motivo text,
  p_detalle text default null
) returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_etiqueta text;
  v_detalle text := nullif(btrim(coalesce(p_detalle, '')), '');
begin
  if not interno.es_administracion() then
    raise exception 'Sólo administración o un administrador puede rechazar clientes.' using errcode = '42501';
  end if;

  -- El motivo es un catálogo cerrado: la etiqueta la pone la base, no el panel.
  v_etiqueta := case p_motivo
    when 'datos_erroneos'    then 'Datos erróneos'
    when 'cliente_ya_existe' then 'El cliente ya existe'
    else null
  end;
  if v_etiqueta is null then
    raise exception 'Elegí un motivo de rechazo.' using errcode = '23514';
  end if;

  update public.clientes
     set activo         = false,
         motivo_rechazo = v_etiqueta || coalesce(' — ' || v_detalle, ''),
         rechazado_en   = now(),
         rechazado_por  = auth.uid()
   where id = p_cliente_id and provisorio = true and activo = true;

  if not found then
    raise exception 'Ese cliente no existe, ya fue confirmado o ya estaba rechazado.' using errcode = 'P0002';
  end if;
end;
$function$;
