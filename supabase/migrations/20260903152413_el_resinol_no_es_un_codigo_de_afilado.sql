-- =============================================================================
-- El resinol no es un código de afilado
--
-- `RES005L` —"RESINOL BIDON DE 5 LTS", $ 112.500— estaba en la familia
-- `afilado_general` y sin herramienta marcada, así que aparecía en la lista de
-- códigos de cómputo de la sierra, la fresa, el cabezal y el incisor. Es un
-- bidón de producto de limpieza: la propia lista lo pone en el sub-rubro 082,
-- "Productos para Limpieza". Cayó en `afilado_general` porque ese sub-rubro
-- vive dentro del rubro 008, que es el de las sierras circulares.
--
-- Un vendedor podía elegirlo como el código de cómputo de un afilado y
-- facturar $ 112.500 de resinol como si fuera el trabajo. Es la misma clase de
-- error que el del código de cabezal en un renglón de cuchilla, con la
-- diferencia de que éste tiene seis cifras.
--
-- Va a `varios`, que es la familia de los productos que no son una
-- herramienta. No se pierde: el buscador de artículos de una VENTA busca en
-- todo el catálogo sin filtrar familia, y el comentario de `buscarArticulos`
-- ya nombraba justamente este caso —"hay artículos que se venden y están
-- archivados en otra familia: una muela, un bidón de resinol, un pote de
-- soldadura"—. Lo que deja de ser es un código de cómputo de afilado, que
-- nunca fue.
-- =============================================================================

update public.catalogo_articulos
   set familia = 'varios'
 where codigo = 'RES005L';
