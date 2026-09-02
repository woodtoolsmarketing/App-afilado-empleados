-- =============================================================================
-- El número de nota no se recorta cuando no entra
--
-- `lpad` no rellena: RECORTA cuando el texto es más largo que el largo pedido.
-- `lpad('100', 2, '0')` es `10`, y `lpad('12345', 4, '0')` es `1234`.
--
-- Con eso, el vendedor 100 escribía sus notas como si fuera el 10, y la nota
-- 12345 salía numerada 1234 — que es un número que existe y es de otra hoja.
-- Las dos cosas son inventar un comprobante, no un problema de formato.
--
-- El relleno se aplica sólo cuando falta: si ya sobra, el número va entero y
-- el casillero se estira. Un número largo se lee; uno recortado, no se nota.
-- =============================================================================

create or replace function interno.numero_de_nota_impreso(
  p_numero   bigint,
  p_vendedor text
)
returns text
language sql
immutable
as $fn$
  with v as (
    -- Sin los ceros de relleno del Gestion: "007" es el vendedor 7.
    select nullif(regexp_replace(coalesce(p_vendedor, ''), '^0+(?=[0-9])', ''), '') as codigo
  )
  select case
    when p_numero is null then null
    -- Sin vendedor cargado se escribe como toda la vida.
    when (select codigo from v) is null then lpad(p_numero::text, 6, '0')
    else
      -- `greatest(largo, N)` es lo que evita el recorte: nunca se pide menos
      -- largo del que el texto ya tiene.
      lpad((select codigo from v), greatest(length((select codigo from v)), 2), '0')
      || '-' ||
      lpad(p_numero::text, greatest(length(p_numero::text), 4), '0')
  end;
$fn$;

comment on function interno.numero_de_nota_impreso(bigint, text) is
  'El numero de nota como va impreso: 02-0081 es la nota 81 del vendedor 2. Sin vendedor cargado, 000081. Nunca recorta: el vendedor 100 y la nota 12345 salen enteros.';

grant execute on function interno.numero_de_nota_impreso(bigint, text) to authenticated;
