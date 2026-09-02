-- =============================================================================
-- La rama sin vendedor tampoco se recorta
--
-- Las dos ramas con prefijo se blindaron contra el recorte de `lpad`, pero la
-- tercera —la de las notas viejas, sin `vendedor_numero`— se quedó con el
-- `lpad(p_numero::text, 6, '0')` de siempre. `lpad('1234567', 6, '0')` es
-- '123456': pasada la nota 999999 la base escribiría un número que es de otra
-- hoja, que es exactamente lo que la migración de recién vino a sacar.
--
-- Y ahí además se separaba de TypeScript, donde `numeroDeNotaImpreso` usa
-- `padStart(6)`, que nunca trunca. La hoja impresa y el aviso cruzado entre
-- notas hermanas quedarían escribiendo números distintos para la misma nota.
--
-- El talonario va por la 81, así que esto no le pasa a nadie hoy. Se arregla
-- igual: son cuatro caracteres y el que se lo encuentre no va a poder verlo.
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
    -- Sin espacios y sin los ceros de relleno del Gestion: "007" es el 7.
    select nullif(
             regexp_replace(btrim(coalesce(p_vendedor, '')), '^0+(?=[0-9])', ''),
             ''
           ) as codigo
  )
  select case
    when p_numero is null then null
    -- Sin vendedor cargado se escribe como toda la vida, con seis ceros.
    when (select codigo from v) is null
      then lpad(p_numero::text, greatest(length(p_numero::text), 6), '0')
    else
      -- `greatest(largo, N)` es lo que evita el recorte de `lpad`: nunca se
      -- pide menos largo del que el texto ya tiene.
      lpad((select codigo from v), greatest(length((select codigo from v)), 2), '0')
      || '-' ||
      lpad(p_numero::text, greatest(length(p_numero::text), 4), '0')
  end;
$fn$;

comment on function interno.numero_de_nota_impreso(bigint, text) is
  'El numero de nota como va impreso: 02-0081 es la nota 81 del vendedor 2. Sin vendedor cargado, 000081. Nunca recorta, en ninguna de las dos ramas, ni deja espacios.';

grant execute on function interno.numero_de_nota_impreso(bigint, text) to authenticated;
