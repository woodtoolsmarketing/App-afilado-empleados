/*
 * "ESTOY ACÁ" no puede pisar una dirección que la oficina ya curó.
 *
 * ─── El agujero ──────────────────────────────────────────────────────────────
 *
 * `ubicar_parada` decidía qué hacer mirando la PARADA (`direccion_id is null`)
 * pero escribía sobre el CLIENTE, y `ubicar_cliente` no distingue "cargar por
 * primera vez" de "corregir": si encuentra una fila, hace UPDATE.
 *
 * La ventana no es teórica. Una parada puede nacer sin ubicar y que el cliente
 * SE UBIQUE DESPUÉS, antes de que el vendedor llegue:
 *
 *   Martes   el vendedor agenda al cliente para el jueves. El cliente no tiene
 *            dirección, así que la parada del jueves nace con direccion_id NULL.
 *   Miércol. alguien le carga la dirección: la oficina desde el panel, el
 *            geocodificado en lote, `aplicar_cambio_direccion`, o el propio
 *            vendedor desde otra pantalla. Queda la dirección de Google con
 *            localidad, provincia, código postal y google_place_id.
 *   Jueves   la parada del jueves NO se enteró —nada retroactiva su
 *            direccion_id—, así que la app le sigue mostrando SIN UBICAR y el
 *            botón ESTOY ACÁ. Lo toca parado en la puerta.
 *
 * Y ahí `ubicar_cliente` entraba por el UPDATE: pisaba `direccion_formateada`
 * con el texto crudo del Gestión y dejaba localidad, provincia, código postal y
 * google_place_id en NULL, porque la app sólo los manda cuando geocodificó.
 *
 * ─── Por qué es grave aunque quede auditado ──────────────────────────────────
 *
 * Porque contradice la regla que este sistema sostiene en todos lados: un
 * vendedor NO pisa una dirección ya cargada. Corregirla se manda como PROPUESTA
 * a la oficina (`cambios_direccion`), y la oficina decide. Este camino la
 * salteaba entero, sin propuesta y sin aviso. Que el trigger
 * `auditar_cambio_direccion` lo registre en `clientes_modificaciones` hace que
 * sea reversible, no que esté bien.
 *
 * ─── El arreglo ──────────────────────────────────────────────────────────────
 *
 * Antes de escribir nada se mira si el CLIENTE ya tiene dirección:
 *
 *  · Si la tiene, esta parada simplemente nació antes de que lo ubicaran. Se le
 *    engancha la dirección que YA existe y la ficha no se toca. Es además el
 *    mejor resultado para el vendedor: la parada pasa a tener la dirección buena,
 *    la curada, no el texto viejo.
 *  · Si no la tiene, es un alta de verdad y sigue yendo por `ubicar_cliente`,
 *    igual que antes.
 *
 * Queda una asimetría conocida y aceptada: la app decide mostrar ESTOY ACÁ
 * mirando la parada, así que en el caso de arriba el vendedor toca un botón que
 * promete guardar el punto y lo que pasa es que se engancha el que ya había. El
 * resultado es correcto; el texto se ajusta en el próximo lote.
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
  v_existente public.direcciones;
begin
  select * into v_parada from public.paradas where id = p_parada_id;

  if v_parada.id is null then
    raise exception 'No existe la parada %', p_parada_id using errcode = 'P0002';
  end if;

  if v_parada.cliente_id is null then
    raise exception 'Ese destino no tiene cliente, asi que no hay ficha donde guardar la ubicacion.'
      using errcode = '23514';
  end if;

  /*
   * ¿El cliente YA está en el mapa?
   *
   * Si lo está, esta parada nació antes de que lo ubicaran y lo único que falta
   * es engancharle la dirección que ya existe. NO se toca la ficha: pisar una
   * dirección cargada es una corrección, y las correcciones van por
   * `cambios_direccion` para que las mire la oficina.
   */
  select * into v_existente
    from public.direcciones
   where cliente_id = v_parada.cliente_id
   order by principal desc, creado_en
   limit 1;

  if found then
    update public.paradas
       set direccion_id       = v_existente.id,
           direccion_snapshot = v_existente.direccion_formateada
     where id = p_parada_id
    returning * into v_parada;

    return v_parada;
  end if;

  -- El cliente no tiene ninguna dirección: esto sí es un alta.
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

revoke all on function public.ubicar_parada(uuid, text, double precision, double precision, text, text, text, text) from public, anon;
grant execute on function public.ubicar_parada(uuid, text, double precision, double precision, text, text, text, text) to authenticated;
