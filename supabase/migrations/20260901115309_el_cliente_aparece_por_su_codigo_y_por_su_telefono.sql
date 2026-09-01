-- =============================================================================
-- El cliente no aparecía por su código. La lista salía ordenada por NOMBRE.
--
-- `buscar_clientes` ordenaba así:
--
--     order by (codigo ilike q) desc,        -- el código EXACTO primero
--              (cuit = digitos) desc,
--              razon_social                  -- y todo lo demás, alfabético
--
-- El primer renglón sólo salva al que escribe el código entero. En cuanto falta
-- un dígito, los candidatos se ordenan por razón social y se cortan en 15.
-- El código —lo único que el vendedor escribió— no ordena nada.
--
-- Medido sobre el padrón, con 300 clientes al azar: escribir su código SIN EL
-- ÚLTIMO DÍGITO no encontraba a 72 de ellos. **Uno de cada cuatro.**
--
-- Se veía claro buscando "1048":
--
--     1048  LA COLMENA         10486 DEL MONTE        11048 SARLI
--     10482 ALCETEGARAY        10489 KOSAKIEWICZ      12682 SURBO
--     10488 ALMADA             10484 LUTANO           10481 TORRES
--     10483 BERTIN             10485 PAGANO           10487 VENTIMIGLIA
--                              10480 SANABRIA
--
-- Trece resultados en orden alfabético de apellido. Con un dígito menos son 103
-- candidatos, entran 15, y cuál de los 103 se ve lo decide la inicial del
-- apellido. El vendedor escribe el código que tiene anotado y su cliente no
-- está, sin ninguna razón visible.
--
-- ── El orden nuevo: por lo que se escribió ───────────────────────────────────
--
--   1. El código exacto.
--   2. El CUIT exacto.
--   3. Los códigos que EMPIEZAN con lo tipeado, en orden de código.
--   4. Los nombres que empiezan con lo tipeado.
--   5. Los códigos que lo contienen en el medio.
--   6. El resto, alfabético como siempre.
--
-- Con eso, "1048" devuelve 1048, 10480, 10481 … 10489, 11048, 12682. Y de los
-- 300 clientes del ensayo, los que se perdían escribiendo el código sin el
-- último dígito pasaron de 72 a CERO.
--
-- Con tres dígitos de un código de cinco todavía se pierden algunos, y es
-- inevitable: son más de cien candidatos y la lista muestra quince. Lo que
-- cambia es que ahora esos quince son los quince primeros POR CÓDIGO, así que
-- se ve enseguida que hay que escribir un dígito más. La app además lo dice.
--
-- ── Y el teléfono, que no se buscaba ─────────────────────────────────────────
--
-- 11.357 de los 12.181 clientes tienen teléfono cargado —el 93 %— y la consulta
-- no lo miraba. Buscar "4276-0735" devolvía CERO resultados; ahora devuelve a
-- SOSA MIGUEL, código 8408.
--
-- Se compara por dígitos, como el CUIT: en el padrón están escritos de todas
-- las formas —"4276-0735", "0341-15-5525508", "02284-15554934 / 02284-451489"—
-- y 2.676 traen dos números en el mismo campo.
--
-- Hacen falta SEIS dígitos para que el teléfono entre en la búsqueda. Con menos,
-- un código de cuatro cifras engancharía medio padrón por coincidir con un
-- pedazo de cualquier número.
--
-- El conjunto de resultados no pierde nada: es exactamente el de antes más los
-- que aparecen por teléfono. Verificado en doce formas de consulta.
-- =============================================================================

-- ── El índice del teléfono ───────────────────────────────────────────────────
--
-- Mismo motivo que el del CUIT: un brazo del OR que no se puede resolver por
-- índice arrastra a los demás y devuelve la consulta al barrido de las 12.181
-- filas. La expresión es la MISMA que la del WHERE, carácter por carácter.
create index if not exists clientes_telefono_digitos_idx on public.clientes
  using gin ((regexp_replace(coalesce(telefono, ''), '[^0-9]', '', 'g')) gin_trgm_ops);

create or replace function public.buscar_clientes(p_texto text, p_limite integer default 15)
returns table (
  cliente_id uuid, codigo text, razon_social text, nombre_fantasia text, cuit text,
  contacto_nombre text, telefono text, email text, provisorio boolean, vendedor_id uuid,
  direccion_id uuid, direccion text, codigo_postal text, lat double precision,
  lng double precision, localidad text, provincia text
)
language sql stable security invoker
set search_path = public, pg_temp
as $fn$
  select
    c.id, c.codigo, c.razon_social, c.nombre_fantasia, c.cuit,
    c.contacto_nombre, c.telefono, c.email, c.provisorio, c.vendedor_id,
    d.id,
    coalesce(d.direccion_formateada, c.direccion),
    coalesce(d.codigo_postal, c.codigo_postal),
    d.lat, d.lng,
    coalesce(d.localidad, c.localidad),
    d.provincia
  from public.clientes c
  left join lateral (
    select * from public.direcciones dd
     where dd.cliente_id = c.id
     order by dd.principal desc, dd.creado_en
     limit 1
  ) d on true
  where c.activo
    and (
      (
        -- Superconjunto barato: repite letra por letra la expresión de
        -- `clientes_busqueda_idx`. Cada columna es subcadena del concat, así
        -- que no puede dejar afuera nada que el filtro de abajo encontraría.
        (coalesce(c.razon_social, '') || ' ' || coalesce(c.nombre_fantasia, '') || ' ' || c.codigo)
          ilike '%' || trim(coalesce(p_texto, '')) || '%'
        -- Y acá se decide de verdad, columna por columna. Sin esto, buscar
        -- "sa 1" traería clientes donde el "sa" está en la razón social y el
        -- "1" en el código.
        and (
          c.codigo ilike '%' || trim(coalesce(p_texto, '')) || '%'
          or c.razon_social ilike '%' || trim(coalesce(p_texto, '')) || '%'
          or coalesce(c.nombre_fantasia, '') ilike '%' || trim(coalesce(p_texto, '')) || '%'
        )
      )
      -- El CUIT, sin guiones: la gente lo tipea de las dos formas. El `case`
      -- sin `else` da NULL con menos de tres dígitos, y `x like null` es null,
      -- así que el brazo no engancha nada y el planner lo mete igual en el
      -- índice.
      or regexp_replace(coalesce(c.cuit, ''), '[^0-9]', '', 'g') like
         case
           when length(regexp_replace(coalesce(p_texto, ''), '[^0-9]', '', 'g')) >= 3
           then '%' || regexp_replace(coalesce(p_texto, ''), '[^0-9]', '', 'g') || '%'
         end
      -- El teléfono, igual pero desde SEIS dígitos: con menos, un código de
      -- cuatro cifras engancharía medio padrón.
      or regexp_replace(coalesce(c.telefono, ''), '[^0-9]', '', 'g') like
         case
           when length(regexp_replace(coalesce(p_texto, ''), '[^0-9]', '', 'g')) >= 6
           then '%' || regexp_replace(coalesce(p_texto, ''), '[^0-9]', '', 'g') || '%'
         end
    )
  order by
    -- 1. El código exacto: si lo escribió entero, es ése.
    (c.codigo = trim(coalesce(p_texto, ''))) desc,
    -- 2. El CUIT exacto.
    (regexp_replace(coalesce(c.cuit, ''), '[^0-9]', '', 'g') <> ''
      and regexp_replace(coalesce(c.cuit, ''), '[^0-9]', '', 'g')
          = regexp_replace(coalesce(p_texto, ''), '[^0-9]', '', 'g')) desc,
    -- 3. Los códigos que EMPIEZAN con lo tipeado. Éste es el renglón que
    --    faltaba: es el que hace que escribir "1048" traiga los 1048x.
    (c.codigo like trim(coalesce(p_texto, '')) || '%') desc,
    -- 4. Los nombres que empiezan con lo tipeado, antes que los que lo tienen
    --    en el medio: quien escribe "MADER" busca "MADERERA…", no
    --    "LA CASA DEL MADERO".
    (c.razon_social ilike trim(coalesce(p_texto, '')) || '%'
      or coalesce(c.nombre_fantasia, '') ilike trim(coalesce(p_texto, '')) || '%') desc,
    -- 5. Los códigos que lo contienen en el medio.
    (c.codigo like '%' || trim(coalesce(p_texto, '')) || '%') desc,
    -- 6. Dentro de los que engancharon por CÓDIGO, en orden de código y el más
    --    corto primero —"1048" antes que "10480"—. `lpad` para que ordene como
    --    número y no como texto. Para los que engancharon por nombre esto da
    --    NULL y decide la razón social, alfabético como siempre.
    case
      when c.codigo like '%' || trim(coalesce(p_texto, '')) || '%'
      then lpad(c.codigo, 8, '0')
    end,
    c.razon_social
  limit least(coalesce(p_limite, 15), 50);
$fn$;

comment on function public.buscar_clientes is
  'Clientes que coinciden por codigo, razon social, fantasia, CUIT o telefono. Ordena por lo que se escribio: codigo exacto, despues los que empiezan con eso, despues los nombres. El concat indexado achica y el filtro por columna decide.';
