-- =============================================================================
-- La función temporal que recibe el padrón del Gestión Comercial
--
-- Va de la mano de `herramientas/importar-clientes.mjs`. El script manda el CSV
-- por acá, en tandas de 400.
--
-- ── Por qué está en herramientas/ y no en supabase/migrations/ ───────────────
--
-- Porque NO tiene que quedar puesta. Es `security definer` y escribe en
-- `clientes` salteando RLS; mientras exista, cualquiera que tenga la clave
-- anónima y el secreto puede cargar clientes. Si viviera en migrations se
-- aplicaría sola en cada `db reset` y quedaría instalada para siempre.
--
-- El trato es: se crea, se importa, se borra. Las tres cosas a mano.
--
-- ── Cómo se usa ─────────────────────────────────────────────────────────────
--
--   1. Elegí un secreto de una vez y ponelo en LOS DOS lados: reemplazá
--      PONER-EL-SECRETO-ACA acá abajo, y exportá el mismo valor:
--
--          export SECRETO_IMPORTACION='...'
--
--   2. Corré ESTE archivo entero en el SQL Editor de Supabase.
--
--   3. Corré el importador con el CSV exportado del Gestión:
--
--          node herramientas/importar-clientes.mjs Listado-clientes.csv
--
--   4. Borrá la función. Esto no es opcional:
--
--          drop function if exists public.importar_clientes_temporal(text, jsonb);
--
-- ── Qué hace con lo que ya está cargado ─────────────────────────────────────
--
-- Va por `codigo`, que es único. Si el cliente no está, lo crea. Si está, le
-- pisa los campos que trae el listado y le deja los que el listado no conoce:
--
--   · `cuit` y `documento` no se tocan NUNCA. El listado del Gestión no trae
--     CUIT, y pisarlos con vacío borraría los que se cargaron después a mano.
--   · `activo` no se toca. Un cliente que desapareció del listado no se da de
--     baja solo: si estaba en un recorrido, desaparecería del rol sin aviso.
--     Las bajas se hacen desde el panel de Clientes, de a una y mirando.
--   · `vendedor_id` no se toca: lo asigna la oficina, no el Gestión.
--   · Los campos de texto que vienen vacíos se guardan como NULL, no como ''.
--
-- Es idempotente: correrla dos veces con el mismo archivo deja lo mismo.
-- =============================================================================

create or replace function public.importar_clientes_temporal(secreto text, datos jsonb)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  cuantos integer;
begin
  if secreto is distinct from 'PONER-EL-SECRETO-ACA' then
    raise exception 'Secreto incorrecto';
  end if;

  with entrada as (
    select
      -- Los códigos se guardan sin los ceros de relleno: "00000001003" es
      -- "1003", que es como lo dice la oficina y como sale impreso.
      regexp_replace(btrim(f->>'codigo'), '^0+(?=[0-9])', '')  as codigo,
      btrim(f->>'razon_social')                                 as razon_social,
      nullif(btrim(coalesce(f->>'nombre_fantasia', '')), '')    as nombre_fantasia,
      nullif(btrim(coalesce(f->>'contacto', '')), '')           as contacto_nombre,
      nullif(btrim(coalesce(f->>'telefono', '')), '')           as telefono,
      nullif(btrim(coalesce(f->>'email', '')), '')              as email,
      nullif(btrim(coalesce(f->>'domicilio', '')), '')          as direccion,
      nullif(btrim(coalesce(f->>'localidad', '')), '')          as localidad,
      nullif(btrim(coalesce(f->>'cp', '')), '')                 as codigo_postal,
      -- "Zona" y "Datos de entrega" no tienen columna propia: van a las notas
      -- para no perderlas. La zona viene como texto ("ZONA LA PLATA TIT"), no
      -- como el número de la nota de pedido; ese lo resuelve la localidad.
      nullif(btrim(concat_ws(' · ',
        nullif(btrim(coalesce(f->>'notas', '')), ''),
        nullif(btrim(coalesce(f->>'entrega', '')), '')
      )), '')                                                   as notas
    from jsonb_array_elements(datos) f
    where btrim(coalesce(f->>'codigo', '')) <> ''
      and btrim(coalesce(f->>'razon_social', '')) <> ''
  ),
  -- El CSV puede traer el mismo código dos veces, y `on conflict` no tolera dos
  -- filas con la misma clave en el mismo comando: revienta la tanda entera. Se
  -- queda una sola, la primera por razón social — no porque esa sea "la buena",
  -- sino para que elegir sea determinístico y correrlo de nuevo dé lo mismo.
  unicos as (
    select distinct on (codigo) * from entrada order by codigo, razon_social
  ),
  guardados as (
    insert into public.clientes as c (
      codigo, razon_social, nombre_fantasia, contacto_nombre,
      telefono, email, direccion, localidad, codigo_postal, notas
    )
    select
      codigo, razon_social, nombre_fantasia, contacto_nombre,
      telefono, email, direccion, localidad, codigo_postal, notas
    from unicos
    on conflict (codigo) do update set
      razon_social    = excluded.razon_social,
      nombre_fantasia = excluded.nombre_fantasia,
      contacto_nombre = excluded.contacto_nombre,
      telefono        = excluded.telefono,
      email           = excluded.email,
      direccion       = excluded.direccion,
      localidad       = excluded.localidad,
      codigo_postal   = excluded.codigo_postal,
      notas           = excluded.notas,
      actualizado_en  = now()
    returning 1
  )
  select count(*) into cuantos from guardados;

  return cuantos;
end;
$$;

revoke all on function public.importar_clientes_temporal(text, jsonb) from public;
grant execute on function public.importar_clientes_temporal(text, jsonb) to anon, authenticated;

comment on function public.importar_clientes_temporal(text, jsonb) is
  'TEMPORAL. Carga el padron del Gestion Comercial. Borrala apenas termine la importacion: escribe en clientes salteando RLS.';
