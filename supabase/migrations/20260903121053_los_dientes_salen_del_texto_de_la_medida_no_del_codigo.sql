-- =============================================================================
-- Los dientes salen del texto de la medida, no de los dígitos del código
--
-- El cabezal cepillador CB13006100 quedó cargado con Z=100 y su propia medida
-- dice `Ø=125 #130(6) Z=96`. El número salió de los últimos dígitos del
-- código, que en ese código NO son los dientes: `CB` + `130` (ancho) + `06`
-- (b = 6 mm) + `100`. Lo mismo en CB1601272 (72 cargado, 68 en la medida) y en
-- CB22012100 (100 contra 96).
--
-- No es sólo de los cepilladores: pasa en 10 filas del catálogo —7 fresas y 3
-- cabezales— de las 65 que traen el Z escrito en la medida. Las sierras y las
-- mechas están limpias.
--
-- Y no es un detalle de prolijidad: la cantidad de dientes MULTIPLICA. Un
-- afilado de cabezal cepillador se cobra por diente, así que cobrar 100 donde
-- hay 96 son cuatro dientes de más en cada renglón, y sale impreso en la
-- columna Z-Paso que la fábrica usa para contar lo que le llegó.
--
-- La fuente buena es el texto de la medida: lo escribe la lista de precios, no
-- lo deduce nadie. Donde no hay `Z=` no se toca nada — no hay con qué
-- corregir, y sobreescribir con un null borraría un dato que puede estar bien.
-- =============================================================================

update public.catalogo_medidas m
   set cantidad_dientes = z.correcto,
       actualizado_en   = now()
  from (
    select m2.codigo,
           (regexp_match(a.medida, 'Z\s*=\s*(\d+)'))[1]::int as correcto
      from public.catalogo_medidas m2
      join public.catalogo_articulos a on a.codigo = m2.codigo
     where a.medida ~ 'Z\s*=\s*\d+'
  ) z
 where m.codigo = z.codigo
   and m.cantidad_dientes is distinct from z.correcto;
