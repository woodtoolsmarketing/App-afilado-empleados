-- ─────────────────────────────────────────────────────────────────────────────
-- La tendencia del cliente
--
-- Cada cliente compra casi siempre igual: uno factura y paga a 30 días, otro
-- pide presupuesto y paga al contado. Hasta ahora el vendedor elegía las dos
-- cosas de cero en cada nota, y eso son dos desplegables por nota para repetir
-- lo mismo de siempre —con el error de tipeo incluido.
--
-- Esto mira las notas anteriores del cliente y devuelve lo que usa
-- habitualmente, para que la pantalla lo deje ya elegido. NO decide nada: el
-- vendedor lo cambia con un toque y la nota sale como él diga.
--
-- Tres decisiones que conviene tener presentes:
--
--  1. **Se miran las últimas doce, no todas.** Un cliente que pasó de contado a
--     cuenta corriente hace dos años tiene que verse como cuenta corriente. Con
--     el histórico entero, veinte notas viejas de contado le ganarían para
--     siempre a las cinco nuevas.
--
--  2. **Las anuladas no cuentan.** Una nota anulada es justamente la que salió
--     mal; tomarla como costumbre sería repetir el error.
--
--  3. **Desempata la más reciente.** Con seis y seis, lo último que hizo el
--     cliente describe mejor lo que va a hacer hoy.
--
-- Se devuelven también las cantidades para que la pantalla pueda decir de dónde
-- salió ("en 7 de sus últimas 8"). Un valor puesto solo que no se explica es un
-- valor que el vendedor no revisa.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.tendencia_cliente(p_cliente_id uuid)
returns table (
  tipo_nota            public.tipo_nota_pedido,
  tipo_nota_veces      integer,
  condicion_venta      public.condicion_venta,
  condicion_detalle    text,
  condicion_veces      integer,
  notas_miradas        integer
)
language sql
stable
security invoker
set search_path to 'public', 'pg_temp'
as $$
  with recientes as (
    select n.tipo_nota, n.condicion_venta, n.condicion_venta_detalle, n.creado_en
      from public.notas_pedido n
     where n.cliente_id = p_cliente_id
       and n.estado <> 'anulada'
     order by n.creado_en desc
     limit 12
  ),
  total as (select count(*)::int as n from recientes),
  -- El tipo de nota: factura o presupuesto.
  tipo as (
    select r.tipo_nota,
           count(*)::int as veces,
           max(r.creado_en) as ultima
      from recientes r
     where r.tipo_nota is not null
     group by r.tipo_nota
     order by count(*) desc, max(r.creado_en) desc
     limit 1
  ),
  -- La forma de pago. El detalle (los días del cheque, el texto de "otro") va
  -- con ella: una condición "cheque" sin días no se puede preseleccionar
  -- entera, y separarlos dejaría el campo de días en blanco pidiendo atención.
  cond as (
    select r.condicion_venta,
           coalesce(r.condicion_venta_detalle, '') as detalle,
           count(*)::int as veces,
           max(r.creado_en) as ultima
      from recientes r
     where r.condicion_venta is not null
     group by r.condicion_venta, coalesce(r.condicion_venta_detalle, '')
     order by count(*) desc, max(r.creado_en) desc
     limit 1
  )
  select
    (select t.tipo_nota from tipo t),
    coalesce((select t.veces from tipo t), 0),
    (select c.condicion_venta from cond c),
    nullif((select c.detalle from cond c), ''),
    coalesce((select c.veces from cond c), 0),
    (select n from total);
$$;

comment on function public.tendencia_cliente(uuid) is
  'Cómo compra habitualmente este cliente, mirando sus últimas 12 notas no anuladas. Para preseleccionar, nunca para decidir.';

revoke all on function public.tendencia_cliente(uuid) from public;
grant execute on function public.tendencia_cliente(uuid) to authenticated;
