-- Cola de impresión (Fase 2): reclamar una orden puntual + re-encolar fallidas.
--
-- Surgieron de la revisión del agente automático:
--  · reclamar_orden_impresion: el botón manual de la oficina reclama ATÓMICO la
--    orden que tocó (pendiente → imprimiendo), igual que tomar_siguiente_orden
--    pero por id. Si el agente (u otra PC) ya la agarró, vuelve vacío y no se
--    imprime → no salen dos juegos del mismo papel.
--  · reencolar_orden_impresion: una orden 'fallida' (o 'cancelada') vuelve a
--    'pendiente'. Así una fallida NO se pierde: se ve en el panel y se reintenta.

create or replace function public.reclamar_orden_impresion(p_orden_id uuid)
returns setof public.ordenes_impresion
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if not interno.puede_ver_todo() then
    raise exception 'Solo la oficina toma ordenes de impresion' using errcode = '42501';
  end if;

  return query
  update public.ordenes_impresion o
     set estado = 'imprimiendo', tomada_en = now()
   where o.id = p_orden_id and o.estado = 'pendiente'
  returning o.*;
end;
$$;

create or replace function public.reencolar_orden_impresion(p_orden_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if not interno.puede_ver_todo() then
    raise exception 'Solo la oficina reencola ordenes de impresion' using errcode = '42501';
  end if;

  update public.ordenes_impresion
     set estado = 'pendiente', motivo_fallo = null, tomada_en = null, resuelta_en = null
   where id = p_orden_id and estado in ('fallida', 'cancelada');
end;
$$;

revoke all on function public.reclamar_orden_impresion(uuid) from public, anon;
grant execute on function public.reclamar_orden_impresion(uuid) to authenticated;

revoke all on function public.reencolar_orden_impresion(uuid) from public, anon;
grant execute on function public.reencolar_orden_impresion(uuid) to authenticated;
