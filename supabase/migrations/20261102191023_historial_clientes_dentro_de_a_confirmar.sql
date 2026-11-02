-- El historial de clientes confirmados/rechazados dejó de ser una sección aparte:
-- ahora vive como dos pestañas DENTRO de "Clientes a confirmar", así que lo gatea
-- el permiso panel_clientes_a_confirmar. El permiso suelto panel_clientes_historial
-- ya no lo usa nadie (ni ruta ni enlace), se quita para no dejarlo colgado en
-- "Permisos".
delete from public.funciones where clave = 'panel_clientes_historial';
