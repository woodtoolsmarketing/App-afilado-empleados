-- La vista vista_catalogo_vigente corria SECURITY DEFINER (default), salteando el
-- RLS de catalogo_articulos (catalogo_leer exige esta_habilitado()). security_invoker
-- la hace correr con los permisos de quien consulta: un habilitado sigue viendo el
-- catalogo; anon / no-habilitado recibe vacio. Los 7 consumidores son SECURITY
-- INVOKER, asi que heredan al usuario que llama (habilitado) y siguen andando.
-- Verificado: habilitado ve 1513 filas por la vista, no-habilitado ve 0.
alter view public.vista_catalogo_vigente set (security_invoker = true);

-- Funcion INVOKER sin search_path fijo (advisor WARN). Solo la usa crear_notas_pedido,
-- no esta en indices ni columnas generadas, usa solo builtins -> es seguro fijarlo.
-- (normalizar_busqueda se deja como esta: esta cableada en columnas generadas de
--  clientes y es INVOKER, el riesgo del search_path mutable es contra DEFINER.)
alter function interno.numero_de_nota_impreso(bigint, text) set search_path = 'public', 'pg_temp';
