-- =============================================================================
-- El número de nota lleva el vendedor adelante: 02-0081
--
-- La nota 81 del vendedor 2 pasa a escribirse `02-0081`. El prefijo son dos
-- dígitos —el número de vendedor de ESA nota, con el cero de relleno si hace
-- falta— y el número queda en cuatro. Antes eran seis ceros y nada adelante.
--
-- Cuatro dígitos y no seis porque el casillero del talonario es angosto:
-- `02-000081` ocupaba tres caracteres más que `000081`. El talonario va por la
-- 81, así que hasta la 9999 hay años.
--
-- La nota SIGUE saliendo de una sola serie: esto es cómo se escribe, no cómo
-- se numera. Dos vendedores nunca comparten un número, así que el prefijo no
-- desambigua nada — sirve para leer de quién es la hoja de un vistazo.
--
-- Las notas viejas sin número de vendedor se siguen escribiendo `000081`.
-- Inventarles un prefijo sería atribuírselas a alguien, y `0081` a secas se
-- lee como otra nota.
--
-- El formato está escrito dos veces —acá y en `numeroDeNotaImpreso` de
-- TypeScript— porque los dos lados tienen que poder escribirlo solos. Si se
-- cambia uno hay que cambiar el otro; son cuatro líneas y ninguna adivina.
-- =============================================================================

create or replace function interno.numero_de_nota_impreso(
  p_numero   bigint,
  p_vendedor text
)
returns text
language sql
immutable
as $fn$
  select case
    when p_numero is null then null
    -- Sin vendedor, como toda la vida: seis ceros y nada adelante.
    when coalesce(nullif(regexp_replace(coalesce(p_vendedor, ''), '^0+(?=[0-9])', '')
                        , ''), '') = ''
      then lpad(p_numero::text, 6, '0')
    else lpad(regexp_replace(p_vendedor, '^0+(?=[0-9])', ''), 2, '0')
         || '-' || lpad(p_numero::text, 4, '0')
  end;
$fn$;

comment on function interno.numero_de_nota_impreso(bigint, text) is
  'El numero de nota como va impreso: 02-0081 es la nota 81 del vendedor 2. Sin vendedor cargado, 000081.';

grant execute on function interno.numero_de_nota_impreso(bigint, text) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- "Va con nota de pedido 02-0011, 02-0012"
--
-- El aviso cruzado entre las notas hermanas de una misma carga. Se escribía
-- con `lpad(numero, 6, '0')` a mano; ahora usa la función, que es la misma que
-- escribe el número en la hoja.
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
    n.variante    := coalesce(n.variante, 'produccion');

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

  -- "Va con nota de pedido 02-0011, 02-0012".
  --
  -- Va aca y no en la app: los numeros recien existen ahora, y hacerlo desde
  -- afuera era una segunda vuelta que podia fallar sola y dejar las notas de un
  -- mismo cliente sin ninguna referencia entre si.
  if a_numerar > 1 then
    update public.notas_pedido destino
       set observaciones = destino.observaciones || array[
             'Va con nota de pedido ' || (
               select string_agg(
                        interno.numero_de_nota_impreso(otras.numero, otras.vendedor_numero),
                        ', ' order by otras.numero)
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

grant execute on function public.crear_notas_pedido(jsonb) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- El historial devuelve tambien el numero de vendedor
--
-- La pantalla HISTORIAL DE NOTAS escribe el numero de cada nota, asi que
-- necesita el prefijo. Es el unico dato que se agrega; el resto queda igual.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.historial_notas_pedido(
  p_desde date default null,
  p_hasta date default null
)
returns table (fecha date, cantidad bigint, detalle jsonb)
language plpgsql security invoker
set search_path = public, pg_temp
as $fn$
declare
  retencion int;
  piso date;
  hoy   date;
begin
  select coalesce((valor)::int, 90) into retencion
    from public.configuracion where clave = 'retencion_historial_dias';
  retencion := coalesce(retencion, 90);

  -- El "hoy" del vendedor, no el del servidor.
  hoy := (now() at time zone 'America/Argentina/Buenos_Aires')::date;

  piso := case when interno.puede_ver_todo()
               then coalesce(p_desde, hoy - retencion)
               else greatest(coalesce(p_desde, hoy - retencion), hoy - retencion)
          end;

  return query
  select
    (n.creado_en at time zone 'America/Argentina/Buenos_Aires')::date,
    count(*),
    jsonb_agg(
      jsonb_build_object(
        'nota_id',         n.id,
        'numero',          n.numero,
        'vendedor_numero', n.vendedor_numero,
        'tipo_nota',       n.tipo_nota,
        'estado',          n.estado,
        'cliente_codigo',  n.cliente_codigo,
        'cliente_nombre',  n.cliente_nombre,
        'hora',            n.creado_en,
        'total',           n.total,
        'servicios',       n.servicios
      ) order by n.creado_en
    )
  from public.notas_pedido n
  where (interno.puede_ver_todo() or n.vendedor_id = auth.uid())
    and (n.creado_en at time zone 'America/Argentina/Buenos_Aires')::date >= piso
    and (n.creado_en at time zone 'America/Argentina/Buenos_Aires')::date <= coalesce(p_hasta, hoy)
  group by (n.creado_en at time zone 'America/Argentina/Buenos_Aires')::date
  order by (n.creado_en at time zone 'America/Argentina/Buenos_Aires')::date;
end;
$fn$;

comment on function public.historial_notas_pedido is
  'Historial agrupado por dia (hora de Buenos Aires) para "HISTORIAL DE NOTAS DE PEDIDO", en orden de calendario. Trae el numero de vendedor porque el numero de nota lo lleva adelante.';
