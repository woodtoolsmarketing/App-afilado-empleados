-- =============================================================================
-- "Entregué" con memoria: las notas pendientes se arrastran hasta entregarse.
--
-- Antes el trigger marcaba entregadas sólo las notas con `fecha_entrega` = el día
-- del rol. El usuario pidió una "memoria hasta entregar": una nota con fecha de
-- entrega pasada que todavía no se entregó se sigue mostrando en el rol (pendiente)
-- y, cuando el vendedor marca "entregó", se marca entregada igual aunque su fecha
-- sea de días antes. Por eso el filtro pasa de `= v_fecha` a `<= v_fecha` (ese día
-- o antes). El resto no cambia: sólo las 'impresa', sólo la transición a "entregó",
-- y respeta la sucursal cuando el cliente entra por varias paradas.
--
-- Seguro para el backlog: antes de este cambio se marcaron entregadas a mano las
-- notas 'impresa' con fecha_entrega anterior al 26/10/2026 (cuando arrancó el tilde
-- automático), que estaban entregadas en la realidad pero sin marcar. Así el `<=`
-- no re-abre un arrastre falso de notas viejas que ya estaban entregadas.
-- =============================================================================

create or replace function interno.entregar_notas_de_la_visita()
returns trigger
language plpgsql
security definer
set search_path to public, pg_temp
as $$
declare
  v_cliente   uuid;
  v_direccion uuid;
  v_rol       uuid;
  v_fecha     date;
  v_varias    boolean;
begin
  -- `entrego` es not null; con "entregó" en falso no hay nada que marcar.
  if not new.entrego then
    return new;
  end if;
  -- Sólo la transición a "entregó": si ya estaba marcado, no es una entrega nueva
  -- y no se re-marca (así no se pisa un destildado manual al re-guardar el parte).
  if tg_op = 'UPDATE' and old.entrego then
    return new;
  end if;

  select pa.cliente_id, pa.direccion_id, pa.rol_visita_id, rv.fecha
    into v_cliente, v_direccion, v_rol, v_fecha
    from public.paradas pa
    join public.roles_visita rv on rv.id = pa.rol_visita_id
   where pa.id = new.parada_id;

  if v_cliente is null or v_fecha is null then
    return new;
  end if;

  -- ¿El cliente entra por varias sucursales (paradas) en este rol?
  select count(*) > 1
    into v_varias
    from public.paradas
   where rol_visita_id = v_rol
     and cliente_id = v_cliente;

  -- Marca las notas PENDIENTES (impresa) del cliente con fecha de entrega ese día
  -- o ANTES (las que se venían arrastrando en el rol hasta hoy, no sólo las de hoy).
  -- Con una sola parada: todas. Con varias sucursales: las no atadas a sucursal
  -- (direccion_id null) y las de la dirección de ESTA parada; las de otra sucursal
  -- quedan para cuando se visite esa.
  update public.notas_pedido n
     set estado = 'entregada',
         entregada_en = now(),
         actualizado_en = now()
   where n.cliente_id = v_cliente
     and n.fecha_entrega <= v_fecha
     and n.estado = 'impresa'
     and (not v_varias or n.direccion_id is null or n.direccion_id = v_direccion);

  return new;
end;
$$;

comment on function interno.entregar_notas_de_la_visita() is
  'Al pasar "entregó" a verdadero en una visita, marca entregadas las notas pendientes (impresa) de ese cliente con fecha_entrega <= el día del rol (se arrastran hasta entregarse; respeta la sucursal). Deja el tilde manual como corrección.';
