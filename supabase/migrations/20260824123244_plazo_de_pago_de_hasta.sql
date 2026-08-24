-- El detalle de la condicion pasa a ser un RANGO: "0-30", "15-45".
--
-- Antes el cheque llevaba un numero suelto ("30") y la cuenta corriente tenia
-- PROHIBIDO llevar cualquier detalle. Ahora las dos llevan desde-hasta, porque
-- eso es lo que se negocia: no "a 30 dias" sino "de 15 a 45".
--
-- Se sigue aceptando NULL en las dos. No es tolerancia: son las 19 notas de
-- cuenta corriente que ya estan cargadas sin plazo, y un CHECK que las invalide
-- no se puede ni agregar. Lo que exige el rango es la app, del lado de donde se
-- carga. Y se sigue aceptando el numero suelto del cheque por si quedara alguna
-- de las viejas en algun lado.

alter table public.notas_pedido drop constraint if exists notas_pedido_condicion_detalle;

alter table public.notas_pedido add constraint notas_pedido_condicion_detalle check (
  case
    when condicion_venta in ('cheque', 'cuenta_corriente') then
      condicion_venta_detalle is null
      or (
        -- Formato viejo del cheque: un numero de dias, 0 a 60.
        condicion_venta_detalle ~ '^[0-9]{1,2}$'
        and condicion_venta_detalle::integer between 0 and 60
      )
      or (
        -- Formato nuevo: desde-hasta, los dos entre 0 y 60, y en ese orden.
        condicion_venta_detalle ~ '^[0-9]{1,2}-[0-9]{1,2}$'
        and split_part(condicion_venta_detalle, '-', 1)::integer between 0 and 60
        and split_part(condicion_venta_detalle, '-', 2)::integer between 0 and 60
        and split_part(condicion_venta_detalle, '-', 1)::integer
            <= split_part(condicion_venta_detalle, '-', 2)::integer
      )
    when condicion_venta = 'otro' then
      coalesce(btrim(condicion_venta_detalle), '') <> ''
    else
      condicion_venta_detalle is null
  end
);

comment on constraint notas_pedido_condicion_detalle on public.notas_pedido is
  'El cheque y la cuenta corriente llevan el plazo como rango "desde-hasta" en dias. Se acepta NULL por las notas ya cargadas.';
