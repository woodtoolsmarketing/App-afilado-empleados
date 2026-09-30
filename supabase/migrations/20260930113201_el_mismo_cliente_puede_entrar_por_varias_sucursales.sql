/*
 * Un cliente con varias sucursales puede entrar al recorrido varias veces.
 *
 * ─── El problema, dicho por el vendedor ──────────────────────────────────────
 *
 * "Tengo que ir a MMLC La Viruta y tengo que ir a las tres sucursales. Y está
 *  codificado con un solo código. No sé si se puede ir agregando así
 *  individualmente, o cómo tendría que hacer."
 *
 * Hay clientes que en el sistema son UN código pero en la calle son varios
 * locales. El vendedor tiene que pasar por los tres, y hasta ahora la app se lo
 * impedía: el índice `paradas_un_cliente_por_jornada` era único sobre
 * (rol_visita_id, cliente_id) para las paradas abiertas, así que el segundo
 * intento chocaba con "Ese cliente ya está esperando en tu recorrido de hoy".
 *
 * ─── La forma elegida ────────────────────────────────────────────────────────
 *
 * Se saca el candado de la base: el mismo cliente puede tener varias paradas
 * abiertas a la vez, una por sucursal, y cada una se ubica por separado cuando
 * el vendedor llega.
 *
 * La protección contra el doble-agregado POR ERROR no se pierde: se muda a la
 * app, que antes de sumar un cliente que ya está en la lista pregunta "¿es otra
 * sucursal?" y sólo agrega si el vendedor confirma. Es la diferencia entre
 * prohibir —que rompía el caso real— y avisar.
 *
 * Nota: esto NO pisa la "segunda visita el mismo día" (migración 20260929173542).
 * Esa sigue funcionando: una visita CERRADA no cuenta como "ya está en la lista"
 * —el aviso mira sólo las abiertas—, así que volver a cobrar a la tarde no
 * dispara la pregunta de la sucursal.
 */

drop index if exists public.paradas_un_cliente_por_jornada;

/*
 * `agregar_cliente_al_recorrido` tenía un `exception when unique_violation` que
 * traducía el choque del índice a "Ese cliente ya está esperando...". Sin el
 * índice ese choque no puede pasar, así que el catch queda muerto y se saca:
 * dejar una traducción de un error imposible confunde a quien lea esto mañana.
 * El aviso de la sucursal ahora lo hace la app antes de llamar acá.
 */
create or replace function public.agregar_cliente_al_recorrido(
  p_cliente_id uuid,
  p_prioridad prioridad_parada
)
returns public.paradas
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_direccion_id uuid;
  v_rol_id       uuid;
  v_fecha        date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_parada       public.paradas;
begin
  if not interno.esta_habilitado() then
    raise exception 'Tu cuenta no esta habilitada.' using errcode = '42501';
  end if;

  -- Puede venir NULL, y está bien: la parada entra sin ubicar y el vendedor
  -- guarda el punto cuando llega.
  select id into v_direccion_id
    from public.direcciones
   where cliente_id = p_cliente_id
   order by principal desc, creado_en
   limit 1;

  insert into public.roles_visita (vendedor_id, fecha, estado)
  values (auth.uid(), v_fecha, 'planificado')
  on conflict (vendedor_id, fecha) do nothing;

  select id into v_rol_id
    from public.roles_visita
   where vendedor_id = auth.uid()
     and fecha = v_fecha;

  -- El mismo cliente puede entrar varias veces (una por sucursal). La app avisa
  -- antes con "¿es otra sucursal?"; acá ya no hay nada que lo bloquee.
  v_parada := public.agregar_parada(v_rol_id, v_direccion_id, p_prioridad, p_cliente_id);

  return v_parada;
end;
$function$;
