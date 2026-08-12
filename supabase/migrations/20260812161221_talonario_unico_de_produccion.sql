-- =============================================================================
-- Un solo talonario: el de producción
--
-- Había tres contadores —produccion, interno y beta— para que las pruebas no
-- gastaran números reales. El costo de eso es que la numeración quedaba
-- partida: el mismo 000007 podía existir tres veces, y "todas las notas de
-- todos los vendedores" no era una sola serie sino tres.
--
-- Pasa a ser uno. La columna `variante` de la nota se queda —sirve para saber
-- qué app la creó, y es lo que permite separar las de prueba antes de largar—
-- pero ya no elige contador: todas las notas salen de la misma serie.
--
-- La contracara, dicha en voz alta: probar consume números reales. Por eso
-- abajo va `reiniciar_talonario()`, que es la forma segura de dejarlo en
-- 000001 el día que salga la versión definitiva.
-- =============================================================================

-- Queda una sola fila. Las otras dos no llegaron a usarse fuera de las pruebas
-- que ya se borraron.
delete from public.talonarios where variante <> 'produccion';

alter table public.talonarios drop constraint if exists talonarios_variante_valida;
alter table public.talonarios drop constraint if exists talonarios_uno_solo;
alter table public.talonarios add  constraint talonarios_uno_solo
  check (variante = 'produccion');

insert into public.talonarios (variante, ultimo_numero)
values ('produccion', 0)
on conflict (variante) do nothing;

comment on table public.talonarios is
  'El talonario. Una sola fila: el ultimo numero entregado. Todas las notas, de todas las apps y todos los vendedores, salen de esta serie.';


-- El número ya no depende de la variante.
create or replace function interno.tomar_numeros(p_cuantos int)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  primero bigint;
begin
  if p_cuantos is null or p_cuantos < 1 then
    raise exception 'Hay que pedir al menos un numero' using errcode = '22023';
  end if;

  -- El UPDATE bloquea la fila hasta que termina la transaccion: dos vendedores
  -- que guardan en el mismo instante no pueden llevarse el mismo numero, el
  -- segundo espera. Y si la transaccion se deshace, el contador vuelve atras
  -- con ella. Eso es lo que una secuencia no hace, y por eso el talonario
  -- llegaba a tener agujeros.
  update public.talonarios
     set ultimo_numero  = ultimo_numero + p_cuantos,
         actualizado_en = now()
   where variante = 'produccion'
  returning ultimo_numero - p_cuantos + 1 into primero;

  if primero is null then
    raise exception 'Falta la fila del talonario' using errcode = 'P0002';
  end if;

  return primero;
end;
$fn$;

comment on function interno.tomar_numeros(int) is
  'Reserva p_cuantos numeros seguidos del talonario y devuelve el primero. Sin agujeros: si la transaccion se deshace, el contador vuelve.';

revoke execute on function interno.tomar_numeros(int) from anon, authenticated, public;


create or replace function interno.asignar_numero_nota()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  if new.numero is null and new.estado <> 'pendiente_cliente' then
    new.numero := interno.tomar_numeros(1);
  end if;
  return new;
end;
$fn$;

revoke execute on function interno.asignar_numero_nota() from anon, authenticated, public;

drop function if exists interno.tomar_numeros(text, int);


-- El número es único en toda la tabla, no por variante: es una sola serie.
drop index if exists public.notas_pedido_numero_por_variante;
create unique index if not exists notas_pedido_numero_unico
  on public.notas_pedido (numero)
  where numero is not null;


-- ─────────────────────────────────────────────────────────────────────────────
-- El alta, ahora sobre el talonario único
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.crear_notas_pedido(p_notas jsonb)
returns table (
  orden_nota  int,
  nota_id     uuid,
  nota_numero bigint,
  nota_estado text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  vendedor  uuid := auth.uid();
  a_numerar int;
  siguiente bigint;
  elem      jsonb;
  it        jsonb;
  n         public.notas_pedido;
  renglon   public.notas_pedido_items;
  i         int := 0;
  j         int;
  ids       uuid[] := '{}';
begin
  if vendedor is null then
    raise exception 'No hay sesion' using errcode = '42501';
  end if;
  if not interno.esta_habilitado() then
    raise exception 'Tu usuario todavia no esta habilitado' using errcode = '42501';
  end if;
  if p_notas is null
     or jsonb_typeof(p_notas) <> 'array'
     or jsonb_array_length(p_notas) = 0 then
    raise exception 'No hay notas para crear' using errcode = '22023';
  end if;

  -- Las que quedan esperando el codigo de cliente no gastan numero.
  select count(*) into a_numerar
    from jsonb_array_elements(p_notas) e
   where coalesce(e -> 'nota' ->> 'estado', 'pendiente') <> 'pendiente_cliente';

  -- Un solo pedido al talonario: los numeros salen seguidos y nadie se mete
  -- en el medio.
  if a_numerar > 0 then
    siguiente := interno.tomar_numeros(a_numerar);
  end if;

  for elem in select value from jsonb_array_elements(p_notas)
  loop
    i := i + 1;

    n := jsonb_populate_record(null::public.notas_pedido, elem -> 'nota');

    -- El vendedor sale de la sesion, no del pedido: es lo que antes garantizaba
    -- la politica de RLS y no se puede aflojar por estar del lado del servidor.
    n.id          := extensions.gen_random_uuid();
    n.vendedor_id := vendedor;
    n.estado      := coalesce(n.estado, 'pendiente');
    -- Que app la creo. Ya no elige contador; queda como registro, y es lo que
    -- permite separar las notas de prueba antes de largar la version final.
    n.variante    := coalesce(n.variante, 'produccion');

    -- `jsonb_populate_record` sobre un registro nulo deja en null todo lo que
    -- el JSON no traiga: los defaults de la tabla no llegan a aplicarse.
    n.datos_cliente_origen           := coalesce(n.datos_cliente_origen, 'texto');
    n.descripcion_herramienta_origen := coalesce(n.descripcion_herramienta_origen, 'texto');
    n.observaciones                  := coalesce(n.observaciones, '{}');
    n.servicios                      := coalesce(n.servicios, '{}');

    -- El instante exacto de ESTA nota, al microsegundo.
    n.creado_en      := clock_timestamp();
    n.actualizado_en := n.creado_en;

    if n.estado = 'pendiente_cliente' then
      n.numero := null;
    else
      n.numero  := siguiente;
      siguiente := siguiente + 1;
    end if;

    insert into public.notas_pedido select (n).*;
    ids := ids || n.id;

    j := 0;
    for it in select value from jsonb_array_elements(coalesce(elem -> 'items', '[]'::jsonb))
    loop
      j := j + 1;
      renglon := jsonb_populate_record(null::public.notas_pedido_items, it);
      renglon.id              := extensions.gen_random_uuid();
      renglon.nota_id         := n.id;
      renglon.orden           := coalesce(renglon.orden, j);
      renglon.cantidad        := coalesce(renglon.cantidad, 1);
      renglon.moneda          := coalesce(renglon.moneda, 'ARS');
      renglon.codigos_computo := coalesce(renglon.codigos_computo, '{}');
      renglon.promocion       := coalesce(renglon.promocion, false);
      renglon.dientes_rotos   := coalesce(renglon.dientes_rotos, false);
      renglon.detalle         := coalesce(renglon.detalle, '{}'::jsonb);
      renglon.creado_en       := clock_timestamp();
      insert into public.notas_pedido_items select (renglon).*;
    end loop;

    -- Una nota sin renglones no sirve para nada y ensucia la lista de
    -- pendientes. Aca deshace la carga entera, que es lo que corresponde.
    if j = 0 then
      raise exception 'La nota % quedo sin renglones', i using errcode = '22023';
    end if;

    orden_nota  := i;
    nota_id     := n.id;
    nota_numero := n.numero;
    nota_estado := n.estado::text;
    return next;
  end loop;

  -- "Va con nota de pedido 000011, 000012".
  --
  -- Va aca y no en la app: los numeros recien existen ahora, y hacerlo desde
  -- afuera era una segunda vuelta que podia fallar sola y dejar las notas de un
  -- mismo cliente sin ninguna referencia entre si.
  if a_numerar > 1 then
    update public.notas_pedido destino
       set observaciones = destino.observaciones || array[
             'Va con nota de pedido ' || (
               select string_agg(lpad(otras.numero::text, 6, '0'), ', ' order by otras.numero)
                 from public.notas_pedido otras
                where otras.id = any(ids)
                  and otras.numero is not null
                  and otras.id <> destino.id
             )
           ]
     where destino.id = any(ids)
       and destino.numero is not null;
  end if;
end;
$fn$;

comment on function public.crear_notas_pedido(jsonb) is
  'Alta de la carga entera en una transaccion: numeros seguidos del talonario unico, marca de creacion al microsegundo y la referencia cruzada entre las notas hermanas.';

grant execute on function public.crear_notas_pedido(jsonb) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- Dejar el talonario en 000001 para largar la versión definitiva
--
-- Con un solo contador, probar gasta números reales. Esta es la forma de
-- volver a cero el día del lanzamiento, y hace lo único que hay que hacer
-- bien: **se niega si todavía queda alguna nota cargada**. Reiniciar el
-- contador con notas vivas dejaría dos comprobantes distintos con el mismo
-- número, y eso no se arregla después.
--
-- El orden es: borrar las notas de prueba, y recién ahí reiniciar.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.reiniciar_talonario()
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  quedan bigint;
begin
  if not interno.es_administracion() then
    raise exception 'Solo el Dpto. de Administracion puede reiniciar el talonario'
      using errcode = '42501';
  end if;

  select count(*) into quedan from public.notas_pedido;
  if quedan > 0 then
    raise exception
      'Todavia hay % nota(s) cargadas. Borralas primero: reiniciar el contador con notas vivas dejaria dos comprobantes con el mismo numero.',
      quedan using errcode = 'P0001';
  end if;

  update public.talonarios
     set ultimo_numero  = 0,
         actualizado_en = now()
   where variante = 'produccion';

  insert into public.auditoria (actor_id, accion, entidad, entidad_id, datos)
  values (auth.uid(), 'talonario.reiniciado', 'talonarios', 'produccion',
          jsonb_build_object('ultimo_numero', 0));

  return 0;
end;
$fn$;

comment on function public.reiniciar_talonario() is
  'Deja el talonario en 0 para largar. Solo Administracion, y solo si no queda ninguna nota cargada.';

grant execute on function public.reiniciar_talonario() to authenticated;
