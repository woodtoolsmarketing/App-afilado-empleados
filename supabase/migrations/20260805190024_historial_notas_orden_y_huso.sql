-- =============================================================================
-- WoodTools · Paso 2
-- Historial de notas de pedido: orden de calendario y agrupamiento por día local
--
-- Dos cambios sobre `historial_notas_pedido`:
--
-- 1. ORDEN. Los días salían del más nuevo al más viejo. El mockup del cliente
--    los muestra en orden de calendario (lunes, martes, miércoles…), y las
--    notas dentro de cada día siguen la misma dirección: así los números de
--    nota quedan ascendentes, como en el talonario de papel.
--
-- 2. HUSO. `creado_en::date` sobre un timestamptz usa el huso de la sesión, y
--    el servidor está en UTC. Argentina es UTC-3, así que una nota cargada a
--    las 21:30 caía en el día SIGUIENTE: el vendedor la buscaba en el día que
--    la hizo y no estaba. Ahora el día se calcula en hora de Buenos Aires, que
--    es la única que le importa a quien la cargó.
--
-- El historial de visitas no tiene este problema: agrupa por `roles_visita.fecha`,
-- que ya es un `date` de la jornada y no un timestamp.
-- =============================================================================

create or replace function public.historial_notas_pedido(
  p_desde date default null,
  p_hasta date default null
)
returns table (fecha date, cantidad bigint, detalle jsonb)
language plpgsql security invoker
set search_path = public, pg_temp
as $fn$
declare
  retencion int;
  piso date;
  hoy   date;
begin
  select coalesce((valor)::int, 90) into retencion
    from public.configuracion where clave = 'retencion_historial_dias';
  retencion := coalesce(retencion, 90);

  -- El "hoy" del vendedor, no el del servidor.
  hoy := (now() at time zone 'America/Argentina/Buenos_Aires')::date;

  piso := case when interno.puede_ver_todo()
               then coalesce(p_desde, hoy - retencion)
               else greatest(coalesce(p_desde, hoy - retencion), hoy - retencion)
          end;

  return query
  select
    (n.creado_en at time zone 'America/Argentina/Buenos_Aires')::date,
    count(*),
    jsonb_agg(
      jsonb_build_object(
        'nota_id',        n.id,
        'numero',         n.numero,
        'tipo_nota',      n.tipo_nota,
        'estado',         n.estado,
        'cliente_codigo', n.cliente_codigo,
        'cliente_nombre', n.cliente_nombre,
        'hora',           n.creado_en,
        'total',          n.total,
        'servicios',      n.servicios
      ) order by n.creado_en
    )
  from public.notas_pedido n
  where (interno.puede_ver_todo() or n.vendedor_id = auth.uid())
    and (n.creado_en at time zone 'America/Argentina/Buenos_Aires')::date >= piso
    and (n.creado_en at time zone 'America/Argentina/Buenos_Aires')::date <= coalesce(p_hasta, hoy)
  group by (n.creado_en at time zone 'America/Argentina/Buenos_Aires')::date
  order by (n.creado_en at time zone 'America/Argentina/Buenos_Aires')::date;
end;
$fn$;

comment on function public.historial_notas_pedido is
  'Historial agrupado por día (hora de Buenos Aires) para "HISTORIAL DE NOTAS DE PEDIDO", en orden de calendario.';
