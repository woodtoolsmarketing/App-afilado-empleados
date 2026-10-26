-- =============================================================================
-- "Entregué" automático en el rol de visita.
--
-- Hasta ahora el tilde ENTREGUÉ (notas_pedido.entregada_en, vía la RPC
-- marcar_nota_entregada) lo ponía el admin a mano. El usuario pidió que se ponga
-- SOLO: cuando una visita queda con "entregó" marcado —sea el vendedor desde el
-- móvil, el admin corrigiendo el parte, o una visita fuera de rol— las notas de
-- ESE cliente cuya `fecha_entrega` cae el día del rol se marcan entregadas solas.
--
-- Un trigger sobre `visitas` cubre los caminos de una sola vez: registrar_visita,
-- editar_parte_visita, registrar_visita_fuera_de_rol y unir_paradas_duplicadas
-- escriben todos la misma tabla. Va SECURITY DEFINER porque las notas a entregar
-- pueden ser de OTRO vendedor (la oficina las ve todas por RLS) y registrar_visita
-- corre como el vendedor, que por RLS no podría tocar notas ajenas.
--
-- Dispara SÓLO en la transición de "entregó" a verdadero (alta con entregó, o una
-- edición que lo prende). Así el tilde manual sigue mandando: destildar una nota
-- que no se entregó de verdad la deja en 'impresa', y un re-guardado del parte que
-- no cambia "entregó" NO la vuelve a marcar. Es aditiva (como marcar_cobro_de_visita):
-- bajar "entregó" no des-entrega notas; eso se corrige a mano con el tilde.
--
-- Sólo toca notas ya 'impresa' (la nota física existe). Respeta la sucursal igual
-- que el enganche del rol (`entregasDePedidoPorParada`): con una sola parada del
-- cliente marca todas las notas del día; con varias (varias sucursales) marca las
-- que NO están atadas a una sucursal (direccion_id null —el caso normal) y las de la
-- MISMA dirección de la parada visitada, pero deja afuera las atadas a OTRA sucursal
-- (así visitar la sucursal A no da por entregado lo que es puntualmente de la B).
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

  -- Con una sola parada: todas las notas del día del cliente. Con varias: las no
  -- atadas a sucursal (direccion_id null) y las de la dirección de ESTA parada; las
  -- atadas a otra sucursal quedan para cuando se visite esa.
  update public.notas_pedido n
     set estado = 'entregada',
         entregada_en = now(),
         actualizado_en = now()
   where n.cliente_id = v_cliente
     and n.fecha_entrega = v_fecha
     and n.estado = 'impresa'
     and (not v_varias or n.direccion_id is null or n.direccion_id = v_direccion);

  return new;
end;
$$;

comment on function interno.entregar_notas_de_la_visita() is
  'Al pasar "entregó" a verdadero en una visita, marca entregadas las notas de ese cliente con fecha_entrega = el día del rol (sólo las impresas; respeta la sucursal). Deja el tilde manual como corrección.';

drop trigger if exists entregar_notas_de_la_visita on public.visitas;
create trigger entregar_notas_de_la_visita
  after insert or update on public.visitas
  for each row execute function interno.entregar_notas_de_la_visita();
