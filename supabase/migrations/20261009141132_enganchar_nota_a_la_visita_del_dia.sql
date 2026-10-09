-- Cuando se crea una nota SIN parada (p. ej. desde la pestaña "Notas de pedido",
-- de un cliente ya visitado hoy), se engancha sola a la parada de ese cliente en
-- el rol de visita de hoy, de ese vendedor. Queda como si se hubiera hecho desde
-- la parada: la info del cliente/servicio ya "carga" en el rol de visita.
--
-- Las notas hechas DESDE la parada ya traen `parada_id`, así que el trigger no
-- las toca. Si el cliente entra por varias sucursales, se prefiere la de la misma
-- dirección de la nota; si no, la de menor orden.
create or replace function interno.enganchar_nota_a_la_visita_del_dia()
returns trigger
language plpgsql
security definer
set search_path to public, pg_temp
as $$
begin
  if new.parada_id is null and new.cliente_id is not null and new.vendedor_id is not null then
    select p.id
      into new.parada_id
      from public.paradas p
      join public.roles_visita rv on rv.id = p.rol_visita_id
     where rv.vendedor_id = new.vendedor_id
       and rv.fecha = (now() at time zone 'America/Argentina/Buenos_Aires')::date
       and p.cliente_id = new.cliente_id
     order by (p.direccion_id is not distinct from new.direccion_id) desc, p.orden
     limit 1;
  end if;
  return new;
end;
$$;

drop trigger if exists enganchar_nota_a_la_visita_del_dia on public.notas_pedido;
create trigger enganchar_nota_a_la_visita_del_dia
  before insert on public.notas_pedido
  for each row execute function interno.enganchar_nota_a_la_visita_del_dia();
