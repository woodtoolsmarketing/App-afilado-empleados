-- Suma UN cliente a la lista semanal del vendedor, sin tocar el resto.
--
-- Por qué un RPC dedicado y no reusar guardar_lista_semanal desde la app:
-- guardar_lista_semanal reemplaza el día entero (delete + insert). Para
-- agregar uno, la app tendría que leer la lista, agregarle el cliente y
-- reescribirla; pero lista_semanal_de hace un INNER JOIN a clientes bajo su
-- RLS, así que un cliente que la oficina desactivó y que el vendedor todavía
-- no visitó (sin parada propia) no aparece en esa lectura. Reescribir el día
-- entonces lo borraría en silencio. Insertar UNA fila no toca a las demás:
-- no depende de que el resto de la lista sea visible.

create or replace function public.agregar_a_lista_semanal(
  p_dia_semana smallint,
  p_cliente_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path to 'public', 'pg_temp'
as $fn$
declare
  quien uuid := auth.uid();
  filas int;
begin
  if quien is null then
    raise exception 'No hay sesion' using errcode = '42501';
  end if;
  if p_dia_semana is null or p_dia_semana < 1 or p_dia_semana > 7 then
    raise exception 'Dia de la semana invalido.' using errcode = '23514';
  end if;

  insert into public.lista_visitas_vendedor (vendedor_id, cliente_id, dia_semana, orden)
  values (
    quien,
    p_cliente_id,
    p_dia_semana,
    coalesce(
      (select max(orden)
         from public.lista_visitas_vendedor
        where vendedor_id = quien and dia_semana = p_dia_semana),
      0
    ) + 1
  )
  on conflict (vendedor_id, cliente_id, dia_semana) do nothing;

  get diagnostics filas = row_count;
  return filas > 0; -- true = se agrego, false = ya estaba
end;
$fn$;

comment on function public.agregar_a_lista_semanal is
  'Suma un cliente a la lista semanal del vendedor para un dia ISO (1 lunes .. 7 domingo), sin tocar el resto. Devuelve true si lo agrego, false si ya estaba.';

grant execute on function public.agregar_a_lista_semanal(smallint, uuid) to authenticated;
