-- =============================================================================
-- Donde el catalogo y la lista de precios se contradecian, manda el catalogo.
--
-- Decision de la oficina, tomada mirando los dos documentos lado a lado.
--
-- ── 1. Los seis cabezales cepilladores ──────────────────────────────────────
--
-- La lista traia MENOS dientes que el catalogo en los seis, y en tres de ellos
-- el propio CODIGO le da la razon al catalogo, porque lo lleva escrito adentro:
--
--   CB13006100  ->  B=130, b=6,  Z=100     la lista decia Z=96
--   CB1601272   ->  B=160, b=12, Z=72      la lista decia Z=68
--   CB22012100  ->  B=220, b=12, Z=100     la lista decia Z=96
--
-- Y ademas CB0500640 tenia mal el ancho: 50 en la lista, 55 en el catalogo.
--
-- El numero de dientes NO es un dato decorativo en esta app: el afilado se
-- cotiza POR DIENTE. Cuatro dientes de menos en un cabezal de 40 son un 10 %
-- menos en cada nota que lo lleve.
--
-- ── 2. La fresa de radios multiples ─────────────────────────────────────────
--
-- FMR04 estaba con Ø=160 y ancho 55; el catalogo dice Ø=140 y ancho 35. Ese es
-- el que cambia el precio de verdad: el ancho decide el codigo de afilado, y 55
-- cae en el 9107 mientras que 35 cae en el 9105. Se estaba cotizando por el
-- tramo equivocado.
--
-- ── El diametro interior ────────────────────────────────────────────────────
--
-- El catalogo dice d=40 para los siete cabezales cepilladores que lista, sin
-- excepcion, y ninguno lo tenia cargado. Se completa.
--
-- CB2001286 va con el mismo d=40 aunque el catalogo no lo muestre: es de la
-- misma familia y las otras siete filas dicen 40. Queda anotado que ese valor
-- es por familia y no leido, para que se sepa de donde salio.
-- =============================================================================

-- ── Cabezales cepilladores ───────────────────────────────────────────────────

update public.catalogo_medidas set
  geometria         = 'cabezal_cepillador',
  ancho_corte       = 55,
  diametro_interior = 40,
  cantidad_dientes  = 40,
  notas             = 'Cabezal cepillador, 3 entradas. b=6 mm. Catalogo: D=125 B=55 d=40 Z=40. La lista decia ancho 50 y Z=36.',
  actualizado_en    = now()
where codigo = 'CB0500640';

update public.catalogo_medidas set
  geometria         = 'cabezal_cepillador',
  diametro_interior = 40,
  cantidad_dientes  = 60,
  notas             = 'Cabezal cepillador, 3 entradas. b=6 mm. Catalogo: D=125 B=75 d=40 Z=60. La lista decia Z=54.',
  actualizado_en    = now()
where codigo = 'CB0750660';

update public.catalogo_medidas set
  geometria         = 'cabezal_cepillador',
  diametro_interior = 40,
  cantidad_dientes  = 100,
  notas             = 'Cabezal cepillador. b=6 mm. Catalogo: D=125 B=130 d=40 Z=100, y el codigo termina en 100. La lista decia Z=96.',
  actualizado_en    = now()
where codigo = 'CB13006100';

update public.catalogo_medidas set
  geometria         = 'cabezal_cepillador',
  diametro_interior = 40,
  cantidad_dientes  = 72,
  notas             = 'Cabezal cepillador. b=12 mm. Catalogo: D=125 B=160 d=40 Z=72, y el codigo termina en 72. La lista decia Z=68.',
  actualizado_en    = now()
where codigo = 'CB1601272';

update public.catalogo_medidas set
  geometria         = 'cabezal_cepillador',
  diametro_interior = 40,
  cantidad_dientes  = 80,
  notas             = 'Cabezal cepillador, 3 entradas. b=12 mm. Catalogo: D=125 B=180 d=40 Z=80, y el codigo termina en 80. La lista decia Z=76.',
  actualizado_en    = now()
where codigo = 'CB1801280';

update public.catalogo_medidas set
  geometria         = 'cabezal_cepillador',
  diametro_interior = 40,
  cantidad_dientes  = 100,
  notas             = 'Cabezal cepillador. b=12 mm. Catalogo: D=125 B=220 d=40 Z=100, y el codigo termina en 100. La lista decia Z=96.',
  actualizado_en    = now()
where codigo = 'CB22012100';

-- Este no esta en el catalogo: solo en la lista de precios. No se le toca
-- ninguna medida leida; se le completa el diametro interior por familia.
update public.catalogo_medidas set
  geometria         = 'cabezal_cepillador',
  diametro_interior = 40,
  notas             = 'Cabezal cepillador. b=12 mm. NO figura en el catalogo general: sus medidas son las de la lista de precios. El d=40 se toma de la familia, no esta leido.',
  actualizado_en    = now()
where codigo = 'CB2001286';

-- ── Fresa para radios multiples ─────────────────────────────────────────────

update public.catalogo_medidas set
  geometria         = 'radios_multiples',
  diametro_exterior = 140,
  ancho_corte       = 35,
  diametro_interior = 40,
  cantidad_dientes  = 4,
  notas             = 'Fresa para radios multiples de 4 a 10 mm. Catalogo: D=140 B=35 d=40 Z=4. La lista decia D=160 y ancho 55, que la mandaba al tramo de afilado 9107 en vez del 9105.',
  actualizado_en    = now()
where codigo = 'FMR04';
