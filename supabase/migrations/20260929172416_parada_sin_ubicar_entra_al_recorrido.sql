/*
 * Una parada puede entrar al recorrido sin estar ubicada en el mapa.
 *
 * ─── El problema, dicho por el vendedor ──────────────────────────────────────
 *
 * "Hay clientes que sé dónde están. En vez de cargarlo y buscarlo en el mapa y
 *  todo el quilombo, estar todo el tiempo con el teléfono, yo lo que quisiera es
 *  agregarlo al recorrido y después, cuando voy, de última pongo 'llegué' o
 *  'guardar ubicación'. No me permite dejarlo en la lista sin tener la dirección.
 *  Hasta que no llego yo al cliente no me permite cargarlo al recorrido."
 *
 * ─── Por qué no alcanzaba con sacar un cartel de la app ──────────────────────
 *
 * Porque el candado no estaba en la app: estaba acá. `paradas.direccion_id` era
 * NOT NULL contra `direcciones`, y en `direcciones` lat/lng son NOT NULL. O sea
 * que no existía forma de representar "una parada de la que todavía no sé el
 * punto", aunque se sacaran todos los chequeos del teléfono.
 *
 * No es un caso de borde: 6.536 de los 16.496 clientes activos (el 40 %) no
 * tienen NINGUNA fila en `direcciones`. De esos, 6.386 sí traen el domicilio
 * como texto en `clientes.direccion`, que es lo que vino del sistema de gestión
 * viejo. El vendedor sabe ir; lo que falta es el punto, no la dirección.
 *
 * ─── La forma elegida, y la que NO se eligió ─────────────────────────────────
 *
 * Se abre a NULL UNA sola columna: `paradas.direccion_id`. NULL significa
 * "parada sin ubicar".
 *
 * Lo que NO se toca —a propósito— es `direcciones.lat/lng`. Si se hubieran hecho
 * nullables, se habría caído la columna generada `ubicacion`, y con ella el
 * índice GiST, el KNN de la cercanía, `clientes_en_mapa` y el geocodificado en
 * lote. Y peor: habría filas de dirección sin punto, que es justo lo que pone
 * pines falsos en el mapa. Dejando `direcciones` como está, sigue valiendo el
 * invariante "si hay fila de dirección, hay coordenadas", y el estado nuevo vive
 * en un solo lugar donde se lo puede preguntar con `direccion_id is null`.
 *
 * La parada sin ubicar se sostiene de `paradas.direccion_snapshot`, que existe
 * desde el día uno, y que la vista y el historial YA coalescen. La mitad del
 * trabajo estaba hecha; lo único que faltaba era que se pudiera guardar la fila.
 */

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. La columna, y los dos estados imposibles que quedan cerrados
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.paradas alter column direccion_id drop not null;

/*
 * Sin dirección tiene que haber cliente.
 *
 * Una parada puede no tener cliente (el "destino suelto": una dirección a la que
 * hay que ir y que no es de nadie del padrón). Lo que no puede es no tener
 * ninguno de los dos, porque entonces no queda nada con qué dibujar la fila ni
 * dónde guardar después la ubicación.
 */
alter table public.paradas
  add constraint paradas_sin_direccion_tiene_cliente
  check (direccion_id is not null or cliente_id is not null);

/*
 * Sin dirección no puede haber tramo medido.
 *
 * `distancia_desde_anterior_m` y `duracion_desde_anterior_seg` son el tramo que
 * Google midió hasta esa parada. Medir un tramo hasta un lugar que no sabemos
 * dónde queda es, literalmente, un número inventado.
 *
 * Hoy este CHECK no puede dispararse: esas dos columnas no tienen un solo
 * escritor en todo el repo (se declaran, se leen en la vista, y nadie las
 * completa). Va igual, para el día que alguien las empiece a escribir.
 */
alter table public.paradas
  add constraint paradas_sin_direccion_no_tiene_tramo
  check (
    direccion_id is not null
    or (distancia_desde_anterior_m is null and duracion_desde_anterior_seg is null)
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. La vista de la oficina: LEFT JOIN, o la parada desaparece
-- ─────────────────────────────────────────────────────────────────────────────

/*
 * Era el INNER JOIN más caro del sistema y no se veía.
 *
 * `vista_rol_de_visita` hacía `join direcciones d on d.id = pa.direccion_id`.
 * Con `direccion_id` nulo la fila se caía entera: la parada desaparecía de la
 * planilla de la oficina Y del archivado histórico (la Edge Function
 * `archivar-historial` lee esta misma vista). El vendedor la veía en el teléfono
 * y para la empresa no había existido nunca.
 *
 * El COALESCE al snapshot ya estaba escrito acá abajo desde siempre; lo único
 * que faltaba era que el JOIN dejara pasar la fila para poder usarlo.
 */
create or replace view public.vista_rol_de_visita as
 SELECT rv.id AS rol_visita_id,
    rv.fecha,
    rv.estado AS estado_jornada,
    p.id AS vendedor_id,
    p.nombre_completo AS vendedor,
    p.codigo_vendedor AS codigo,
    pa.id AS parada_id,
    pa.orden AS nro,
    pa.estado AS estado_parada,
    pa.prioridad,
    pa.origen AS origen_parada,
    pa.llegada_en AS hora,
    pa.hora_estimada,
    pa.distancia_desde_anterior_m,
    pa.duracion_desde_anterior_seg,
    c.codigo AS cliente_nro,
    COALESCE(c.razon_social, pa.razon_social_snapshot, 'Destino sin cliente'::text) AS razon_social,
    COALESCE(d.direccion_formateada, pa.direccion_snapshot) AS direccion,
    d.codigo_postal,
    d.lat,
    d.lng,
    v.visitado,
    v.vendio,
    v.cobro,
    v.retiro_afilado,
    v.entrego,
    v.motivo_no_visita,
    COALESCE(v.contacto_nombre, c.contacto_nombre) AS contacto,
    v.observacion,
    v.observacion_origen,
    v.observacion_audio_url,
    v.desvio_m,
    v.registrado_en
   FROM roles_visita rv
     JOIN perfiles p ON p.id = rv.vendedor_id
     JOIN paradas pa ON pa.rol_visita_id = rv.id
     LEFT JOIN direcciones d ON d.id = pa.direccion_id
     LEFT JOIN clientes c ON c.id = pa.cliente_id
     LEFT JOIN visitas v ON v.parada_id = pa.id;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. El ordenador por cercanía: las sin ubicar, al final, pero RENUMERADAS
-- ─────────────────────────────────────────────────────────────────────────────

/*
 * Acá estaba el error más silencioso de todo el cambio.
 *
 * El loop de abajo ordena por KNN haciendo `join direcciones`, así que una
 * parada sin ubicar nunca entra. El problema no es que no entre —está bien, no
 * hay contra qué medirla— sino que se quedaba con su `orden` VIEJO mientras
 * todas las demás se renumeraban encima. Y `paradas_orden_unico` es único sobre
 * (rol_visita_id, orden): la colisión aparecía recién al cerrar la transacción,
 * lejos de donde se causó.
 *
 * Por eso ahora, después del loop, las sin ubicar se numeran al final DENTRO del
 * mismo rango temporal. Así bajan junto con el resto en la última sentencia y la
 * numeración queda corrida y sin huecos.
 */
create or replace function public.ordenar_paradas_por_cercania(
  p_rol_visita_id uuid,
  p_desde_lat double precision default null,
  p_desde_lng double precision default null
)
returns void
language plpgsql
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  punto_actual extensions.geography;
  siguiente    uuid;
  posicion     integer;
  colocadas    uuid[] := '{}';
  sin_ubicar   uuid;
begin
  -- El último número YA USADO por un destino cerrado, no cuántos hay cerrados.
  select coalesce(max(orden), 0) into posicion
    from public.paradas
   where rol_visita_id = p_rol_visita_id
     and estado not in ('pendiente', 'en_camino');

  if p_desde_lat is not null then
    punto_actual := extensions.st_setsrid(extensions.st_makepoint(p_desde_lng, p_desde_lat), 4326)::extensions.geography;
  else
    select coalesce(
             extensions.st_setsrid(extensions.st_makepoint(rv.origen_lng, rv.origen_lat), 4326)::extensions.geography,
             extensions.st_setsrid(extensions.st_makepoint(p.origen_lng, p.origen_lat), 4326)::extensions.geography
           )
      into punto_actual
      from public.roles_visita rv
      join public.perfiles p on p.id = rv.vendedor_id
     where rv.id = p_rol_visita_id;
  end if;

  -- Sin punto de partida no se reordena nada, y por lo tanto tampoco hay
  -- renumeración que pueda chocar: se sale antes de tocar una sola fila.
  if punto_actual is null then
    return;
  end if;

  -- Se numera en dos tiempos con un rango temporal muy por encima de cualquier
  -- orden real: ninguna fila intermedia colisiona ni viola el CHECK orden > 0
  -- (los CHECK no se pueden diferir).
  loop
    select pa.id
      into siguiente
      from public.paradas pa
      join public.direcciones d on d.id = pa.direccion_id
     where pa.rol_visita_id = p_rol_visita_id
       and pa.estado in ('pendiente', 'en_camino')
       and not (pa.id = any (colocadas))
     order by (pa.prioridad = 'alta') desc,
              d.ubicacion <-> punto_actual
     limit 1;

    exit when siguiente is null;

    posicion  := posicion + 1;
    colocadas := colocadas || siguiente;

    update public.paradas
       set orden = interno.orden_temporal() + posicion
     where id = siguiente;

    select d.ubicacion
      into punto_actual
      from public.paradas pa
      join public.direcciones d on d.id = pa.direccion_id
     where pa.id = siguiente;
  end loop;

  /*
   * Las sin ubicar, después de todas las ubicadas.
   *
   * Entre ellas se conserva el orden que ya tenían (y el de carga como
   * desempate), que es lo más parecido a "como las fue agregando".
   */
  for sin_ubicar in
    select pa.id
      from public.paradas pa
     where pa.rol_visita_id = p_rol_visita_id
       and pa.estado in ('pendiente', 'en_camino')
       and pa.direccion_id is null
     order by pa.orden, pa.creado_en
  loop
    posicion := posicion + 1;
    update public.paradas
       set orden = interno.orden_temporal() + posicion
     where id = sin_ubicar;
  end loop;

  update public.paradas
     set orden = orden - interno.orden_temporal()
   where rol_visita_id = p_rol_visita_id
     and orden > interno.orden_temporal();
end;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. agregar_parada: acepta una parada sin dirección
-- ─────────────────────────────────────────────────────────────────────────────

/*
 * Dos cambios, los dos por el mismo motivo: sin `direccion_id` no hay de dónde
 * sacar lo que la función sacaba de ahí.
 *
 *  · El snapshot. Antes salía de `direcciones` con un JOIN que, sin dirección,
 *    no devuelve ninguna fila y dejaba la parada sin nombre y sin domicilio.
 *    Ahora, cuando no hay punto, sale de la ficha del cliente: la razón social y
 *    el domicilio de texto que vino del sistema viejo (`clientes.direccion`),
 *    que es justo lo que tienen 6.386 de los 6.536 clientes bloqueados.
 *
 *  · La posición. Una parada sin ubicar va SIEMPRE al final, sin importar la
 *    prioridad que se haya pedido. No es una limitación técnica sino la única
 *    lectura honesta: la prioridad alta significa "pasá por acá primero porque
 *    queda de camino", y de algo que no sabemos dónde está no se puede afirmar.
 */
create or replace function public.agregar_parada(
  p_rol_visita_id uuid,
  p_direccion_id uuid,
  p_prioridad prioridad_parada,
  p_cliente_id uuid default null
)
returns public.paradas
language plpgsql
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  ultima_resuelta integer;
  offset_media    integer;
  destino_orden   integer;
  total_pendiente integer;
  nueva           public.paradas;
  snapshot_dir    text;
  snapshot_cli    text;
  v_en_curso      boolean;
begin
  -- Si la jornada estaba cerrada, sumar un destino la reabre (y le devuelve un
  -- iniciado_en si no lo tenia: una jornada en curso no puede estar sin inicio).
  update public.roles_visita
     set estado = 'en_curso', finalizado_en = null,
         iniciado_en = coalesce(iniciado_en, now())
   where id = p_rol_visita_id
     and estado = 'finalizado';

  select (estado = 'en_curso') into v_en_curso
    from public.roles_visita where id = p_rol_visita_id;

  select coalesce(max(orden), 0) into ultima_resuelta
    from public.paradas
   where rol_visita_id = p_rol_visita_id
     and estado not in ('pendiente', 'en_camino');

  select coalesce(count(*), 0) into total_pendiente
    from public.paradas
   where rol_visita_id = p_rol_visita_id
     and estado in ('pendiente', 'en_camino');

  select coalesce((valor)::int, 3) into offset_media
    from public.configuracion where clave = 'prioridad_media_offset';

  destino_orden := case
    when p_direccion_id is null then ultima_resuelta + total_pendiente + 1
    else case p_prioridad
      when 'alta'  then ultima_resuelta + 1
      when 'media' then ultima_resuelta + least(coalesce(offset_media, 3), total_pendiente + 1)
      else              ultima_resuelta + total_pendiente + 1
    end
  end;

  if p_direccion_id is null then
    -- Sin punto: el nombre y el domicilio salen de la ficha del cliente.
    select c.razon_social,
           nullif(btrim(concat_ws(', ',
             nullif(btrim(coalesce(c.direccion, '')), ''),
             nullif(btrim(coalesce(c.localidad, '')), '')
           )), '')
      into snapshot_cli, snapshot_dir
      from public.clientes c
     where c.id = p_cliente_id;
  else
    select d.direccion_formateada, c.razon_social
      into snapshot_dir, snapshot_cli
      from public.direcciones d
      left join public.clientes c on c.id = coalesce(p_cliente_id, d.cliente_id)
     where d.id = p_direccion_id;
  end if;

  update public.paradas
     set orden = orden + 1
   where rol_visita_id = p_rol_visita_id
     and orden >= destino_orden;

  insert into public.paradas (
    rol_visita_id, cliente_id, direccion_id, orden, prioridad, origen, estado,
    razon_social_snapshot, direccion_snapshot, agregada_por
  )
  values (
    p_rol_visita_id,
    coalesce(p_cliente_id, (select cliente_id from public.direcciones where id = p_direccion_id)),
    p_direccion_id, destino_orden, p_prioridad, 'agregada_en_ruta', 'pendiente',
    snapshot_cli, snapshot_dir, auth.uid()
  )
  returning * into nueva;

  if p_prioridad = 'baja' and not v_en_curso then
    perform public.ordenar_paradas_por_cercania(p_rol_visita_id);
    select * into nueva from public.paradas where id = nueva.id;
  end if;

  return nueva;
end;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Los dos caminos que cortaban con un cartel
-- ─────────────────────────────────────────────────────────────────────────────

/*
 * `agregar_cliente_al_recorrido` es la que usa el teléfono desde el mapa y desde
 * la lista de clientes. Era la que tiraba "Ese cliente todavia no esta ubicado
 * en el mapa." — el cartel exacto del que se queja el vendedor.
 *
 * De paso se saca el `and lat is not null and lng is not null` del WHERE, que
 * era código muerto: esas columnas son NOT NULL en `direcciones`, así que el
 * filtro nunca descartó una sola fila. El caso real siempre fue "este cliente no
 * tiene NINGUNA dirección cargada", que es lo que ahora se deja pasar.
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
    raise exception 'Ese cliente ya esta en tu recorrido de hoy.' using errcode = '23505';
  end;

  return v_parada;
end;
$function$;

/*
 * `agendar_visita` es la de la agenda semanal y el calendario. Mismo cartel,
 * mismo motivo, misma solución: si el cliente no tiene dirección, se agenda
 * igual y queda sin ubicar.
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
   * Se busca CUALQUIER parada de ese cliente ese dia, no solo las pendientes.
   *
   * `paradas_un_cliente_por_jornada` es un unico sobre (rol_visita_id,
   * cliente_id) que no mira el estado. Mirando solo las pendientes, una parada
   * omitida del mismo cliente pasaba desapercibida, se intentaba insertar otra,
   * y el vendedor recibia el texto crudo del indice violado.
   */
  select * into nueva
    from public.paradas
   where rol_visita_id = jornada
     and cliente_id = p_cliente_id
   limit 1;

  if nueva.id is not null then
    if nueva.estado = 'omitida' then
      update public.paradas set estado = 'pendiente' where id = nueva.id;
      select * into nueva from public.paradas where id = nueva.id;

    elsif nueva.estado not in ('pendiente', 'en_camino') then
      raise exception 'A ese cliente ya lo tenés resuelto ese día: no se puede volver a agendar.'
        using errcode = '23514';
    end if;

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

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. ubicar_parada: la pieza que faltaba, la de "llegué"
-- ─────────────────────────────────────────────────────────────────────────────

/*
 * Hasta ahora nada podía completar el `direccion_id` de una parada YA creada:
 * `agregar_parada` sólo inserta, y `ubicar_cliente` arregla la ficha del cliente
 * pero no sabe nada de la parada que está en la lista de hoy. Sin esto, la
 * parada sin ubicar se quedaba sin ubicar para siempre.
 *
 * Reusa `ubicar_cliente` tal cual —que ya valida las coordenadas, ya decide
 * entre crear y actualizar la dirección, y ya corre con las policies del
 * vendedor— y le engancha el resultado a la MISMA parada, sin renumerar nada:
 * el destino no se mueve de lugar sólo porque ahora sepamos dónde queda.
 *
 * SECURITY INVOKER a propósito: quién puede tocar qué parada lo decide la RLS de
 * `paradas`, que ya está escrita, y no una regla nueva acá adentro que habría
 * que mantener en dos lados.
 */
create or replace function public.ubicar_parada(
  p_parada_id uuid,
  p_direccion_formateada text,
  p_lat double precision,
  p_lng double precision,
  p_codigo_postal text default null,
  p_google_place_id text default null,
  p_localidad text default null,
  p_provincia text default null
)
returns public.paradas
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_parada    public.paradas;
  v_direccion public.direcciones;
begin
  select * into v_parada from public.paradas where id = p_parada_id;

  if v_parada.id is null then
    raise exception 'No existe la parada %', p_parada_id using errcode = 'P0002';
  end if;

  if v_parada.cliente_id is null then
    raise exception 'Ese destino no tiene cliente, asi que no hay ficha donde guardar la ubicacion.'
      using errcode = '23514';
  end if;

  v_direccion := public.ubicar_cliente(
    v_parada.cliente_id, p_direccion_formateada, p_lat, p_lng,
    p_codigo_postal, p_google_place_id, p_localidad, p_provincia
  );

  update public.paradas
     set direccion_id       = v_direccion.id,
         direccion_snapshot = v_direccion.direccion_formateada
   where id = p_parada_id
  returning * into v_parada;

  return v_parada;
end;
$function$;

/*
 * Como toda función de este proyecto: `anon` no la ejecuta.
 *
 * Se revoca de `public` ADEMÁS de `anon`, porque el GRANT que hereda `anon` es
 * el de PUBLIC y revocarle sólo a él no alcanza (ya pasó, está anotado en las
 * migraciones de seguridad). `authenticated` tiene su propio grant y no se toca.
 */
revoke all on function public.ubicar_parada(uuid, text, double precision, double precision, text, text, text, text) from public, anon;
grant execute on function public.ubicar_parada(uuid, text, double precision, double precision, text, text, text, text) to authenticated;
