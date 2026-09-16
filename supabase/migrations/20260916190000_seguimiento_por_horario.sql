-- =============================================================================
-- Seguimiento de ubicación por horario de trabajo
--
-- Hasta ahora sólo se rastreaba al vendedor mientras tenía un recorrido en
-- curso. Ahora se lo rastrea durante toda la franja laboral (por defecto
-- lunes a viernes de 8 a 17) mientras tenga la app activa, y fuera de esa franja
-- no se rastrea ni se lo muestra en el mapa en vivo.
--
-- `activo` distingue "se lo está rastreando ahora" (recorrido o jornada) de
-- `en_recorrido` (que sigue significando sólo el recorrido). El panel muestra a
-- los `activo`, acotado por el horario según su propio reloj.
-- =============================================================================

alter table public.posiciones_actuales
  add column if not exists activo boolean not null default false;

create index if not exists posiciones_actuales_activo_idx
  on public.posiciones_actuales (actualizado_en desc) where activo;

comment on column public.posiciones_actuales.activo is
  'Se lo está rastreando ahora (recorrido o jornada). Es lo que el panel muestra en vivo.';

insert into public.configuracion (clave, valor, descripcion) values
  ('seguimiento_horario',
   '{"desde":8,"hasta":17,"dias":[1,2,3,4,5]}'::jsonb,
   'Franja horaria en que se rastrea la ubicación de los vendedores (hora local; dias en ISO, 1=lunes). Fuera de esto la app no rastrea y el panel no lo muestra.')
on conflict (clave) do nothing;
