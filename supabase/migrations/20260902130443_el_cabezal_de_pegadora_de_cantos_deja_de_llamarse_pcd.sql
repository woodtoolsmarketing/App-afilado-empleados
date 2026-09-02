-- =============================================================================
-- Los cuatro cabezales de pegadora de cantos dejan de decir "PCD".
--
-- ── Que pasaba ──────────────────────────────────────────────────────────────
--
-- La columna `geometria` de estas cuatro filas decia `PCD`, que no es un tipo
-- de pieza: es de que esta hecho el filo. PCD son las siglas de diamante
-- policristalino, el material. Es como clasificar una fresa por "metal duro".
--
-- ── Por que importa ahora ───────────────────────────────────────────────────
--
-- Porque la app acaba de estrenar el campo TIPO DE CABEZAL, y lo que el
-- vendedor elige ahi se guarda con el mismo valor que esta columna. Con `PCD`
-- cargado, estos cuatro cabezales quedaban en un tipo que el desplegable no
-- ofrece: nunca se iban a poder cruzar con lo que el vendedor eligiera.
--
-- ── Que son ────────────────────────────────────────────────────────────────
--
-- Cabezales de refilado para pegadora de cantos, marca Shark Tools, con filo de
-- diamante. Vienen en dos diametros y en mano derecha e izquierda:
--
--   SSKP1004030L / R    D=100  B=40  d=30  Z=9
--   SSKP1254030L / R    D=125  B=40  d=30  Z=9
--
-- Las medidas NO se tocan: estan bien cargadas y son las de la lista. Lo unico
-- que cambia es como se llama el tipo, y queda anotado de que es el filo, que
-- es el dato que la sigla traia y que no habia que perder.
-- =============================================================================

update public.catalogo_medidas set
  geometria      = 'cabezal_pegadora_cantos',
  notas          = 'Cabezal pegadora de cantos con filo de diamante policristalino (PCD).',
  actualizado_en = now()
where herramienta = 'cabezal'
  and geometria in ('PCD', 'cabezal_pegadora_cantos');
