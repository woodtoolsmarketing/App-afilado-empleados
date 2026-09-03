-- =============================================================================
-- El buscador de clientes encuentra por palabras y sin acentos
--
-- `buscar_clientes` exigía que lo tipeado apareciera LITERAL Y CONTIGUO dentro
-- de un solo campo. Con 12.181 clientes cargados eso deja afuera cuatro casos
-- que el vendedor hace todo el tiempo. Medido contra el padrón de hoy:
--
--   "ACUNA"          →  1 resultado    "ACUÑA" →  7
--   "RODISER S.A."   →  0              está cargado "RODISER  S.A." (dos espacios)
--   "ACUÑA CLAUDIO"  →  0              existe "ACUÑA WALTER R.Y CLAUDIO R.SH"
--   "DAVID ACUÑA"    →  0              existe "ACUÑA DAVID EZEQUIEL"
--
-- No es un caso de borde: hay 220 clientes con acento o Ñ, 59 con espacios
-- dobles y 7.078 con tres o más palabras en la razón social. El vendedor que
-- no pone la Ñ pierde seis de cada siete Acuña, y el que escribe el nombre y
-- el apellido al revés no encuentra a nadie.
--
-- Lo que cambia: el texto y el nombre se normalizan igual —minúsculas, sin
-- acentos, espacios colapsados— y se exige que estén TODAS las palabras, en
-- cualquier orden y repartidas como sea entre razón social, nombre de fantasía
-- y código. El CUIT y el teléfono no se tocan: ya buscaban por dígitos.
--
-- Con el texto vacío ahora no devuelve nada. Antes devolvía los primeros
-- quince del padrón; la app nunca busca con menos de dos letras, así que ese
-- resultado no lo veía nadie y no significaba nada.
--
-- La función se reemplaza entera en la migración siguiente, que además guarda
-- el nombre normalizado en vez de recalcularlo. Acá queda sólo lo que
-- sobrevive: la función de normalizar.
-- =============================================================================

create or replace function interno.normalizar_busqueda(t text)
returns text
language sql
immutable
parallel safe
as $fn$
  select btrim(regexp_replace(
    translate(
      lower(coalesce(t, '')),
      'áàäâãéèëêíìïîóòöôõúùüûñç',
      'aaaaaeeeeiiiiooooouuuunc'
    ),
    '\s+', ' ', 'g'
  ));
$fn$;

comment on function interno.normalizar_busqueda(text) is
  'Minusculas, sin acentos y con los espacios colapsados. Se usa en los dos lados de la comparacion del buscador de clientes, y es la expresion de la columna guardada.';
