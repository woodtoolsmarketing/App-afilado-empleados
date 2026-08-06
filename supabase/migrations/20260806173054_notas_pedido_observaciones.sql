-- =============================================================================
-- Observaciones de la nota de pedido.
--
-- El talonario de papel tiene una columna "Observaciones" en la tabla comercial
-- y hasta ahora salía siempre vacía: no había dónde cargarla. El vendedor las
-- escribe de a una —un renglón por observación— y cada una ocupa la celda de su
-- fila, como en el formulario impreso.
--
-- Es un array y no un texto largo justamente por eso: el papel las reparte por
-- renglón, así que el modelo también.
-- =============================================================================

alter table public.notas_pedido
  add column if not exists observaciones text[] not null default '{}';

comment on column public.notas_pedido.observaciones is
  'Renglones de observación que el vendedor agrega de a uno. Cada uno ocupa la celda "Observaciones" de su fila en la tabla comercial impresa.';
