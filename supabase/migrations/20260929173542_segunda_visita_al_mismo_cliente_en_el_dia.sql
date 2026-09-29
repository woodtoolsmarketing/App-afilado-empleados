/*
 * Se puede volver al mismo cliente el mismo día.
 *
 * ─── El problema, dicho por el vendedor ──────────────────────────────────────
 *
 * "Fui hoy a la mañana, necesitaban la herramienta. Y la chica no tenía armado
 *  el pago. Ahora tengo que volver a retirar el pago y no me lo permite cargar
 *  dos veces, porque son dos visitas."
 *
 * Entregó a la mañana, registró la visita, y a la tarde tiene que volver a
 * cobrar. La app le contestaba "Ese cliente ya está en tu recorrido de hoy." y
 * no había forma de seguir: el segundo viaje existía en la calle y no existía
 * en el sistema.
 *
 * ─── Por qué pasaba ──────────────────────────────────────────────────────────
 *
 * El índice `paradas_un_cliente_por_jornada` era ÚNICO sobre
 * (rol_visita_id, cliente_id) sin mirar el estado. Existe por un buen motivo
 * —que el vendedor no cargue dos veces al mismo cliente por error y termine con
 * la lista duplicada— pero estaba escrito de más: también prohibía el caso en
 * que la primera visita YA ESTÁ CERRADA, que no es un error sino un segundo
 * viaje, y es de lo más común en este trabajo (entregás a la mañana, cobrás a la
 * tarde).
 *
 * ─── La forma elegida ────────────────────────────────────────────────────────
 *
 * El índice pasa a cubrir sólo las paradas ABIERTAS ('pendiente', 'en_camino').
 * Así la guarda que importa sigue intacta —no podés tener dos veces al mismo
 * cliente esperando en la lista— y lo que se destraba es exactamente lo que el
 * vendedor pide: una vez resuelta la visita, el cliente se puede volver a
 * cargar.
 *
 * Nota: `visitas` es único por `parada_id`, no por cliente, así que la segunda
 * parada se lleva su propia visita sin pelearse con la primera. No hizo falta
 * tocar nada de eso.
 */

drop index if exists public.paradas_un_cliente_por_jornada;

create unique index paradas_un_cliente_por_jornada
  on public.paradas (rol_visita_id, cliente_id)
  where cliente_id is not null and estado in ('pendiente', 'en_camino');

/*
 * `agendar_visita` tenía la misma regla escrita a mano, y hay que moverla junto
 * con el índice o quedan diciendo cosas distintas: el índice dejaría pasar la
 * segunda visita y la función la seguiría rechazando con "A ese cliente ya lo
 * tenés resuelto ese día".
 *
 * Ahora sólo busca una parada ABIERTA (o una `omitida`, que se reabre en vez de
 * duplicar, que es lo que ya hacía y está bien). Si lo único que hay de ese
 * cliente ese día son visitas cerradas, se crea una parada nueva: es el segundo
 * viaje.
 */
create or replace function public.agendar_visita(
  p_cliente_id uuid,
  p_fecha date,
  p_hora timestamp with time zone default null
)
returns public.paradas
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  direccion  uuid;
  jornada    uuid;
  nueva      public.paradas;
begin
  if p_fecha < interno.hoy_ar() then
    raise exception 'No se puede agendar para un día que ya pasó.' using errcode = '23514';
  end if;

  -- Puede quedar NULL: se agenda sin ubicar y se resuelve al llegar.
  select dd.id into direccion
    from public.direcciones dd
   where dd.cliente_id = p_cliente_id
   order by dd.principal desc, dd.creado_en
   limit 1;

  jornada := public.jornada_del_dia(p_fecha);

  /*
   * Se buscan las ABIERTAS y las omitidas, no "cualquiera".
   *
   * `paradas_un_cliente_por_jornada` ahora sólo cubre 'pendiente' y 'en_camino',
   * así que ésas son las que no pueden repetirse. La `omitida` se reabre —la
   * sacó de la agenda y la vuelve a poner: es lo mismo que quiso hacer, y no
   * deja dos filas del mismo cliente—. Las cerradas no frenan nada: si ya la
   * visitó y lo vuelve a agendar, es un segundo viaje.
   *
   * El `order by` pone las abiertas antes que la omitida, para que si por algún
   * camino existieran las dos, gane la que está viva.
   */
  select * into nueva
    from public.paradas
   where rol_visita_id = jornada
     and cliente_id = p_cliente_id
     and estado in ('pendiente', 'en_camino', 'omitida')
   order by (estado = 'omitida')
   limit 1;

  if nueva.id is not null then
    if nueva.estado = 'omitida' then
      update public.paradas set estado = 'pendiente' where id = nueva.id;
      select * into nueva from public.paradas where id = nueva.id;
    end if;
    -- Pendiente o en camino: ya estaba agendado, se devuelve el que hay.

  else
    nueva := public.agregar_parada(jornada, direccion, 'baja'::prioridad_parada, p_cliente_id);
  end if;

  if p_hora is not null then
    update public.paradas set hora_estimada = p_hora where id = nueva.id;
    select * into nueva from public.paradas where id = nueva.id;
  end if;

  return nueva;
end;
$function$;

/*
 * Y el cartel que ve el vendedor tiene que decir la verdad nueva.
 *
 * "Ese cliente ya está en tu recorrido de hoy" era cierto cuando el bloqueo
 * valía para todo el día. Ahora el choque sólo puede pasar si el cliente está
 * ESPERANDO en la lista, y esa palabra es justo la que le dice qué hacer: si ya
 * lo visitó, lo puede cargar de nuevo.
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

  begin
    v_parada := public.agregar_parada(v_rol_id, v_direccion_id, p_prioridad, p_cliente_id);
  exception when unique_violation then
    raise exception 'Ese cliente ya está esperando en tu recorrido de hoy.' using errcode = '23505';
  end;

  return v_parada;
end;
$function$;
