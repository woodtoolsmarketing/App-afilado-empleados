-- =============================================================================
-- Once códigos que no decían de qué herramienta son
--
-- La regla de respaldo es "si el código no dice de qué herramienta es, vale
-- para toda su familia", y la familia `afilado_general` la comparten la
-- sierra, la fresa, el cabezal y el incisor. Once códigos estaban sin marcar,
-- así que se le ofrecían a las cuatro.
--
-- No es teórico: un INCISOR con 3,2 mm de ancho recibía el 8002 —"AFILADO DTE.
-- CONCAVO #3 A 4mm"—, que es de sierra circular. El incisor tiene su propio
-- código, el 9121, a otro precio. Es el mismo mecanismo por el que una sierra
-- venía viendo los códigos de machimbre.
--
-- De quién es cada uno no lo decide nadie acá: lo dice el rubro de la lista
-- del 02/06/2026, que los agrupa por herramienta.
--
--   006 Reposicion Dientes de S.C.      6005, 6006          -> sierra
--   008 Afilado Sierras Circulares      8002, 8006, 8015,
--                                       8020                -> sierra
--   007 Reposicion Dientes de Fresas    7003, 7502, 7700,
--                                       7901, 7909          -> fresa
--
-- ── Las sierras no cambian, y esta vez es literal ───────────────────────────
--
-- Marcar un código de sierra COMO sierra no lo saca de la lista de sierras: la
-- consulta acepta `herramienta_sugerida = 'sierra'` igual que aceptaba el
-- nulo. Comprobado sobre seis anchos (2,2 a 8 mm) en los tres servicios, antes
-- y después: afilado 8001/8002/8005/8006, rectificado 8003/8007, reparación
-- 6001/6002/6007/6008/6106/6107/6108. Idéntico.
--
-- Los que dejan de verlos son la fresa, el cabezal y el incisor, que es de lo
-- que se trata: el incisor pasa de recibir el 8002 a no recibir ninguno por
-- medida, que es lo correcto porque su código no se cotiza así.
-- =============================================================================

update public.catalogo_articulos
   set herramienta_sugerida = 'sierra'
 where codigo in ('6005', '6006', '8002', '8006', '8015', '8020');

update public.catalogo_articulos
   set herramienta_sugerida = 'fresa'
 where codigo in ('7003', '7502', '7700', '7901', '7909');
