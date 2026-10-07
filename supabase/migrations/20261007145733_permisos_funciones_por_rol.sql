-- =============================================================================
-- Permisos por rol: qué opciones de la app ve cada rol
--
-- Un apartado del panel deja al administrador habilitar o esconder cada opción
-- del menú por rol (como "Cobranzas del día"). La app lee este catálogo y
-- esconde lo que el rol no tenga habilitado. admin SIEMPRE ve todo; una clave
-- ausente se considera visible para todos (así una opción nueva no queda
-- escondida hasta configurarla).
-- =============================================================================

create table if not exists public.funciones (
  clave             text primary key,
  etiqueta          text not null,
  descripcion       text,
  orden             integer not null default 0,
  -- Los roles (ADEMÁS de admin, que ve todo siempre) que ven esta opción.
  roles_habilitados public.rol_usuario[] not null
                      default array['vendedor','supervisor','administracion']::public.rol_usuario[],
  actualizado_en    timestamptz not null default now()
);

comment on table public.funciones is
  'Catálogo de opciones de la app que se habilitan/esconden por rol. admin ve todo siempre; una clave ausente se considera visible para todos.';

alter table public.funciones enable row level security;

-- Leer: cualquier autenticado (no es secreto y la app lo necesita al dibujar el menú).
create policy funciones_lectura on public.funciones
  for select to authenticated using (true);

-- Modificar: sólo un administrador.
create policy funciones_admin on public.funciones
  for all to authenticated
  using (interno.es_admin())
  with check (interno.es_admin());

create trigger funciones_tocar_actualizado
  before update on public.funciones
  for each row execute function interno.tocar_actualizado_en();

grant select, insert, update, delete on public.funciones to authenticated;

-- Semilla del catálogo. Cobranzas y Mapa (todos los clientes) arrancan admin-only
-- (roles_habilitados vacío); el resto, visible para los tres roles.
insert into public.funciones (clave, etiqueta, descripcion, orden, roles_habilitados) values
  ('visitas',              'Visitas',                   'Los destinos del día y el recorrido',            10, array['vendedor','supervisor','administracion']::public.rol_usuario[]),
  ('notas_pedido',         'Notas de pedido',           'Crear, imprimir y ver notas de pedido',          20, array['vendedor','supervisor','administracion']::public.rol_usuario[]),
  ('calendario',           'Calendario de visitas',     'La semana entera, a quién ver cada día',         30, array['vendedor','supervisor','administracion']::public.rol_usuario[]),
  ('lista_semanal',        'Lista semanal',             'A quién visita cada día, fijo',                  40, array['vendedor','supervisor','administracion']::public.rol_usuario[]),
  ('mapa_recorrido',       'Mapa de visitas',           'El recorrido de hoy sobre el mapa',              50, array['vendedor','supervisor','administracion']::public.rol_usuario[]),
  ('mapa_clientes',        'Mapa (todos los clientes)', 'Todos los clientes ubicados, con buscador',      60, array[]::public.rol_usuario[]),
  ('clientes_hoy',         'Clientes de hoy',           'A quién toca visitar, para armar el recorrido',  70, array['vendedor','supervisor','administracion']::public.rol_usuario[]),
  ('proximas_visitas',     'Próximas visitas',          'Lo agendado para los próximos días',             80, array['vendedor','supervisor','administracion']::public.rol_usuario[]),
  ('cobranzas',            'Cobranzas del día',         'Lo cobrado hoy y la planilla para rendir',       90, array[]::public.rol_usuario[]),
  ('comunicacion_interna', 'Comunicación interna',      'Los teléfonos de la oficina',                   100, array['vendedor','supervisor','administracion']::public.rol_usuario[])
on conflict (clave) do nothing;
