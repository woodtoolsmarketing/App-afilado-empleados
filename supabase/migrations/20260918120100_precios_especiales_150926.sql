-- Precios especiales por cliente, planilla "PRECIOS ESPECIALES: 15/09/2026".
-- Importe fijo que pisa la lista (ver 20260824123808_precios_especiales_por_cliente).
-- Se aplicó directo a producción el 18/09/2026; este archivo la deja registrada.
-- Referencia a los clientes por CODIGO (no por uuid) para no depender de ids
-- concretos. Idempotente por unique(cliente_id, codigo).
--
-- Nota: la planilla traía "11067 ALUMEL" (11067 es CARPINTERIA INTEGRAL; ALUMEL
-- es 11068) y "10484 CROCI JOSE" (10484 es LUTANO). Se cargó a 11068 y 10484
-- respectivamente, por decisión de la oficina.

insert into public.precios_especiales (cliente_id, codigo, precio, moneda, vigente_desde, observaciones)
select c.id, v.codigo, v.precio, 'ARS', date '2026-09-15',
       'Planilla PRECIOS ESPECIALES 15/09/2026, cargada como importe fijo.'
from (values
    ('577', '8001', 218.15),
    ('3376', '8001', 207.6),
    ('3376', '8005', 207.6),
    ('3381', '8001', 244.54),
    ('3381', '8005', 244.54),
    ('3394', '8001', 268.81),
    ('3394', '8005', 268.81),
    ('4057', '8001', 205.79),
    ('4057', '8005', 251.31),
    ('5522', '8001', 248.83),
    ('6322', '8001', 268.81),
    ('6322', '8005', 268.81),
    ('8321', '8001', 207.6),
    ('8355', '8001', 268.81),
    ('8355', '8005', 268.81),
    ('9957', '8001', 239.97),
    ('9957', '8005', 274.24),
    ('11806', '8001', 207.6),
    ('11806', '8005', 222.18),
    ('13838', '8001', 244.54),
    ('13838', '8005', 244.54),
    ('14291', '8001', 244.54),
    ('14291', '8005', 244.54),
    ('14398', '8001', 225.76),
    ('14398', '8005', 225.76),
    ('11068', '8001', 216.04),
    ('11068', '8005', 216.04),
    ('10484', '8001', 207.6)
) as v(cli_codigo, codigo, precio)
join public.clientes c on c.codigo = v.cli_codigo
on conflict (cliente_id, codigo) do update
  set precio = excluded.precio,
      vigente_desde = excluded.vigente_desde,
      observaciones = excluded.observaciones;
