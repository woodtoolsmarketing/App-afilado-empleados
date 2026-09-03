-- =============================================================================
-- El CUIT y el teléfono no se recalculan cuando no hay dígitos que buscar
--
-- Las dos ramas de números estaban escritas como
--
--     regexp_replace(cuit, …) like case when length(digitos) >= 3 then … end
--
-- El `case` vuelve NULL cuando no hay dígitos —y `like NULL` es NULL, así que
-- la rama no matchea— pero el `regexp_replace` DE LA IZQUIERDA se calcula
-- igual, fila por fila, para después compararlo contra nada.
--
-- Puesta la condición de longitud ADELANTE y unida con `and`, es constante
-- para toda la consulta y el planificador descarta la rama entera.
--
-- El cuerpo de la función queda en la última migración de esta tanda, que es
-- la que vale. Acá no se reproduce para no tener cuatro copias de lo mismo.
-- =============================================================================

select 1;
