-- Deja SIN EFECTO el seguimiento 24/7 (pedido del usuario: no se construye la
-- version oculta, y se abandona). Revierte la base del 24/7
-- (20261022140000_seguimiento_24_7_base): vuelve a exigir rol_visita_id en
-- posiciones (asi no se pueden guardar puntos fuera de un recorrido, que es la
-- proteccion que el revert del 6/10 ya habia puesto) y quita el flag por
-- vendedor. Seguro: 0 posiciones con rol_visita_id null y 0 perfiles con el flag.
alter table public.posiciones alter column rol_visita_id set not null;
alter table public.perfiles drop column if exists seguimiento_24_7;
