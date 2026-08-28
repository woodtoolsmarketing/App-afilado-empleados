-- =============================================================================
-- El buscador de clientes no estaba usando su índice. Nunca lo usó.
--
-- `clientes_busqueda_idx` existe desde el día uno (20260803183456_tablas_base):
-- es un GIN trigram sobre UNA expresión, la concatenación de los tres campos.
--
--   (coalesce(razon_social,'') || ' ' || coalesce(nombre_fantasia,'') || ' ' || codigo)
--
-- Pero `buscar_clientes` filtra con tres ILIKE SEPARADOS, uno por columna.
-- Postgres sólo usa un índice de expresión cuando el predicado repite la
-- expresión carácter por carácter; tres ILIKE sueltos unidos con OR no la
-- repiten. El índice quedaba de adorno: 5 MB manteniéndose en cada alta y cada
-- corrección de un cliente, para nada, y cada búsqueda barría las 12.181 filas.
--
-- El vendedor no ve "45 ms". Ve que tipea el código y la lista tarda, y como el
-- buscador salía a preguntar en cada pausa entre teclas, esas búsquedas se
-- pisaban entre ellas.
--
-- ── Por qué no alcanza con comparar contra el concat ─────────────────────────
--
-- La tentación es escribir el WHERE como una sola comparación contra la misma
-- concatenación que indexa. Es más corto, usa el índice, y ESTÁ MAL: inventa
-- coincidencias que cruzan el borde entre dos campos. Medido sobre el padrón:
--
--     'a 1'      21 clientes de verdad  →  110 con el concat
--     's 2'       0                     →   20
--     'sa 1'      1                     →   12
--
-- El cliente 3250 —razón social "EFOCOR SA", fantasía "16/3r"— aparecería
-- buscando 'sa 1', porque el concat dice "EFOCOR SA 16/3r 3250". Ninguna de sus
-- columnas contiene "sa 1". Y como la lista sale ordenada por razón social y
-- cortada en 15, esas filas inventadas ordenan antes y EMPUJAN AFUERA al cliente
-- que el vendedor buscaba. O sea: la "optimización" produce más de lo que vino a
-- arreglar.
--
-- ── Lo que sí se hace ────────────────────────────────────────────────────────
--
-- El concat se usa sólo como SUPERCONJUNTO barato, y adentro se vuelve a filtrar
-- columna por columna como siempre. Es correcto por construcción: cada columna
-- es una subcadena del concat, así que lo que encontrarían los tres ILIKE está
-- garantizado adentro de lo que encuentra el concat. El índice achica de 12.181
-- a un puñado, y el filtro exacto decide sobre ese puñado.
--
-- Medido en producción, con el texto como parámetro —que es como lo llama la
-- app, no como literal—:
--
--     código 10484     48,6 ms  →   0,70 ms
--     código 7759      47,9 ms  →   0,63 ms
--     nombre LUTANO    43,9 ms  →   0,70 ms
--     nombre carpint   46,0 ms  →   6,64 ms
--     nombre MADER     47,7 ms  →  11,94 ms
--
-- Y lo que empeora, dicho con todas las letras: los textos de DOS letras, donde
-- el trigram no tiene con qué achicar y el filtro exacto es trabajo de más.
--
--     'SA'   50,2 ms  →  65,9 ms
--     'ma'   68,2 ms  →  83,1 ms
--     '10'   47,7 ms  →  51,2 ms
--
-- Se acepta: son 15 ms sobre estados de paso —nadie termina de buscar con dos
-- letras, la lista sale cortada en 15 de miles— y lo que gana son las búsquedas
-- que el vendedor sí completa. El texto vacío no llega nunca desde la app, que
-- pide dos caracteres antes de salir.
--
-- La equivalencia se verificó contra la función vieja en 19 formas de consulta
-- —códigos, nombres, con acento, con guiones, de dos letras, vacías, con
-- espacios en el medio, sin resultados—: mismo contenido y mismo orden en todas.
-- =============================================================================

-- ── El índice que faltaba ────────────────────────────────────────────────────
--
-- Sin éste no sirve nada de lo demás. El brazo del CUIT es el único que no se
-- puede resolver por índice, y en un OR eso no se paga solo: arrastra al brazo
-- del nombre, que sí tiene el suyo, y el planner vuelve al barrido completo.
--
-- Pesa 40 kB: sólo 7 de los 12.181 clientes tienen CUIT cargado. La expresión
-- es la MISMA que la del WHERE, carácter por carácter; si se toca una hay que
-- tocar la otra, o el índice se vuelve de adorno como el anterior y nada falla a
-- la vista.
create index if not exists clientes_cuit_digitos_idx on public.clientes
  using gin ((regexp_replace(coalesce(cuit, ''), '[^0-9]', '', 'g')) gin_trgm_ops);

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
        -- Superconjunto barato, y es el ÚNICO renglón que mira un índice:
        -- repite letra por letra la expresión de `clientes_busqueda_idx`.
        -- Cada columna es subcadena del concat, así que no puede dejar afuera
        -- nada que el filtro de abajo fuera a encontrar.
        (coalesce(c.razon_social, '') || ' ' || coalesce(c.nombre_fantasia, '') || ' ' || c.codigo)
          ilike '%' || trim(coalesce(p_texto, '')) || '%'
        -- Y acá se decide de verdad, columna por columna: es la semántica de
        -- siempre. Sin esto, buscar "sa 1" traería clientes donde el "sa" está
        -- en la razón social y el "1" en el código.
        and (
          c.codigo ilike '%' || trim(coalesce(p_texto, '')) || '%'
          or c.razon_social ilike '%' || trim(coalesce(p_texto, '')) || '%'
          or coalesce(c.nombre_fantasia, '') ilike '%' || trim(coalesce(p_texto, '')) || '%'
        )
      )
      -- El CUIT se compara sin guiones: la gente lo tipea de las dos formas.
      --
      -- El `case` sin `else` devuelve NULL con menos de tres dígitos, y
      -- `x like null` es null, así que ese brazo no engancha nada. Hace lo
      -- mismo que el `solo_digitos <> '' and length >= 3` de antes, pero como
      -- una sola expresión que el planner puede meter en el índice.
      or regexp_replace(coalesce(c.cuit, ''), '[^0-9]', '', 'g') like
         case
           when length(regexp_replace(coalesce(p_texto, ''), '[^0-9]', '', 'g')) >= 3
           then '%' || regexp_replace(coalesce(p_texto, ''), '[^0-9]', '', 'g') || '%'
         end
    )
  order by
    (c.codigo ilike trim(coalesce(p_texto, ''))) desc,
    (regexp_replace(coalesce(c.cuit, ''), '[^0-9]', '', 'g')
       = regexp_replace(coalesce(p_texto, ''), '[^0-9]', '', 'g')) desc,
    c.razon_social
  limit least(coalesce(p_limite, 15), 50);
$fn$;

comment on function public.buscar_clientes is
  'Clientes que coinciden con el texto por codigo, razon social, fantasia o CUIT. El concat indexado achica y el filtro por columna decide: tocar uno sin el otro cambia los resultados o vuelve al barrido de las 12.181 filas.';
