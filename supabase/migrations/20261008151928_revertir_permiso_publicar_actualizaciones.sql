-- Revertir el permiso "Publicar actualizaciones" y esconder la sección por defecto.
--
-- "Publicar actualizaciones" se había agregado como una acción configurable (qué
-- rol puede publicar). No era lo pedido: lo que se quiere es administrar QUIÉN VE
-- las actualizaciones, no quién las publica. Publicar vuelve a ser sólo-admin
-- (gateado en el panel por `soloLectura`), sin fila propia en `funciones`.
delete from public.funciones
where clave = 'panel_publicar_actualizaciones';

-- La sección Actualizaciones arranca ESCONDIDA (sólo admin). El administrador
-- habilita por rol quién la ve desde Permisos. Antes la veía administración por
-- defecto; ahora es admin-only hasta que se la habilite explícitamente.
update public.funciones
set roles_habilitados = '{}'::rol_usuario[]
where clave = 'panel_actualizaciones';
