-- El historial del telefono muestra solo las notas del usuario logueado, igual
-- que las listas de pendientes/impresas y que cobranzas. Antes, con
-- puede_ver_todo(), un admin/supervisor veia el historial de TODOS. El panel de
-- la oficina no usa esta RPC (tiene sus propias vistas), asi que no lo afecta.
create or replace function public.historial_notas_pedido(p_desde date default null::date, p_hasta date default null::date)
 returns table(fecha date, cantidad bigint, detalle jsonb)
 language plpgsql
 set search_path to 'public', 'pg_temp'
as $function$
declare
  retencion int;
  piso date;
  hoy   date;
begin
  select coalesce((valor)::int, 90) into retencion
    from public.configuracion where clave = 'retencion_historial_dias';
  retencion := coalesce(retencion, 90);

  hoy := (now() at time zone 'America/Argentina/Buenos_Aires')::date;

  piso := greatest(coalesce(p_desde, hoy - retencion), hoy - retencion);

  return query
  select
    (n.creado_en at time zone 'America/Argentina/Buenos_Aires')::date,
    count(*),
    jsonb_agg(
      jsonb_build_object(
        'nota_id',         n.id,
        'numero',          n.numero,
        'vendedor_numero', n.vendedor_numero,
        'tipo_nota',       n.tipo_nota,
        'estado',          n.estado,
        'cliente_codigo',  n.cliente_codigo,
        'cliente_nombre',  n.cliente_nombre,
        'hora',            n.creado_en,
        'total',           n.total,
        'servicios',       n.servicios
      ) order by n.creado_en
    )
  from public.notas_pedido n
  where n.vendedor_id = auth.uid()
    and (n.creado_en at time zone 'America/Argentina/Buenos_Aires')::date >= piso
    and (n.creado_en at time zone 'America/Argentina/Buenos_Aires')::date <= coalesce(p_hasta, hoy)
  group by (n.creado_en at time zone 'America/Argentina/Buenos_Aires')::date
  order by (n.creado_en at time zone 'America/Argentina/Buenos_Aires')::date;
end;
$function$;
