-- =============================================================================
-- Los clientes ubicados, para dibujarlos en el mapa.
--
-- La sección "Mapa" (celular y panel) muestra a todos los clientes con
-- coordenadas, agrupados en racimos. Para eso hace falta traerlos de una: son
-- ~16.500 y PostgREST corta las consultas normales en 1.000 filas, así que un
-- SELECT directo mostraría una fracción sin avisar. Devolver un solo `jsonb`
-- con todo adentro es una fila —no la toca ese tope— y un solo viaje.
--
-- ── Por qué SECURITY DEFINER ─────────────────────────────────────────────────
--
-- La RLS de `clientes` deja al vendedor ver sólo los suyos. El mapa muestra el
-- padrón entero, igual que el buscador de clientes (`buscar_clientes`, que ya es
-- SECURITY DEFINER por lo mismo): el padrón ya es visible para el vendedor por
-- esa vía, así que esto no expone nada nuevo. Se limita a lo que se dibuja:
-- código, razón social y coordenadas, una fila por cliente.
-- =============================================================================

create or replace function public.clientes_en_mapa()
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', t.id,
        'codigo', t.codigo,
        'razon_social', t.razon_social,
        'lat', t.lat,
        'lng', t.lng
      )
    ),
    '[]'::jsonb
  )
  from (
    -- Una dirección por cliente: la principal, y si no hay, la primera cargada.
    select distinct on (c.id)
      c.id, c.codigo, c.razon_social, d.lat, d.lng
    from public.clientes c
    join public.direcciones d on d.cliente_id = c.id
    where c.activo
      and d.lat is not null
      and d.lng is not null
    order by c.id, d.principal desc, d.creado_en
  ) t;
$$;

comment on function public.clientes_en_mapa is
  'Todos los clientes activos con coordenadas (una fila por cliente, direccion principal) como un unico jsonb, para dibujarlos en el mapa sin chocar el tope de filas de PostgREST.';

-- Sólo usuarios logueados. Igual que el resto de las funciones del dominio.
revoke all on function public.clientes_en_mapa() from public;
grant execute on function public.clientes_en_mapa() to authenticated;
