-- =============================================================================
-- El nombre normalizado se guarda, en vez de recalcularse en cada búsqueda
--
-- Buscar por palabras y sin acentos obliga a normalizar los dos lados de la
-- comparación. Calculado al vuelo, eso son 12.181 `translate` +
-- `regexp_replace` por búsqueda cada vez que el índice de trigramas no puede
-- ayudar — y no puede con menos de tres letras, que es justo desde donde la
-- app empieza a buscar. Medido: "to" tardaba 372 ms.
--
-- Ahora el nombre normalizado es una columna calculada y guardada. Postgres la
-- mantiene sola en cada alta o edición del cliente, la búsqueda la compara
-- directo y el GIN de trigramas se arma sobre ella.
--
-- La contra, dicha en voz alta: una columna `generated` clava la función. Para
-- cambiar `interno.normalizar_busqueda` hay que tirar la columna primero,
-- cambiarla y volver a crearla. Es el precio de no recalcular 12.181 veces
-- algo que cambia cuando cambia el cliente, o sea casi nunca.
--
-- El índice viejo, `clientes_busqueda_idx`, se deja donde está: ya no lo usa
-- esta consulta, pero borrarlo es una decisión aparte y con él puesto el peor
-- caso sigue siendo el de antes.
-- =============================================================================

alter table public.clientes
  add column if not exists busqueda text
  generated always as (
    interno.normalizar_busqueda(
      coalesce(razon_social, '') || ' ' || coalesce(nombre_fantasia, '') || ' ' || codigo
    )
  ) stored;

comment on column public.clientes.busqueda is
  'Razon social + nombre de fantasia + codigo, en minusculas, sin acentos y con los espacios colapsados. La mantiene Postgres. Es contra esto que compara buscar_clientes.';

drop index if exists public.clientes_busqueda_norm_idx;
create index clientes_busqueda_norm_idx
  on public.clientes using gin (busqueda gin_trgm_ops);
