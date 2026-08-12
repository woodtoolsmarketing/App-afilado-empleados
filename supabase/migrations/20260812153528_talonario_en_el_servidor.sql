-- =============================================================================
-- El talonario de notas de pedido vive en el servidor
--
-- La numeración salía de una secuencia de Postgres, y una secuencia no vuelve
-- atrás: si la nota se deshace —porque falló el alta de los renglones, o porque
-- la tanda se cancela a la mitad— el número que tomó se pierde y el talonario
-- queda con un agujero. Ya pasó dos veces: faltan la 1 y la 15.
--
-- Y como cada nota de una misma carga se insertaba por su cuenta, dos
-- vendedores guardando en el mismo instante se intercalaban: las tres notas de
-- un cliente podían salir 21, 23 y 24, sin forma de saber que iban juntas.
--
-- Ahora el número sale de un contador por talonario, en la misma transacción
-- que la nota:
--
--   · Sin agujeros. Si la transacción se deshace, el contador vuelve con ella.
--   · En bloque. Una carga de tres notas toma tres números seguidos y nadie se
--     mete en el medio.
--   · Por el instante exacto de creación. `creado_en` pasa a marcarse con
--     `clock_timestamp()`, que avanza dentro de la transacción: cada nota tiene
--     su propio microsegundo, y los números se reparten en ese orden.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- El contador
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.talonarios (
  variante        text primary key,
  ultimo_numero   bigint      not null default 0,
  actualizado_en  timestamptz not null default now(),

  constraint talonarios_variante_valida check (variante in ('produccion', 'interno', 'beta')),
  constraint talonarios_numero_positivo check (ultimo_numero >= 0)
);

comment on table public.talonarios is
  'Un contador por talonario: el ultimo numero entregado. Es la fuente de la numeracion de las notas de pedido.';

-- Arranca donde esté cada talonario hoy, para que aplicar esto no pueda chocar
-- con las notas que ya existen.
insert into public.talonarios (variante, ultimo_numero)
select v.variante, coalesce(max(n.numero), 0)
  from (values ('produccion'), ('interno'), ('beta')) as v(variante)
  left join public.notas_pedido n on n.variante = v.variante
 group by v.variante
on conflict (variante) do nothing;

alter table public.talonarios enable row level security;

-- Se lee desde el panel; escribirlo es sólo por la función de acá abajo.
drop policy if exists talonarios_leer on public.talonarios;
create policy talonarios_leer on public.talonarios
  for select to authenticated
  using (interno.puede_ver_todo());


-- ─────────────────────────────────────────────────────────────────────────────
-- Tomar un bloque de números
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function interno.tomar_numeros(p_variante text, p_cuantos int)
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

  -- El UPDATE bloquea la fila del talonario hasta que termina la transaccion:
  -- dos vendedores que guardan en el mismo instante no pueden llevarse el mismo
  -- numero, el segundo espera. Y si la transaccion se deshace, el contador
  -- vuelve atras con ella. Eso es lo que una secuencia no hace.
  update public.talonarios
     set ultimo_numero  = ultimo_numero + p_cuantos,
         actualizado_en = now()
   where variante = p_variante
  returning ultimo_numero - p_cuantos + 1 into primero;

  if primero is null then
    raise exception 'No existe el talonario "%"', p_variante using errcode = 'P0002';
  end if;

  return primero;
end;
$fn$;

comment on function interno.tomar_numeros is
  'Reserva p_cuantos numeros seguidos del talonario y devuelve el primero. Sin agujeros: si la transaccion se deshace, el contador vuelve.';

revoke execute on function interno.tomar_numeros(text, int) from anon, authenticated, public;


-- ─────────────────────────────────────────────────────────────────────────────
-- El instante exacto de creación
--
-- `now()` es la hora de arranque de la TRANSACCIÓN: las tres notas de una misma
-- carga saldrían con la misma marca al microsegundo, y no habría con qué
-- ordenarlas. `clock_timestamp()` es el reloj de verdad y avanza dentro de la
-- transacción.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.notas_pedido       alter column creado_en set default clock_timestamp();
alter table public.notas_pedido_items alter column creado_en set default clock_timestamp();

comment on column public.notas_pedido.creado_en is
  'Instante exacto de creacion, al microsegundo. Es el orden en que se reparten los numeros del talonario.';


-- ─────────────────────────────────────────────────────────────────────────────
-- El disparador que numera lo que entra por fuera del alta
--
-- Queda para un solo caso: cuando Administración le asigna el código de cliente
-- a una nota que estaba en `pendiente_cliente`, ahí recién recibe su número.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function interno.asignar_numero_nota()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  if new.numero is null and new.estado <> 'pendiente_cliente' then
    new.numero := interno.tomar_numeros(coalesce(new.variante, 'produccion'), 1);
  end if;
  return new;
end;
$fn$;

revoke execute on function interno.asignar_numero_nota() from anon, authenticated, public;

-- Las secuencias quedan sin uso. Se van para que nada las vuelva a llamar por
-- error: mientras existieran, cualquier cliente con sesion podia gastar un
-- numero del talonario real con un `nextval` suelto.
drop sequence if exists public.notas_pedido_numero_seq;
drop sequence if exists public.notas_pedido_numero_beta_seq;


-- ─────────────────────────────────────────────────────────────────────────────
-- Alta de la carga entera, de una
--
-- Un cliente puede dar hasta cuatro notas —afilado, venta, sierras sin fin y
-- fresas nacionales se facturan por separado— y hasta acá cada una se insertaba
-- desde la app por su cuenta. Eso dejaba dos problemas: los números podían
-- intercalarse con los de otro vendedor, y si la segunda nota fallaba había que
-- borrar la primera a mano desde el teléfono, con lo que eso tiene de frágil si
-- justo ahí se corta la señal.
--
-- Ahora entra todo en una transacción: o quedan las cuatro numeradas y
-- correlativas, o no queda ninguna.
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
  talonario text;
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

  -- Todas las notas de una misma carga salen del mismo talonario.
  talonario := coalesce(p_notas -> 0 -> 'nota' ->> 'variante', 'produccion');

  -- Las que quedan esperando el codigo de cliente no gastan numero.
  select count(*) into a_numerar
    from jsonb_array_elements(p_notas) e
   where coalesce(e -> 'nota' ->> 'estado', 'pendiente') <> 'pendiente_cliente';

  if a_numerar > 0 then
    siguiente := interno.tomar_numeros(talonario, a_numerar);
  end if;

  for elem in select value from jsonb_array_elements(p_notas)
  loop
    i := i + 1;

    n := jsonb_populate_record(null::public.notas_pedido, elem -> 'nota');

    -- El vendedor sale de la sesion, no del pedido: es lo que antes garantizaba
    -- la politica de RLS y no se puede aflojar por estar del lado del servidor.
    n.id          := extensions.gen_random_uuid();
    n.vendedor_id := vendedor;
    n.variante    := talonario;
    n.estado      := coalesce(n.estado, 'pendiente');

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
    -- pendientes. Acá deshace la carga entera, que es lo que corresponde.
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
  -- Va acá y no en la app: los numeros recien existen ahora, y hacerlo desde
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

comment on function public.crear_notas_pedido is
  'Alta de la carga entera en una transaccion: numeros seguidos del talonario, marca de creacion al microsegundo y la referencia cruzada entre las notas hermanas.';

grant execute on function public.crear_notas_pedido(jsonb) to authenticated;
