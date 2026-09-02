-- =============================================================================
-- Los cabezales pasan a tener tipo y medidas.
--
-- ── Que habia ───────────────────────────────────────────────────────────────
--
-- Nada. Los 27 cabezales portacuchillas Freud existen en `catalogo_articulos`
-- desde que se importo la lista, y NINGUNO tenia fila en `catalogo_medidas`:
-- ni diametro exterior, ni ancho de corte, ni diametro interior, ni dientes.
--
-- Y el dato estaba escrito a la vista. La lista de precios de cabezales Freud
-- trae las medidas adentro de la descripcion, con la misma notacion del
-- catalogo: "CC D=125 B=50 d=40 Z=4 R=4". Estaban ahi desde el primer dia,
-- como texto, sin pasar a las columnas por las que la app pregunta.
--
-- ── Por que importa ─────────────────────────────────────────────────────────
--
-- Porque el ANCHO DE CORTE es lo unico que decide el precio del afilado, del
-- rectificado y de la reparacion. Sin el, la app no puede proponer un codigo de
-- computo y el vendedor tiene que buscarlo a mano en la lista de papel.
--
-- ── De donde sale cada dato ─────────────────────────────────────────────────
--
-- De la LISTA DE PRECIOS de cabezales Freud del 10/07/2025, leida por
-- coordenadas y no por texto plano: el PDF sale en dos columnas desalineadas y
-- el extractor de texto pega la descripcion de un articulo con la del
-- siguiente. Asi salia `TM06M AL3` con las medidas de `TM06M CG3`.
--
-- El CATALOGO GENERAL (paginas 18 a 20) agrega dos cosas que la lista no dice:
--
--   · El TIPO de cabezal, que es el titulo de cada panel. Va en `geometria`,
--     que existia y estaba vacia en las 32 filas de cabezal.
--
--   · Que los dos T198M son REGULABLES: la lista da un solo numero -20 y 30-
--     y el catalogo aclara que son rangos, 20-39 y 30-59. El numero de la
--     lista es el minimo del rango, asi que no se contradicen: el catalogo
--     completa. Se guardan los tres valores.
--
-- ── Lo que queda marcado para revisar ───────────────────────────────────────
--
-- Cuatro cabezales donde el catalogo y la lista se contradicen de verdad, no se
-- completan. Quedan cargados con lo que dice la LISTA, que es el documento con
-- fecha y el que gobierna lo que se vende, y el conflicto queda escrito en
-- `notas` para que la oficina lo resuelva:
--
--   TP23M AB3   lista D=120 B=12 d=35   ·  catalogo D=140 B=16 d=50
--   TP31M AB3   lista d=35              ·  catalogo d=50
--   TP31M CB3   lista d=35              ·  catalogo d=50
--   TW01M AB3   lista B=54.5            ·  catalogo B=55
--
-- El diametro interior no entra en ningun precio, asi que el riesgo de dejarlo
-- con el valor de la lista es que se lea un numero equivocado, no que se cotice
-- mal. El de TW01M AB3 no cambia de tramo: 54,5 y 55 caen los dos en el 9107.
-- =============================================================================

insert into public.catalogo_medidas (
  codigo, herramienta, catalogo, marca, familia, geometria,
  diametro_exterior, ancho_corte, ancho_corte_min, ancho_corte_max,
  diametro_interior, cantidad_dientes, notas, actualizado_en
)
values
  -- ── Portacuchillas para cepillar ──────────────────────────────────────────
  ('T102M AC3',  'cabezal', 'cabezales_freud', 'Freud', 'cabezal', 'portacuchillas_cepillar',
   125, 50, null, null, 40, 4, null, now()),
  ('T102M AF3',  'cabezal', 'cabezales_freud', 'Freud', 'cabezal', 'portacuchillas_cepillar',
   125, 30, null, null, 40, 4, null, now()),

  -- ── Portacuchillas para cepillar con angulo axial ─────────────────────────
  ('T194M BB3',  'cabezal', 'cabezales_freud', 'Freud', 'cabezal', 'portacuchillas_cepillar_angulo_axial',
   125, 50, null, null, 35, 4, 'R=4 precortadores.', now()),

  -- ── Portacuchillas regulable ──────────────────────────────────────────────
  -- El ancho es un RANGO: lo dice el catalogo, no la lista. Se guarda el minimo
  -- como valor y los dos extremos aparte, para que el codigo de computo se
  -- pueda calcular sobre el ancho al que este armado.
  ('T198M FC3',  'cabezal', 'cabezales_freud', 'Freud', 'cabezal', 'portacuchillas_regulable',
   140, 20, 20, 39, 40, 4, 'Regulable de 20 a 39 mm (catalogo). R=4 precortadores.', now()),
  ('T198M GC3',  'cabezal', 'cabezales_freud', 'Freud', 'cabezal', 'portacuchillas_regulable',
   140, 30, 30, 59, 40, 4, 'Regulable de 30 a 59 mm (catalogo). R=4 precortadores.', now()),

  -- ── Portacuchillas multicorte helicoidal ──────────────────────────────────
  -- Catalogo y lista coinciden en los cinco, medida por medida.
  ('TM06M AB3',  'cabezal', 'cabezales_freud', 'Freud', 'cabezal', 'portacuchillas_multicorte_helicoidal',
   125, 78.5,  null, null, 40, 12, null, now()),
  ('TM06M AD3',  'cabezal', 'cabezales_freud', 'Freud', 'cabezal', 'portacuchillas_multicorte_helicoidal',
   125, 130,   null, null, 40, 21, null, now()),
  ('TM06M AH3',  'cabezal', 'cabezales_freud', 'Freud', 'cabezal', 'portacuchillas_multicorte_helicoidal',
   125, 183.5, null, null, 40, 30, null, now()),
  ('TM06M AL3',  'cabezal', 'cabezales_freud', 'Freud', 'cabezal', 'portacuchillas_multicorte_helicoidal',
   125, 217.5, null, null, 40, 36, null, now()),
  ('TM06M CG3',  'cabezal', 'cabezales_freud', 'Freud', 'cabezal', 'portacuchillas_multicorte_helicoidal',
   120, 166,   null, null, 40, 27, null, now()),

  -- ── Portacuchillas para juntar madera ─────────────────────────────────────
  ('TW01M AB3',  'cabezal', 'cabezales_freud', 'Freud', 'cabezal', 'portacuchillas_juntar_madera_finger',
   136, 54.5, null, null, 35, 4,
   'El catalogo dice B=55; la lista, 54,5. Los dos caen en el mismo tramo de afilado (9107).', now()),
  ('TW20M BF3',  'cabezal', 'cabezales_freud', 'Freud', 'cabezal', 'portacuchillas_juntar_madera',
   140, 70, null, null, 35, 4, null, now()),

  -- ── Portacuchillas multirradio ────────────────────────────────────────────
  ('TP22M AB3',  'cabezal', 'cabezales_freud', 'Freud', 'cabezal', 'portacuchillas_multirradio',
   120, 45, null, null, 35, 2, 'A pedido.', now()),
  ('TP22M DB3',  'cabezal', 'cabezales_freud', 'Freud', 'cabezal', 'portacuchillas_multirradio',
   140, 35, null, null, 35, 2, 'A pedido.', now()),
  ('TP23M AB3',  'cabezal', 'cabezales_freud', 'Freud', 'cabezal', 'portacuchillas_multirradio',
   120, 12, null, null, 35, 2,
   'REVISAR: el catalogo dice D=140 B=16 d=50 y radios 6-8-10. Cargado con la lista.', now()),
  ('TP31M AB3',  'cabezal', 'cabezales_freud', 'Freud', 'cabezal', 'portacuchillas_multirradio',
   150, 24, null, null, 35, 2,
   'REVISAR: el catalogo dice d=50 y radios 8-10. Cargado con la lista.', now()),
  ('TP31M CB3',  'cabezal', 'cabezales_freud', 'Freud', 'cabezal', 'portacuchillas_multirradio',
   160, 40, null, null, 35, 2,
   'REVISAR: el catalogo dice d=50 y radios 8-10-12-15-17,5. Cargado con la lista.', now()),

  -- ── Portacuchillas multiperfil ────────────────────────────────────────────
  ('TP40M AB3',  'cabezal', 'cabezales_freud', 'Freud', 'cabezal', 'portacuchillas_multiperfil',
   160, 55, null, null, 35, 2, null, now()),

  -- ── Portacuchillas multiuso ───────────────────────────────────────────────
  ('TPSCM AB3',  'cabezal', 'cabezales_freud', 'Freud', 'cabezal', 'portacuchillas_multiuso',
   160, 35, null, null, 35, 2, 'R=4 precortadores. Para maderas de 30 mm.', now()),
  ('TPSCM BB3',  'cabezal', 'cabezales_freud', 'Freud', 'cabezal', 'portacuchillas_multiuso',
   160, 35, null, null, 35, 2, 'R=4 precortadores. Para maderas de 30 mm.', now()),
  ('TPSCM CB3',  'cabezal', 'cabezales_freud', 'Freud', 'cabezal', 'portacuchillas_multiuso',
   160, 20.4, null, null, 35, 2, 'R=4 precortadores.', now()),
  ('TPSCM DB3',  'cabezal', 'cabezales_freud', 'Freud', 'cabezal', 'portacuchillas_multiuso',
   138, 20, null, null, 35, 2, 'Para maderas de 22 mm.', now()),

  -- ── Portacuchillas para replanar ──────────────────────────────────────────
  ('TD21M GB3',  'cabezal', 'cabezales_freud', 'Freud', 'cabezal', 'portacuchillas_replanar',
   140, 21, null, null, 35, 2, 'Replan con 5 tipos de perfil.', now()),
  ('TD52M HB3',  'cabezal', 'cabezales_freud', 'Freud', 'cabezal', 'portacuchillas_replanar',
   200, 25, null, null, 35, 2, 'Z=2+2. Cinco tipos de cuchilla no incluidos.', now()),

  -- ── Portacuchillas perfil universal ───────────────────────────────────────
  ('TF04MC GE3', 'cabezal', 'cabezales_freud', 'Freud', 'cabezal', 'portacuchillas_perfil_universal',
   144, 71, null, null, 40, 4, null, now()),
  ('TF04MC GH3', 'cabezal', 'cabezales_freud', 'Freud', 'cabezal', 'portacuchillas_perfil_universal',
   144, 96, null, null, 40, 4, null, now()),

  -- ── Fresa para ranurar con precortante ────────────────────────────────────
  -- Vive en la familia `cabezal` de la lista de precios aunque el subrubro la
  -- llama fresa. Se respeta la familia con la que la app ya la busca.
  ('FI07M AB3',  'cabezal', 'cabezales_freud', 'Freud', 'cabezal', 'fresa_ranurar_precortante',
   150, 3, null, null, 35, 4, 'R=4 precortadores.', now())

on conflict (codigo) do update set
  herramienta        = excluded.herramienta,
  catalogo           = excluded.catalogo,
  marca              = excluded.marca,
  familia            = excluded.familia,
  geometria          = excluded.geometria,
  diametro_exterior  = excluded.diametro_exterior,
  ancho_corte        = excluded.ancho_corte,
  ancho_corte_min    = excluded.ancho_corte_min,
  ancho_corte_max    = excluded.ancho_corte_max,
  diametro_interior  = excluded.diametro_interior,
  cantidad_dientes   = excluded.cantidad_dientes,
  notas              = excluded.notas,
  actualizado_en     = now();
