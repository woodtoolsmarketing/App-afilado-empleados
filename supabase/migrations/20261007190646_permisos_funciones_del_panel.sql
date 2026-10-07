-- =============================================================================
-- Permisos por rol, ahora también para las secciones del PANEL
--
-- La tabla `funciones` ya decide qué opción de la APP ve cada rol. Se le suma un
-- `ambito` para distinguir las opciones de la app de las del panel de escritorio,
-- y se siembran las secciones del panel. El Tablero (landing) y Permisos (sólo
-- admin) NO entran en el catálogo configurable: el resto sí.
--
-- admin ve TODO siempre (lógica de la app/panel). Vendedor no usa el panel, así
-- que en las filas de ámbito 'panel' no se lo habilita. Administración arranca
-- con las 6 secciones pedidas; supervisor arranca vacío (se configura a mano).
-- =============================================================================

alter table public.funciones
  add column if not exists ambito text not null default 'app'
    check (ambito in ('app', 'panel'));

comment on column public.funciones.ambito is
  'app = opción de la app móvil; panel = sección del panel de escritorio.';

insert into public.funciones (clave, etiqueta, descripcion, orden, roles_habilitados, ambito) values
  ('panel_mapa_en_vivo',        'Mapa en vivo',          'Los vendedores en vivo sobre el mapa',          20, array[]::public.rol_usuario[],                  'panel'),
  ('panel_mapa_clientes',       'Mapa',                  'Todos los clientes ubicados',                   30, array[]::public.rol_usuario[],                  'panel'),
  ('panel_notas_pedido',        'Notas de pedido',       'Ver, completar, modificar y anular notas',      40, array['administracion']::public.rol_usuario[], 'panel'),
  ('panel_cola_impresion',      'Cola de impresión',     'Las notas esperando el papel',                  50, array['administracion']::public.rol_usuario[], 'panel'),
  ('panel_roles_visita',        'Roles de visita',       'Armar y ver los roles de visita',               60, array[]::public.rol_usuario[],                  'panel'),
  ('panel_rol_maestro',         'Rol maestro',           'La frecuencia de visita por cliente',           70, array[]::public.rol_usuario[],                  'panel'),
  ('panel_clientes',            'Clientes',              'La cartera de clientes',                        80, array[]::public.rol_usuario[],                  'panel'),
  ('panel_clientes_a_confirmar','Clientes a confirmar',  'Clientes nuevos cargados por el vendedor',      90, array['administracion']::public.rol_usuario[], 'panel'),
  ('panel_modificaciones',      'Modificaciones',        'Cambios de datos de clientes',                 100, array['administracion']::public.rol_usuario[], 'panel'),
  ('panel_cambios_direccion',   'Cambios de dirección',  'Correcciones de dirección propuestas',         110, array['administracion']::public.rol_usuario[], 'panel'),
  ('panel_usuarios',            'Usuarios',              'Altas, bajas y habilitación de teléfonos',     120, array[]::public.rol_usuario[],                  'panel'),
  ('panel_articulos_confirmar', 'A confirmar',           'Artículos con precio o código a confirmar',    130, array[]::public.rol_usuario[],                  'panel'),
  ('panel_problemas',           'Problemas',             'Reportes de problemas de los vendedores',      140, array[]::public.rol_usuario[],                  'panel'),
  ('panel_actualizaciones',     'Actualizaciones',       'Publicar y compilar versiones de la app',      150, array['administracion']::public.rol_usuario[], 'panel')
on conflict (clave) do nothing;
