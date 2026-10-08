-- Apartado del panel "Cobranzas de los vendedores" (sólo lectura).
-- Arranca admin-only (roles_habilitados vacío), como la función 'cobranzas' de la
-- app: es plata. El admin la habilita por rol desde Permisos si la quiere abrir a
-- administración. La RLS de `cobranzas` (cobranzas_leer = puede_ver_todo) ya deja
-- leer las de todos los vendedores, así que no hace falta tocar nada más.
insert into public.funciones (clave, etiqueta, descripcion, orden, roles_habilitados, ambito)
select
  'panel_cobranzas',
  'Cobranzas de los vendedores',
  'Lo que cobró cada vendedor, separado por día',
  65,
  array[]::public.rol_usuario[],
  'panel'
where not exists (select 1 from public.funciones where clave = 'panel_cobranzas');
