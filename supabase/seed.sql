-- =============================================================================
-- WoodTools · Rol de Visita
-- Datos de prueba para desarrollo local (`supabase db reset`).
--
-- ⚠️ NO se ejecuta en producción: `supabase db push` sólo aplica migrations/.
-- Sirve para levantar el entorno local con algo con qué probar.
-- =============================================================================

-- Clientes de ejemplo, con direcciones reales del AMBA para que la
-- optimización de ruta devuelva algo con sentido.
insert into public.clientes (codigo, razon_social, nombre_fantasia, contacto_nombre, telefono, activo)
values
  ('1001', 'Maderera del Oeste S.A.',      'Maderas Oeste',   'Jorge Pereyra',  '11-4444-1001', true),
  ('1002', 'Carpintería San Martín SRL',   'CSM',             'Laura Giménez',  '11-4444-1002', true),
  ('1003', 'Muebles Avellaneda',           null,              'Raúl Sosa',      '11-4444-1003', true),
  ('1004', 'Aberturas Morón S.R.L.',       'Aberturas Morón', 'Néstor Coria',   '11-4444-1004', true),
  ('1005', 'Tableros Liniers',             null,              'Ana Bustos',     '11-4444-1005', true),
  ('1006', 'Herrajes Ituzaingó',           'HI Herrajes',     'Marta Duarte',   '11-4444-1006', true)
on conflict (codigo) do nothing;

insert into public.direcciones
  (cliente_id, direccion_formateada, localidad, provincia, codigo_postal, lat, lng, principal, verificada)
select c.id, d.direccion, d.localidad, 'Buenos Aires', d.cp, d.lat, d.lng, true, true
from (values
  ('1001', 'Av. Rivadavia 15200, Ramos Mejía',        'Ramos Mejía',  '1704', -34.6395, -58.5645),
  ('1002', 'Av. San Martín 2450, Villa del Parque',   'CABA',         '1417', -34.6045, -58.4890),
  ('1003', 'Av. Mitre 750, Avellaneda',               'Avellaneda',   '1870', -34.6620, -58.3670),
  ('1004', 'Av. Rivadavia 18500, Morón',              'Morón',        '1708', -34.6510, -58.6190),
  ('1005', 'Av. Rivadavia 11200, Liniers',            'CABA',         '1408', -34.6410, -58.5230),
  ('1006', 'Av. Ratti 1200, Ituzaingó',               'Ituzaingó',    '1714', -34.6580, -58.6690)
) as d(codigo, direccion, localidad, cp, lat, lng)
join public.clientes c on c.codigo = d.codigo
on conflict do nothing;

-- Parámetros: en desarrollo conviene reportar la posición más seguido para ver
-- el mapa moverse sin esperar.
update public.configuracion set valor = '10' where clave = 'tracking_intervalo_seg';

-- Para probar de punta a punta hace falta:
--   1. Crear un usuario desde Studio (Authentication → Users → Add user).
--   2. Ascenderlo a administrador:
--        update public.perfiles
--           set rol = 'admin', estado = 'aprobado', aprobado_en = now()
--         where email = 'TU_CORREO';
--   3. Crear el vendedor de prueba y aprobarlo desde el panel de escritorio.
