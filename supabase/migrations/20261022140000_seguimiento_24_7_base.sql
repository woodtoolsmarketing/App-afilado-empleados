-- Base del seguimiento 24/7 (flag por vendedor + puntos sin recorrido).
--
-- NO prende nada por si solo: el flag arranca en false para TODOS y el movil
-- solo rastrea 24/7 si su propio flag esta en true (lo prende el comando
-- `amrheadlock` del panel, de a uno, para los telefonos de prueba 12/27).
-- Reabre la posibilidad de puntos sin recorrido que el revert del 6/10 habia
-- cerrado (ver 20261006173654). La policy de INSERT de posiciones no exige
-- rol_visita_id (solo vendedor_id = auth.uid() + habilitado), asi que alcanza
-- con sacar el NOT NULL.

-- Puntos de seguimiento sin recorrido: rol_visita_id vuelve a admitir null.
alter table public.posiciones alter column rol_visita_id drop not null;
-- El pin en vivo ya admite null (en_recorrido=false); por las dudas, idempotente.
alter table public.posiciones_actuales alter column rol_visita_id drop not null;

-- Flag por vendedor: si esta en true, su telefono rastrea 24/7. Default false.
alter table public.perfiles add column if not exists seguimiento_24_7 boolean not null default false;
