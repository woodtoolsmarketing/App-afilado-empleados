-- =============================================================================
-- El domicilio tal como viene del listado del Gestión
--
-- No va a `direcciones` a propósito, y la razón importa: esa tabla exige
-- `lat`/`lng` porque es la que alimenta el mapa y el optimizador de ruta. Una
-- dirección sin coordenadas ahí adentro obligaría a hacer nulables esas dos
-- columnas, y con eso cualquier destino del recorrido podría quedar sin
-- coordenadas sin que nada lo impida.
--
-- El listado trae calle, localidad y código postal en texto, sin geocodificar.
-- Eso es un dato del cliente, no un destino navegable, y como tal se guarda.
--
-- Cuando alguien geocodifique el cliente desde "AGREGAR NUEVO DESTINO" se crea
-- la fila en `direcciones` y esa pasa a mandar. El buscador usa la
-- geocodificada si existe, y si no, ésta.
-- =============================================================================

alter table public.clientes
  add column if not exists direccion     text,
  add column if not exists localidad     text,
  add column if not exists codigo_postal text;

comment on column public.clientes.direccion is
  'Domicilio del listado del Gestion, sin geocodificar. La direccion navegable vive en `direcciones`.';

-- La localidad es la que resuelve la zona de la nota de pedido, así que se
-- busca por ella.
create index if not exists clientes_localidad_idx
  on public.clientes (lower(localidad)) where localidad is not null;
