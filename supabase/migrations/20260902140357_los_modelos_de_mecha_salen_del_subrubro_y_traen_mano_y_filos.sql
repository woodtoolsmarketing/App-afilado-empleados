-- =============================================================================
-- `mechas_del_tipo` deja de adivinar por prefijo de codigo.
--
-- ── Que estaba pasando ──────────────────────────────────────────────────────
--
-- La funcion clasificaba las 166 mechas leyendo el principio del codigo:
-- 'MB%' bisagra, 'MC%' ciega, 'MP%' pasante, 'MID%' integral. Cuatro reglas de
-- texto para once sub-rubros, y el resultado eran 42 codigos que no caian en
-- ninguna rama y cuatro tipos que devolvian CERO modelos:
--
--   barreno         0 modelos, y hay 5   (MBA*, sub-rubro 307)
--   practiwall      0 modelos, y hay 1   (PRACTIWALL, dentro del 304)
--   plegado         0 modelos, y hay 1   (FPP452, dentro del 304)
--   caja_cerradura  0 modelos, y hay 1   (MID016100, dentro del 303)
--
-- Y las tres integrales IZQUIERDAS quedaban afuera de `integral_widia` por una
-- letra: la rama pedia 'MID%' y ellas son 'MIIR%'.
--
-- ── De donde sale la clasificacion ahora ────────────────────────────────────
--
-- De `catalogo_medidas.subrubro`, que es el sub-rubro del Gestion Comercial y ya
-- clasifica las 166 filas sin ambiguedad. No hace falta adivinar: el dato existe
-- desde que se importo la lista.
--
--   300 Mechas Pasantes                -> pasante
--   301 Mechas no Pasantes (ciegas)    -> ciega
--   303 Mechas Integrales de Widia     -> integral_widia
--   304 Mechas para Bisagra            -> bisagra
--   306 Mecha Ciega con Avellanador    -> ciega   (es una ciega, con avellanador)
--   307 Mechas para Barreno            -> barreno
--
-- Con cuatro excepciones nominales, que son piezas sueltas metidas dentro de un
-- sub-rubro que no las describe:
--
--   MID016100   caja de cerradura, dentro del 303
--   MIDN*       las dos de compresion (nesting Z=2+2), dentro del 303
--   FPP452      punta de plegado, dentro del 304
--   PRACTIWALL  dentro del 304
--
-- ── Lo que queda deliberadamente afuera ─────────────────────────────────────
--
-- Los sub-rubros 302 (broca para defondadora), 305 (mandriles y pinzas), 308
-- (avellanadores) y 309 (mechas de router): 31 articulos que se venden pero que
-- no tienen tipo de mecha en la app y tampoco precio en la tabla de afilado.
-- Darles un tipo seria ofrecerle al vendedor una clasificacion que despues no
-- puede cotizar. Queda escrito para que se sepa que es a proposito.
--
-- MCE ("MECHA ESPECIAL", precio 0, sin medidas) tampoco entra: es el comodin de
-- la lista, no un modelo.
--
-- ── Dos datos nuevos que la funcion devuelve ────────────────────────────────
--
-- `mano` y `cantidad_dientes`, que ya estaban en `catalogo_medidas` y la app
-- estaba deduciendo o pidiendo al pedo:
--
--   · La MANO se leia de la descripcion, y la lista tiene una errata: MCIR0670
--     dice "MECHA CIEGA DER." siendo izquierda —lo dice su propio codigo, MC-I-R,
--     y asi esta cargada en la columna—. Leyendo el texto se guardaba al reves.
--     Ademas MCARD0840 y MPDL0570 no dicen ni DER ni IZQ, asi que el campo
--     quedaba vacio y obligatorio sobre un dato que la base tiene.
--
--   · Los FILOS de las integrales estan cargados en los 20 modelos del 303. Con
--     eso el afilado de una integral no necesita preguntar el Z: se precarga.
--     Las dos MIDN quedan en 4 porque la lista dice "Z=2+2"; si el taller las
--     cobra como Z=2 hay que corregir esas dos filas, y el vendedor mientras
--     tanto lo puede cambiar en el desplegable.
-- =============================================================================

-- Cambian las columnas que devuelve, asi que no alcanza con `create or replace`.
drop function if exists public.mechas_del_tipo(text);

create function public.mechas_del_tipo(p_tipo text)
returns table (
  codigo           text,
  descripcion      text,
  medida           text,
  precio           numeric,
  moneda           text,
  precio_pesos     numeric,
  a_cotizar        boolean,
  mano             text,
  cantidad_dientes smallint
)
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
  select
    c.codigo,
    c.descripcion,
    coalesce(c.medida, ''),
    c.precio,
    c.moneda,
    round(public.precio_en_pesos(c.precio, c.moneda, current_date), 2),
    c.precio_a_confirmar,
    m.mano,
    m.cantidad_dientes
  from public.vista_catalogo_vigente c
  join public.catalogo_medidas m on m.codigo = c.codigo
  where c.familia = 'mecha'
    and not c.es_servicio
    -- El comodin de la lista, sin medidas ni precio: no es un modelo.
    and c.codigo <> 'MCE'
    and case p_tipo
      when 'pasante'        then m.subrubro = '300'
      -- El 306 es "Mecha Ciega con Avellanador": una ciega, con un avellanador
      -- en la punta. Va con las ciegas porque es lo que el vendedor busca.
      when 'ciega'          then m.subrubro in ('301', '306')
      when 'barreno'        then m.subrubro = '307'
      when 'bisagra'        then m.subrubro = '304'
                                 and c.codigo not in ('FPP452', 'PRACTIWALL')
      when 'compresion'     then m.subrubro = '303' and c.codigo like 'MIDN%'
      when 'caja_cerradura' then c.codigo = 'MID016100'
      when 'integral_widia' then m.subrubro = '303'
                                 and c.codigo not like 'MIDN%'
                                 and c.codigo <> 'MID016100'
      when 'plegado'        then c.codigo = 'FPP452'
      when 'practiwall'     then c.codigo = 'PRACTIWALL'
      -- La malletadora se afila pero no se vende: no tiene modelo que mostrar.
      -- Devolver cero filas es la respuesta correcta, no una falla.
      else false
    end
  -- Los que tienen precio primero; despues por codigo, que agrupa los diametros
  -- en orden.
  order by c.precio_a_confirmar, c.codigo;
$function$;

comment on function public.mechas_del_tipo(text) is
  'Modelos de mecha de cada tipo, clasificados por catalogo_medidas.subrubro. Devuelve tambien la mano y los filos, que la app deducia mal de la descripcion.';

grant execute on function public.mechas_del_tipo(text) to anon, authenticated;
