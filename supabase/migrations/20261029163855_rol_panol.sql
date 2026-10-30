-- =============================================================================
-- WoodTools · rol "panol" (pañolero)
--
-- El pañolero maneja el depósito de herramientas: ve y carga el stock. Es un rol
-- enfocado, NO hereda los poderes de administración.
--
-- Agregar el valor al enum va SOLO en esta migración: un valor nuevo de enum no
-- se puede USAR en la misma transacción en que se agrega. Lo que lo usa
-- (guardias, funciones, permisos) va en la migración siguiente. Mismo patrón que
-- rol_administracion (20260805153142) y rol_tester (20261015120000).
-- =============================================================================

alter type public.rol_usuario add value if not exists 'panol';
