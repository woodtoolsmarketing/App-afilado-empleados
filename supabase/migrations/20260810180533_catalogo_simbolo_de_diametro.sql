-- =============================================================================
-- El símbolo de diámetro entró mal al catálogo
--
-- En 40 artículos el `Ø` quedó como `Ý`: un problema de codificación al extraer
-- los PDF de las listas. Cero artículos tenían el símbolo correcto, así que no
-- era un caso aislado sino todos.
--
-- No es cosmético. El diámetro exterior se lee del texto de la descripción
-- buscando `D=` o el símbolo, y con el carácter equivocado esos artículos
-- quedaban sin diámetro: no se mostraba en las características del buscador, y
-- `agujeroDeFabrica` no podía reconocer la herramienta que trae el cliente para
-- sacarle el agujero de fábrica.
--
-- El lado del código —que ahora acepta `Ø` además de `D=`— está en
-- `packages/compartido/src/catalogo.ts`.
-- =============================================================================

update public.catalogo_articulos
   set descripcion = replace(descripcion, 'Ý', 'Ø')
 where descripcion like '%Ý%';
