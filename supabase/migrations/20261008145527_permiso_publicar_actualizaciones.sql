-- =============================================================================
-- "Publicar actualizaciones" como permiso configurable (panel)
--
-- Hasta ahora, publicar/compilar actualizaciones en el panel era sólo-admin y
-- estaba hardcodeado. Se lo pasa a la matriz de Permisos como una ACCIÓN del
-- panel (no una sección: no va al sidebar). Los botones de publicar quedan
-- escondidos salvo para los roles que tengan este permiso; arranca vacío, o sea
-- sólo admin (que ve todo siempre). El resto de Actualizaciones no cambia.
-- =============================================================================

insert into public.funciones (clave, etiqueta, descripcion, orden, roles_habilitados, ambito)
select
  'panel_publicar_actualizaciones',
  'Publicar actualizaciones',
  'Publicar actualizaciones por aire y compilar el APK (los botones dentro de Actualizaciones). Arranca sólo para admin.',
  151,
  '{}'::rol_usuario[],
  'panel'
where not exists (
  select 1 from public.funciones where clave = 'panel_publicar_actualizaciones'
);
