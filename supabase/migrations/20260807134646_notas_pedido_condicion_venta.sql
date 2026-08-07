-- =============================================================================
-- Condición de venta de la nota de pedido.
--
-- El talonario tiene la columna "Condicion de Venta" y salía siempre vacía: no
-- había dónde cargarla. Es un dato de cobranza, así que va como opción cerrada
-- y no como texto libre: "ctdo", "contado" y "CONTADO" son tres condiciones
-- distintas para cualquier planilla que después quiera agrupar.
--
-- El detalle es para las dos opciones que piden algo más: los días del cheque
-- y el texto de "Otro".
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'condicion_venta') then
    create type public.condicion_venta as enum (
      'contado', 'transferencia', 'link_de_pago', 'cheque', 'cuenta_corriente', 'otro'
    );
  end if;
end $$;

alter table public.notas_pedido
  add column if not exists condicion_venta         public.condicion_venta,
  add column if not exists condicion_venta_detalle text;

comment on column public.notas_pedido.condicion_venta is
  'Cómo se cobra. Va impresa en la columna "Condicion de Venta" del talonario.';
comment on column public.notas_pedido.condicion_venta_detalle is
  'Los días cuando es cheque; el texto libre cuando es "otro". Vacío en el resto.';

-- El detalle sólo tiene sentido en esas dos, y en el cheque tiene que ser un
-- número de días dentro del rango que declara la opción.
alter table public.notas_pedido
  drop constraint if exists notas_pedido_condicion_detalle;

alter table public.notas_pedido
  add constraint notas_pedido_condicion_detalle check (
    case
      when condicion_venta = 'cheque'
        then condicion_venta_detalle ~ '^[0-9]{1,2}$'
             and condicion_venta_detalle::int between 0 and 60
      when condicion_venta = 'otro'
        then coalesce(btrim(condicion_venta_detalle), '') <> ''
      else condicion_venta_detalle is null
    end
  );
