-- =============================================================================
-- Las 69 cuchillas planas pasan a 5 mm de espesor.
--
-- ── Que dice cada fuente ────────────────────────────────────────────────────
--
-- La LISTA PRECIO CUCHILLAS del 20/03/2026 dice 3 mm en las 69, sin una sola
-- excepcion: todas las descripciones del sub-rubro 040 y del 041 terminan en
-- "x3" —"100x30x3", "1080x35x3", "630x30x3"—.
--
-- La OFICINA dice que son de 5 mm, y es la que tiene la cuchilla en la mano.
-- Decision tomada mirando las dos cosas: manda la oficina.
--
-- ── Que se toca y que no ────────────────────────────────────────────────────
--
-- Se corrige `catalogo_medidas`, que es la base de conocimiento propia: la que
-- la app consulta para sugerir medidas y para cruzar una pieza con su articulo.
--
-- NO se toca `catalogo_articulos`. Ahi viven la descripcion y la medida tal cual
-- las imprime el Gestion Comercial, y son la copia del documento: si el papel
-- dice "100x30x3", la copia tiene que decir lo mismo. Ademas se reescribe sola
-- en la proxima importacion de la lista, asi que corregirla ahi no duraria.
--
-- Queda anotado en `notas` de cada fila, y no solo en este comentario, porque el
-- que consulte la tabla dentro de un ano necesita saber que ese 5 no salio de la
-- lista.
--
-- ── Que NO cambia ───────────────────────────────────────────────────────────
--
-- Ningun precio. El afilado de cuchilla se cobra por cada 100 mm de LARGO
-- —"AF X100 CUCHILLA PLANA HSS"— y el espesor no entra en esa cuenta. Es un dato
-- para el taller y para que el vendedor identifique la pieza.
--
-- Las de dorso ranurado (044 y 045) no se tocan: sus espesores son 4, 5, 6, 8 y
-- 10, y esos si coinciden con la lista.
-- =============================================================================

update public.catalogo_medidas set
  espesor = 5,
  notas = case
            when notas is null or notas = ''
              then 'Espesor 5 mm por indicacion de la oficina. La lista del 20/03/2026 dice 3 mm.'
            else notas || ' Espesor 5 mm por indicacion de la oficina. La lista del 20/03/2026 dice 3 mm.'
          end,
  actualizado_en = now()
where herramienta = 'cuchilla'
  and subrubro in ('040', '041')
  and espesor is distinct from 5;
