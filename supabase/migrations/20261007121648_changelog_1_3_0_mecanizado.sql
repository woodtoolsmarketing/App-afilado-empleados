-- Changelog: el mecanizado salio por OTA sobre la 1.3.0 (no una version nueva),
-- asi que se anota en las notas de esa version del canal interno, que es lo que
-- los vendedores ven como "novedades".
--
-- Se setea el TEXTO COMPLETO (no se appendea) para que correr esto de nuevo sea
-- idempotente: ya se habia aplicado con execute_sql, y una migracion que vuelva
-- a appendear duplicaria la linea.
update public.versiones_app
set notas = 'Ahora las actualizaciones se bajan e instalan solas desde la app. Ademas: corregir la direccion de un cliente desde la calle, y arreglos de notas de pedido y recorrido. Nuevo: en las notas de pedido ya esta el MECANIZADO de sierras y fresas (achicar con buje o agrandar el agujero): cargas el diametro que tiene y el que hay que hacer, y el codigo y el precio salen solos.'
where canal = 'interno' and version = '1.3.0';
