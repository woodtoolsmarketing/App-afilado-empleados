-- =============================================================================
-- El padrón vino con la Ñ y el ordinal masculino rotos
--
-- El listado sale de un Gestión Comercial de la época del DOS, y en el camino
-- de esa codificación a UTF-8 se perdieron tres caracteres. En la base quedaron:
--
--     Ð  donde iba  Ñ    (124 veces)   AVENDAÐO, QUIÐONES, CAÐADA DE GOMEZ
--     ±  donde iba  Ñ/ñ  ( 17 veces)   ESPA±A, VICU±A, Ca±uelas, ma±ana
--     ¦  donde iba  º    (201 veces)   CALLE 15 N¦3085, 1¦DE MAYO, 8¦P.
--
-- No es cosmético. `buscar_clientes` compara con `ilike '%texto%'`, así que un
-- vendedor que escribe "PEÑA" no encuentra la fila que dice "PEÐA": esos
-- clientes son invisibles para el buscador por nombre y por localidad.
--
-- El mapeo no es una suposición: se verificó contra la exportación corregida
-- (Listado_clientes_limpio.xlsx). De las 12.181 filas, 293 difieren, y las 282
-- diferencias de caracteres son exactamente estas tres sustituciones. Los 17
-- `±` y los 124 `Ð` se revisaron uno por uno; ninguno es un más/menos ni una
-- eth legítima.
--
-- La mayúscula depende del contexto: si al carácter le sigue una minúscula va
-- `ñ` y si no `Ñ`. Con eso `Ca±uelas` queda `Cañuelas` y `CA±ADA` queda
-- `CAÑADA`, que es lo que dice el listado en cada caso.
-- =============================================================================

create or replace function public.__arreglar_dos(t text)
returns text language sql immutable as $$
  select case when t is null then null else
    regexp_replace(
      regexp_replace(
        replace(t, '¦', 'º'),
        '[Ð±]([a-záéíóúü])', 'ñ\1', 'g'),
      '[Ð±]', 'Ñ', 'g')
  end
$$;

update public.clientes set
  razon_social    = public.__arreglar_dos(razon_social),
  nombre_fantasia = public.__arreglar_dos(nombre_fantasia),
  direccion       = public.__arreglar_dos(direccion),
  localidad       = public.__arreglar_dos(localidad),
  contacto_nombre = public.__arreglar_dos(contacto_nombre),
  notas           = public.__arreglar_dos(notas),
  email           = public.__arreglar_dos(email)
where coalesce(razon_social,'') || coalesce(nombre_fantasia,'') || coalesce(direccion,'')
   || coalesce(localidad,'')    || coalesce(contacto_nombre,'') || coalesce(notas,'')
   || coalesce(email,'') ~ '[Ð±¦]';

drop function public.__arreglar_dos(text);
