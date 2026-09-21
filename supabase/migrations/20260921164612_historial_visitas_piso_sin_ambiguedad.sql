-- historial_visitas fallaba con "column reference "piso" is ambiguous": la
-- variable plpgsql `piso` choca con la columna `direcciones.piso` (que la
-- función joinea para la dirección). Con plpgsql.variable_conflict = error (el
-- default), `where rv.fecha >= piso` no compila y la pantalla "HISTORIAL DE
-- VISITAS" nunca cargaba. Se renombra la variable a `piso_fecha`.

create or replace function public.historial_visitas(
  p_desde       date default null,
  p_hasta       date default null,
  p_vendedor_id uuid default null
)
returns table (
  fecha            date,
  rol_visita_id    uuid,
  vendedor_id      uuid,
  vendedor         text,
  total_paradas    bigint,
  visitadas        bigint,
  no_visitadas     bigint,
  detalle          jsonb
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  retencion  int;
  piso_fecha date;
  objetivo   uuid;
begin
  select coalesce((valor)::int, 90) into retencion
    from public.configuracion where clave = 'retencion_historial_dias';

  -- Los vendedores sólo pueden mirar hacia atrás hasta el límite de retención.
  piso_fecha := case when interno.puede_ver_todo()
               then coalesce(p_desde, current_date - retencion)
               else greatest(coalesce(p_desde, current_date - retencion), current_date - retencion)
          end;

  objetivo := case when interno.puede_ver_todo()
                   then coalesce(p_vendedor_id, auth.uid())
                   else auth.uid()
              end;

  return query
  select
    rv.fecha,
    rv.id,
    rv.vendedor_id,
    pf.nombre_completo,
    count(pa.id),
    count(pa.id) filter (where pa.estado = 'visitada'),
    count(pa.id) filter (where pa.estado = 'no_visitada'),
    jsonb_agg(
      jsonb_build_object(
        'parada_id',    pa.id,
        'nro',          pa.orden,
        'cliente',      coalesce(c.razon_social, pa.razon_social_snapshot, 'Destino sin cliente'),
        'cliente_nro',  c.codigo,
        'direccion',    coalesce(d.direccion_formateada, pa.direccion_snapshot),
        'estado',       pa.estado,
        'hora',         pa.llegada_en,
        'visitado',     v.visitado,
        'vendio',       v.vendio,
        'cobro',        v.cobro,
        'retiro_afilado', v.retiro_afilado,
        'entrego',      v.entrego,
        'motivo',       v.motivo_no_visita,
        'contacto',     coalesce(v.contacto_nombre, c.contacto_nombre),
        'observacion',  v.observacion
      ) order by pa.orden
    )
  from public.roles_visita rv
  join public.perfiles pf     on pf.id = rv.vendedor_id
  left join public.paradas pa on pa.rol_visita_id = rv.id
  left join public.direcciones d on d.id = pa.direccion_id
  left join public.clientes c on c.id = pa.cliente_id
  left join public.visitas v  on v.parada_id = pa.id
  where rv.vendedor_id = objetivo
    and rv.fecha >= piso_fecha
    and rv.fecha <= coalesce(p_hasta, current_date)
  group by rv.id, rv.fecha, rv.vendedor_id, pf.nombre_completo
  order by rv.fecha desc;
end;
$$;

comment on function public.historial_visitas is
  'Historial agrupado por día para la pantalla "HISTORIAL DE VISITAS". A los vendedores se les recorta el rango a la retención vigente (90 días).';
