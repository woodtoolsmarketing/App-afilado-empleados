-- Quién puede imprimir el rol de visita desde la app.
--
-- La oficina decide, por vendedor, si puede imprimir el rol de visita (la
-- opción "IMPRIMIR ROL DE VISITA" del menú de la app). Es una capacidad por
-- perfil, igual que `zonas` o `ve_ubicacion_de_notas`: se togglea desde el panel
-- (Usuarios) y la app la lee del perfil.
--
-- Default `true`: hoy todos imprimen, así que al salir nadie pierde la opción.
-- La oficina apaga a los que no quiere que impriman. (Si se quisiera lo opuesto
-- —que nadie imprima hasta habilitarlo— habría que cambiar este default.)
--
-- Sólo tiene efecto para los vendedores: un administrador o supervisor imprime
-- siempre (la app no mira esta bandera para ellos).

alter table public.perfiles
  add column if not exists imprime_roles boolean not null default true;

comment on column public.perfiles.imprime_roles is
  'Si el vendedor puede imprimir el rol de visita desde la app. La oficina lo togglea en el panel; no aplica a admin/supervisor.';
