-- Impresora propia por usuario para el panel.
--
-- Un puesto puede tener su propia impresora: las impresiones del panel hechas por
-- ESE usuario (reimpresion de notas, cola a mano y agente automatico) salen a esa
-- impresora en vez de a la activa global (configuracion.impresora_oficina), y solo
-- para el. Guarda una IP del catalogo curado configuracion.impresoras; si esa IP
-- no esta (o la columna es NULL) el panel cae a la activa global. La resolucion
-- vive en apps/escritorio/src/nucleo/impresora.ts (obtenerImpresora).
--
-- La asignacion concreta de cada usuario es DATO (no va en esta migracion), igual
-- que el catalogo de impresoras y la fila impresora_oficina.
alter table public.perfiles
  add column if not exists impresora_ip text;

comment on column public.perfiles.impresora_ip is
  'IP (del catalogo configuracion.impresoras) de la impresora propia de este usuario en el panel. Las impresiones del panel hechas por este usuario salen a esa impresora en vez de a la activa global (configuracion.impresora_oficina). NULL = usa la activa global. Para puestos con impresora propia (ej. Administracion).';
