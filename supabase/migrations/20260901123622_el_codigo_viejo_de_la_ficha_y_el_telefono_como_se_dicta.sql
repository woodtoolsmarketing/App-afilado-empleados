-- =============================================================================
-- Tres agujeros del buscador que salieron de auditar la migración anterior.
-- Uno de los tres lo abrí yo en esa misma migración.
--
-- ── 1. El código VIEJO que la oficina anota en la ficha ──────────────────────
--
-- La oficina usa `nombre_fantasia` como libreta del código anterior: "EX 834",
-- "AHORA 12028", "ver cod 937", "VER CD 306", "****EX 381****". Son 240
-- clientes. Es exactamente el caso del vendedor que tiene el número anotado en
-- un papel de hace dos años.
--
-- La migración anterior puso PRIMERO todo lo que engancha por código —el que
-- empieza con lo tipeado y el que lo contiene en el medio— y recién después lo
-- que engancha por nombre. Con un código viejo de tres dígitos hay decenas de
-- códigos actuales que lo contienen, y los quince lugares se llenan antes de
-- llegar al cliente que lo tiene escrito en la ficha.
--
-- Buscando "834", con la función anterior:
--
--     puesto  1 al 21   8340, 8341 … 14834   (códigos que contienen 834)
--     puesto 22         AGLOLAM S.A.      fantasía "EX 834"
--     puesto 23         FONTAU HNOS.      fantasía "EX 834 EN PRESUP"
--
-- Con quince lugares no entra ninguno de los dos. Antes de esa migración
-- AGLOLAM salía PRIMERO. O sea: es el síntoma que el dueño reportó —"a veces
-- por número no aparecen"— y lo empeoramos nosotros.
--
-- Se arregla con una clave nueva: el número escrito ENTERO en la ficha ordena
-- por encima del código que sólo lo contiene de casualidad. Que "834" esté en
-- el medio de 12834 es casualidad; que esté escrito en la ficha lo puso alguien
-- a mano.
--
-- Va con una expresión regular delimitada por no-dígitos, y NO con un `ilike
-- '%834%'`, que también levantaría "EX 1840" y "ex 8306" —el mismo azar, movido
-- al lado del nombre—. Y sólo cuando lo tipeado son TODOS dígitos: eso mantiene
-- el texto del vendedor lejos del motor de expresiones regulares.
--
--     código viejo en la ficha:  218 de 240  →  239 de 240
--
-- ── 2. El teléfono como se dicta hoy ─────────────────────────────────────────
--
-- 1.299 clientes tienen el teléfono en el formato viejo: cero, característica,
-- **15**, y el número local. "0261-154158709". Hoy el cliente te lo dicta sin
-- el 15: "261 4158709". Se tipea entero y no aparece, porque el 15 está en el
-- medio de lo guardado y la comparación es por subcadena.
--
--     buscar_clientes('2614158709')  →  cero resultados
--     y PISSIS SA, código 11205, tiene justo ese teléfono.
--
-- Cero resultados es peor que quince equivocados: es lo que hace que el
-- vendedor toque "¿Es nuevo cliente?" y la oficina termine con dos fichas del
-- mismo taller.
--
-- Se compara por los ÚLTIMOS SEIS dígitos, que es el número local. No hace
-- falta adivinar dónde termina la característica ni si el 15 está o no: el
-- final del número es el mismo en los dos formatos. Medido sobre 300 clientes
-- con el formato viejo, tipeando el número como se dicta hoy:
--
--     últimos 6 dígitos → 298 de 300      últimos 7 → 157      últimos 8 → 54
--
-- Y no trae basura: un teléfono cualquiera del padrón devuelve 1,15 clientes en
-- promedio, y 3 en el peor caso.
--
--     teléfono viejo dictado como hoy:  0 de 200  →  199 de 200
--
-- ── 3. Los dos teléfonos pegados inventaban clientes ─────────────────────────
--
-- 2.676 fichas traen dos números en el mismo campo. Sacando todo lo que no es
-- dígito quedaban pegados en un solo chorizo, y la COSTURA entre los dos
-- formaba números que no existen:
--
--     PINTOS GUSTAVO, "113329-2764 / 4204-4147"  →  "1133292764 42044147"
--
-- Buscando "764420" aparecía junto a tres clientes de Posadas que sí lo tienen,
-- porque el final del primero (…2764) pegado con el principio del segundo
-- (4204…) forma "7644204". Ahora el separador que viene después de un número ya
-- completo —seis dígitos o más— se convierte en un espacio, y ahí se corta la
-- costura. Lo que es ruido ADENTRO del número —espacios, paréntesis, guiones,
-- puntos— se sigue borrando, así que "(011) 4259-6405" se encuentra tipeando
-- 01142596405.
--
-- ── 4. El orden ahora es total ───────────────────────────────────────────────
--
-- Terminaba en `razon_social`, que se repite: 79 razones sociales cubren 169
-- clientes ("CARPINTERIA SAN JOSE" está seis veces). Cuando dos empataban en
-- todas las claves y el empate caía justo en el puesto quince, cuál entraba lo
-- decidía el plan de ejecución, no la consulta — y podía cambiar entre dos
-- búsquedas idénticas. Es "aparece y desaparece" otra vez, por otra puerta.
-- Cierra con `lpad(codigo, 8, '0')`, que es único.
-- =============================================================================

-- ── El índice, sobre la MISMA expresión que el WHERE ─────────────────────────
--
-- Carácter por carácter: si dejan de coincidir vuelve el barrido de las 12.181
-- filas y nada falla a la vista. Reemplaza al de sólo-dígitos, que queda sin
-- uso y sólo costaría tiempo en cada alta de cliente.
create index if not exists clientes_telefono_normal_idx on public.clientes using gin (
  (regexp_replace(
     regexp_replace(
       regexp_replace(coalesce(telefono, ''), '[ ()+.-]', '', 'g'),
       '([0-9]{6})[^0-9]+', '\1 ', 'g'),
     '[^0-9 ]', '', 'g')) gin_trgm_ops);

drop index if exists public.clientes_telefono_digitos_idx;

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
        -- `clientes_busqueda_idx`. Cada columna es subcadena del concat.
        (coalesce(c.razon_social, '') || ' ' || coalesce(c.nombre_fantasia, '') || ' ' || c.codigo)
          ilike '%' || trim(coalesce(p_texto, '')) || '%'
        -- Y acá se decide, columna por columna: sin esto "sa 1" traería
        -- clientes donde el "sa" está en el nombre y el "1" en el código.
        and (
          c.codigo ilike '%' || trim(coalesce(p_texto, '')) || '%'
          or c.razon_social ilike '%' || trim(coalesce(p_texto, '')) || '%'
          or coalesce(c.nombre_fantasia, '') ilike '%' || trim(coalesce(p_texto, '')) || '%'
        )
      )
      -- El CUIT, sin guiones. El `case` sin `else` da NULL con menos de tres
      -- dígitos, y `x like null` es null: el brazo no engancha nada.
      or regexp_replace(coalesce(c.cuit, ''), '[^0-9]', '', 'g') like
         case
           when length(regexp_replace(coalesce(p_texto, ''), '[^0-9]', '', 'g')) >= 3
           then '%' || regexp_replace(coalesce(p_texto, ''), '[^0-9]', '', 'g') || '%'
         end
      -- El teléfono, por los últimos seis dígitos: el número local es el mismo
      -- con el 15 viejo y sin él. Ver el encabezado.
      or regexp_replace(
           regexp_replace(
             regexp_replace(coalesce(c.telefono, ''), '[ ()+.-]', '', 'g'),
             '([0-9]{6})[^0-9]+', '\1 ', 'g'),
           '[^0-9 ]', '', 'g') like
         case
           when length(regexp_replace(coalesce(p_texto, ''), '[^0-9]', '', 'g')) >= 6
           then '%' || right(regexp_replace(coalesce(p_texto, ''), '[^0-9]', '', 'g'), 6) || '%'
         end
    )
  order by
    -- 1. El código exacto.
    (c.codigo = trim(coalesce(p_texto, ''))) desc,
    -- 2. El CUIT exacto.
    (regexp_replace(coalesce(c.cuit, ''), '[^0-9]', '', 'g') <> ''
      and regexp_replace(coalesce(c.cuit, ''), '[^0-9]', '', 'g')
          = regexp_replace(coalesce(p_texto, ''), '[^0-9]', '', 'g')) desc,
    -- 3. Los códigos que EMPIEZAN con lo tipeado.
    (c.codigo like trim(coalesce(p_texto, '')) || '%') desc,
    -- 4. Los nombres que empiezan con lo tipeado.
    (c.razon_social ilike trim(coalesce(p_texto, '')) || '%'
      or coalesce(c.nombre_fantasia, '') ilike trim(coalesce(p_texto, '')) || '%') desc,
    -- 5. El número escrito ENTERO en la ficha: el código viejo que anotó la
    --    oficina le gana al código actual que lo contiene de casualidad.
    --    Delimitado por no-dígitos, y sólo si lo tipeado son todos dígitos.
    (case
       when trim(coalesce(p_texto, '')) ~ '^[0-9]+$'
       then coalesce(c.razon_social, '')
              ~ ('(^|[^0-9])' || trim(coalesce(p_texto, '')) || '([^0-9]|$)')
         or coalesce(c.nombre_fantasia, '')
              ~ ('(^|[^0-9])' || trim(coalesce(p_texto, '')) || '([^0-9]|$)')
     end) desc,
    -- 6. Los códigos que lo contienen en el medio.
    (c.codigo like '%' || trim(coalesce(p_texto, '')) || '%') desc,
    -- 7. Dentro de los que engancharon por código, en orden de código y el más
    --    corto primero. Para los que engancharon por nombre esto da NULL y
    --    decide la razón social.
    case
      when c.codigo like '%' || trim(coalesce(p_texto, '')) || '%'
      then lpad(c.codigo, 8, '0')
    end,
    c.razon_social,
    -- 8. La razón social se repite. Sin esta última clave, dos clientes con el
    --    mismo nombre se pelean el puesto quince y gana el que traiga el plan.
    lpad(c.codigo, 8, '0')
  limit least(coalesce(p_limite, 15), 50);
$fn$;

comment on function public.buscar_clientes is
  'Clientes que coinciden por codigo, razon social, fantasia, CUIT o telefono. Ordena por lo que se escribio: codigo exacto, los que empiezan con eso, los nombres, el numero anotado entero en la ficha, y recien los que lo contienen. El telefono se compara por los ultimos seis digitos para que el formato viejo con 15 se encuentre igual.';
