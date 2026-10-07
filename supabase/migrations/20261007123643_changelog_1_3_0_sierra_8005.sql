-- Changelog: la regla del 8005 por default en sierras de 4,4/4,5 mm salio por
-- OTA sobre la 1.3.0, asi que se suma a las notas de esa version del canal
-- interno. Se setea el TEXTO COMPLETO (idempotente), que ya incluye lo del
-- mecanizado anotado antes mas esta linea.
update public.versiones_app
set notas = 'Ahora las actualizaciones se bajan e instalan solas desde la app. Ademas: corregir la direccion de un cliente desde la calle, y arreglos de notas de pedido y recorrido. Nuevo: en las notas de pedido ya esta el MECANIZADO de sierras y fresas (achicar con buje o agrandar el agujero): cargas el diametro que tiene y el que hay que hacer, y el codigo y el precio salen solos. En las sierras de 4,4 y 4,5 mm de ancho de corte, el afilado propone solo el codigo 8005 (igual hay que confirmarlo).'
where canal = 'interno' and version = '1.3.0';
