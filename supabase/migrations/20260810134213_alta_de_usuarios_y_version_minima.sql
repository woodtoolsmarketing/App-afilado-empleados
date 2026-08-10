-- =============================================================================
-- Alta de usuarios desde el panel, y versión mínima de la app
--
-- Dos cosas que no tienen que ver entre sí más que en el momento en que se
-- pidieron, pero las dos son una columna y nada más.
--
--  · `debe_cambiar_contrasena` — el alta desde el panel genera una contraseña
--    provisoria que el administrador ve una sola vez y le pasa al empleado. Esa
--    contraseña la vio alguien que no es su dueño, así que no puede quedar: la
--    app obliga a cambiarla antes de dejar entrar a ningún lado.
--
--  · `version_minima_app` — con qué versión se acepta que entre un celular. Es
--    lo que permite exigir una actualización cuando un cambio en la base deja
--    de ser compatible con las versiones viejas. En cero, no molesta a nadie.
-- =============================================================================

alter table public.perfiles
  add column if not exists debe_cambiar_contrasena boolean not null default false;

comment on column public.perfiles.debe_cambiar_contrasena is
  'La cuenta se creo con una contrasena provisoria que vio un administrador. La app obliga a cambiarla antes de dejar entrar.';

insert into public.configuracion (clave, valor, descripcion)
values (
  'version_minima_app',
  '{"android": "0.0.0"}'::jsonb,
  'Version mas vieja de la app del celular que se acepta. Por debajo, la app pide actualizar y no deja seguir.'
)
on conflict (clave) do nothing;
