-- =============================================================================
-- Los CUIT que trae el listado
--
-- La exportación nueva del Gestión suma una columna "CUIT (en obs.)", pero de
-- 12.181 clientes sólo 8 la tienen cargada: el dato vive en las observaciones
-- de cada ficha y nadie lo pasó nunca a su campo. Se cargan igual, porque ocho
-- son ocho, pero la búsqueda por CUIT sigue sin servir para el resto del padrón.
--
-- El cliente 6560 queda afuera a propósito: su celda trae dos CUIT
-- ("20-06542798-3 / 20-05516213-2"). Elegir uno por nosotros sería inventar
-- cuál de las dos personas factura.
-- =============================================================================

update public.clientes as c set cuit = v.cuit
from (values
  ('214',   '20-26965478-4'),
  ('1267',  '20-12773769-0'),
  ('1751',  '20-26264979-3'),
  ('3067',  '20-04134741-5'),
  ('8972',  '20-17723203-4'),
  ('9524',  '20-21999171-2'),
  ('10737', '20-28993784-7')
) as v(codigo, cuit)
where c.codigo = v.codigo
  and c.cuit is distinct from v.cuit;
