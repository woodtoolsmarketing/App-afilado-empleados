-- =============================================================================
-- WoodTools · Paso 2
-- Rol "Dpto. de Administración"
--
-- Ve todas las notas de pedido, les asigna el código de cliente y completa los
-- precios que faltan. No maneja recorridos ni ubicaciones: no es un supervisor
-- de ventas.
--
-- Va en su propia migración porque un valor nuevo de enum no se puede USAR en
-- la misma transacción en que se agrega.
-- =============================================================================

alter type public.rol_usuario add value if not exists 'administracion';
