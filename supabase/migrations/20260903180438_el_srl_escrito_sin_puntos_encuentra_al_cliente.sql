-- =============================================================================
-- El "SRL" escrito sin puntos encuentra al cliente cargado con puntos
--
-- La tanda anterior normalizó acentos y espacios en los dos lados de la
-- comparación, pero dejó afuera la puntuación. `interno.normalizar_busqueda`
-- pasa a minúsculas, saca los acentos y colapsa espacios; los puntos, guiones y
-- barras quedan donde estaban. Y la razón social se compara palabra por
-- palabra, como substring.
--
-- El resultado es que la sigla legal tiene que tipearse EXACTAMENTE como la
-- cargó la oficina. Medido contra el padrón de hoy:
--
--     "insis srl"     →  0        "insis s.r.l."     →  1   (código 10)
--     "faplac sa"     →  0        "faplac s.a."      →  2   (código 5798)
--     "raices srl"    →  0        "raices s.r.l."    →  1   (código 10014)
--     "delmag srl"    →  0        "delmag s.r.l."    →  1   (código 12854)
--     "lunaplast sa"  →  0        "lunaplast s.a."   →  1   (código 12981)
--
-- No es un rincón del padrón: 2.951 clientes tienen alguna puntuación en el
-- nombre, 921 llevan "S.R.L" con puntos y 817 "S.A". Contando exacto sobre las
-- 12.181 filas, 2.472 dejan de coincidir si el vendedor escribe la sigla
-- pegada, que es como se escribe cuando uno la escribe rápido.
--
-- Dicho con todas las letras, porque la auditoría lo midió: de esos 2.472, la
-- enorme mayoría igual aparece si el vendedor larga la sigla y escribe sólo el
-- nombre ("insis" devuelve 1). Los que quedan de verdad tapados son alrededor
-- de cien. Lo que se arregla acá no es tanto "no aparece" como "aparece si
-- adivinás cómo lo cargó la oficina", y eso es lo que el vendedor lee como que
-- el cliente no está.
--
-- ── Cómo ────────────────────────────────────────────────────────────────────
--
-- La puntuación se BORRA, no se reemplaza por espacio. Con espacio, "s.r.l."
-- quedaría "s r l" y "srl" seguiría sin coincidir: sería el mismo problema al
-- revés. Borrando, queda "srl" y coincide con las dos formas de tipearlo,
-- porque "s.r.l." tipeado también se borra a "srl".
--
-- Borrar tampoco rompe lo que ya andaba: "COOP.DE TRABAJO" queda "coopde
-- trabajo" y sigue saliendo con "coop de trabajo", porque "coop" es substring
-- de "coopde".
--
-- ── Por qué una columna nueva y no cambiar la que hay ───────────────────────
--
-- Calcular el despuntuado al vuelo cuesta el índice: medido sobre esta misma
-- base, `busqueda like '%grande%'` son 0,3 ms con Bitmap Index Scan, y
-- `regexp_replace(busqueda, ...) like '%grande%'` son 15,9 ms con Seq Scan
-- descartando 12.174 filas — y eso es UN predicado de los varios que tiene la
-- función. Es la misma regresión de 372 ms que ya está documentada en
-- 20260903163051.
--
-- Y no se toca `interno.normalizar_busqueda` ni la columna `busqueda` porque
-- son la definición de una columna `generated`: cambiarlas obliga a tirar la
-- columna y el índice y reescribir la tabla entera, con los dos lados de la
-- comparación cambiando a la vez y sin vuelta atrás barata. Agregar al lado
-- sale igual de rápido y se revierte borrando.
--
-- `busqueda` y sus dos índices quedan donde están aunque esta función ya no los
-- use: sacarlos es una decisión aparte, y mientras estén, volver atrás esta
-- migración es cambiar una sola función.
--
-- Medido con el arreglo puesto, para que se vea que no infla las búsquedas
-- normales — sólo aparecen las que hoy dan cero:
--
--                      hoy   con esto
--     "acuna"            8       8
--     "torres"          51      51
--     "amoblamientos"  139     139
--     "gonzalez"       101     101
--     "raices srl"       0       2
--     "insis srl"        0       1
--     "mader tech srl"   0       1
-- =============================================================================

alter table public.clientes
  add column if not exists busqueda_plana text
  generated always as (
    btrim(regexp_replace(
      regexp_replace(
        interno.normalizar_busqueda(
          coalesce(razon_social, '') || ' ' || coalesce(nombre_fantasia, '') || ' ' || codigo
        ),
        -- Se borra todo lo que no sea letra, número o espacio. El acento ya no
        -- llega hasta acá: lo sacó `normalizar_busqueda`.
        '[^a-z0-9 ]', '', 'g'),
      -- "A . B" pierde el punto y queda con dos espacios: se vuelven a colapsar.
      '\s+', ' ', 'g'))
  ) stored;

comment on column public.clientes.busqueda_plana is
  'Lo mismo que busqueda pero sin puntuacion: razon social + fantasia + codigo, en minusculas, sin acentos, sin puntos ni guiones y con los espacios colapsados. Es contra esto que compara buscar_clientes.';

drop index if exists public.clientes_busqueda_plana_idx;
create index clientes_busqueda_plana_idx
  on public.clientes using gin (busqueda_plana gin_trgm_ops);

-- ── La función, igual que antes pero comparando contra la columna sin puntos ──

create or replace function public.buscar_clientes(p_texto text, p_limite integer default 15)
returns table (
  cliente_id uuid, codigo text, razon_social text, nombre_fantasia text, cuit text,
  contacto_nombre text, telefono text, email text, provisorio boolean, vendedor_id uuid,
  direccion_id uuid, direccion text, codigo_postal text, lat double precision,
  lng double precision, localidad text, provincia text
)
language sql
stable
set search_path to 'public', 'pg_temp'
as $fn$
  with q as (
    select
      -- El texto tipeado pasa por la MISMA cocina que la columna: minúsculas,
      -- sin acentos, sin puntuación, espacios colapsados. Que los dos lados se
      -- traten igual es toda la idea.
      btrim(regexp_replace(
        regexp_replace(interno.normalizar_busqueda(p_texto), '[^a-z0-9 ]', '', 'g'),
        '\s+', ' ', 'g')) as t,
      regexp_replace(coalesce(p_texto, ''), '[^0-9]', '', 'g') as digitos
  ),
  p as (
    select
      q.t,
      q.digitos,
      array_remove(string_to_array(q.t, ' '), '') as palabras,
      -- La palabra más larga es la que se le pide al índice: es la que menos
      -- filas devuelve. Las demás filtran después, sobre esas pocas.
      (select w from unnest(string_to_array(q.t, ' ')) w
        where w <> '' order by length(w) desc, w limit 1) as mayor
    from q
  )
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
  cross join p
  left join lateral (
    select * from public.direcciones dd
     where dd.cliente_id = c.id
     order by dd.principal desc, dd.creado_en
     limit 1
  ) d on true
  where c.activo
    and (
      -- Todas las palabras, en cualquier orden, contra el nombre ya guardado
      -- en minúsculas, sin acentos y sin puntuación.
      (
        p.mayor is not null
        and c.busqueda_plana like '%' || p.mayor || '%'
        and not exists (
          select 1 from unnest(p.palabras) w
           where c.busqueda_plana not like '%' || w || '%'
        )
      )
      -- Tres dígitos o más: puede ser un CUIT.
      or (
        length(p.digitos) >= 3
        and regexp_replace(coalesce(c.cuit, ''), '[^0-9]', '', 'g')
              like '%' || p.digitos || '%'
      )
      -- Seis o más: puede ser un teléfono, y se busca por los últimos seis.
      or (
        length(p.digitos) >= 6
        and regexp_replace(
              regexp_replace(
                regexp_replace(coalesce(c.telefono, ''), '[ ()+.-]', '', 'g'),
                '([0-9]{6})[^0-9]+', '\1 ', 'g'),
              '[^0-9 ]', '', 'g')
            like '%' || right(p.digitos, 6) || '%'
      )
    )
  order by
    (c.codigo = btrim(coalesce(p_texto, ''))) desc,
    (length(p.digitos) >= 3
      and regexp_replace(coalesce(c.cuit, ''), '[^0-9]', '', 'g') <> ''
      and regexp_replace(coalesce(c.cuit, ''), '[^0-9]', '', 'g') = p.digitos) desc,
    (c.codigo like btrim(coalesce(p_texto, '')) || '%') desc,
    (c.busqueda_plana like p.t || '%') desc,
    (case
       when p.t ~ '^[0-9]+$'
       then c.busqueda_plana ~ ('(^|[^0-9])' || p.t || '([^0-9]|$)')
     end) desc,
    (c.codigo like '%' || btrim(coalesce(p_texto, '')) || '%') desc,
    case
      when c.codigo like '%' || btrim(coalesce(p_texto, '')) || '%'
      then lpad(c.codigo, 8, '0')
    end,
    c.razon_social,
    lpad(c.codigo, 8, '0')
  limit least(coalesce(p_limite, 15), 50);
$fn$;

comment on function public.buscar_clientes(text, integer) is
  'Busca por codigo, razon social, nombre de fantasia, CUIT o telefono. El texto se normaliza —sin acentos, sin puntuacion, espacios colapsados— y se exigen TODAS las palabras en cualquier orden.';

grant execute on function public.buscar_clientes(text, integer) to authenticated;
