-- =============================================================================
-- El vendedor puede corregir la ubicación DE VERDAD
--
-- ── El síntoma ──────────────────────────────────────────────────────────────
--
-- Nadie podía cargar una visita. `visitas` tenía 0 filas contra 5 roles de
-- visita y 12 paradas: el circuito nunca cerró una sola vez en producción.
--
-- El vendedor ubicaba al cliente, veía el cartel verde "Ubicación guardada",
-- tocaba AGREGAR AL RECORRIDO y la app le respondía que el cliente "todavía no
-- está ubicado en el mapa". Volvía a ubicarlo, volvía el tilde verde, volvía el
-- rechazo. En bucle, para siempre.
--
-- ── La causa ────────────────────────────────────────────────────────────────
--
-- La migración 20260811184957 cambió la rama `if found` de `return existente` a
-- un `update ... returning * into resultado`. Fue una decisión deliberada y
-- sigue siendo la correcta: el vendedor es el que está parado en la puerta.
--
-- Lo que faltó fue la policy. `ubicar_cliente` es SECURITY INVOKER, y
-- `public.direcciones` tiene policy de SELECT, de INSERT y de admin — pero
-- ninguna de UPDATE para el vendedor. Con RLS activo y sin policy, Postgres no
-- rechaza el UPDATE: filtra las filas y actualiza cero. Sin error.
--
-- De ahí sale el bucle, en cuatro pasos:
--   1. El UPDATE toca 0 filas, así que `returning` no asigna nada y `resultado`
--      se queda en NULL.
--   2. La función devuelve un composite NULL.
--   3. PostgREST resuelve `returns public.direcciones` como `select * from f()`,
--      y un composite NULL ahí NO es cero filas: es UNA fila con todas las
--      columnas en NULL. La app recibe `error: null`.
--   4. El teléfono festeja: el texto del cartel verde viene de Google, no de la
--      base, así que se ve bien aunque no se haya guardado nada. Pero
--      `direccion_id` quedó en NULL y `agregar_parada` lo rechaza.
--
-- Los 7.296 clientes que YA tienen dirección caen todos en la rama del UPDATE.
-- Y era peor que eso: un cliente que antes se agregaba bien quedaba inagregable
-- apenas alguien tocaba CORREGIR UBICACIÓN, porque el retorno con nulls le
-- pisaba el `direccion_id` bueno que ya tenía. Intentar arreglar una dirección
-- rompía el alta que funcionaba.
--
-- ── El arreglo ──────────────────────────────────────────────────────────────
--
-- Dos piezas, y las dos hacen falta:
--
--   1. La policy que faltaba, con el mismo alcance que la de lectura: si el
--      vendedor puede VER la dirección de un cliente, puede corregirla. No es
--      un permiso nuevo, es el que la migración anterior dio por hecho.
--
--   2. Que la función no pueda volver a mentir. Si después de escribir no hay
--      fila, levanta excepción. Una función que devuelve NULL en silencio es
--      peor que una que falla: el teléfono no tiene forma de notar la
--      diferencia entre "guardado" y "no guardado".
-- =============================================================================

-- ── 1. La policy que faltaba ────────────────────────────────────────────────
--
-- `cliente_id is not null` no excluye nada hoy (las 7.296 filas cuelgan de un
-- cliente) y evita que mañana una dirección propia de la empresa quede editable
-- desde un teléfono por haberse cargado sin dueño.
--
-- USING y WITH CHECK repiten la condición a propósito: USING decide qué filas
-- se pueden tocar, WITH CHECK cómo pueden quedar. Con las dos iguales, el
-- vendedor no puede sacar una dirección del alcance donde la encontró.

create policy direcciones_corregir on public.direcciones
  for update
  to authenticated
  using (
    interno.esta_habilitado()
    and cliente_id is not null
    and exists (select 1 from public.clientes c where c.id = direcciones.cliente_id)
  )
  with check (
    interno.esta_habilitado()
    and cliente_id is not null
    and exists (select 1 from public.clientes c where c.id = direcciones.cliente_id)
  );

comment on policy direcciones_corregir on public.direcciones is
  'El vendedor corrige la dirección del cliente que está visitando. Sin esta '
  'policy, ubicar_cliente actualiza cero filas en silencio y el cliente no '
  'entra nunca al recorrido.';

-- ── 2. La función deja de poder mentir ──────────────────────────────────────
--
-- Mismo cuerpo que la 20260811184957, con dos cambios: las dos ramas dejan el
-- resultado en la misma variable y hay UN control al final. Si algún día
-- vuelve a faltar una policy, el vendedor se entera en el momento en vez de
-- descubrirlo tres pantallas después.

create or replace function public.ubicar_cliente(
  p_cliente_id           uuid,
  p_direccion_formateada text,
  p_lat                  double precision,
  p_lng                  double precision,
  p_codigo_postal        text default null,
  p_google_place_id      text default null,
  p_localidad            text default null,
  p_provincia            text default null
)
returns public.direcciones
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  existente public.direcciones;
  resultado public.direcciones;
begin
  if p_lat is null or p_lng is null then
    raise exception 'Elegi la direccion de la lista de sugerencias de Google.'
      using errcode = '23514';
  end if;

  if length(trim(coalesce(p_direccion_formateada, ''))) < 5 then
    raise exception 'La direccion esta vacia o es demasiado corta.'
      using errcode = '23514';
  end if;

  select * into existente
    from public.direcciones
   where cliente_id = p_cliente_id
   order by principal desc, creado_en
   limit 1;

  if found then
    update public.direcciones
       set direccion_formateada = trim(p_direccion_formateada),
           codigo_postal        = nullif(trim(coalesce(p_codigo_postal, '')), ''),
           localidad            = p_localidad,
           provincia            = p_provincia,
           lat                  = p_lat,
           lng                  = p_lng,
           google_place_id      = p_google_place_id,
           verificada           = true,
           -- La nota del geocodificado en lote ("revisar") ya no aplica: la
           -- acaba de confirmar alguien que estuvo ahí.
           observaciones        = null
     where id = existente.id
     returning * into resultado;
  else
    insert into public.direcciones (
      cliente_id, direccion_formateada, codigo_postal, localidad, provincia,
      lat, lng, google_place_id, verificada, principal, etiqueta
    )
    values (
      p_cliente_id, trim(p_direccion_formateada),
      nullif(trim(coalesce(p_codigo_postal, '')), ''),
      p_localidad, p_provincia, p_lat, p_lng, p_google_place_id,
      true, true, 'Principal'
    )
    returning * into resultado;
  end if;

  -- El control que faltaba. Un UPDATE que RLS filtra no da error: da cero
  -- filas, y `returning` deja la variable en NULL. Sin esto, la función
  -- devuelve un composite NULL que PostgREST convierte en una fila de nulls y
  -- el teléfono muestra un tilde verde sobre un fracaso.
  if resultado.id is null then
    raise exception 'No pudimos guardar la ubicacion del cliente.'
      using errcode = '42501',
            hint = 'Revisa las policies de public.direcciones.';
  end if;

  return resultado;
end;
$function$;

comment on function public.ubicar_cliente is
  'Ubica o corrige la direccion principal de un cliente. Si no puede escribir, '
  'levanta excepcion: nunca devuelve NULL en silencio.';
