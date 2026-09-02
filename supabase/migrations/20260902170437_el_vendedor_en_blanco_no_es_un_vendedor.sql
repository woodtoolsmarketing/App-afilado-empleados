-- =============================================================================
-- Un número de vendedor en blanco no es un número de vendedor
--
-- `regexp_replace` saca ceros, no espacios: un `vendedor_numero` con espacios
-- pasaba el filtro y la nota salía numerada `   -0081`. El lado de TypeScript
-- ya hacía `trim()`; éste no.
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
    -- Sin vendedor cargado se escribe como toda la vida.
    when (select codigo from v) is null then lpad(p_numero::text, 6, '0')
    else
      -- `greatest(largo, N)` es lo que evita el recorte de `lpad`: nunca se
      -- pide menos largo del que el texto ya tiene.
      lpad((select codigo from v), greatest(length((select codigo from v)), 2), '0')
      || '-' ||
      lpad(p_numero::text, greatest(length(p_numero::text), 4), '0')
  end;
$fn$;

comment on function interno.numero_de_nota_impreso(bigint, text) is
  'El numero de nota como va impreso: 02-0081 es la nota 81 del vendedor 2. Sin vendedor cargado, 000081. Nunca recorta ni deja espacios.';

grant execute on function interno.numero_de_nota_impreso(bigint, text) to authenticated;
