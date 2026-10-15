-- Rol `tester`: igual que un vendedor (usa la app, ve lo suyo, no entra al panel)
-- pero SI puede sacar capturas de pantalla (no se le pone FLAG_SECURE, ver
-- apps/movil/src/servicios/bloqueoDeCaptura.ts) y figura como "Vendedor (tester)".
--
-- Va en su propia migracion y en una sola sentencia: un valor nuevo de enum no se
-- puede USAR en la misma transaccion en que se agrega (mismo motivo que
-- 'administracion' en 20260805153142).
alter type public.rol_usuario add value if not exists 'tester';
