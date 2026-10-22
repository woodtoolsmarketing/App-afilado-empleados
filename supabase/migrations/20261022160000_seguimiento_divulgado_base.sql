-- Base del seguimiento DIVULGADO (version honesta del 24/7, aprobada por el
-- usuario: el vendedor SABE y ve una notificacion honesta; se prueba solo en el
-- telefono del 27). Re-crea lo que `20261022150000_quitar_seguimiento_24_7`
-- habia sacado. El flag arranca en false para todos; se prende SOLO para el 27.
alter table public.posiciones alter column rol_visita_id drop not null;
alter table public.perfiles add column if not exists seguimiento_24_7 boolean not null default false;
